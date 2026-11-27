"""音视频分段。划线、试听和改字幕在节点面板里完成，执行时只把结果交给后面的节点。"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import threading
from pathlib import Path

import folder_paths

from .media import AUDIO_EXT, VIDEO_EXT, extract_audio_wav, find_ffmpeg, resolve_media_path, separate_vocals_wav
from .storyboard import probe_duration
from .subtitle_utils import cues_to_srt, render_document

STEP_DEFAULT = 5.0
MAX_SPAN = 15.0
LIMIT_MAX = 120.0
MIN_SPAN = 0.3
WHISPER_MODEL = "large-v3-turbo-local"
_INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_SRT_TIME = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)")
_VIDEO_CODEC = re.compile(r"Video:\s*([A-Za-z0-9_]+)")
_COVER_CODECS = {"mjpeg", "png", "gif", "bmp", "webp"}
_MODEL = {"obj": None}
_LOCK = threading.Lock()


class SegmentError(Exception):
    pass


def clamp_limit(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = MAX_SPAN
    return min(LIMIT_MAX, max(1.0, number))


def clamp_step(value, limit=None) -> float:
    cap = clamp_limit(MAX_SPAN if limit is None else limit)
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = STEP_DEFAULT
    return min(cap, max(1.0, number))


def parse_cuts(value) -> list[float]:
    if isinstance(value, list):
        raw = value
    else:
        text = str(value or "").strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SegmentError("分界线读不出来") from exc
    if not isinstance(raw, list):
        raise SegmentError("分界线读不出来")
    cuts = []
    for item in raw:
        try:
            cuts.append(round(float(item), 2))
        except (TypeError, ValueError):
            continue
    return cuts


def default_cuts(duration: float, step: float, limit: float = MAX_SPAN) -> list[float]:
    step = clamp_step(step, limit)
    cuts = []
    cursor = step
    while cursor < duration - 0.05:
        cuts.append(round(cursor, 2))
        cursor += step
    return normalize_cuts(duration, cuts)


def normalize_cuts(duration: float, cuts: list[float]) -> list[float]:
    duration = round(float(duration), 2)
    if duration <= 0:
        return []
    internal = []
    previous = 0.0
    for value in sorted(cuts):
        value = round(float(value), 2)
        if value <= 0 or value >= duration:
            continue
        if value - previous < MIN_SPAN:
            continue
        if duration - value < MIN_SPAN:
            continue
        internal.append(value)
        previous = value
    return internal


def window_bounds(duration: float, window) -> tuple[float, float]:
    duration = round(float(duration), 2)
    start, end = 0.0, duration
    raw = window
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = None
    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        try:
            start = round(float(raw[0]), 2)
            end = round(float(raw[1]), 2)
        except (TypeError, ValueError):
            start, end = 0.0, duration
    start = min(max(0.0, start), duration)
    end = min(max(start, end), duration)
    if end - start < MIN_SPAN and duration >= MIN_SPAN:
        end = min(duration, start + MIN_SPAN)
    if end <= start:
        return 0.0, duration
    return start, end


def spans_from_cuts(duration: float, cuts: list[float], limit: float = MAX_SPAN, window=None) -> list[tuple[float, float]]:
    duration = round(float(duration), 2)
    limit = clamp_limit(limit)
    if duration <= 0:
        raise SegmentError("读不到这段的时长")
    start, end = window_bounds(duration, window)
    internal = []
    previous = start
    for value in sorted(normalize_cuts(duration, cuts)):
        if value <= start or value >= end:
            continue
        if value - previous < MIN_SPAN or end - value < MIN_SPAN:
            continue
        internal.append(value)
        previous = value
    points = [start, *internal, end]
    spans = []
    for left, right in zip(points, points[1:]):
        if internal and right - left > limit + 0.05:
            raise SegmentError(f"有一段超过 {limit:g} 秒，请调整分界或先点分段")
        if right <= left:
            continue
        spans.append((round(left, 2), round(right, 2)))
    if not spans:
        raise SegmentError("没有可保存的分段")
    return spans


def media_has_video(src: str) -> bool:
    if Path(src).suffix.lower() not in VIDEO_EXT:
        return False
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
    codecs = [item.lower() for item in _VIDEO_CODEC.findall(text)]
    return any(codec not in _COVER_CODECS for codec in codecs)


def probe_media(path: str) -> dict:
    source = resolve_media_path(path)
    duration = round(probe_duration(source), 2)
    return {
        "path": source,
        "name": Path(source).name,
        "duration": duration,
        "video": media_has_video(source),
        "cuts": [],
    }


def _stem(path: str) -> str:
    stem = _INVALID.sub("_", Path(path).stem).strip(" .") or "segment"
    return stem[:80]


def segment_dir(path: str) -> Path:
    source = Path(path)
    folder = source.parent / f"{_stem(path)}_分段"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _srt_seconds(value: str):
    match = _SRT_TIME.search(value or "")
    if not match:
        return None
    hours, minutes, seconds, millis = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_srt(text: str) -> list[dict]:
    body = (text or "").lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not body:
        return []
    if "-->" not in body:
        raise SegmentError("字幕格式不对，请按 srt 的时间轴回填")
    cues = []
    for block in re.split(r"\n\s*\n", body):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        time_at = next((index for index, line in enumerate(lines) if "-->" in line), -1)
        if time_at < 0:
            continue
        left, _, right = lines[time_at].partition("-->")
        start = _srt_seconds(left)
        end = _srt_seconds(right)
        caption = "\n".join(lines[time_at + 1 :]).strip()
        if start is None or end is None or end <= start or not caption:
            continue
        cues.append({"start": start, "end": end, "text": caption})
    if not cues:
        raise SegmentError("字幕格式不对，请按 srt 的时间轴回填")
    return cues


def cues_or_blank(text: str) -> list[dict]:
    if not str(text or "").strip():
        return []
    return parse_srt(text)


def shift_cues(cues: list[dict], start: float, end: float) -> list[dict]:
    shifted = []
    for cue in cues:
        if cue["end"] <= start + 0.02 or cue["start"] >= end - 0.02:
            continue
        cue_start = max(0.0, cue["start"] - start)
        cue_end = min(end - start, cue["end"] - start)
        if cue_end - cue_start < 0.04:
            cue_end = cue_start + 0.04
        shifted.append({"start": round(cue_start, 3), "end": round(cue_end, 3), "text": cue["text"]})
    return shifted


def merge_cues(existing: list[dict], added: list[dict], start: float, end: float) -> list[dict]:
    kept = [cue for cue in existing if cue["end"] <= start + 0.05 or cue["start"] >= end - 0.05]
    cues = kept + added
    cues.sort(key=lambda item: (item["start"], item["end"]))
    return cues


def _run_ffmpeg(command: list[str]) -> None:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        result = subprocess.run(command, capture_output=True, timeout=300, check=False, creationflags=flags)
    except subprocess.TimeoutExpired as exc:
        raise SegmentError("截取超时") from exc
    target = Path(command[-1])
    if result.returncode != 0 or not target.is_file() or target.stat().st_size < 32:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        tail = detail[-1] if detail else "ffmpeg 没有生成文件"
        raise SegmentError("截取失败：" + tail[:300])


def trim_media(source: str, target: Path, start: float, end: float, video: bool) -> None:
    ffmpeg = find_ffmpeg()
    target.parent.mkdir(parents=True, exist_ok=True)
    if video:
        command = [
            ffmpeg, "-y", "-i", source,
            "-ss", str(start), "-to", str(end),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            str(target),
        ]
    else:
        command = [
            ffmpeg, "-y", "-i", source,
            "-ss", str(start), "-to", str(end),
            "-vn", "-c:a", "libmp3lame", "-b:a", "192k",
            str(target),
        ]
    _run_ffmpeg(command)


def save_segments(path: str, cuts, srt: str, only_index=None, limit: float = MAX_SPAN, window=None) -> dict:
    source = resolve_media_path(path)
    duration = probe_duration(source)
    spans = spans_from_cuts(duration, parse_cuts(cuts), limit, window)
    video = media_has_video(source)
    cues = cues_or_blank(srt)
    if only_index is not None:
        only_index = int(only_index)
        if only_index < 0 or only_index >= len(spans):
            raise SegmentError("选中的分段不存在")
    folder = segment_dir(source)
    stem = _stem(source)
    suffix = ".mp4" if video else ".mp3"
    clips = []
    for index, (start, end) in enumerate(spans):
        filename = f"{stem}_{index + 1:03d}{suffix}"
        target = folder / filename
        srt_path = ""
        if only_index is None or only_index == index:
            trim_media(source, target, start, end, video)
            if cues:
                text = cues_to_srt(shift_cues(cues, start, end))
                subtitle = target.with_suffix(".srt")
                subtitle.write_text(text if text.endswith("\n") or text == "" else text + "\n", encoding="utf-8-sig")
                srt_path = str(subtitle)
        elif target.is_file():
            srt_file = target.with_suffix(".srt")
            srt_path = str(srt_file) if srt_file.is_file() else ""
        clips.append(
            {
                "index": index,
                "path": str(target) if target.is_file() else "",
                "start": start,
                "end": end,
                "srt": srt_path,
            }
        )
    return {"folder": str(folder), "clips": clips, "video": video}


def _whisper_parts():
    import nodes as comfy_nodes

    return (
        comfy_nodes.NODE_CLASS_MAPPINGS["LoadFasterWhisperModel"],
        comfy_nodes.NODE_CLASS_MAPPINGS["FasterWhisperTranscription"],
    )


def _whisper_model():
    if _MODEL["obj"] is not None:
        return _MODEL["obj"]
    loader_cls, _transcriber = _whisper_parts()
    last = None
    loader = loader_cls()
    for device in ("cuda", "cpu"):
        try:
            _MODEL["obj"] = loader.load_model(WHISPER_MODEL, device)[0]
            return _MODEL["obj"]
        except Exception as exc:
            last = exc
    raise SegmentError(f"语音模型没有加载起来：{last}")


def _offset_cues(cues: list[dict], start: float) -> list[dict]:
    moved = []
    for cue in cues:
        moved.append(
            {
                "start": round(cue["start"] + start, 3),
                "end": round(cue["end"] + start, 3),
                "text": cue["text"],
            }
        )
    return moved


def clip_range(source: str, start: float, end: float, index: int) -> tuple[str, float, float]:
    duration = round(probe_duration(source), 2)
    start = round(float(start), 2)
    end = round(float(end), 2)
    if end <= start:
        raise SegmentError("请先选中一段")
    if start < 0 or start >= duration:
        raise SegmentError("这一段超出了整段长度")
    end = min(end, duration)
    if start <= 0.05 and abs(end - duration) <= 0.2:
        return source, 0.0, duration
    video = media_has_video(source)
    folder = Path(folder_paths.get_temp_directory()) / "whisper_segment"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"part_{int(index) + 1:03d}{'.mp4' if video else '.mp3'}"
    trim_media(source, target, start, end, video)
    return str(target), start, end


def _vocal_file(value: str) -> str:
    if not str(value or "").strip():
        return ""
    try:
        return resolve_media_path(value)
    except Exception:
        return ""


def separate_only(path: str, start: float, end: float, index: int) -> dict:
    source = resolve_media_path(path)
    target, origin, stop = clip_range(source, start, end, index)
    with _LOCK:
        vocals = separate_vocals_wav(target)
    full = origin <= 0.05 and abs(stop - round(probe_duration(source), 2)) <= 0.2
    stored = segment_dir(source) / ("人声.wav" if full else f"人声_{int(index) + 1:03d}.wav")
    shutil.copyfile(vocals, stored)
    return {"vocals": str(stored), "vocal_start": origin, "vocal_end": stop}


def _audio_for_text(source: str, start: float, end: float, index: int, vocals: str, vocal_start, vocal_end) -> tuple[str, float, float]:
    vocal_file = _vocal_file(vocals)
    try:
        covered_start = round(float(vocal_start), 2)
        covered_end = round(float(vocal_end), 2)
    except (TypeError, ValueError):
        covered_start, covered_end = 0.0, 0.0
    start = round(float(start), 2)
    end = round(float(end), 2)
    if vocal_file and covered_end > covered_start and start >= covered_start - 0.15 and end <= covered_end + 0.15:
        local_start = max(0.0, start - covered_start)
        local_end = max(local_start + 0.2, end - covered_start)
        if local_start <= 0.05 and abs((covered_end - covered_start) - (end - start)) <= 0.4:
            return vocal_file, start, end
        folder = Path(folder_paths.get_temp_directory()) / "whisper_segment"
        folder.mkdir(parents=True, exist_ok=True)
        trimmed = folder / f"vocal_{int(index) + 1:03d}.mp3"
        trim_media(vocal_file, trimmed, local_start, local_end, False)
        return str(trimmed), start, end
    target, origin, stop = clip_range(source, start, end, index)
    return extract_audio_wav(target), origin, stop


def recognize_media(path: str, start: float, end: float, index: int, srt: str, vocals: str = "", vocal_start=0, vocal_end=0) -> dict:
    source = resolve_media_path(path)
    existing = cues_or_blank(srt)
    audio, origin, stop = _audio_for_text(source, start, end, index, vocals, vocal_start, vocal_end)
    with _LOCK:
        _loader, transcriber = _whisper_parts()
        model = _whisper_model()
        params = transcriber.collect_params(
            {
                "language": "zh",
                "task": "transcribe",
                "word_timestamps": True,
                "vad_filter": False,
                "clip_timestamps": "0",
                "beam_size": 5,
                "temperature": 0.0,
                "condition_on_previous_text": True,
                "initial_prompt": "中文歌词，一句歌词一行。",
                "hallucination_silence_threshold": 1.5,
            }
        )
        transcriptions = transcriber().transcribe(audio, model, **params)[0]
    text = render_document(transcriptions, "时间轴", 14, 0.25, "lyric")
    try:
        parsed = parse_srt(text) if str(text or "").strip() else []
    except SegmentError:
        parsed = []
    fresh = _offset_cues(parsed, origin)
    duration = round(probe_duration(source), 2)
    if origin <= 0.05 and abs(stop - duration) <= 0.2:
        cues = fresh
    else:
        cues = merge_cues(existing, fresh, origin, stop)
    return {
        "srt": cues_to_srt(cues),
        "vocals": _vocal_file(vocals),
        "vocal_start": vocal_start or 0,
        "vocal_end": vocal_end or 0,
    }


def export_saved(path: str, cuts, selected, srt: str, vocals: str, limit: float = MAX_SPAN, window=None) -> tuple:
    saved = save_segments(path, cuts, srt, None, limit, window)
    clips = [item["path"] for item in saved["clips"] if item["path"]]
    if not clips:
        raise SegmentError("没有写出分段")
    try:
        index = int(selected)
    except (TypeError, ValueError):
        index = 0
    if index < 0 or index >= len(clips):
        index = 0
    vocal = ""
    if str(vocals or "").strip():
        try:
            vocal = resolve_media_path(vocals)
        except Exception:
            vocal = ""
    text = str(srt or "")
    return clips[index], clips, [text, ".srt"], vocal, text


class MediaSegment:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "音视频": ("STRING", {"default": ""}),
                "每段秒数": ("FLOAT", {"default": STEP_DEFAULT, "min": 1.0, "max": LIMIT_MAX, "step": 0.5}),
                "分界": ("STRING", {"default": "[]"}),
                "选中段": ("INT", {"default": 0, "min": 0, "max": 9999}),
                "字幕内容": ("STRING", {"default": "", "multiline": True}),
                "人声文件": ("STRING", {"default": ""}),
                "人声起点": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.01}),
                "最长秒数": ("FLOAT", {"default": MAX_SPAN, "min": 1.0, "max": LIMIT_MAX, "step": 0.5}),
                "人声终点": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.01}),
                "选区": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("FILEPATH", "MEDIA_LIST", "SUBTITLE", "FILEPATH", "STRING")
    RETURN_NAMES = ("当前片段", "全部分段", "字幕", "人声", "字幕文本")
    FUNCTION = "export_clips"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, 音视频, **kwargs):
        try:
            resolve_media_path(音视频)
            return True
        except Exception as exc:
            return str(exc)

    def export_clips(self, 音视频, 每段秒数, 分界, 选中段, 字幕内容, 人声文件, 人声起点, 最长秒数=MAX_SPAN, 人声终点=0, 选区=""):
        del 每段秒数, 人声起点, 人声终点
        try:
            selected, clips, subtitle, vocal, text = export_saved(音视频, 分界, 选中段, 字幕内容, 人声文件, 最长秒数, 选区)
        except SegmentError:
            raise
        except Exception as exc:
            raise SegmentError(str(exc)) from exc
        return {"ui": {"text": [text]}, "result": (selected, clips, subtitle, vocal, text)}


def _json(payload: dict, status: int = 200):
    from aiohttp import web

    return web.json_response(payload, status=status, dumps=lambda obj: json.dumps(obj, ensure_ascii=False))


def register_segment_routes() -> None:
    try:
        from server import PromptServer
    except Exception:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None or getattr(instance, "_segment_routes", False):
        return
    instance._segment_routes = True

    @instance.routes.get("/fasterwhisper/segment/media")
    async def segment_media(request):
        from aiohttp import web

        path = request.query.get("path") or ""
        try:
            resolved = resolve_media_path(path)
        except Exception:
            return web.Response(status=404)
        if Path(resolved).suffix.lower() not in AUDIO_EXT | VIDEO_EXT:
            return web.Response(status=404)
        return web.FileResponse(resolved)

    @instance.routes.post("/fasterwhisper/segment/probe")
    async def segment_probe(request):
        data = await request.json()
        try:
            found = await asyncio.to_thread(probe_media, data.get("path") or "")
        except Exception as exc:
            return _json({"error": str(exc)})
        found["error"] = ""
        return _json(found)

    @instance.routes.post("/fasterwhisper/segment/save")
    async def segment_save(request):
        data = await request.json()
        only = data.get("index")
        try:
            saved = await asyncio.to_thread(
                save_segments,
                data.get("path") or "",
                data.get("cuts") or [],
                data.get("srt") or "",
                None if only in (None, "") else only,
                MAX_SPAN if data.get("limit") in (None, "") else data.get("limit"),
                data.get("selection"),
            )
        except Exception as exc:
            return _json({"folder": "", "clips": [], "error": str(exc)})
        saved["error"] = ""
        return _json(saved)

    @instance.routes.post("/fasterwhisper/segment/recognize")
    async def segment_recognize(request):
        data = await request.json()
        try:
            found = await asyncio.to_thread(
                recognize_media,
                data.get("path") or "",
                float(data.get("start") or 0),
                float(data.get("end") or 0),
                int(data.get("index") or 0),
                data.get("srt") or "",
                data.get("vocals") or "",
                data.get("vocal_start") or 0,
                data.get("vocal_end") or 0,
            )
        except Exception as exc:
            return _json({"srt": "", "vocals": "", "vocal_start": 0, "vocal_end": 0, "error": str(exc)})
        found["error"] = ""
        return _json(found)

    @instance.routes.post("/fasterwhisper/segment/separate")
    async def segment_separate(request):
        data = await request.json()
        try:
            found = await asyncio.to_thread(
                separate_only,
                data.get("path") or "",
                float(data.get("start") or 0),
                float(data.get("end") or 0),
                int(data.get("index") or 0),
            )
        except Exception as exc:
            return _json({"vocals": "", "vocal_start": 0, "vocal_end": 0, "error": str(exc)})
        found["error"] = ""
        return _json(found)
