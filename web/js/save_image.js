import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { hideComfyWidget, useDomLayout } from "./hide_widget.js";

const SAVE_CLASS = "feimao_tools_Save_Image";
const LOAD_CLASS = "feimao_tools_Load_Image";
const BATCH_CLASS = "feimao_tools_Batch_Prompt";
const STATE_KEY = "te_man_pro_gallery";
const SETTINGS_KEY = "te_man_pro_save_settings";
const STYLE_ID = "te-man-pro-save-style-v13";
const SAVE_HIDE_WIDGETS = [
  "filename_prefix",
  "save_location",
  "use_filename_prefix",
  "enable_save_prompt",
  "gallery_json",
];
const LOAD_HIDE_WIDGETS = ["gallery_json", "source_json", "source_index", "use_source"];
const SAVE_KEEP_TYPE = new Set(["gallery_json"]);
const LOAD_KEEP_TYPE = new Set(LOAD_HIDE_WIDGETS);
const SAVE_SERIAL_NAMES = [
  "filename_prefix",
  "save_location",
  "use_filename_prefix",
  "enable_save_prompt",
  "gallery_json",
];
const LOAD_SERIAL_NAMES = ["gallery_json", "source_json", "source_index", "use_source"];
const LOAD_DROP_INPUTS = [
  "images",
  "保存提示词",
  "保存文件名",
  "分文件名",
  "第二张图",
  "合并",
  "资产名",
  "filename_prefix",
  "save_location",
  "use_filename_prefix",
  "enable_save_prompt",
];
const SAVE_DROP_INPUTS = ["第二张图", "合并", "资产名", "gallery_json", "source_json", "source_index", "use_source"];
const MAX_GALLERY_ITEMS = 300;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    .tmp-save { width:100%; height:100%; min-width:0; min-height:0; max-height:100%; flex:1 1 auto; align-self:stretch;
      box-sizing:border-box; padding:8px; display:flex; flex-direction:column; gap:8px; overflow:hidden;
      background:rgba(18,18,18,.58); border:1px solid rgba(255,255,255,.12); border-radius:10px; color:var(--input-text); }
    .tmp-save .row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; width:100%; flex:0 0 auto; }
    .tmp-save button { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16); color:inherit;
      border-radius:6px; padding:4px 8px; cursor:pointer; font-size:12px; }
    .tmp-save button:hover { background:rgba(255,255,255,.16); }
    .tmp-save button.on { border-color:rgba(255,160,60,.85); background:rgba(200,110,30,.35); }
    .tmp-save button.danger { border-color:rgba(255,90,90,.45); color:#ffb4b4; }
    .tmp-save button.primary { border-color:rgba(255,180,60,.7); background:rgba(180,110,20,.35); }
    .tmp-fields { display:grid; grid-template-columns:96px 1fr; gap:6px; align-items:center; width:100%; flex:0 0 auto; }
    .tmp-fields input { width:100%; box-sizing:border-box; background:rgba(0,0,0,.35); color:inherit;
      border:1px solid rgba(255,255,255,.14); border-radius:6px; padding:4px 6px; }
    .tmp-loc-wrap { display:flex; gap:6px; align-items:center; width:100%; min-width:0; }
    .tmp-loc-wrap input { flex:1 1 auto; min-width:0; }
    .tmp-loc-wrap button { flex:0 0 auto; white-space:nowrap; }
    .tmp-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px;
      flex:1 1 auto; min-height:0; overflow:auto; align-content:start; }
    .tmp-gallery.single { display:flex; grid-template-columns:none; align-items:stretch; justify-content:stretch;
      overflow:hidden; padding:0; }
    .tmp-thumb { position:relative; aspect-ratio:1/1; border:2px solid rgba(255,255,255,.12); border-radius:8px;
      overflow:hidden; background:#111; cursor:pointer; }
    .tmp-gallery.single .tmp-thumb { flex:1 1 auto; width:100%; height:100%; min-height:0; aspect-ratio:auto;
      border-radius:10px; }
    .tmp-thumb.selected { border-color:rgba(255,160,60,.95); }
    .tmp-thumb.active { box-shadow:0 0 0 1px rgba(80,160,255,.75); }
    .tmp-thumb.dragging { opacity:.35; }
    .tmp-thumb.drop-target { border-color:rgba(80,200,120,.95); box-shadow:0 0 0 2px rgba(80,200,120,.45); }
    .tmp-thumb-ghost { position:fixed; z-index:10002; pointer-events:none; opacity:.9;
      box-shadow:0 10px 28px rgba(0,0,0,.45); }
    .tmp-thumb img { width:100%; height:100%; object-fit:cover; display:block; user-select:none; -webkit-user-drag:none; }
    .tmp-gallery.single .tmp-thumb img { object-fit:contain; background:#0a0a0a; }
    .tmp-thumb .idx { position:absolute; top:4px; left:4px; font-size:11px; padding:1px 5px;
      border-radius:4px; background:rgba(0,0,0,.65); }
    .tmp-thumb .aname { position:absolute; left:0; right:0; bottom:0; padding:3px 4px; font-size:11px;
      background:rgba(0,0,0,.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tmp-gallery.single .tmp-thumb .aname { font-size:12px; padding:6px 8px; }
    .tmp-meta { font-size:12px; opacity:.9; line-height:1.45; flex:0 0 auto; }
    .tmp-prompt-panel { width:100%; box-sizing:border-box; flex:0 0 auto; min-height:72px; max-height:160px; overflow:auto;
      margin-top:auto; border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px 10px; background:rgba(0,0,0,.32);
      font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-word; cursor:copy; }
    .tmp-prompt-panel.empty { opacity:.55; cursor:default; }
    .tmp-prompt-panel.copied { border-color:rgba(80,200,120,.75); }
    .tmp-lightbox { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.82);
      display:flex; align-items:center; justify-content:center; padding:28px 40px; box-sizing:border-box; }
    .tmp-lightbox-inner { position:relative; max-width:min(94vw,1280px); max-height:92vh;
      display:flex; flex-direction:column; gap:0; align-items:stretch; }
    .tmp-lightbox-stage { position:relative; display:flex; justify-content:center; align-items:center;
      width:min(94vw,1280px); height:min(72vh,860px); background:#0a0a0a; border-radius:12px 12px 0 0;
      overflow:hidden; cursor:grab; touch-action:none; user-select:none; }
    .tmp-lightbox-stage.dragging { cursor:grabbing; }
    .tmp-lightbox-stage img { max-width:100%; max-height:100%; object-fit:contain; display:block;
      transform-origin:center center; pointer-events:none; user-select:none; -webkit-user-drag:none; }
    .tmp-lightbox-x { position:absolute; top:10px; right:10px; z-index:2; width:34px; height:34px;
      border:none; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; font-size:20px; line-height:1;
      cursor:pointer; display:flex; align-items:center; justify-content:center; }
    .tmp-lightbox-x:hover { background:rgba(0,0,0,.8); }
    .tmp-lightbox-open { position:absolute; top:10px; left:10px; z-index:2; border:none; border-radius:16px;
      padding:6px 10px; background:rgba(0,0,0,.55); color:#eee; font-size:12px; cursor:pointer; }
    .tmp-lightbox-open:hover { background:rgba(0,0,0,.8); }
    .tmp-lightbox-foot { background:rgba(16,16,16,.96); border:1px solid rgba(255,255,255,.1); border-top:none;
      border-radius:0 0 12px 12px; padding:12px 14px; color:#eee; display:flex; flex-direction:column; gap:8px; }
    .tmp-lightbox-title { font-size:13px; font-weight:600; opacity:.95; }
    .tmp-lightbox-prompt { font-size:12px; line-height:1.5; opacity:.88; max-height:120px; overflow:auto;
      white-space:pre-wrap; word-break:break-word; }
    .tmp-lightbox-prompt.empty { opacity:.45; }
    .tmp-lightbox-hint { font-size:11px; opacity:.5; }
    .tmp-lightbox-nav { position:absolute; top:50%; transform:translateY(-50%); z-index:3; width:46px; height:78px;
      border:none; border-radius:12px; background:rgba(0,0,0,.5); color:#fff; font-size:34px; line-height:1;
      cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }
    .tmp-lightbox-nav.prev { left:10px; }
    .tmp-lightbox-nav.next { right:10px; }
    .tmp-lightbox-nav:hover:not(:disabled) { background:rgba(0,0,0,.78); }
    .tmp-lightbox-nav:disabled { opacity:.28; cursor:default; }
    .tmp-compare { position:fixed; inset:0; z-index:10020; background:rgba(0,0,0,.9);
      display:flex; flex-direction:column; padding:12px 14px; box-sizing:border-box; color:#eee; }
    .tmp-compare-bar { display:flex; gap:8px; align-items:center; flex:0 0 auto; margin-bottom:10px; }
    .tmp-compare-bar strong { font-size:14px; white-space:nowrap; }
    .tmp-compare-bar .hint { font-size:12px; opacity:.62; flex:1 1 auto; min-width:0; }
    .tmp-compare-bar button { background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.18); color:#eee;
      border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px; }
    .tmp-compare-bar button:hover { background:rgba(255,255,255,.2); }
    .tmp-compare-body { flex:1 1 auto; min-height:0; display:flex; gap:8px; overflow:auto; }
    .tmp-compare-body.h { flex-direction:row; }
    .tmp-compare-body.v { flex-direction:column; }
    .tmp-compare-cell { flex:1 1 0; display:flex; flex-direction:column; min-width:0; min-height:0;
      background:#111; border:1px solid rgba(255,255,255,.14); border-radius:10px; overflow:hidden; }
    .tmp-compare-body.h .tmp-compare-cell { min-width:180px; }
    .tmp-compare-body.v .tmp-compare-cell { min-height:180px; }
    .tmp-compare-cell header { flex:0 0 auto; padding:6px 8px; font-size:12px; background:rgba(255,255,255,.06);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tmp-compare-view { flex:1 1 auto; min-height:0; display:flex; align-items:center; justify-content:center;
      overflow:hidden; cursor:grab; touch-action:none; background:#0a0a0a; }
    .tmp-compare-view.dragging { cursor:grabbing; }
    .tmp-compare-view img { max-width:100%; max-height:100%; object-fit:contain; transform-origin:center center;
      pointer-events:none; user-select:none; -webkit-user-drag:none; }
    .tmp-ctx { position:fixed; z-index:10021; min-width:140px; background:#1c1c1c; color:#eee;
      border:1px solid rgba(255,255,255,.18); border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.45); }
    .tmp-ctx button { display:block; width:100%; text-align:left; background:transparent; border:none; color:inherit;
      padding:8px 12px; border-radius:6px; cursor:pointer; font-size:13px; }
    .tmp-ctx button:hover { background:rgba(255,255,255,.1); }
  `;
  document.head.appendChild(el);
}

function widget(node, name) {
  return (node.widgets || []).find((w) => w.name === name);
}

function setWidget(node, name, value) {
  const w = widget(node, name);
  if (!w) return;
  w.value = value;
  const text = value == null ? "" : String(value);
  if (w.inputEl) w.inputEl.value = text;
  if (w.element && "value" in w.element) {
    try {
      w.element.value = text;
    } catch (_) {}
  }
  try {
    w.callback?.(value);
  } catch (_) {}
}

function sourcePayload(items) {
  return (items || []).map((info) => ({
    filename: info.filename || "",
    subfolder: info.subfolder || "",
    type: info.type || "output",
    asset_name: info.asset_name || "",
    source_name: info.source_name || info.asset_name || "",
    abs_path: info.abs_path || "",
    width: Number(info.width || 0),
    height: Number(info.height || 0),
  }));
}

function ensureSourceWidgets(node, items, index, useSource) {
  const text = JSON.stringify(sourcePayload(items));
  setWidget(node, "source_json", text);
  const idx = Math.max(0, Math.round(Number(index) || 0));
  setWidget(node, "source_index", idx);
  setWidget(node, "use_source", !!useSource);
  const sj = widget(node, "source_json");
  if (sj) {
    sj.serializeValue = () => {
      const raw = String(sj.value || "[]");
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        return "[]";
      }
    };
  }
  const si = widget(node, "source_index");
  if (si) {
    si.serializeValue = () => {
      const n = Number(si.value);
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    };
  }
  const us = widget(node, "use_source");
  if (us) us.serializeValue = () => !!us.value;
}

function uidClash(node, uid) {
  return (app.graph?._nodes || []).some((n) => n !== node && n.properties?.te_man_pro_uid === uid);
}

function ensureUid(node) {
  node.properties = node.properties || {};
  let uid = node.properties.te_man_pro_uid;
  if (typeof uid !== "string" || !uid || uidClash(node, uid)) {
    uid =
      globalThis.crypto?.randomUUID?.() ||
      `tmp_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
    node.properties.te_man_pro_uid = uid;
  }
  return uid;
}

function galleryStorageId(node, create) {
  const uid = node?.properties?.te_man_pro_uid;
  if (typeof uid === "string" && uid && !uidClash(node, uid)) return uid;
  return create ? ensureUid(node) : "";
}

function persistLocal(node, payload) {
  const id = galleryStorageId(node, true);
  if (!id) return;
  try {
    localStorage.setItem(`te_man_pro_gallery_${id}`, JSON.stringify(payload));
  } catch (_) {}
}

function loadLocal(node) {
  const id = galleryStorageId(node, false);
  if (!id) return null;
  try {
    const raw = localStorage.getItem(`te_man_pro_gallery_${id}`);
    if (raw) return parseGalleryPayload(raw);
  } catch (_) {}
  return null;
}

async function persistDisk(node, payload) {
  const id = galleryStorageId(node, true);
  if (!id) return;
  try {
    await api.fetchApi("/te_man_pro/gallery_save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: id, gallery: payload }),
    });
  } catch (_) {}
}

async function loadDisk(node) {
  const id = galleryStorageId(node, false);
  if (!id) return null;
  try {
    const resp = await api.fetchApi(`/te_man_pro/gallery_load?node_id=${encodeURIComponent(id)}`);
    const data = await resp.json();
    if (data?.source === "node" && data.gallery && typeof data.gallery === "object") {
      return parseGalleryPayload(data.gallery);
    }
  } catch (_) {}
  return null;
}

function readSettings(node) {
  const saved = node.properties?.[SETTINGS_KEY];
  return saved && typeof saved === "object" ? saved : null;
}

function writeSettings(node) {
  node.properties = node.properties || {};
  node.properties[SETTINGS_KEY] = {
    filename_prefix: String(widget(node, "filename_prefix")?.value ?? "默认"),
    save_location: String(widget(node, "save_location")?.value ?? "默认"),
    use_filename_prefix: !!widget(node, "use_filename_prefix")?.value,
    enable_save_prompt: widget(node, "enable_save_prompt")?.value !== false,
  };
  return node.properties[SETTINGS_KEY];
}

function applySavedSettings(node) {
  const saved = readSettings(node);
  if (!saved) return;
  if (saved.filename_prefix != null) setWidget(node, "filename_prefix", String(saved.filename_prefix));
  if (saved.save_location != null) setWidget(node, "save_location", String(saved.save_location));
  if (typeof saved.use_filename_prefix === "boolean") setWidget(node, "use_filename_prefix", saved.use_filename_prefix);
  if (typeof saved.enable_save_prompt === "boolean") setWidget(node, "enable_save_prompt", saved.enable_save_prompt);
}

function patchSerializedWidgets(o, node) {
  if (!o) return;
  const named = o.widgets_values_named || (o.widgets_values_named = {});
  const names = widget(node, "source_json") ? LOAD_SERIAL_NAMES : SAVE_SERIAL_NAMES;
  const keepRicherGallery = (prev, next) => {
    const nextItems = parseGalleryPayload(next).items?.length || 0;
    const prevItems = parseGalleryPayload(prev).items?.length || 0;
    return nextItems === 0 && prevItems > 0;
  };
  for (const name of names) {
    const w = widget(node, name);
    if (!w || w.serialize === false) continue;
    if (name === "gallery_json" && keepRicherGallery(named[name], w.value)) continue;
    named[name] = w.value;
  }
  if (!Array.isArray(o.widgets_values) || !node.widgets) return;
  let index = 0;
  for (const w of node.widgets) {
    if (w?.serialize === false) continue;
    if (names.includes(w.name) && index < o.widgets_values.length) {
      if (!(w.name === "gallery_json" && keepRicherGallery(o.widgets_values[index], w.value))) {
        o.widgets_values[index] = w.value;
      }
    }
    index += 1;
  }
}

function markGraphDirty(node) {
  try {
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
  } catch (_) {}
}

function removeInputAt(node, idx) {
  const input = node.inputs?.[idx];
  const oldLinkId = input?.link;
  let origin = null;
  let originSlot = null;
  if (oldLinkId != null && app.graph?.links?.[oldLinkId]) {
    const link = app.graph.links[oldLinkId];
    origin = app.graph.getNodeById(link.origin_id);
    originSlot = link.origin_slot;
    try {
      app.graph.removeLink(oldLinkId);
    } catch (_) {}
  }
  try {
    node.removeInput(idx);
  } catch (_) {
    try {
      node.inputs.splice(idx, 1);
    } catch (_) {}
  }
  return { origin, originSlot, name: input?.name };
}

function stripNodeChrome(node) {
  const mode = node.__tmpMode === "load" ? "load" : "save";
  const drop = new Set(mode === "load" ? LOAD_DROP_INPUTS : SAVE_DROP_INPUTS);
  const inputs = node.inputs || [];
  for (let idx = inputs.length - 1; idx >= 0; idx--) {
    if (!drop.has(inputs[idx]?.name)) continue;
    const removed = removeInputAt(node, idx);
    if (mode === "save" && removed.name === "资产名" && removed.origin != null && removed.originSlot != null) {
      const target = (node.inputs || []).findIndex((i) => i && i.name === "保存文件名");
      if (target >= 0 && node.inputs[target].link == null) {
        try {
          removed.origin.connect(removed.originSlot, node, target);
        } catch (_) {}
      }
    }
  }
  if (mode !== "save") return;
  const outputs = node.outputs || [];
  for (let idx = outputs.length - 1; idx >= 0; idx--) {
    for (const linkId of [...(outputs[idx]?.links || [])]) {
      try {
        app.graph?.removeLink?.(linkId);
      } catch (_) {}
    }
    try {
      node.removeOutput(idx);
    } catch (_) {
      try {
        node.outputs.splice(idx, 1);
      } catch (_) {}
    }
  }
}

function hideNative(node, mode) {
  const kind = mode || node.__tmpMode || "save";
  const names = kind === "load" ? LOAD_HIDE_WIDGETS : SAVE_HIDE_WIDGETS;
  const keep = kind === "load" ? LOAD_KEEP_TYPE : SAVE_KEEP_TYPE;
  for (const name of names) {
    hideComfyWidget(widget(node, name), keep.has(name));
  }
}

function imageUrl(info) {
  if (info?.type === "absolute" && info.abs_path) {
    const q = new URLSearchParams();
    q.set("path", info.abs_path);
    return api.apiURL(`/te_man_pro/view_image?${q.toString()}`);
  }
  const q = new URLSearchParams();
  q.set("filename", info.filename);
  q.set("type", info.type || "output");
  if (info.subfolder) q.set("subfolder", info.subfolder);
  return api.apiURL(`/view?${q.toString()}`);
}

function resolutionLabel(info) {
  const w = Number(info?.width || 0);
  const h = Number(info?.height || 0);
  return w > 0 && h > 0 ? `${w}×${h}` : "";
}

function selectedCount(state) {
  if (state?.selected instanceof Set) return state.selected.size;
  return Array.isArray(state?.selected) ? state.selected.length : 0;
}

function imageIdentity(info) {
  if (!info) return "";
  if (info.abs_path) return `abs:${info.abs_path}`;
  const name = info.filename || "";
  if (!name) return "";
  return `rel:${info.type || ""}:${info.subfolder || ""}:${name}`;
}

function otherNodeUsesImage(node, info) {
  const key = imageIdentity(info);
  if (!key) return false;
  for (const other of app.graph?._nodes || []) {
    if (!other || other === node) continue;
    const kind = other.type || other.comfyClass;
    if (kind !== SAVE_CLASS && kind !== LOAD_CLASS) continue;
    const items = other.__tmpSaveState?.items || [];
    if (items.some((item) => imageIdentity(item) === key)) return true;
  }
  return false;
}

function selectedMeta(state) {
  const active = state.items?.[state.active];
  if (!active) return "暂无图片。可点「添加图片」或「添加文件夹」。";
  const res = resolutionLabel(active) || "读取中";
  const extra = selectedCount(state) > 1 ? `  批量已选 ${selectedCount(state)} 张` : "";
  return `已选 #${state.active + 1}  资产名: ${active.asset_name || "-"}  分辨率: ${res}${extra}`;
}

function parseGalleryPayload(raw) {
  const base = {
    items: [],
    active: 0,
    multi: true,
    showNames: true,
    showPrompt: false,
    batchSelect: false,
    selected: [],
  };
  if (!raw) return base;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    if (!data || typeof data !== "object") return base;
    return {
      items: Array.isArray(data.items) ? data.items : [],
      active: Number(data.active || 0),
      multi: data.multi !== false,
      showNames: data.showNames !== false,
      showPrompt: !!data.showPrompt,
      batchSelect: !!data.batchSelect,
      selected: Array.isArray(data.selected) ? data.selected : [],
    };
  } catch {
    return base;
  }
}

function loadState(node) {
  // Prefer widget / properties; then localStorage fallback.
  const fromWidget = widget(node, "gallery_json")?.value;
  const fromProps = node.properties?.[STATE_KEY];
  let loaded = parseGalleryPayload(fromWidget && fromWidget !== "{}" ? fromWidget : fromProps);
  if ((!loaded.items || !loaded.items.length) && fromProps) {
    loaded = parseGalleryPayload(fromProps);
  }
  if ((!loaded.items || !loaded.items.length)) {
    const local = loadLocal(node);
    if (local?.items?.length) loaded = local;
  }
  return loaded;
}

function moveGalleryItem(state, from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.items.length || to >= state.items.length) return;
  const [item] = state.items.splice(from, 1);
  state.items.splice(to, 0, item);
  const mapIndex = (i) => {
    if (i === from) return to;
    if (from < to && i > from && i <= to) return i - 1;
    if (from > to && i >= to && i < from) return i + 1;
    return i;
  };
  if (state.active >= 0) state.active = mapIndex(state.active);
  state.selected = new Set(Array.from(state.selected || []).map(mapIndex));
}

function saveState(node, state) {
  if (!node?.__tmpAllowPersist) return;
  const items = Array.isArray(state.items) ? state.items.slice(-MAX_GALLERY_ITEMS) : [];
  if (items.length !== (state.items || []).length) {
    state.items = items;
    state.active = Math.max(0, Math.min(state.active, items.length - 1));
  }
  const payload = {
    items,
    active: state.active,
    multi: state.multi,
    showNames: state.showNames,
    showPrompt: !!state.showPrompt,
    batchSelect: state.batchSelect,
    selected: Array.from(state.selected || []),
  };
  const text = JSON.stringify(payload);
  node.properties = node.properties || {};
  node.properties[STATE_KEY] = payload;
  ensureUid(node);
  setWidget(node, "gallery_json", text);
  if (widget(node, "source_json") && !node.__tmpBatchRunning) ensureSourceWidgets(node, items, state.active, false);
  persistLocal(node, payload);
  markGraphDirty(node);
  // Disk backup so records survive even if workflow wasn't saved.
  void persistDisk(node, payload);
}

function applyStateObject(node, loaded) {
  const selected = new Set(loaded.selected || []);
  if (!node.__tmpSaveState) {
    node.__tmpSaveState = { ...loaded, selected };
    return node.__tmpSaveState;
  }
  node.__tmpSaveState.items = loaded.items;
  node.__tmpSaveState.active = loaded.active;
  node.__tmpSaveState.multi = loaded.multi;
  node.__tmpSaveState.showNames = loaded.showNames;
  node.__tmpSaveState.showPrompt = !!loaded.showPrompt;
  node.__tmpSaveState.batchSelect = loaded.batchSelect;
  node.__tmpSaveState.selected = selected;
  return node.__tmpSaveState;
}

function applyLoadedState(node) {
  return applyStateObject(node, loadState(node));
}

async function restoreGallery(node) {
  const token = (node.__tmpRestoreToken = (node.__tmpRestoreToken || 0) + 1);
  let loaded = loadState(node);
  const hadItems = !!loaded.items?.length;
  if (!hadItems) {
    const disk = await loadDisk(node);
    if (token !== node.__tmpRestoreToken) return node.__tmpSaveState;
    if (disk?.items?.length) loaded = disk;
  }
  if (token !== node.__tmpRestoreToken) return node.__tmpSaveState;
  const current = node.__tmpSaveState;
  if (!loaded.items?.length && current?.items?.length) {
    node.__tmpSaveRender?.();
    return current;
  }
  const liveItems = node.__tmpSaveState?.items?.length || 0;
  if (liveItems > (loaded.items?.length || 0)) {
    node.__tmpSaveRender?.();
    return node.__tmpSaveState;
  }
  applyStateObject(node, loaded);
  if (loaded.items?.length && !hadItems && node.__tmpAllowPersist) {
    saveState(node, node.__tmpSaveState);
  }
  node.__tmpSaveRender?.();
  return node.__tmpSaveState;
}

function readBatchItems(batchNode) {
  try {
    const raw = widget(batchNode, "prompts_json")?.value || "[]";
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function findLinkedBatchPrompt(saveNode) {
  const inputNames = ["保存文件名", "保存提示词"];
  for (const name of inputNames) {
    const slot = (saveNode.inputs || []).findIndex((i) => i.name === name);
    if (slot < 0) continue;
    const linkId = saveNode.inputs[slot].link;
    if (linkId == null) continue;
    const link = app.graph.links[linkId];
    if (!link) continue;
    const src = app.graph.getNodeById(link.origin_id);
    if (src && (src.comfyClass === BATCH_CLASS || src.type === BATCH_CLASS)) return src;
  }
  return (app.graph._nodes || []).find((n) => n.comfyClass === BATCH_CLASS || n.type === BATCH_CLASS) || null;
}

function matchBatchIndex(batchNode, info) {
  const items = readBatchItems(batchNode);
  if (!items.length) return -1;
  const source = String(info.source_name || "").trim();
  const asset = String(info.asset_name || "").trim();
  const prompt = String(info.prompt || "").trim();

  let idx = items.findIndex((x) => source && String(x?.name || "").trim() === source);
  if (idx >= 0) return idx;
  idx = items.findIndex((x) => asset && String(x?.name || "").trim() === asset);
  if (idx >= 0) return idx;
  if (asset) {
    idx = items.findIndex((x) => {
      const n = String(x?.name || "").trim();
      return n && (asset === n || asset.endsWith(n) || asset.includes(n));
    });
    if (idx >= 0) return idx;
  }
  if (prompt) {
    idx = items.findIndex((x) => String(x?.text || "").trim() === prompt);
    if (idx >= 0) return idx;
  }
  return -1;
}

async function regenerateMany(saveNode, infos, setStatus) {
  const list = (infos || []).filter(Boolean);
  if (!list.length) {
    setStatus?.("请先选中要重新生成的图片");
    return false;
  }
  const batch = findLinkedBatchPrompt(saveNode);
  if (!batch) {
    setStatus?.("未找到批量提示词节点，无法重新生成");
    return false;
  }
  if (saveNode.__tmpBatchRunning) {
    setStatus?.("正在执行中");
    return false;
  }
  const jobs = [];
  const missed = [];
  for (const info of list) {
    const idx = matchBatchIndex(batch, info);
    if (idx < 0) missed.push(info);
    else jobs.push({ idx, info });
  }
  if (!jobs.length) {
    setStatus?.("未在提示词列表中匹配到选中的图，无法重新生成");
    return false;
  }
  saveNode.__tmpStop = false;
  saveNode.__tmpBatchRunning = true;
  let done = 0;
  try {
    for (let i = 0; i < jobs.length; i++) {
      if (saveNode.__tmpStop) {
        setStatus?.(`已停止（完成 ${done}/${jobs.length}）`);
        return false;
      }
      const { idx, info } = jobs[i];
      const label = info.asset_name || info.source_name || "";
      setWidget(batch, "index", idx);
      batch.__tmpRender?.();
      setStatus?.(`正在重新生成 ${i + 1}/${jobs.length}：#${String(idx + 1).padStart(2, "0")} ${label}`);
      try {
        const result = await queueOneAndWait(saveNode);
        if (saveNode.__tmpStop || result?.interrupted) {
          await interruptAndClearQueue();
          setStatus?.(`已停止（完成 ${done}/${jobs.length}）`);
          return false;
        }
        if (result && result.ok === false && !result.interrupted) {
          setStatus?.(`第 ${idx + 1} 条重新生成失败`);
          return false;
        }
        done += 1;
      } catch (err) {
        if (saveNode.__tmpStop) {
          await interruptAndClearQueue();
          setStatus?.(`已停止（完成 ${done}/${jobs.length}）`);
          return false;
        }
        setStatus?.(`第 ${idx + 1} 条重新生成失败: ${err?.message || err}`);
        return false;
      }
    }
    const skip = missed.length ? `，${missed.length} 张未匹配到提示词已跳过` : "";
    setStatus?.(`重新生成完成 ${done} 张${skip}`);
    return true;
  } finally {
    saveNode.__tmpBatchRunning = false;
  }
}

async function regenerateFromInfo(saveNode, info, setStatus) {
  return regenerateMany(saveNode, [info], setStatus);
}

function closeContextMenu() {
  document.querySelectorAll(".tmp-ctx").forEach((el) => el.remove());
}

function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "tmp-ctx";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.onclick = (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.onClick?.();
    };
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const onDoc = (e) => {
    if (!menu.contains(e.target)) {
      closeContextMenu();
      document.removeEventListener("mousedown", onDoc, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  });
}

function lightboxLabel(info, index, total) {
  const name = info?.asset_name || info?.filename || "";
  const pos = total > 1 ? `${index + 1}/${total}` : `${index + 1}`;
  return `#${pos} ${name}`.trim();
}

function openLightbox({ items, index, onRegenerate, onIndexChange, onSaveAs }) {
  const list = Array.isArray(items) ? items : [];
  let current = Number.isFinite(index) ? index : 0;
  if (!list.length || !list[current]) return;
  closeContextMenu();
  document.querySelectorAll(".tmp-lightbox").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "tmp-lightbox";
  const inner = document.createElement("div");
  inner.className = "tmp-lightbox-inner";

  const stage = document.createElement("div");
  stage.className = "tmp-lightbox-stage";
  const img = document.createElement("img");
  img.draggable = false;
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "tmp-lightbox-nav prev";
  prev.textContent = "‹";
  prev.title = "上一张（←）";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "tmp-lightbox-nav next";
  next.textContent = "›";
  next.title = "下一张（→）";
  const openTab = document.createElement("button");
  openTab.className = "tmp-lightbox-open";
  openTab.textContent = "新标签打开";
  openTab.title = "在新标签页打开原图";
  const close = document.createElement("button");
  close.className = "tmp-lightbox-x";
  close.textContent = "×";
  close.title = "关闭";
  stage.append(img, prev, next, openTab, close);

  const foot = document.createElement("div");
  foot.className = "tmp-lightbox-foot";
  const title = document.createElement("div");
  title.className = "tmp-lightbox-title";
  const promptEl = document.createElement("div");
  promptEl.className = "tmp-lightbox-prompt";
  const hint = document.createElement("div");
  hint.className = "tmp-lightbox-hint";
  hint.textContent = onSaveAs
    ? "滚轮缩放，按住左键拖动，双击复位，右键可另存为"
    : "滚轮缩放，按住左键拖动，双击复位";
  foot.append(title, promptEl, hint);

  inner.append(stage, foot);
  overlay.append(inner);
  document.body.appendChild(overlay);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const applyTransform = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const resetView = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  };

  const currentInfo = () => list[current];
  const apply = (nextIndex, notify) => {
    if (!list.length) return;
    current = Math.max(0, Math.min(list.length - 1, nextIndex));
    const info = currentInfo();
    if (!info) return;
    resetView();
    const text = lightboxLabel(info, current, list.length);
    img.src = imageUrl(info);
    img.alt = text;
    title.textContent = text;
    const prompt = info.prompt || "";
    promptEl.className = "tmp-lightbox-prompt" + (prompt ? "" : " empty");
    promptEl.textContent = prompt ? prompt : "（无提示词）";
    const multi = list.length > 1;
    prev.hidden = !multi;
    next.hidden = !multi;
    prev.disabled = current <= 0;
    next.disabled = current >= list.length - 1;
    if (notify) onIndexChange?.(current, info);
  };

  const dismiss = () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const step = (delta) => {
    const target = current + delta;
    if (target < 0 || target >= list.length) return;
    apply(target, true);
  };
  close.onclick = (e) => {
    e.stopPropagation();
    dismiss();
  };
  openTab.onclick = (e) => {
    e.stopPropagation();
    const info = currentInfo();
    if (info) window.open(imageUrl(info), "_blank");
  };
  prev.onclick = (e) => {
    e.stopPropagation();
    step(-1);
  };
  next.onclick = (e) => {
    e.stopPropagation();
    step(1);
  };
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) dismiss();
  });
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-delta * 0.0016);
      const next = Math.min(12, Math.max(0.2, scale * factor));
      if (Math.abs(next - scale) < 0.001) return;
      const rect = stage.getBoundingClientRect();
      const ox = e.clientX - (rect.left + rect.width / 2);
      const oy = e.clientY - (rect.top + rect.height / 2);
      const ratio = next / scale;
      tx = ox - (ox - tx) * ratio;
      ty = oy - (oy - ty) * ratio;
      scale = next;
      applyTransform();
    },
    { passive: false }
  );
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    dragging = true;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.classList.add("dragging");
    try {
      stage.setPointerCapture(e.pointerId);
    } catch (_) {}
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyTransform();
  });
  const endDrag = (e) => {
    if (!dragging || (e && pointerId != null && e.pointerId !== pointerId)) return;
    dragging = false;
    pointerId = null;
    stage.classList.remove("dragging");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    resetView();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    }
  };
  window.addEventListener("keydown", onKey, true);

  const onCtx = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const menuItems = [];
    if (onSaveAs) {
      menuItems.push({
        label: "另存为",
        onClick: () => onSaveAs(currentInfo()),
      });
    }
    if (onRegenerate) {
      menuItems.push({
        label: "重新生成",
        onClick: async () => {
          dismiss();
          await onRegenerate(currentInfo());
        },
      });
    }
    menuItems.push(
      {
        label: "新标签打开",
        onClick: () => {
          if (info) window.open(imageUrl(info), "_blank");
        },
      },
      { label: "关闭", onClick: dismiss }
    );
    showContextMenu(e.clientX, e.clientY, menuItems);
  };
  stage.addEventListener("contextmenu", onCtx);
  img.addEventListener("contextmenu", onCtx);
  apply(current, false);
}

