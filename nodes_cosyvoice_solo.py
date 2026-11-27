"""配音。

接 FL CosyVoice3 的模型，用 CosyVoice3 的 inference_instruct2 说话。
单人接一条参考音。多人用 [S1]、[S2] 换人，每接上一条就再长出一个参考音口。
方言、情绪、副语和停顿写在剧本标签里。
参考音用 ComfyUI 的 Load Audio，成片用 Preview Audio 和 Save Audio。
"""

from __future__ import annotations

import inspect
import math
import os
import random
import re
import tempfile
import wave
from dataclasses import dataclass

import numpy as np
import torch

try:
    import soundfile as sf
except Exception:
    sf = None

try:
    import pyloudnorm as pyln
except Exception:
    pyln = None


LOG = "[肥猫配音]"
MAX_SPEAKERS = 6
MODES = ["单人", "多人"]
SYSTEM_PROMPT = "You are a helpful assistant."
ENDOFPROMPT = "<|endofprompt|>"
TARGET_LUFS = -16.0
MAX_CHARS = 120

DIALECTS = [
    "普通话", "四川话", "重庆话", "广东话", "上海话", "东北话", "北京话", "天津话",
    "河南话", "山东话", "湖南话", "湖北话", "江西话", "福建话", "客家话",
    "陕西话", "山西话", "云南话",
]
EMOTIONS = [
    "自动", "开心", "生气", "伤心", "恐惧", "惊讶", "厌恶", "平静", "温柔",
    "激动", "悲伤", "严肃", "撒娇", "疲惫", "冷酷", "慵懒", "神秘",
]
SOUND_TAGS = {"breath", "laughter", "sigh", "cough", "gasp", "cry"}
LANGUAGE_ALIASES = {
    "普通话": "普通话", "国语": "普通话", "中文": "普通话", "汉语": "普通话",
    "四川话": "四川话", "川话": "四川话", "重庆话": "重庆话",
    "广东话": "广东话", "粤语": "广东话", "上海话": "上海话",
    "东北话": "东北话", "北京话": "北京话", "天津话": "天津话",
    "河南话": "河南话", "山东话": "山东话", "湖南话": "湖南话", "湖北话": "湖北话",
    "江西话": "江西话", "福建话": "福建话", "闽南语": "福建话", "闽南话": "福建话",
    "客家话": "客家话", "陕西话": "陕西话", "山西话": "山西话", "云南话": "云南话",
    "英语": "英语", "英文": "英语", "日语": "日语", "日文": "日语",
    "韩语": "韩语", "韩文": "韩语",
}
EMOTION_ALIASES = {
    "开心": "开心", "高兴": "开心", "生气": "生气", "愤怒": "生气",
    "伤心": "伤心", "悲伤": "悲伤", "难过": "悲伤", "恐惧": "恐惧", "害怕": "恐惧",
    "惊讶": "惊讶", "吃惊": "惊讶", "厌恶": "厌恶", "平静": "平静", "冷静": "平静",
    "温柔": "温柔", "激动": "激动", "兴奋": "激动", "严肃": "严肃", "认真": "严肃",
    "撒娇": "撒娇", "疲惫": "疲惫", "累": "疲惫", "冷酷": "冷酷", "慵懒": "慵懒",
    "神秘": "神秘",
}

TAG_RE = re.compile(r"\[([^\[\]]+)\]")
PAUSE_RE = re.compile(r"\[\s*pause(?:\s+([0-9]*\.?[0-9]+))?\s*\]", re.IGNORECASE)
STRONG_CUT_RE = re.compile(r"([。！？!?]+|\n+)")
ROLE_TAG_RE = re.compile(r"^(?:[Ss]\s*([1-9])|角色\s*([1-9]))(?:\s*[:：].*)?$")
ROLE_PREFIX_RE = re.compile(r"^\s*(?:[Ss]\s*([1-9])|角色\s*([1-9]))\s*[:：]\s*")


