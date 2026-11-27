"""Batch speech, subtitle, and media nodes that belong to feimao tools."""

from .nodes import (
    BatchRecognize,
    BatchRecognizeQwen,
    ExtractMediaAudio,
    ImageReverseBrief,
    ImageSource,
    InputFilePath,
    MediaSource,
    PreviewEditSubtitle,
    ReviewBatchText,
    SaveSubtitleAs,
    TextGallery,
    VideoCaptionChoice,
    VideoReverseBrief,
)
from .segment import MediaSegment

NODE_CLASS_MAPPINGS = {
    "InputFilePath": InputFilePath,
    "ExtractMediaAudio": ExtractMediaAudio,
    "PreviewEditSubtitle": PreviewEditSubtitle,
    "SaveSubtitleAs": SaveSubtitleAs,
    "MediaSource": MediaSource,
    "BatchRecognize": BatchRecognize,
    "BatchRecognizeQwen": BatchRecognizeQwen,
    "ReviewBatchText": ReviewBatchText,
    "TextGallery": TextGallery,
    "VideoCaptionChoice": VideoCaptionChoice,
    "VideoReverseBrief": VideoReverseBrief,
    "ImageSource": ImageSource,
    "ImageReverseBrief": ImageReverseBrief,
    "MediaSegment": MediaSegment,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InputFilePath": "选择音视频",
    "ExtractMediaAudio": "视频抽成音频",
    "PreviewEditSubtitle": "预览修改字幕",
    "SaveSubtitleAs": "另存为字幕",
    "MediaSource": "素材库",
    "BatchRecognize": "识别并保存 Whisper",
    "BatchRecognizeQwen": "识别并保存 QwenASR",
    "ReviewBatchText": "编辑文稿",
    "TextGallery": "文稿库",
    "VideoCaptionChoice": "反推模型",
    "VideoReverseBrief": "视频反推",
    "ImageSource": "图片库",
    "ImageReverseBrief": "图片反推",
    "MediaSegment": "音视频分段",
}
