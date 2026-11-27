from typing import List, Union
import os
import re

AVAILABLE_SUBTITLE_FORMAT = ['.srt', '.vtt']
STRONG_BREAK = set("。！？!?；;")
WEAK_BREAK = set("，,、 ")
PHRASE_END = set("的了呢吧啊嘛呀哦哇呗")
PHRASE_STARTERS = (
    "然后", "所以", "但是", "而且", "因为", "如果", "就是", "这个", "那个",
    "我们", "可以", "不过", "只是", "要是", "或者", "以及", "这样", "这么",
    "那么", "还是", "另外", "首先", "最后", "比如", "再看", "再给",
)


def char_count(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def split_cues(transcriptions: List, max_chars: int, pause: float = 0.4, style: str = "speech") -> List[dict]:
    if max_chars <= 0:
        return [
            {
                "start": item["start"],
                "end": item["end"],
                "text": str(item.get("text") or "").strip(),
            }
            for item in transcriptions
            if str(item.get("text") or "").strip()
        ]
    cues = []
    for item in transcriptions:
        words = item.get("words") or []
        if words:
            cues.extend(_split_by_words(words, max_chars, pause, style))
        else:
            cues.extend(
                _split_by_chars(
                    str(item.get("text") or ""),
                    float(item["start"]),
                    float(item["end"]),
                    max_chars,
                )
            )
    return [cue for cue in cues if cue["text"]]


def _ends_phrase(token: str) -> bool:
    if not token:
        return False
    last = token[-1]
    return last in PHRASE_END or last in STRONG_BREAK or last in WEAK_BREAK


def _starts_phrase(token: str) -> bool:
    return bool(token) and token.startswith(PHRASE_STARTERS)


def _phrase_cut(current: List[dict], incoming_len: int, max_chars: int) -> int:
    """Return how many tokens stay on this line. The rest starts the next phrase."""
    lengths = [char_count(word["word"]) for word in current]
    total = sum(lengths)
    target = min(13, max_chars)
    best_cut = len(current)
    best_score = -10**9
    head = 0
    for index, word in enumerate(current):
        head += lengths[index]
        tail = total - head
        next_len = tail + incoming_len
        if head < 4 or head > max_chars or next_len > max_chars:
            continue
        score = 0
        if _ends_phrase(word["word"]):
            score += 60
        if index + 1 < len(current) and _starts_phrase(current[index + 1]["word"]):
            score += 45
        if head >= min(8, max_chars):
            score += 15
        score -= abs(head - target)
        if incoming_len <= 4 and index == len(current) - 1:
            score -= 35
        if score > best_score:
            best_score = score
            best_cut = index + 1
    return best_cut


def _split_by_words(words: List[dict], max_chars: int, pause: float = 0.4, style: str = "speech") -> List[dict]:
    cleaned = []
    for word in words:
        token = str(word.get("word") or "").strip()
        if not token:
            continue
        cleaned.extend(
            _pieces_for_word(
                {"start": float(word["start"]), "end": float(word["end"]), "word": token},
                max_chars,
            )
        )
    if not cleaned:
        return []

    cues = []
    current: List[dict] = []
    current_len = 0

    def flush():
        nonlocal current, current_len
        if not current:
            return
        text = _join_tokens([item["word"] for item in current])
        if text:
            cues.append({"start": current[0]["start"], "end": current[-1]["end"], "text": text})
        current = []
        current_len = 0

    index = 0
    while index < len(cleaned):
        word = cleaned[index]
        piece_len = char_count(word["word"])
        if current:
            gap = word["start"] - current[-1]["end"]
            if style == "lyric":
                pause_break = pause > 0 and gap >= pause and current_len >= 2
                starter_break = False
            else:
                pause_break = pause > 0 and gap >= pause and current_len >= 4
                starter_break = _starts_phrase(word["word"]) and current_len >= 6
            if pause_break or starter_break:
                flush()
                continue
            if current_len + piece_len > max_chars:
                cut = _phrase_cut(current, piece_len, max_chars)
                if cut >= len(current):
                    flush()
                else:
                    kept = current[:cut]
                    moved = current[cut:]
                    current = kept
                    current_len = sum(char_count(item["word"]) for item in kept)
                    flush()
                    current = moved
                    current_len = sum(char_count(item["word"]) for item in moved)
                continue
        current.append(word)
        current_len += piece_len
        if _ends_phrase(word["word"]) and word["word"][-1] in STRONG_BREAK and current_len >= 4:
            flush()
        index += 1
    flush()
    return cues


def _char_phrase_split(buf: str) -> int:
    count = 0
    mark = len(buf)
    for index, ch in enumerate(buf):
        if not ch.isspace():
            count += 1
        if count >= 6 and (ch in PHRASE_END or ch in STRONG_BREAK or ch in WEAK_BREAK):
            mark = index + 1
    return mark


def _pieces_for_word(word: dict, max_chars: int) -> List[dict]:
    if char_count(word["word"]) <= max_chars:
        return [word]
    parts = _split_by_chars(word["word"], word["start"], word["end"], max_chars)
    return [{"start": part["start"], "end": part["end"], "word": part["text"]} for part in parts]


def _join_tokens(tokens: List[str]) -> str:
    out = ""
    for token in tokens:
        if out and re.search(r"[A-Za-z0-9]$", out) and re.search(r"^[A-Za-z0-9]", token):
            out += " "
        out += token
    return out.strip()


def _split_by_chars(text: str, start: float, end: float, max_chars: int) -> List[dict]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    if char_count(text) <= max_chars:
        return [{"start": start, "end": end, "text": text}]

    pieces = []
    buf = ""
    buf_len = 0
    for index, ch in enumerate(text):
        if ch.isspace() and not buf:
            continue
        buf += ch
        if not ch.isspace():
            buf_len += 1
        if ch in STRONG_BREAK and buf_len >= 4:
            pieces.append(buf.strip())
            buf = ""
            buf_len = 0
            continue
        if buf_len < max_chars:
            continue
        split_at = _char_phrase_split(buf)
        pieces.append(buf[:split_at].strip())
        buf = buf[split_at:].lstrip()
        buf_len = char_count(buf)
    if buf.strip():
        pieces.append(buf.strip())

    total = sum(char_count(piece) for piece in pieces) or 1
    cues = []
    cursor = 0
    span = max(end - start, 0.05)
    for piece in pieces:
        length = char_count(piece)
        cue_start = start + span * cursor / total
        cursor += length
        cue_end = start + span * cursor / total
        cues.append({"start": cue_start, "end": max(cue_end, cue_start + 0.04), "text": piece})
    return cues


def cues_to_srt(cues: List[dict]) -> str:
    blocks = []
    for index, cue in enumerate(cues, 1):
        start = format_to_subtitle_time(cue["start"], ".srt")
        end = format_to_subtitle_time(cue["end"], ".srt")
        blocks.append(f"{index}\n{start} --> {end}\n{cue['text']}\n")
    return "\n".join(blocks)


def cues_to_plain(cues: List[dict]) -> str:
    lines = [str(cue.get("text") or "").strip() for cue in cues]
    lines = [line for line in lines if line]
    return "\r\n".join(lines) + ("\r\n" if lines else "")


def _normalize_sentence(text: str) -> str:
    text = re.sub(r"\s+", "", text or "")
    return text.strip()


def sentences_from_transcriptions(transcriptions: List) -> List[dict]:
    """Join words into spoken sentences. A sentence ends at 。！？, a pause, or about 80 characters."""
    words = []
    for item in transcriptions or []:
        raw = item.get("words") or []
        if raw:
            for word in raw:
                token = _normalize_sentence(str(word.get("word") or ""))
                if not token:
                    continue
                start = word.get("start")
                end = word.get("end")
                if start is None:
                    start = item.get("start") or 0
                if end is None:
                    end = item.get("end") or start
                words.append({"start": float(start), "end": float(end), "word": token})
            continue
        token = _normalize_sentence(str(item.get("text") or ""))
        if token:
            words.append({
                "start": float(item.get("start") or 0),
                "end": float(item.get("end") or 0),
                "word": token,
            })

    cues = []
    bucket: List[dict] = []

    def flush(cut: int | None = None) -> None:
        nonlocal bucket
        if not bucket:
            return
        if cut is not None and 0 < cut < len(bucket):
            head, bucket = bucket[:cut], bucket[cut:]
        else:
            head, bucket = bucket, []
        text = _normalize_sentence("".join(item["word"] for item in head))
        if text:
            cues.append({"start": head[0]["start"], "end": head[-1]["end"], "text": text})

    for index, word in enumerate(words):
        bucket.append(word)
        text = _normalize_sentence("".join(item["word"] for item in bucket))
        if not text:
            continue
        ended = text[-1] in STRONG_BREAK and char_count(text) >= 4
        gap = 0.0
        if index + 1 < len(words):
            gap = words[index + 1]["start"] - float(word["end"])
        pause = index + 1 == len(words) or (gap >= 0.8 and char_count(text) >= 6)
        if ended or pause:
            flush()
            continue
        if char_count(text) >= 80:
            cut = 0
            counted = 0
            for cursor, item in enumerate(bucket):
                counted += char_count(item["word"])
                token = item["word"]
                if token and token[-1] in WEAK_BREAK and counted >= 12:
                    cut = cursor + 1
            flush(cut or None)
    flush()
    return [cue for cue in cues if cue["text"]]


def render_document(transcriptions: List, kind: str, max_chars: int, pause: float, style: str) -> str:
    cues = split_cues(transcriptions, max_chars, pause, style)
    if kind == "时间轴":
        return cues_to_srt(cues)
    return cues_to_plain(cues)


def format_transcriptions_to_subtitle(
    transcriptions: List,
    output_format: str,
    max_chars: int = 0,
    pause: float = 0.4,
):
    if output_format not in AVAILABLE_SUBTITLE_FORMAT:
        raise ValueError(f"Output format not supported. Supported formats: {AVAILABLE_SUBTITLE_FORMAT}")

    cues = split_cues(transcriptions, max_chars, pause, "speech")
    subtitle = "WEBVTT\n\n" if output_format == ".vtt" else ""
    for i, cue in enumerate(cues):
        formatted_start_time = format_to_subtitle_time(cue["start"], output_format)
        formatted_end_time = format_to_subtitle_time(cue["end"], output_format)
        subtitle += f"{i + 1}\n"
        subtitle += f"{formatted_start_time} --> {formatted_end_time}\n"
        subtitle += f"{cue['text']}\n\n"
    return subtitle


def parse_timestamp(timestamp: Union[float, int]):
    hours = timestamp // 3600
    minutes = (timestamp - hours * 3600) // 60
    seconds = timestamp - hours * 3600 - minutes * 60
    milliseconds = (timestamp - int(timestamp)) * 1000
    return hours, minutes, seconds, milliseconds


def format_to_subtitle_time(timestamp: Union[float, int],
                            output_format: str):
    hours, minutes, seconds, milliseconds = parse_timestamp(timestamp)
    if output_format == ".srt":
        return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d},{int(milliseconds):03d}"
    elif output_format == ".vtt":
        return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}.{int(milliseconds):03d}"
    else:
        raise ValueError(f"Output format not supported. Supported formats: {AVAILABLE_SUBTITLE_FORMAT}")


def get_incremented_filename(directory, prefix, extension):
    number = 0
    while True:
        filename = f"{prefix}_{number:04d}.{extension}"
        output_path = os.path.join(directory, filename)

        if not os.path.exists(output_path):
            return output_path

        number += 1
