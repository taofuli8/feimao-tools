"""YuE2 music node: text-to-song, cover, ABC score, and instrumental.

Text-to-song writes an ABC score, then sings it.
Cover transcribes a reference recording with SheetSage2 and follows that melody.
ABC mode sings the score connected on the left.
Instrumental is the two-pass backing track from the song/instrumental/cover
workflow: draft, drop vocals, transcribe the backing, regenerate, drop vocals
again. The style sent to the model always contains "no vocals".
"""

import inspect


def _node_class(class_name):
    import nodes

    try:
        return nodes.NODE_CLASS_MAPPINGS[class_name]
    except KeyError as exc:
        raise RuntimeError(f"找不到节点 {class_name}") from exc


def _fill_input_defaults(cls, kwargs, params, has_var_keyword):
    try:
        spec = cls.INPUT_TYPES()
    except Exception:
        return kwargs
    if not isinstance(spec, dict):
        return kwargs
    for section in ("required", "optional"):
        for name, definition in (spec.get(section) or {}).items():
            if name in kwargs:
                continue
            if not has_var_keyword and params is not None and name not in params:
                continue
            if not isinstance(definition, (list, tuple)) or not definition:
                continue
            options = definition[1] if len(definition) > 1 else None
            if isinstance(options, dict) and "default" in options:
                kwargs[name] = options["default"]
            elif isinstance(definition[0], (list, tuple)) and definition[0]:
                kwargs[name] = definition[0][0]
    return kwargs


def _unwrap_result(result):
    args = getattr(result, "args", None)
    if args is not None:
        return tuple(args)
    if isinstance(result, dict):
        return tuple(result.get("result", ()))
    return result


def _call_node(class_name, **kwargs):
    cls = _node_class(class_name)
    node = cls()
    fn_name = getattr(cls, "FUNCTION", None)
    if not fn_name:
        raise RuntimeError(f"节点 {class_name} 没有 FUNCTION")
    fn = getattr(node, fn_name)
    signature = inspect.signature(fn)
    has_var_keyword = any(
        param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()
    )
    params = None if has_var_keyword else signature.parameters
    if has_var_keyword and hasattr(cls, "execute"):
        try:
            execute_params = inspect.signature(cls.execute).parameters
            if not any(p.kind == inspect.Parameter.VAR_KEYWORD for p in execute_params.values()):
                params = execute_params
                has_var_keyword = False
        except (TypeError, ValueError):
            pass
    kwargs = _fill_input_defaults(cls, dict(kwargs), params, has_var_keyword)
    if has_var_keyword or params is None:
        return _unwrap_result(fn(**kwargs))
    filtered = {key: value for key, value in kwargs.items() if key in params}
    return _unwrap_result(fn(**filtered))


MODE_SONG = "文生音乐"
MODE_COVER = "音乐翻唱"
MODE_ABC = "ABC曲谱"
MODE_INSTRUMENTAL = "纯音乐"
MODES = [MODE_SONG, MODE_COVER, MODE_ABC, MODE_INSTRUMENTAL]

DEFAULT_CHECKPOINT = "yue2_3b_int8_convrot.safetensors"
STEPS = 32
CFG = 1.0
SAMPLER = "dpm_2"
SCHEDULER = "sgm_uniform"


def _folder_list(kind):
    try:
        import folder_paths

        return list(folder_paths.get_filename_list(kind))
    except Exception:
        return []


def _checkpoint_names():
    names = _folder_list("checkpoints")
    return names or [DEFAULT_CHECKPOINT]


def _default_checkpoint(names):
    for name in names:
        if "yue2" in name.lower():
            return name
    return names[0]


def _input_audio_names():
    try:
        import os

        import folder_paths

        folder = folder_paths.get_input_directory()
        os.makedirs(folder, exist_ok=True)
        files = folder_paths.filter_files_content_types(os.listdir(folder), ["audio", "video"])
        return sorted(files)
    except Exception:
        return []


def _default_reference(names):
    for name in names:
        if "自己的音色" in name:
            return name
    return names[0] if names else ""


def _separator_names():
    names = _folder_list("diffusion_models")
    matched = [name for name in names if "melband" in name.lower() or "roformer" in name.lower()]
    return matched or names or ["MelBandRoformer_fp32.safetensors"]


def _default_separator(names):
    for name in names:
        key = name.lower()
        if "melband" in key or "roformer" in key:
            return name
    return names[0]


def _sheetsage_names():
    names = _folder_list("audio_encoders")
    matched = [name for name in names if "sheetsage" in name.lower()]
    return matched or names or ["sheetsage2_bf16.safetensors"]


def _default_sheetsage(names):
    for name in names:
        if "sheetsage" in name.lower():
            return name
    return names[0]


