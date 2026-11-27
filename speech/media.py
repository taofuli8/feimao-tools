from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import folder_paths

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg", ".wma"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpeg", ".mpg"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def find_ffmpeg() -> str:
    env = os.environ.get("VHS_FORCE_FFMPEG_PATH")
    if env and os.path.isfile(env):
        return env
    which = shutil.which("ffmpeg")
    if which:
        return which
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        exe = get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return exe
    except Exception:
        pass
    try:
        from videohelpersuite.utils import ffmpeg_path

        if ffmpeg_path and os.path.isfile(ffmpeg_path):
            return ffmpeg_path
    except Exception:
        pass
    raise RuntimeError("找不到 FFmpeg，没法从音视频抽音频")


def resolve_media_path(value: str) -> str:
    path = (value or "").strip().strip('"').replace("/", "\\")
    if not path:
        raise ValueError("请先选择音视频文件")
    if "\ufffd" in path or "◆" in path:
        raise ValueError("路径中文乱码了，请重新点「选择音视频文件」")
    candidate = Path(path)
    if candidate.is_file():
        return str(candidate.resolve())
    annotated = folder_paths.get_annotated_filepath(path)
    if annotated and os.path.isfile(annotated):
        return str(Path(annotated).resolve())
    raise ValueError(f"找不到文件: {path}")


def _list_by_ext(folder: str, exts: set, empty: str) -> list:
    root = Path(folder)
    if not root.is_dir():
        raise ValueError(f"找不到文件夹: {folder}")
    files = [item for item in root.iterdir() if item.is_file() and item.suffix.lower() in exts]
    files.sort(key=lambda item: item.name)
    if not files:
        raise ValueError(empty)
    return [str(item.resolve()) for item in files]


def list_media_files(folder: str) -> list:
    return _list_by_ext(folder, AUDIO_EXT | VIDEO_EXT, "这个文件夹里没有音视频")


def list_image_files(folder: str) -> list:
    return _list_by_ext(folder, IMAGE_EXT, "这个文件夹里没有图片")


def extract_audio_wav(src: str) -> str:
    src = resolve_media_path(src)
    ffmpeg = find_ffmpeg()
    temp_dir = Path(folder_paths.get_temp_directory()) / "whisper_audio"
    temp_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(os.path.getmtime(src))
    name = hashlib.md5(src.encode("utf-8")).hexdigest() + f"_{stamp}.wav"
    dest = temp_dir / name
    if dest.is_file() and dest.stat().st_size > 0:
        return str(dest)
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        src,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size <= 0:
        err = (proc.stderr or proc.stdout or "").strip()[-800:]
        raise RuntimeError(f"FFmpeg 抽音频失败: {err or '未知错误'}")
    return str(dest)


def separate_vocals_wav(src: str) -> str:
    src = resolve_media_path(src)
    ffmpeg = find_ffmpeg()
    temp_dir = Path(folder_paths.get_temp_directory()) / "whisper_audio"
    temp_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(os.path.getmtime(src))
    key = hashlib.md5(src.encode("utf-8")).hexdigest() + f"_{stamp}"
    dest = temp_dir / f"{key}_vocals.wav"
    if dest.is_file() and dest.stat().st_size > 0:
        return str(dest)
    mix = temp_dir / f"{key}_mix.wav"
    if not mix.is_file() or mix.stat().st_size <= 0:
        cmd = [ffmpeg, "-y", "-i", src, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(mix)]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if proc.returncode != 0 or not mix.is_file():
            err = (proc.stderr or proc.stdout or "").strip()[-800:]
            raise RuntimeError(f"抽伴奏用的音频失败: {err or '未知错误'}")
    _write_demucs_vocals(mix, dest)
    return str(dest)


def _read_wav(path: Path):
    import numpy as np
    import torch
    import wave

    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    audio = torch.from_numpy(audio.reshape(-1, channels).T.copy())
    return audio, rate


