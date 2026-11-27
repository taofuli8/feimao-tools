import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function pathWidget(node) {
  return node.widgets?.find(
    (w) => w.name === "filepath" || w.name === "file" || w.name === "media"
  );
}

function srtWidget(node) {
  return node.widgets?.find((w) => w.name === "edited_srt");
}

function applyPath(node, path) {
  if (!path) return;
  const widget = pathWidget(node);
  if (!widget) return;
  widget.value = path;
  widget.callback?.(path);
  node.setDirtyCanvas(true, true);
}

function readEditor(node) {
  if (node._fwSrtArea) return node._fwSrtArea.value || "";
  return node._fwSrtText || srtWidget(node)?.value || "";
}

function writeEditor(node, text) {
  const value = text ?? "";
  node._fwSrtText = value;
  if (node._fwSrtArea && node._fwSrtArea.value !== value) {
    node._fwSrtArea.value = value;
  }
  const widget = srtWidget(node);
  if (widget) widget.value = value;
  node.setDirtyCanvas?.(true, true);
}

function hideStockEditor(node) {
  const widget = srtWidget(node);
  if (!widget || widget._fwHidden) return;
  widget._fwHidden = true;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.serializeValue = async () => readEditor(node);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.focus();
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function flash(button, label) {
  const previous = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = previous;
  }, 1200);
}

function makeButton(label, onClick, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = [
    "flex:1",
    "height:36px",
    "border:0",
    "border-radius:8px",
    "color:#fff",
    "cursor:pointer",
    "font:14px sans-serif",
    primary ? "background:#3d6b4f" : "background:#3a3a3a",
  ].join(";");
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(button);
  });
  return button;
}

function addDomWidget(node, name, element, minHeight, maxHeight) {
  if (node.widgets?.some((w) => w.name === name)) return null;
  if (typeof node.addDOMWidget !== "function") return null;
  const widget = node.addDOMWidget(name, name, element, {
    serialize: false,
    hideOnZoom: false,
    getValue: () => readEditor(node),
    setValue: (value) => writeEditor(node, value ?? ""),
    getMinHeight: () => minHeight,
    getMaxHeight: () => maxHeight,
  });
  widget.serialize = false;
  if (widget.surfaces) {
    widget.surfaces = { canvas: "shown", vueNode: "shown", panel: "shown" };
  }
  return widget;
}

function addDomButton(node, name, label, onClick) {
  if (node.widgets?.some((w) => w.name === name)) return;
  const host = document.createElement("div");
  host.style.cssText =
    "display:flex;align-items:center;width:100%;height:100%;box-sizing:border-box;padding:2px 0;";
  host.append(makeButton(label, () => onClick(), true));
  if (!addDomWidget(node, name, host, 44, 44)) {
    node.addWidget("button", label, null, onClick);
  }
}

async function pickLocalFile(node) {
  const resp = await api.fetchApi("/fasterwhisper/pick_file", { method: "POST" });
  if (!resp.ok) {
    throw new Error("无法打开文件窗口");
  }
  const data = await resp.json();
  if (!data.path) return;
  applyPath(node, data.path);
}

async function copySrt(node, button) {
  const text = readEditor(node);
  if (!text.trim()) {
    alert("字幕还是空的。请先跑一次工作流。");
    return;
  }
  const ok = await copyText(text);
  if (!ok) {
    alert("复制失败。可以在字幕框里按 Ctrl+A 再 Ctrl+C。");
    return;
  }
  if (button) flash(button, "已复制");
}

async function pasteSrt(node, button) {
  const text = await readClipboard();
  if (text === null) {
    alert("读不到剪贴板。请在字幕框里按 Ctrl+V。");
    return;
  }
  if (!text.trim()) {
    alert("剪贴板是空的。");
    return;
  }
  writeEditor(node, text);
  if (button) flash(button, "已粘贴");
}

async function saveSrt(node) {
  const text = readEditor(node);
  writeEditor(node, text);
  if (!text.trim()) {
    alert("字幕还是空的。请先跑一次工作流，等字幕框出现文字后再另存为。");
    return;
  }
  const resp = await api.fetchApi("/fasterwhisper/save_file", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ content: text, suggested: "教程字幕.srt" }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error("保存接口失败：" + resp.status + " " + detail.slice(0, 200));
  }
  const data = await resp.json();
  if (data.path) {
    alert("已保存到：\n" + data.path);
  } else {
    alert(data.error || "已取消保存");
  }
}

function setupPickNode(node) {
  if (node._fwPickBound) return;
  node._fwPickBound = true;
  addDomButton(node, "fw_pick_btn", "选择音视频文件", () => {
    pickLocalFile(node).catch((err) => alert(err.message || String(err)));
  });
  node.onDragOver = function () {
    return true;
  };
  node.onDragDrop = function (event) {
    const file = event.dataTransfer?.files?.[0];
    const local = file?.path;
    if (local) {
      applyPath(this, local);
      return true;
    }
    alert("请点「选择音视频文件」。不要走上传，视频会超过 100MB 限制。");
    return true;
  };
}

function setupPreviewNode(node) {
  hideStockEditor(node);
  if (node._fwSaveBound) return;
  node._fwSaveBound = true;

  const area = document.createElement("textarea");
  area.spellcheck = false;
  area.placeholder = "跑完后这里是完整字幕，可以直接改。复制、粘贴、另存为都用这个框里的字。";
  area.style.cssText = [
    "width:100%",
    "height:100%",
    "min-height:240px",
    "box-sizing:border-box",
    "resize:none",
    "background:#1b1b1b",
    "color:#e8e8e8",
    "border:1px solid #3d6b4f",
    "border-radius:8px",
    "padding:8px",
    "font:13px/1.45 ui-monospace,Consolas,monospace",
  ].join(";");
  area.addEventListener("pointerdown", (event) => event.stopPropagation());
  area.addEventListener("mousedown", (event) => event.stopPropagation());
  area.addEventListener("input", () => writeEditor(node, area.value));
  node._fwSrtArea = area;
  writeEditor(node, srtWidget(node)?.value || node._fwSrtText || "");

  const editorHost = document.createElement("div");
  editorHost.style.cssText = "width:100%;height:100%;box-sizing:border-box;";
  editorHost.append(area);
  addDomWidget(node, "fw_srt_editor", editorHost, 280, 640);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center;width:100%;height:100%;box-sizing:border-box;";
  row.append(
    makeButton("复制全部", (button) => {
      copySrt(node, button).catch((err) => alert(err.message || String(err)));
    }, false),
    makeButton("粘贴替换", (button) => {
      pasteSrt(node, button).catch((err) => alert(err.message || String(err)));
    }, false),
    makeButton("另存为", () => {
      saveSrt(node).catch((err) => alert(err.message || String(err)));
    }, true)
  );
  addDomWidget(node, "fw_srt_actions", row, 44, 44);

  const onExecuted = node.onExecuted;
  node.onExecuted = function (message) {
    onExecuted?.apply(this, arguments);
    const raw = message?.text;
    const text = Array.isArray(raw) ? raw[0] : raw;
    if (typeof text === "string") writeEditor(this, text);
    this.onResize?.(this.size);
  };
}

