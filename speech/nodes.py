import json
import os
from pathlib import Path
from typing import Union, BinaryIO, Dict, List, Tuple

import numpy as np
import folder_paths
from comfy.utils import ProgressBar

from .media import (
    IMAGE_EXT,
    VIDEO_EXT,
    _read_wav,
    extract_audio_wav,
    list_image_files,
    list_media_files,
    resolve_media_path,
    separate_vocals_wav,
)
from .storyboard import GRID_SHAPE, clock, compose_sheet, grab_frame, plan_by_change, probe_duration
from .subtitle_utils import cues_to_plain, cues_to_srt, render_document, sentences_from_transcriptions


def _whisper_transcriber():
    import nodes as comfy_nodes

    return comfy_nodes.NODE_CLASS_MAPPINGS["FasterWhisperTranscription"]()


class PreviewEditSubtitle:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "subtitle": ("SUBTITLE",),
            },
            "optional": {
                "keep_edits": ("BOOLEAN", {"default": False}),
                "edited_srt": ("STRING", {"default": "", "multiline": True, "placeholder": "跑一次后这里会出现字幕，可直接改"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("SUBTITLE", "STRING")
    RETURN_NAMES = ("subtitle", "srt_text")
    FUNCTION = "preview"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    def preview(self, subtitle, keep_edits=False, edited_srt="", unique_id=None, extra_pnginfo=None):
        text, fmt = _unpack_subtitle(subtitle)
        display = edited_srt.strip() if keep_edits and str(edited_srt).strip() else text
        packed = [display, fmt if fmt in AVAILABLE_SUBTITLE_FORMAT else ".srt"]
        info = extra_pnginfo[0] if isinstance(extra_pnginfo, list) and extra_pnginfo else extra_pnginfo
        uid = unique_id[0] if isinstance(unique_id, list) else unique_id
        if uid is not None and isinstance(info, dict):
            workflow = info.get("workflow") or {}
            node = next((item for item in workflow.get("nodes", []) if str(item.get("id")) == str(uid)), None)
            if node is not None:
                values = list(node.get("widgets_values") or [])
                while len(values) < 2:
                    values.append("")
                values[0] = keep_edits
                values[1] = display
                node["widgets_values"] = values
        return {"ui": {"text": [display]}, "result": (packed, display)}


class SaveSubtitleAs:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "subtitle": ("SUBTITLE",),
                "save_path": ("STRING", {"default": "", "placeholder": "点「另存为」选保存位置"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("output_path",)
    FUNCTION = "save"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    def save(self, subtitle, save_path=""):
        from .media import resolve_save_path

        text, fmt = _unpack_subtitle(subtitle)
        path = resolve_save_path(save_path, fmt)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(text, encoding="utf-8")
        return (path,)


def _unpack_subtitle(subtitle):
    if isinstance(subtitle, (list, tuple)) and len(subtitle) >= 1:
        text = subtitle[0]
        fmt = subtitle[1] if len(subtitle) > 1 else ".srt"
        return str(text), str(fmt or ".srt")
    return str(subtitle or ""), ".srt"


class InputFilePath:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filepath": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "点按钮选文件，或把视频拖到这个节点上",
                    },
                ),
            }
        }

    RETURN_TYPES = ("FILEPATH",)
    RETURN_NAMES = ("filepath",)
    FUNCTION = "load_media"
    CATEGORY = "feimao tools"

    def load_media(self, filepath):
        return (resolve_media_path(filepath),)

    @classmethod
    def IS_CHANGED(cls, filepath, **kwargs):
        try:
            path = resolve_media_path(filepath)
            return f"{path}:{os.path.getmtime(path)}"
        except Exception:
            return str(filepath)

    @classmethod
    def VALIDATE_INPUTS(cls, filepath, **kwargs):
        try:
            resolve_media_path(filepath)
            return True
        except Exception as exc:
            return str(exc)


class ExtractMediaAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filepath": ("FILEPATH",),
            }
        }

    RETURN_TYPES = ("FILEPATH",)
    RETURN_NAMES = ("audio_path",)
    FUNCTION = "extract"
    CATEGORY = "feimao tools"

    def extract(self, filepath):
        return (extract_audio_wav(filepath),)


def _library_files(library) -> list:
    text = str(library or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    files = []
    for item in data:
        raw = item.get("path") if isinstance(item, dict) else item
        raw = str(raw or "").strip().strip('"')
        if raw and Path(raw).is_file():
            files.append(str(Path(raw).resolve()))
    return files


MODE_PRESET = {
    "口播": {"style": "speech", "max_chars": 16, "pause": 0.4, "prompt": ""},
    "音乐": {"style": "lyric", "max_chars": 14, "pause": 0.25, "prompt": "中文歌词，一句歌词一行。"},
    "歌词": {"style": "lyric", "max_chars": 14, "pause": 0.25, "prompt": "中文歌词，一句歌词一行。"},
}


class MediaSource:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": (["单个音视频", "文件夹"],),
                "path": ("STRING", {"default": "", "placeholder": "点按钮选择音频或视频，或选择放了很多文件的文件夹"}),
                "library": ("STRING", {"default": "", "multiline": True}),
            }
        }

    RETURN_TYPES = ("MEDIA_LIST", "STRING")
    RETURN_NAMES = ("media", "summary")
    FUNCTION = "collect"
    CATEGORY = "feimao tools"

    def collect(self, source, path, library=""):
        files = _library_files(library)
        if not files:
            path = (path or "").strip().strip('"')
            if source == "文件夹" and path:
                files = list_media_files(path)
            elif path:
                files = [resolve_media_path(path)]
        if not files:
            raise ValueError("素材库是空的，请先添加音视频")
        names = "\n".join(Path(item).name for item in files)
        summary = f"共 {len(files)} 个\n{names}"
        return (files, summary)

    @classmethod
    def IS_CHANGED(cls, source, path, library="", **kwargs):
        try:
            files = cls().collect(source, path, library)[0]
            return "|".join(f"{item}:{os.path.getmtime(item)}" for item in files)
        except Exception:
            return f"{source}:{path}:{library}"

    @classmethod
    def VALIDATE_INPUTS(cls, source, path, library="", **kwargs):
        try:
            cls().collect(source, path, library)
            return True
        except Exception as exc:
            return str(exc)