function openCompare({ direction, items, onSaveAs }) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length < 2) return;
  closeContextMenu();
  document.querySelectorAll(".tmp-compare").forEach((el) => el.remove());

  const horizontal = direction !== "v";
  const overlay = document.createElement("div");
  overlay.className = "tmp-compare";
  const bar = document.createElement("div");
  bar.className = "tmp-compare-bar";
  const title = document.createElement("strong");
  title.textContent = `${horizontal ? "横向对比" : "纵向对比"} · ${list.length} 张`;
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "滚轮一起缩放，按住左键一起平移，双击复位。右键可另存为当前这张。";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "复位";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "关闭";
  bar.append(title, hint, resetBtn, closeBtn);

  const body = document.createElement("div");
  body.className = "tmp-compare-body " + (horizontal ? "h" : "v");
  const images = [];
  const views = [];

  function dismiss() {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  }

  list.forEach((info, index) => {
    const cell = document.createElement("section");
    cell.className = "tmp-compare-cell";
    const head = document.createElement("header");
    const name = info.asset_name || info.filename || `第 ${index + 1} 张`;
    const res = resolutionLabel(info);
    head.textContent = `#${index + 1} ${name}${res ? " · " + res : ""}`;
    head.title = head.textContent;
    const view = document.createElement("div");
    view.className = "tmp-compare-view";
    const img = document.createElement("img");
    img.draggable = false;
    img.alt = name;
    img.src = imageUrl(info);
    img.addEventListener("load", () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (!w || !h) return;
      head.textContent = `#${index + 1} ${name} · ${w}×${h}`;
      head.title = head.textContent;
    });
    view.appendChild(img);
    cell.append(head, view);
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menuItems = [];
      if (onSaveAs) menuItems.push({ label: "另存为", onClick: () => onSaveAs(info) });
      menuItems.push({ label: "关闭对比", onClick: dismiss });
      showContextMenu(e.clientX, e.clientY, menuItems);
    });
    images.push(img);
    views.push(view);
    body.appendChild(cell);
  });

  overlay.append(bar, body);
  document.body.appendChild(overlay);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const applyTransform = () => {
    const value = `translate(${tx}px, ${ty}px) scale(${scale})`;
    for (const img of images) img.style.transform = value;
  };
  const resetView = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  };
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    dismiss();
  };
  resetBtn.onclick = (e) => {
    e.stopPropagation();
    resetView();
  };
  body.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-delta * 0.0016);
      scale = Math.min(8, Math.max(0.2, scale * factor));
      applyTransform();
    },
    { passive: false }
  );
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  const setDragging = (on) => {
    for (const view of views) view.classList.toggle("dragging", on);
  };
  body.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || e.target.closest("header")) return;
    if (!e.target.closest(".tmp-compare-view")) return;
    dragging = true;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    setDragging(true);
    try {
      body.setPointerCapture(e.pointerId);
    } catch (_) {}
  });
  body.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyTransform();
  });
  const endDrag = (e) => {
    if (!dragging || (e && pointerId != null && e.pointerId !== pointerId)) return;
    dragging = false;
    pointerId = null;
    setDragging(false);
  };
  body.addEventListener("pointerup", endDrag);
  body.addEventListener("pointercancel", endDrag);
  body.addEventListener("dblclick", (e) => {
    if (e.target.closest("button") || e.target.closest("header")) return;
    e.preventDefault();
    e.stopPropagation();
    resetView();
  });
  window.addEventListener("keydown", onKey, true);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForExecution() {
  let done = false;
  let resolveFn = null;
  let onSuccess;
  let onError;
  let onInterrupted;
  const cleanup = () => {
    try {
      api.removeEventListener("execution_success", onSuccess);
      api.removeEventListener("execution_error", onError);
      api.removeEventListener("execution_interrupted", onInterrupted);
    } catch (_) {}
  };
  const finish = (result) => {
    if (done) return;
    done = true;
    cleanup();
    resolveFn?.(result);
  };
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    onSuccess = () => finish({ ok: true });
    onError = (e) => finish({ ok: false, error: e?.detail });
    onInterrupted = () => finish({ ok: false, interrupted: true });
    api.addEventListener("execution_success", onSuccess);
    api.addEventListener("execution_error", onError);
    api.addEventListener("execution_interrupted", onInterrupted);
  });
  return {
    promise,
    cancel: (result = { ok: false, interrupted: true }) => finish(result),
  };
}