@dataclass
class Line:
    line_no: int
    text: str
    instruction: str
    mixed: bool
    speaker: str = "S1"


@dataclass
class Speech:
    text: str
    instruction: str
    mixed: bool
    line_no: int
    speaker: str = "S1"


@dataclass
class Silence:
    seconds: float


def _dedupe(items):
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _normalize_text(text):
    text = text.replace("\u3000", " ").replace("\t", " ")
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()


def _strip_leading_punct(text):
    return re.sub(r"^[\s:：,，、;；\-—.。!！?？]+", "", text).strip()


def _is_sound(tag):
    name = tag.strip().lower()
    return name in SOUND_TAGS or name.startswith("pause")


def _language(tag):
    text = tag.strip()
    if text in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[text]
    if text in EMOTION_ALIASES:
        return None
    if 2 <= len(text) <= 8 and text.endswith(("话", "语", "文")):
        return text
    return None


def _has_speech(text):
    cleaned = TAG_RE.sub("", PAUSE_RE.sub("", text or ""))
    return bool(re.search(r"[^。！？!?；;，,、\s]", cleaned))


def build_instruction(languages, emotions, styles):
    parts = []
    langs = _dedupe([item for item in languages if item])
    if len(langs) == 1:
        parts.append(f"请用{langs[0]}表达")
    elif len(langs) == 2:
        parts.append(f"请先用{langs[0]}，再用{langs[1]}自然过渡表达")
    elif len(langs) > 2:
        parts.append("请依次用" + "、".join(langs) + "自然过渡表达")
    else:
        parts.append("请自然、清晰地表达")
    emos = _dedupe([item for item in emotions if item])
    if emos:
        parts.append("语气" + "、".join(emos))
    sty = _dedupe([item for item in styles if item])
    if sty:
        parts.append("整体风格" + "、".join(sty))
    return "，".join(parts)


def _tts_text(raw):
    parts = []
    last = 0
    for match in TAG_RE.finditer(raw):
        parts.append(raw[last:match.start()])
        tag = match.group(1).strip()
        if _is_sound(tag):
            parts.append(f" [{tag.lower()}] ")
        last = match.end()
    parts.append(raw[last:])
    return _strip_leading_punct(_normalize_text("".join(parts)))


def _speaker_from_number(number, line_no, multi):
    slot = int(number)
    if slot < 1 or slot > MAX_SPEAKERS:
        raise ValueError(f"第 {line_no} 行用了 S{slot}。角色只支持 S1 到 S{MAX_SPEAKERS}。")
    if not multi and slot != 1:
        raise ValueError(
            f"第 {line_no} 行用了 S{slot}。当前是单人模式，只接一条参考音。"
            f"改成多人模式后，把 S{slot} 的参考音接上。"
        )
    return f"S{slot}"


def parse_script(script, dialect, emotion, multi=False):
    """一行一句。方言和情绪写在方括号里。多人模式用 [S1] 到 [S6] 换人。"""
    lines = []
    current = "S1"
    for line_no, raw_line in enumerate(str(script or "").splitlines(), 1):
        raw = raw_line.strip().lstrip("\ufeff")
        if not raw or raw.startswith("//"):
            continue
        speaker = None
        prefix = ROLE_PREFIX_RE.match(raw)
        if prefix:
            speaker = _speaker_from_number(prefix.group(1) or prefix.group(2), line_no, multi)
            raw = raw[prefix.end():].strip()

        languages = []
        emotions = []
        styles = []
        for tag in (match.group(1).strip() for match in TAG_RE.finditer(raw)):
            role = ROLE_TAG_RE.match(tag)
            if role:
                found = _speaker_from_number(role.group(1) or role.group(2), line_no, multi)
                if speaker is None:
                    speaker = found
                continue
            if _is_sound(tag):
                continue
            lang = _language(tag)
            if lang:
                languages.append(lang)
                continue
            emo = EMOTION_ALIASES.get(tag)
            if emo:
                emotions.append(emo)
                continue
            styles.append(tag)

        text = _tts_text(raw)
        if not text or (not _has_speech(text) and not PAUSE_RE.search(text)):
            continue
        if speaker is None:
            speaker = current if multi else "S1"
        current = speaker
        if not languages and dialect not in ("", "自动", "无"):
            languages = [dialect]
        if not emotions and emotion not in ("", "自动", "无"):
            emotions = [emotion]
        languages = _dedupe(languages)
        emotions = _dedupe(emotions)
        lines.append(Line(
            line_no=line_no,
            text=text,
            instruction=build_instruction(languages, emotions, styles),
            mixed=len(languages) >= 2,
            speaker=speaker,
        ))
    return lines


