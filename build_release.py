"""Build feimao tools as compiled .pyd package (Cython, Python 3.13 / win_amd64)."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "_build_work"
DIST_DIR = ROOT / "dist" / "TE_MAN_Pro"
PKG_NAME = "TE_MAN_Pro"

MODULES = [
    "prompt_parse",
    "nodes_batch_prompt",
    "nodes_save_image",
    "nodes_model_switch",
    "nodes_upscale_switch",
    "nodes_resolution",
    "nodes_model_compare",
    "routes",
]

INIT_PY = '''"""feimao tools — compiled release loader."""

from .nodes_batch_prompt import NODE_CLASS_MAPPINGS as BATCH_MAP
from .nodes_batch_prompt import NODE_DISPLAY_NAME_MAPPINGS as BATCH_NAMES
from .nodes_model_switch import NODE_CLASS_MAPPINGS as SWITCH_MAP
from .nodes_model_switch import NODE_DISPLAY_NAME_MAPPINGS as SWITCH_NAMES
from .nodes_save_image import NODE_CLASS_MAPPINGS as SAVE_MAP
from .nodes_save_image import NODE_DISPLAY_NAME_MAPPINGS as SAVE_NAMES
from .nodes_upscale_switch import NODE_CLASS_MAPPINGS as UPSCALE_MAP
from .nodes_upscale_switch import NODE_DISPLAY_NAME_MAPPINGS as UPSCALE_NAMES
from .nodes_resolution import NODE_CLASS_MAPPINGS as RESOLUTION_MAP
from .nodes_resolution import NODE_DISPLAY_NAME_MAPPINGS as RESOLUTION_NAMES
from .nodes_model_compare import NODE_CLASS_MAPPINGS as COMPARE_MAP
from .nodes_model_compare import NODE_DISPLAY_NAME_MAPPINGS as COMPARE_NAMES

try:
    from . import routes as _routes  # noqa: F401
except Exception as exc:
    print(f"[feimao tools] routes load skipped: {exc}")
    _routes = None

NODE_CLASS_MAPPINGS = {}
NODE_CLASS_MAPPINGS.update(BATCH_MAP)
NODE_CLASS_MAPPINGS.update(SAVE_MAP)
NODE_CLASS_MAPPINGS.update(SWITCH_MAP)
NODE_CLASS_MAPPINGS.update(UPSCALE_MAP)
NODE_CLASS_MAPPINGS.update(RESOLUTION_MAP)
NODE_CLASS_MAPPINGS.update(COMPARE_MAP)

NODE_DISPLAY_NAME_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS.update(BATCH_NAMES)
NODE_DISPLAY_NAME_MAPPINGS.update(SAVE_NAMES)
NODE_DISPLAY_NAME_MAPPINGS.update(SWITCH_NAMES)
NODE_DISPLAY_NAME_MAPPINGS.update(UPSCALE_NAMES)
NODE_DISPLAY_NAME_MAPPINGS.update(RESOLUTION_NAMES)
NODE_DISPLAY_NAME_MAPPINGS.update(COMPARE_NAMES)

WEB_DIRECTORY = "./web"
__version__ = "1.1.0"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]
'''

LICENSE_TXT = """Copyright (c) 2026 feimao tools Author

本项目代码仅供学习和使用。
未经作者书面授权，严禁任何形式的复制、修改、衍生开发及二次发布。
"""

README_TXT = """# feimao tools（编译版）

ComfyUI 批量提示词、多模型对比、按资产名保存图像。

## 要求
- ComfyUI Desktop / Python **3.13**（Windows x64）
- 本包为编译版（`.pyd`），无 Python 业务源码

## 安装
把整个 `TE_MAN_Pro` 文件夹放到 `ComfyUI/custom_nodes/`，重启 ComfyUI。

## 节点
- feimao tools 批量提示词
- feimao tools 批量加载图像
- 肥猫图片批量保存节点
- feimao tools 使用模型
- feimao tools 生图尺寸
- feimao tools 模型对比
- feimao tools 使用放大
"""


def _clean():
    if WORK.exists():
        shutil.rmtree(WORK, ignore_errors=True)
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR, ignore_errors=True)
    for p in ROOT.glob("*.c"):
        p.unlink(missing_ok=True)
    for p in ROOT.glob("*.pyd"):
        p.unlink(missing_ok=True)


def _prepare_sources() -> Path:
    pkg = WORK / PKG_NAME
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / "__init__.py").write_text(INIT_PY, encoding="utf-8")
    for name in MODULES:
        shutil.copy2(ROOT / f"{name}.py", pkg / f"{name}.py")
    # setup.py at WORK root
    setup_py = WORK / "setup.py"
    setup_py.write_text(
        f'''
from setuptools import Extension, setup
from Cython.Build import cythonize

modules = {MODULES!r}
extensions = [
    Extension("{PKG_NAME}." + name, [r"{PKG_NAME}/" + name + ".py"])
    for name in modules
]

setup(
    name="{PKG_NAME}",
    packages=["{PKG_NAME}"],
    ext_modules=cythonize(
        extensions,
        compiler_directives={{
            "language_level": "3",
            "boundscheck": False,
            "wraparound": False,
        }},
        annotate=False,
    ),
    zip_safe=False,
)
''',
        encoding="utf-8",
    )
    return WORK


def _build(work: Path):
    import subprocess

    # build_ext --inplace puts pyd beside the .py inside package
    cmd = [sys.executable, "setup.py", "build_ext", "--inplace"]
    print("RUN:", " ".join(cmd))
    subprocess.check_call(cmd, cwd=str(work))


def _collect():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / "__init__.py").write_text(INIT_PY, encoding="utf-8")
    (DIST_DIR / "LICENSE").write_text(LICENSE_TXT, encoding="utf-8")
    (DIST_DIR / "README.md").write_text(README_TXT, encoding="utf-8")

    pkg = WORK / PKG_NAME
    for name in MODULES:
        hits = sorted(pkg.glob(f"{name}*.pyd"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not hits:
            raise FileNotFoundError(f"missing built pyd for {name} in {pkg}")
        src = hits[0]
        dst = DIST_DIR / f"{name}.pyd"
        shutil.copy2(src, dst)
        print(f"pack {src.name} -> {dst.name} ({dst.stat().st_size} bytes)")

    web_src = ROOT / "web"
    web_dst = DIST_DIR / "web"
    if web_dst.exists():
        shutil.rmtree(web_dst)
    shutil.copytree(web_src, web_dst)

    # sanity: no .py modules except __init__
    leaked = [p.name for p in DIST_DIR.glob("*.py") if p.name != "__init__.py"]
    if leaked:
        raise RuntimeError(f"source leaked into dist: {leaked}")


def main():
    print("Python:", sys.version)
    print("Root:", ROOT)
    _clean()
    work = _prepare_sources()
    _build(work)
    _collect()
    print("OK ->", DIST_DIR)


if __name__ == "__main__":
    main()