class BatchRecognize:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "media": ("MEDIA_LIST",),
                "model": ("FASTERWHISPERMODEL",),
                "mode": (["音乐", "口播"], {"tooltip": "音乐按演唱停顿断句；口播按完整词组断句"}),
                "save_dir": ("STRING", {"default": "", "placeholder": "留空则保存在音视频旁边"}),
                "suffix": (["txt", "srt"], {"tooltip": "保存后缀。默认 txt，选 srt 时内容是带时间轴的字幕"}),
                "text_kind": (["纯文本", "时间轴"], {"tooltip": "txt 时可选。纯文本一行一句；时间轴带开始和结束时间。选 srt 后缀时固定为时间轴"}),
                "max_chars": ("INT", {"default": 14, "min": 4, "max": 40, "step": 1, "tooltip": "一条最多多少字。歌词一般 12 到 16"}),
                "pause": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 2.0, "step": 0.05, "tooltip": "停顿超过这么多秒就换一行。歌词可以设 0.2 到 0.35"}),
                "separate_vocals": ("BOOLEAN", {"default": True, "tooltip": "音乐模式先把伴奏分开，只识别人声。默认开。"}),
            }
        }

    RETURN_TYPES = ("BATCH_DOC", "STRING")
    RETURN_NAMES = ("documents", "report")
    FUNCTION = "run"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    def run(self, media, model, mode, save_dir, suffix, text_kind, max_chars, pause, separate_vocals=True):
        preset = MODE_PRESET.get("音乐" if mode == "歌词" else mode) or MODE_PRESET["口播"]
        files = list(media or [])
        if not files:
            raise ValueError("没有可处理的音视频")
        ext = ".srt" if str(suffix).lower().lstrip(".") == "srt" else ".txt"
        kind = "时间轴" if ext == ".srt" else text_kind
        folder = (save_dir or "").strip().strip('"')
        if folder:
            Path(folder).mkdir(parents=True, exist_ok=True)
        bar = ProgressBar(len(files))
        docs = []
        ok = 0
        for index, filepath in enumerate(files, 1):
            source = Path(filepath)
            target_dir = Path(folder) if folder else source.parent
            target = target_dir / f"{source.stem}{ext}"
            print(f"[whisper] {index}/{len(files)} {source.name}")
            try:
                lyric = preset["style"] == "lyric"
                if lyric and separate_vocals:
                    print(f"[whisper] separate vocals {source.name}")
                    audio = separate_vocals_wav(str(source))
                else:
                    audio = extract_audio_wav(str(source))
                params = {
                    "language": "zh",
                    "task": "transcribe",
                    "word_timestamps": True,
                    "vad_filter": not lyric,
                    "clip_timestamps": "0",
                    "beam_size": 5,
                    "temperature": 0.0,
                    "condition_on_previous_text": True,
                    "initial_prompt": preset["prompt"] or None,
                }
                if lyric:
                    params["hallucination_silence_threshold"] = 1.5
                transcriptions, = _whisper_transcriber().transcribe(audio, model, **params)
                text = render_document(transcriptions, kind, int(max_chars), float(pause), preset["style"])
                target.write_text(text if text.endswith("\n") or text == "" else text + "\n", encoding="utf-8-sig")
                docs.append({"name": source.stem, "title": source.stem, "path": str(target), "text": text, "error": ""})
                ok += 1
            except Exception as exc:
                message = f"识别失败：{exc}"
                docs.append({"name": source.stem, "title": source.stem, "path": str(target), "text": message, "error": str(exc)})
                print(f"[whisper] failed {source.name}: {exc}")
            bar.update_absolute(index)
        report = f"完成 {ok}/{len(files)}，保存为同名 {ext}"
        return {"ui": {"batch": [json.dumps(docs, ensure_ascii=False)]}, "result": (docs, report)}


def _qwen_choice(kind):
    try:
        import nodes as comfy_nodes

        runner = comfy_nodes.NODE_CLASS_MAPPINGS["AILab_Qwen3ASRSubtitle"]
        spec = runner.INPUT_TYPES()["optional"][kind][0]
        if spec:
            return list(spec)
    except Exception:
        pass
    if kind == "model":
        return ["Qwen/Qwen3-ASR-1.7B-hf", "Qwen/Qwen3-ASR-0.6B-hf"]
    if kind == "precision":
        return ["bf16", "fp16", "fp32"]
    return ["auto", "Chinese", "English", "Cantonese"]


def _wav_to_audio(path):
    wave, sample_rate = _read_wav(Path(path))
    return {"waveform": wave.unsqueeze(0), "sample_rate": int(sample_rate)}


def _cues_from_qwen(subtitles, text):
    import re

    cues = []
    pattern = re.compile(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?):\s*(.*)$")
    for line in str(subtitles or "").splitlines():
        matched = pattern.match(line.strip())
        if not matched:
            continue
        spoken = matched.group(3).strip()
        if spoken:
            cues.append({"start": float(matched.group(1)), "end": float(matched.group(2)), "text": spoken})
    if cues:
        return cues
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    return [{"start": 0.0, "end": 0.0, "text": line} for line in lines]


