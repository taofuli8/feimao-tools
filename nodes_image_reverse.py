"""Batch-reverse every uploaded picture into <Picture N> blocks."""

from __future__ import annotations

import re

_FRAME = re.compile(r"={3,}\s*第\s*(\d+)\s*帧\s*={3,}")

DEFAULT_PROMPT = (
    "用中文详细描述这张图的内容：人物、服装、动作、场景、光线和画面风格。"
    "只写这一张图，整段连成一段中文，不要分段，不要换行，不要编号，不要额外说明。"
)
FORMAT_RULE = "输出必须是一整段中文，不要分段，不要换行，不要标题，不要编号。"
_LEADING_TAG = re.compile(r"^\s*<Picture\s+\d+\s*>\s*", re.IGNORECASE)


def _qwen_runner():
    import sys

    for module in list(sys.modules.values()):
        namespace = getattr(module, "__dict__", None)
        runner = namespace.get("QwenTE图像推理") if isinstance(namespace, dict) else None
        if isinstance(runner, type) and callable(getattr(runner, "run", None)):
            return runner
    raise RuntimeError("找不到千问 3.5 VL 图像推理。请确认 comfyUI-llama-TE 已启用。")


def _blank(image) -> bool:
    if image is None:
        return True
    try:
        count = int(image.shape[0])
    except Exception:
        return True
    if count <= 0:
        return True
    if count == 1 and tuple(image.shape[1:3]) == (64, 64):
        try:
            return float(image.detach().max()) == 0.0
        except Exception:
            return False
    return False


def _one_paragraph(text: str) -> str:
    body = _LEADING_TAG.sub("", str(text or "").strip())
    pieces = [piece.strip() for piece in re.split(r"[\r\n]+", body) if piece.strip()]
    return "".join(pieces)


def format_pictures(text: str, count: int) -> str:
    body = str(text or "").strip()
    if not body:
        return ""
    parts = _FRAME.split(body)
    blocks = []
    index = 1
    while index + 1 < len(parts):
        number = int(parts[index])
        content = _one_paragraph(parts[index + 1])
        if content:
            blocks.append(f"<Picture {number}>{content}")
        index += 2
    if blocks:
        return "\n\n".join(blocks)
    paragraph = _one_paragraph(body)
    if not paragraph:
        return ""
    if count <= 1:
        return f"<Picture 1>{paragraph}"
    return f"<Picture 1>{paragraph}"


class feimao_tools_Image_Reverse:
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("反推结果",)
    FUNCTION = "run"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True
    DESCRIPTION = "点开始反推后，按上传顺序把每张图写成一段 <Picture N>内容。组开关关掉时，出图不会跑这一组。"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "qwen模型": ("QWENLLAMA", {"lazy": True}),
                "图片": ("IMAGE", {"lazy": True}),
                "提示词": ("STRING", {"multiline": True, "default": DEFAULT_PROMPT}),
                "结果": ("STRING", {"multiline": True, "default": ""}),
                "本次执行": ("BOOLEAN", {"default": False}),
                "合成提示词": ("STRING", {"forceInput": True, "default": ""}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, qwen模型=None, 图片=None, 提示词="", 结果="", 本次执行=False, 合成提示词=""):
        return float("nan")

    def check_lazy_status(self, 提示词="", 结果="", 本次执行=False, 合成提示词="", qwen模型=None, 图片=None):
        if not 本次执行:
            return []
        needed = []
        if qwen模型 is None:
            needed.append("qwen模型")
        if 图片 is None:
            needed.append("图片")
        return needed

    def run(self, qwen模型=None, 图片=None, 提示词="", 结果="", 本次执行=False, 合成提示词=""):
        if not 本次执行:
            text = str(结果 or "")
        elif _blank(图片):
            text = ""
        else:
            count = int(图片.shape[0])
            ask = str(提示词 or DEFAULT_PROMPT).rstrip() + "\n" + FORMAT_RULE
            raw = _qwen_runner()().run(
                qwen模型,
                "逐帧",
                ask,
                "不需要分析",
                24,
                1024,
                1024,
                0.7,
                0.9,
                20,
                1.0,
                0.0,
                0.0,
                0,
                False,
                True,
                图片=图片,
            )
            source = raw[0] if isinstance(raw, (tuple, list)) else raw
            text = format_pictures(str(source or ""), count)
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Image_Reverse": feimao_tools_Image_Reverse,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Image_Reverse": "feimao tools 批量反推",
}