def _split_strong(text):
    items = []
    current = ""
    for part in STRONG_CUT_RE.split(text):
        if not part:
            continue
        current += part
        if STRONG_CUT_RE.fullmatch(part):
            speech = current.strip()
            if speech and _has_speech(speech):
                items.append(speech)
            current = ""
    if current.strip() and _has_speech(current):
        items.append(current.strip())
    return items


def _split_long(text, limit):
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    pieces = []
    rest = text
    while len(rest) > limit:
        window = rest[:limit]
        cut = max(window.rfind(mark) for mark in "，、；,;")
        if cut < limit // 3:
            cut = limit
        else:
            cut += 1
        piece = rest[:cut].strip()
        if piece:
            pieces.append(piece)
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def _speech_pieces(text, auto_split, mixed):
    text = text.strip()
    if not text or not _has_speech(text):
        return []
    if mixed:
        return [text]
    if auto_split:
        pieces = []
        for sentence in _split_strong(text):
            pieces.extend(_split_long(sentence, MAX_CHARS))
        return pieces
    if len(text) <= MAX_CHARS:
        return [text]
    pieces = []
    for sentence in _split_strong(text) or [text]:
        pieces.extend(_split_long(sentence, MAX_CHARS))
    return pieces


def _pause_seconds(raw):
    try:
        seconds = float(raw) if raw is not None else 0.4
    except (TypeError, ValueError):
        seconds = 0.4
    return max(0.0, min(60.0, seconds))


def plan_tasks(script, dialect, emotion, auto_split, line_gap, multi=False):
    lines = parse_script(script, dialect, emotion, multi)
    if not lines:
        raise ValueError("剧本没有可朗读的内容。一行一句，例如：[开心] 今天讲三个要点。")
    tasks = []
    gap = max(0.0, min(2.0, float(line_gap)))
    for index, line in enumerate(lines):
        last = 0
        for match in PAUSE_RE.finditer(line.text):
            for piece in _speech_pieces(line.text[last:match.start()], auto_split, line.mixed):
                tasks.append(Speech(piece, line.instruction, line.mixed, line.line_no, line.speaker))
            seconds = _pause_seconds(match.group(1))
            if seconds > 0:
                tasks.append(Silence(seconds))
            last = match.end()
        for piece in _speech_pieces(line.text[last:], auto_split, line.mixed):
            tasks.append(Speech(piece, line.instruction, line.mixed, line.line_no, line.speaker))
        nxt = lines[index + 1] if index < len(lines) - 1 else None
        if gap > 0 and nxt is not None and _has_speech(line.text) and _has_speech(nxt.text):
            tasks.append(Silence(gap))
    merged = []
    for task in tasks:
        if isinstance(task, Silence) and merged and isinstance(merged[-1], Silence):
            merged[-1] = Silence(min(60.0, merged[-1].seconds + task.seconds))
        elif isinstance(task, Speech) or (isinstance(task, Silence) and task.seconds > 0):
            merged.append(task)
    if not any(isinstance(task, Speech) for task in merged):
        raise ValueError("剧本里只有停顿，没有台词。")
    return merged


