"""参考音：从输入目录选一条音频，按开始时间和时长截取。

界面上的试听和上传用 ComfyUI 自带的音频控件。截取发生在送出的音频上。
"""

import os

import av
import folder_paths
import torch


def _files():
    folder = folder_paths.get_input_directory()
    os.makedirs(folder, exist_ok=True)
    names = folder_paths.filter_files_content_types(os.listdir(folder), ["audio", "video"])
    return sorted(names)


def _pcm(wav):
    if wav.dtype.is_floating_point:
        return wav.float()
    if wav.dtype == torch.int16:
        return wav.float() / (2 ** 15)
    if wav.dtype == torch.int32:
        return wav.float() / (2 ** 31)
    raise ValueError(f"这种音频格式读不了：{wav.dtype}")


def _load(path):
    with av.open(path) as container:
        if not container.streams.audio:
            raise ValueError("这个文件里没有音频。")
        stream = container.streams.audio[0]
        sample_rate = stream.codec_context.sample_rate
        channels = stream.channels
        frames = []
        for frame in container.decode(streams=stream.index):
            buf = torch.from_numpy(frame.to_ndarray())
            if buf.shape[0] != channels:
                buf = buf.view(-1, channels).t()
            frames.append(buf)
        if not frames:
            raise ValueError("这个音频是空的。")
        wav = _pcm(torch.cat(frames, dim=1))
        return wav, int(sample_rate)


def _clip(wav, sample_rate, start, duration):
    total = int(wav.shape[-1])
    begin = max(0, int(round(float(start) * sample_rate)))
    if begin >= total:
        raise ValueError(f"开始时间已经超过音频长度（{total / sample_rate:.2f} 秒）。")
    if float(duration) <= 0:
        end = total
    else:
        end = begin + int(round(float(duration) * sample_rate))
    end = min(total, end)
    if begin >= end:
        raise ValueError("截出来是空的。把时长改大，或把开始时间往前移。")
    return wav[..., begin:end]


class feimao_tools_Audio_Clip:
    """选择参考音，并按秒截取。"""

    RETURN_TYPES = ("AUDIO", "FLOAT")
    RETURN_NAMES = ("音频", "秒数")
    FUNCTION = "load"
    CATEGORY = "feimao tools"

    @classmethod
    def INPUT_TYPES(cls):
        files = _files()
        return {
            "required": {
                "audio": (files, {
                    "audio_upload": True,
                    "tooltip": "从输入目录选一条参考音，也可以直接上传。",
                }),
                "开始": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 100000.0,
                    "step": 0.01,
                    "tooltip": "从第几秒开始截。",
                }),
                "时长": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 100000.0,
                    "step": 0.01,
                    "tooltip": "截多少秒。0 表示从开始一直放到结尾。参考音建议 3 到 10 秒。",
                }),
            },
            "optional": {
                # 上传按钮创建时会立刻读这个试听控件。没有它，节点创建会中断。
                "audioUI": ("AUDIO_UI", {}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, audio, 开始=0, 时长=0, **_kwargs):
        path = folder_paths.get_annotated_filepath(str(audio))
        stamp = os.stat(path)
        return f"{stamp.st_mtime_ns}:{stamp.st_size}:{开始}:{时长}"

    @classmethod
    def VALIDATE_INPUTS(cls, audio, **kwargs):
        if not str(audio or "").strip():
            return "请先选择参考音"
        if not folder_paths.exists_annotated_filepath(str(audio)):
            return f"找不到参考音：{audio}"
        return True

    def load(self, audio, 开始, 时长, audioUI=None):
        if not str(audio or "").strip():
            raise ValueError("请先选择参考音。")
        path = folder_paths.get_annotated_filepath(str(audio))
        if not os.path.isfile(path):
            raise ValueError(f"找不到参考音：{audio}")
        wav, sample_rate = _load(path)
        clip = _clip(wav, sample_rate, 开始, 时长)
        seconds = round(clip.shape[-1] / float(sample_rate), 2)
        packed = {"waveform": clip.unsqueeze(0), "sample_rate": sample_rate}
        return (packed, seconds)


NODE_CLASS_MAPPINGS = {"feimao_tools_Audio_Clip": feimao_tools_Audio_Clip}
NODE_DISPLAY_NAME_MAPPINGS = {"feimao_tools_Audio_Clip": "feimao tools 参考音"}
