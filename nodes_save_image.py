"""feimao tools image nodes: batch load and batch save are separate."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths
from comfy.cli_args import args

from .prompt_parse import default_asset_name, sanitize_asset_name

INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_stem(name: str) -> str:
    cleaned = INVALID_FILENAME_CHARS_RE.sub("_", (name or "").strip())
    cleaned = cleaned.strip(" .")
    return cleaned or default_asset_name(1)


def _unique_png(directory: Path, stem: str) -> Path:
    path = directory / f"{stem}.png"
    if not path.exists():
        return path
    n = 2
    while True:
        path = directory / f"{stem}_{n}.png"
        if not path.exists():
            return path
        n += 1


def _resolve_dir(save_location: str) -> Path:
    text = str(save_location or "").strip()
    if not text or text in ("默认", "default", "Default"):
        return Path(folder_paths.get_output_directory())
    path = Path(text)
    if not path.is_absolute():
        raise ValueError("保存位置必须是绝对目录，例如 F:\\test\\images")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _parse_sources(raw) -> list[dict]:
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except Exception:
        return []
    if isinstance(data, dict):
        data = data.get("items") or []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _source_path(item: dict) -> Path | None:
    abs_path = str(item.get("abs_path") or "").strip()
    if abs_path:
        path = Path(abs_path)
        if path.is_file():
            return path
    name = str(item.get("filename") or "").strip()
    if not name:
        return None
    sub = str(item.get("subfolder") or "").strip().replace("\\", "/").strip("/")
    kind = str(item.get("type") or "input")
    bases = {
        "input": folder_paths.get_input_directory(),
        "output": folder_paths.get_output_directory(),
        "temp": folder_paths.get_temp_directory(),
    }
    base = Path(bases.get(kind, folder_paths.get_input_directory()))
    path = base / sub / name if sub else base / name
    return path if path.is_file() else None


def _load_image_tensor(path: Path):
    img = Image.open(path).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    tensor = torch.from_numpy(arr).unsqueeze(0)
    return tensor, int(img.width), int(img.height)


def _normalize_prefix(value: str) -> str:
    text = str(value or "").strip()
    if not text or text in ("默认", "default", "Default"):
        return ""
    try:
        if "%" in text:
            text = datetime.now().strftime(text)
    except Exception:
        pass
    return text


class feimao_tools_Load_Image:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "gallery_json": ("STRING", {"default": "{}", "multiline": True}),
                "source_json": ("STRING", {"default": "[]", "multiline": True}),
                "source_index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "use_source": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("输出图片", "图片文件名", "编号")
    FUNCTION = "load_image"
    CATEGORY = "feimao tools"
    DESCRIPTION = "批量载入图片，按当前编号输出图片、文件名和编号。"

    @classmethod
    def IS_CHANGED(cls, gallery_json, source_json, source_index, use_source):
        _ = gallery_json
        return f"{source_json}|{int(source_index or 0)}|{bool(use_source)}"

    def load_image(self, gallery_json="{}", source_json="[]", source_index=0, use_source=False):
        _ = gallery_json, use_source
        sources = _parse_sources(source_json)
        if not sources:
            raise ValueError("没有可处理的图片，请先添加图片或文件夹")
        idx = int(source_index or 0)
        if idx < 0 or idx >= len(sources):
            raise ValueError(f"图片编号超出范围（共 {len(sources)} 张）")
        item = sources[idx]
        path = _source_path(item)
        if path is None:
            raise ValueError(f"找不到图片：{item.get('asset_name') or item.get('filename') or idx + 1}")
        source_tensor, _sw, _sh = _load_image_tensor(path)
        source_name = sanitize_asset_name(str(item.get("asset_name") or "")) or path.stem
        return (source_tensor, source_name, str(idx + 1))


class feimao_tools_Save_Image:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filename_prefix": ("STRING", {"default": "默认"}),
                "save_location": ("STRING", {"default": "默认"}),
                "use_filename_prefix": ("BOOLEAN", {"default": False}),
                "enable_save_prompt": ("BOOLEAN", {"default": True}),
                "gallery_json": ("STRING", {"default": "{}", "multiline": True}),
            },
            "optional": {
                "images": ("IMAGE",),
                "保存提示词": ("STRING", {"forceInput": True}),
                "保存文件名": ("STRING", {"forceInput": True}),
                "分文件名": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "feimao tools"
    DESCRIPTION = "保存生成图。文件名可用前缀、保存文件名和分文件名。"

    def save_images(
        self,
        filename_prefix="默认",
        save_location="默认",
        use_filename_prefix=False,
        enable_save_prompt=True,
        gallery_json="{}",
        images=None,
        保存提示词=None,
        保存文件名=None,
        分文件名=None,
        prompt=None,
        extra_pnginfo=None,
    ):
        # gallery_json is UI persistence only; keep signature accepted by Comfy.
        _ = gallery_json
        if images is None:
            raise ValueError("请先连接 images 输入")

        linked_name = sanitize_asset_name(str(保存文件名 or ""))
        prefix = _normalize_prefix(str(filename_prefix or ""))
        core = linked_name or default_asset_name(1)
        if use_filename_prefix and prefix:
            base = _safe_stem(f"{prefix}{core}")
        else:
            base = _safe_stem(core if linked_name else (prefix or core))
        per_name = [
            sanitize_asset_name(line)
            for line in str(分文件名 or "").splitlines()
            if sanitize_asset_name(line)
        ]

        # Always keep prompt for gallery UI; only persist to disk/metadata when switch is on.
        prompt_text = str(保存提示词 or "").strip()
        persist_prompt = bool(enable_save_prompt) and bool(prompt_text)

        frames = list(images)
        named_images = []
        for i, image in enumerate(frames):
            if per_name and len(per_name) == len(frames):
                model_name = per_name[i]
                stem = _safe_stem(f"{base}-{model_name}" if base and base != "默认" else model_name)
            else:
                stem = base if images.shape[0] == 1 else f"{base}_{i + 1:02d}"
            named_images.append((image, stem))
        save_dir = _resolve_dir(save_location)

        results = []
        for image, stem in named_images:
            out_path = _unique_png(save_dir, stem)

            arr = 255.0 * image.detach().cpu().numpy()
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

            metadata = None
            if not args.disable_metadata:
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for key, value in extra_pnginfo.items():
                        metadata.add_text(key, json.dumps(value))
                if persist_prompt:
                    metadata.add_text("te_man_pro_prompt", prompt_text)
                metadata.add_text("te_man_pro_asset_name", stem)

            img.save(out_path, pnginfo=metadata, compress_level=self.compress_level)
            if persist_prompt:
                out_path.with_suffix(".txt").write_text(prompt_text, encoding="utf-8")

            output_root = Path(folder_paths.get_output_directory()).resolve()
            try:
                rel = out_path.resolve().relative_to(output_root)
                subfolder = str(rel.parent).replace("\\", "/") if rel.parent != Path(".") else ""
                filename = rel.name
                image_type = "output"
            except ValueError:
                mirror = output_root / "TE_MAN_Pro_preview"
                mirror.mkdir(parents=True, exist_ok=True)
                mirror_path = mirror / out_path.name
                img.save(mirror_path)
                subfolder = "TE_MAN_Pro_preview"
                filename = mirror_path.name
                image_type = "output"

            results.append(
                {
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": image_type,
                    "asset_name": stem,
                    "source_name": core,
                    "prompt": prompt_text,
                    "abs_path": str(out_path),
                    "width": int(img.width),
                    "height": int(img.height),
                }
            )

        return {"ui": {"te_man_pro_assets": results}}


NODE_CLASS_MAPPINGS = {
    "feimao_tools_Load_Image": feimao_tools_Load_Image,
    "feimao_tools_Save_Image": feimao_tools_Save_Image,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "feimao_tools_Load_Image": "feimao tools 批量加载图像",
    "feimao_tools_Save_Image": "肥猫图片批量保存节点",
}
