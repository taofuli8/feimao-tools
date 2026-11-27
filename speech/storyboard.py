"""Sample a video the way the older Codex jobs did, then pack frames into one sheet.

One sheet is one caption call. A 9-grid therefore costs about one ninth of
captioning every frame. Cells are labeled with the frame time, left to right,
top to bottom.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

import folder_paths

from .media import find_ffmpeg

GRID_SHAPE = {
    "1宫格": (1, 1),
    "4宫格": (2, 2),
    "6宫格": (3, 2),
    "9宫格": (3, 3),
    "12宫格": (4, 3),
}

CELL_W = 480
FRAME_H = 270
LABEL_H = 36
GAP = 10

# ffmpeg scene score is the difference from the previous tiny frame, from 0 to 1.
# A hard cut, slide change, or big on-screen change lands near 0.3 and above.
# Camera drift, a gesture, or a large caption is usually lower, around 0.12.
CUT_SCORE = 0.28
MOVE_SCORE = 0.12
CUT_GAP = 0.45


def clock(seconds: float) -> str:
    total = max(0, int(round(float(seconds))))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def probe_duration(src: str) -> float:
    ffmpeg = find_ffmpeg()
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(
        [ffmpeg, "-i", src],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=flags,
    )
    text = f"{proc.stderr or ''}\n{proc.stdout or ''}"
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not match:
        raise RuntimeError(f"读不到时长：{Path(src).name}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def plan_frames(duration: float, interval: float, cells: int, max_sheets: int) -> dict:
    """Times to grab. If the requested interval would blow past max_sheets, stretch it.

    Stretching keeps the first and last moments, so a long video is still covered
    instead of only its opening.
    """
    duration = max(float(duration), 0.1)
    interval = max(float(interval), 0.2)
    cells = max(int(cells), 1)
    max_sheets = max(int(max_sheets), 1)
    end = max(duration - 0.08, 0.0)

    times = []
    cursor = 0.0
    while cursor <= end + 1e-6:
        times.append(round(cursor, 3))
        cursor += interval
        if len(times) > 100000:
            break
    if not times:
        times = [0.0]

    capacity = cells * max_sheets
    stretched = len(times) > capacity
    actual = interval
    if stretched:
        count = capacity
        if count == 1 or end <= 0:
            times = [0.0]
            actual = duration
        else:
            times = [round(index * end / (count - 1), 3) for index in range(count)]
            actual = times[1] - times[0]
        deduped = []
        for value in times:
            if not deduped or abs(deduped[-1] - value) > 0.04:
                deduped.append(value)
        times = deduped or [0.0]

    sheets = [times[index:index + cells] for index in range(0, len(times), cells)]
    return {
        "times": times,
        "sheets": sheets,
        "requested_interval": interval,
        "actual_interval": actual,
        "stretched": stretched,
    }


def _parse_scene_scores(text: str) -> list:
    scores = []
    current = None
    for line in text.splitlines():
        found = re.search(r"pts_time:([0-9.]+)", line)
        if found:
            current = float(found.group(1))
            continue
        found = re.search(r"lavfi\.scene_score=([0-9.]+)", line)
        if found and current is not None:
            scores.append((current, float(found.group(1))))
            current = None
    return scores


def scene_scores(src: str, step: float = 0.5) -> list:
    """Score a small preview every `step` seconds. The video is not decoded at full size."""
    step = min(max(float(step), 0.25), 1.0)
    temp_dir = Path(folder_paths.get_temp_directory()) / "whisper_scene"
    temp_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(os.path.getmtime(src))
    key = hashlib.md5(f"{src}|{stamp}|{step:.2f}".encode("utf-8")).hexdigest()
    cache = temp_dir / f"{key}.json"
    if cache.is_file():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            return [(float(item[0]), float(item[1])) for item in data]
        except Exception:
            pass
    ffmpeg = find_ffmpeg()
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    fps = 1.0 / step
    cmd = [
        ffmpeg, "-hide_banner",
        "-i", src,
        "-vf", f"fps={fps:.4f},scale=160:-1,select='gte(scene,0)',metadata=print",
        "-an", "-f", "null", "-",
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=flags,
    )
    scores = _parse_scene_scores(proc.stderr or "")
    try:
        cache.write_text(json.dumps(scores), encoding="utf-8")
    except Exception:
        pass
    return scores


def _select_changes(scores: list, min_interval: float, end: float) -> tuple:
    """Keep cuts even when they are close. Other changes wait for min_interval.

    A shot that never changes still leaves a frame after `hold` seconds.
    """
    min_interval = max(float(min_interval), 0.5)
    hold = max(min_interval * 4.0, 8.0)
    if not scores:
        return [], hold
    kept = [scores[0]]
    last_t = scores[0][0]
    for t, score in scores[1:]:
        if t > end + 1e-3:
            continue
        gap = t - last_t
        if score >= CUT_SCORE and gap >= CUT_GAP:
            kept.append((t, score))
            last_t = t
        elif score >= MOVE_SCORE and gap >= min_interval - 0.05:
            kept.append((t, score))
            last_t = t
        elif gap >= hold - 0.05:
            kept.append((t, score))
            last_t = t
    if end - last_t >= min_interval:
        kept.append((round(end, 3), 0.0))
    return kept, hold


def _thin_cover(kept: list, scores: list, capacity: int, end: float) -> tuple:
    if len(kept) <= capacity:
        return kept, False
    if capacity <= 1:
        return [kept[0]], True
    span = max(float(end), 0.1)
    chosen = []
    for index in range(capacity):
        lo = span * index / capacity
        hi = span * (index + 1) / capacity

        def inside(item, last=index == capacity - 1):
            return lo <= item[0] < hi or (last and lo <= item[0] <= span)

        window = [item for item in kept if inside(item)]
        if not window:
            window = [item for item in scores if inside(item)]
        if not window:
            continue
        changes = [item for item in window if item[1] >= MOVE_SCORE]
        chosen.append(max(changes or window, key=lambda item: item[1]))
    deduped = []
    for item in sorted(chosen, key=lambda item: item[0]):
        if not deduped or item[0] - deduped[-1][0] > 0.2:
            deduped.append(item)
        elif item[1] > deduped[-1][1]:
            deduped[-1] = item
    return deduped or [kept[0]], True


def plan_by_change(src: str, duration: float, min_interval: float, cells: int, max_sheets: int) -> dict:
    """Pick frames where the picture actually changes, then pack them into sheets."""
    duration = max(float(duration), 0.1)
    end = max(duration - 0.08, 0.0)
    cells = max(int(cells), 1)
    max_sheets = max(int(max_sheets), 1)
    scores = scene_scores(src)
    if len(scores) < 2:
        plan = plan_frames(duration, min_interval, cells, max_sheets)
        plan["fallback"] = True
        plan["thinned"] = bool(plan.get("stretched"))
        plan["hold"] = max(float(min_interval) * 4.0, 8.0)
        return plan
    kept, hold = _select_changes(scores, min_interval, end)
    kept, thinned = _thin_cover(kept, scores, cells * max_sheets, end)
    times = []
    for t, _score in kept:
        t = round(min(max(float(t), 0.0), end), 3)
        if not times or abs(times[-1] - t) > 0.04:
            times.append(t)
    if not times:
        times = [0.0]
    gaps = [later - earlier for earlier, later in zip(times, times[1:])]
    actual = sum(gaps) / len(gaps) if gaps else float(min_interval)
    sheets = [times[index:index + cells] for index in range(0, len(times), cells)]
    return {
        "times": times,
        "sheets": sheets,
        "requested_interval": float(min_interval),
        "actual_interval": actual,
        "stretched": thinned,
        "thinned": thinned,
        "fallback": False,
        "hold": hold,
        "scene": True,
    }


def grab_frame(src: str, t: float):
    from PIL import Image

    ffmpeg = find_ffmpeg()
    temp_dir = Path(folder_paths.get_temp_directory()) / "whisper_frames"
    temp_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(os.path.getmtime(src))
    key = hashlib.md5(f"{src}|{stamp}|{t:.3f}".encode("utf-8")).hexdigest()
    dest = temp_dir / f"{key}.jpg"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if not (dest.is_file() and dest.stat().st_size > 0):
        fast = max(float(t) - 0.8, 0.0)
        fine = max(float(t) - fast, 0.0)
        cmd = [
            ffmpeg, "-y",
            "-ss", f"{fast:.3f}",
            "-i", src,
            "-ss", f"{fine:.3f}",
            "-frames:v", "1",
            "-q:v", "2",
            str(dest),
        ]
        subprocess.run(cmd, capture_output=True, creationflags=flags)
    if not dest.is_file() or dest.stat().st_size <= 0:
        return None
    try:
        with Image.open(dest) as image:
            return image.convert("RGB")
    except Exception:
        return None


def _font(size: int):
    from PIL import ImageFont

    for face in (
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
    ):
        if os.path.isfile(face):
            try:
                return ImageFont.truetype(face, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def compose_sheet(frames: list, cols: int, rows: int):
    """frames is a list of (seconds, PIL.Image), in reading order. Empty cells stay blank."""
    from PIL import Image, ImageDraw

    cols = max(int(cols), 1)
    rows = max(int(rows), 1)
    width = cols * CELL_W + (cols + 1) * GAP
    height = rows * (LABEL_H + FRAME_H) + (rows + 1) * GAP
    sheet = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(sheet)
    font = _font(22)
    for index, (seconds, image) in enumerate(frames):
        if index >= cols * rows or image is None:
            continue
        col = index % cols
        row = index // cols
        x = GAP + col * (CELL_W + GAP)
        y = GAP + row * (LABEL_H + FRAME_H + GAP)
        label = clock(seconds)
        draw.rounded_rectangle((x, y, x + CELL_W, y + LABEL_H - 4), radius=6, fill="#e8eef4")
        draw.text((x + 12, y + 4), label, fill="#1d3b53", font=font)
        fitted = image.copy()
        fitted.thumbnail((CELL_W, FRAME_H), Image.Resampling.LANCZOS)
        paste_x = x + (CELL_W - fitted.width) // 2
        paste_y = y + LABEL_H + (FRAME_H - fitted.height) // 2
        sheet.paste(fitted, (paste_x, paste_y))
    return sheet