def _text(value):
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _require_text(value, label):
    text = _text(value)
    if not text:
        raise RuntimeError(f"请先写{label}")
    return text


def _with_no_vocals(style):
    """Instrumental style always carries this prompt, written or not."""
    text = _text(style)
    if "no vocals" in text.lower():
        return text or "no vocals"
    if text:
        return text.rstrip(" ,，;；") + ", no vocals"
    return "no vocals"


def _abc_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        parts = [_abc_text(item) for item in value]
        return "\n\n".join(part for part in parts if part.strip())
    return str(value).strip()


def _load_yue2(ckpt_name):
    model, clip, vae = _call_node("CheckpointLoaderSimple", ckpt_name=ckpt_name)
    return model, clip, vae


def _write_abc(clip, style, lyrics, seed):
    abc = _call_node(
        "YuE2GenerateABC",
        clip=clip,
        style=style,
        lyrics=lyrics,
        seed=int(seed),
        mode="full",
        max_abc_tokens=8192,
    )[0]
    text = _abc_text(abc)
    if not text:
        raise RuntimeError("ABC 曲谱没有写出来")
    return text


def _transcribe(audio, melody, encoder_name):
    encoder = _call_node("AudioEncoderLoader", audio_encoder_name=encoder_name)[0]
    abc = _call_node(
        "SheetSage2AudioToABC",
        audio_encoder=encoder,
        audio=audio,
        mode="melody" if melody else "full",
    )[0]
    text = _abc_text(abc)
    if not text:
        raise RuntimeError("参考音频没有转成 ABC 曲谱")
    return text


def _render(model, clip, vae, style, lyrics, abc, seed, mode, max_duration):
    conditioning, seconds = _call_node(
        "YuE2GenerateMusic",
        clip=clip,
        style=style,
        lyrics=lyrics,
        abc=abc,
        seed=int(seed),
        mode=mode,
        max_duration=float(max_duration),
        cfg_scale=1.0,
    )
    negative = _call_node("ConditioningZeroOut", conditioning=conditioning)[0]
    latent = _call_node("EmptyYuE2LatentAudio", seconds=float(seconds), batch_size=1)[0]
    sampled = _call_node(
        "KSampler",
        model=model,
        positive=conditioning,
        negative=negative,
        latent_image=latent,
        seed=int(seed),
        steps=STEPS,
        cfg=CFG,
        sampler_name=SAMPLER,
        scheduler=SCHEDULER,
        denoise=1.0,
    )[0]
    return _call_node("VAEDecodeAudio", samples=sampled, vae=vae)[0]


def _backing_track(audio, model_name):
    model = _call_node("MelBandRoFormerModelLoader", model_name=model_name)[0]
    _vocals, instruments = _call_node("MelBandRoFormerSampler", model=model, audio=audio)
    return instruments