def _format_instruct(instruction, is_v3):
    body = (instruction or "请自然、清晰地表达").replace(ENDOFPROMPT, "").strip()
    if body.startswith(SYSTEM_PROMPT):
        body = body[len(SYSTEM_PROMPT):].lstrip("\n").strip()
    if not body:
        body = "请自然、清晰地表达"
    if is_v3:
        return f"{SYSTEM_PROMPT}\n{body}{ENDOFPROMPT}"
    return f"{body}{ENDOFPROMPT}"


def _accepts(fn, name):
    try:
        return name in inspect.signature(fn).parameters
    except Exception:
        return False


def _as_mono(waveform):
    if torch.is_tensor(waveform):
        array = waveform.detach().cpu().float().numpy()
    else:
        array = np.asarray(waveform, dtype=np.float32)
    array = np.squeeze(np.asarray(array, dtype=np.float32))
    if array.ndim == 0:
        array = array.reshape(1)
    if array.ndim > 1:
        array = array.reshape(-1, array.shape[-1]).mean(axis=0)
    array = np.nan_to_num(array, nan=0.0, posinf=0.0, neginf=0.0)
    return np.ascontiguousarray(array, dtype=np.float32).reshape(-1)


def _reference_duration(audio):
    waveform = audio.get("waveform")
    sample_rate = float(audio.get("sample_rate") or 0)
    if sample_rate <= 0 or waveform is None:
        raise ValueError("参考音频无效。请用 Load Audio 接一条参考音。")
    count = int(waveform.shape[-1]) if torch.is_tensor(waveform) else int(np.asarray(waveform).shape[-1])
    return count / sample_rate