class BatchRecognizeQwen:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "media": ("MEDIA_LIST",),
                "mode": (["音乐", "口播"], {"tooltip": "音乐按演唱停顿断句；口播按完整词组断句"}),
                "save_dir": ("STRING", {"default": "", "placeholder": "留空则保存在音视频旁边"}),
                "suffix": (["txt", "srt"], {"tooltip": "保存后缀。默认 txt，选 srt 时内容是带时间轴的字幕"}),
                "text_kind": (["纯文本", "时间轴"], {"tooltip": "txt 时可选。纯文本一行一句；时间轴带开始和结束时间。选 srt 后缀时固定为时间轴"}),
                "max_chars": ("INT", {"default": 14, "min": 4, "max": 80, "step": 1, "tooltip": "一条最多多少字。语速快可以放到 20 到 40"}),
                "pause": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 2.0, "step": 0.05, "tooltip": "停顿超过这么多秒就换一行"}),
                "separate_vocals": ("BOOLEAN", {"default": True, "tooltip": "音乐模式先把伴奏分开，只识别人声。默认开。"}),
                "模型": (_qwen_choice("model"), {"default": "Qwen/Qwen3-ASR-1.7B-hf", "tooltip": "语速快用 1.7B。要更快可以改 0.6B。"}),
                "精度": (_qwen_choice("precision"), {"default": "bf16"}),
                "语言": (_qwen_choice("language"), {"default": "Chinese"}),
            }
        }

    RETURN_TYPES = ("BATCH_DOC", "STRING")
    RETURN_NAMES = ("documents", "report")
    FUNCTION = "run"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    def run(self, media, mode, save_dir, suffix, text_kind, max_chars, pause, separate_vocals, 模型, 精度, 语言):
        files = list(media or [])
        if not files:
            raise ValueError("没有可处理的音视频")
        ext = ".srt" if str(suffix).lower().lstrip(".") == "srt" else ".txt"
        kind = "时间轴" if ext == ".srt" else text_kind
        folder = (save_dir or "").strip().strip('"')
        if folder:
            Path(folder).mkdir(parents=True, exist_ok=True)
        import nodes as comfy_nodes

        runner = comfy_nodes.NODE_CLASS_MAPPINGS["AILab_Qwen3ASRSubtitle"]()
        bar = ProgressBar(len(files))
        docs = []
        ok = 0
        try:
            for index, filepath in enumerate(files, 1):
                source = Path(filepath)
                target_dir = Path(folder) if folder else source.parent
                target = target_dir / f"{source.stem}{ext}"
                print(f"[qwenasr] {index}/{len(files)} {source.name}")
                try:
                    lyric = mode in ("音乐", "歌词")
                    if lyric and separate_vocals:
                        print(f"[qwenasr] separate vocals {source.name}")
                        wav = separate_vocals_wav(str(source))
                    else:
                        wav = extract_audio_wav(str(source))
                    text, subtitles, _language, _path = runner.transcribe(
                        _wav_to_audio(wav),
                        model=模型,
                        precision=精度,
                        language=语言,
                        output_format="none",
                        split_mode="split_by_punctuation_or_pause",
                        max_gap_sec=float(pause),
                        max_chars=int(max_chars),
                        max_inference_batch_size=4,
                        max_new_tokens=256,
                        unload_models=False,
                    )
                    cues = _cues_from_qwen(subtitles, text)
                    body = cues_to_srt(cues) if kind == "时间轴" else cues_to_plain(cues)
                    target.write_text(body if body.endswith("\n") or body == "" else body + "\n", encoding="utf-8-sig")
                    docs.append({"name": source.stem, "title": source.stem, "path": str(target), "text": body, "error": ""})
                    ok += 1
                except Exception as exc:
                    message = f"识别失败：{exc}"
                    docs.append({"name": source.stem, "title": source.stem, "path": str(target), "text": message, "error": str(exc)})
                    print(f"[qwenasr] failed {source.name}: {exc}")
                bar.update_absolute(index)
        finally:
            module = __import__("inspect").getmodule(type(runner))
            if module is not None:
                getattr(module, "_ASR_MODEL_CACHE", {}).clear()
                getattr(module, "_ALIGNER_CACHE", {}).clear()
        report = f"完成 {ok}/{len(files)}，保存为同名 {ext}"
        return {"ui": {"batch": [json.dumps(docs, ensure_ascii=False)]}, "result": (docs, report)}


def place_documents(documents, folder: str) -> list:
    docs = [dict(item) for item in list(documents or [])]
    target_dir = (folder or "").strip().strip('"')
    if not target_dir:
        return docs
    dest = Path(target_dir)
    dest.mkdir(parents=True, exist_ok=True)
    used = set()
    for item in docs:
        raw_name = Path(str(item.get("path") or "")).name or f"{item.get('name') or '文稿'}.txt"
        if Path(raw_name).suffix.lower() not in {".txt", ".srt"}:
            raw_name += ".txt"
        stem, suffix = Path(raw_name).stem, Path(raw_name).suffix
        name = raw_name
        extra = 2
        while name.lower() in used:
            name = f"{stem}_{extra}{suffix}"
            extra += 1
        used.add(name.lower())
        target = dest / name
        text = item.get("text") or ""
        target.write_text(text if text.endswith("\n") or text == "" else text + "\n", encoding="utf-8-sig")
        old = Path(str(item.get("path") or ""))
        if old.is_file():
            try:
                if old.resolve() != target.resolve():
                    old.unlink()
            except Exception:
                pass
        item["path"] = str(target)
    return docs


class TextGallery:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "documents": ("BATCH_DOC",),
                "保存位置": ("STRING", {
                    "default": "",
                    "placeholder": "留空则保存在素材旁边",
                    "tooltip": "点文稿库上的「浏览」用资源管理器选文件夹。留空就保存在视频或图片旁边。",
                }),
            }
        }

    RETURN_TYPES = ("BATCH_DOC",)
    RETURN_NAMES = ("documents",)
    FUNCTION = "show"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    def show(self, documents, 保存位置=""):
        docs = place_documents(documents, 保存位置)
        payload = json.dumps(docs, ensure_ascii=False)
        return {"ui": {"batch": [payload]}, "result": (docs,)}


class ReviewBatchText:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "documents": ("BATCH_DOC",),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("current_text",)
    FUNCTION = "review"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    def review(self, documents):
        docs = list(documents or [])
        payload = json.dumps(docs, ensure_ascii=False)
        first = docs[0]["text"] if docs else ""
        return {"ui": {"batch": [payload]}, "result": (first,)}


CAPTION_PRESETS = {
    "千问3": {
        "family": "Qwen3-VL",
        "model": "Qwen3-VL-8B-Instruct-abliterated-v2.0.Q6_K.gguf",
        "mmproj": "Qwen3-VL-8B-Instruct-abliterated-v2.0.mmproj-f16.gguf",
    },
    "千问3.5": {
        "family": "Qwen3.5-VL",
        "model": "Q35-4B-G-UD/Qwen3.5-4B-UD-Q4_K_XL.gguf",
        "mmproj": "Q35-4B-G-UD/mmproj-Qwen3.5-4B-BF16.gguf",
    },
    "千问3.8": {
        "family": "Qwen3.8-VL",
        "model": "Q38-27B-G-UD/Qwen3.8-27B-UD-IQ2_XXS.gguf",
        "mmproj": "Q38-27B-G-UD/mmproj-Qwen3.8-27B-BF16.gguf",
    },
}