async function interruptAndClearQueue() {
  try {
    if (typeof api.interrupt === "function") await api.interrupt();
    else await api.fetchApi("/interrupt", { method: "POST" });
  } catch (_) {}
  try {
    if (typeof api.clearItems === "function") await api.clearItems("queue");
    else {
      await api.fetchApi("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
    }
  } catch (_) {}
}

async function getQueueCounts() {
  try {
    if (typeof api.getQueue === "function") {
      const q = await api.getQueue();
      const running = Array.isArray(q?.Running) ? q.Running.length : 0;
      const pending = Array.isArray(q?.Pending) ? q.Pending.length : 0;
      return { running, pending };
    }
  } catch (_) {}
  try {
    const resp = await api.fetchApi("/queue");
    const data = await resp.json();
    return {
      running: Array.isArray(data?.queue_running) ? data.queue_running.length : 0,
      pending: Array.isArray(data?.queue_pending) ? data.queue_pending.length : 0,
    };
  } catch (_) {
    return null;
  }
}

async function waitUntilIdleOrStop(node) {
  let sawBusy = false;
  const started = Date.now();
  for (;;) {
    if (node.__tmpStop) return { ok: false, interrupted: true };
    const counts = await getQueueCounts();
    if (counts) {
      const busy = counts.running + counts.pending > 0;
      if (busy) sawBusy = true;
      if (sawBusy && !busy) return { ok: true };
      if (!sawBusy && Date.now() - started > 2500) return { ok: true };
    }
    await sleep(250);
  }
}

function downstreamIds(node) {
  const ids = new Set();
  const walk = (current) => {
    if (!current || current.mode === 2 || current.mode === 4) return;
    for (const output of current.outputs || []) {
      for (const linkId of output.links || []) {
        const link = app.graph?.links?.[linkId];
        if (!link) continue;
        const target = app.graph.getNodeById(link.target_id);
        if (!target) continue;
        const tid = String(target.id);
        if (ids.has(tid)) continue;
        ids.add(tid);
        walk(target);
      }
    }
  };
  walk(node);
  return ids;
}

function isOutputNode(id) {
  const graphNode = app.graph?.getNodeById(Number(id));
  if (!graphNode) return false;
  if (graphNode.constructor?.nodeData?.output_node) return true;
  const reg = globalThis.LiteGraph?.registered_node_types?.[graphNode.type];
  return !!reg?.nodeData?.output_node;
}

const SEED_SPAN = 1125899906842624;

function advanceSeeds(graph) {
  const nodes = graph?._nodes || [];
  for (const node of nodes) {
    if (node.mode === 2 || node.mode === 4) continue;
    const widgets = node.widgets || [];
    for (const w of widgets) {
      if (!w || (w.name !== "seed" && w.name !== "noise_seed")) continue;
      const control = widgets.find(
        (c) => c && (c.name === "control_after_generate" || c.name === "control after generate")
      );
      const mode = String(control?.value || "randomize");
      if (mode === "fixed") continue;
      const cur = Number(w.value);
      const base = Number.isFinite(cur) ? Math.trunc(cur) : 0;
      let next = base;
      if (mode === "increment") next = (base + 1) % SEED_SPAN;
      else if (mode === "decrement") next = base <= 0 ? SEED_SPAN - 1 : base - 1;
      else next = Math.floor(Math.random() * SEED_SPAN);
      w.value = next;
      if (w.inputEl) w.inputEl.value = String(next);
      try {
        w.callback?.(next);
      } catch (_) {}
    }
  }
}

async function queueDownstreamOnly(node) {
  const graph = app.rootGraph || app.graph;
  advanceSeeds(graph);
  const built = await app.graphToPrompt(graph);
  const output = JSON.parse(JSON.stringify(built.output || {}));
  const id = String(node.id);
  const entry = output[id];
  if (!entry) throw new Error("当前节点没有进入执行数据");

  const downstream = downstreamIds(node);
  if (!downstream.size) throw new Error("请先把「输出图片」接到下游节点");

  for (const name of ["images", "保存提示词", "保存文件名"]) {
    if (Array.isArray(entry.inputs?.[name])) delete entry.inputs[name];
  }
  entry.inputs = entry.inputs || {};
  entry.inputs.use_source = true;
  entry.inputs.source_index = Number(widget(node, "source_index")?.value || 0);
  entry.inputs.source_json = String(widget(node, "source_json")?.value || "[]");

  const keep = new Set([id, ...downstream]);
  const stack = [...keep];
  while (stack.length) {
    const nid = stack.pop();
    const item = output[nid];
    if (!item?.inputs || nid === id) continue;
    for (const val of Object.values(item.inputs)) {
      if (!Array.isArray(val) || val.length < 2) continue;
      const src = String(val[0]);
      if (!output[src] || keep.has(src)) continue;
      keep.add(src);
      stack.push(src);
    }
  }
  for (const key of Object.keys(output)) {
    if (!keep.has(key)) delete output[key];
  }
  for (const item of Object.values(output)) {
    if (!item?.inputs) continue;
    for (const [name, val] of Object.entries(item.inputs)) {
      if (Array.isArray(val) && val.length >= 2 && output[String(val[0])] == null) delete item.inputs[name];
    }
  }

  const targets = [...downstream].filter((nid) => output[nid] && isOutputNode(nid));
  if (!targets.length) throw new Error("下游没有输出节点，请把「输出图片」接到后面的保存或预览");
  return api.queuePrompt(0, { output, workflow: built.workflow }, { partialExecutionTargets: targets });
}

async function queueOneAndWait(node, submit) {
  const waiter = waitForExecution();
  const stopPoll = new Promise((resolve) => {
    const t = setInterval(() => {
      if (node.__tmpStop) {
        clearInterval(t);
        waiter.cancel({ ok: false, interrupted: true });
        resolve({ ok: false, interrupted: true });
      }
    }, 150);
    waiter.promise.finally(() => clearInterval(t));
  });
  try {
    const queued = submit ? submit() : app.queuePrompt(0);
    if (queued && typeof queued.then === "function") await queued;
  } catch (err) {
    waiter.cancel({ ok: false, interrupted: !!node.__tmpStop, error: err });
    if (node.__tmpStop) return { ok: false, interrupted: true };
    throw err;
  }
  return Promise.race([waiter.promise, stopPoll, waitUntilIdleOrStop(node)]);
}

async function readFileSize(file) {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width || 0, height: bmp.height || 0 };
    bmp.close?.();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

function buildUI(node, mode) {
  if (node.__tmpSaveBuilt) return;
  node.__tmpSaveBuilt = true;
  node.__tmpMode = mode === "load" ? "load" : "save";
  const isLoad = node.__tmpMode === "load";
  ensureStyle();
  hideNative(node, node.__tmpMode);

  const state = applyLoadedState(node);
  state.selected = state.selected instanceof Set ? state.selected : new Set(state.selected || []);

  const root = document.createElement("div");
  root.className = "tmp-save";
  node.__tmpSaveRoot = root;

  const mk = (label, cls = "") => {
    const b = document.createElement("button");
    b.textContent = label;
    if (cls) b.className = cls;
    return b;
  };

  let btnPrefix = null;
  let btnPrompt = null;
  let btnShowPrompt = null;
  let prefixInput = null;
  let locInput = null;
  let toggles = null;
  let fields = null;
  const fieldFocused = () =>
    !isLoad && (document.activeElement === prefixInput || document.activeElement === locInput);
  const syncSaveFields = () => {
    if (isLoad || fieldFocused()) return;
    prefixInput.value = String(widget(node, "filename_prefix")?.value ?? "默认");
    locInput.value = String(widget(node, "save_location")?.value ?? "默认");
    node.__tmpFieldsDirty = false;
  };
  const commitSaveFields = (opts) => {
    if (isLoad || (!node.__tmpFieldsDirty && !fieldFocused())) return;
    setWidget(node, "filename_prefix", prefixInput.value);
    setWidget(node, "save_location", locInput.value);
    writeSettings(node);
    node.__tmpFieldsDirty = false;
    if (!opts?.silent) markGraphDirty(node);
  };
  node.__tmpCommitSaveFields = () => commitSaveFields({ silent: true });
  node.__tmpSyncSaveFields = syncSaveFields;
  if (!isLoad) {
    toggles = document.createElement("div");
    toggles.className = "row";
    btnPrefix = mk("前缀开关");
    btnPrompt = mk("提示词保存开关");
    btnShowPrompt = mk("提示词开关");
    toggles.append(btnPrefix, btnPrompt, btnShowPrompt);

    fields = document.createElement("div");
    fields.className = "tmp-fields";
    prefixInput = document.createElement("input");
    prefixInput.value = String(widget(node, "filename_prefix")?.value ?? "默认");
    prefixInput.placeholder = "例如：角色-- 或 场景--";
    const locWrap = document.createElement("div");
    locWrap.className = "tmp-loc-wrap";
    locInput = document.createElement("input");
    locInput.value = String(widget(node, "save_location")?.value ?? "默认");
    locInput.placeholder = "默认 = Comfy 输出目录，或填绝对路径";
    const onFieldEdit = () => {
      node.__tmpFieldsDirty = true;
      commitSaveFields();
    };
    prefixInput.addEventListener("input", onFieldEdit);
    prefixInput.addEventListener("change", onFieldEdit);
    locInput.addEventListener("input", onFieldEdit);
    locInput.addEventListener("change", onFieldEdit);
    const btnBrowse = mk("浏览…");
    btnBrowse.title = "打开文件夹选择器";
    btnBrowse.onclick = async () => {
      btnBrowse.disabled = true;
      try {
        const resp = await api.fetchApi("/te_man_pro/pick_directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initial: locInput.value }),
        });
        const data = await resp.json();
        if (data?.path) {
          locInput.value = data.path;
          node.__tmpFieldsDirty = true;
          commitSaveFields();
          setStatus(`已选择保存目录：${data.path}`);
        } else if (data?.error) {
          setStatus(`选择目录失败：${data.error}`);
        }
      } catch (err) {
        setStatus(`选择目录失败：${err?.message || err}`);
      } finally {
        btnBrowse.disabled = false;
      }
    };
    locWrap.append(locInput, btnBrowse);
    fields.append(
      Object.assign(document.createElement("span"), { textContent: "文件名前缀" }),
      prefixInput,
      Object.assign(document.createElement("span"), { textContent: "保存位置" }),
      locWrap
    );
  }

  let btnRunAll = null;
  let btnRunOne = null;
  let btnAddFiles = null;
  let btnAddFolder = null;
  let btnStop = null;
  let processRow = null;
  if (isLoad) {
    processRow = document.createElement("div");
    processRow.className = "row";
    btnRunAll = mk("批量执行", "primary");
    btnRunOne = mk("单选执行");
    btnAddFiles = mk("添加图片");
    btnAddFolder = mk("添加文件夹");
    btnStop = mk("停止执行", "danger");
    processRow.append(btnRunAll, btnRunOne, btnAddFiles, btnAddFolder, btnStop);
  }

  const row = document.createElement("div");
  row.className = "row";
  const btnMulti = mk("多图输入");
  const btnAll = mk("全选");
  const btnBatch = mk("批量选择");
  const btnDel = mk("删除", "danger");
  const btnNames = mk("显示图片资产名字");
  const btnZoom = mk("放大查看", "primary");
  let btnRegen = null;
  let btnJoinH = null;
  let btnJoinV = null;
  let btnCompareH = null;
  let btnCompareV = null;
  row.append(btnMulti, btnAll, btnBatch, btnDel, btnNames, btnZoom);
  if (!isLoad) {
    btnRegen = mk("重新生成");
    btnRegen.title = "重新生成选中的图片。批量选中多张后点一次，会按顺序逐张重跑";
    btnJoinH = mk("横向拼接");
    btnJoinH.title = "把选中的图拼成一张横图，并保存到图库";
    btnJoinV = mk("纵向拼接");
    btnJoinV.title = "把选中的图拼成一张竖图，并保存到图库";
    btnCompareH = mk("横向对比");
    btnCompareH.title = "把批量选中的图左右并排查看，不保存";
    btnCompareV = mk("纵向对比");
    btnCompareV.title = "把批量选中的图上下排列查看，不保存";
    row.append(btnRegen, btnJoinH, btnJoinV, btnCompareH, btnCompareV);
  }

  const gallery = document.createElement("div");
  gallery.className = "tmp-gallery";
  const meta = document.createElement("div");
  meta.className = "tmp-meta";
  meta.textContent = isLoad
    ? "准备就绪。添加图片后可批量执行，双击缩略图看大图。"
    : "准备就绪。双击缩略图看大图，右键可另存为或重新生成。";
  let promptPanel = null;
  if (!isLoad) {
    promptPanel = document.createElement("div");
    promptPanel.className = "tmp-prompt-panel empty";
    promptPanel.dataset.prompt = "";
    promptPanel.title = "双击复制提示词";
    promptPanel.textContent = "选中单张图片后，这里显示对应提示词";
  }

  if (isLoad) root.append(processRow, row, gallery, meta);
  else root.append(toggles, fields, row, gallery, meta, promptPanel);

  const setStatus = (t) => {
    meta.textContent = t;
  };

  const copyPromptText = async (text) => {
    const value = String(text || "").trim();
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      return true;
    } catch {
      return false;
    }
  };

  if (promptPanel) promptPanel.addEventListener("dblclick", async () => {
    const text = promptPanel.dataset.prompt || "";
    if (!text) {
      setStatus("没有可复制的提示词");
      return;
    }
    const ok = await copyPromptText(text);
    if (ok) {
      promptPanel.classList.add("copied");
      setStatus("提示词已复制到剪贴板");
      setTimeout(() => promptPanel.classList.remove("copied"), 800);
    } else {
      setStatus("复制失败，请手动选择文本复制");
    }
  });

  const syncToggleButtons = () => {
    if (!btnPrefix) return;
    const prefixOn = !!widget(node, "use_filename_prefix")?.value;
    const promptOn = widget(node, "enable_save_prompt")?.value !== false;
    const showPromptOn = !!state.showPrompt;
    btnPrefix.classList.toggle("on", prefixOn);
    btnPrefix.textContent = prefixOn ? "前缀开关：开" : "前缀开关：关";
    btnPrompt.classList.toggle("on", promptOn);
    btnPrompt.textContent = promptOn ? "提示词保存：开" : "提示词保存：关";
    btnShowPrompt.classList.toggle("on", showPromptOn);
    btnShowPrompt.textContent = showPromptOn ? "提示词：开" : "提示词：关";
    prefixInput.disabled = !prefixOn;
    prefixInput.style.opacity = prefixOn ? "1" : "0.55";
  };

  const setPromptPanelText = (text, emptyMsg) => {
    if (!promptPanel) return;
    const value = String(text || "").trim();
    promptPanel.dataset.prompt = value;
    promptPanel.classList.toggle("empty", !value);
    promptPanel.textContent = value || emptyMsg;
    promptPanel.title = value ? "双击复制提示词" : "";
  };

  const updatePromptPanel = () => {
    if (!promptPanel) return;
    if (!state.showPrompt) {
      promptPanel.style.display = "none";
      promptPanel.dataset.prompt = "";
      return;
    }
    promptPanel.style.display = "";
    const selected = Array.from(state.selected);
    if (selected.length === 1) {
      const info = state.items[selected[0]];
      setPromptPanelText(info?.prompt, "（该图没有保存提示词）");
      return;
    }
    if (selected.length > 1) {
      promptPanel.dataset.prompt = "";
      promptPanel.classList.add("empty");
      promptPanel.textContent = `已选 ${selected.length} 张，单选一张可查看对应提示词`;
      promptPanel.title = "";
      return;
    }
    const active = state.items[state.active];
    if (active) {
      setPromptPanelText(active.prompt, "（该图没有保存提示词）");
      return;
    }
    promptPanel.dataset.prompt = "";
    promptPanel.classList.add("empty");
    promptPanel.textContent = "选中单张图片后，这里显示对应提示词";
    promptPanel.title = "";
  };

  const doRegen = async (info) => regenerateFromInfo(node, info, setStatus);

  const saveOneAs = async (info) => {
    if (!info || isLoad) return;
    const stem = String(info.asset_name || info.filename || "图片").replace(/\.[^.]+$/, "");
    const suggested = `${stem || "图片"}.png`;
    const initial = String(locInput?.value || widget(node, "save_location")?.value || "");
    try {
      setStatus("正在打开另存为…");
      const resp = await api.fetchApi("/te_man_pro/save_as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: info.filename || "",
          subfolder: info.subfolder || "",
          type: info.type || "output",
          abs_path: info.abs_path || "",
          suggested,
          initial,
        }),
      });
      const data = await resp.json();
      if (data?.cancelled) {
        setStatus("已取消另存为");
        return;
      }
      if (!resp.ok || !data?.success) {
        setStatus(`另存失败：${data?.error || resp.status}`);
        return;
      }
      setStatus(`已另存为：${data.path}`);
    } catch (err) {
      setStatus(`另存失败：${err?.message || err}`);
    }
  };

  const openGalleryAt = (index) => {
    if (index < 0 || index >= state.items.length || !state.items[index]) return;
    openLightbox({
      items: state.items,
      index,
      onRegenerate: isLoad ? null : doRegen,
      onSaveAs: isLoad ? null : (info) => saveOneAs(info),
      onIndexChange: (i) => {
        if (i < 0 || i >= state.items.length) return;
        state.active = i;
        state.selected = new Set([i]);
        render();
      },
    });
  };

  let ignoreThumbClick = false;
  const bindThumbReorder = (thumb, fromIndex) => {
    if (!state.multi || node.__tmpBatchRunning) return;
    let timer = 0;
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let pointerId = -1;
    let dropIndex = fromIndex;
    let ghost = null;

    const clearMarks = () => {
      gallery.querySelectorAll(".tmp-thumb.drop-target").forEach((el) => el.classList.remove("drop-target"));
    };
    const indexAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const target = el?.closest?.(".tmp-thumb");
      if (!target || !gallery.contains(target) || target.classList.contains("tmp-thumb-ghost")) return -1;
      return Array.from(gallery.children).indexOf(target);
    };
    const finish = (commit) => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
      if (!dragging) return;
      dragging = false;
      thumb.classList.remove("dragging");
      clearMarks();
      try {
        thumb.releasePointerCapture(pointerId);
      } catch (_) {}
      ignoreThumbClick = true;
      setTimeout(() => {
        ignoreThumbClick = false;
      }, 80);
      if (commit && dropIndex >= 0 && dropIndex !== fromIndex) {
        moveGalleryItem(state, fromIndex, dropIndex);
        setStatus(`已移到第 ${dropIndex + 1} 张`);
      }
      render();
    };
    const onMove = (e) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(timer);
        return;
      }
      e.preventDefault();
      const bounds = gallery.getBoundingClientRect();
      if (e.clientY < bounds.top + 28) gallery.scrollTop -= 14;
      else if (e.clientY > bounds.bottom - 28) gallery.scrollTop += 14;
      if (ghost) {
        ghost.style.left = `${e.clientX - ghost.offsetWidth / 2}px`;
        ghost.style.top = `${e.clientY - ghost.offsetHeight / 2}px`;
      }
      const idx = indexAt(e.clientX, e.clientY);
      dropIndex = idx < 0 ? fromIndex : idx;
      clearMarks();
      const target = gallery.children[dropIndex];
      if (target && dropIndex !== fromIndex) target.classList.add("drop-target");
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const startDrag = () => {
      dragging = true;
      thumb.classList.add("dragging");
      try {
        thumb.setPointerCapture(pointerId);
      } catch (_) {}
      ghost = thumb.cloneNode(true);
      ghost.classList.add("tmp-thumb-ghost");
      ghost.classList.remove("dragging");
      const rect = thumb.getBoundingClientRect();
      ghost.style.pointerEvents = "none";
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.left = `${sx - rect.width / 2}px`;
      ghost.style.top = `${sy - rect.height / 2}px`;
      document.body.appendChild(ghost);
    };

    thumb.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !state.multi || node.__tmpBatchRunning) return;
      sx = e.clientX;
      sy = e.clientY;
      pointerId = e.pointerId;
      dropIndex = fromIndex;
      clearTimeout(timer);
      timer = setTimeout(startDrag, 320);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  };

  const render = () => {
    hideNative(node);
    syncSaveFields();
    if (node.__tmpAllowPersist) saveState(node, state);
    syncToggleButtons();
    btnMulti.classList.toggle("on", !!state.multi);
    btnBatch.classList.toggle("on", !!state.batchSelect);
    btnNames.classList.toggle("on", !!state.showNames);
    const pickedCount = selectedCount(state);
    if (btnRegen) btnRegen.textContent = pickedCount > 1 ? `重新生成 ${pickedCount} 张` : "重新生成";
    gallery.classList.toggle("single", !state.multi);
    gallery.replaceChildren();

    const items = state.multi ? state.items : state.items.slice(-1);
    items.forEach((info, i) => {
      const realIndex = state.multi ? i : state.items.length - 1;
      const thumb = document.createElement("div");
      thumb.className = "tmp-thumb";
      if (state.selected.has(realIndex)) thumb.classList.add("selected");
      if (realIndex === state.active) thumb.classList.add("active");
      thumb.title = isLoad
        ? state.multi
          ? "单击选择，长按拖动排序，双击放大"
          : "单图模式：铺满预览区，双击放大"
        : state.multi
          ? "单击选择，长按拖动排序，双击放大。批量选中后可对比或重新生成，右键另存为"
          : "单图模式：铺满预览区，双击放大，右键另存为或重新生成";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = imageUrl(info);
      img.draggable = false;
      img.addEventListener("load", () => {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        if (!w || !h) return;
        if (info.width === w && info.height === h) return;
        info.width = w;
        info.height = h;
        if (realIndex === state.active) meta.textContent = selectedMeta(state);
      });
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = String(realIndex + 1);
      thumb.append(img, idx);

      if (state.showNames) {
        const aname = document.createElement("div");
        aname.className = "aname";
        aname.textContent = info.asset_name || info.filename || `默认${String(realIndex + 1).padStart(2, "0")}`;
        thumb.append(aname);
      }

      thumb.onclick = (e) => {
        if (ignoreThumbClick) {
          ignoreThumbClick = false;
          e.stopPropagation();
          return;
        }
        if (state.batchSelect) {
          if (state.selected.has(realIndex)) state.selected.delete(realIndex);
          else state.selected.add(realIndex);
        } else {
          state.active = realIndex;
          state.selected = new Set([realIndex]);
        }
        render();
      };
      thumb.ondblclick = (e) => {
        e.stopPropagation();
        state.active = realIndex;
        state.selected = new Set([realIndex]);
        openGalleryAt(realIndex);
      };
      thumb.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const keepMulti = state.batchSelect && state.selected.size > 1 && state.selected.has(realIndex);
        state.active = realIndex;
        if (!keepMulti) state.selected = new Set([realIndex]);
        render();
        const picked = keepMulti ? state.selected.size : 1;
        const menuItems = [];
        if (!isLoad) {
          menuItems.push({
            label: "另存为",
            onClick: () => saveOneAs(info),
          });
          menuItems.push({
            label: picked > 1 ? `重新生成选中的 ${picked} 张` : "重新生成",
            onClick: () => {
              const infos = keepMulti
                ? Array.from(state.selected)
                    .filter((i) => state.items[i])
                    .sort((a, b) => a - b)
                    .map((i) => state.items[i])
                : [info];
              void regenerateMany(node, infos, setStatus);
            },
          });
        }
        menuItems.push({
          label: "放大查看",
          onClick: () => openGalleryAt(realIndex),
        });
        showContextMenu(e.clientX, e.clientY, menuItems);
      };
      bindThumbReorder(thumb, realIndex);
      gallery.appendChild(thumb);
    });

    meta.textContent = selectedMeta(state);
    updatePromptPanel();
  };

  if (btnPrefix) btnPrefix.onclick = () => {
    const cur = !!widget(node, "use_filename_prefix")?.value;
    setWidget(node, "use_filename_prefix", !cur);
    writeSettings(node);
    markGraphDirty(node);
    syncToggleButtons();
  };
  if (btnPrompt) btnPrompt.onclick = () => {
    const cur = widget(node, "enable_save_prompt")?.value !== false;
    setWidget(node, "enable_save_prompt", !cur);
    writeSettings(node);
    markGraphDirty(node);
    syncToggleButtons();
  };
  if (btnShowPrompt) btnShowPrompt.onclick = () => {
    state.showPrompt = !state.showPrompt;
    saveState(node, state);
    syncToggleButtons();
    updatePromptPanel();
  };

  const pushLoaded = (item) => {
    state.items.push(item);
    state.active = state.items.length - 1;
    state.selected = new Set([state.active]);
  };

  if (btnAddFiles) btnAddFiles.onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      input.remove();
      let added = 0;
      for (const file of files) {
        try {
          const size = await readFileSize(file);
          const body = new FormData();
          body.append("image", file, file.name);
          body.append("overwrite", "true");
          const resp = await api.fetchApi("/upload/image", { method: "POST", body });
          const data = await resp.json();
          if (data?.name) {
            const stem = file.name.replace(/\.[^.]+$/, "");
            pushLoaded({
              filename: data.name,
              subfolder: data.subfolder || "",
              type: data.type || "input",
              asset_name: stem,
              source_name: stem,
              prompt: "",
              abs_path: "",
              width: size.width,
              height: size.height,
            });
            added += 1;
          }
        } catch (err) {
          setStatus(`添加失败: ${err?.message || err}`);
        }
      }
      render();
      if (added) setStatus(`已添加 ${added} 张图片`);
    };
    input.click();
  };

  if (btnAddFolder) btnAddFolder.onclick = async () => {
    btnAddFolder.disabled = true;
    try {
      const picked = await api.fetchApi("/te_man_pro/pick_directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial: "" }),
      });
      const pickedData = await picked.json();
      if (!pickedData?.path) {
        if (pickedData?.error) setStatus(`选择文件夹失败：${pickedData.error}`);
        return;
      }
      setStatus("正在读取文件夹…");
      const resp = await api.fetchApi("/te_man_pro/list_images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pickedData.path }),
      });
      const data = await resp.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        setStatus(data?.error || "这个文件夹里没有可用图片");
        return;
      }
      for (const item of items) pushLoaded(item);
      render();
      setStatus(`已从文件夹添加 ${items.length} 张图片`);
    } catch (err) {
      setStatus(`添加文件夹失败：${err?.message || err}`);
    } finally {
      btnAddFolder.disabled = false;
    }
  };

  const runImageBatch = async (indexes) => {
    if (!indexes.length) {
      setStatus("没有可执行的图片");
      return;
    }
    if (node.__tmpBatchRunning) {
      setStatus("正在执行中");
      return;
    }
    if (!downstreamIds(node).size) {
      setStatus("请先把「输出图片」接到下游节点，批量执行不会重跑上游");
      return;
    }
    const snapshot = state.items.map((item) => ({ ...item }));
    node.__tmpStop = false;
    node.__tmpBatchRunning = true;
    node.__tmpUseSource = true;
    let doneCount = 0;
    try {
      for (let i = 0; i < indexes.length; i++) {
        if (node.__tmpStop) {
          setStatus(`已停止（完成 ${doneCount}/${indexes.length}）`);
          return;
        }
        const idx = indexes[i];
        node.__tmpSourceIndex = idx;
        state.active = idx;
        state.selected = new Set([idx]);
        ensureSourceWidgets(node, snapshot, idx, true);
        setStatus(`执行中 ${i + 1}/${indexes.length}（#${String(idx + 1).padStart(2, "0")}）`);
        render();
        try {
          const result = await queueOneAndWait(node, () => queueDownstreamOnly(node));
          if (node.__tmpStop || result?.interrupted) {
            await interruptAndClearQueue();
            setStatus(`已停止（完成 ${doneCount}/${indexes.length}）`);
            return;
          }
          if (result && result.ok === false && !result.interrupted) {
            setStatus(`第 ${idx + 1} 张失败`);
            return;
          }
          doneCount += 1;
        } catch (err) {
          if (node.__tmpStop) {
            await interruptAndClearQueue();
            setStatus(`已停止（完成 ${doneCount}/${indexes.length}）`);
            return;
          }
          setStatus(`第 ${idx + 1} 张失败: ${err?.message || err}`);
          return;
        }
      }
      setStatus(`完成，共执行 ${doneCount} 张`);
    } finally {
      node.__tmpBatchRunning = false;
      node.__tmpUseSource = false;
      ensureSourceWidgets(node, state.items, state.active, false);
    }
  };

  if (btnRunAll) btnRunAll.title = "从第一张执行到最后一张。同一张再跑会换一个种子，不会直接用上次的缓存";
  if (btnRunAll) btnRunAll.onclick = () => {
    if (!state.items.length) {
      setStatus("没有可执行的图片");
      return;
    }
    runImageBatch(state.items.map((_, i) => i));
  };
  if (btnRunOne) btnRunOne.onclick = () => {
    if (state.active < 0 || !state.items[state.active]) {
      setStatus("请先选中一张图片");
      return;
    }
    runImageBatch([state.active]);
  };
  if (btnStop) btnStop.onclick = async () => {
    node.__tmpStop = true;
    setStatus("正在停止…");
    await interruptAndClearQueue();
    setStatus(node.__tmpBatchRunning ? "已请求停止，等待当前任务中断…" : "已停止");
  };

  btnMulti.onclick = () => {
    state.multi = !state.multi;
    render();
  };
  btnAll.onclick = () => {
    state.selected = new Set(state.items.map((_, i) => i));
    state.batchSelect = true;
    render();
  };
  btnBatch.onclick = () => {
    state.batchSelect = !state.batchSelect;
    if (!state.batchSelect) state.selected = new Set(state.active >= 0 ? [state.active] : []);
    render();
  };
  btnNames.onclick = () => {
    state.showNames = !state.showNames;
    render();
  };
  btnZoom.onclick = () => {
    if (!state.items[state.active]) {
      setStatus("没有可放大的图片");
      return;
    }
    openGalleryAt(state.active);
  };
  const selectedImageInfos = () => {
    const indexes = Array.from(state.selected instanceof Set ? state.selected : [])
      .filter((i) => i >= 0 && i < state.items.length)
      .sort((a, b) => a - b);
    if (indexes.length) return indexes.map((i) => state.items[i]);
    return state.items[state.active] ? [state.items[state.active]] : [];
  };
  if (btnRegen) btnRegen.onclick = async () => {
    const infos = selectedImageInfos();
    if (!infos.length) {
      setStatus("请先选中要重新生成的图片");
      return;
    }
    if (!findLinkedBatchPrompt(node)) {
      if (!downstreamIds(node).size) {
        setStatus("请在放原图、并且「输出图片」接到生图流程的节点上重新生成");
        return;
      }
      const picked = Array.from(state.selected instanceof Set ? state.selected : [])
        .filter((i) => i >= 0 && i < state.items.length)
        .sort((a, b) => a - b);
      const indexes = picked.length ? picked : state.active >= 0 ? [state.active] : [];
      await runImageBatch(indexes);
      return;
    }
    await regenerateMany(node, infos, setStatus);
  };
  const loadHtmlImage = (info) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(info.filename || "图片加载失败"));
      img.src = imageUrl(info);
    });

  const stitchSelected = async (direction) => {
    const indexes = Array.from(state.selected).sort((a, b) => a - b);
    if (indexes.length < 2) {
      setStatus("请先批量选择至少 2 张图片");
      return;
    }
    setStatus(direction === "h" ? "正在横向拼接…" : "正在纵向拼接…");
    let imgs = [];
    try {
      imgs = await Promise.all(indexes.map((i) => loadHtmlImage(state.items[i])));
    } catch (err) {
      setStatus(`拼接失败：${err?.message || err}`);
      return;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (direction === "h") {
      const height = Math.max(...imgs.map((img) => img.naturalHeight || img.height));
      const scaled = imgs.map((img) => {
        const h = img.naturalHeight || img.height || 1;
        const w = img.naturalWidth || img.width || 1;
        return { img, w: Math.max(1, Math.round((w * height) / h)), h: height };
      });
      canvas.width = scaled.reduce((sum, item) => sum + item.w, 0);
      canvas.height = height;
      let x = 0;
      for (const item of scaled) {
        ctx.drawImage(item.img, x, 0, item.w, item.h);
        x += item.w;
      }
    } else {
      const width = Math.max(...imgs.map((img) => img.naturalWidth || img.width));
      const scaled = imgs.map((img) => {
        const h = img.naturalHeight || img.height || 1;
        const w = img.naturalWidth || img.width || 1;
        return { img, w: width, h: Math.max(1, Math.round((h * width) / w)) };
      });
      canvas.width = width;
      canvas.height = scaled.reduce((sum, item) => sum + item.h, 0);
      let y = 0;
      for (const item of scaled) {
        ctx.drawImage(item.img, 0, y, item.w, item.h);
        y += item.h;
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      setStatus("拼接失败：无法生成图片");
      return;
    }
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const filename = `拼接${direction === "h" ? "横" : "纵"}_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    const body = new FormData();
    body.append("image", blob, `${filename}.png`);
    body.append("save_location", String(widget(node, "save_location")?.value || "默认"));
    body.append("filename", filename);
    try {
      const resp = await api.fetchApi("/te_man_pro/save_png", { method: "POST", body });
      const data = await resp.json();
      if (!resp.ok || !data?.success || !data.item) {
        setStatus(`拼接保存失败：${data?.error || resp.status}`);
        return;
      }
      state.items.push(data.item);
      state.active = state.items.length - 1;
      state.selected = new Set([state.active]);
      state.batchSelect = false;
      saveState(node, state);
      render();
      setStatus(`已${direction === "h" ? "横向" : "纵向"}拼接 ${indexes.length} 张：${data.item.asset_name}`);
    } catch (err) {
      setStatus(`拼接保存失败：${err?.message || err}`);
    }
  };
  if (btnJoinH) btnJoinH.onclick = () => stitchSelected("h");
  if (btnJoinV) btnJoinV.onclick = () => stitchSelected("v");
  const compareSelected = (direction) => {
    const indexes = Array.from(state.selected).sort((a, b) => a - b);
    const infos = indexes.map((i) => state.items[i]).filter(Boolean);
    if (infos.length < 2) {
      setStatus("请先点「批量选择」，再勾选至少 2 张图片");
      return;
    }
    openCompare({
      direction,
      items: infos,
      onSaveAs: (info) => saveOneAs(info),
    });
    setStatus(`正在${direction === "h" ? "横向" : "纵向"}对比 ${infos.length} 张。滚轮缩放，拖动平移。`);
  };
  if (btnCompareH) btnCompareH.onclick = () => compareSelected("h");
  if (btnCompareV) btnCompareV.onclick = () => compareSelected("v");

  btnDel.onclick = async () => {
    const indexes = Array.from(state.selected).sort((a, b) => b - a);
    let keptFiles = 0;
    for (const i of indexes) {
      const info = state.items[i];
      if (!info) continue;
      const shared = otherNodeUsesImage(node, info);
      try {
        if (info.abs_path && !shared) {
          await api.fetchApi("/te_man_pro/delete_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: info.abs_path }),
          });
        } else if (shared) {
          keptFiles += 1;
        }
      } catch (_) {}
      state.items.splice(i, 1);
    }
    state.selected = new Set();
    state.active = Math.max(0, Math.min(state.active, state.items.length - 1));
    if (keptFiles) setStatus(`已从本节点移除。${keptFiles} 张文件仍被另一个节点使用，未删除`);
    render();
  };

  root.style.width = "100%";
  root.style.height = "100%";
  root.style.minHeight = "0";
  root.style.maxHeight = "100%";
  root.style.overflow = "hidden";
  root.style.flex = "1 1 auto";
  // Min height keeps a usable panel. Max height takes the free space in the
  // node, so the controls fill the body instead of sitting in a corner.
  const dom = node.addDOMWidget("te_man_pro_save_ui", "te_man_pro_save", root, {
    serialize: false,
    hideOnZoom: false,
  });
  useDomLayout(dom, 300);
  // addDOMWidget only stores this on options. Graph save reads widget.serialize.
  if (dom) {
    dom.serialize = false;
    if (dom.options) dom.options.serialize = false;
  }

  node.__tmpSaveState = state;
  node.__tmpSaveRender = render;
  node.__tmpAllowPersist = false;
  queueMicrotask(() => {
    hideNative(node);
    if (!node.__tmpConfigured) render();
  });
  setTimeout(() => hideNative(node), 50);
  setTimeout(() => hideNative(node), 300);
  setTimeout(() => {
    if (!node.__tmpConfigured) node.__tmpAllowPersist = true;
  }, 250);
}

function ingest(node, message) {
  const assets = message?.te_man_pro_assets;
  if (!Array.isArray(assets) || !assets.length) return;
  const state = node.__tmpSaveState || applyLoadedState(node);
  state.selected = state.selected instanceof Set ? state.selected : new Set(state.selected || []);
  if (!state.multi) state.items = [];
  for (const item of assets) {
    state.items.push({
      filename: item.filename,
      subfolder: item.subfolder || "",
      type: item.type || "output",
      asset_name: item.asset_name || "",
      source_name: item.source_name || item.asset_name || "",
      prompt: item.prompt || "",
      abs_path: item.abs_path || "",
      width: Number(item.width || 0),
      height: Number(item.height || 0),
    });
  }
  state.active = state.items.length - 1;
  state.selected = new Set([state.active]);
  node.__tmpSaveState = state;
  saveState(node, state);
  node.__tmpSaveRender?.();
}

function bindImageNode(nodeType, mode) {
  const onNodeCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const r = onNodeCreated?.apply(this, arguments);
    try {
      this.__tmpMode = mode;
      stripNodeChrome(this);
      buildUI(this, mode);
    } catch (err) {
      console.error("[feimao tools Image]", err);
    }
    return r;
  };
  if (mode === "save") {
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = onExecuted?.apply(this, arguments);
      try {
        ingest(this, message);
      } catch (err) {
        console.error("[feimao tools Save ingest]", err);
      }
      return r;
    };
  }
  const onConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const r = onConfigure?.apply(this, arguments);
    const restore = () => {
      if (!this.__tmpSaveBuilt) return;
      this.__tmpMode = mode;
      this.__tmpConfigured = true;
      stripNodeChrome(this);
      hideNative(this, mode);
      this.__tmpAllowPersist = false;
      if (mode === "save") applySavedSettings(this);
      ensureUid(this);
      this.__tmpSyncSaveFields?.();
      applyLoadedState(this);
      this.__tmpSaveRender?.();
      this.__tmpAllowPersist = true;
      void restoreGallery(this);
    };
    queueMicrotask(restore);
    // widgets_values may land slightly later on some Comfy builds
    setTimeout(restore, 0);
    setTimeout(restore, 120);
    return r;
  };
  const onSerialize = nodeType.prototype.onSerialize;
  nodeType.prototype.onSerialize = function (o) {
    try {
      this.__tmpCommitSaveFields?.();
      const state = this.__tmpSaveState;
      const nextItems = state?.items?.length || 0;
      const prevItems = parseGalleryPayload(o?.properties?.[STATE_KEY]).items?.length || 0;
      if (this.__tmpAllowPersist && state) saveState(this, state);
      if (o && state && (nextItems > 0 || prevItems === 0)) {
        o.properties = o.properties || {};
        o.properties[STATE_KEY] = {
          items: state.items,
          active: state.active,
          multi: state.multi,
          showNames: state.showNames,
          showPrompt: !!state.showPrompt,
          batchSelect: state.batchSelect,
          selected: Array.from(state.selected || []),
        };
      }
      if (o && this.properties?.[SETTINGS_KEY]) {
        o.properties = o.properties || {};
        o.properties[SETTINGS_KEY] = this.properties[SETTINGS_KEY];
      }
      if (o && this.properties?.te_man_pro_uid) {
        o.properties = o.properties || {};
        o.properties.te_man_pro_uid = this.properties.te_man_pro_uid;
      }
      patchSerializedWidgets(o, this);
    } catch (_) {}
    return onSerialize?.apply(this, arguments);
  };
}

function refreshImageNode(node) {
  const kind = node?.comfyClass || node?.type;
  const mode = kind === SAVE_CLASS ? "save" : kind === LOAD_CLASS ? "load" : "";
  if (!mode || !node.__tmpSaveBuilt) return;
  hideNative(node, mode);
}

app.registerExtension({
  name: "TE.ManPro.SaveImage",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === SAVE_CLASS) bindImageNode(nodeType, "save");
    else if (nodeData?.name === LOAD_CLASS) bindImageNode(nodeType, "load");
  },
  // Workflow load binds widgets after onNodeCreated. Hide again once the
  // node is in the graph, or frontend 1.58 draws the raw controls.
  nodeCreated(node) {
    queueMicrotask(() => refreshImageNode(node));
    setTimeout(() => refreshImageNode(node), 0);
    setTimeout(() => refreshImageNode(node), 300);
  },
});