def _write_wav(path: Path, audio, rate: int) -> None:
    import numpy as np
    import wave

    samples = audio.detach().cpu().numpy().reshape(-1)
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def _local_demucs_weight() -> Path | None:
    path = Path(folder_paths.models_dir) / "audio_separation" / "hdemucs_high_trained.pt"
    if path.is_file() and path.stat().st_size > 1_000_000:
        return path
    return None


def _load_demucs_model():
    import torch
    from torchaudio.models import hdemucs_high

    sources = ["drums", "bass", "other", "vocals"]
    weight = _local_demucs_weight()
    if weight is not None:
        model = hdemucs_high(sources=sources).eval()
        state = torch.load(str(weight), map_location="cpu")
        model.load_state_dict(state)
        return model
    from torchaudio.pipelines import HDEMUCS_HIGH_MUSDB_PLUS

    return HDEMUCS_HIGH_MUSDB_PLUS.get_model().eval()


def _write_demucs_vocals(mix: Path, dest: Path) -> None:
    import torch
    import torchaudio
    from torchaudio.transforms import Fade

    model_rate = 44100
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = _load_demucs_model().to(device).eval()
    waveform, sample_rate = _read_wav(mix)
    if waveform.shape[0] == 1:
        waveform = waveform.repeat(2, 1)
    if sample_rate != model_rate:
        waveform = torchaudio.functional.resample(waveform, sample_rate, model_rate)
    reference = waveform.mean(0)
    std = reference.std().clamp(min=1e-8)
    waveform = (waveform - reference.mean()) / std
    mixture = waveform.unsqueeze(0).to(device)
    sample_rate = model_rate
    segment = 10.0
    overlap = 0.1
    chunk_len = int(sample_rate * segment * (1 + overlap))
    overlap_frames = int(overlap * sample_rate)
    length = mixture.shape[-1]
    fade = Fade(fade_in_len=0, fade_out_len=overlap_frames, fade_shape="linear").to(device)
    final = torch.zeros(1, len(model.sources), mixture.shape[1], length, device=device)
    start = 0
    end = chunk_len
    with torch.no_grad():
        while start < length - overlap_frames:
            chunk = mixture[:, :, start:end]
            out = fade(model(chunk))
            stop = min(end, length)
            final[:, :, :, start:stop] += out[:, :, :, : stop - start]
            if start == 0:
                fade.fade_in_len = overlap_frames
                start += chunk_len - overlap_frames
            else:
                start += chunk_len
            end += chunk_len
            if end >= length:
                fade.fade_out_len = 0
    vocal_index = list(model.sources).index("vocals")
    vocals = final[0, vocal_index].cpu() * std.cpu() + reference.mean().cpu()
    mono = vocals.mean(dim=0, keepdim=True)
    mono = torchaudio.functional.resample(mono, sample_rate, 16000)
    peak = mono.abs().max().clamp(min=1e-8)
    if float(peak) > 1:
        mono = mono / peak
    _write_wav(dest, mono, 16000)
    model.cpu()
    del model, final, mixture
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def windows_pick_file() -> str:
    return _pick_file_win32(save=False)


def _tk_root():
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        root.lift()
        root.focus_force()
        root.update()
    except Exception:
        pass
    return root


def _pick_files(title: str, pattern: str) -> list:
    from tkinter import filedialog

    root = _tk_root()
    try:
        picked = filedialog.askopenfilenames(
            parent=root,
            title=title,
            filetypes=[(title, pattern), ("所有文件", "*.*")],
        )
    finally:
        root.destroy()
    return [str(Path(item)) for item in picked]


def windows_pick_files() -> list:
    return _pick_files(
        "选择音视频，可多选",
        "*.mp4 *.mov *.mkv *.webm *.avi *.m4v *.mpeg *.mpg *.wav *.mp3 *.m4a *.flac *.aac *.ogg *.wma",
    )


def windows_pick_images() -> list:
    return _pick_files("选择图片，可多选", "*.jpg *.jpeg *.png *.webp *.bmp *.gif")