const MODE_PRESET = {
  口播: { max_chars: 16, pause: 0.4, text_kind: "时间轴" },
  音乐: { max_chars: 14, pause: 0.25, text_kind: "纯文本" },
  歌词: { max_chars: 14, pause: 0.25, text_kind: "纯文本" },
};

function widgetByName(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function setWidget(widget, value) {
  if (!widget) return;
  widget.value = value;
  widget.callback?.call(widget, value);
}

async function pickFolder() {
  const resp = await api.fetchApi("/fasterwhisper/pick_folder", { method: "POST" });
  if (!resp.ok) throw new Error("无法打开文件夹窗口");
  const data = await resp.json();
  return data.path || "";
}

async function pickFilePath() {
  const resp = await api.fetchApi("/fasterwhisper/pick_file", { method: "POST" });
  if (!resp.ok) throw new Error("无法打开文件窗口");
  const data = await resp.json();
  return data.path || "";
}

function addPanelButton(node, name, label, onClick) {
  if (node.widgets?.some((widget) => widget.name === name)) return;
  const widget = node.addWidget("button", label, null, () => {
    Promise.resolve(onClick()).catch((err) => alert(err.message || String(err)));
  });
  widget.name = name;
  widget.serialize = false;
  if (widget.options) widget.options.serialize = false;
  return widget;
}

function placeWidgetAfter(node, widget, afterName) {
  if (!widget) return;
  const after = widgetByName(node, afterName);
  const from = node.widgets.indexOf(widget);
  const to = after ? node.widgets.indexOf(after) + 1 : -1;
  if (from < 0 || to < 0 || from === to) return;
  node.widgets.splice(from, 1);
  node.widgets.splice(to > from ? to - 1 : to, 0, widget);
}

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
}

function ensureLibStyle() {
  if (document.getElementById("fw-lib-style")) return;
  const el = document.createElement("style");
  el.id = "fw-lib-style";
  el.textContent = `
    .fw-lib { width:100%; height:100%; box-sizing:border-box; padding:8px; display:flex; flex-direction:column; gap:8px;
      background:rgba(18,18,18,.58); border:1px solid rgba(255,255,255,.12); border-radius:10px; color:var(--input-text); }
    .fw-lib .row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .fw-lib button { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16); color:inherit;
      border-radius:6px; padding:4px 8px; cursor:pointer; font-size:12px; }
    .fw-lib button:hover { background:rgba(255,255,255,.16); }
    .fw-lib button.on { border-color:rgba(255,160,60,.85); background:rgba(200,110,30,.35); }
    .fw-lib button.danger { border-color:rgba(255,90,90,.45); color:#ffb4b4; }
    .fw-lib button.primary { border-color:rgba(255,180,60,.7); background:rgba(180,110,20,.35); }
    .fw-lib .fields { display:grid; grid-template-columns:72px 1fr; gap:6px; align-items:center; }
    .fw-lib input, .fw-lib textarea { width:100%; box-sizing:border-box; background:rgba(0,0,0,.35); color:inherit;
      border:1px solid rgba(255,255,255,.14); border-radius:6px; padding:4px 6px; font:12px sans-serif; }
    .fw-lib .loc { display:flex; gap:6px; min-width:0; }
    .fw-lib .loc input { flex:1; min-width:0; }
    .fw-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(108px,1fr)); gap:8px;
      flex:1 1 auto; min-height:180px; overflow:auto; align-content:start; }
    .fw-card { position:relative; aspect-ratio:1/1; border:2px solid rgba(255,255,255,.12); border-radius:8px;
      overflow:hidden; background:#111; cursor:pointer; }
    .fw-card.selected { border-color:rgba(255,160,60,.95); }
    .fw-card img { width:100%; height:100%; object-fit:cover; display:block; }
    .fw-card .idx { position:absolute; top:4px; left:4px; font-size:11px; padding:1px 5px; border-radius:4px; background:rgba(0,0,0,.65); }
    .fw-card .aname { position:absolute; left:0; right:0; bottom:0; padding:3px 4px; font-size:11px;
      background:rgba(0,0,0,.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .fw-card .badge { position:absolute; top:4px; right:4px; font-size:10px; padding:1px 5px; border-radius:4px; background:rgba(0,0,0,.65); }
    .fw-audio, .fw-doc { width:100%; height:100%; display:flex; align-items:center; justify-content:center;
      font-size:13px; letter-spacing:1px; color:#d7f5e4; background:linear-gradient(160deg,#1b2830,#243028); }
    .fw-doc { align-items:flex-start; justify-content:flex-start; padding:22px 6px 22px; box-sizing:border-box;
      white-space:pre-wrap; overflow:hidden; font:11px/1.35 ui-monospace,Consolas,monospace; color:#ddd; }
    .fw-meta { font-size:12px; line-height:1.45; }
    .fw-lib.dropping { outline:2px dashed rgba(255,180,60,.9); outline-offset:-6px; background:rgba(180,110,20,.18); }
    .fw-editor { min-height:120px; max-height:220px; resize:vertical; }
    .fw-pair { display:flex; align-items:center; gap:8px; }
    .fw-pair .name { width:64px; flex:0 0 auto; font-size:12px; opacity:.85; }
    .fw-choices { display:flex; flex:1; border:1px solid rgba(255,255,255,.16); border-radius:8px; overflow:hidden; }
    .fw-choices button { flex:1; border:0; border-radius:0; border-right:1px solid rgba(255,255,255,.12); }
    .fw-choices button:last-child { border-right:0; }
    .fw-titles { max-height:140px; overflow:auto; font-size:12px; line-height:1.55; white-space:pre-wrap; }
    .fw-card .fw-vtitle { position:absolute; left:0; right:0; bottom:0; padding:4px 6px; font-size:12px;
      background:rgba(0,0,0,.78); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .fw-mask { position:fixed; inset:0; z-index:10000; background:rgba(6,8,12,.72); backdrop-filter:blur(6px);
      display:flex; align-items:center; justify-content:center; padding:28px; box-sizing:border-box; }
    .fw-dialog { width:min(820px, 94vw); height:min(760px, 88vh); display:flex; flex-direction:column;
      background:linear-gradient(180deg,#24262c 0%, #1a1c21 100%); color:#f2f2f2;
      border:1px solid rgba(255,255,255,.14); border-radius:16px; box-shadow:0 24px 80px rgba(0,0,0,.45); overflow:hidden; }
    .fw-dialog-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
      padding:16px 18px 12px; border-bottom:1px solid rgba(255,255,255,.08); }
    .fw-dialog-kicker { margin:0 0 4px; font-size:11px; letter-spacing:.08em; color:#9aa4b2; }
    .fw-dialog h3 { margin:0; font-size:16px; line-height:1.45; font-weight:600; }
    .fw-dialog-x { width:32px; height:32px; border-radius:50%; border:0; background:rgba(255,255,255,.08); color:#eee; cursor:pointer; font-size:18px; }
    .fw-dialog textarea { flex:1; min-height:0; margin:14px 18px; resize:none; background:#121418; color:#f5f5f5;
      border:1px solid rgba(255,255,255,.1); border-radius:12px; padding:14px 16px; font:15px/1.7 "Microsoft YaHei",sans-serif; outline:none; }
    .fw-dialog textarea:focus { border-color:rgba(255,176,72,.7); }
    .fw-dialog-foot { display:flex; flex-direction:column; align-items:stretch; gap:10px;
      padding:12px 18px 16px; border-top:1px solid rgba(255,255,255,.08); }
    .fw-dialog-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; }
    .fw-dialog-actions button { flex:0 0 auto; height:34px; min-width:max-content; padding:0 14px; border-radius:8px;
      border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:#eee; cursor:pointer;
      white-space:nowrap; line-height:32px; font-size:13px; box-sizing:border-box; }
    .fw-dialog-actions button.primary { background:#d9842a; border-color:#e39a45; color:#fff; }
    .fw-dialog-status { font-size:12px; line-height:1.45; color:#b7c0cc; min-height:1.2em; word-break:break-all; }
    .fw-ctx { position:fixed; z-index:10002; min-width:176px; background:#1c1e24; color:#f2f2f2;
      border:1px solid rgba(255,255,255,.16); border-radius:10px; padding:4px; box-shadow:0 12px 32px rgba(0,0,0,.45); }
    .fw-ctx button { display:block; width:100%; text-align:left; background:transparent; border:0; color:inherit;
      border-radius:7px; padding:7px 10px; cursor:pointer; font-size:13px; }
    .fw-ctx button:hover { background:rgba(255,255,255,.1); }
    .fw-ctx button.danger { color:#ffb4b4; }
  `;
  document.head.append(el);
}

