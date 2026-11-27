import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const MIN = 0.3;
const MAX = 15;
const STEP = 5;

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name);
}

function setWidget(target, value) {
  if (!target) return;
  target.value = value;
  target.callback?.(value);
}

function hideWidget(target) {
  if (!target || target._segHidden) return;
  target._segHidden = true;
  target.hidden = true;
  target.computeSize = () => [0, -4];
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function ensureStyle() {
  if (document.getElementById("seg-style")) return;
  const style = document.createElement("style");
  style.id = "seg-style";
  style.textContent = `
    .seg { width:100%; height:100%; box-sizing:border-box; padding:8px; display:flex; flex-direction:column; gap:8px;
      background:rgba(18,18,18,.58); border:1px solid rgba(255,255,255,.12); border-radius:10px; color:var(--input-text, #eee); }
    .seg .row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .seg button, .seg input, .seg textarea { font:12px/1.4 sans-serif; color:inherit; }
    .seg button { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16); border-radius:6px; padding:4px 8px; cursor:pointer; }
    .seg button:hover { background:rgba(255,255,255,.16); }
    .seg button.on, .seg button.primary { border-color:rgba(255,180,60,.7); background:rgba(180,110,20,.35); }
    .seg button:disabled { opacity:.45; cursor:default; }
    .seg input[type="number"] { width:64px; background:#111; border:1px solid rgba(255,255,255,.16); border-radius:6px; padding:4px 6px; }
    .seg .stage { position:relative; background:#111; border-radius:8px; overflow:hidden; }
    .seg video, .seg audio.clock { width:100%; max-height:220px; display:block; background:#000; }
    .seg .cap { text-align:center; font-size:16px; line-height:1.35; cursor:text; min-height:1.3em; }
    .seg .stage .cap { position:absolute; left:8px; right:8px; bottom:36px; color:#fff; font-size:18px; text-shadow:0 1px 4px #000; }
    .seg canvas { width:100%; display:block; border-radius:8px; background:#141414; }
    .seg .wave-wrap { position:relative; }
    .seg canvas.wave { height:128px; cursor:ew-resize; touch-action:none; }
    .seg .zoom-tools { position:absolute; top:6px; right:6px; display:flex; gap:4px; z-index:2; }
    .seg .zoom-tools button { width:28px; height:28px; padding:0; display:grid; place-items:center; background:rgba(0,0,0,.62); }
    .seg .time-read { font:16px/1.2 ui-monospace,Consolas,monospace; min-height:1.2em; }
    .seg .time-read.hot { color:#ffb454; font-size:18px; }
    .seg .panel { border:1px solid rgba(255,255,255,.16); border-radius:10px; padding:8px; display:flex; flex-direction:column; gap:6px; background:rgba(0,0,0,.22); }
    .seg .process-panel { border-color:rgba(255,180,60,.5); background:rgba(120,70,20,.16); }
    .seg .preview-panel { border-color:rgba(120,170,255,.5); background:rgba(30,60,110,.2); }
    .seg .zone-title { font-size:14px; font-weight:650; }
    .seg .process-panel .zone-title { color:#ffb454; }
    .seg .preview-panel .zone-title { color:#9ec1ff; }
    .seg .hint { font-size:12px; color:#bdbdbd; }
    .seg canvas.axis { height:22px; border-radius:0; background:transparent; }
    .seg canvas.preview { height:72px; cursor:ew-resize; touch-action:none; }
    .seg input.locate { width:100%; accent-color:#ffb454; }
    .seg .slider { display:grid; grid-template-columns:42px 1fr 72px; gap:8px; align-items:center; font-size:12px; }
    .seg .clock-label { min-width:64px; font:14px/1.2 ui-monospace,Consolas,monospace; }
    .seg [hidden] { display:none !important; }
    .seg .menu { display:none; position:fixed; z-index:40; flex-direction:column; gap:4px; min-width:156px; padding:6px; background:#1b1b1b; border:1px solid rgba(255,255,255,.2); border-radius:8px; }
    .seg .menu.open { display:flex; }
    .seg .clock-label.hot { color:#ffb454; }
    .seg textarea { width:100%; height:108px; resize:none; box-sizing:border-box; background:#111; border:1px solid rgba(255,255,255,.16);
      border-radius:8px; padding:6px; font-family:ui-monospace,Consolas,monospace; }
    .seg .cues { overflow:auto; min-height:72px; display:flex; flex-direction:column; gap:4px; }
    .seg .cue { display:grid; grid-template-columns:92px 1fr; gap:6px; align-items:center; }
    .seg .cue.on input { border-color:rgba(255,180,60,.85); }
    .seg .cue input { width:100%; box-sizing:border-box; background:#111; border:1px solid rgba(255,255,255,.16); border-radius:6px; padding:4px 6px; }
    .seg .meta, .seg .status { font-size:12px; color:#c8c8c8; min-height:1.2em; }
    .seg.dropping { outline:2px dashed rgba(255,180,60,.9); outline-offset:-6px; }
  `;
  document.head.append(style);
}

function fileKind(path) {
  const name = String(path || "").split(/[/\\]/).pop() || "";
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  if (["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg"].includes(ext)) return "视频";
  if (["wav", "mp3", "m4a", "flac", "aac", "ogg", "wma"].includes(ext)) return "音频";
  return "";
}

function localFilePath(file) {
  if (!file) return "";
  if (typeof file.path === "string" && file.path) return file.path;
  try {
    const fromWindow = window.electron?.webUtils?.getPathForFile?.(file);
    if (fromWindow) return fromWindow;
  } catch {
    /* desktop build may hide electron */
  }
  try {
    const req = window.require || window.nodeRequire;
    const fromRequire = req?.("electron")?.webUtils?.getPathForFile?.(file);
    if (fromRequire) return fromRequire;
  } catch {
    /* browser context cannot require electron */
  }
  return "";
}

function pathsFromTransfer(dataTransfer) {
  const raw = `${dataTransfer?.getData?.("text/uri-list") || ""}\n${dataTransfer?.getData?.("text/plain") || ""}`;
  const found = [];
  raw.split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith("#")) return;
    if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\")) {
      found.push(text);
      return;
    }
    if (!/^file:/i.test(text)) return;
    let body = text.replace(/^file:\/*/i, "");
    if (/^\/[a-zA-Z]:/.test(body)) body = body.slice(1);
    try {
      body = decodeURIComponent(body);
    } catch {
      /* keep the raw path */
    }
    found.push(body.replace(/\//g, "\\"));
  });
  return found;
}

function mediaUrl(path) {
  const base = api.apiURL("/fasterwhisper/segment/media");
  return `${base}${base.includes("?") ? "&" : "?"}path=${encodeURIComponent(path)}`;
}

