from __future__ import annotations

import json
import math

from .prompt_parse import ASPECT_RATIOS


def _items(raw: str, width: int, height: int) -> list[dict]:
    try:
        parsed = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        parsed = parsed.get("items") or parsed.get("elements") or parsed.get("boxes") or []
    if not isinstance(parsed, list):
        return []
    width = max(1, int(width or 1024))
    height = max(1, int(height or 1536))
    items = []
    for box in parsed:
        if not isinstance(box, dict):
            continue
        bbox = box.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        try:
            y0, x0, y1, x1 = [int(round(float(v))) for v in bbox]
        except (TypeError, ValueError):
            continue
        y0, x0 = max(0, min(1000, y0)), max(0, min(1000, x0))
        y1, x1 = max(0, min(1000, y1)), max(0, min(1000, x1))
        if y1 <= y0 or x1 <= x0:
            continue
        label = "text" if box.get("type") == "text" else "object"
        item = {"label": label, "caption": str(box.get("desc") or "")}
        if label == "text":
            item["text"] = str(box.get("text") or "")
        palette = box.get("palette") if isinstance(box.get("palette"), list) else box.get("color_palette")
        if isinstance(palette, list) and palette:
            item["palette"] = [str(color) for color in palette[:5]]
        item["bbox"] = [
            math.floor(round(y0 * height / 1000, 9)) - height // 2,
            math.floor(round(x0 * width / 1000, 9)) - width // 2,
            math.ceil(round(y1 * height / 1000, 9)) - height // 2,
            math.ceil(round(x1 * width / 1000, 9)) - width // 2,
        ]
        items.append(item)
    return items


def compile_layout(caption: str, boxes: str, width: int, height: int) -> str:
    layout = {
        "summary": {"caption": str(caption or "").strip()},
        "items": _items(boxes, width, height),
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(layout, ensure_ascii=False, separators=(",", ":"))


def pasted_prompt(raw: str) -> str:
    text = str(raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        chunk = text[start : end + 1]
        try:
            value = json.loads(chunk)
        except json.JSONDecodeError:
            value = None
        if isinstance(value, dict):
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text


class feimao_tools_Moss_Box:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "整图描述": ("STRING", {"multiline": True, "default": ""}),
                "boxes": ("STRING", {"multiline": True, "default": "[]"}),
                "宽度": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 16}),
                "高度": ("INT", {"default": 1536, "min": 16, "max": 16384, "step": 16}),
                "粘贴提示词": ("STRING", {"multiline": True, "default": ""}),
                "宽高比": (list(ASPECT_RATIOS), {"default": "2:3 (Portrait Photo)"}),
                "百万像素": ("FLOAT", {"default": 1.5, "min": 0.1, "max": 16.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("最终提示词", "宽度", "高度")
    FUNCTION = "compile"
    CATEGORY = "feimao tools"
    DESCRIPTION = "宽高比和百万像素会算出宽度和高度，输出接到空 Latent。整图描述写在节点上。粘贴提示词有内容时，生成用贴进来的文本。"

    def compile(self, 整图描述, boxes, 宽度, 高度, 粘贴提示词="", 宽高比="2:3 (Portrait Photo)", 百万像素=1.5):
        width = max(16, int(宽度))
        height = max(16, int(高度))
        _ = (宽高比, 百万像素)
        pasted = pasted_prompt(粘贴提示词)
        prompt = pasted if pasted else compile_layout(整图描述, boxes, width, height)
        return (prompt, width, height)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Moss_Box": feimao_tools_Moss_Box,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Moss_Box": "feimao tools 画框",
}
