"""Size control for the Qwen Image 2.1 edit subgraph.

Either follow a reference image's real size, or compute width/height from
aspect ratio + megapixels. Empty image sockets are safe.
"""

from __future__ import annotations

from .prompt_parse import ASPECT_RATIOS, calc_resolution, normalize_aspect

DEFAULT_ASPECT = "9:16 (Portrait Widescreen)"


def _snap(value, step: int) -> int:
    step = max(1, int(step or 16))
    return max(step, int(round(float(value) / step) * step))


class feimao_tools_Edit_Size:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "尺寸跟随图几": ("INT", {"default": 1, "min": 1, "max": 10, "step": 1}),
                "自定义尺寸": ("BOOLEAN", {"default": False}),
                "宽高比": (list(ASPECT_RATIOS), {"default": DEFAULT_ASPECT}),
                "百万像素": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 16.0, "step": 0.1}),
            },
            "optional": {
                **{f"image_{i}": ("IMAGE",) for i in range(1, 11)},
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("宽度", "高度")
    FUNCTION = "resolve"
    CATEGORY = "feimao tools"
    DESCRIPTION = "自定义尺寸关闭时，出图跟随指定参考图的实际宽高；打开时用宽高比+百万像素计算。空图位会自动跳过。"

    @classmethod
    def IS_CHANGED(cls, 尺寸跟随图几, 自定义尺寸, 宽高比, 百万像素, **_kwargs):
        return f"{尺寸跟随图几}|{自定义尺寸}|{宽高比}|{百万像素}"

    def resolve(self, 尺寸跟随图几, 自定义尺寸, 宽高比, 百万像素, **kwargs):
        if 自定义尺寸:
            return calc_resolution(normalize_aspect(宽高比) or DEFAULT_ASPECT, float(百万像素 or 1.0), 32)

        idx = max(1, min(10, int(尺寸跟随图几 or 1)))
        image = kwargs.get(f"image_{idx}")
        if image is not None and hasattr(image, "shape") and len(image.shape) >= 4:
            height, width = int(image.shape[1]), int(image.shape[2])
            return (_snap(width, 32), _snap(height, 32))

        # 跟随的图为空时，回退到宽高比+百万像素，避免报错
        return calc_resolution(normalize_aspect(宽高比) or DEFAULT_ASPECT, float(百万像素 or 1.0), 32)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Edit_Size": feimao_tools_Edit_Size,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Edit_Size": "feimao tools 编辑尺寸（跟随/自定义）",
}
