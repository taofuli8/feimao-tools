"""feimao画板：外补、羽化涂色，再按百万像素和倍数得到最终宽高。"""

from __future__ import annotations

import math
import json
import re

import comfy.utils
import numpy as np
import torch

COLORS = {
    "纯红": (1.0, 0.0, 0.0),
    "纯绿": (0.0, 1.0, 0.0),
    "纯蓝": (0.0, 0.0, 1.0),
}
COLOR_NAMES = ("纯红", "纯绿", "纯蓝", "自动", "自定义")
MODES = ("外补", "遮罩", "通用")
PRESETS = ("自由", "9:16", "16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "跟随参考图")
PAD_MAX = 16384


def final_size(width: int, height: int, megapixels: float, multiple: int) -> tuple[int, int]:
    """与缩放实现同一套取整：先按百万像素，再对齐倍数。"""
    width = max(1, int(width))
    height = max(1, int(height))
    total = int(float(megapixels) * 1024 * 1024)
    scale_by = math.sqrt(total / (width * height))
    width = max(1, int(round(width * scale_by)))
    height = max(1, int(round(height * scale_by)))
    multiple = int(multiple)
    if multiple <= 1:
        return width, height
    target_w = (width // multiple) * multiple
    target_h = (height // multiple) * multiple
    if target_w <= 0 or target_h <= 0 or (target_w == width and target_h == height):
        return width, height
    return target_w, target_h


def _feather_mask(height, width, left, top, right, bottom, feather, device, dtype):
    canvas_h = height + top + bottom
    canvas_w = width + left + right
    mask = torch.ones((canvas_h, canvas_w), device=device, dtype=dtype)
    inner = torch.zeros((height, width), device=device, dtype=dtype)
    if feather > 0 and feather * 2 < height and feather * 2 < width:
        ys = torch.arange(height, device=device)
        xs = torch.arange(width, device=device)
        full_h = torch.full((height,), height, device=device)
        full_w = torch.full((width,), width, device=device)
        dt = ys if top else full_h
        db = (height - ys) if bottom else full_h
        dl = xs if left else full_w
        dr = (width - xs) if right else full_w
        distance = torch.minimum(dt[:, None], db[:, None])
        distance = torch.minimum(distance, dl[None, :])
        distance = torch.minimum(distance, dr[None, :])
        close = distance < feather
        fade = ((feather - distance.to(dtype)) / float(feather)).square()
        inner = torch.where(close, fade, inner)
    mask[top : top + height, left : left + width] = inner
    return mask


def _paint(image, left, top, right, bottom, feather, rgb):
    batch, height, width, channels = image.shape
    device, dtype = image.device, image.dtype
    color = torch.zeros((channels,), device=device, dtype=dtype)
    count = min(3, channels)
    color[:count] = torch.tensor(rgb[:count], device=device, dtype=dtype)
    if channels >= 4:
        color[3] = 1
    canvas_h = height + top + bottom
    canvas_w = width + left + right
    canvas = color.view(1, 1, 1, channels).expand(batch, canvas_h, canvas_w, channels).clone()
    mask = _feather_mask(height, width, left, top, right, bottom, feather, device, dtype)
    alpha = mask[top : top + height, left : left + width].view(1, height, width, 1)
    painted = image.to(dtype=dtype) * (1 - alpha) + color.view(1, 1, 1, channels) * alpha
    canvas[:, top : top + height, left : left + width] = painted
    return canvas, mask.unsqueeze(0).expand(batch, -1, -1).clone()


def _bchw(tensor):
    if tensor.ndim == 4:
        return tensor.movedim(-1, 1), True
    if tensor.ndim == 3:
        return tensor.unsqueeze(1), False
    raise ValueError("图像尺寸无法识别")


def _from_bchw(tensor, is_image):
    if is_image:
        return tensor.movedim(1, -1)
    return tensor.squeeze(1)


def _scale_total_pixels(tensor, megapixels):
    samples, is_image = _bchw(tensor)
    total = int(float(megapixels) * 1024 * 1024)
    scale_by = math.sqrt(total / (samples.shape[-1] * samples.shape[-2]))
    width = max(1, int(round(samples.shape[-1] * scale_by)))
    height = max(1, int(round(samples.shape[-2] * scale_by)))
    scaled = comfy.utils.common_upscale(samples, width, height, "area", "disabled")
    return _from_bchw(scaled, is_image)


def _scale_to_multiple(tensor, multiple):
    multiple = int(multiple)
    if multiple <= 1:
        return tensor
    if tensor.ndim == 4:
        _, height, width, _ = tensor.shape
    else:
        _, height, width = tensor.shape
    target_w = (width // multiple) * multiple
    target_h = (height // multiple) * multiple
    if target_w <= 0 or target_h <= 0 or (target_w == width and target_h == height):
        return tensor
    if target_w / width >= target_h / height:
        scaled_w = target_w
        scaled_h = max(target_h, int(math.ceil(height * target_w / width)))
    else:
        scaled_h = target_h
        scaled_w = max(target_w, int(math.ceil(width * target_h / height)))
    samples, is_image = _bchw(tensor)
    scaled = comfy.utils.common_upscale(samples, scaled_w, scaled_h, "area", "disabled")
    scaled = _from_bchw(scaled, is_image)
    x0 = (scaled_w - target_w) // 2
    y0 = (scaled_h - target_h) // 2
    if is_image:
        return scaled[:, y0 : y0 + target_h, x0 : x0 + target_w, :]
    return scaled[:, y0 : y0 + target_h, x0 : x0 + target_w]


def _resize(tensor, megapixels, multiple):
    return _scale_to_multiple(_scale_total_pixels(tensor, megapixels), multiple)


def _ratio_pair(name):
    text = str(name or "").strip()
    if text not in PRESETS or text in ("自由", "自定义") or ":" not in text:
        return None
    left, right = text.split(":", 1)
    try:
        width = int(left)
        height = int(right)
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def _output_size(megapixels, multiple, ratio_w, ratio_h):
    """按宽高比、百万像素和倍数得到输出宽高，不改图像内容。"""
    total = max(1, int(float(megapixels) * 1024 * 1024))
    scale = math.sqrt(total / (ratio_w * ratio_h))
    width = max(1, int(round(ratio_w * scale)))
    height = max(1, int(round(ratio_h * scale)))
    multiple = int(multiple)
    if multiple <= 1:
        return width, height
    return max(multiple, (width // multiple) * multiple), max(multiple, (height // multiple) * multiple)


def _scale_image(image, scale):
    scale = float(scale or 1)
    if abs(scale - 1) < 1e-4:
        return image
    _, height, width, _ = image.shape
    target_w = max(1, int(round(width * scale)))
    target_h = max(1, int(round(height * scale)))
    if target_w == width and target_h == height:
        return image
    samples = image.movedim(-1, 1)
    method = "lanczos" if scale >= 1 else "area"
    scaled = comfy.utils.common_upscale(samples, target_w, target_h, method, "disabled")
    return scaled.movedim(1, -1)


def _match_mask(mask, image):
    batch, height, width, _ = image.shape
    if mask is None:
        return torch.zeros((batch, height, width), device=image.device, dtype=image.dtype)
    if not isinstance(mask, torch.Tensor):
        raise ValueError("遮罩无法识别")
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    mask = mask.to(device=image.device, dtype=image.dtype)
    if tuple(mask.shape[-2:]) != (height, width):
        mask = torch.nn.functional.interpolate(mask.unsqueeze(1).float(), size=(height, width), mode="nearest").squeeze(1)
        mask = mask.to(dtype=image.dtype)
    if mask.shape[0] == 1 and batch > 1:
        mask = mask.expand(batch, -1, -1)
    elif mask.shape[0] < batch:
        mask = mask.repeat((batch + mask.shape[0] - 1) // mask.shape[0], 1, 1)[:batch]
    elif mask.shape[0] > batch:
        mask = mask[:batch]
    return mask


def _fill_holes(mask):
    try:
        from scipy.ndimage import binary_fill_holes
    except Exception:
        return mask
    planes = mask.detach().float().cpu().numpy()
    filled = np.stack([binary_fill_holes(plane > 0.5) for plane in planes]).astype(np.float32)
    return torch.from_numpy(filled).to(device=mask.device, dtype=mask.dtype)


def _color_tensor(channels, rgb, device, dtype):
    color = torch.zeros((channels,), device=device, dtype=dtype)
    count = min(3, channels)
    color[:count] = torch.tensor(rgb[:count], device=device, dtype=dtype)
    if channels >= 4:
        color[3] = 1
    return color


_PAINTED_FILE = re.compile(r"clipspace-painted(?:-masked)?-(\d+)\.png", re.IGNORECASE)


def _paint_reference(text):
    """编辑器把笔刷单独存成 clipspace-paint，成品图本身是不透明的。"""
    match = _PAINTED_FILE.search(text)
    if not match:
        return None
    return _PAINTED_FILE.sub(f"clipspace-paint-{match.group(1)}.png", text, count=1)


def _alpha_mask(text, invert):
    import folder_paths
    from PIL import Image, ImageOps

    path = folder_paths.get_annotated_filepath(text)
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        if "A" not in img.getbands():
            return None
        alpha = np.asarray(img.getchannel("A"), dtype=np.float32) / 255.0
    values = 1.0 - alpha if invert else alpha
    if float(values.max()) <= 1.0 / 255.0:
        return None
    return torch.from_numpy(np.ascontiguousarray(values)).unsqueeze(0)


def _mask_from_file(name):
    text = str(name or "").strip()
    if not text:
        return None
    paint = _paint_reference(text)
    if paint:
        try:
            mask = _alpha_mask(paint, invert=False)
        except Exception:
            mask = None
        if mask is not None:
            return mask
    try:
        return _alpha_mask(text, invert=True)
    except Exception as error:
        raise ValueError(f"找不到遮罩图像：{text}") from error


def _parse_hex(text):
    raw = str(text or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return COLORS["纯蓝"]
    try:
        value = int(raw, 16)
    except ValueError:
        return COLORS["纯蓝"]
    return ((value >> 16) & 255) / 255.0, ((value >> 8) & 255) / 255.0, (value & 255) / 255.0


def _resolve_rgb(name, custom):
    if str(name) == "自定义":
        return _parse_hex(custom)
    return COLORS.get(str(name), COLORS["纯蓝"])


def _seam_color(image, mask):
    """遮罩最左侧接缝外侧的颜色。同一列有多处时取中间那一处。"""
    if not isinstance(image, torch.Tensor) or image.ndim != 4 or mask is None:
        return None
    plane = mask[0] > 0.5
    if not bool(plane.any()):
        return None
    height, width = int(plane.shape[0]), int(plane.shape[1])
    on = plane.detach().cpu().numpy()
    pixels = image[0].detach().float().cpu().numpy()
    channels = int(pixels.shape[-1])
    for x in range(width):
        rows = np.flatnonzero(on[:, x])
        if rows.size == 0:
            continue
        picked = []
        for y in rows.tolist():
            left = x > 0 and not on[y, x - 1]
            up = y > 0 and not on[y - 1, x]
            down = y + 1 < height and not on[y + 1, x]
            right = x + 1 < width and not on[y, x + 1]
            if left:
                sx, sy = x - 1, y
            elif up:
                sx, sy = x, y - 1
            elif down:
                sx, sy = x, y + 1
            elif right:
                sx, sy = x + 1, y
            else:
                continue
            picked.append((y, pixels[sy, sx]))
        if not picked:
            continue
        picked.sort(key=lambda item: item[0])
        color = picked[len(picked) // 2][1]
        if channels <= 1:
            value = float(color.reshape(-1)[0])
            return (value, value, value)
        flat = color.reshape(-1)
        return tuple(float(flat[index]) for index in range(min(3, channels)))
    return None


def _parse_shape(data):
    if not isinstance(data, dict):
        return None
    kind = data.get("kind")
    if kind not in ("rect", "ellipse"):
        return None
    try:
        x, y, w, h = (float(data.get(key, 0)) for key in ("x", "y", "w", "h"))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    x = min(1.0, max(0.0, x))
    y = min(1.0, max(0.0, y))
    w = min(1.0 - x, max(0.0, w))
    h = min(1.0 - y, max(0.0, h))
    if w <= 0 or h <= 0:
        return None
    return kind, x, y, w, h


def _parse_strokes(data):
    strokes = []
    if not isinstance(data, dict):
        return strokes
    raw = data.get("strokes")
    if not isinstance(raw, list):
        return strokes
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            radius = float(item.get("r", 0))
        except (TypeError, ValueError):
            continue
        if radius <= 0:
            continue
        points = []
        for point in item.get("pts") or []:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                px = min(1.0, max(0.0, float(point[0])))
                py = min(1.0, max(0.0, float(point[1])))
            except (TypeError, ValueError):
                continue
            points.append((px, py))
        if points:
            strokes.append((min(radius, 2.0), points))
    return strokes


def _fill_binary(plane):
    height, width = plane.shape
    seen = np.zeros((height, width), dtype=bool)
    stack = []

    def push(x, y):
        if x < 0 or y < 0 or x >= width or y >= height or seen[y, x] or plane[y, x]:
            return
        seen[y, x] = True
        stack.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)
    while stack:
        x, y = stack.pop()
        push(x - 1, y)
        push(x + 1, y)
        push(x, y - 1)
        push(x, y + 1)
    return np.where(seen, plane, True)


def _raster_strokes(height, width, strokes, close):
    if not strokes:
        return None
    plane = np.zeros((height, width), dtype=bool)
    for radius, points in strokes:
        rad = max(0.5, float(radius) * width)
        rad2 = rad * rad
        coords = [(points[0][0] * width, points[0][1] * height)]
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            px0, py0 = x0 * width, y0 * height
            px1, py1 = x1 * width, y1 * height
            dist = math.hypot(px1 - px0, py1 - py0)
            steps = max(1, int(math.ceil(dist / max(0.75, rad * 0.45))))
            for step in range(1, steps + 1):
                t = step / steps
                coords.append((px0 + (px1 - px0) * t, py0 + (py1 - py0) * t))
        for cx, cy in coords:
            left = max(0, int(math.floor(cx - rad)))
            right = min(width, int(math.ceil(cx + rad)) + 1)
            top = max(0, int(math.floor(cy - rad)))
            bottom = min(height, int(math.ceil(cy + rad)) + 1)
            if left >= right or top >= bottom:
                continue
            ys = np.arange(top, bottom, dtype=np.float32)[:, None] + 0.5
            xs = np.arange(left, right, dtype=np.float32)[None, :] + 0.5
            plane[top:bottom, left:right] |= (xs - cx) ** 2 + (ys - cy) ** 2 <= rad2
    if close:
        try:
            from scipy.ndimage import binary_fill_holes

            plane = binary_fill_holes(plane)
        except Exception:
            plane = _fill_binary(plane)
    return plane


def _parse_rect_ops(data):
    if not isinstance(data, dict):
        return []
    raw = data.get("rects")
    ops = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                x, y, w, h = (float(item.get(key, 0)) for key in ("x", "y", "w", "h"))
            except (TypeError, ValueError):
                continue
            if w <= 0 or h <= 0:
                continue
            x = min(1.0, max(0.0, x))
            y = min(1.0, max(0.0, y))
            w = min(1.0 - x, max(0.0, w))
            h = min(1.0 - y, max(0.0, h))
            if w <= 0 or h <= 0:
                continue
            ops.append((str(item.get("op")) == "sub", x, y, w, h))
        return ops
    shape = _parse_shape(data)
    if shape is not None and shape[0] == "rect":
        _, x, y, w, h = shape
        return [(False, x, y, w, h)]
    return []


def _shape_mask(image, text, close=None):
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    shape = _parse_shape(data)
    ellipse = shape if shape is not None and shape[0] == "ellipse" else None
    rects = _parse_rect_ops(data)
    strokes = _parse_strokes(data)
    if ellipse is None and not rects and not strokes:
        return None
    _, height, width, _ = image.shape
    device, dtype = image.device, image.dtype
    plane = np.zeros((height, width), dtype=bool)
    if ellipse is not None:
        _, x, y, w, h = ellipse
        ys = np.arange(height, dtype=np.float32)[:, None]
        xs = np.arange(width, dtype=np.float32)[None, :]
        x0, x1 = x * width, (x + w) * width
        y0, y1 = y * height, (y + h) * height
        cx = (x0 + x1) * 0.5
        cy = (y0 + y1) * 0.5
        rx = max((x1 - x0) * 0.5, 1e-4)
        ry = max((y1 - y0) * 0.5, 1e-4)
        plane = ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1
    if rects:
        ys = np.arange(height)[:, None]
        xs = np.arange(width)[None, :]
        for subtract, x, y, w, h in rects:
            x0, x1 = x * width, (x + w) * width
            y0, y1 = y * height, (y + h) * height
            region = (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)
            if subtract:
                plane[region] = False
            else:
                plane[region] = True
    use_close = bool(data.get("close")) if close is None else bool(close)
    raster = _raster_strokes(height, width, strokes, use_close)
    if raster is not None:
        plane |= raster
    if not bool(plane.any()):
        return None
    values = torch.from_numpy(np.ascontiguousarray(plane)).to(device=device, dtype=dtype)
    return values.unsqueeze(0)


def _markup(text):
    raw = str(text or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _apply_mask_adjust(mask, text, invert=False):
    """反转在前，橡皮在后，橡皮始终擦掉当前遮罩。"""
    if invert:
        mask = 1 - mask
    data = _markup(text)
    erasers = _parse_strokes({"strokes": data.get("erasers")}) if data else []
    if not erasers:
        return mask
    height, width = int(mask.shape[-2]), int(mask.shape[-1])
    plane = _raster_strokes(height, width, erasers, False)
    if plane is None:
        return mask
    erase = torch.from_numpy(np.ascontiguousarray(plane)).to(device=mask.device, dtype=mask.dtype)
    if erase.ndim == 2:
        erase = erase.unsqueeze(0)
    if erase.shape[0] == 1 and mask.shape[0] > 1:
        erase = erase.expand(mask.shape[0], -1, -1)
    return mask * (1 - erase)


def _paint_mask(image, mask, rgb):
    _, _, _, channels = image.shape
    color = _color_tensor(channels, rgb, image.device, image.dtype)
    alpha = mask.clamp(0, 1).unsqueeze(-1)
    painted = image * (1 - alpha) + color.view(1, 1, 1, channels) * alpha
    return painted.clamp(0, 1), mask


class feimao_tools_Board:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "模式": (list(MODES), {"default": "外补", "tooltip": "外补是四边扩图。遮罩模式涂遮罩。通用模式的宽高比只决定输出的宽和高，不裁切原图。"}),
                "百万像素": ("FLOAT", {"default": 4.0, "min": 0.01, "max": 16.0, "step": 0.01, "tooltip": "缩放开启时，把整张图缩放到这个百万像素。1 约等于 1024×1024。"}),
                "倍数": ("INT", {"default": 32, "min": 1, "max": 256, "step": 1, "tooltip": "缩放开启时，缩放后再把宽高对齐到这个倍数。"}),
                "外补颜色": (list(COLOR_NAMES), {"default": "纯蓝", "tooltip": "外补或遮罩涂上的颜色。自动取遮罩最左侧接缝外侧的颜色。自定义配合取色器。"}),
                "预设": (list(PRESETS), {"default": "自由", "tooltip": "外补时按这个比例调整画框，自由不锁定比例。通用时只决定输出宽高，跟随参考图则按参考图自己的比例。"}),
                "图像缩放": ("FLOAT", {"default": 1.0, "min": 0.05, "max": 8.0, "step": 0.01, "tooltip": "参考图相对原图的放大倍数。画框大小不变。"}),
                "左": ("INT", {"default": 0, "min": 0, "max": PAD_MAX, "step": 1}),
                "右": ("INT", {"default": 0, "min": 0, "max": PAD_MAX, "step": 1}),
                "上": ("INT", {"default": 0, "min": 0, "max": PAD_MAX, "step": 1}),
                "下": ("INT", {"default": 0, "min": 0, "max": PAD_MAX, "step": 1}),
                "羽化": ("INT", {"default": 40, "min": 0, "max": 4096, "step": 1, "tooltip": "原图边缘向内融进外补颜色的像素宽度。遮罩模式不用这项。"}),
            },
            "optional": {
                "遮罩": ("MASK", {"tooltip": "加载图像节点的遮罩。遮罩模式下把这里涂上颜色。"}),
                "image": ("STRING", {"default": "", "tooltip": "遮罩编辑器保存的图像。界面上不显示。"}),
                "自定义颜色": ("STRING", {"default": "#0000ff", "tooltip": "外补颜色选自定义时使用的颜色。"}),
                "框选": ("STRING", {"default": "", "tooltip": "遮罩模式的矩形、圆形、画笔、橡皮和反转。界面上不显示。"}),
                "走缩放": (["开启", "关闭"], {"default": "开启", "tooltip": "开启时，画完后再按百万像素缩放，并把宽高收到倍数，这个尺寸会送给后面的生成节点。关闭时按画板当前宽高原样输出。"}),
                "遮罩闭合": (["关", "开"], {"default": "关", "tooltip": "打开后，画笔围成的封闭区域会自动填满遮罩。"}),
                "遮罩反转": (["关", "开"], {"default": "关", "tooltip": "打开后，遮罩内外对调。再选关就还原。"}),
                "自定义宽": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1, "tooltip": "通用模式打开自定义尺寸后，输出宽度用这个数。"}),
                "自定义高": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1, "tooltip": "通用模式打开自定义尺寸后，输出高度用这个数。"}),
                "自定义尺寸": (["关", "开"], {"default": "关", "tooltip": "通用模式打开后，输出宽高改用填写的宽度和高度，不再按宽高比计算。"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "MASK")
    RETURN_NAMES = ("图像", "宽度", "高度", "遮罩")
    FUNCTION = "expand"
    CATEGORY = "feimao tools"
    DESCRIPTION = "外补模式拖动画框四角和原图。遮罩模式可取色、矩形、圆形、画笔和橡皮。通用模式的宽高比只决定输出宽高，不裁切原图。缩放开启时再按百万像素和倍数缩放图像。"

    def expand(self, 图像, 模式, 百万像素, 倍数, 外补颜色, 预设, 图像缩放, 左, 右, 上, 下, 羽化, 遮罩=None, image="", 自定义颜色="#0000ff", 框选="", 走缩放="开启", 遮罩闭合="关", 遮罩反转="关", 自定义宽=1024, 自定义高=1024, 自定义尺寸="关"):
        if not isinstance(图像, torch.Tensor) or 图像.ndim != 4:
            raise ValueError("需要一张图像")
        megapixels = max(0.01, float(百万像素))
        multiple = max(1, int(倍数))
        output_size = None
        if str(模式) == "通用":
            image = 图像
            mask = torch.zeros((image.shape[0], image.shape[1], image.shape[2]), device=image.device, dtype=image.dtype)
            if str(自定义尺寸) == "开":
                output_size = (max(1, int(自定义宽)), max(1, int(自定义高)))
            else:
                pair = _ratio_pair(预设)
                if pair is not None:
                    output_size = _output_size(megapixels, multiple, pair[0], pair[1])
                elif str(预设) == "跟随参考图":
                    output_size = final_size(int(图像.shape[2]), int(图像.shape[1]), megapixels, multiple)
        elif str(模式) == "遮罩":
            file_mask = _mask_from_file(image)
            mask = _fill_holes(_match_mask(file_mask if file_mask is not None else 遮罩, 图像))
            shape = _shape_mask(图像, 框选, close=str(遮罩闭合) == "开")
            if shape is not None:
                mask = torch.maximum(mask, _match_mask(shape, 图像))
            mask = _apply_mask_adjust(mask, 框选, invert=str(遮罩反转) == "开")
            if str(外补颜色) == "自动":
                rgb = _seam_color(图像, mask) or COLORS["纯蓝"]
            else:
                rgb = _resolve_rgb(外补颜色, 自定义颜色)
            image, mask = _paint_mask(图像, mask, rgb)
        else:
            image = _scale_image(图像, 图像缩放)
            left = max(0, min(PAD_MAX, int(左)))
            right = max(0, min(PAD_MAX, int(右)))
            top = max(0, min(PAD_MAX, int(上)))
            bottom = max(0, min(PAD_MAX, int(下)))
            feather = max(0, int(羽化))
            rgb = _resolve_rgb(外补颜色, 自定义颜色)
            image, mask = _paint(image, left, top, right, bottom, feather, rgb)
        if str(走缩放) != "关闭":
            image = _resize(image, megapixels, multiple)
            mask = _resize(mask, megapixels, multiple)
        if tuple(mask.shape[-2:]) != tuple(image.shape[1:3]):
            mask = torch.nn.functional.interpolate(
                mask.unsqueeze(1),
                size=(image.shape[1], image.shape[2]),
                mode="bilinear",
                align_corners=False,
            ).squeeze(1)
        if output_size is None:
            height = int(image.shape[1])
            width = int(image.shape[2])
        else:
            width, height = output_size
        return (image, width, height, mask)


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Board": feimao_tools_Board,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Board": "feimao画板",
}