function fileKind(path) {
  const name = String(path || "").split(/[/\\]/).pop() || "";
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  if (["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg"].includes(ext)) return "视频";
  if (["wav", "mp3", "m4a", "flac", "aac", "ogg", "wma"].includes(ext)) return "音频";
  if (["jpg", "jpeg", "png", "webp", "bmp", "gif"].includes(ext)) return "图片";
  return ext || "文件";
}

function localFilePath(file) {
  if (!file) return "";
  if (typeof file.path === "string" && file.path) return file.path;
  try {
    const fromWindow = window.electron?.webUtils?.getPathForFile?.(file);
    if (fromWindow) return fromWindow;
  } catch {
    /* desktop build may not expose electron here */
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
      /* keep the raw path, including any # in the filename */
    }
    found.push(body.replace(/\//g, "\\"));
  });
  return found;
}

function filesFromTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  Array.from(dataTransfer?.items || []).forEach((item) => {
    if (item.kind !== "file") return;
    const file = item.getAsFile?.();
    if (file && !files.some((have) => have.name === file.name && have.size === file.size)) files.push(file);
  });
  return files;
}

function parseLibrary(value) {
  try {
    const data = JSON.parse(value || "[]");
    return Array.isArray(data) ? data.map((item) => String(item?.path || item || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readLibrary(node) {
  return parseLibrary(widgetByName(node, "library")?.value);
}

function readSavedLibrary(node) {
  const named = node?.widgets_values_named;
  if (named && Object.prototype.hasOwnProperty.call(named, "library")) {
    const files = parseLibrary(named.library);
    if (files.length) return files;
  }
  const values = node?.widgets_values;
  if (!Array.isArray(values)) return [];
  const index = (node.widgets || [])
    .filter((widget) => widget.serialize !== false)
    .findIndex((widget) => widget.name === "library");
  if (index < 0) return [];
  return parseLibrary(values[index]);
}

function writeLibrary(node, files, singleLabel) {
  const library = JSON.stringify(files);
  const source = files.length > 1 ? "文件夹" : (singleLabel || "单个音视频");
  const path = files[0] || "";
  setWidget(widgetByName(node, "library"), library);
  setWidget(widgetByName(node, "source"), source);
  setWidget(widgetByName(node, "path"), path);
  const named = node.widgets_values_named;
  if (named && typeof named === "object") {
    named.library = library;
    named.source = source;
    named.path = path;
  }
  const values = node.widgets_values;
  if (Array.isArray(values)) {
    const map = { source, path, library };
    (node.widgets || []).filter((widget) => widget.serialize !== false).forEach((widget, index) => {
      if (index < values.length && Object.prototype.hasOwnProperty.call(map, widget.name)) {
        values[index] = map[widget.name];
      }
    });
  }
}

function setupMediaNode(node, options = {}) {
  const bound = options.bound || "_fwMediaBound";
  if (node[bound]) return;
  node[bound] = true;
  const accept = options.accept || ((kind) => kind === "视频" || kind === "音频");
  const pickUrl = options.pickUrl || "/fasterwhisper/pick_files";
  const listUrl = options.listUrl || "/fasterwhisper/list_media";
  const findUrl = options.findUrl || "/fasterwhisper/find_media";
  const addLabel = options.addLabel || "添加音视频";
  const emptyText = options.emptyText || "个音视频，可以把文件拖到这里";
  const singleLabel = options.singleLabel || "单个音视频";
  const thumbPath = options.thumbPath || "/fasterwhisper/thumb";
  const showImage = options.showImage || ((kind) => kind === "视频");
  ensureLibStyle();
  ["source", "path", "library"].forEach((name) => hideWidget(widgetByName(node, name)));
  const selected = new Set();
  const root = document.createElement("div");
  root.className = "fw-lib";
  const row = document.createElement("div");
  row.className = "row";
  const mk = (label, cls = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (cls) button.className = cls;
    return button;
  };
  const btnFiles = mk(addLabel);
  const writePicked = () => {
    const pickedWidget = widgetByName(node, "选中");
    if (pickedWidget) setWidget(pickedWidget, JSON.stringify([...selected]));
  };
  const runImages = async (all) => {
    const files = readLibrary(node);
    if (!files.length) {
      meta.textContent = "图片库是空的";
      return;
    }
    const chosen = all ? files : files.filter((file) => selected.has(file));
    if (!chosen.length) {
      meta.textContent = "先点选要反推的图片。点一张是单独，点多张或全选是批量。";
      return;
    }
    setWidget(widgetByName(node, "反推范围"), all ? "全部" : "批量选中");
    setWidget(widgetByName(node, "选中"), JSON.stringify(chosen));
    meta.textContent = all ? `开始反推全部 ${files.length} 张` : `开始反推选中的 ${chosen.length} 张`;
    try {
      await app.queuePrompt(0);
    } catch (err) {
      meta.textContent = err.message || String(err);
    }
  };
  const scopeRow = document.createElement("div");
  scopeRow.className = "row";
  if (options.scopes) {
    const btnRunAll = mk("全部反推");
    const btnRunPicked = mk("反推选中");
    const stop = (event) => event.stopPropagation();
    [btnRunAll, btnRunPicked].forEach((button) => {
      button.addEventListener("pointerdown", stop);
      button.addEventListener("mousedown", stop);
    });
    btnRunAll.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runImages(true);
    });
    btnRunPicked.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runImages(false);
    });
    scopeRow.append(btnRunAll, btnRunPicked);
    hideWidget(widgetByName(node, "反推范围"));
    hideWidget(widgetByName(node, "选中"));
  }
  const btnFolder = mk("添加文件夹");
  const btnAll = mk("全选");
  const btnDel = mk("删除", "danger");
  row.append(btnFiles, btnFolder, btnAll, btnDel);
  const gallery = document.createElement("div");
  gallery.className = "fw-gallery";
  const meta = document.createElement("div");
  meta.className = "fw-meta";
  if (options.scopes) root.append(scopeRow);
  root.append(row, gallery, meta);
  addDomWidget(node, "fw_library", root, 360, 900);

  const paint = () => {
    const files = readLibrary(node);
    gallery.replaceChildren();
    files.forEach((file, index) => {
      const card = document.createElement("div");
      card.className = "fw-card" + (selected.has(file) ? " selected" : "");
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(index + 1);
      const badge = document.createElement("div");
      badge.className = "badge";
      const kind = fileKind(file);
      badge.textContent = kind;
      const name = document.createElement("div");
      name.className = "aname";
      name.textContent = file.split(/[/\\]/).pop();
      if (showImage(kind)) {
        const img = document.createElement("img");
        img.alt = name.textContent;
        const base = api.apiURL ? api.apiURL(thumbPath) : thumbPath;
        img.src = `${base}${base.includes("?") ? "&" : "?"}path=${encodeURIComponent(file)}`;
        card.append(img);
      } else {
        const face = document.createElement("div");
        face.className = "fw-audio";
        face.textContent = "音频";
        card.append(face);
      }
      card.append(idx, badge, name);
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (selected.has(file)) selected.delete(file);
        else selected.add(file);
        if (options.scopes) writePicked();
        paint();
      });
      gallery.append(card);
    });
    const names = files.filter((file) => selected.has(file)).map((file) => file.split(/[/\\]/).pop());
    const hint = options.scopes ? "。点一张或多张后按「反推选中」，或直接按「全部反推」" : "";
    meta.textContent = names.length
      ? `共 ${files.length} 个，已选 ${names.length} 个${hint}：${names.join("、")}`
      : `共 ${files.length} ${emptyText}${hint}`;
  };

  const addFiles = (incoming) => {
    const files = readLibrary(node);
    const seen = new Set(files);
    incoming.forEach((file) => {
      if (file && !seen.has(file)) {
        seen.add(file);
        files.push(file);
      }
    });
    writeLibrary(node, files, singleLabel);
    paint();
  };

  btnFiles.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const resp = await api.fetchApi(pickUrl, { method: "POST" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "无法打开文件窗口");
      addFiles(data.paths || []);
    } catch (err) {
      meta.textContent = err.message || String(err);
    }
  });
  btnFolder.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const folder = await pickFolder();
      if (!folder) return;
      const resp = await api.fetchApi(listUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folder }),
      });
      const data = await resp.json();
      if (data.error) {
        meta.textContent = data.error;
        return;
      }
      addFiles(data.files || []);
    } catch (err) {
      meta.textContent = err.message || String(err);
    }
  });
  btnAll.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const files = readLibrary(node);
    const allOn = files.length && files.every((file) => selected.has(file));
    selected.clear();
    if (!allOn) files.forEach((file) => selected.add(file));
    paint();
  });
  btnDel.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected.size) return;
    writeLibrary(node, readLibrary(node).filter((file) => !selected.has(file)), singleLabel);
    if (options.scopes) writePicked();
    selected.clear();
    paint();
  });

  const takeDrop = async (dataTransfer) => {
    const paths = [];
    const pending = [];
    const seen = new Set();
    const push = (value) => {
      const path = String(value || "").trim();
      if (!path || seen.has(path)) return;
      if (!accept(fileKind(path))) return;
      seen.add(path);
      paths.push(path);
    };
    filesFromTransfer(dataTransfer).forEach((file) => {
      const kind = fileKind(file.name);
      if (!accept(kind)) return;
      const local = localFilePath(file);
      if (local) push(local);
      else if (file.name) pending.push(file.name);
    });
    pathsFromTransfer(dataTransfer).forEach(push);
    if (pending.length) {
      try {
        const resp = await api.fetchApi(findUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: pending }),
        });
        const data = await resp.json();
        (data.paths || []).forEach(push);
        if ((data.missing || []).length && !paths.length) {
          meta.textContent = "这个文件名里有 #，拖放路径被截断了。请点「添加音视频」再选一次。";
        }
      } catch (err) {
        meta.textContent = err.message || String(err);
      }
    }
    if (paths.length) addFiles(paths);
    return paths.length > 0 || pending.length > 0;
  };
  root.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    root.classList.add("dropping");
  });
  root.addEventListener("dragleave", (event) => {
    if (!root.contains(event.relatedTarget)) root.classList.remove("dropping");
  });
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    root.classList.remove("dropping");
    takeDrop(event.dataTransfer);
  });
  node.onDragOver = function () {
    return true;
  };
  node.onDragDrop = function (event) {
    return takeDrop(event.dataTransfer);
  };

  if (options.scopes) {
    try {
      const picked = JSON.parse(widgetByName(node, "选中")?.value || "[]");
      if (Array.isArray(picked)) picked.forEach((file) => selected.add(String(file)));
    } catch {
      /* keep the empty selection */
    }
  }
  const reveal = () => {
    const live = readLibrary(node);
    if (!live.length) {
      const saved = readSavedLibrary(node);
      if (saved.length) writeLibrary(node, saved, singleLabel);
    }
    const stored = readLibrary(node);
    const seeded = widgetByName(node, "path")?.value;
    if (!stored.length && seeded && widgetByName(node, "source")?.value === "文件夹") {
      api.fetchApi(listUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: seeded }),
      }).then((resp) => resp.json()).then((data) => {
        if (data.files?.length) addFiles(data.files);
        else paint();
      }).catch(() => paint());
      return;
    }
    paint();
  };
  const previousOnConfigure = node.onConfigure;
  node.onConfigure = function () {
    previousOnConfigure?.apply(this, arguments);
    reveal();
  };
  node._fwRevealLibrary = reveal;
  reveal();
}