def windows_pick_folder() -> str:
    """Open the Explorer folder window used by Windows itself."""
    import ctypes
    from ctypes import wintypes

    CLSCTX_INPROC_SERVER = 1
    FOS_PICKFOLDERS = 0x20
    FOS_FORCEFILESYSTEM = 0x40
    FOS_PATHMUSTEXIST = 0x800
    SIGDN_FILESYSPATH = 0x80058000
    ole32 = ctypes.windll.ole32
    ole32.CoInitialize(None)
    try:
        class GUID(ctypes.Structure):
            _fields_ = [
                ("Data1", ctypes.c_ulong),
                ("Data2", ctypes.c_ushort),
                ("Data3", ctypes.c_ushort),
                ("Data4", ctypes.c_ubyte * 8),
            ]

        clsid = GUID()
        iid = GUID()
        ole32.CLSIDFromString("{DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7}", ctypes.byref(clsid))
        ole32.CLSIDFromString("{D57C7288-D4AD-4768-BE02-9D969532D960}", ctypes.byref(iid))
        dialog = ctypes.c_void_p()
        hr = ole32.CoCreateInstance(
            ctypes.byref(clsid), None, CLSCTX_INPROC_SERVER, ctypes.byref(iid), ctypes.byref(dialog)
        )
        if hr != 0 or not dialog:
            raise RuntimeError(f"无法打开资源管理器：{hr}")
        vtbl = ctypes.cast(dialog, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]

        def com(index, restype, *argtypes):
            return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(vtbl[index])

        options = wintypes.DWORD()
        com(10, ctypes.HRESULT, ctypes.POINTER(wintypes.DWORD))(dialog, ctypes.byref(options))
        com(9, ctypes.HRESULT, wintypes.DWORD)(
            dialog, options.value | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
        )
        com(17, ctypes.HRESULT, wintypes.LPCWSTR)(dialog, "选择保存位置")
        user32 = ctypes.windll.user32
        user32.GetForegroundWindow.restype = wintypes.HWND
        hwnd = user32.GetForegroundWindow()
        shown = com(3, ctypes.HRESULT, wintypes.HWND)(dialog, hwnd)
        if shown != 0:
            com(2, ctypes.c_ulong)(dialog)
            return ""
        item = ctypes.c_void_p()
        com(20, ctypes.HRESULT, ctypes.POINTER(ctypes.c_void_p))(dialog, ctypes.byref(item))
        item_vtbl = ctypes.cast(item, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
        name = ctypes.c_wchar_p()
        ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_wchar_p))(item_vtbl[5])(
            item, SIGDN_FILESYSPATH, ctypes.byref(name)
        )
        path = name.value or ""
        if name:
            ole32.CoTaskMemFree(name)
        ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(item_vtbl[2])(item)
        com(2, ctypes.c_ulong)(dialog)
        return path
    finally:
        ole32.CoUninitialize()


def delete_text_files(paths: list) -> list:
    removed = []
    for raw in paths or []:
        target = Path(str(raw or "").strip().strip('"'))
        if target.suffix.lower() not in {".txt", ".srt"}:
            continue
        if target.is_file():
            target.unlink()
        removed.append(str(target))
    return removed


def reveal_in_explorer(path: str) -> None:
    target = Path(str(path or "").strip().strip('"'))
    if not target.exists():
        raise ValueError("文件不存在")
    subprocess.Popen(["explorer", f"/select,{target}"])


def write_text_file(path: str, content: str) -> str:
    target = Path(path)
    if target.suffix.lower() not in {".txt", ".srt"}:
        raise ValueError("只能写入 txt 或 srt 文件")
    if not target.parent.is_dir():
        raise ValueError("保存目录不存在")
    target.write_text(content if content.endswith("\n") or content == "" else content + "\n", encoding="utf-8-sig")
    return str(target)


def windows_save_file(suggested: str = "教程字幕.srt") -> str:
    return _powershell_dialog(save=True, suggested=suggested)