SHEET_PROMPT = (
    "这是一张按时间从左到右、从上到下排列的视频分镜。每格是该时间的一帧静止画面。\n"
    "格子时间依次是：{times}。\n"
    "请按时间顺序，每一格单独成段，段首写该格时间。每一格按这个顺序写：\n"
    "1. 景别和机位。单格是静止画面，不要写成一段运镜。相邻格的景别、机位或角度变了，在后一格写明。\n"
    "2. 光线、明暗和色调。\n"
    "3. 人物。先写这一格里有几个人。每个人分开写，不要合成一个人。每个人写：看得出的性别，年龄段（只能写儿童、少年、青年、中年、老年，不写具体岁数），"
    "发型，妆容，上衣的颜色和款式，下装的颜色和款式，鞋，帽子、眼镜、首饰、包这些配饰。看清哪项写哪项。\n"
    "4. 人物站位。每个人写清在画面的左、中、右，前景还是后景，面向镜头、侧面还是背面，朝哪一边。多人时写彼此的相对位置：谁在谁左边、谁更靠近镜头、谁挡住谁、间隔远近。不要只写「站在一起」。\n"
    "5. 每个人这一刻的动作和表情。\n"
    "6. 场景，以及画面上能看清的字。\n"
    "同一个人穿着没变，写「穿着同前」，不要整段照抄。换了衣服、发型或配饰再写全。站位变了要重写。\n"
    "空白格不要写。看不清就写看不清，不要猜性别、年龄、衣服和站位。不要编造，不要写成绘画提示词。"
)
FRAME_PROMPT = (
    "用中文描述这一帧。时间是 {time}。按顺序写：\n"
    "景别和机位。这一帧是静止的，动作只写这一刻的姿态，不要编造镜头运动过程。\n"
    "光线、明暗和色调。\n"
    "人物有几个。每个人分开写：看得出的性别，年龄段（儿童、少年、青年、中年、老年，不写具体岁数），"
    "发型，妆容，上衣的颜色和款式，下装的颜色和款式，鞋，以及帽子、眼镜、首饰、包。看清哪项写哪项。\n"
    "人物站位：每个人在画面的左、中、右，前景还是后景，面向镜头、侧面还是背面，朝哪一边。多人时写谁在谁左边、谁更靠近镜头、谁挡住谁、间隔远近，不要只写「站在一起」。\n"
    "每个人这一刻的动作和表情。场景，以及画面上能看清的字。\n"
    "看不清就写看不清，不要猜性别、年龄、衣服和站位。不要编造，不要写成绘画提示词。"
)
CAPTION_SYSTEM = (
    "你在整理视频素材。人物要分开写，写看得出的性别、年龄段、穿着细节，以及每个人在画面中的站位和彼此的相对位置。"
    "年龄只写年龄段，不写具体岁数。看不清的性别、年龄、衣服和站位直接写看不清。"
)
IMAGE_PROMPT = """Role
你是一位专业的AI生图提示词与图片反推工程师，专注于为即梦、可灵、Nano Banana Pro、Qwen-Image、Qwen-Edit、Stable Diffusion、Midjourney等主流AI绘图工具生成精准、详尽的提示词。核心职责是根据用户需求或参考图片，输出能完整复现画面细节的生图指令，确保AI生成结果与用户预期高度一致。

最高指令 (Absolute Command)
1.语言自适应：识别用户输入语言。用户用中文提问，你输出中文指令；用户用英文提问，你输出英文指令。
2.格式绝对纯净：严禁输出 Markdown 符号（如星号、井号）、严禁中英对照括号、严禁输出任何解释或前缀。

核心规则
第一部分：必做事项
1.全要素提取：当用户提供参考图时，需对图片进行全面详细分析，提取所有可见元素（包括主体、背景、文字、光影、材质、纹理、解剖结构等），确保无遗漏。
2.像素级精度：分析图片时必须进行多层次、多维度的细节挖掘，确保每个元素都有至少3-5个特征描述，达到像素级的细节提取精度。
3.去水印机制：提取文字信息时，仅识别属于图片内容（如招牌、衣服图案）的文字，排除AI生图相关文字和水印文字。
4.完整性闭环：所有提示词必须包含画面风格、核心元素、具体内容、文字信息（若有）四个核心模块，每个模块描述需达到AI可直接识别并生成的精度，不得遗漏。

第二部分：约束条件
1.正向引导：禁用负面提示词，完全使用正向约束表达（例：不用不要模糊，而写极致锐利的对焦，画面细节清晰）。
2.自然语言：使用自然语言语法，语句连贯、符合语法，禁止无逻辑的标签堆料，需用有逻辑、有流畅度的句式。
3.拒绝模糊：禁止使用模糊性描述（如好看的颜色、大概的形状），需采用精准术语（如金黄色渐变、等边三角形的几何结构）。
4.通用适配：提示词需适配所有主流AI绘图工具，避免使用工具专属语法。
5.纯净格式：输出不得包含任何Markdown标记、代码块符号。文字之间需保留正常空格以确保语义通顺，但段落之间紧凑排列，不要出现多余空行。

第三部分：输入处理规则 (关键逻辑)

双模态判断：
1.情况A（仅提供参考图）：执行全方位客观反推，忠实还原原图所有细节。
2.情况B（参考图 + 用户附加文本）：执行视觉融合模式。用户的文本指令（如把背景改成雨天、着重描述眼神）优先级高于原图内容。
3.冲突处理：当用户文本要求与图片原始内容冲突时，必须以用户文本为准进行修改或重构。
4.数量处理：若用户需求中包含多组、多个等关键词，需生成对应数量的提示词，每组之间仅用换行分隔。

执行流程

步骤1：需求解析与融合
若存在参考图，对图片进行以下分析（若有用户附加指令，需在此步骤同步修改分析结果）：
画面风格：判断艺术流派（写实/卡通/油画等）、色彩基调、滤镜风格、整体氛围。

核心元素：
主体：详细描述人物/物体的身份、特征、姿态、表情、解剖细节（每个特征至少3个细节描述）。
背景：详细描述背景环境、场景布局、空间关系（每个元素至少3个细节描述）。
装饰：详细描述服饰、配饰、道具（每个元素至少3个细节描述）。
文字：提取有效内容文字，说明字体、内容、位置。

细节特征：
光影效果：描述光源方向、强度、色温、阴影细节。
材质质感：描述表面纹理、反光特性、透明度、柔软度。
纹理密度：描述皮肤纹理、织物纹路、衣物褶皱、毛发细节。
解剖结构：描述身体比例、肌肉线条、骨骼结构、面部特征。
空间位置：使用具体的空间介词描述人物朝向和元素位置关系。
姿势分析：详细描述身体整体姿态、四肢位置角度、关节弯曲程度、肌肉紧张状态、运动方向和动态感。
技术参数：描述相机型号、镜头参数、拍摄模式、焦距、光圈。

步骤2：提示词生成
将步骤1分析的内容按以下顺序整合为提示词，确保每个元素都有充分的细节描述：
主体锚定：详细描述人物身份特征，包含人物国籍、长相特征、表情神态、解剖结构，每个特征至少3个细节描述。结合用户指令进行修正。
动作与场景：详细描述人物动作特征、背景环境信息、空间位置关系，重点突出姿势细节（身体整体姿态、头部姿态、手臂/腿部弯曲程度、手掌/脚部状态、整体动态力量传递）。
美学与光线：详细描述滤镜风格、光线氛围、色彩基调、整体氛围，每个方面至少3个细节描述。
技术修饰：详细描述构图方式、拍摄参数、纹理密度、材质质感，每个参数至少3个细节描述。
正向约束：强调质量标准，确保画面细节清晰、纹理丰富、对焦锐利、无水印、不包含AI生图相关元素。

步骤3：格式校验

检查提示词是否符合以下要求：
1.无模糊性描述，所有细节均精准可量化，每个元素都有至少3-5个特征描述。
2.姿势描述详细完整，包含身体整体姿态、四肢位置角度、关节弯曲程度、肌肉紧张状态、运动方向和动态感。
3.融合了用户的附加要求（如有）。
4.适配所有主流AI绘图工具，无工具专属语法。
5.无Markdown符号，无多余空行。
输出规范
1.所有提示词直接输出，不得包含任何额外内容（如好的，这是提示词）。
2.提示词需详尽到AI可直接生成与描述完全一致的画面，每个元素都有充分的细节描述，不得遗漏任何关键细节。
3.若生成多组提示词，每组之间仅用换行分隔，不得添加任何分隔符。
"""
IMAGE_CAPTION_SYSTEM = "按用户提示词执行。只输出一整段提示词，中间不要换行，不要空行，不要分段，不要解释，不要 Markdown。"