function upstreamMedia(node) {
  const input = node.inputs?.find((item) => item.name === "media");
  const link = input && app.graph?.links?.[input.link];
  if (!link) return [];
  const source = app.graph.getNodeById?.(link.origin_id);
  return source ? readLibrary(source) : [];
}

function videoTitle(doc, fallback) {
  return doc?.title || doc?.name || fallback || "未命名";
}

function openDocEditor(doc) {
  ensureLibStyle();
  const mask = document.createElement("div");
  mask.className = "fw-mask";
  const dialog = document.createElement("div");
  dialog.className = "fw-dialog";
  const head = document.createElement("div");
  head.className = "fw-dialog-head";
  const heading = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "fw-dialog-kicker";
  kicker.textContent = "原文稿";
  const title = document.createElement("h3");
  title.textContent = videoTitle(doc);
  heading.append(kicker, title);
  const closeX = document.createElement("button");
  closeX.type = "button";
  closeX.className = "fw-dialog-x";
  closeX.textContent = "×";
  head.append(heading, closeX);
  const area = document.createElement("textarea");
  area.value = doc.text || "";
  area.placeholder = "这段还没有识别出文字";
  const foot = document.createElement("div");
  foot.className = "fw-dialog-foot";
  const status = document.createElement("div");
  status.className = "fw-dialog-status";
  const actions = document.createElement("div");
  actions.className = "fw-dialog-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "primary";
  copy.textContent = "一键复制";
  const copyAi = document.createElement("button");
  copyAi.type = "button";
  copyAi.textContent = "复制给AI";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "保存";
  const saveAs = document.createElement("button");
  saveAs.type = "button";
  saveAs.textContent = "另存为";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "关闭";
  actions.append(copy, copyAi, save, saveAs, close);
  foot.append(status, actions);
  dialog.append(head, area, foot);
  mask.append(dialog);
  const dismiss = () => mask.remove();
  close.addEventListener("click", dismiss);
  closeX.addEventListener("click", dismiss);
  copy.addEventListener("click", async () => {
    const ok = await copyText(area.value || "");
    status.textContent = ok ? "已复制全文" : "复制失败，可以在文本里按 Ctrl+A 再 Ctrl+C";
  });
  copyAi.addEventListener("click", async () => {
    const ask = "帮我修改这个字幕文件 去掉里面的口气词，修正里面的错别字，不要改时间轴，每句话里面都不要出现逗号和句号这样的标点符号，中间有停顿的用空格隔开就行，然后发给我";
    const ok = await copyText(ask);
    status.textContent = ok ? "已复制预设提示词" : "复制失败，可以在文本里按 Ctrl+A 再 Ctrl+C";
  });
  mask.addEventListener("click", (event) => {
    if (event.target === mask) dismiss();
  });
  save.addEventListener("click", () => {
    doc.text = area.value;
    writeReviewFile(doc)
      .then((path) => { status.textContent = `已保存 ${path}`; })
      .catch((err) => { status.textContent = err.message || String(err); });
  });
  saveAs.addEventListener("click", async () => {
    doc.text = area.value;
    const suggested = (doc.path || `${videoTitle(doc)}.txt`).split(/[/\\]/).pop();
    try {
      const resp = await api.fetchApi("/fasterwhisper/save_file", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ content: area.value, suggested }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || "另存为失败");
      if (data.path) {
        doc.path = data.path;
        status.textContent = `已另存为 ${data.path}`;
      }
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  });
  document.body.append(mask);
  area.focus();
}

