"""HTTP helpers for feimao tools."""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import shutil
from pathlib import Path

try:
    from aiohttp import web
    import folder_paths
    from server import PromptServer
except Exception:
    PromptServer = None

_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_\-]+")
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def _under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def _gallery_dir() -> Path:
    try:
        base = Path(folder_paths.get_user_directory())
    except Exception:
        base = Path(folder_paths.get_output_directory()) / "TE_MAN_Pro_user"
    path = base / "TE_MAN_Pro"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _gallery_path(node_id: str) -> Path:
    safe = _SAFE_ID_RE.sub("_", str(node_id or "default"))[:80] or "default"
    return _gallery_dir() / f"gallery_{safe}.json"


def _prompts_path(node_id: str) -> Path:
    safe = _SAFE_ID_RE.sub("_", str(node_id or "default"))[:80] or "default"
    return _gallery_dir() / f"prompts_{safe}.json"


def _pick_directory_sync(initial: str = "") -> str:
    """Open a native folder dialog (Windows/macOS/Linux via tkinter)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError(f"tkinter unavailable: {exc}") from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass
    try:
        root.lift()
        root.focus_force()
    except Exception:
        pass

    start = str(initial or "").strip()
    if start in ("默认", "default", "Default"):
        start = ""
    if start and not Path(start).is_dir():
        start = str(Path(start).parent) if Path(start).parent.is_dir() else ""
    if not start:
        try:
            start = folder_paths.get_output_directory()
        except Exception:
            start = str(Path.home())

    path = filedialog.askdirectory(parent=root, initialdir=start, title="选择保存目录", mustexist=True)
    try:
        root.destroy()
    except Exception:
        pass
    return str(path or "")


def _resolve_source_image(data: dict) -> Path:
    abs_path = str((data or {}).get("abs_path") or "").strip()
    if abs_path:
        path = Path(abs_path)
        if path.is_file() and path.suffix.lower() in _IMAGE_EXTS:
            return path

    filename = Path(str((data or {}).get("filename") or "").strip()).name
    if not filename or Path(filename).suffix.lower() not in _IMAGE_EXTS:
        raise FileNotFoundError("找不到这张图片")
    subfolder = str((data or {}).get("subfolder") or "").replace("\\", "/").strip("/")
    if ".." in Path(subfolder).parts:
        raise FileNotFoundError("找不到这张图片")
    kind = str((data or {}).get("type") or "output")
    bases = {
        "input": folder_paths.get_input_directory(),
        "output": folder_paths.get_output_directory(),
        "temp": folder_paths.get_temp_directory(),
    }
    base = Path(bases.get(kind) or bases["output"]).resolve()
    path = (base / subfolder / filename).resolve() if subfolder else (base / filename).resolve()
    if not _under(path, base) or not path.is_file():
        raise FileNotFoundError("找不到这张图片")
    return path


def _pick_save_file_sync(initial: str, suggested: str, fallback_dir: str) -> str:
    """Open a native Save As dialog and return the chosen path."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError(f"tkinter unavailable: {exc}") from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass
    try:
        root.lift()
        root.focus_force()
    except Exception:
        pass

    start = str(initial or "").strip()
    if start in ("默认", "default", "Default"):
        start = ""
    if start and not Path(start).is_dir():
        parent = Path(start).parent
        start = str(parent) if parent.is_dir() else ""
    if not start:
        start = fallback_dir if fallback_dir and Path(fallback_dir).is_dir() else ""
    if not start:
        try:
            start = folder_paths.get_output_directory()
        except Exception:
            start = str(Path.home())

    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(suggested or "图片.png")).strip(" .") or "图片.png"
    path = filedialog.asksaveasfilename(
        parent=root,
        initialdir=start,
        initialfile=name,
        title="图片另存为",
        defaultextension=".png",
        filetypes=[
            ("PNG 图片", "*.png"),
            ("JPEG 图片", "*.jpg;*.jpeg"),
            ("WebP 图片", "*.webp"),
            ("BMP 图片", "*.bmp"),
            ("所有文件", "*.*"),
        ],
    )
    try:
        root.destroy()
    except Exception:
        pass
    return str(path or "")


def _write_image_copy(source: Path, dest: Path) -> Path:
    if dest.suffix.lower() not in _IMAGE_EXTS:
        dest = dest.with_suffix(".png")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.resolve() == source.resolve():
        return dest
    ext = dest.suffix.lower()
    if ext == source.suffix.lower():
        shutil.copy2(source, dest)
        return dest
    from PIL import Image

    img = Image.open(source)
    try:
        if ext in {".jpg", ".jpeg"}:
            img.convert("RGB").save(dest, "JPEG", quality=95)
        elif ext == ".webp":
            img.save(dest, "WEBP", quality=95)
        elif ext == ".bmp":
            img.convert("RGB").save(dest, "BMP")
        else:
            img.save(dest, "PNG")
    finally:
        img.close()
    return dest