def _qwen_module():
    import sys

    for mod in sys.modules.values():
        file = str(getattr(mod, "__file__", "") or "").replace("\\", "/")
        if file.endswith("comfyUI-llama-TE/nodes.py"):
            return mod
    raise RuntimeError("没有找到千问反推节点。确认 comfyUI-llama-TE 已安装，然后完全退出并重新打开 ComfyUI。")


def _speech_lines(filepath: str, whisper_model, separate_vocals: bool) -> str:
    if separate_vocals:
        print(f"[video] separate vocals {Path(filepath).name}")
        audio = separate_vocals_wav(filepath)
    else:
        audio = extract_audio_wav(filepath)
    params = {
        "language": "zh",
        "task": "transcribe",
        "word_timestamps": True,
        "vad_filter": not separate_vocals,
        "clip_timestamps": "0",
        "beam_size": 5,
        "temperature": 0.0,
        "condition_on_previous_text": True,
        "initial_prompt": None if separate_vocals else "中文口播，请使用句号或问号断开完整句子。",
    }
    transcriptions, = _whisper_transcriber().transcribe(audio, whisper_model, **params)
    cues = sentences_from_transcriptions(transcriptions)
    lines = [f"[{clock(cue['start'])}] {str(cue.get('text') or '').strip()}" for cue in cues]
    return "\n".join(line for line in lines if not line.endswith("] "))


def _sheet_images(filepath: str, plan: dict, cols: int, rows: int) -> list:
    import hashlib

    made = []
    temp_dir = Path(folder_paths.get_temp_directory()) / "whisper_sheets"
    temp_dir.mkdir(parents=True, exist_ok=True)
    for group in plan["sheets"]:
        frames = []
        for t in group:
            image = grab_frame(filepath, t)
            if image is not None:
                frames.append((t, image))
        if not frames:
            continue
        sheet = compose_sheet(frames, cols, rows)
        key = hashlib.md5(f"{filepath}|{frames[0][0]:.3f}|{cols}x{rows}".encode("utf-8")).hexdigest()
        dest = temp_dir / f"{key}.jpg"
        sheet.save(dest, quality=90)
        sheet.close()
        for _, frame in frames:
            frame.close()
        made.append({
            "start": frames[0][0],
            "end": frames[-1][0],
            "times": [item[0] for item in frames],
            "path": str(dest),
        })
    return made


def _pil_batch(image):
    import torch

    array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def _fill_prompt(template: str, sheet: dict) -> str:
    times = "、".join(clock(t) for t in sheet["times"])
    text = (template or "").strip() or SHEET_PROMPT
    if "{times}" in text or "{time}" in text:
        return text.format(times=times, time=times)
    return text + f"\n格子时间依次是：{times}。"


def _brief_cache_file(source: Path, separate: bool, interval: float, grid: str, max_sheets: int) -> Path:
    import hashlib

    stamp = int(source.stat().st_mtime) if source.exists() else 0
    key = hashlib.md5(
        f"{source}|{stamp}|{int(separate)}|{interval:.3f}|{grid}|{max_sheets}".encode("utf-8")
    ).hexdigest()
    folder = Path(folder_paths.get_temp_directory()) / "whisper_brief"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{key}.json"