function setupBatchNode(node) {
  if (node._fwBatchBound) return;
  node._fwBatchBound = true;
  ensureLibStyle();
  ["mode", "save_dir", "suffix", "text_kind", "max_chars", "pause", "separate_vocals"].forEach((name) => hideWidget(widgetByName(node, name)));
  const root = document.createElement("div");
  root.className = "fw-lib";
  const mk = (label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    return button;
  };
  const pair = (label, left, right) => {
    const line = document.createElement("div");
    line.className = "fw-pair";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = label;
    const choices = document.createElement("div");
    choices.className = "fw-choices";
    choices.append(left, right);
    line.append(name, choices);
    return line;
  };
  const btnSpeech = mk("口播");
  const btnLyric = mk("音乐");
  const btnPlain = mk("纯文本");
  const btnTime = mk("时间轴");
  const btnTxt = mk("txt");
  const btnSrt = mk("srt");
  const btnVocalOff = mk("关");
  const btnVocalOn = mk("开");
  const fields = document.createElement("div");
  fields.className = "fields";
  const loc = document.createElement("div");
  loc.className = "loc";
  const locInput = document.createElement("input");
  locInput.value = widgetByName(node, "save_dir")?.value || "";
  locInput.placeholder = "留空则保存在音视频旁边";
  const btnBrowse = mk("浏览…");
  loc.append(locInput, btnBrowse);
  const chars = document.createElement("input");
  chars.type = "number";
  chars.min = "4";
  chars.max = "40";
  chars.value = widgetByName(node, "max_chars")?.value ?? 14;
  const pause = document.createElement("input");
  pause.type = "number";
  pause.min = "0";
  pause.max = "2";
  pause.step = "0.05";
  pause.value = widgetByName(node, "pause")?.value ?? 0.25;
  const label = (text) => Object.assign(document.createElement("span"), { textContent: text });
  fields.append(label("保存位置"), loc, label("每行字数"), chars, label("停顿秒数"), pause);
  const titles = document.createElement("div");
  titles.className = "fw-titles";
  const meta = document.createElement("div");
  meta.className = "fw-meta";
  root.append(
    pair("内容", btnSpeech, btnLyric),
    pair("文本", btnPlain, btnTime),
    pair("后缀", btnTxt, btnSrt),
    pair("人声", btnVocalOff, btnVocalOn),
    fields,
    titles,
    meta
  );
  addDomWidget(node, "fw_save_panel", root, 320, 520);

  const paint = () => {
    const mode = widgetByName(node, "mode")?.value;
    const suffix = widgetByName(node, "suffix")?.value || "txt";
    const kind = widgetByName(node, "text_kind")?.value;
    btnLyric.classList.toggle("on", mode === "音乐" || mode === "歌词");
    btnSpeech.classList.toggle("on", mode === "口播");
    btnTxt.classList.toggle("on", suffix === "txt");
    btnSrt.classList.toggle("on", suffix === "srt");
    btnPlain.classList.toggle("on", kind === "纯文本");
    btnTime.classList.toggle("on", kind === "时间轴");
    const vocalsOn = widgetByName(node, "separate_vocals")?.value !== false;
    btnVocalOn.classList.toggle("on", vocalsOn);
    btnVocalOff.classList.toggle("on", !vocalsOn);
    const files = upstreamMedia(node);
    const names = files.map((file) => file.split(/[/\\]/).pop().replace(/\.[^.]+$/, ""));
    const nextTitles = names.length ? names.map((name, index) => `${index + 1}. ${name}`).join("\n") : "还没有接到素材库";
    if (titles.textContent !== nextTitles) titles.textContent = nextTitles;
    const vocalNote = vocalsOn && (mode === "音乐" || mode === "歌词") ? "，先分离人声" : "";
    meta.textContent = names.length
      ? `共 ${names.length} 个原视频，保存为同名 ${suffix}${vocalNote}`
      : `保存为同名 ${suffix}${vocalNote}`;
  };
  const applyMode = (value) => {
    const preset = MODE_PRESET[value];
    setWidget(widgetByName(node, "mode"), value);
    if (!preset) return;
    setWidget(widgetByName(node, "max_chars"), preset.max_chars);
    setWidget(widgetByName(node, "pause"), preset.pause);
    setWidget(widgetByName(node, "text_kind"), preset.text_kind);
    chars.value = preset.max_chars;
    pause.value = preset.pause;
    paint();
  };
  btnLyric.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); applyMode("音乐"); });
  btnSpeech.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); applyMode("口播"); });
  btnTxt.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); setWidget(widgetByName(node, "suffix"), "txt"); paint(); });
  btnSrt.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setWidget(widgetByName(node, "suffix"), "srt");
    setWidget(widgetByName(node, "text_kind"), "时间轴");
    paint();
  });
  btnPlain.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setWidget(widgetByName(node, "text_kind"), "纯文本");
    if (widgetByName(node, "suffix")?.value === "srt") setWidget(widgetByName(node, "suffix"), "txt");
    paint();
  });
  btnTime.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); setWidget(widgetByName(node, "text_kind"), "时间轴"); paint(); });
  btnVocalOff.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); setWidget(widgetByName(node, "separate_vocals"), false); paint(); });
  btnVocalOn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); setWidget(widgetByName(node, "separate_vocals"), true); paint(); });
  locInput.addEventListener("input", () => setWidget(widgetByName(node, "save_dir"), locInput.value));
  chars.addEventListener("input", () => setWidget(widgetByName(node, "max_chars"), Number(chars.value)));
  pause.addEventListener("input", () => setWidget(widgetByName(node, "pause"), Number(pause.value)));
  btnBrowse.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const folder = await pickFolder();
    if (!folder) return;
    locInput.value = folder;
    setWidget(widgetByName(node, "save_dir"), folder);
  });
  paint();
  if (!node._fwTitleTimer) {
    node._fwTitleTimer = setInterval(() => {
      if (!root.isConnected) return;
      paint();
    }, 1500);
  }
}

