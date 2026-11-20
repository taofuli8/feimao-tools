"""Prompt on top, reference images below. One node for H3 Image and Qwen edit."""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

# Slot ceiling for the graph API. The node does not show this many sockets.
# How many images can be uploaded is the number of image outputs actually linked.
SLOT_CEILING = 100
FORMATS = (
    "自动",
    "H3 <Picture N>",
    "千问 <imageN>",
)
ASPECTS = {
    "1:1": (1, 1),
    "4:3": (4, 3),
    "3:4": (3, 4),
    "3:2": (3, 2),
    "2:3": (2, 3),
    "16:9": (16, 9),
    "9:16": (9, 16),
    "21:9": (21, 9),
}


def resolve_size(aspect, megapixels, multiple) -> tuple[int, int]:
    """Same rounding as ComfyUI Resolution Selector: megapixels are 1024² each."""
    w_ratio, h_ratio = ASPECTS.get(str(aspect or ""), (16, 9))
    try:
        mp = float(megapixels)
    except (TypeError, ValueError):
        mp = 1.0
    mp = min(16.0, max(0.1, mp))
    try:
        step = int(multiple)
    except (TypeError, ValueError):
        step = 16
    step = min(128, max(1, step))
    scale = math.sqrt((mp * 1024 * 1024) / (w_ratio * h_ratio))
    width = max(step, round(w_ratio * scale / step) * step)
    height = max(step, round(h_ratio * scale / step) * step)
    return int(width), int(height)