def _load_brief_cache(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    sheets = data.get("sheets") or []
    if any(not Path(str(sheet.get("path") or "")).is_file() for sheet in sheets):
        return None
    return data


def _save_brief_cache(path: Path, item: dict) -> None:
    payload = {
        "speech": item.get("speech") or "",
        "duration": item.get("duration") or 0,
        "plan": item.get("plan") or {},
        "sheets": [
            {"start": sheet["start"], "end": sheet["end"], "times": sheet["times"], "path": sheet["path"]}
            for sheet in item.get("sheets") or []
        ],
        "picture_error": item.get("picture_error") or "",
    }
    try:
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _caption_sheet(qwen_model, sheet: dict, prompt_text: str, seed: int) -> str:
    mod = _qwen_module()
    prompt = _fill_prompt(prompt_text, sheet)
    from PIL import Image

    with Image.open(sheet["path"]) as image:
        batch = _pil_batch(image)
    text, = mod.QwenTE图像推理().run(
        qwen模型=qwen_model,
        输入模式="图片",
        提示词=prompt,
        系统提示词=CAPTION_SYSTEM,
        最多帧数=2,
        最大边长=1536,
        最大生成token=2048,
        温度=0.6,
        top_p=0.8,
        top_k=20,
        重复惩罚=1.05,
        频率惩罚=0.0,
        存在惩罚=0.0,
        seed=int(seed),
        输出think块=False,
        生成后自动卸载模型=False,
        图片=batch,
    )
    return str(text or "").strip()


def _park_whisper(whisper_model) -> None:
    """Move the speech model off the GPU before the picture model loads."""
    inner = getattr(whisper_model, "model", None)
    if inner is None or not hasattr(inner, "unload_model"):
        return
    try:
        loaded = inner.model_is_loaded() if hasattr(inner, "model_is_loaded") else True
    except Exception:
        loaded = True
    if not loaded:
        return
    inner.unload_model(to_cpu=False)
    import gc
    import comfy.model_management as mm

    gc.collect()
    mm.soft_empty_cache()


def _restore_whisper(whisper_model) -> None:
    inner = getattr(whisper_model, "model", None)
    if inner is None or not hasattr(inner, "load_model"):
        return
    try:
        loaded = inner.model_is_loaded() if hasattr(inner, "model_is_loaded") else False
    except Exception:
        loaded = False
    if loaded:
        return
    inner.load_model()


def _load_caption_model(preset: dict):
    mod = _qwen_module()
    model, = mod.QwenTE模型加载器().load(
        preset["family"],
        preset["model"],
        preset["mmproj"],
        False,
        False,
        8192,
        -1,
        "默认(F16)",
        "默认(F16)",
        False,
        0,
    )
    return model


def _compose_document(source: Path, duration: float, choice: str, grid_name: str, plan: dict, speech: str, pictures: list, picture_error: str) -> str:
    gap = float(plan.get("requested_interval") or 2)
    hold = float(plan.get("hold") or max(gap * 4, 8))
    if plan.get("fallback"):
        sampling = f"没有读到画面差异，改为每 {gap:.1f} 秒一帧，{grid_name}，共 {len(pictures)} 张。"
    elif plan.get("thinned"):
        sampling = (
            f"按画面变化抽帧，最少隔 {gap:.1f} 秒，{grid_name}。"
            f"变化太多，已按时间均匀留下差异最大的帧，共 {len(pictures)} 张。"
        )
    else:
        sampling = (
            f"按画面变化抽帧，最少隔 {gap:.1f} 秒，{grid_name}。"
            f"换镜头会留下；同一画面大约最久 {hold:.0f} 秒留一帧。共 {len(pictures)} 张。"
        )
    picture_parts = []
    for shot in pictures:
        if shot["start"] == shot["end"]:
            heading = clock(shot["start"])
        else:
            heading = f"{clock(shot['start'])}–{clock(shot['end'])}"
        body = shot.get("text") or "（这一张没有反推出内容）"
        picture_parts.append(f"[{heading}]\n{body}")
    if picture_error and not picture_parts:
        picture_body = picture_error
    elif not picture_parts:
        picture_body = "没有画面。音频文件，或这一条抽帧失败。"
    else:
        picture_body = "\n\n".join(picture_parts)
    speech_body = speech.strip() or "（没有识别到人声）"
    return (
        f"# 视频内容素材\n"
        f"文件：{source.name}\n"
        f"时长：{clock(duration)}\n"
        f"画面模型：{choice}\n"
        f"抽帧：{sampling}\n"
        f"\n"
        f"## 交给大模型的任务\n"
        f"请根据下面的人声和按时间排列的画面，整理这条视频在讲什么。\n"
        f"先用几句话概括，再按时间顺序写过程。人声和画面对得上的写在一起。\n"
        f"人物的性别、年龄段和穿着以画面描述为准。年龄是看起来的年龄段，不是确切岁数。\n"
        f"两边不一致，或其中一边没有内容时，分开写。不要编造没有出现的情节。\n"
        f"\n"
        f"## 人声\n"
        f"{speech_body}\n"
        f"\n"
        f"## 画面\n"
        f"{picture_body}\n"
    )


class VideoCaptionChoice:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "选用": (list(CAPTION_PRESETS), {"default": "千问3.5", "tooltip": "默认千问 3.5。千问 3 更稳一些，千问 3.8 更慢、更吃显存。"}),
            }
        }

    RETURN_TYPES = ("CAPTION_PRESET",)
    RETURN_NAMES = ("caption_model",)
    FUNCTION = "choose"
    CATEGORY = "feimao tools"

    def choose(self, 选用):
        preset = dict(CAPTION_PRESETS.get(选用) or CAPTION_PRESETS["千问3.5"])
        preset["name"] = 选用 if 选用 in CAPTION_PRESETS else "千问3.5"
        return (preset,)


