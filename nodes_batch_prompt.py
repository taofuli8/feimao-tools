"""feimao tools batch prompt node."""

from __future__ import annotations

import json

from .prompt_parse import (
    DEFAULT_ASPECT,
    calc_resolution,
    default_asset_name,
    ensure_items,
    resolve_aspect,
    sanitize_asset_name,
)


def _as_float(value, default: float, lo: float, hi: float) -> float:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        number = default
    if number != number:
        number = default
    return min(hi, max(lo, number))


def _as_int(value, default: int, lo: int, hi: int) -> int:
    return int(round(_as_float(value, default, lo, hi)))


def _load_items(prompts_json: str) -> list[dict]:
    raw = (prompts_json or "").strip() or "[]"
    try:
        data = json.loads(raw)
    except Exception as exc:
        raise ValueError(f"prompts_json 不是有效 JSON: {exc}") from exc
    if isinstance(data, dict):
        data = data.get("prompts") or data.get("items") or data.get("list") or []
    if not isinstance(data, list):
        raise ValueError("prompts_json 必须是数组")
    return ensure_items(data)


class feimao_tools_Batch_Prompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompts_json": ("STRING", {"default": "[]", "multiline": True}),
                "index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "最大任务数": ("INT", {"default": 100, "min": 1, "max": 10000, "step": 1}),
                "默认宽高比": ("STRING", {"default": DEFAULT_ASPECT}),
                "百万像素": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 16.0, "step": 0.1}),
                "对齐倍数": ("INT", {"default": 16, "min": 8, "max": 128, "step": 4}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("输出提示词", "资产名", "编号", "宽度", "高度")
    FUNCTION = "get_prompt"
    CATEGORY = "feimao tools"
    DESCRIPTION = "feimao tools 批量提示词。标题写成 16-9-gpt----提示词 时，自动用标题里的 16:9 出宽高。"

    @classmethod
    def IS_CHANGED(cls, prompts_json, index, 最大任务数, 默认宽高比, 百万像素, 对齐倍数):
        return f"{prompts_json}|{index}|{最大任务数}|{默认宽高比}|{百万像素}|{对齐倍数}"

    def get_prompt(self, prompts_json="[]", index=0, 最大任务数=100, 默认宽高比=DEFAULT_ASPECT, 百万像素=1.0, 对齐倍数=16):
        items = _load_items(prompts_json)
        if not items:
            raise ValueError("feimao tools 批量提示词为空")

        idx = int(index or 0)
        if idx < 0:
            idx = 0
        if idx >= len(items):
            raise ValueError(f"当前编号超出范围（共 {len(items)} 条）")

        item = items[idx]
        number = str(idx + 1)
        text = str(item.get("text") or "").strip()
        name = sanitize_asset_name(item.get("name") or "") or default_asset_name(idx + 1)
        if not text:
            raise ValueError(f"第 {number} 条提示词为空")
        aspect = resolve_aspect(item.get("aspect") or "", name, 默认宽高比) or DEFAULT_ASPECT
        megapixels = _as_float(百万像素, 1.0, 0.1, 16.0)
        multiple = _as_int(对齐倍数, 16, 8, 128)
        width, height = calc_resolution(aspect, megapixels, multiple)
        return (text, name, number, width, height)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Batch_Prompt": feimao_tools_Batch_Prompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Batch_Prompt": "feimao tools 批量提示词",
}