def resolve_save_path(value: str, fmt: str = ".srt") -> str:
    path = (value or "").strip().strip('"')
    if not path:
        raise ValueError("请先点「另存为」选择保存位置")
    if not os.path.splitext(path)[1]:
        path += fmt if fmt.startswith(".") else f".{fmt}"
    return str(Path(path))


def _pick_file_win32(save: bool = False, suggested: str = "教程字幕.srt") -> str:
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", ctypes.c_void_p),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    OFN_FILEMUSTEXIST = 0x00001000
    OFN_PATHMUSTEXIST = 0x00000800
    OFN_EXPLORER = 0x00080000
    OFN_NOCHANGEDIR = 0x00000008
    OFN_HIDEREADONLY = 0x00000004
    OFN_OVERWRITEPROMPT = 0x00000002

    buf = ctypes.create_unicode_buffer(32768)
    if save and suggested:
        buf.value = os.path.basename(suggested)
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.hwndOwner = ctypes.windll.user32.GetForegroundWindow()
    ofn.lpstrFile = buf
    ofn.nMaxFile = len(buf)
    if save:
        ofn.lpstrFilter = "字幕\0*.srt;*.vtt\0所有文件\0*.*\0\0"
        ofn.lpstrTitle = "另存为字幕"
        ofn.lpstrDefExt = "srt"
        ofn.Flags = OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY
        ok = ctypes.windll.comdlg32.GetSaveFileNameW(ctypes.byref(ofn))
    else:
        ofn.lpstrFilter = (
            "音视频\0*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v;*.wav;*.mp3;*.m4a;*.flac;*.aac;*.ogg\0"
            "所有文件\0*.*\0\0"
        )
        ofn.lpstrTitle = "选择要转字幕的音视频"
        ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_HIDEREADONLY
        ok = ctypes.windll.comdlg32.GetOpenFileNameW(ctypes.byref(ofn))
    return buf.value if ok else ""


def _pick_files_win32() -> list:
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", ctypes.c_void_p),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    buf = ctypes.create_unicode_buffer(65536)
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.hwndOwner = ctypes.windll.user32.GetForegroundWindow()
    ofn.lpstrFile = buf
    ofn.nMaxFile = len(buf)
    ofn.lpstrFilter = (
        "音视频\0*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v;*.mpeg;*.mpg;*.wav;*.mp3;*.m4a;*.flac;*.aac;*.ogg;*.wma\0"
        "所有文件\0*.*\0\0"
    )
    ofn.lpstrTitle = "选择音视频"
    ofn.Flags = 0x00001000 | 0x00000800 | 0x00080000 | 0x00000008 | 0x00000004 | 0x00000200
    ok = ctypes.windll.comdlg32.GetOpenFileNameW(ctypes.byref(ofn))
    if not ok:
        return []
    parts = []
    current = []
    nulls = 0
    for char in buf:
        if char == "\0":
            nulls += 1
            if nulls >= 2:
                break
            if current:
                parts.append("".join(current))
                current = []
        else:
            nulls = 0
            current.append(char)
    if current:
        parts.append("".join(current))
    if len(parts) <= 1:
        return [parts[0]] if parts else []
    folder = parts[0]
    return [str(Path(folder) / name) for name in parts[1:] if name]


def video_thumb(src: str) -> str:
    src = resolve_media_path(src)
    if Path(src).suffix.lower() not in VIDEO_EXT:
        return ""
    ffmpeg = find_ffmpeg()
    temp_dir = Path(folder_paths.get_temp_directory()) / "whisper_thumb"
    temp_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(os.path.getmtime(src))
    dest = temp_dir / (hashlib.md5(src.encode("utf-8")).hexdigest() + f"_{stamp}.jpg")
    if dest.is_file() and dest.stat().st_size > 0:
        return str(dest)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for start in ("1", "0"):
        cmd = [ffmpeg, "-y", "-ss", start, "-i", src, "-frames:v", "1", "-vf", "scale=320:-1", str(dest)]
        subprocess.run(cmd, capture_output=True, creationflags=flags)
        if dest.is_file() and dest.stat().st_size > 0:
            return str(dest)
    return ""