def _enabled(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _ref_index(value) -> int:
    try:
        index = int(value)
    except (TypeError, ValueError):
        return 1
    return min(SLOT_CEILING, max(1, index))


def _pixel_size(path: Path) -> tuple[int, int] | None:
    """Pixel size after the same EXIF rotation used when the picture is loaded."""
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            width, height = int(img.width), int(img.height)
    except Exception:
        return None
    if width < 1 or height < 1:
        return None
    return width, height


def output_size(aspect, megapixels, multiple, follow, ref_index, items) -> tuple[int, int]:
    """Follow one reference picture's pixels, or the aspect and megapixel preset."""
    if _enabled(follow):
        index = _ref_index(ref_index) - 1
        if 0 <= index < len(items):
            path = _resolve(items[index])
            if path is not None:
                size = _pixel_size(path)
                if size:
                    return size
    return resolve_size(aspect, megapixels, multiple)


_REF_RE = re.compile(
    r"\{\{img:(\d+)\}\}|<Picture\s+(\d+)\s*>|<image\s*(\d+)\s*>|@图片\s*(\d+)",
    re.IGNORECASE,
)


def render_prompt(text: str, fmt: str) -> str:
    """Write @ references in the tag format the target model reads."""
    style = str(fmt or FORMATS[1])

    def repl(match: re.Match) -> str:
        number = next(int(group) for group in match.groups() if group)
        if style.startswith("千问"):
            return f"<image{number}>"
        return f"<Picture {number}>"

    return _REF_RE.sub(repl, str(text or ""))


def _items(raw) -> list[dict]:
    text = str(raw or "").strip() or "[]"
    try:
        data = json.loads(text)
    except Exception as exc:
        raise ValueError(f"图片数据不是有效 JSON: {exc}") from exc
    if isinstance(data, dict):
        data = data.get("items") or data.get("images") or []
    if not isinstance(data, list):
        raise ValueError("图片数据必须是数组")
    items = []
    for item in data:
        if isinstance(item, dict) and str(item.get("filename") or item.get("abs_path") or "").strip():
            items.append(item)
    if len(items) > SLOT_CEILING:
        raise ValueError(f"图片接点超过了图结构上限 {SLOT_CEILING}")
    return items


def _referenced(text: str) -> list[int]:
    numbers = []
    for match in _REF_RE.finditer(str(text or "")):
        number = next((int(group) for group in match.groups() if group), 0)
        if number > 0:
            numbers.append(number)
    return numbers


def _load_rgb(path: Path):
    import numpy as np
    import torch
    from PIL import Image, ImageOps

    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        arr = np.array(img, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _stack_uploads(items) -> "object":
    """One batch of every uploaded picture, for the reverse node to read frame by frame."""
    import torch

    frames = []
    for item in items:
        path = _resolve(item)
        if path is None:
            continue
        frames.append(_load_rgb(path))
    if not frames:
        return torch.zeros((1, 64, 64, 3), dtype=torch.float32)
    height = max(frame.shape[1] for frame in frames)
    width = max(frame.shape[2] for frame in frames)
    fitted = []
    for frame in frames:
        if frame.shape[1] == height and frame.shape[2] == width:
            fitted.append(frame)
            continue
        canvas = torch.zeros((1, height, width, 3), dtype=frame.dtype)
        top = (height - frame.shape[1]) // 2
        left = (width - frame.shape[2]) // 2
        canvas[:, top:top + frame.shape[1], left:left + frame.shape[2], :] = frame
        fitted.append(canvas)
    return torch.cat(fitted, dim=0)


def _resolve(item: dict) -> Path | None:
    from .nodes_save_image import _source_path

    return _source_path(item)


def _content_mark(path: Path) -> str:
    """Byte sample plus size, so a replaced file cannot reuse the previous tensor."""
    stat = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        digest.update(handle.read(65536))
        if stat.st_size > 65536:
            handle.seek(max(0, stat.st_size - 65536))
            digest.update(handle.read(65536))
    return f"{stat.st_size}:{digest.hexdigest()}"


def _stamp(images_json: str) -> str:
    try:
        items = _items(images_json)
    except Exception as exc:
        return f"invalid:{exc}"
    parts = []
    for item in items:
        path = _resolve(item)
        if path is not None and path.is_file():
            try:
                mark = _content_mark(path)
            except Exception:
                mark = "unreadable"
            parts.append(f"{path}:{mark}")
        else:
            parts.append(str(item.get("filename") or item.get("abs_path") or ""))
    return "|".join(parts)


class feimao_tools_Image_Prompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images_json": ("STRING", {"default": "[]", "multiline": True}),
                "prompt_raw": ("STRING", {"default": "", "multiline": True}),
                "引用格式": (list(FORMATS), {"default": "自动"}),
                "送出格式": ("STRING", {"default": "H3 <Picture N>"}),
                "linked_json": ("STRING", {"default": "[]"}),
                "宽高比": (list(ASPECTS), {"default": "16:9"}),
                "百万像素": ("FLOAT", {"default": 8.0, "min": 0.1, "max": 16.0, "step": 0.1}),
                "对齐倍数": ("INT", {"default": 32, "min": 1, "max": 128, "step": 1}),
                "跟随参考图": ("BOOLEAN", {"default": False}),
                "参考图": ("INT", {"default": 1, "min": 1, "max": SLOT_CEILING, "step": 1}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING", "IMAGE") + ("IMAGE",) * SLOT_CEILING
    RETURN_NAMES = ("宽度", "高度", "提示词", "图片反推") + tuple(f"image_{i}" for i in range(SLOT_CEILING))
    FUNCTION = "run"
    CATEGORY = "feimao tools"
    DESCRIPTION = (
        "上面写提示词，输入 @ 引用下面上传的图。右侧图片接点接上一路，下面再出现一个接点。"
        "图片线可以预先接上。上传了几张就按顺序送出几张，没上传的空槽送出空值，H3 和千问会跳过，不用再断开。"
        "一张都不上传时按纯文生图走。提示词点到还没上传的图才会报错。"
        "引用格式选自动时，接到 H3 送 <Picture N>，接到千问送 <imageN>。接到别的节点可以手动改成其中一种。"
        "宽高比、百万像素和对齐倍数会算出宽度和高度，可以接到别的节点。"
        "打开跟随参考图后，宽度和高度改用所选参考图的像素尺寸。默认第一张，也可以指定第几张。"
        "右侧图片反推把全部已传图片收成一批，交给旁边的批量反推。"
    )

    @classmethod
    def IS_CHANGED(cls, images_json, prompt_raw, 引用格式, 送出格式, linked_json, 宽高比="16:9", 百万像素=8.0, 对齐倍数=32, 跟随参考图=False, 参考图=1):
        style = str(引用格式) if str(引用格式) not in ("", "自动") else str(送出格式 or "H3 <Picture N>")
        try:
            items = _items(images_json)
        except Exception:
            items = []
        width, height = output_size(宽高比, 百万像素, 对齐倍数, 跟随参考图, 参考图, items)
        return f"{_stamp(images_json)}|{prompt_raw}|{style}|{linked_json}|{width}|{height}|{int(_enabled(跟随参考图))}|{_ref_index(参考图)}"

    def run(self, images_json="[]", prompt_raw="", 引用格式="自动", 送出格式="H3 <Picture N>", linked_json="[]", 宽高比="16:9", 百万像素=8.0, 对齐倍数=32, 跟随参考图=False, 参考图=1):
        items = _items(images_json)
        referenced = _referenced(prompt_raw)
        missing = [number for number in referenced if number > len(items)]
        if missing:
            number = missing[0]
            raise ValueError(f"提示词用了第 {number} 张图，但这张图还没上传")
        images = []
        for index in range(SLOT_CEILING):
            # Prewired slots past the uploads stay empty. Every uploaded picture is sent, in order.
            if index >= len(items):
                images.append(None)
                continue
            item = items[index]
            path = _resolve(item)
            label = item.get("name") or item.get("filename") or index + 1
            if path is None:
                raise ValueError(f"找不到第 {index + 1} 张图：{label}")
            images.append(_load_rgb(path))
        style = str(引用格式) if str(引用格式) not in ("", "自动") else str(送出格式 or "H3 <Picture N>")
        width, height = output_size(宽高比, 百万像素, 对齐倍数, 跟随参考图, 参考图, items)
        return (width, height, render_prompt(prompt_raw, style), _stack_uploads(items), *images)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Image_Prompt": feimao_tools_Image_Prompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Image_Prompt": "feimao tools 图片提示词",
}