class VideoReverseBrief:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "素材": ("MEDIA_LIST",),
                "语音模型": ("FASTERWHISPERMODEL",),
                "反推模型": ("CAPTION_PRESET",),
                "分离人声": (["开", "关"], {"default": "关", "tooltip": "默认关。唱歌、有伴奏的片子再打开，先去掉伴奏再识别。"}),
                "抽帧间隔": ("FLOAT", {"default": 2.0, "min": 0.5, "max": 60.0, "step": 0.5, "tooltip": "画面有变化时，两帧最少隔开这么多秒。换镜头不受这个限制。同一画面太久不动，大约隔 4 倍时间仍留一帧。"}),
                "宫格": (list(GRID_SHAPE), {"default": "9宫格", "tooltip": "抽到的帧拼成一张图再反推。9 宫格是默认。1 宫格最清楚也最慢，12 宫格最快但格子最小。"}),
                "最多宫格": ("INT", {"default": 12, "min": 1, "max": 60, "step": 1, "tooltip": "最多反推多少张宫格。超了会自动拉大间隔，全片仍然都抽到。"}),
                "随机种子": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 0xffffffffffffffff,
                    "step": 1,
                    "tooltip": "默认是一个随机数。点旁边的「换随机数」会换成另一个数。反推就用框里这个数。",
                }),
                "反推提示词": ("STRING", {
                    "default": SHEET_PROMPT,
                    "multiline": True,
                    "tooltip": "可以改措辞。保留 {times}，每张宫格会换成这一张的时间。",
                }),
            }
        }

    RETURN_TYPES = ("BATCH_DOC", "STRING")
    RETURN_NAMES = ("文稿", "说明")
    FUNCTION = "run"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, 素材, 语音模型, 反推模型, 分离人声="关", 抽帧间隔=2.0, 宫格="9宫格", 最多宫格=12, 随机种子=0, 反推提示词=""):
        return int(随机种子)

    def run(self, 素材, 语音模型, 反推模型, 分离人声="关", 抽帧间隔=2.0, 宫格="9宫格", 最多宫格=12, 随机种子=0, 反推提示词=""):
        import comfy.model_management as mm

        media = 素材
        model = 语音模型
        caption_model = 反推模型
        separate_vocals = str(分离人声) != "关"
        interval = float(抽帧间隔)
        grid = 宫格
        max_sheets = int(最多宫格)
        seed = int(随机种子)
        prompt_text = 反推提示词 or SHEET_PROMPT
        files = list(media or [])
        if not files:
            raise ValueError("没有可处理的视频")
        preset = dict(caption_model or {})
        if "model" not in preset:
            preset = dict(CAPTION_PRESETS["千问3.5"])
            preset["name"] = "千问3.5"
        choice = preset.get("name") or "千问3.5"
        cols, rows = GRID_SHAPE.get(grid) or GRID_SHAPE["9宫格"]
        cells = cols * rows

        prepared = []
        try:
            _qwen_module()._QwenStorage.unload()
        except Exception:
            pass
        for filepath in files:
            if mm.processing_interrupted():
                raise mm.InterruptProcessingException()
            source = Path(filepath)
            item = {"source": source, "speech": "", "speech_error": "", "sheets": [], "picture_error": "", "duration": 0.0, "plan": {}}
            cache_path = _brief_cache_file(source, separate_vocals, interval, grid, max_sheets)
            cached = _load_brief_cache(cache_path)
            if cached is not None:
                item.update(cached)
                print(f"[video] reuse speech and frames {source.name}")
                prepared.append(item)
                continue
            print(f"[video] speech {source.name}")
            try:
                item["speech"] = _speech_lines(str(source), model, separate_vocals)
            except Exception as exc:
                item["speech_error"] = f"人声识别失败：{exc}"
                print(f"[video] speech failed {source.name}: {exc}")
            if source.suffix.lower() in VIDEO_EXT:
                try:
                    duration = probe_duration(str(source))
                    plan = plan_by_change(str(source), duration, float(interval), cells, int(max_sheets))
                    item["duration"] = duration
                    item["plan"] = plan
                    item["sheets"] = _sheet_images(str(source), plan, cols, rows)
                    print(
                        f"[video] frames {source.name} {clock(duration)} "
                        f"every {plan['actual_interval']:.1f}s {grid} x{len(item['sheets'])}"
                    )
                except Exception as exc:
                    item["picture_error"] = f"抽帧失败：{exc}"
                    print(f"[video] frames failed {source.name}: {exc}")
            else:
                item["picture_error"] = "这是音频，没有画面。"
            if not item["speech_error"] and not item["picture_error"]:
                _save_brief_cache(cache_path, item)
            prepared.append(item)

        need_caption = any(item["sheets"] for item in prepared)
        qwen_model = None
        caption_error = ""
        parked = False
        if need_caption:
            try:
                print("[video] unload speech model")
                _park_whisper(model)
                parked = True
                print(f"[video] load {choice}")
                qwen_model = _load_caption_model(preset)
            except Exception as exc:
                caption_error = f"画面模型加载失败：{exc}"
                print(f"[video] caption model failed: {exc}")

        total = sum(max(len(item["sheets"]), 1) for item in prepared)
        bar = ProgressBar(total)
        done = 0
        docs = []
        ok = 0
        try:
            docs, ok = self._write_all(
                prepared, qwen_model, caption_error, choice, grid, interval, bar, total, done, mm,
                prompt_text, seed,
            )
        finally:
            try:
                _qwen_module()._QwenStorage.unload()
            except Exception:
                pass
            if parked:
                try:
                    _restore_whisper(model)
                except Exception as exc:
                    print(f"[video] restore speech model failed: {exc}")
        report = f"完成 {ok}/{len(files)}。{choice}，{grid}，种子 {seed}"
        return {"ui": {"batch": [json.dumps(docs, ensure_ascii=False)]}, "result": (docs, report)}

    def _write_all(self, prepared, qwen_model, caption_error, choice, grid, interval, bar, total, done, mm, prompt_text, seed):
        docs = []
        ok = 0
        for item in prepared:
            if mm.processing_interrupted():
                raise mm.InterruptProcessingException()
            source = item["source"]
            if qwen_model is not None:
                for index, sheet in enumerate(item["sheets"], 1):
                    if mm.processing_interrupted():
                        raise mm.InterruptProcessingException()
                    print(f"[video] caption {source.name} {index}/{len(item['sheets'])} {clock(sheet['start'])}")
                    try:
                        sheet["text"] = _caption_sheet(qwen_model, sheet, prompt_text, seed)
                    except Exception as exc:
                        sheet["text"] = f"（这一张反推失败：{exc}）"
                        print(f"[video] caption failed {source.name}: {exc}")
                    done += 1
                    bar.update_absolute(min(done, total))
            elif item["sheets"]:
                item["picture_error"] = caption_error or "画面模型没有加载。"
            if not item["sheets"]:
                done += 1
                bar.update_absolute(min(done, total))

            speech = item["speech"] or item["speech_error"]
            text = _compose_document(
                source,
                item["duration"],
                choice,
                grid,
                item["plan"] or {"requested_interval": float(interval), "actual_interval": float(interval), "stretched": False},
                speech,
                item["sheets"],
                item["picture_error"],
            )
            target = source.parent / f"{source.stem}_视频素材_{choice}.txt"
            try:
                target.write_text(text, encoding="utf-8-sig")
                error = ""
                ok += 1
            except Exception as exc:
                error = str(exc)
                text = f"保存失败：{exc}\n\n{text}"
            docs.append({
                "name": f"{source.stem}_视频素材_{choice}",
                "title": source.stem,
                "path": str(target),
                "text": text,
                "error": error,
            })
        return docs, ok


_IMAGE_SLOTS = ("图片", "图片2", "图片3", "图片4", "图片5", "图片6", "图片7", "图片8")


def _image_names(paths: list) -> str:
    return "、".join(f"图{index} {Path(path).name}" for index, path in enumerate(paths, 1))


def _fill_image_prompt(template: str, paths: list) -> str:
    names = _image_names(paths)
    text = (template or "").strip() or IMAGE_PROMPT
    if "{names}" in text:
        return text.format(names=names)
    if len(paths) > 1:
        return text + f"\n图片顺序是：{names}。按这个顺序分别输出提示词，每张之间空一行。"
    return text


def _load_image_tensor(path: str):
    from PIL import Image, ImageOps

    with Image.open(path) as image:
        fixed = ImageOps.exif_transpose(image)
        return _pil_batch(fixed)


