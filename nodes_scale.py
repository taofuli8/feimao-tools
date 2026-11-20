"""Scale reference images by total pixels. An empty input stays empty."""

from __future__ import annotations

import math

import comfy.utils
from comfy_extras.nodes_post_processing import batch_images

METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]


class feimao_tools_Scale_To_Pixels:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "upscale_method": (METHODS, {"default": "lanczos"}),
                "megapixels": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 16.0, "step": 0.01}),
                "resolution_steps": ("INT", {"default": 32, "min": 1, "max": 256, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "scale"
    CATEGORY = "feimao tools"
    DESCRIPTION = "按百万像素缩放参考图。没接到图时原样送出空值，后面的编码会跳过。"

    def scale(self, image, upscale_method, megapixels, resolution_steps):
        if image is None:
            return (None,)
        samples = image.movedim(-1, 1)
        step = max(1, int(resolution_steps))
        total = float(megapixels) * 1024 * 1024
        scale_by = math.sqrt(total / (samples.shape[3] * samples.shape[2]))
        width = round(samples.shape[3] * scale_by / step) * step
        height = round(samples.shape[2] * scale_by / step) * step
        width, height = max(step, int(width)), max(step, int(height))
        scaled = comfy.utils.common_upscale(samples, width, height, upscale_method, "disabled")
        return (scaled.movedim(1, -1),)


class feimao_tools_Batch_Images:
    @classmethod
    def INPUT_TYPES(cls):
        optional = {f"image{index}": ("IMAGE",) for index in range(5)}
        return {"optional": optional}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "batch"
    CATEGORY = "feimao tools"
    DESCRIPTION = "把参考图拼成一批。空着的图片口跳过，不报错。"

    def batch(self, image0=None, image1=None, image2=None, image3=None, image4=None):
        frames = [image for image in (image0, image1, image2, image3, image4) if image is not None]
        if not frames:
            return (None,)
        return (batch_images(frames),)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Scale_To_Pixels": feimao_tools_Scale_To_Pixels,
    "feimao_tools_Batch_Images": feimao_tools_Batch_Images,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Scale_To_Pixels": "feimao tools 缩放图像（像素）",
    "feimao_tools_Batch_Images": "feimao tools 批量图像",
}
