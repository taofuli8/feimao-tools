"""Pick one upscale branch and leave the other unevaluated."""

from __future__ import annotations


# Combo value, image socket. Socket order is the node input order.
FLOWS = (
    ("VOSR2", "VOSR2图像"),
    ("SeedVR2", "SeedVR2图像"),
)


class feimao_tools_Upscale_Switch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "使用放大": ([name for name, _socket in FLOWS], {"default": "VOSR2"}),
            },
            "optional": {
                socket: ("IMAGE", {"lazy": True})
                for _name, socket in FLOWS
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "select"
    CATEGORY = "feimao tools"
    DESCRIPTION = "VOSR2 和 SeedVR2 都接上，只执行当前选中的放大流。默认 VOSR2。"

    @classmethod
    def IS_CHANGED(cls, 使用放大, **_kwargs):
        return str(使用放大)

    def check_lazy_status(self, 使用放大, **kwargs):
        socket = dict(FLOWS).get(使用放大)
        if socket and kwargs.get(socket) is None:
            return [socket]
        return []

    def select(self, 使用放大, **kwargs):
        socket = dict(FLOWS).get(使用放大)
        if socket is None:
            raise ValueError(f"未知放大流：{使用放大}")
        image = kwargs.get(socket)
        if image is None:
            raise ValueError(f"已选择{使用放大}，但「{socket}」没有接上")
        return (image,)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Upscale_Switch": feimao_tools_Upscale_Switch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Upscale_Switch": "feimao tools 使用放大",
}
