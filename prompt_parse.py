"""Adaptive prompt import for feimao tools."""

from __future__ import annotations

import math
import re

NAME_SEP = "----"
INVALID_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

ASPECT_RATIOS = (
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
    "2.35:1 (公众号首条封面)",
)
DEFAULT_ASPECT = "9:16 (Portrait Widescreen)"
# 微信公众号首条封面是 900×383，也就是 2.35:1。先定高度再反推宽度，避免按 16 取整后和 21:9 变成同一尺寸。
COVER_ASPECT = "2.35:1 (公众号首条封面)"
COVER_RATIO = 2.35


def normalize_aspect(value: str) -> str:
    text = str(value or "").strip()
    return text if text in ASPECT_RATIOS else ""


_RATIO_PARTS = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


def calc_resolution(aspect: str, megapixels: float = 1.0, multiple: int = 16) -> tuple[int, int]:
    """Same math as ComfyUI Resolution Selector, except the WeChat cover ratio."""
    name = normalize_aspect(aspect) or DEFAULT_ASPECT
    mp = float(megapixels or 1.0)
    step = max(1, int(multiple or 16))
    total_pixels = mp * 1024 * 1024
    if name == COVER_ASPECT:
        height = max(step, round(math.sqrt(total_pixels / COVER_RATIO) / step) * step)
        width = max(step, round(height * COVER_RATIO / step) * step)
        return int(width), int(height)
    w_ratio, h_ratio = _RATIO_PARTS.get(name, (9, 16))
    scale = math.sqrt(total_pixels / (w_ratio * h_ratio))
    width = max(step, round(w_ratio * scale / step) * step)
    height = max(step, round(h_ratio * scale / step) * step)
    return int(width), int(height)


_NAME_ASPECTS = (
    (re.compile(r"2\.35\s*[:：比/xX×\-]\s*1"), COVER_ASPECT),
    (re.compile(r"21\s*[:：比/xX×\-]\s*9"), "21:9 (Ultrawide)"),
    (re.compile(r"16\s*[:：比/xX×\-]\s*9"), "16:9 (Widescreen)"),
    (re.compile(r"9\s*[:：比/xX×\-]\s*16"), "9:16 (Portrait Widescreen)"),
    (re.compile(r"3\s*[:：比/xX×\-]\s*4"), "3:4 (Portrait Standard)"),
    (re.compile(r"4\s*[:：比/xX×\-]\s*3"), "4:3 (Standard)"),
    (re.compile(r"2\s*[:：比/xX×\-]\s*3"), "2:3 (Portrait Photo)"),
    (re.compile(r"3\s*[:：比/xX×\-]\s*2"), "3:2 (Photo)"),
    (re.compile(r"1\s*[:：比/xX×\-]\s*1"), "1:1 (Square)"),
)


def aspect_from_name(name: str) -> str:
    """标题里的 16-9、4-3、3-4、2.35-1 对到预设宽高比。正文里的比例不算。"""
    source = str(name or "")
    if not source:
        return ""
    found: tuple[int, str] | None = None
    for pattern, aspect in _NAME_ASPECTS:
        hit = pattern.search(source)
        if hit is None:
            continue
        if found is None or hit.start() < found[0]:
            found = (hit.start(), aspect)
    return found[1] if found else ""


def resolve_aspect(aspect: str, name: str = "", default: str = "") -> str:
    """手选的比例优先，否则用标题里的比例，最后才用默认。"""
    return normalize_aspect(aspect) or aspect_from_name(name) or normalize_aspect(default) or ""


def sanitize_asset_name(name: str) -> str:
    cleaned = INVALID_NAME_CHARS.sub("_", (name or "").strip())
    return cleaned.strip(" .")


def default_asset_name(index: int) -> str:
    n = max(1, int(index or 1))
    return f"默认{n:02d}"


def parse_prompt_text(text: str, *, start_index: int = 1, fallback_name: str | None = None) -> list[dict]:
    """Parse pasted/file text into [{name, text}, ...]."""
    if text is None:
        return []

    normalized = str(text).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    # Whole-file separator lines made of --- or more (same idea as common paste UX)
    if re.search(r"^\s*-{3,}\s*$", normalized, flags=re.M):
        chunks = re.split(r"^\s*-{3,}\s*$", normalized, flags=re.M)
        items: list[dict] = []
        index = start_index
        for chunk in chunks:
            chunk = chunk.strip()
            if not chunk:
                continue
            items.extend(parse_prompt_text(chunk, start_index=index, fallback_name=fallback_name))
            index = start_index + len(items)
        return [_fill_aspect(item) for item in items]

    items = []
    index = start_index
    current: dict | None = None

    def flush():
        nonlocal current, index
        if not current:
            return
        text = str(current.get("text") or "").strip()
        if text:
            items.append(current)
            index += 1
        current = None

    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            flush()
            continue
        if NAME_SEP in line:
            flush()
            left, right = line.split(NAME_SEP, 1)
            name = sanitize_asset_name(left) or sanitize_asset_name(fallback_name or "") or default_asset_name(index)
            current = {"name": name, "text": right.strip(), "aspect": ""}
            continue
        if current is not None:
            prev = str(current.get("text") or "").strip()
            current["text"] = f"{prev}\n{line}".strip() if prev else line
            continue
        name = sanitize_asset_name(fallback_name or "") or default_asset_name(index)
        items.append({"name": name, "text": line, "aspect": ""})
        index += 1
    flush()
    return [_fill_aspect(item) for item in items]


def ensure_items(items: list) -> list[dict]:
    out = []
    for i, item in enumerate(items or [], start=1):
        if isinstance(item, str):
            text = item.strip()
            if not text:
                continue
            if NAME_SEP in text:
                left, right = text.split(NAME_SEP, 1)
                name = sanitize_asset_name(left) or default_asset_name(i)
                prompt = right.strip()
                if prompt:
                    out.append({"name": name, "text": prompt, "aspect": resolve_aspect("", name)})
            else:
                fallback = default_asset_name(i)
                out.append({"name": fallback, "text": text, "aspect": resolve_aspect("", fallback)})
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("prompt") or "").strip()
        if not text:
            continue
        name = sanitize_asset_name(str(item.get("name") or "")) or default_asset_name(i)
        out.append({"name": name, "text": text, "aspect": resolve_aspect(item.get("aspect") or "", name)})
    return out


def _fill_aspect(item: dict) -> dict:
    item["aspect"] = resolve_aspect(item.get("aspect") or "", item.get("name") or "")
    return item