def _caption_images(qwen_model, paths: list, prompt_text: str, seed: int) -> str:
    mod = _qwen_module()
    kwargs = {
        slot: _load_image_tensor(path)
        for slot, path in zip(_IMAGE_SLOTS, paths)
    }
    text, = mod.QwenTE图像推理().run(
        qwen模型=qwen_model,
        输入模式="图片",
        提示词=_fill_image_prompt(prompt_text, paths),
        系统提示词=IMAGE_CAPTION_SYSTEM,
        最多帧数=2,
        最大边长=1536,
        最大生成token=2048,
        温度=0.6,
        top_p=0.8,
        top_k=20,
        重复惩罚=1.05,
        频率惩罚=0.0,
        存在惩罚=0.0,
        seed=int(seed),
        输出think块=False,
        生成后自动卸载模型=False,
        **kwargs,
    )
    return str(text or "").strip()


def _image_prompt_text(body: str) -> str:
    parts = [part.strip() for part in (body or "").splitlines() if part.strip()]
    text = "".join(parts)
    return text + ("\n" if text else "")


class ImageSource:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": (["单张图片", "文件夹"],),
                "path": ("STRING", {"default": ""}),
                "library": ("STRING", {"default": "", "multiline": True}),
                "反推范围": (["全部", "批量选中", "单独"], {
                    "default": "全部",
                    "tooltip": "全部：库里有几张就逐张反推几张。批量选中：只反推点中的几张。单独：只反推点中的一张。",
                }),
                "选中": ("STRING", {"default": "[]"}),
            }
        }

    RETURN_TYPES = ("MEDIA_LIST", "STRING")
    RETURN_NAMES = ("images", "summary")
    FUNCTION = "collect"
    CATEGORY = "feimao tools"

    def collect(self, source, path, library="", 反推范围="全部", 选中="[]"):
        files = [item for item in _library_files(library) if Path(item).suffix.lower() in IMAGE_EXT]
        if not files:
            path = (path or "").strip().strip('"')
            if source == "文件夹" and path:
                files = list_image_files(path)
            elif path:
                resolved = resolve_media_path(path)
                if Path(resolved).suffix.lower() not in IMAGE_EXT:
                    raise ValueError("请选择图片文件")
                files = [resolved]
        if not files:
            raise ValueError("图片库是空的，请先添加图片")
        scope = str(反推范围 or "全部")
        chosen = [item for item in _library_files(选中) if item in set(files)]
        if scope == "单独":
            if not chosen:
                raise ValueError("单独反推请先在图片库点选一张图片")
            files = [chosen[-1]]
        elif scope == "批量选中":
            if not chosen:
                raise ValueError("批量选中反推请先在图片库点选图片")
            files = [item for item in files if item in set(chosen)]
        names = "\n".join(Path(item).name for item in files)
        return (files, f"{scope}，共 {len(files)} 张\n{names}")

    @classmethod
    def IS_CHANGED(cls, source, path, library="", 反推范围="全部", 选中="[]", **kwargs):
        try:
            files = cls().collect(source, path, library, 反推范围, 选中)[0]
            return "|".join(f"{item}:{os.path.getmtime(item)}" for item in files)
        except Exception:
            return f"{source}:{path}:{library}:{反推范围}:{选中}"

    @classmethod
    def VALIDATE_INPUTS(cls, source, path, library="", 反推范围="全部", 选中="[]", **kwargs):
        try:
            cls().collect(source, path, library, 反推范围, 选中)
            return True
        except Exception as exc:
            return str(exc)


class ImageReverseBrief:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图片": ("MEDIA_LIST",),
                "反推模型": ("CAPTION_PRESET",),
                "随机种子": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 0xffffffffffffffff,
                    "step": 1,
                    "tooltip": "默认是一个随机数。点旁边的「换随机数」会换成另一个数。反推就用框里这个数。",
                }),
                "反推提示词": ("STRING", {
                    "default": IMAGE_PROMPT,
                    "multiline": True,
                    "tooltip": "可以改措辞。每张图单独反推，结果只保留模型写出的提示词。",
                }),
            }
        }

    RETURN_TYPES = ("BATCH_DOC", "STRING")
    RETURN_NAMES = ("文稿", "说明")
    FUNCTION = "run"
    CATEGORY = "feimao tools"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, 图片, 反推模型, 随机种子=0, 反推提示词=""):
        return int(随机种子)

    def run(self, 图片, 反推模型, 随机种子=0, 反推提示词=""):
        import comfy.model_management as mm

        files = [item for item in list(图片 or []) if Path(item).suffix.lower() in IMAGE_EXT]
        if not files:
            raise ValueError("没有可处理的图片")
        preset = dict(反推模型 or {})
        if "model" not in preset:
            preset = dict(CAPTION_PRESETS["千问3.5"])
            preset["name"] = "千问3.5"
        choice = preset.get("name") or "千问3.5"
        prompt_text = 反推提示词 or IMAGE_PROMPT
        seed = int(随机种子)
        groups = [[item] for item in files]
        try:
            _qwen_module()._QwenStorage.unload()
        except Exception:
            pass
        print(f"[image] load {choice}")
        qwen_model = _load_caption_model(preset)
        bar = ProgressBar(len(groups))
        docs = []
        ok = 0
        used = set()
        try:
            for index, group in enumerate(groups, 1):
                if mm.processing_interrupted():
                    raise mm.InterruptProcessingException()
                print(f"[image] caption {index}/{len(groups)} {len(group)} file(s)")
                try:
                    body = _caption_images(qwen_model, group, prompt_text, seed)
                    error = ""
                except Exception as exc:
                    body = f"反推失败：{exc}"
                    error = str(exc)
                    print(f"[image] caption failed: {exc}")
                text = _image_prompt_text(body)
                first = Path(group[0])
                target_dir = first.parent
                stem = f"{first.stem}_图片反推_{choice}"
                name = stem
                extra = 2
                while name in used:
                    name = f"{stem}_{extra}"
                    extra += 1
                used.add(name)
                target = target_dir / f"{name}.txt"
                try:
                    target.write_text(text, encoding="utf-8-sig")
                    if not error:
                        ok += 1
                except Exception as exc:
                    error = error or str(exc)
                    text = f"保存失败：{exc}\n\n{text}"
                docs.append({
                    "name": name,
                    "title": first.stem,
                    "path": str(target),
                    "text": text,
                    "error": error,
                })
                bar.update_absolute(index)
        finally:
            try:
                _qwen_module()._QwenStorage.unload()
            except Exception:
                pass
        report = f"完成 {ok}/{len(groups)}。{choice}，种子 {seed}"
        return {"ui": {"batch": [json.dumps(docs, ensure_ascii=False)]}, "result": (docs, report)}

