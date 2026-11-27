"""feimao tools — 自研节点的唯一家（权威完整版）。

这里收齐全部自研节点：图像工具、YuE2 音乐创作、CosyVoice3 配音、语音/字幕
批处理（speech）。所有分享包都必须使用这一份，禁止各带阉割版同名文件夹，
否则安装时互相覆盖会导致节点丢失。

每个模块都做容错导入：某模块因缺依赖加载失败时只跳过该模块并在控制台打印
原因，绝不影响其它节点（尤其是 YuE2MusicCreate / 配音节点）注册。
"""

import importlib

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def _safe_register(module_name):
    try:
        mod = importlib.import_module("." + module_name, __name__)
    except Exception as exc:  # noqa: BLE001 - 容错导入是本文件设计核心
        print(f"[feimao_tools] 跳过 {module_name}：{exc}")
        return
    NODE_CLASS_MAPPINGS.update(getattr(mod, "NODE_CLASS_MAPPINGS", {}) or {})
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(mod, "NODE_DISPLAY_NAME_MAPPINGS", {}) or {})


# 图像 / 通用工具
for _m in (
    "nodes_batch_prompt",
    "nodes_model_switch",
    "nodes_save_image",
    "nodes_upscale_switch",
    "nodes_resolution",
    "nodes_model_compare",
    "nodes_moss_box",
    "nodes_image_prompt",
    "nodes_image_reverse",
    "nodes_scale",
    "nodes_edit_size",
    "nodes_board",
    "nodes_preset_prompt",
):
    _safe_register(_m)

# 音频：YuE2 音乐 + CosyVoice3 配音
_safe_register("nodes_yue2")
_safe_register("nodes_cosyvoice_solo")
_safe_register("nodes_audio_clip")

# speech：批量语音 / 字幕 / 素材工具
_safe_register("speech")

# 路由注册（失败不影响节点）
try:
    from . import routes as _routes  # noqa: F401
except Exception:
    _routes = None

try:
    from .speech.media import register_routes as _speech_routes
    from .speech.segment import register_segment_routes as _segment_routes
    _speech_routes()
    _segment_routes()
except Exception:
    pass

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
