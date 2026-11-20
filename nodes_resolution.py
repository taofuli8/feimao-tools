"""Resolution for the multi-model comparison workflow."""

from __future__ import annotations

from .prompt_parse import ASPECT_RATIOS, calc_resolution, normalize_aspect

DEFAULT_ASPECT = "16:9 (Widescreen)"


def _snap(value, step: int) -> int:
    step = max(1, int(step or 16))
    snapped = int(round(float(value) / step) * step)
    return max(step, snapped)


class feimao_tools_Resolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽高比": (list(ASPECT_RATIOS), {"default": DEFAULT_ASPECT}),
                "百万像素": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 16.0, "step": 0.1}),
                "对齐倍数": ("INT", {"default": 16, "min": 8, "max": 128, "step": 8}),
                "自定义尺寸": ("BOOLEAN", {"default": False}),
                "宽度": ("INT", {"default": 1360, "min": 64, "max": 8192, "step": 16}),
                "高度": ("INT", {"default": 768, "min": 64, "max": 8192, "step": 16}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("宽度", "高度")
    FUNCTION = "resolve"
    CATEGORY = "feimao tools"
    DESCRIPTION = "没开自定义尺寸时，宽度和高度跟着宽高比和百万像素显示。打开自定义尺寸后，才使用手填的宽高。"

    @classmethod
    def IS_CHANGED(cls, 宽高比, 百万像素, 对齐倍数, 自定义尺寸, 宽度, 高度):
        return f"{宽高比}|{百万像素}|{对齐倍数}|{自定义尺寸}|{宽度}|{高度}"

    def resolve(self, 宽高比, 百万像素, 对齐倍数, 自定义尺寸, 宽度, 高度):
        step = int(对齐倍数 or 16)
        if 自定义尺寸:
            return (_snap(宽度, step), _snap(高度, step))
        aspect = normalize_aspect(宽高比) or DEFAULT_ASPECT
        return calc_resolution(aspect, float(百万像素 or 1.0), step)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Resolution": feimao_tools_Resolution,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Resolution": "feimao tools 生图尺寸",
}