function openInEditor(index) {
  const editor = app.graph?.nodes?.find((node) => (node.comfyClass || node.type) === "ReviewBatchText");
  if (!editor?._fwReviewSelect) return;
  editor._fwReviewSelect.value = String(index);
  showReview(editor, index);
  app.canvas?.selectNode?.(editor);
}

function setupGalleryNode(node) {
  if (node._fwGalleryBound) return;
  node._fwGalleryBound = true;
  ensureLibStyle();
  const selected = new Set();
  let anchor = -1;
  let batchMode = false;
  const root = document.createElement("div");
  root.className = "fw-lib";
  const row = document.createElement("div");
  row.className = "row";
  const mk = (label, cls = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (cls) button.className = cls;
    return button;
  };
  const btnAll = mk("全选");
  const btnBatch = mk("批量选择");
  const btnDelete = mk("删除", "danger");
  const btnClear = mk("清理全部", "danger");
  row.append(btnAll, btnBatch, btnDelete, btnClear);
  const saveRow = document.createElement("div");
  saveRow.className = "loc";
  const locInput = document.createElement("input");
  locInput.placeholder = "留空则保存在素材旁边";
  locInput.value = widgetByName(node, "保存位置")?.value || "";
  const btnBrowse = mk("浏览…");
  saveRow.append(locInput, btnBrowse);
  locInput.addEventListener("input", () => setWidget(widgetByName(node, "保存位置"), locInput.value));
  const openFolder = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    meta.textContent = "正在打开资源管理器…";
    try {
      const folder = await pickFolder();
      if (!folder) {
        meta.textContent = "没有选择文件夹";
        return;
      }
      locInput.value = folder;
      setWidget(widgetByName(node, "保存位置"), folder);
      meta.textContent = `保存位置：${folder}`;
    } catch (err) {
      const message = err.message || String(err);
      meta.textContent = message;
      alert(message);
    }
  };
  btnBrowse.addEventListener("pointerdown", (event) => event.stopPropagation());
  btnBrowse.addEventListener("mousedown", (event) => event.stopPropagation());
  btnBrowse.addEventListener("click", openFolder);
  const gallery = document.createElement("div");
  gallery.className = "fw-gallery";
  const meta = document.createElement("div");
  meta.className = "fw-meta";
  meta.textContent = "共 0 个文稿。双击打开编辑，右键更多操作";
  root.append(saveRow, row, gallery, meta);
  hideWidget(widgetByName(node, "保存位置"));
  addDomWidget(node, "fw_gallery", root, 420, 900);

  const fileName = (doc) => {
    const path = doc.path || "";
    return path.split(/[/\\]/).pop() || `${videoTitle(doc)}.txt`;
  };
  const statusLine = () => {
    const total = (node._fwDocs || []).length;
    meta.textContent = selected.size
      ? `共 ${total} 个，已选 ${selected.size} 个。双击打开编辑，右键更多操作`
      : `共 ${total} 个文稿。双击打开编辑，右键更多操作`;
  };
  const syncSelection = () => {
    gallery.querySelectorAll(".fw-card").forEach((el, index) => el.classList.toggle("selected", selected.has(index)));
    statusLine();
  };
  const choose = (index, event) => {
    const total = (node._fwDocs || []).length;
    if (event.shiftKey && anchor >= 0) {
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      if (!event.ctrlKey && !event.metaKey && !batchMode) selected.clear();
      for (let item = start; item <= end && item < total; item += 1) selected.add(item);
    } else if (event.ctrlKey || event.metaKey || batchMode) {
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
    } else {
      selected.clear();
      selected.add(index);
    }
    anchor = index;
    syncSelection();
  };
  const closeMenu = () => document.querySelectorAll(".fw-ctx").forEach((menu) => menu.remove());
  const removeDocs = async (indexes) => {
    const docs = node._fwDocs || [];
    const unique = [...new Set(indexes)].filter((index) => index >= 0 && index < docs.length);
    if (!unique.length) return;
    const paths = unique.map((index) => docs[index]?.path).filter(Boolean);
    if (paths.length) {
      const resp = await api.fetchApi("/fasterwhisper/delete_texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || "删除失败");
    }
    const drop = new Set(unique);
    node._fwDocs = docs.filter((_, index) => !drop.has(index));
    selected.clear();
    anchor = -1;
    paint();
  };
  const saveDocAs = async (doc) => {
    const suggested = fileName(doc);
    const resp = await api.fetchApi("/fasterwhisper/save_file", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ content: doc.text || "", suggested }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || "另存为失败");
    if (data.path) doc.path = data.path;
    return data.path || "";
  };
  const showMenu = (x, y, index) => {
    closeMenu();
    const doc = node._fwDocs?.[index];
    if (!doc) return;
    const menu = document.createElement("div");
    menu.className = "fw-ctx";
    const many = selected.has(index) && selected.size > 1;
    const add = (label, action, danger = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (danger) button.className = "danger";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        Promise.resolve(action()).catch((err) => { meta.textContent = err.message || String(err); });
      });
      menu.append(button);
    };
    add("打开编辑", () => openDocEditor(doc));
    add("复制全文", async () => {
      const ok = await copyText(doc.text || "");
      meta.textContent = ok ? `已复制 ${videoTitle(doc)}` : "复制失败";
    });
    add("复制文件名", async () => {
      const ok = await copyText(fileName(doc));
      meta.textContent = ok ? "已复制文件名" : "复制失败";
    });
    add("另存为", async () => {
      const saved = await saveDocAs(doc);
      if (saved) meta.textContent = `已另存为 ${saved}`;
      paint();
    });
    add("在资源管理器中显示", async () => {
      if (!doc.path) throw new Error("还没有保存路径");
      const resp = await api.fetchApi("/fasterwhisper/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: doc.path }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || "无法打开资源管理器");
    });
    add(many ? `删除选中的 ${selected.size} 个` : "删除", async () => {
      const indexes = many ? [...selected] : [index];
      const count = indexes.length;
      if (!confirm(count > 1 ? `删除选中的 ${count} 个文稿文件？` : `删除「${videoTitle(doc)}」？`)) return;
      await removeDocs(indexes);
    }, true);
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  };
  const paint = () => {
    const docs = node._fwDocs || [];
    gallery.replaceChildren();
    docs.forEach((doc, index) => {
      const card = document.createElement("div");
      card.className = "fw-card" + (selected.has(index) ? " selected" : "");
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(index + 1);
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = fileName(doc).split(".").pop();
      const face = document.createElement("div");
      face.className = "fw-doc";
      face.textContent = (doc.text || "").slice(0, 72);
      const name = document.createElement("div");
      name.className = "fw-vtitle";
      name.textContent = videoTitle(doc, fileName(doc));
      card.append(face, idx, badge, name);
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        choose(index, event);
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        openDocEditor(doc);
      });
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selected.has(index)) choose(index, event);
        showMenu(event.clientX, event.clientY, index);
      });
      gallery.append(card);
    });
    statusLine();
  };
  btnAll.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const docs = node._fwDocs || [];
    const allOn = docs.length && docs.every((_, index) => selected.has(index));
    selected.clear();
    if (!allOn) docs.forEach((_, index) => selected.add(index));
    anchor = docs.length ? 0 : -1;
    syncSelection();
  });
  btnBatch.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    batchMode = !batchMode;
    btnBatch.classList.toggle("on", batchMode);
    meta.textContent = batchMode ? "批量选择已打开，点格子可多选" : meta.textContent;
    if (!batchMode) statusLine();
  });
  btnDelete.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected.size) {
      meta.textContent = "先选中要删除的文稿";
      return;
    }
    if (!confirm(`删除选中的 ${selected.size} 个文稿文件？`)) return;
    removeDocs([...selected]).catch((err) => { meta.textContent = err.message || String(err); });
  });
  btnClear.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const docs = node._fwDocs || [];
    if (!docs.length) return;
    if (!confirm(`清理全部 ${docs.length} 个已产出的文稿文件？`)) return;
    removeDocs(docs.map((_, index) => index)).catch((err) => { meta.textContent = err.message || String(err); });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".fw-ctx")) closeMenu();
  });

  const onExecuted = node.onExecuted;
  node.onExecuted = function (message) {
    onExecuted?.apply(this, arguments);
    const raw = message?.batch;
    const payload = Array.isArray(raw) ? raw[0] : raw;
    if (!payload) return;
    try {
      this._fwDocs = JSON.parse(payload);
    } catch {
      return;
    }
    selected.clear();
    anchor = -1;
    paint();
    this.onResize?.(this.size);
  };
}

