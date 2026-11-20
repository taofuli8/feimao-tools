"""Pick one image branch and leave the others unevaluated."""

from __future__ import annotations


# Combo value, image socket. Socket order is the node input order.
MODELS = (
    ("MOSS", "MOSS图像"),
    ("千问", "千问图像"),
    ("Krea2", "Krea2图像"),
    ("Z-image", "Z-image图像"),
)


class feimao_tools_Model_Switch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "使用模型": ([name for name, _socket in MODELS], {
                    "default": "MOSS",
                    "tooltip": "只执行当前这一路。没接上的模型不会出现在左侧接口里，也不会出现在开关里。",
                }),
            },
            "optional": {
                socket: ("IMAGE", {"lazy": True})
                for _name, socket in MODELS
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "select"
    CATEGORY = "feimao tools"
    DESCRIPTION = "接上几路，左侧就只显示这几路，开关也只在这几路之间切换。没接上的模型不会执行。四路都接上时仍是 MOSS、千问、Krea2、Z-image。默认 MOSS。"

    @classmethod
    def IS_CHANGED(cls, 使用模型, **_kwargs):
        return str(使用模型)

    def check_lazy_status(self, 使用模型, **kwargs):
        socket = dict(MODELS).get(使用模型)
        if socket and kwargs.get(socket) is None:
            return [socket]
        return []

    def select(self, 使用模型, **kwargs):
        socket = dict(MODELS).get(使用模型)
        if socket is None:
            raise ValueError(f"未知模型：{使用模型}")
        image = kwargs.get(socket)
        if image is None:
            raise ValueError(f"已选择{使用模型}，但「{socket}」没有接上")
        return (image,)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Model_Switch": feimao_tools_Model_Switch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Model_Switch": "feimao tools 使用模型",
}