def _powershell_dialog(save: bool, suggested: str = "教程字幕.srt") -> str:
    import tempfile

    out = Path(tempfile.gettempdir()) / (
        "fasterwhisper_save_utf8.txt" if save else "fasterwhisper_pick_utf8.txt"
    )
    if out.exists():
        out.unlink()
    out_posix = str(out).replace("'", "''")
    name = os.path.basename(suggested or "教程字幕.srt").replace("'", "''")
    if save:
        setup = f"""
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = "TXT (*.txt)|*.txt|SRT (*.srt)|*.srt"
$d.Title = "Save as"
$d.FileName = '{name}'
$d.DefaultExt = [System.IO.Path]::GetExtension('{name}').TrimStart('.')
if (-not $d.DefaultExt) {{ $d.DefaultExt = 'txt' }}
$d.AddExtension = $true
$d.OverwritePrompt = $true
$d.RestoreDirectory = $true
"""
    else:
        setup = """
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "Media|*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v;*.wav;*.mp3;*.m4a;*.flac;*.aac;*.ogg|All|*.*"
$d.Title = "Select media"
$d.CheckFileExists = $true
$d.RestoreDirectory = $true
"""
    script = f"""
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
{setup}
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-4000, -4000)
$form.Show()
$form.Activate()
$r = $d.ShowDialog($form)
$form.Close()
$form.Dispose()
if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.FileName) {{
  [System.IO.File]::WriteAllText('{out_posix}', $d.FileName, [System.Text.UTF8Encoding]::new($false))
}}
"""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script],
        capture_output=True,
        timeout=600,
        creationflags=flags,
    )
    if not out.is_file():
        return ""
    return out.read_text(encoding="utf-8").strip()


def find_media_by_names(names: list, exts=None) -> dict:
    """Match a dropped filename to a real file. A # in the name breaks drag-and-drop paths."""
    allowed = set(exts) if exts is not None else (AUDIO_EXT | VIDEO_EXT)
    home = Path.home()
    roots = [
        home / "Downloads",
        home / "Desktop",
        home / "Videos",
        home / "Pictures",
        Path(r"D:\AI视频"),
        Path(r"F:\素材库"),
    ]
    roots = [root for root in roots if root.is_dir()]
    found = []
    missing = []
    for raw in names or []:
        name = str(raw or "").strip().strip('"')
        if not name:
            continue
        direct = Path(name)
        if direct.is_file() and direct.suffix.lower() in allowed:
            found.append(str(direct.resolve()))
            continue
        leaf = Path(name).name
        if not leaf or leaf in {".", ".."}:
            missing.append(name)
            continue
        matches = []
        for root in roots:
            candidate = root / leaf
            if candidate.is_file():
                matches.append(candidate)
            try:
                children = list(root.iterdir())
            except OSError:
                children = []
            for child in children:
                if not child.is_dir():
                    continue
                nested = child / leaf
                if nested.is_file():
                    matches.append(nested)
        unique = []
        seen = set()
        for path in matches:
            key = str(path.resolve()).lower()
            if key in seen:
                continue
            seen.add(key)
            if path.suffix.lower() in allowed:
                unique.append(path)
        if len(unique) == 1:
            found.append(str(unique[0].resolve()))
        else:
            missing.append(leaf)
    return {"paths": found, "missing": missing}