def _save_reference(audio, path):
    waveform = audio["waveform"]
    sample_rate = int(audio["sample_rate"])
    array = waveform.detach().cpu().float().numpy() if torch.is_tensor(waveform) else np.asarray(waveform, dtype=np.float32)
    if array.ndim == 3:
        array = array[0]
    if array.ndim == 1:
        array = array.reshape(-1, 1)
    elif array.ndim == 2:
        array = array.T
    else:
        raise ValueError(f"参考音频维度无法识别：{array.shape}")
    array = np.clip(np.nan_to_num(array, nan=0.0, posinf=0.0, neginf=0.0), -1.0, 1.0).astype(np.float32)
    if sf is not None:
        sf.write(path, array, sample_rate, subtype="PCM_16")
        return
    mono = array.mean(axis=1) if array.shape[1] > 1 else array.reshape(-1)
    pcm = (np.clip(mono, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())


def _measure_lufs(audio, sample_rate):
    if pyln is None:
        return None
    try:
        value = float(pyln.Meter(int(sample_rate)).integrated_loudness(np.asarray(audio, dtype=np.float64)))
    except Exception:
        return None
    return value if math.isfinite(value) else None


def _normalize_loudness(audio, sample_rate):
    audio = np.asarray(audio, dtype=np.float64).reshape(-1)
    measured = _measure_lufs(audio, sample_rate)
    used_lufs = measured is not None
    if measured is None:
        rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
        measured = 20.0 * math.log10(max(rms, 1e-9))
    gain = 10.0 ** ((TARGET_LUFS - measured) / 20.0)
    norm = audio * gain
    peak = float(np.max(np.abs(norm))) if norm.size else 0.0
    if peak > 0.999:
        gain *= 0.999 / peak
        norm = audio * gain
    return np.asarray(norm, dtype=np.float32), used_lufs, measured


def _model_is_v3(model_info, cosyvoice_model):
    version = str(model_info.get("model_version", "")).lower()
    name = type(cosyvoice_model).__name__.lower()
    return bool(model_info.get("is_cosyvoice3")) or "cosyvoice3" in version or "fun-cosyvoice3" in version or "cosyvoice3" in name


def _infer(cosyvoice_model, prompt_wav, task, speed, is_v3):
    if not hasattr(cosyvoice_model, "inference_instruct2"):
        raise RuntimeError("当前模型没有 inference_instruct2。请加载 Fun-CosyVoice3-0.5B。")
    kwargs = {
        "tts_text": task.text,
        "instruct_text": _format_instruct(task.instruction, is_v3),
        "prompt_wav": prompt_wav,
        "stream": False,
        "speed": float(speed),
        "text_frontend": not task.mixed,
    }
    if _accepts(cosyvoice_model.inference_instruct2, "zero_shot_spk_id"):
        kwargs["zero_shot_spk_id"] = ""
    output = cosyvoice_model.inference_instruct2(**kwargs)
    chunks = []
    for chunk in output:
        speech = chunk.get("tts_speech") if isinstance(chunk, dict) else getattr(chunk, "tts_speech", None)
        if speech is None:
            continue
        array = _as_mono(speech)
        if array.size:
            chunks.append(array)
    if not chunks:
        raise RuntimeError("模型没有返回音频。")
    return np.concatenate(chunks).astype(np.float32, copy=False)


def _silence(seconds, sample_rate):
    count = int(round(float(seconds) * sample_rate))
    if count <= 0:
        return np.zeros(0, dtype=np.float32)
    return np.zeros(count, dtype=np.float32)


class _ExtraSpeakers(dict):
    """多人模式由前端临时加上的 S2..S6 参考音口。"""

    def __contains__(self, key):
        if dict.__contains__(self, key):
            return True
        return isinstance(key, str) and bool(re.fullmatch(r"S[2-6]", key))

    def __getitem__(self, key):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        return ("AUDIO", {"tooltip": f"{key} 的参考音。建议 3 到 10 秒，最长 30 秒。"})


def _connected_audio(value):
    if isinstance(value, (list, tuple)) and value:
        value = value[0]
    if isinstance(value, dict) and value.get("waveform") is not None and value.get("sample_rate"):
        return value
    return None


def _check_reference(audio, label):
    duration = _reference_duration(audio)
    if duration < 0.5:
        raise ValueError(f"{label}太短（{duration:.2f} 秒）。至少 0.5 秒，建议 3 到 10 秒。")
    if duration > 30.0:
        raise ValueError(f"{label}太长（{duration:.1f} 秒）。请先裁到 30 秒以内，建议 3 到 10 秒。")


class feimao_tools_CosyVoice_Solo:
    """按剧本合成一条配音。单人一条参考音，多人按 S1 到 S6 换人。"""

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("配音", "报告")
    FUNCTION = "generate"
    CATEGORY = "feimao tools"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("COSYVOICE_MODEL", {"tooltip": "接配音模型加载器。"}),
                "参考音频": ("AUDIO", {"tooltip": "单人模式的参考音，也是多人模式的 S1。建议 3 到 10 秒，最长 30 秒。"}),
                "模式": (MODES, {"default": "单人", "tooltip": "单人只使用左边这一条参考音。多人可以继续接 S2、S3。"}),
                "剧本": ("STRING", {
                    "multiline": True,
                    "default": "[普通话] 大家好，我是今天的讲述人。\n[开心] 今天只讲一件事。\n[pause 0.4]\n参考音控制在三到十秒。",
                    "tooltip": "一行一句。方言、情绪、副语和停顿用下面的标签写入。多人时在行首写 [S1]、[S2]。",
                }),
                "语速": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05}),
                "按句切分": ("BOOLEAN", {"default": True, "tooltip": "按句号、问号、感叹号分开合成。句内两种方言不切开。"}),
                "行间停顿": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 2.0, "step": 0.05, "tooltip": "两句台词之间额外加上的静音，单位秒。"}),
                "种子": ("INT", {"default": 0, "min": 0, "max": 2147483647, "control_after_generate": True}),
            },
            "optional": _ExtraSpeakers(),
        }

    def generate(self, 模型, 参考音频, 剧本, 语速, 按句切分, 行间停顿, 种子, 模式="单人", **speakers):
        multi = str(模式) == "多人"
        tasks = plan_tasks(剧本, "普通话", "自动", bool(按句切分), 行间停顿, multi)
        voices = {"S1": 参考音频}
        if multi:
            for slot in range(2, MAX_SPEAKERS + 1):
                audio = _connected_audio(speakers.get(f"S{slot}"))
                if audio is not None:
                    voices[f"S{slot}"] = audio
        speech_tasks = [task for task in tasks if isinstance(task, Speech)]
        used = []
        for task in speech_tasks:
            if task.speaker not in used:
                used.append(task.speaker)
        missing = [role for role in used if role not in voices]
        if missing:
            raise ValueError("剧本用了 " + "、".join(missing) + "，还没有接上对应的参考音。")
        for role in used:
            _check_reference(voices[role], "参考音" if role == "S1" and not multi else f"{role} 参考音")

        model_info = 模型 if isinstance(模型, dict) else {}
        cosyvoice_model = model_info.get("model") if isinstance(model_info, dict) else None
        if cosyvoice_model is None:
            raise ValueError("没有接到配音模型。请把配音模型加载器连到「模型」。")
        sample_rate = int(getattr(cosyvoice_model, "sample_rate", 24000) or 24000)
        is_v3 = _model_is_v3(model_info, cosyvoice_model)
        seed = int(种子)
        random.seed(seed)
        np.random.seed(seed % (2 ** 32))
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)

        try:
            import comfy.utils
            bar = comfy.utils.ProgressBar(len(speech_tasks))
        except Exception:
            bar = None

        paths = {}
        pieces = []
        done = 0
        try:
            for role in used:
                fd, path = tempfile.mkstemp(prefix=f"feimao_cosy_{role}_", suffix=".wav")
                os.close(fd)
                _save_reference(voices[role], path)
                paths[role] = path
            for task in tasks:
                if isinstance(task, Silence):
                    pieces.append(_silence(task.seconds, sample_rate))
                    continue
                print(
                    f"{LOG} {done + 1}/{len(speech_tasks)} {task.speaker} 第{task.line_no}行 {task.instruction} | {task.text[:40]}",
                    flush=True,
                )
                try:
                    pieces.append(_infer(cosyvoice_model, paths[task.speaker], task, 语速, is_v3))
                except Exception as exc:
                    raise RuntimeError(f"第 {task.line_no} 行合成失败：{task.text[:30]} ({exc})") from exc
                done += 1
                if bar is not None:
                    bar.update_absolute(done, len(speech_tasks))
        finally:
            for path in paths.values():
                try:
                    os.remove(path)
                except OSError:
                    pass

        pieces = [piece for piece in pieces if piece.size]
        if not pieces:
            raise RuntimeError("没有生成出音频。")
        audio = np.concatenate(pieces).astype(np.float32, copy=False)
        audio, used_lufs, measured = _normalize_loudness(audio, sample_rate)
        seconds = len(audio) / float(sample_rate)
        loudness = f"{TARGET_LUFS:.0f} LUFS" if used_lufs else f"按 RMS 近似到 {TARGET_LUFS:.0f}（未安装 pyloudnorm）"
        report = (
            f"{'多人' if multi else '单人'}配音完成\n"
            f"角色：{'、'.join(used)}\n"
            f"台词：{len(speech_tasks)} 段\n"
            f"时长：{seconds:.2f} 秒\n"
            f"采样率：{sample_rate}\n"
            f"语速：{float(语速):.2f}\n"
            f"响度：{loudness}\n"
            f"归一化前：{measured:.1f}"
        )
        print(f"{LOG} {report.replace(chr(10), ' | ')}", flush=True)
        waveform = torch.from_numpy(audio).reshape(1, 1, -1)
        return ({"waveform": waveform, "sample_rate": sample_rate}, report)


NODE_CLASS_MAPPINGS = {"feimao_tools_CosyVoice_Solo": feimao_tools_CosyVoice_Solo}
NODE_DISPLAY_NAME_MAPPINGS = {"feimao_tools_CosyVoice_Solo": "feimao tools 配音"}