function rememberReview(node) {
  const docs = node._fwDocs || [];
  if (node._fwReviewIndex == null || !node._fwReviewArea) return;
  const doc = docs[node._fwReviewIndex];
  if (doc) doc.text = node._fwReviewArea.value;
}

function showReview(node, index) {
  const docs = node._fwDocs || [];
  node._fwReviewIndex = index;
  const doc = docs[index];
  if (node._fwReviewArea) node._fwReviewArea.value = doc?.text || "";
  if (node._fwReviewPath) node._fwReviewPath.textContent = doc?.path || "还没有生成文稿";
}

async function writeReviewFile(doc) {
  const resp = await api.fetchApi("/fasterwhisper/write_text", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ path: doc.path, content: doc.text || "" }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || "保存失败");
  return data.path;
}

function setupReviewNode(node) {
  if (node._fwReviewBound) return;
  node._fwReviewBound = true;
  node._fwDocs = [];
  node._fwReviewIndex = null;

  const selectHost = document.createElement("div");
  selectHost.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;height:100%;box-sizing:border-box;";
  const select = document.createElement("select");
  select.style.cssText = "width:100%;height:32px;border-radius:8px;background:#1b1b1b;color:#eee;border:1px solid #444;";
  const pathLine = document.createElement("div");
  pathLine.style.cssText = "font:12px sans-serif;color:#9ad0b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  pathLine.textContent = "还没有生成文稿";
  selectHost.append(select, pathLine);
  node._fwReviewSelect = select;
  node._fwReviewPath = pathLine;
  select.addEventListener("change", () => {
    rememberReview(node);
    showReview(node, Number(select.value));
  });
  addDomWidget(node, "fw_review_select", selectHost, 64, 72);

  const area = document.createElement("textarea");
  area.spellcheck = false;
  area.placeholder = "跑完后在这里切换每一条视频的文稿，可以直接改。";
  area.style.cssText = [
    "width:100%",
    "height:100%",
    "min-height:220px",
    "box-sizing:border-box",
    "resize:none",
    "background:#1b1b1b",
    "color:#e8e8e8",
    "border:1px solid #3d6b4f",
    "border-radius:8px",
    "padding:8px",
    "font:13px/1.45 ui-monospace,Consolas,monospace",
  ].join(";");
  area.addEventListener("pointerdown", (event) => event.stopPropagation());
  area.addEventListener("mousedown", (event) => event.stopPropagation());
  area.addEventListener("input", () => rememberReview(node));
  node._fwReviewArea = area;
  const editorHost = document.createElement("div");
  editorHost.style.cssText = "width:100%;height:100%;box-sizing:border-box;";
  editorHost.append(area);
  addDomWidget(node, "fw_review_editor", editorHost, 260, 560);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;width:100%;height:100%;box-sizing:border-box;";
  row.append(
    makeButton("复制当前", (button) => {
      rememberReview(node);
      const text = node._fwReviewArea?.value || "";
      if (!text.trim()) {
        alert("当前文稿是空的。");
        return;
      }
      copyText(text)
        .then((ok) => {
          if (ok) flash(button, "已复制");
        })
        .catch((err) => alert(err.message || String(err)));
    }, false),
    makeButton("复制全部", (button) => {
      rememberReview(node);
      const docs = node._fwDocs || [];
      if (!docs.length) {
        alert("还没有文稿。");
        return;
      }
      const text = docs.map((doc) => `${doc.name}\n${doc.text || ""}`.trim()).join("\n\n");
      copyText(text)
        .then((ok) => {
          if (ok) flash(button, "已复制");
        })
        .catch((err) => alert(err.message || String(err)));
    }, false),
    makeButton("保存修改", (button) => {
      rememberReview(node);
      const doc = (node._fwDocs || [])[node._fwReviewIndex];
      if (!doc?.path) {
        alert("还没有可保存的文件。");
        return;
      }
      writeReviewFile(doc)
        .then(() => flash(button, "已保存"))
        .catch((err) => alert(err.message || String(err)));
    }, true)
  );
  addDomWidget(node, "fw_review_actions", row, 44, 44);

  const onExecuted = node.onExecuted;
  node.onExecuted = function (message) {
    onExecuted?.apply(this, arguments);
    const raw = message?.batch;
    const payload = Array.isArray(raw) ? raw[0] : raw;
    if (!payload) return;
    let docs = [];
    try {
      docs = JSON.parse(payload);
    } catch {
      return;
    }
    this._fwReviewIndex = null;
    this._fwDocs = Array.isArray(docs) ? docs : [];
    select.replaceChildren();
    this._fwDocs.forEach((doc, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = doc.name || `文稿 ${index + 1}`;
      select.append(option);
    });
    showReview(this, 0);
    this.onResize?.(this.size);
  };
}

