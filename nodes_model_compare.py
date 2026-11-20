"""Run the selected models and merge labeled results into one comparison image."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

# Label, toggle, image socket. Order is the node input order.
MODELS = (
    ("MOSS", "跑MOSS", "MOSS图像", (212, 168, 74)),
    ("千问", "跑千问", "千问图像", (64, 176, 168)),
    ("Krea2", "跑Krea2", "Krea2图像", (86, 140, 220)),
    ("Z-image", "跑Z-image", "Z-image图像", (220, 120, 60)),
    ("MiniMax", "跑MiniMax", "MiniMax图像", (60, 179, 113)),
)

_FONT_FILES = (
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\arial.ttf",
)


def _enabled(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in ("", "0", "false", "no", "off")
    return bool(value)


def _font(size: int) -> ImageFont.ImageFont:
    for path in _FONT_FILES:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _to_pil(image) -> Image.Image:
    tensor = image
    if isinstance(tensor, list):
        tensor = tensor[0]
    if tensor.ndim == 4:
        tensor = tensor[0]
    arr = tensor.detach().cpu().float().clamp(0, 1).numpy()
    arr = (arr * 255.0).round().astype(np.uint8)
    if arr.shape[-1] == 1:
        arr = np.repeat(arr, 3, axis=-1)
    elif arr.shape[-1] > 3:
        arr = arr[..., :3]
    return Image.fromarray(arr, "RGB")


def _to_tensor(image: Image.Image) -> torch.Tensor:
    arr = np.asarray(image.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _image_tensor(image) -> torch.Tensor:
    tensor = image[0] if isinstance(image, list) else image
    if tensor.ndim == 3:
        tensor = tensor.unsqueeze(0)
    tensor = tensor[:1].detach().float().cpu().clamp(0, 1)
    if tensor.shape[-1] > 3:
        tensor = tensor[..., :3]
    elif tensor.shape[-1] == 1:
        tensor = tensor.repeat(1, 1, 1, 3)
    return tensor


def _stack(tensors: list[torch.Tensor]) -> torch.Tensor:
    height = max(tensor.shape[1] for tensor in tensors)
    width = max(tensor.shape[2] for tensor in tensors)
    stacked = []
    for tensor in tensors:
        if tensor.shape[1] == height and tensor.shape[2] == width:
            stacked.append(tensor)
            continue
        canvas = torch.zeros((1, height, width, tensor.shape[-1]), dtype=tensor.dtype)
        canvas[:, : tensor.shape[1], : tensor.shape[2], :] = tensor
        stacked.append(canvas)
    return torch.cat(stacked, dim=0)


def _label(image: Image.Image, text: str, accent: tuple[int, int, int]) -> Image.Image:
    bar = max(40, min(84, image.width // 16))
    canvas = Image.new("RGB", (image.width, image.height + bar), (22, 22, 22))
    canvas.paste(image, (0, bar))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 12, bar), fill=accent)
    font = _font(max(18, bar - 24))
    bbox = draw.textbbox((0, 0), text, font=font)
    text_h = bbox[3] - bbox[1]
    draw.text((24, (bar - text_h) / 2 - bbox[1]), text, fill=(245, 245, 245), font=font)
    return canvas


def _sorted_models(chosen, kwargs):
    labels = [label for label, _toggle, _socket, _color in MODELS]
    rank = {label: index for index, label in enumerate(labels)}
    seen = set()
    for index in range(1, len(labels) + 1):
        name = str(kwargs.get(f"顺序{index}") or "").strip()
        if name in rank and name not in seen:
            rank[name] = len(seen)
            seen.add(name)
    next_rank = len(seen)
    for label in labels:
        if label not in seen:
            rank[label] = next_rank
            next_rank += 1
    return sorted(chosen, key=lambda item: rank.get(item[0], 999))


def _merge(tiles: list[Image.Image], direction: str) -> Image.Image:
    gap = 16
    if direction == "纵向":
        width = max(tile.width for tile in tiles)
        height = sum(tile.height for tile in tiles) + gap * (len(tiles) - 1)
        canvas = Image.new("RGB", (width, height), (16, 16, 16))
        y = 0
        for tile in tiles:
            canvas.paste(tile, ((width - tile.width) // 2, y))
            y += tile.height + gap
        return canvas
    height = max(tile.height for tile in tiles)
    width = sum(tile.width for tile in tiles) + gap * (len(tiles) - 1)
    canvas = Image.new("RGB", (width, height), (16, 16, 16))
    x = 0
    for tile in tiles:
        canvas.paste(tile, (x, (height - tile.height) // 2))
        x += tile.width + gap
    return canvas


class feimao_tools_Model_Compare:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "排列": (["横向", "纵向"], {"default": "横向"}),
            "正常出图": ("BOOLEAN", {"default": False}),
        }
        for _label, toggle, _socket, _color in MODELS:
            required[toggle] = ("BOOLEAN", {"default": True})
        labels = [label for label, _toggle, _socket, _color in MODELS]
        for index, label in enumerate(labels, start=1):
            required[f"顺序{index}"] = (labels, {"default": label})
        return {
            "required": required,
            "optional": {
                socket: ("IMAGE", {"lazy": True})
                for _label, _toggle, socket, _color in MODELS
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "分文件名")
    FUNCTION = "compare"
    CATEGORY = "feimao tools"
    DESCRIPTION = "勾选要跑的模型，默认五个都跑。顺序1到顺序5决定对比图从左到右或从上到下的先后。重复的名字会自动跳过。"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        parts = [str(kwargs.get("排列", "")), str(_enabled(kwargs.get("正常出图", False)))]
        for _label, toggle, _socket, _color in MODELS:
            parts.append(str(_enabled(kwargs.get(toggle, True))))
        for index in range(1, len(MODELS) + 1):
            parts.append(str(kwargs.get(f"顺序{index}", "")))
        return "|".join(parts)

    def check_lazy_status(self, **kwargs):
        pending = []
        for _label, toggle, socket, _color in MODELS:
            if _enabled(kwargs.get(toggle, True)) and kwargs.get(socket) is None:
                pending.append(socket)
        return pending

    def compare(self, **kwargs):
        chosen = []
        for label, toggle, socket, color in MODELS:
            if not _enabled(kwargs.get(toggle, True)):
                continue
            image = kwargs.get(socket)
            if image is None:
                raise ValueError(f"已勾选{label}，但「{socket}」没有接上")
            chosen.append((label, color, image))
        if not chosen:
            raise ValueError("至少勾选一个模型")
        chosen = _sorted_models(chosen, kwargs)

        if _enabled(kwargs.get("正常出图", False)):
            batch = _stack([_image_tensor(image) for _label, _color, image in chosen])
            names = "\n".join(label for label, _color, _image in chosen)
            return (batch, names)

        base = _to_pil(chosen[0][2]).size
        tiles = []
        for label, color, image in chosen:
            picture = _to_pil(image)
            if picture.size != base:
                picture = picture.resize(base, Image.Resampling.LANCZOS)
            tiles.append(_label(picture, label, color))
        direction = str(kwargs.get("排列") or "横向")
        return (_to_tensor(_merge(tiles, direction)), "")


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Model_Compare": feimao_tools_Model_Compare,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Model_Compare": "feimao tools 模型对比",
}