async function post(url, body) {
  const resp = await api.fetchApi(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (!resp.ok) throw new Error(data.error || "请求失败");
  if (data.error) throw new Error(data.error);
  return data;
}

function parseTime(value) {
  const match = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(value || "");
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function clockText(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs.toFixed(1).padStart(4, "0")}`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

function parseSrt(text) {
  const body = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  if (!body) return { ok: true, cues: [] };
  if (!body.includes("-->")) return { ok: false, cues: [] };
  const cues = [];
  body.split(/\n\s*\n/).forEach((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeAt = lines.findIndex((line) => line.includes("-->"));
    if (timeAt < 0) return;
    const [left, right] = lines[timeAt].split("-->");
    const start = parseTime(left);
    const end = parseTime(right);
    const caption = lines.slice(timeAt + 1).join("\n").trim();
    if (start == null || end == null || end <= start || !caption) return;
    cues.push({ start, end, text: caption });
  });
  if (!cues.length) return { ok: false, cues: [] };
  return { ok: true, cues };
}

function toSrt(cues) {
  return cues.map((cue, index) => `${index + 1}\n${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${cue.text}\n`).join("\n");
}

function normalizeCuts(duration, cuts) {
  const internal = [];
  let previous = 0;
  cuts.slice().sort((a, b) => a - b).forEach((value) => {
    value = round2(value);
    if (value <= 0 || value >= duration) return;
    if (value - previous < MIN) return;
    if (duration - value < MIN) return;
    internal.push(value);
    previous = value;
  });
  return internal;
}

function defaultCuts(duration, step, limit = MAX) {
  const size = Math.min(Math.max(1, step), limit);
  const cuts = [];
  let cursor = size;
  while (cursor < duration - 0.05) {
    cuts.push(round2(cursor));
    cursor += size;
  }
  return normalizeCuts(duration, cuts);
}

function cutsValid(cuts, duration, limit = MAX) {
  const points = [0, ...normalizeCuts(duration, cuts), duration];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index] - points[index - 1] > limit + 0.05) return false;
  }
  return duration > 0;
}

function setupSegmentNode(node) {
  if (node._segBound) return;
  if (typeof node.addDOMWidget !== "function") return;
  node._segBound = true;
  ensureStyle();
  ["音视频", "每段秒数", "分界", "选中段", "字幕内容", "人声文件", "人声起点", "最长秒数", "人声终点", "选区"].forEach((name) => hideWidget(widget(node, name)));

  const state = {
    duration: 0, video: false, peaks: null, vocalMode: false, raf: 0, busy: false,
    drag: null, pan: null, token: 0, zoom: 1, viewStart: 0,
    previewZoom: 1, previewStart: 0, listen: "piece", listenEnd: 0, locateDrag: false,
    draftStart: 0, draftEnd: 0,
  };
  const root = document.createElement("div");
  root.className = "seg";
  const toolbar = document.createElement("div");
  toolbar.className = "row";
  const pick = button("选择音视频");
  const stepLabel = document.createElement("span");
  stepLabel.textContent = "每段秒数";
  const stepInput = document.createElement("input");
  stepInput.type = "number";
  stepInput.min = "1";
  stepInput.max = "120";
  stepInput.step = "0.5";
  stepInput.value = "5";
  const limitLabel = document.createElement("span");
  limitLabel.textContent = "最长秒数";
  const limitInput = document.createElement("input");
  limitInput.type = "number";
  limitInput.min = "1";
  limitInput.max = "120";
  limitInput.step = "0.5";
  limitInput.value = "15";
  const resplit = button("分段");
  toolbar.append(pick);

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.hidden = true;
  const video = document.createElement("video");
  video.playsInline = true;
  const caption = document.createElement("div");
  caption.className = "cap";
  stage.append(video, caption);
  const audio = document.createElement("audio");
  audio.className = "clock";
  audio.hidden = true;
  const vocal = document.createElement("audio");
  vocal.preload = "auto";
  vocal.hidden = true;
  const processPanel = document.createElement("section");
  processPanel.className = "panel process-panel";
  const processHead = document.createElement("div");
  processHead.className = "row";
  const processTitle = document.createElement("div");
  processTitle.className = "zone-title";
  processTitle.textContent = "处理";
  processHead.append(processTitle, stepLabel, stepInput, limitLabel, limitInput, resplit);
  const processHint = document.createElement("div");
  processHint.className = "hint";
  processHint.textContent = "对已确认的范围分段、试听和保存。右键波形可以增加或删除裁剪条。";
  const waveWrap = document.createElement("div");
  waveWrap.className = "wave-wrap";
  const wave = document.createElement("canvas");
  wave.className = "wave";
  const zoomTools = document.createElement("div");
  zoomTools.className = "zoom-tools";
  const zoomIn = magnifier(true);
  const zoomOut = magnifier(false);
  zoomTools.append(zoomIn, zoomOut);
  waveWrap.append(wave, zoomTools);
  const cropAxis = document.createElement("canvas");
  cropAxis.className = "axis";
  const timeRead = document.createElement("div");
  timeRead.className = "time-read";
  timeRead.textContent = "0:00.0";
  const previewPanel = document.createElement("section");
  previewPanel.className = "panel preview-panel";
  const previewHead = document.createElement("div");
  previewHead.className = "row";
  const previewTitle = document.createElement("div");
  previewTitle.className = "zone-title";
  previewTitle.textContent = "预检";
  const previewClear = button("整段");
  previewHead.append(previewTitle, previewClear);
  const previewHint = document.createElement("div");
  previewHint.className = "hint";
  previewHint.textContent = "拖进度条看位置、缩放和起止。听完点确认裁剪，上面才改用这一段；不确认就按整段处理。";
  const preview = document.createElement("canvas");
  preview.className = "preview";
  const previewAxis = document.createElement("canvas");
  previewAxis.className = "axis";
  function sliderRow(labelText) {
    const row = document.createElement("label");
    row.className = "slider";
    const name = document.createElement("span");
    name.textContent = labelText;
    const input = document.createElement("input");
    input.type = "range";
    input.className = "locate";
    input.min = "0";
    input.max = "0";
    input.step = "0.1";
    input.value = "0";
    const value = document.createElement("span");
    value.className = "clock-label";
    value.textContent = "0:00.0";
    row.append(name, input, value);
    return { row, input, value };
  }
  const place = sliderRow("位置");
  const locate = place.input;
  const zoomRow = sliderRow("缩放");
  zoomRow.input.min = "1";
  zoomRow.input.max = "32";
  zoomRow.input.value = "1";
  zoomRow.value.textContent = "1.0×";
  const cutStart = sliderRow("开始");
  const cutEnd = sliderRow("结束");
  const previewTools = document.createElement("div");
  previewTools.className = "row";
  const previewListen = button("试听", true);
  const previewPlay = button("播放");
  const previewHold = button("暂停");
  const previewConfirm = button("确认裁剪", true);
  previewTools.append(previewListen, previewPlay, previewHold, previewConfirm);
  const meta = document.createElement("div");
  meta.className = "meta";
  const actions = document.createElement("div");
  actions.className = "row";
  const play = button("播放", true);
  const pauseBtn = button("暂停");
  const stopBtn = button("停止");
  const saveOne = button("保存原片段");
  const saveVocalBtn = button("保存人声");
  const saveAll = button("全部保存");
  const separateBtn = button("分离人声");
  const knowOne = button("识别一段");
  const knowAll = button("识别整段");
  const voiceOriginal = button("原声");
  const voiceVocal = button("人声");
  voiceOriginal.classList.add("on");
  actions.append(play, pauseBtn, stopBtn, saveOne, saveVocalBtn, saveAll, separateBtn, knowOne, knowAll, voiceOriginal, voiceVocal);

  const area = document.createElement("textarea");
  area.spellcheck = false;
  area.placeholder = "这里是完整字幕。可以复制出去改，再粘贴回来。";
  const editRow = document.createElement("div");
  editRow.className = "row";
  const copy = button("复制全部");
  const paste = button("粘贴替换");
  editRow.append(copy, paste);
  const cues = document.createElement("div");
  cues.className = "cues";
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = "选择或拖入一个音视频";
  processPanel.append(processHead, processHint, waveWrap, cropAxis, timeRead, meta, actions);
  previewPanel.append(previewHead, previewHint, preview, previewAxis, place.row, zoomRow.row, cutStart.row, cutEnd.row, previewTools);
  root.append(toolbar, stage, audio, processPanel, area, editRow, cues, previewPanel, status);
  root.append(vocal);

  const panel = node.addDOMWidget("seg_panel", "seg_panel", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 1360,
    getMaxHeight: () => 1800,
  });
  panel.serialize = false;
  if (panel.surfaces) panel.surfaces = { canvas: "shown", vueNode: "shown", panel: "shown" };

  const stop = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", stop);

  function readPath() { return String(widget(node, "音视频")?.value || ""); }
  function readLimit() {
    const number = Number(limitInput.value);
    if (!Number.isFinite(number)) return MAX;
    return Math.min(120, Math.max(1, number));
  }
  function readStep() {
    const number = Number(stepInput.value);
    const limit = readLimit();
    if (!Number.isFinite(number)) return Math.min(STEP, limit);
    return Math.min(limit, Math.max(1, number));
  }
  function workRange() {
    return readSelection();
  }
  function visibleSpan() {
    const work = workRange();
    const span = Math.max(0.001, work.end - work.start);
    return span / Math.max(1, state.zoom);
  }
  function clampView() {
    const work = workRange();
    if (!(work.end > work.start)) return;
    if (state.zoom <= 1.01) {
      state.zoom = 1;
      state.viewStart = work.start;
      return;
    }
    const span = visibleSpan();
    const maxStart = Math.max(work.start, work.end - span);
    state.viewStart = Math.min(maxStart, Math.max(work.start, state.viewStart));
  }
  function zoomAt(factor, anchor) {
    const work = workRange();
    if (!(work.end > work.start)) return;
    const oldSpan = visibleSpan();
    const ratio = oldSpan ? (anchor - state.viewStart) / oldSpan : 0.5;
    state.zoom = Math.min(32, Math.max(1, state.zoom * factor));
    if (state.zoom <= 1.01) {
      state.zoom = 1;
      state.viewStart = work.start;
    } else {
      state.viewStart = anchor - ratio * visibleSpan();
      clampView();
    }
    drawWave();
  }
  function previewSpan() {
    if (!(state.duration > 0)) return 1;
    return state.duration / Math.max(1, state.previewZoom);
  }
  function clampPreview() {
    const span = previewSpan();
    state.previewStart = Math.min(Math.max(0, state.duration - span), Math.max(0, state.previewStart));
  }
  function zoomPreview(factor, anchor) {
    if (!(state.duration > 0)) return;
    const oldSpan = previewSpan();
    const ratio = oldSpan ? (anchor - state.previewStart) / oldSpan : 0.5;
    state.previewZoom = Math.min(32, Math.max(1, state.previewZoom * factor));
    if (state.previewZoom <= 1.01) {
      state.previewZoom = 1;
      state.previewStart = 0;
    } else {
      state.previewStart = anchor - ratio * previewSpan();
      clampPreview();
    }
    zoomRow.input.value = String(state.previewZoom);
    zoomRow.value.textContent = `${state.previewZoom.toFixed(1)}×`;
    drawPreview();
  }
  function previewTimeToX(time, width) {
    return ((time - state.previewStart) / previewSpan()) * width;
  }
  function axisStep(span) {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const target = span / 6;
    return steps.find((step) => step >= target) || 600;
  }
  function drawAxis(canvas, start, end) {
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 22;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.fillRect(0, 0, width, 1);
    if (!(end > start)) return;
    const step = axisStep(end - start);
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#c8c8c8";
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    let tick = Math.ceil((start - 0.001) / step) * step;
    let count = 0;
    while (tick <= end + 0.001 && count < 40) {
      count += 1;
      const x = ((tick - start) / (end - start)) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 6);
      ctx.stroke();
      ctx.fillText(clockText(tick), Math.min(width - 52, Math.max(0, x + 3)), 18);
      tick += step;
    }
  }
  function timeToX(time, width) {
    return ((time - state.viewStart) / visibleSpan()) * width;
  }
  function readCuts() {
    try {
      const parsed = JSON.parse(widget(node, "分界")?.value || "[]");
      return Array.isArray(parsed) ? parsed.map(round2) : [];
    } catch {
      return [];
    }
  }
  function readSelected() {
    const number = Number(widget(node, "选中段")?.value || 0);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }
  function readSrt() { return area.value || String(widget(node, "字幕内容")?.value || ""); }
  function readVocalStart() { return Number(widget(node, "人声起点")?.value || 0) || 0; }
  function readSelection() {
    let start = 0;
    let end = state.duration;
    try {
      const parsed = JSON.parse(widget(node, "选区")?.value || "");
      if (Array.isArray(parsed) && parsed.length >= 2) {
        start = round2(parsed[0]);
        end = round2(parsed[1]);
      }
    } catch {
      /* 空选区表示整段 */
    }
    if (!(state.duration > 0)) return { start: 0, end: 0 };
    start = Math.max(0, Math.min(start, state.duration));
    end = Math.max(0, Math.min(end, state.duration));
    if (!(end > start)) return { start: 0, end: state.duration };
    return { start, end };
  }
  function readDraft() {
    if (!(state.duration > 0)) return { start: 0, end: 0 };
    let start = round2(Math.max(0, Math.min(state.draftStart || 0, state.duration)));
    let end = round2(state.draftEnd > 0 ? state.draftEnd : state.duration);
    end = Math.max(0, Math.min(end, state.duration));
    if (end - start < MIN) {
      end = Math.min(state.duration, start + MIN);
      if (end - start < MIN) start = Math.max(0, end - MIN);
    }
    return { start: round2(start), end: round2(end) };
  }
  function syncDraftSliders() {
    const draft = readDraft();
    const max = String(state.duration || 0);
    locate.max = max;
    cutStart.input.max = max;
    cutEnd.input.max = max;
    cutStart.input.value = String(draft.start);
    cutEnd.input.value = String(draft.end);
    cutStart.value.textContent = clockText(draft.start);
    cutEnd.value.textContent = clockText(draft.end);
  }
  function writeDraft(start, end, movingStart) {
    start = round2(Math.max(0, Math.min(start, state.duration)));
    end = round2(Math.max(0, Math.min(end, state.duration)));
    if (end - start < MIN) {
      if (movingStart) start = Math.max(0, end - MIN);
      else end = Math.min(state.duration, start + MIN);
    }
    state.draftStart = round2(start);
    state.draftEnd = round2(end);
    syncDraftSliders();
    drawPreview();
  }
  function writeSelection(start, end, movingStart) {
    start = round2(Math.max(0, Math.min(start, state.duration)));
    end = round2(Math.max(0, Math.min(end, state.duration)));
    if (end - start < MIN) {
      if (movingStart) start = Math.max(0, end - MIN);
      else end = Math.min(state.duration, start + MIN);
    }
    const full = start <= 0.05 && end >= state.duration - 0.05;
    setWidget(widget(node, "选区"), full ? "" : JSON.stringify([round2(start), round2(end)]));
    state.zoom = 1;
    state.viewStart = full ? 0 : round2(start);
    const media = clock();
    const edgeEnd = full ? state.duration : round2(end);
    if (media.src && ((media.currentTime || 0) < state.viewStart - 0.02 || (media.currentTime || 0) > edgeEnd + 0.02)) {
      media.currentTime = state.viewStart;
      showClock(state.viewStart, false);
    }
  }
  function readSpans() {
    const sel = readSelection();
    if (!(sel.end > sel.start)) return [];
    const points = [sel.start];
    readCuts().forEach((cut) => {
      if (cut <= sel.start || cut >= sel.end) return;
      if (cut - points[points.length - 1] < MIN || sel.end - cut < MIN) return;
      points.push(cut);
    });
    points.push(sel.end);
    return points.slice(0, -1).map((start, index) => ({ index, start, end: points[index + 1] }));
  }
  function currentSpan() {
    const spans = readSpans();
    if (!spans.length) return null;
    return spans[Math.min(readSelected(), spans.length - 1)];
  }
  function clock() { return state.video ? video : audio; }

  function writeCuts(cuts) {
    setWidget(widget(node, "分界"), JSON.stringify(normalizeCuts(state.duration, cuts)));
    const spans = readSpans();
    if (readSelected() >= spans.length) setWidget(widget(node, "选中段"), Math.max(0, spans.length - 1));
  }

  function showMedia(isVideo) {
    state.video = isVideo;
    stage.hidden = !isVideo;
    audio.hidden = isVideo;
    if (isVideo) stage.append(caption);
    else audio.insertAdjacentElement("afterend", caption);
  }

  function updateMeta() {
    const span = currentSpan();
    const spans = readSpans();
    if (!span) {
      meta.textContent = "";
      return;
    }
    const sel = readSelection();
    const previewing = sel.start > 0.05 || sel.end < state.duration - 0.05;
    const picked = previewing ? `预检 ${sel.start.toFixed(1)}–${sel.end.toFixed(1)} 秒` : "预检整段";
    const rough = spans.length <= 1 ? "还没分段" : `第 ${span.index + 1} 段 ${span.start.toFixed(1)}–${span.end.toFixed(1)} 秒`;
    const view = state.zoom > 1.01 ? ` · 查看 ${state.viewStart.toFixed(1)}–${(state.viewStart + visibleSpan()).toFixed(1)} 秒` : "";
    meta.textContent = `${picked} · ${rough} · 共 ${spans.length} 段${view}`;
  }

  function renderCues(list) {
    cues.replaceChildren();
    list.forEach((cue, index) => {
      const row = document.createElement("label");
      row.className = "cue";
      const stamp = document.createElement("span");
      stamp.textContent = formatTime(cue.start).slice(3, 8);
      const input = document.createElement("input");
      input.value = cue.text;
      input.dataset.index = String(index);
      input.addEventListener("pointerdown", stop);
      input.addEventListener("input", () => {
        const next = list.map((item, itemIndex) => (itemIndex === index ? { ...item, text: input.value } : item));
        const text = toSrt(next.filter((item) => item.text.trim()));
        area.value = text;
        setWidget(widget(node, "字幕内容"), text);
        list[index] = { ...list[index], text: input.value };
      });
      row.append(stamp, input);
      cues.append(row);
    });
  }

  function writeSrt(text, rebuild) {
    area.value = text;
    setWidget(widget(node, "字幕内容"), text);
    if (!rebuild) return;
    const parsed = parseSrt(text);
    if (!parsed.ok) {
      status.textContent = "字幕格式不对，还没有替换列表";
      return;
    }
    renderCues(parsed.cues);
    updateCaption();
  }

  function cueAt(time) {
    const parsed = parseSrt(readSrt());
    if (!parsed.ok) return null;
    return parsed.cues.find((cue) => time >= cue.start && time < cue.end) || null;
  }

  function updateCaption() {
    const cue = cueAt(clock().currentTime || 0);
    caption.textContent = cue ? cue.text : "";
    cues.querySelectorAll(".cue").forEach((row, index) => {
      const parsed = parseSrt(readSrt());
      const item = parsed.cues[index];
      row.classList.toggle("on", !!(item && cue && item.start === cue.start && item.text === cue.text));
    });
  }

  function bindGraph(media) {
    if (!media || media._segGraph) return media?._segGraph;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(media);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    media._segGraph = { ctx, analyser, live: true };
    return media._segGraph;
  }

  function setLive(media, on) {
    if (!media) return;
    const graph = bindGraph(media);
    if (!graph || graph.live === on) return;
    if (on) graph.analyser.connect(graph.ctx.destination);
    else graph.analyser.disconnect();
    graph.live = on;
  }

  function applyVoice() {
    const useVocal = state.vocalMode && !!vocal.src;
    const media = clock();
    if (media.src) setLive(media, !useVocal);
    if (vocal.src) setLive(vocal, useVocal);
    if (!useVocal) vocal.pause();
    voiceOriginal.classList.toggle("on", !state.vocalMode);
    voiceVocal.classList.toggle("on", state.vocalMode);
  }

  function syncVocal() {
    if (!state.vocalMode || !vocal.src) return;
    const media = clock();
    const local = media.currentTime - readVocalStart();
    if (local < 0 || (Number.isFinite(vocal.duration) && local > vocal.duration)) {
      vocal.pause();
      return;
    }
    if (Math.abs((vocal.currentTime || 0) - local) > 0.35) vocal.currentTime = local;
    if (media.paused) vocal.pause();
    else if (vocal.paused) vocal.play().catch(() => {});
  }

  function drawWave() {
    const width = wave.clientWidth || 640;
    const height = wave.clientHeight || 128;
    const ratio = window.devicePixelRatio || 1;
    wave.width = Math.floor(width * ratio);
    wave.height = Math.floor(height * ratio);
    const ctx = wave.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, width, height);
    if (!(state.duration > 0)) {
      drawAxis(cropAxis, 0, 0);
      drawPreview();
      return;
    }
    clampView();
    const viewEnd = state.viewStart + visibleSpan();
    const spans = readSpans();
    const selected = currentSpan();
    spans.forEach((span) => {
      if (span.end < state.viewStart || span.start > viewEnd) return;
      const x = timeToX(Math.max(span.start, state.viewStart), width);
      const right = timeToX(Math.min(span.end, viewEnd), width);
      ctx.fillStyle = selected && span.index === selected.index ? "rgba(217,132,42,.35)" : "rgba(255,255,255,.04)";
      ctx.fillRect(x, 0, Math.max(1, right - x), height);
    });
    const peaks = state.peaks;
    ctx.fillStyle = "#f2efe8";
    if (peaks?.length) {
      const mid = height / 2;
      const startIndex = Math.max(0, Math.floor((state.viewStart / state.duration) * peaks.length) - 1);
      const endIndex = Math.min(peaks.length, Math.ceil((viewEnd / state.duration) * peaks.length) + 1);
      for (let index = startIndex; index < endIndex; index += 1) {
        const time = ((index + 0.5) / peaks.length) * state.duration;
        const barHeight = Math.max(1, peaks[index] * (height - 16));
        const x = timeToX(time, width);
        ctx.fillRect(x, mid - barHeight / 2, Math.max(1, width / (endIndex - startIndex) - 0.4), barHeight);
      }
    } else {
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }
    const sel = readSelection();
    ctx.strokeStyle = "#ffb454";
    ctx.lineWidth = 2;
    readCuts().forEach((cut) => {
      if (cut <= sel.start || cut >= sel.end || cut < state.viewStart || cut > viewEnd) return;
      const x = timeToX(cut, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });
    const media = clock();
    if (media.src && Number.isFinite(media.currentTime) && media.currentTime >= state.viewStart && media.currentTime <= viewEnd) {
      const x = timeToX(media.currentTime, width);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = "#ffb454";
      ctx.beginPath();
      ctx.arc(x, 16, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    drawAxis(cropAxis, state.viewStart, viewEnd);
    updateMeta();
    drawPreview();
  }

  function drawPreview() {
    const width = preview.clientWidth || 640;
    const height = preview.clientHeight || 64;
    const ratio = window.devicePixelRatio || 1;
    preview.width = Math.floor(width * ratio);
    preview.height = Math.floor(height * ratio);
    const ctx = preview.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, width, height);
    if (!(state.duration > 0)) {
      drawAxis(previewAxis, 0, 0);
      return;
    }
    clampPreview();
    const viewEnd = state.previewStart + previewSpan();
    const peaks = state.peaks;
    ctx.fillStyle = "#f2efe8";
    if (peaks?.length) {
      const mid = height / 2;
      for (let x = 0; x < width; x += 1) {
        const time = state.previewStart + ((x + 0.5) / width) * previewSpan();
        const index = Math.min(peaks.length - 1, Math.max(0, Math.floor((time / state.duration) * peaks.length)));
        const bar = Math.max(1, (peaks[index] || 0) * (height - 10));
        ctx.fillRect(x, mid - bar / 2, 1, bar);
      }
    } else {
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }
    const sel = readDraft();
    const x0 = previewTimeToX(sel.start, width);
    const x1 = previewTimeToX(sel.end, width);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, 0, Math.max(0, Math.min(width, x0)), height);
    ctx.fillRect(Math.max(0, Math.min(width, x1)), 0, width, height);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    [sel.start, sel.end].forEach((edge) => {
      if (edge < state.previewStart - 0.01 || edge > viewEnd + 0.01) return;
      const x = previewTimeToX(edge, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 5, 0, 10, 12);
    });
    const media = clock();
    if (media.src && Number.isFinite(media.currentTime) && media.currentTime >= state.previewStart && media.currentTime <= viewEnd) {
      const x = previewTimeToX(media.currentTime, width);
      ctx.strokeStyle = "#ffb454";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    drawAxis(previewAxis, state.previewStart, viewEnd);
  }

  function showClock(seconds, hot) {
    const text = clockText(seconds);
    timeRead.textContent = text;
    timeRead.classList.toggle("hot", !!hot);
    place.value.textContent = text;
    place.value.classList.toggle("hot", !!hot);
    if (!state.locateDrag) locate.value = String(Math.max(0, Math.min(state.duration || 0, seconds)));
  }

  function tick() {
    drawWave();
    const media = clock();
    if (media && !media.paused) state.raf = requestAnimationFrame(tick);
    else state.raf = 0;
  }

  function timeAt(event) {
    const rect = wave.getBoundingClientRect();
    const ratio = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
    return state.viewStart + ratio * visibleSpan();
  }

  function hitPlayhead(event) {
    const media = clock();
    if (!media.src || !Number.isFinite(media.currentTime)) return false;
    const rect = wave.getBoundingClientRect();
    return Math.abs(event.clientX - rect.left - timeToX(media.currentTime, rect.width)) <= 10;
  }
  function hitCut(event) {
    const sel = readSelection();
    const rect = wave.getBoundingClientRect();
    const x = event.clientX - rect.left;
    let best = -1;
    let bestDist = 8;
    const viewEnd = state.viewStart + visibleSpan();
    readCuts().filter((cut) => cut > sel.start && cut < sel.end).forEach((cut, index) => {
      if (cut < state.viewStart || cut > viewEnd) return;
      const dist = Math.abs(timeToX(cut, rect.width) - x);
      if (dist <= bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    return best;
  }

  function moveCut(index, time) {
    const sel = readSelection();
    const cuts = readCuts().filter((cut) => cut > sel.start && cut < sel.end);
    if (index < 0 || index >= cuts.length) return index;
    let guard = 0;
    while (guard < 50) {
      guard += 1;
      if (index + 1 < cuts.length && time >= cuts[index + 1]) {
        const outerLeft = index === 0 ? sel.start : cuts[index - 1];
        const outerRight = index + 2 < cuts.length ? cuts[index + 2] : sel.end;
        if (outerRight - outerLeft > readLimit() + 0.001) break;
        cuts.splice(index + 1, 1);
        continue;
      }
      if (index > 0 && time <= cuts[index - 1]) {
        const outerLeft = index >= 2 ? cuts[index - 2] : sel.start;
        const outerRight = index + 1 < cuts.length ? cuts[index + 1] : sel.end;
        if (outerRight - outerLeft > readLimit() + 0.001) break;
        cuts.splice(index - 1, 1);
        index -= 1;
        continue;
      }
      const left = index === 0 ? sel.start : cuts[index - 1];
      const right = index + 1 < cuts.length ? cuts[index + 1] : sel.end;
      const limit = readLimit();
      const minTime = Math.max(left + MIN, right - limit);
      const maxTime = Math.min(right - MIN, left + limit);
      if (minTime <= maxTime) cuts[index] = round2(Math.min(maxTime, Math.max(minTime, time)));
      break;
    }
    writeCuts(cuts);
    return index;
  }

  function addCut(time) {
    const span = readSpans().find((item) => time > item.start && time < item.end);
    if (!span) return;
    if (time - span.start < MIN || span.end - time < MIN) {
      status.textContent = "离分界线太近，加不进去";
      return;
    }
    writeCuts([...readCuts(), round2(time)]);
    setWidget(widget(node, "选中段"), span.index);
    drawWave();
    status.textContent = "已增加裁剪条";
  }

  function deleteCut(index) {
    const sel = readSelection();
    const cuts = readCuts().filter((cut) => cut > sel.start && cut < sel.end);
    if (index < 0 || index >= cuts.length) return;
    cuts.splice(index, 1);
    writeCuts(cuts);
    drawWave();
    status.textContent = "已删除这根裁剪条";
  }

  async function loadPeaks(path) {
    const token = state.token;
    state.peaks = null;
    try {
      const resp = await fetch(mediaUrl(path));
      if (!resp.ok || token !== state.token) return;
      const bytes = await resp.arrayBuffer();
      if (token !== state.token) return;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await ctx.decodeAudioData(bytes.slice(0));
      const channel = audioBuffer.getChannelData(0);
      const bars = 800;
      const block = Math.max(1, Math.floor(channel.length / bars));
      const peaks = [];
      for (let index = 0; index < bars; index += 1) {
        let max = 0;
        const start = index * block;
        for (let cursor = 0; cursor < block; cursor += 24) {
          const value = Math.abs(channel[start + cursor] || 0);
          if (value > max) max = value;
        }
        peaks.push(max);
      }
      if (token !== state.token) {
        ctx.close();
        return;
      }
      state.peaks = peaks;
      ctx.close();
    } catch {
      if (token === state.token) state.peaks = null;
    }
    if (token === state.token) drawWave();
  }

  async function openPath(path, reset) {
    if (!path) return;
    const token = ++state.token;
    status.textContent = "正在读取…";
    video.pause();
    audio.pause();
    vocal.pause();
    try {
      const info = await post("/fasterwhisper/segment/probe", { path });
      if (token !== state.token) return;
      setWidget(widget(node, "音视频"), info.path);
      state.duration = Number(info.duration) || 0;
      state.video = !!info.video;
      showMedia(state.video);
      if (reset) {
        setWidget(widget(node, "分界"), "[]");
        setWidget(widget(node, "选区"), "");
        setWidget(widget(node, "选中段"), 0);
        writeSrt("", true);
        setWidget(widget(node, "人声文件"), "");
        setWidget(widget(node, "人声起点"), 0);
        setWidget(widget(node, "人声终点"), 0);
        vocal.removeAttribute("src");
        state.vocalMode = false;
        voiceOriginal.classList.add("on");
        voiceVocal.classList.remove("on");
        state.zoom = 1;
        state.viewStart = 0;
        state.previewZoom = 1;
        state.previewStart = 0;
      }
      const picked = readSelection();
      state.draftStart = picked.start;
      state.draftEnd = picked.end;
      syncDraftSliders();
      const media = clock();
      media.src = mediaUrl(info.path);
      status.textContent = `${info.name} · ${state.duration.toFixed(1)} 秒。预检不确认就按整段处理。`;
      drawWave();
      loadPeaks(info.path);
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  }

  function reload() {
    const path = readPath();
    stepInput.value = String(readStepFromWidget());
    limitInput.value = String(readLimitFromWidget());
    writeSrt(String(widget(node, "字幕内容")?.value || ""), true);
    const vocalPath = String(widget(node, "人声文件")?.value || "");
    if (vocalPath) vocal.src = mediaUrl(vocalPath);
    if (path) openPath(path, false);
  }

  function readStepFromWidget() {
    const number = Number(widget(node, "每段秒数")?.value);
    if (!Number.isFinite(number)) return STEP;
    return Math.min(120, Math.max(1, number));
  }
  function readLimitFromWidget() {
    const number = Number(widget(node, "最长秒数")?.value);
    if (!Number.isFinite(number) || number <= 0) return MAX;
    return Math.min(120, Math.max(1, number));
  }

  function scrubTo(time, hot) {
    const media = clock();
    const work = workRange();
    const next = Math.max(work.start, Math.min(work.end, time));
    if (media.src && Math.abs((media.currentTime || 0) - next) > 0.01) media.currentTime = next;
    showClock(next, hot);
    drawWave();
  }

  function onTime() {
    const media = clock();
    const span = currentSpan();
    const endAt = state.listen === "preview" ? state.listenEnd : span?.end;
    if (endAt && media.currentTime >= endAt - 0.03) {
      media.pause();
      if (media.currentTime > endAt) media.currentTime = endAt;
    }
    showClock(media.currentTime || 0, false);
    syncVocal();
    updateCaption();
    if (!state.raf) drawWave();
  }

  function onPlay() {
    const media = clock();
    applyVoice();
    const graph = (state.vocalMode && vocal.src ? vocal : media)._segGraph;
    graph?.ctx.resume();
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  }

  [video, audio].forEach((media) => {
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("seeked", () => {
      const hot = state.gesture && (state.gesture.kind === "play" || state.gesture.kind === "scrub");
      if (!hot) showClock(media.currentTime || 0, false);
      updateCaption();
      drawWave();
      syncVocal();
    });
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", () => { vocal.pause(); drawWave(); });
  });

  caption.addEventListener("click", (event) => {
    event.stopPropagation();
    const cue = cueAt(clock().currentTime || 0);
    if (!cue) return;
    const parsed = parseSrt(readSrt());
    const index = parsed.cues.findIndex((item) => item.start === cue.start && item.text === cue.text);
    cues.querySelector(`[data-index="${index}"]`)?.focus();
  });

  wave.addEventListener("pointerdown", (event) => {
    stop(event);
    if (!(state.duration > 0)) return;
    wave.setPointerCapture(event.pointerId);
    if (hitPlayhead(event)) {
      state.gesture = { kind: "play", moved: false };
      return;
    }
    const hit = hitCut(event);
    if (hit >= 0) {
      state.gesture = { kind: "cut", index: hit };
      return;
    }
    state.gesture = {
      kind: state.zoom > 1.01 ? "pan" : "scrub",
      x: event.clientX,
      viewStart: state.viewStart,
      moved: false,
      time: timeAt(event),
    };
  });
  wave.addEventListener("pointermove", (event) => {
    const gesture = state.gesture;
    if (!gesture) return;
    const time = timeAt(event);
    if (gesture.kind === "play" || gesture.kind === "scrub") {
      gesture.moved = true;
      scrubTo(time, true);
      return;
    }
    if (gesture.kind === "cut") {
      gesture.index = moveCut(gesture.index, time);
      drawWave();
      return;
    }
    const rect = wave.getBoundingClientRect();
    const dx = event.clientX - gesture.x;
    if (Math.abs(dx) > 4) gesture.moved = true;
    if (!gesture.moved || !rect.width) return;
    state.viewStart = gesture.viewStart - (dx / rect.width) * visibleSpan();
    clampView();
    drawWave();
  });
  wave.addEventListener("pointerup", () => {
    const gesture = state.gesture;
    if (gesture && !gesture.moved && (gesture.kind === "pan" || gesture.kind === "scrub")) {
      const span = readSpans().find((item) => gesture.time >= item.start && gesture.time < item.end);
      if (span) setWidget(widget(node, "选中段"), span.index);
      drawWave();
    }
    if (gesture && (gesture.kind === "play" || gesture.kind === "scrub")) {
      const time = clock().currentTime || 0;
      const span = readSpans().find((item) => time >= item.start && time < item.end);
      if (span) setWidget(widget(node, "选中段"), span.index);
      showClock(time, false);
    }
    state.gesture = null;
  });
  wave.addEventListener("pointercancel", () => { state.gesture = null; });
  wave.addEventListener("wheel", (event) => {
    if (!(state.duration > 0)) return;
    event.preventDefault();
    stop(event);
    zoomAt(event.deltaY < 0 ? 1.4 : 1 / 1.4, timeAt(event));
  }, { passive: false });
  wave.addEventListener("dblclick", (event) => {
    stop(event);
    if (state.duration > 0) addCut(timeAt(event));
  });
  const menu = document.createElement("div");
  menu.className = "menu";
  root.append(menu);
  function hideMenu() { menu.classList.remove("open"); }
  wave.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    stop(event);
    if (!(state.duration > 0)) return;
    const time = timeAt(event);
    const hit = hitCut(event);
    menu.replaceChildren();
    const addItem = button("在这里增加裁剪条");
    const delItem = button("删除这根裁剪条");
    delItem.disabled = hit < 0;
    addItem.addEventListener("click", (click) => {
      stop(click);
      addCut(time);
      hideMenu();
    });
    delItem.addEventListener("click", (click) => {
      stop(click);
      deleteCut(hit);
      hideMenu();
    });
    menu.append(addItem, delItem);
    menu.classList.add("open");
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
  });
  root.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) hideMenu();
  });

  stepInput.addEventListener("change", () => {
    stepInput.value = String(readStep());
    setWidget(widget(node, "每段秒数"), readStep());
  });
  limitInput.addEventListener("change", () => {
    limitInput.value = String(readLimit());
    setWidget(widget(node, "最长秒数"), readLimit());
    if (Number(stepInput.value) > readLimit()) {
      stepInput.value = String(readLimit());
      setWidget(widget(node, "每段秒数"), readLimit());
    }
    drawWave();
  });
  resplit.addEventListener("click", () => {
    if (!(state.duration > 0)) return;
    const step = readStep();
    const limit = readLimit();
    stepInput.value = String(step);
    setWidget(widget(node, "每段秒数"), step);
    setWidget(widget(node, "最长秒数"), limit);
    const sel = readSelection();
    const size = Math.min(step, limit);
    const cuts = [];
    let cursor = sel.start + size;
    while (cursor < sel.end - 0.05) {
      if (cursor - sel.start >= MIN && sel.end - cursor >= MIN) cuts.push(round2(cursor));
      cursor += size;
    }
    writeCuts(cuts);
    setWidget(widget(node, "选中段"), 0);
    drawWave();
    const where = sel.start <= 0.05 && sel.end >= state.duration - 0.05 ? "整段" : `预检 ${sel.start.toFixed(1)}–${sel.end.toFixed(1)} 秒`;
    status.textContent = `已按 ${where}、每 ${size} 秒分段`;
  });
  zoomIn.addEventListener("click", () => zoomAt(1.5, state.viewStart + visibleSpan() / 2));
  zoomOut.addEventListener("click", () => zoomAt(1 / 1.5, state.viewStart + visibleSpan() / 2));

  pick.addEventListener("click", async () => {
    try {
      const resp = await api.fetchApi("/fasterwhisper/pick_files", { method: "POST" });
      const data = await resp.json();
      const path = (data.paths || [])[0];
      if (path) openPath(path, true);
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  });

  play.addEventListener("click", () => {
    const media = clock();
    const span = currentSpan();
    if (!media.src || !span) {
      status.textContent = "请先选择音视频";
      return;
    }
    state.listen = "piece";
    const time = media.currentTime || 0;
    if (time < span.start - 0.05 || time >= span.end - 0.05) media.currentTime = span.start;
    media.play().catch((err) => { status.textContent = err.message || String(err); });
  });
  pauseBtn.addEventListener("click", () => clock().pause());
  stopBtn.addEventListener("click", () => {
    const media = clock();
    const span = currentSpan();
    media.pause();
    const start = span ? span.start : 0;
    if (media.src) media.currentTime = start;
    showClock(start, false);
    drawWave();
  });

  function previewTime(event) {
    const rect = preview.getBoundingClientRect();
    const ratio = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
    return state.previewStart + ratio * previewSpan();
  }
  function clearPreview() {
    state.draftStart = 0;
    state.draftEnd = state.duration;
    syncDraftSliders();
    setWidget(widget(node, "选区"), "");
    state.zoom = 1;
    state.viewStart = 0;
    drawWave();
    status.textContent = "已恢复整段，上面按整段处理";
  }
  previewClear.addEventListener("click", clearPreview);
  preview.addEventListener("pointerdown", (event) => {
    stop(event);
    if (!(state.duration > 0)) return;
    preview.setPointerCapture(event.pointerId);
    const sel = readDraft();
    const rect = preview.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const x0 = previewTimeToX(sel.start, rect.width);
    const x1 = previewTimeToX(sel.end, rect.width);
    let edge = "start";
    if (Math.abs(x - x1) <= 8 && Math.abs(x - x1) < Math.abs(x - x0)) edge = "end";
    else if (x > x0 + 8 && x < x1 - 8) edge = "body";
    else if (Math.abs(x - x0) > 8 && Math.abs(x - x1) > 8) edge = x < (x0 + x1) / 2 ? "start" : "end";
    state.previewDrag = { edge, x: event.clientX, start: sel.start, end: sel.end };
  });
  preview.addEventListener("pointermove", (event) => {
    const drag = state.previewDrag;
    if (!drag || !(state.duration > 0)) return;
    const rect = preview.getBoundingClientRect();
    if (!rect.width) return;
    const dx = ((event.clientX - drag.x) / rect.width) * previewSpan();
    if (drag.edge === "body") {
      const span = drag.end - drag.start;
      const start = Math.max(0, Math.min(state.duration - span, drag.start + dx));
      writeDraft(start, start + span, false);
    } else if (drag.edge === "start") {
      writeDraft(Math.min(drag.end - MIN, drag.start + dx), drag.end, true);
    } else {
      writeDraft(drag.start, Math.max(drag.start + MIN, drag.end + dx), false);
    }
  });
  preview.addEventListener("pointerup", () => {
    if (!state.previewDrag) return;
    state.previewDrag = null;
    const draft = readDraft();
    status.textContent = `预检 ${draft.start.toFixed(1)}–${draft.end.toFixed(1)} 秒，点确认裁剪后上面才使用`;
  });
  preview.addEventListener("pointercancel", () => { state.previewDrag = null; });
  preview.addEventListener("wheel", (event) => {
    if (!(state.duration > 0)) return;
    event.preventDefault();
    stop(event);
    zoomPreview(event.deltaY < 0 ? 1.4 : 1 / 1.4, previewTime(event));
  }, { passive: false });
  zoomRow.input.addEventListener("input", () => {
    const anchor = Number(locate.value) || state.previewStart + previewSpan() / 2;
    const target = Number(zoomRow.input.value) || 1;
    const factor = target / Math.max(1, state.previewZoom);
    if (Math.abs(factor - 1) > 0.001) zoomPreview(factor, anchor);
  });
  cutStart.input.addEventListener("input", () => writeDraft(Number(cutStart.input.value), readDraft().end, true));
  cutEnd.input.addEventListener("input", () => writeDraft(readDraft().start, Number(cutEnd.input.value), false));
  function seekLocate(hot) {
    const time = Math.max(0, Math.min(state.duration, Number(locate.value) || 0));
    const media = clock();
    if (media.src && Math.abs((media.currentTime || 0) - time) > 0.01) media.currentTime = time;
    const span = previewSpan();
    if (time < state.previewStart || time > state.previewStart + span) {
      state.previewStart = time - span / 2;
      clampPreview();
    }
    showClock(time, hot);
    drawWave();
  }
  locate.addEventListener("pointerdown", () => { state.locateDrag = true; });
  locate.addEventListener("pointerup", () => { state.locateDrag = false; });
  locate.addEventListener("input", () => seekLocate(true));
  locate.addEventListener("change", () => { state.locateDrag = false; seekLocate(false); });
  function playPreview(fromCut) {
    const media = clock();
    const draft = readDraft();
    if (!media.src || !(draft.end > draft.start)) {
      status.textContent = "请先选择音视频";
      return;
    }
    const time = media.currentTime || 0;
    state.listen = "preview";
    state.listenEnd = draft.end;
    if (fromCut || time < draft.start - 0.05 || time >= draft.end - 0.05) media.currentTime = draft.start;
    media.play().catch((err) => { status.textContent = err.message || String(err); });
  }
  previewListen.addEventListener("click", () => playPreview(true));
  previewPlay.addEventListener("click", () => playPreview(false));
  previewHold.addEventListener("click", () => clock().pause());
  previewConfirm.addEventListener("click", () => {
    if (!(state.duration > 0)) return;
    const draft = readDraft();
    writeSelection(draft.start, draft.end, false);
    drawWave();
    const full = draft.start <= 0.05 && draft.end >= state.duration - 0.05;
    status.textContent = full ? "确认的是整段，上面按整段处理" : `已确认 ${draft.start.toFixed(1)}–${draft.end.toFixed(1)} 秒，上面按这一段处理`;
  });

  async function save(only) {
    if (!readPath()) {
      status.textContent = "请先选择音视频";
      return;
    }
    const spans = readSpans();
    const sel = readSelection();
    if (spans.length > 1 && spans.some((item) => item.end - item.start > readLimit() + 0.05)) {
      status.textContent = `有一段超过 ${readLimit()} 秒，请先点分段或把分界移开`;
      return;
    }
    status.textContent = "正在保存…";
    setBusy(true);
    try {
      const saved = await post("/fasterwhisper/segment/save", {
        path: readPath(),
        cuts: readCuts(),
        srt: readSrt(),
        index: only ? readSelected() : null,
        limit: readLimit(),
        selection: [sel.start, sel.end],
      });
      const count = (saved.clips || []).filter((item) => item.path && (!only || item.index === readSelected())).length;
      status.textContent = only ? `原片段已保存到 ${saved.folder}` : `已保存 ${count} 段原片段到 ${saved.folder}`;
    } catch (err) {
      status.textContent = err.message || String(err);
    } finally {
      setBusy(false);
    }
  }

  function currentRange() {
    const span = currentSpan();
    if (!readPath() || !span) return null;
    return span;
  }

  async function separateVocals() {
    const span = currentRange();
    if (!span) {
      status.textContent = "请先选择音视频";
      return false;
    }
    status.textContent = "正在分离人声…";
    setBusy(true);
    try {
      const found = await post("/fasterwhisper/segment/separate", {
        path: readPath(),
        start: span.start,
        end: span.end,
        index: readSelected(),
      });
      setWidget(widget(node, "人声文件"), found.vocals || "");
      setWidget(widget(node, "人声起点"), Number(found.vocal_start) || 0);
      setWidget(widget(node, "人声终点"), Number(found.vocal_end) || 0);
      if (found.vocals) vocal.src = mediaUrl(found.vocals);
      status.textContent = "人声已分离，可以切换到人声试听";
      return true;
    } catch (err) {
      status.textContent = err.message || String(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function recognizeText(whole) {
    const span = whole ? readSelection() : currentRange();
    if (!span || !(span.end > span.start)) {
      status.textContent = "请先选择音视频";
      return;
    }
    const label = whole || readSpans().length <= 1 ? "整段" : "这一段";
    const seconds = (span.end - span.start).toFixed(1);
    status.textContent = `正在识别${label} ${span.start.toFixed(1)}–${span.end.toFixed(1)} 秒，共 ${seconds} 秒…`;
    setBusy(true);
    try {
      const found = await post("/fasterwhisper/segment/recognize", {
        path: readPath(),
        start: span.start,
        end: span.end,
        index: whole ? 0 : readSelected(),
        srt: readSrt(),
        vocals: String(widget(node, "人声文件")?.value || ""),
        vocal_start: Number(widget(node, "人声起点")?.value || 0),
        vocal_end: Number(widget(node, "人声终点")?.value || 0),
      });
      writeSrt(found.srt || "", true);
      const parsed = parseSrt(found.srt || "");
      const count = parsed.ok ? parsed.cues.length : 0;
      status.textContent = count ? `${label}已识别，共 ${seconds} 秒，${count} 条字幕` : "没有识别到字幕";
    } catch (err) {
      status.textContent = err.message || String(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveVocalClip() {
    const span = currentRange();
    if (!span) {
      status.textContent = "请先选择音视频";
      return;
    }
    const vocalPath = String(widget(node, "人声文件")?.value || "");
    const vocalStart = readVocalStart();
    const vocalEnd = Number(widget(node, "人声终点")?.value || 0);
    const same = vocalPath && Math.abs(vocalStart - span.start) <= 0.4 && Math.abs(vocalEnd - span.end) <= 0.4;
    if (same) {
      status.textContent = `人声已保存：${vocalPath}`;
      return;
    }
    const ok = await separateVocals();
    if (!ok) return;
    const saved = String(widget(node, "人声文件")?.value || "");
    status.textContent = saved ? `人声已保存：${saved}` : "人声已保存";
  }

  function setBusy(busy) {
    state.busy = busy;
    [saveOne, saveVocalBtn, saveAll, separateBtn, knowOne, knowAll, pick, resplit].forEach((item) => { item.disabled = busy; });
  }

  saveOne.addEventListener("click", () => save(true));
  saveAll.addEventListener("click", () => save(false));
  separateBtn.addEventListener("click", () => separateVocals());
  saveVocalBtn.addEventListener("click", () => saveVocalClip());
  knowOne.addEventListener("click", () => recognizeText(false));
  knowAll.addEventListener("click", () => recognizeText(true));
  voiceOriginal.addEventListener("click", () => {
    state.vocalMode = false;
    applyVoice();
  });
  voiceVocal.addEventListener("click", async () => {
    if (state.busy) return;
    const extract = window.confirm("是否提取人声？");
    if (extract) {
      const ok = await separateVocals();
      if (!ok) return;
    } else if (!vocal.src) {
      return;
    }
    state.vocalMode = true;
    applyVoice();
    if (!clock().paused) syncVocal();
  });

  copy.addEventListener("click", async () => {
    const text = readSrt();
    if (!text.trim()) {
      status.textContent = "字幕还是空的";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "已复制字幕";
    } catch {
      status.textContent = "复制失败";
    }
  });
  paste.addEventListener("click", async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      status.textContent = "读不到剪贴板";
      return;
    }
    const parsed = parseSrt(text);
    if (!parsed.ok) {
      status.textContent = "字幕格式不对，没有替换";
      return;
    }
    writeSrt(toSrt(parsed.cues), true);
    status.textContent = "已粘贴字幕";
  });
  area.addEventListener("input", () => {
    setWidget(widget(node, "字幕内容"), area.value);
    const parsed = parseSrt(area.value);
    if (parsed.ok) renderCues(parsed.cues);
  });

  async function takeDrop(dataTransfer) {
    const found = [];
    const pending = [];
    const push = (value) => {
      const path = String(value || "").trim();
      if (path && fileKind(path) && !found.includes(path)) found.push(path);
    };
    Array.from(dataTransfer?.files || []).forEach((file) => {
      if (!fileKind(file.name)) return;
      const local = localFilePath(file);
      if (local) push(local);
      else if (file.name) pending.push(file.name);
    });
    pathsFromTransfer(dataTransfer).forEach(push);
    if (!found.length && pending.length) {
      try {
        const data = await post("/fasterwhisper/find_media", { names: pending });
        (data.paths || []).forEach(push);
      } catch (err) {
        status.textContent = err.message || String(err);
      }
    }
    if (found[0]) openPath(found[0], true);
  }

  root.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    root.classList.add("dropping");
  });
  root.addEventListener("dragleave", () => root.classList.remove("dropping"));
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    root.classList.remove("dropping");
    takeDrop(event.dataTransfer);
  });
  node.onDragOver = () => true;
  node.onDragDrop = (event) => {
    takeDrop(event.dataTransfer);
    return true;
  };

  const onResize = node.onResize;
  node.onResize = function () {
    onResize?.apply(this, arguments);
    drawWave();
  };
  const onConfigure = node.onConfigure;
  node.onConfigure = function () {
    onConfigure?.apply(this, arguments);
    reload();
  };
  node._segReload = reload;
  if (!(node.size && node.size[1] > 500)) node.setSize([760, 1040]);
  reload();
}

function magnifier(plus) {
  const element = document.createElement("button");
  element.type = "button";
  element.title = plus ? "放大" : "缩小";
  element.className = "icon";
  element.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.8 14.8 L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>${plus ? '<path d="M10 7.1 V12.9 M7.1 10 H12.9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M7.1 10 H12.9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("mousedown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());
  return element;
}

function button(label, primary) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (primary) element.classList.add("primary");
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("mousedown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());
  return element;
}

app.registerExtension({
  name: "faster-whisper.segment",
  async nodeCreated(node) {
    if ((node.comfyClass || node.type) === "MediaSegment") setupSegmentNode(node);
  },
  async afterConfigureGraph() {
    for (const node of app.graph?.nodes || []) {
      if ((node.comfyClass || node.type) === "MediaSegment") node._segReload?.();
    }
  },
});