function rollSeed() {
  return Math.floor(Math.random() * 0x100000000);
}

function setupSeedButton(node) {
  if (node._fwSeedButton) return;
  const seed = widgetByName(node, "随机种子");
  if (!seed) return;
  node._fwSeedButton = true;
  const current = Number(seed.value);
  if (!Number.isFinite(current) || current <= 0) setWidget(seed, rollSeed());
  if (node.widgets?.some((widget) => widget.name === "换随机数")) return;
  const button = node.addWidget("button", "换随机数", null, () => {
    const target = widgetByName(node, "随机种子");
    if (target) setWidget(target, rollSeed());
  });
  button.name = "换随机数";
  button.serialize = false;
  if (button.options) button.options.serialize = false;
  placeWidgetAfter(node, button, "随机种子");
}

function bindNode(node) {
  const type = node.comfyClass || node.type;
  if (type === "VideoReverseBrief" || type === "ImageReverseBrief") setupSeedButton(node);
  if (type === "InputFilePath") setupPickNode(node);
  if (type === "PreviewEditSubtitle") setupPreviewNode(node);
  if (type === "MediaSource") setupMediaNode(node);
  if (type === "ImageSource") setupMediaNode(node, {
    bound: "_fwImageBound",
    accept: (kind) => kind === "图片",
    pickUrl: "/fasterwhisper/pick_images",
    listUrl: "/fasterwhisper/list_images",
    findUrl: "/fasterwhisper/find_images",
    addLabel: "添加图片",
    emptyText: "张图片，可以把图片拖到这里",
    singleLabel: "单张图片",
    thumbPath: "/fasterwhisper/image",
    showImage: () => true,
    scopes: true,
  });
  if (type === "BatchRecognize" || type === "BatchRecognizeQwen") setupBatchNode(node);
  if (type === "TextGallery") setupGalleryNode(node);
  if (type === "ReviewBatchText") setupReviewNode(node);
}

function bindExisting() {
  const graph = app.graph;
  if (!graph?.nodes) return;
  for (const node of graph.nodes) {
    bindNode(node);
    node._fwRevealLibrary?.();
  }
}

app.registerExtension({
  name: "faster-whisper.filepick",
  async nodeCreated(node) {
    bindNode(node);
  },
  async afterConfigureGraph() {
    bindExisting();
  },
});