class YuE2MusicCreate:
    """One YuE2 node for text-to-song, cover, ABC, and instrumental."""

    @classmethod
    def INPUT_TYPES(cls):
        names = _checkpoint_names()
        separators = _separator_names()
        sheets = _sheetsage_names()
        references = _input_audio_names()
        return {
            "required": {
                "制作类型": (MODES, {"default": MODE_SONG}),
                "音乐描述": (
                    "STRING",
                    {
                        "multiline": True,
                        "display_name": "风格",
                        "default": "Upbeat indie pop with warm female vocals, bright electric guitars, punchy drums, melodic bass, and subtle synth layers.",
                        "tooltip": "风格、乐器、人声、节奏。纯音乐不管这里写不写，都会带上 no vocals。",
                    },
                ),
                "歌词": (
                    "STRING",
                    {
                        "multiline": True,
                        "display_name": "歌词",
                        "default": "[Verse]\nMorning light across the window\nCity waking down below\n\n[Chorus]\nRun with me into the sunlight\nLeave the shadows far behind",
                        "tooltip": "纯音乐和 ABC曲谱会忽略歌词。",
                    },
                ),
                "audio": (
                    references or [""],
                    {
                        "default": _default_reference(references),
                        "audio_upload": True,
                        "display_name": "参考音乐",
                        "tooltip": "翻唱的参考音乐。下拉选已有文件，右边按钮打开文件管理器。左边连了参考音频时，用左边的。",
                    },
                ),
                "模型": (names, {"default": _default_checkpoint(names)}),
                "分离模型": (
                    separators,
                    {
                        "default": _default_separator(separators),
                        "tooltip": "纯音乐去掉人声用的模型，和主模型一样可以选。文生音乐、翻唱、ABC 不用它。",
                    },
                ),
                "听写模型": (
                    sheets,
                    {
                        "default": _default_sheetsage(sheets),
                        "tooltip": "SheetSage2。翻唱时把参考音乐听成曲谱，纯音乐时把去掉人声后的伴奏听成曲谱。",
                    },
                ),
                "时长": (
                    "INT",
                    {
                        "default": 360,
                        "min": 1,
                        "max": 900,
                        "step": 1,
                        "tooltip": "最长秒数。生成可以比这个更短。",
                    },
                ),
                "种子": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": True,
                    },
                ),
            },
            "optional": {
                "参考音频": (
                    "AUDIO",
                    {
                        "tooltip": "连上之后，翻唱优先用这路，节点里选的参考音乐不用。",
                    },
                ),
                "ABC曲谱": (
                    "STRING",
                    {
                        "forceInput": True,
                        "lazy": True,
                        "tooltip": "ABC曲谱模式时连上。其他模式不跑这条线。",
                    },
                ),
                # 官方上传按钮会立刻读这个预览控件。没有它时节点创建会中断，类型变成空的。
                "audioUI": ("AUDIO_UI", {"hidden": True}),
            },
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("音乐", "ABC曲谱")
    FUNCTION = "generate"
    CATEGORY = "feimao tools"
    DESCRIPTION = "文生音乐、翻唱、ABC曲谱、纯音乐。纯音乐的风格始终带 no vocals。"

    def check_lazy_status(self, 制作类型, ABC曲谱=None, **_kwargs):
        if 制作类型 == MODE_ABC and ABC曲谱 is None:
            return ["ABC曲谱"]
        return []

    def generate(self, 制作类型, 音乐描述, 歌词, audio, 模型, 分离模型, 听写模型, 时长, 种子, 参考音频=None, ABC曲谱=None, audioUI=None):
        if 制作类型 not in MODES:
            raise RuntimeError("请选择文生音乐、音乐翻唱、ABC曲谱或纯音乐")
        duration = int(时长)
        if duration < 1 or duration > 900:
            raise RuntimeError("时长要在 1 到 900 秒之间")
        seed = int(种子)

        if 制作类型 == MODE_INSTRUMENTAL:
            style = _with_no_vocals(音乐描述)
            lyrics = ""
            separator = _text(分离模型) or _default_separator(_separator_names())
            sheet = _text(听写模型) or _default_sheetsage(_sheetsage_names())
            print(f"[YuE2 音乐创作] 纯音乐，风格：{style}", flush=True)
            model, clip, vae = _load_yue2(模型)
            draft_abc = _write_abc(clip, style, lyrics, seed)
            draft = _render(model, clip, vae, style, lyrics, draft_abc, seed, "full", duration)
            backing = _backing_track(draft, separator)
            abc = _transcribe(backing, True, sheet)
            refined = _render(model, clip, vae, style, lyrics, abc, seed, "melody", duration)
            audio = _backing_track(refined, separator)
            return (audio, abc)

        style = _require_text(音乐描述, "风格")
        model, clip, vae = _load_yue2(模型)

        if 制作类型 == MODE_SONG:
            lyrics = _require_text(歌词, "歌词")
            print("[YuE2 音乐创作] 文生音乐", flush=True)
            abc = _write_abc(clip, style, lyrics, seed)
            audio = _render(model, clip, vae, style, lyrics, abc, seed, "full", duration)
            return (audio, abc)

        if 制作类型 == MODE_COVER:
            lyrics = _require_text(歌词, "歌词")
            if 参考音频 is not None:
                reference = 参考音频
                print("[YuE2 音乐创作] 音乐翻唱，使用外部参考音频", flush=True)
            else:
                filename = _text(audio)
                if not filename:
                    raise RuntimeError("音乐翻唱需要在节点里选择参考音乐，或把参考音频连到左边")
                reference = _call_node("LoadAudio", audio=filename)[0]
                print(f"[YuE2 音乐创作] 音乐翻唱，使用节点内参考音乐：{filename}", flush=True)
            sheet = _text(听写模型) or _default_sheetsage(_sheetsage_names())
            abc = _transcribe(reference, True, sheet)
            audio = _render(model, clip, vae, style, lyrics, abc, seed, "melody", duration)
            return (audio, abc)

        lyrics = ""
        abc = _abc_text(ABC曲谱)
        if not abc:
            raise RuntimeError("ABC曲谱模式需要把曲谱连到左边的「ABC曲谱」")
        print("[YuE2 音乐创作] ABC曲谱", flush=True)
        audio = _render(model, clip, vae, style, lyrics, abc, seed, "full", duration)
        return (audio, abc)


NODE_CLASS_MAPPINGS = {"YuE2MusicCreate": YuE2MusicCreate}
NODE_DISPLAY_NAME_MAPPINGS = {"YuE2MusicCreate": "feimao yue2"}