def register_routes():
    if PromptServer is None or getattr(PromptServer, "instance", None) is None:
        return

    @PromptServer.instance.routes.post("/feimao/prompt_image/delete")
    async def delete_prompt_image(request):
        """Delete one picture this node uploaded. Only its own private folder."""
        try:
            data = await request.json()
        except Exception:
            data = {}
        name = Path(str((data or {}).get("filename") or "")).name
        sub = str((data or {}).get("subfolder") or "").replace("\\", "/").strip("/")
        if sub != "feimao_prompt" or not name.startswith("feimao_"):
            return web.json_response({"success": False, "error": "forbidden"}, status=403)
        if Path(name).suffix.lower() not in _IMAGE_EXTS:
            return web.json_response({"success": False, "error": "forbidden"}, status=403)
        path = (Path(folder_paths.get_input_directory()) / sub / name).resolve()
        root = (Path(folder_paths.get_input_directory()) / "feimao_prompt").resolve()
        if not _under(path, root):
            return web.json_response({"success": False, "error": "forbidden"}, status=403)
        if path.is_file():
            try:
                path.unlink()
            except Exception as exc:
                return web.json_response({"success": False, "error": str(exc)}, status=500)
        return web.json_response({"success": True})

    @PromptServer.instance.routes.post("/te_man_pro/delete_image")
    async def delete_image(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"success": False, "error": "invalid json"}, status=400)

        path = Path(str(data.get("path") or "")).resolve()
        if not path.is_file():
            return web.json_response({"success": False, "error": "missing"}, status=404)

        roots = [
            Path(folder_paths.get_output_directory()),
            Path(folder_paths.get_input_directory()),
            Path(folder_paths.get_temp_directory()),
        ]
        if not any(_under(path, root) for root in roots if root.exists()):
            return web.json_response({"success": False, "error": "forbidden"}, status=403)

        try:
            os.remove(path)
            txt = path.with_suffix(".txt")
            if txt.is_file():
                os.remove(txt)
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=500)
        return web.json_response({"success": True})

    @PromptServer.instance.routes.post("/te_man_pro/pick_directory")
    async def pick_directory(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        initial = str((data or {}).get("initial") or "")
        try:
            path = await asyncio.to_thread(_pick_directory_sync, initial)
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc), "path": ""}, status=500)
        return web.json_response({"success": bool(path), "path": path})

    @PromptServer.instance.routes.post("/te_man_pro/save_as")
    async def save_as(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        try:
            source = _resolve_source_image(data or {})
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=404)
        suggested = str((data or {}).get("suggested") or source.name)
        try:
            chosen = await asyncio.to_thread(
                _pick_save_file_sync,
                str((data or {}).get("initial") or ""),
                suggested,
                str(source.parent),
            )
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc), "path": ""}, status=500)
        if not chosen:
            return web.json_response({"success": False, "cancelled": True, "path": ""})
        try:
            saved = await asyncio.to_thread(_write_image_copy, source, Path(chosen))
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=500)
        return web.json_response({"success": True, "path": str(saved)})

    @PromptServer.instance.routes.post("/te_man_pro/gallery_save")
    async def gallery_save(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"success": False, "error": "invalid json"}, status=400)
        node_id = str((data or {}).get("node_id") or "default")
        gallery = (data or {}).get("gallery")
        if gallery is None:
            return web.json_response({"success": False, "error": "missing gallery"}, status=400)
        path = _gallery_path(node_id)
        try:
            path.write_text(json.dumps(gallery, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=500)
        return web.json_response({"success": True, "path": str(path)})

    @PromptServer.instance.routes.get("/te_man_pro/gallery_load")
    async def gallery_load(request):
        node_id = str(request.rel_url.query.get("node_id") or "default")
        path = _gallery_path(node_id)
        try:
            if path.is_file():
                gallery = json.loads(path.read_text(encoding="utf-8"))
                return web.json_response({"success": True, "gallery": gallery, "source": "node"})
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc), "gallery": {}}, status=500)
        return web.json_response({"success": True, "gallery": {}, "source": "empty"})

    @PromptServer.instance.routes.post("/te_man_pro/prompts_save")
    async def prompts_save(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"success": False, "error": "invalid json"}, status=400)
        node_id = str((data or {}).get("node_id") or "default")
        payload = (data or {}).get("prompts")
        if payload is None:
            return web.json_response({"success": False, "error": "missing prompts"}, status=400)
        path = _prompts_path(node_id)
        try:
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            (_gallery_dir() / "prompts_latest.json").write_text(
                json.dumps({"node_id": node_id, "prompts": payload}, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=500)
        return web.json_response({"success": True, "path": str(path)})

    @PromptServer.instance.routes.get("/te_man_pro/prompts_load")
    async def prompts_load(request):
        node_id = str(request.rel_url.query.get("node_id") or "default")
        path = _prompts_path(node_id)
        try:
            if path.is_file():
                payload = json.loads(path.read_text(encoding="utf-8"))
                return web.json_response({"success": True, "prompts": payload, "source": "node"})
            latest = _gallery_dir() / "prompts_latest.json"
            if latest.is_file():
                data = json.loads(latest.read_text(encoding="utf-8"))
                return web.json_response(
                    {
                        "success": True,
                        "prompts": data.get("prompts") or {},
                        "source": "latest",
                    }
                )
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc), "prompts": {}}, status=500)
        return web.json_response({"success": True, "prompts": {}, "source": "empty"})

    def _list_images_sync(folder: str) -> list[dict]:
        root = Path(str(folder or "")).expanduser()
        if not root.is_dir():
            raise ValueError("不是有效文件夹")
        files: list[Path] = []
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in _IMAGE_EXTS:
                continue
            files.append(path)
            if len(files) >= 500:
                break
        items = []
        try:
            from PIL import Image
        except Exception as exc:
            raise ValueError(f"无法读取图片: {exc}") from exc
        for path in files:
            try:
                with Image.open(path) as img:
                    width, height = img.size
            except Exception:
                continue
            items.append(
                {
                    "filename": path.name,
                    "subfolder": "",
                    "type": "absolute",
                    "asset_name": path.stem,
                    "source_name": path.stem,
                    "prompt": "",
                    "abs_path": str(path),
                    "width": int(width),
                    "height": int(height),
                }
            )
        return items

    @PromptServer.instance.routes.post("/te_man_pro/list_images")
    async def list_images(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        folder = str((data or {}).get("path") or "")
        try:
            items = await asyncio.to_thread(_list_images_sync, folder)
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc), "items": []}, status=400)
        return web.json_response({"success": True, "items": items, "count": len(items)})

    @PromptServer.instance.routes.get("/te_man_pro/view_image")
    async def view_image(request):
        raw = str(request.query.get("path") or "")
        path = Path(raw)
        if path.suffix.lower() not in _IMAGE_EXTS or not path.is_file():
            return web.json_response({"error": "forbidden"}, status=403)
        return web.FileResponse(path)

    @PromptServer.instance.routes.post("/te_man_pro/save_png")
    async def save_png(request):
        try:
            data = await request.post()
        except Exception:
            return web.json_response({"success": False, "error": "invalid form"}, status=400)

        upload = data.get("image")
        if upload is None or not hasattr(upload, "file"):
            return web.json_response({"success": False, "error": "missing image"}, status=400)
        location = str(data.get("save_location") or "默认").strip()
        stem = str(data.get("filename") or "拼接").strip() or "拼接"
        stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", stem).strip(" .") or "拼接"

        try:
            from PIL import Image

            raw = upload.file.read()
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
        except Exception as exc:
            return web.json_response({"success": False, "error": f"bad image: {exc}"}, status=400)

        if not location or location in ("默认", "default", "Default"):
            save_dir = Path(folder_paths.get_output_directory())
        else:
            save_dir = Path(location)
            if not save_dir.is_absolute():
                return web.json_response({"success": False, "error": "保存位置必须是绝对目录"}, status=400)
        try:
            save_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=500)

        out_path = save_dir / f"{stem}.png"
        n = 2
        while out_path.exists():
            out_path = save_dir / f"{stem}_{n}.png"
            n += 1
        try:
            img.save(out_path, "PNG")
        except Exception as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=500)

        output_root = Path(folder_paths.get_output_directory()).resolve()
        try:
            rel = out_path.resolve().relative_to(output_root)
            subfolder = "" if rel.parent == Path(".") else str(rel.parent).replace("\\", "/")
            filename = rel.name
        except ValueError:
            mirror = output_root / "TE_MAN_Pro_preview"
            mirror.mkdir(parents=True, exist_ok=True)
            mirror_path = mirror / out_path.name
            img.save(mirror_path, "PNG")
            subfolder = "TE_MAN_Pro_preview"
            filename = mirror_path.name

        return web.json_response(
            {
                "success": True,
                "item": {
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": "output",
                    "asset_name": out_path.stem,
                    "source_name": stem,
                    "prompt": "",
                    "abs_path": str(out_path),
                    "width": int(img.width),
                    "height": int(img.height),
                },
            }
        )


try:
    register_routes()
except Exception:
    pass