def register_routes() -> None:
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return
    if getattr(instance, "_fasterwhisper_routes", False):
        return
    instance._fasterwhisper_routes = True

    @instance.routes.post("/fasterwhisper/pick_file")
    async def pick_file(_request):
        path = await asyncio.to_thread(windows_pick_file)
        return web.json_response(
            {"path": path},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/pick_files")
    async def pick_files(_request):
        paths = await asyncio.to_thread(windows_pick_files)
        return web.json_response(
            {"paths": paths},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/pick_images")
    async def pick_images(_request):
        paths = await asyncio.to_thread(windows_pick_images)
        return web.json_response(
            {"paths": paths},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/find_media")
    async def find_media(request):
        data = await request.json()
        try:
            found = await asyncio.to_thread(find_media_by_names, data.get("names") or [])
        except Exception as exc:
            return web.json_response(
                {"paths": [], "missing": [], "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        found["error"] = ""
        return web.json_response(found, dumps=lambda obj: json.dumps(obj, ensure_ascii=False))

    @instance.routes.post("/fasterwhisper/find_images")
    async def find_images(request):
        data = await request.json()
        try:
            found = await asyncio.to_thread(find_media_by_names, data.get("names") or [], IMAGE_EXT)
        except Exception as exc:
            return web.json_response(
                {"paths": [], "missing": [], "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        found["error"] = ""
        return web.json_response(found, dumps=lambda obj: json.dumps(obj, ensure_ascii=False))

    @instance.routes.post("/fasterwhisper/list_media")
    async def list_media(request):
        data = await request.json()
        folder = data.get("path") or ""
        try:
            files = list_media_files(folder)
        except Exception as exc:
            return web.json_response(
                {"files": [], "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        return web.json_response(
            {"files": files, "error": ""},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/list_images")
    async def list_images(request):
        data = await request.json()
        folder = data.get("path") or ""
        try:
            files = list_image_files(folder)
        except Exception as exc:
            return web.json_response(
                {"files": [], "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        return web.json_response(
            {"files": files, "error": ""},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.get("/fasterwhisper/thumb")
    async def thumb(request):
        path = request.query.get("path") or ""
        try:
            image = await asyncio.to_thread(video_thumb, path)
        except Exception:
            image = ""
        if not image:
            return web.Response(status=404)
        return web.FileResponse(image)

    @instance.routes.get("/fasterwhisper/image")
    async def image_preview(request):
        path = request.query.get("path") or ""
        try:
            resolved = resolve_media_path(path)
        except Exception:
            return web.Response(status=404)
        if Path(resolved).suffix.lower() not in IMAGE_EXT:
            return web.Response(status=404)
        return web.FileResponse(resolved)

    @instance.routes.post("/fasterwhisper/pick_folder")
    async def pick_folder(_request):
        path = await asyncio.to_thread(windows_pick_folder)
        return web.json_response(
            {"path": path},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/write_text")
    async def write_text(request):
        data = await request.json()
        path = data.get("path") or ""
        content = data.get("content") if data.get("content") is not None else ""
        try:
            saved = write_text_file(path, content)
        except Exception as exc:
            return web.json_response(
                {"path": "", "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        return web.json_response(
            {"path": saved, "error": ""},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/save_file")
    async def save_file(request):
        data = await request.json()
        content = data.get("content") or ""
        suggested = data.get("suggested") or "教程字幕.srt"
        # Dialog must run on this thread so it is not stuck behind Comfy.
        try:
            path = await asyncio.to_thread(windows_save_file, suggested)
        except Exception as exc:
            return web.json_response(
                {"path": "", "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        if path:
            Path(path).write_text(content, encoding="utf-8")
        return web.json_response(
            {"path": path, "error": "" if path else "已取消保存"},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/delete_texts")
    async def delete_texts(request):
        data = await request.json()
        try:
            removed = await asyncio.to_thread(delete_text_files, data.get("paths") or [])
        except Exception as exc:
            return web.json_response(
                {"removed": [], "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        return web.json_response(
            {"removed": removed, "error": ""},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    @instance.routes.post("/fasterwhisper/reveal")
    async def reveal(request):
        data = await request.json()
        try:
            await asyncio.to_thread(reveal_in_explorer, data.get("path") or "")
        except Exception as exc:
            return web.json_response(
                {"ok": False, "error": str(exc)},
                dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
            )
        return web.json_response(
            {"ok": True, "error": ""},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )
