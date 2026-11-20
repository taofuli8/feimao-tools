import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { hideComfyWidget } from "./hide_widget.js";

const NODE_CLASS = "feimao_tools_Image_Prompt";
const SLOT_CEILING = 100;
const STYLE_ID = "tmp-ip-style-v21";
const NODE_WIDTH = 400;
const NODE_HEIGHT = 472;
const UI_HEIGHT = 388;
const NODE_HEIGHT_MAX = 2400;
// 472 fits the panel plus the first 6 output rows, including 图片反推.
const BASE_SLOTS = 6;
const SLOT_ROW = 20;
const WIDTH_SLOT = 0;
const HEIGHT_SLOT = 1;
const PROMPT_SLOT = 2;
const BATCH_SLOT = 3;
const IMAGE_SLOT = 4;
const ASPECTS = [["1:1", 1, 1], ["4:3", 4, 3], ["3:4", 3, 4], ["3:2", 3, 2], ["2:3", 2, 3], ["16:9", 16, 9], ["9:16", 9, 16], ["21:9", 21, 9]];
const MULTIPLES = [8, 16, 32, 64];
const FORMATS = ["自动", "H3 <Picture N>", "千问 <imageN>"];
const HIDDEN = ["images_json", "prompt_raw", "引用格式", "送出格式", "linked_json", "宽高比", "百万像素", "对齐倍数", "跟随参考图", "参考图"];

const QWEN_TYPES = new Set([
  "TextEncodeQwenImage21",
  "TextEncodeQwenImageEditPlus",
  "TextEncodeQwenImageEdit",
]);
const H3_TYPES = new Set(["MiniMaxH3ImageConditioning", "PH3ImageConditioning"]);

function ensureStyle() {
  document.querySelectorAll("[id^='tmp-ip-style']").forEach((el) => {
    if (el.id !== STYLE_ID) el.remove();
  });
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tmp-ip { width:100%; height:auto; min-height:0; box-sizing:border-box; padding:2px 0 2px; display:flex; flex-direction:column; gap:6px;
      overflow:hidden; background:transparent; color:var(--input-text); }
    .tmp-ip-bar { display:flex; gap:8px; align-items:center; flex:0 0 auto; }
    .tmp-ip-picker { flex:0 0 auto; background:#111; color:#fff; border:1px solid rgba(255,255,255,.45); border-radius:6px; padding:3px 10px; font-size:14px; font-weight:700; cursor:pointer; }
    .tmp-ip-send { flex:1 1 auto; min-width:0; font-size:13px; font-weight:650; color:#fff; opacity:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tmp-ip-fmt { color:#fff; font-size:14px; font-weight:700; }
    .tmp-ip-editor { position:relative; flex:0 0 auto; height:84px; overflow:auto; white-space:pre-wrap; word-break:break-word; box-sizing:border-box;
      background:rgba(0,0,0,.28); border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:6px 8px; font:13px/1.45 inherit; outline:none; }
    .tmp-ip-editor:focus { border-color:rgba(255,180,60,.7); }
    .tmp-ip-editor.is-empty:before { content:attr(data-placeholder); position:absolute; left:8px; top:6px; right:8px;
      color:#777; pointer-events:none; white-space:pre-wrap; }
    .tmp-ip-chip { display:inline-flex; align-items:center; gap:4px; max-width:100%; margin:0 2px; padding:1px 6px 1px 2px; border-radius:999px;
      border:1px solid rgba(80,200,140,.8); background:rgba(40,120,80,.28); vertical-align:middle; user-select:none; }
    .tmp-ip-chip.missing { border-style:dashed; opacity:.7; }
    .tmp-ip-chip img { width:18px; height:18px; object-fit:cover; border-radius:4px; background:#111; }
    .tmp-ip-chip-label { font-size:11px; font-weight:650; }
    .tmp-ip-grid { flex:0 0 auto; min-height:0; max-height:142px; overflow:auto; display:flex; flex-wrap:wrap; gap:6px; align-content:flex-start; }
    .tmp-ip-shot, .tmp-ip-plus { position:relative; width:64px; height:64px; flex:0 0 64px; border-radius:8px; overflow:hidden; background:#111; border:1px solid rgba(255,255,255,.14); }
    .tmp-ip-shot img { width:100%; height:100%; object-fit:cover; display:block; }
    .tmp-ip-shot.dragging { opacity:.35; }
    .tmp-ip-badge { position:absolute; left:3px; bottom:3px; padding:0 4px; border-radius:999px; background:rgba(0,0,0,.72); font-size:10px; }
    .tmp-ip-x { position:absolute; top:2px; right:2px; width:16px; height:16px; border:0; border-radius:999px; background:rgba(0,0,0,.7); color:#fff; cursor:pointer; line-height:16px; padding:0; }
    .tmp-ip-plus { display:flex; align-items:center; justify-content:center; font-size:22px; cursor:pointer; color:#ddd; background:transparent; border-style:dashed; }
    .tmp-ip-plus:disabled { opacity:.4; cursor:default; }
    .tmp-ip-status { flex:0 0 auto; font-size:11px; line-height:1.3; opacity:.65; }
    .tmp-ip-size { flex:0 0 auto; margin-top:0; display:flex; flex-direction:column; gap:6px;
      padding-top:6px; border-top:1px solid rgba(255,255,255,.1); }
    .tmp-ip-follow { display:flex; align-items:center; gap:8px; min-width:0; }
    .tmp-ip-follow-check { display:flex; align-items:center; gap:6px; flex:0 0 auto; margin:0; font-size:12px; font-weight:650; color:#fff; cursor:pointer; user-select:none; }
    .tmp-ip-follow-check input { width:14px; height:14px; margin:0; flex:0 0 auto; accent-color:#7dffa8; }
    .tmp-ip-follow select { flex:0 0 84px; width:84px; box-sizing:border-box; background:#111; color:#fff; color-scheme:dark;
      border:1px solid rgba(255,255,255,.28); border-radius:6px; padding:3px 6px; font-size:13px; font-weight:650; }
    .tmp-ip-pixels { flex:1 1 auto; min-width:0; text-align:right; font-size:12px; font-weight:650; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tmp-ip-size-grid { display:grid; grid-template-columns:1.1fr .9fr .7fr; gap:4px 8px; align-items:end; }
    .tmp-ip-size-grid.is-locked { opacity:.4; }
    .tmp-ip-size-grid.is-locked select, .tmp-ip-size-grid.is-locked input { pointer-events:none; }
    .tmp-ip-grip { flex:0 0 auto; height:16px; margin-top:2px; cursor:ns-resize; display:flex; align-items:center; justify-content:center; touch-action:none; }
    .tmp-ip-grip:before { content:""; width:46px; height:4px; border-radius:999px; background:rgba(255,255,255,.72); }
    .tmp-ip-field { display:flex; flex-direction:column; gap:2px; min-width:0; font-size:12px; color:#eee; opacity:1; }
    .tmp-ip-field select, .tmp-ip-field input { width:100%; box-sizing:border-box; background:#111; color:#fff; color-scheme:dark;
      border:1px solid rgba(255,255,255,.28); border-radius:6px; padding:3px 6px; font-size:13px; font-weight:650; }
    .tmp-ip-field select option { background:#111; color:#fff; font-weight:650; }
    .tmp-ip-menu { position:fixed; z-index:10050; min-width:220px; max-width:320px; max-height:260px; overflow:auto; background:#141414;
      border:1px solid #444; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.45); padding:4px 0; }
    .tmp-ip-menu.hidden { display:none; }
    .tmp-ip-item, .tmp-ip-empty { display:flex; align-items:center; gap:8px; width:100%; padding:6px 10px; background:transparent; border:0; color:#ddd; text-align:left; cursor:pointer; }
    .tmp-ip-item.active, .tmp-ip-item:hover { background:#333; color:#fff; }
    .tmp-ip-item img { width:36px; height:36px; object-fit:cover; border-radius:4px; background:#111; }
    .tmp-ip-item b { color:#8dffb8; font-size:12px; }
    .tmp-ip-empty { cursor:default; color:#888; font-size:12px; }
    .tmp-ip-lightbox { position:fixed; inset:0; z-index:10060; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
      background:rgba(0,0,0,.82); cursor:zoom-out; }
    .tmp-ip-lightbox.hidden { display:none; }
    .tmp-ip-lightbox img { max-width:90vw; max-height:84vh; object-fit:contain; border-radius:8px; background:#111; }
    .tmp-ip-lightbox-cap { color:#fff; font-size:14px; font-weight:650; }
  `;
  document.head.appendChild(style);
}

function minNodeHeight(node) {
  const slots = node?.outputs?.length || BASE_SLOTS;
  const extra = Math.max(0, slots - BASE_SLOTS);
  return NODE_HEIGHT + extra * SLOT_ROW;
}

function promptExtra(node) {
  return Math.max(0, Math.min(480, node?.__tmpPromptExtra || 0));
}

function intendedHeight(node) {
  return Math.min(NODE_HEIGHT_MAX, minNodeHeight(node) + promptExtra(node));
}

function widgetBox(node) {
  return UI_HEIGHT + promptExtra(node);
}

function applyNodeHeight(node, height) {
  const base = minNodeHeight(node);
  const extra = Math.max(0, Math.min(480, height - base));
  node.__tmpPromptExtra = extra;
  if (node.__tmpEditor) node.__tmpEditor.style.height = `${84 + extra}px`;
  node.__tmpFitting = true;
  try {
    node.setSize?.([node.size?.[0] || NODE_WIDTH, base + extra]);
  } finally {
    node.__tmpFitting = false;
  }
}

function openPreview(item, label) {
  let overlay = document.getElementById("tmp-ip-lightbox");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tmp-ip-lightbox";
    overlay.className = "tmp-ip-lightbox hidden";
    const img = document.createElement("img");
    img.alt = "";
    const cap = document.createElement("div");
    cap.className = "tmp-ip-lightbox-cap";
    overlay.append(img, cap);
    const close = () => overlay.classList.add("hidden");
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    document.body.appendChild(overlay);
  }
  overlay.querySelector("img").src = viewUrl(item);
  overlay.querySelector(".tmp-ip-lightbox-cap").textContent = label;
  overlay.classList.remove("hidden");
}

function widget(node, name) {
  return (node.widgets || []).find((item) => item?.name === name);
}

function setSilent(node, name, value) {
  const item = widget(node, name);
  if (!item || item.value === value) return;
  item.value = value;
}

function readPrompt(node) {
  const item = widget(node, "prompt_raw");
  const fromWidget = String(item?.value ?? "");
  if (fromWidget) return fromWidget;
  const fromBox = String(item?.element?.value || item?.inputEl?.value || "");
  if (fromBox) return fromBox;
  return String(node?.properties?.tmp_prompt || "");
}

function rememberPrompt(node, text) {
  setSilent(node, "prompt_raw", text);
  if (!node.properties) node.properties = {};
  node.properties.tmp_prompt = text;
}

function hideWidgets(node) {
  for (const name of HIDDEN) hideComfyWidget(widget(node, name));
}

function graphLoading() {
  return !!app.configuringGraph || !!app.canvas?.configuringGraph;
}

function getLink(graph, id) {
  if (id == null || !graph?.links) return null;
  if (typeof graph.links.get === "function") return graph.links.get(id) || graph.links[id] || null;
  return graph.links[id] || null;
}

function linkEnds(link) {
  if (!link) return null;
  if (Array.isArray(link)) {
    return { origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4] };
  }
  return {
    origin_id: link.origin_id,
    origin_slot: link.origin_slot,
    target_id: link.target_id,
    target_slot: link.target_slot,
  };
}

function nodeById(graph, id) {
  if (!graph || id == null) return null;
  if (typeof graph.getNodeById === "function") return graph.getNodeById(id);
  return (graph._nodes || []).find((node) => node.id === id) || null;
}

function nodesFromOutput(node, slot) {
  const output = node.outputs?.[slot];
  const found = [];
  for (const id of output?.links || []) {
    const ends = linkEnds(getLink(node.graph, id));
    const target = ends ? nodeById(node.graph, ends.target_id) : null;
    if (target) found.push(target);
  }
  return found;
}

function nodeType(node) {
  return node?.comfyClass || node?.type || "";
}

function readImages(node) {
  if (Array.isArray(node.__tmpImages)) return node.__tmpImages.map((item) => ({ ...item }));
  try {
    const data = JSON.parse(widget(node, "images_json")?.value || "[]");
    return Array.isArray(data) ? data.filter((item) => item && item.filename) : [];
  } catch {
    return [];
  }
}

function bindLiveImages(node) {
  const item = widget(node, "images_json");
  if (!item || item.__tmpLive) return;
  item.__tmpLive = true;
  item.serializeValue = () => JSON.stringify(Array.isArray(node.__tmpImages) ? node.__tmpImages : readImages(node));
}

function writeImages(node, items) {
  node.__tmpImages = items.map((item) => ({ ...item }));
  setSilent(node, "images_json", JSON.stringify(node.__tmpImages));
  bindLiveImages(node);
}

function captureImages(node) {
  node.__tmpImages = undefined;
  node.__tmpImages = readImages(node);
  bindLiveImages(node);
}

function connectionStats(node) {
  let prefix = 0;
  let highest = -1;
  const linked = [];
  const outputs = node.outputs || [];
  for (let slot = IMAGE_SLOT; slot < outputs.length; slot += 1) {
    const index = slot - IMAGE_SLOT;
    const on = !!(outputs[slot]?.links && outputs[slot].links.length);
    if (!on) continue;
    linked.push(index);
    if (index > highest) highest = index;
    if (index === prefix) prefix += 1;
  }
  return { prefix, highest, linked };
}

function writeLinked(node) {
  setSilent(node, "linked_json", JSON.stringify(connectionStats(node).linked));
}

function promptTargets(node) {
  return nodesFromOutput(node, PROMPT_SLOT).filter((target) => target && target.id !== node.id);
}

function knownTargets(node) {
  return promptTargets(node).filter((target) => H3_TYPES.has(nodeType(target)) || QWEN_TYPES.has(nodeType(target)));
}

function nameBase(node) {
  for (const target of knownTargets(node)) {
    if (nodeType(target) !== "MiniMaxH3ImageConditioning") return 1;
  }
  return 0;
}

function resolvedFormat(node) {
  const choice = widget(node, "引用格式")?.value || "自动";
  if (choice && choice !== "自动") return choice;
  for (const target of knownTargets(node)) {
    if (QWEN_TYPES.has(nodeType(target))) return "千问 <imageN>";
    if (H3_TYPES.has(nodeType(target))) return "H3 <Picture N>";
  }
  return "H3 <Picture N>";
}

function promptHasRef(node) {
  const text = node.__tmpPromptReady && node.__tmpEditor ? serializeEditor(node.__tmpEditor) : readPrompt(node);
  return /\{\{img:\d+\}\}|<Picture\s+\d+\s*>|<image\s*\d+\s*>|@图片\s*\d+/i.test(text);
}

function tagFor(fmt, number) {
  return String(fmt).startsWith("千问") ? `<image${number}>` : `<Picture ${number}>`;
}

function formatLabel(choice) {
  if (String(choice).startsWith("千问")) return "<imageN>";
  if (String(choice).startsWith("H3")) return "<Picture N>";
  return "自动";
}

const sizeCache = new Map();
const sizeJobs = new Map();

function sizeKey(item) {
  return [item?.type || "input", item?.subfolder || "", item?.filename || "", item?.abs_path || "", item?.token || ""].join("|");
}

function knownSize(item) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  if (width > 0 && height > 0) return [width, height];
  if (item && sizeCache.has(sizeKey(item))) return sizeCache.get(sizeKey(item));
  return undefined;
}

function rememberSize(item, size) {
  if (!item) return;
  sizeCache.set(sizeKey(item), size);
}

function probeSize(item) {
  const key = sizeKey(item);
  if (sizeCache.has(key)) return Promise.resolve(sizeCache.get(key));
  if (sizeJobs.has(key)) return sizeJobs.get(key);
  const job = new Promise((resolve) => {
    const img = new Image();
    const finish = (size) => {
      sizeCache.set(key, size);
      sizeJobs.delete(key);
      resolve(size);
    };
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      finish(width > 0 && height > 0 ? [width, height] : null);
    };
    img.onerror = () => finish(null);
    img.src = viewUrl(item);
  });
  sizeJobs.set(key, job);
  return job;
}

function viewUrl(item) {
  let name = String(item.filename || "");
  let sub = String(item.subfolder || "");
  if (!sub && name.includes("/")) {
    const cut = name.lastIndexOf("/");
    sub = name.slice(0, cut);
    name = name.slice(cut + 1);
  }
  const params = new URLSearchParams({ filename: name, type: item.type || "input" });
  if (sub) params.set("subfolder", sub);
  if (item.token) params.set("t", String(item.token));
  return api.apiURL(`/view?${params.toString()}`);
}

function markDirty(node) {
  try {
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
  } catch (_) {}
}

function targetSlot(target, ordinal) {
  const type = nodeType(target);
  if (type === "TextEncodeQwenImageEditPlus") {
    if (ordinal > 2) return null;
    return { name: `image${ordinal + 1}`, label: `image${ordinal + 1}` };
  }
  if (type === "TextEncodeQwenImageEdit") {
    return ordinal === 0 ? { name: "image", label: "image" } : null;
  }
  const base = type === "MiniMaxH3ImageConditioning" ? 0 : 1;
  const number = base + ordinal;
  return { name: `images.image_${number}`, label: `image_${number}` };
}

function findInput(target, spec) {
  return (target.inputs || []).findIndex((input) => {
    const names = [input?.name, input?.label, input?.localized_name].map((item) => String(item || ""));
    return names.includes(spec.name) || names.includes(spec.label);
  });
}

function ensureTargetInput(target, ordinal) {
  const spec = targetSlot(target, ordinal);
  if (!spec) return -1;
  const existing = findInput(target, spec);
  if (existing >= 0) return existing;
  if (!H3_TYPES.has(nodeType(target)) && nodeType(target) !== "TextEncodeQwenImage21") return -1;
  target.addInput(spec.name, "IMAGE");
  const input = target.inputs[target.inputs.length - 1];
  input.name = spec.name;
  input.label = spec.label;
  input.localized_name = spec.label;
  return target.inputs.length - 1;
}

function trimSpareInputs(node) {
  if (!node?.inputs || node.__tmpTrimming || graphLoading()) return;
  if (!H3_TYPES.has(nodeType(node))) return;
  const rows = [];
  node.inputs.forEach((input, index) => {
    const match = String(input?.name || "").match(/^images\.image_(\d+)$/);
    if (!match) return;
    rows.push({ index, ordinal: Number(match[1]), linked: input.link != null });
  });
  if (!rows.length) return;
  let lastLinked = -1;
  for (const row of rows) if (row.linked) lastLinked = Math.max(lastLinked, row.ordinal);
  const keep = lastLinked + 1;
  const drop = rows.filter((row) => row.ordinal > keep && !row.linked).sort((a, b) => b.index - a.index);
  if (!drop.length) return;
  node.__tmpTrimming = true;
  try {
    for (const row of drop) {
      try { node.removeInput(row.index); } catch (_) {}
    }
  } finally {
    node.__tmpTrimming = false;
  }
}

function trimKnownTargets(node) {
  for (const target of knownTargets(node)) trimSpareInputs(target);
}

function shiftOriginSlots(node, fromSlot, delta) {
  const links = (node.graph || app.graph)?.links;
  if (!links) return;
  const list = typeof links.values === "function" ? [...links.values()] : Object.values(links);
  for (const link of list) {
    if (!link) continue;
    if (Array.isArray(link)) {
      if (Number(link[1]) === Number(node.id) && link[2] >= fromSlot) link[2] += delta;
      continue;
    }
    if (Number(link.origin_id) === Number(node.id) && link.origin_slot >= fromSlot) link.origin_slot += delta;
  }
}

function pinOutput(node, index, name, type) {
  while (node.outputs.length <= index) node.addOutput(name, type);
  const output = node.outputs[index];
  output.name = name;
  output.type = type;
  if (!output.label || output.label === output.name) output.label = name;
  output.localized_name = output.label;
}

function remapOriginSlots(node, map) {
  const links = (node.graph || app.graph)?.links;
  if (!links) return;
  const list = typeof links.values === "function" ? [...links.values()] : Object.values(links);
  for (const link of list) {
    if (!link) continue;
    if (Array.isArray(link)) {
      if (Number(link[1]) !== Number(node.id)) continue;
      if (Object.prototype.hasOwnProperty.call(map, link[2])) link[2] = map[link[2]];
      continue;
    }
    if (Number(link.origin_id) !== Number(node.id)) continue;
    if (Object.prototype.hasOwnProperty.call(map, link.origin_slot)) link.origin_slot = map[link.origin_slot];
  }
}

function migrateHead(node) {
  const outputs = node.outputs || [];
  const first = outputs[0];
  const second = outputs[1];
  const third = outputs[2];
  if (first?.type === "INT" && third?.type === "STRING") return;
  if (first?.type === "STRING" && second?.type === "INT" && third?.type === "INT") {
    outputs.splice(0, 3, second, third, first);
    remapOriginSlots(node, { 0: 2, 1: 0, 2: 1 });
    return;
  }
  if (first?.type === "STRING" && (!second || second.type === "IMAGE")) {
    outputs.splice(1, 0,
      { name: "宽度", type: "INT", links: null, label: "宽度", localized_name: "宽度" },
      { name: "高度", type: "INT", links: null, label: "高度", localized_name: "高度" },
    );
    shiftOriginSlots(node, 1, 2);
    const prompt = outputs[0];
    const width = outputs[1];
    const height = outputs[2];
    outputs.splice(0, 3, width, height, prompt);
    remapOriginSlots(node, { 0: 2 });
  }
}

function migrateBatch(node) {
  const outputs = node.outputs || [];
  const prompt = outputs[PROMPT_SLOT];
  const next = outputs[BATCH_SLOT];
  if (prompt?.type !== "STRING") return;
  if (next?.name === "已上传" || next?.label === "已上传" || next?.name === "图片反推" || next?.label === "图片反推") {
    if (next) {
      next.name = "图片反推";
      next.label = "图片反推";
      next.localized_name = "图片反推";
    }
    return;
  }
  outputs.splice(BATCH_SLOT, 0, {
    name: "图片反推",
    type: "IMAGE",
    links: null,
    label: "图片反推",
    localized_name: "图片反推",
  });
  shiftOriginSlots(node, BATCH_SLOT, 1);
}

function dropStoryboard(node) {
  const outputs = node.outputs || [];
  const slot = outputs[4];
  if (slot?.name !== "分镜开关" && slot?.type !== "BOOLEAN") return;
  for (let index = 7; index >= 4; index -= 1) {
    try { node.disconnectOutput(index); } catch (_) {}
  }
  shiftOriginSlots(node, 8, -4);
  outputs.splice(4, 4);
}

function ensureOutputs(node) {
  if (!node?.outputs || node.__tmpEnsuring) return;
  node.__tmpEnsuring = true;
  try {
    migrateHead(node);
    migrateBatch(node);
    dropStoryboard(node);
    pinOutput(node, WIDTH_SLOT, "宽度", "INT");
    pinOutput(node, HEIGHT_SLOT, "高度", "INT");
    pinOutput(node, PROMPT_SLOT, "提示词", "STRING");
    pinOutput(node, BATCH_SLOT, "图片反推", "IMAGE");
    const batch = node.outputs[BATCH_SLOT];
    if (batch) {
      batch.label = "图片反推";
      batch.localized_name = "图片反推";
    }
    const images = readImages(node).length;
    const stats = connectionStats(node);
    let visible = Math.max(1, images, stats.prefix + 1, stats.highest + 2);
    visible = Math.min(SLOT_CEILING, visible);
    while (node.outputs.length - IMAGE_SLOT > visible) {
      const last = node.outputs.length - 1;
      if (last < IMAGE_SLOT) break;
      if (node.outputs[last]?.links?.length) break;
      try { node.disconnectOutput(last); } catch (_) {}
      node.removeOutput(last);
    }
    while (node.outputs.length - IMAGE_SLOT < visible) node.addOutput("image", "IMAGE");
    const base = nameBase(node);
    for (let index = 0; index < node.outputs.length - IMAGE_SLOT; index += 1) {
      const output = node.outputs[index + IMAGE_SLOT];
      const name = `image_${base + index}`;
      output.name = name;
      output.type = "IMAGE";
      output.label = name;
      output.localized_name = name;
    }
  } finally {
    node.__tmpEnsuring = false;
  }
  if (!graphLoading()) fitCompact(node);
}

function maybeAutoFirst(node) {
  if (!node || node.__tmpSyncing || graphLoading()) return;
  const target = knownTargets(node)[0];
  if (!target) return;
  const output = node.outputs?.[IMAGE_SLOT];
  if (!output || output.type !== "IMAGE" || output.links?.length) return;
  const inputIndex = ensureTargetInput(target, 0);
  if (inputIndex < 0) return;
  const input = target.inputs[inputIndex];
  if (input?.link != null) return;
  node.__tmpSyncing = true;
  try {
    node.connect(IMAGE_SLOT, target, inputIndex);
  } catch (_) {
    return;
  } finally {
    node.__tmpSyncing = false;
  }
  ensureOutputs(node);
  writeLinked(node);
}

function normalizeToTokens(text) {
  return String(text || "")
    .replace(/[＜〈]/g, "<")
    .replace(/[＞〉]/g, ">")
    .replace(/<Picture\s*(\d+)\s*>/gi, (_, number) => `{{img:${Number(number)}}}`)
    .replace(/<image\s*(\d+)\s*>/gi, (_, number) => `{{img:${Number(number)}}}`)
    .replace(/@图片\s*(\d+)/g, (_, number) => `{{img:${Number(number)}}}`);
}

function exportTags(text, node) {
  const fmt = resolvedFormat(node);
  return String(text || "").replace(/\{\{img:(\d+)\}\}/g, (_, number) => tagFor(fmt, Number(number)));
}

function rangeTokens(range) {
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  return serializeEditor(holder);
}

function editorSelectionRange(editor) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  return range;
}

function caretTokenOffset(editor) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !editor.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return rangeTokens(range).length;
}

function placeCaretAt(editor, tokenOffset) {
  let left = Math.max(0, tokenOffset);
  const place = (node, offset) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.nodeValue?.length || 0;
      if (left <= len) {
        place(node, left);
        return true;
      }
      left -= len;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.index) {
      const token = `{{img:${node.dataset.index}}}`;
      if (left <= token.length) {
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      left -= token.length;
      return false;
    }
    for (const child of [...node.childNodes]) {
      if (walk(child)) return true;
    }
    return false;
  };
  if (!walk(editor)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function serializeEditor(root) {
  let out = "";
  const walk = (el) => {
    if (el.nodeType === Node.TEXT_NODE) {
      out += el.nodeValue || "";
      return;
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    if (el.dataset?.index) {
      out += `{{img:${el.dataset.index}}}`;
      return;
    }
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = el.tagName === "DIV" || el.tagName === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return normalizeToTokens(out.replace(/\u00a0/g, " ")).replace(/\n+$/g, "");
}

function makeChip(node, number) {
  const images = readImages(node);
  const item = images[number - 1];
  const chip = document.createElement("span");
  chip.className = "tmp-ip-chip";
  chip.contentEditable = "false";
  chip.dataset.index = String(number);
  if (!item) chip.classList.add("missing");
  if (item) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = viewUrl(item);
    chip.appendChild(img);
  }
  const label = document.createElement("span");
  label.className = "tmp-ip-chip-label";
  label.textContent = tagFor(resolvedFormat(node), number);
  chip.appendChild(label);
  chip.title = item ? `${item.name || item.filename} → ${label.textContent}` : `第 ${number} 张还没上传`;
  return chip;
}

function renderEditor(node) {
  const editor = node.__tmpEditor;
  if (!editor) return;
  node.__tmpRendering = true;
  try {
    const text = normalizeToTokens(readPrompt(node));
    editor.replaceChildren();
    const pattern = /\{\{img:(\d+)\}\}/g;
    let last = 0;
    let match = pattern.exec(text);
    while (match) {
      if (match.index > last) editor.appendChild(document.createTextNode(text.slice(last, match.index)));
      editor.appendChild(makeChip(node, Number(match[1])));
      last = match.index + match[0].length;
      match = pattern.exec(text);
    }
    if (last < text.length) editor.appendChild(document.createTextNode(text.slice(last)));
    editor.classList.toggle("is-empty", !text);
  } finally {
    node.__tmpRendering = false;
  }
}

function writePromptFromEditor(node) {
  const editor = node.__tmpEditor;
  if (!editor || !node.__tmpPromptReady || node.__tmpRendering || graphLoading()) return;
  const text = serializeEditor(editor);
  rememberPrompt(node, text);
  editor.classList.toggle("is-empty", !text);
}

function stampPrompt(node, info) {
  const ready = !!node.__tmpPromptReady && !!node.__tmpEditor && !node.__tmpRendering;
  const text = ready ? serializeEditor(node.__tmpEditor) : readPrompt(node);
  if (ready || text) rememberPrompt(node, text);
  if (!info) return;
  if (text || ready) {
    if (!info.properties) info.properties = {};
    info.properties.tmp_prompt = text;
    if (info.widgets_values_named) info.widgets_values_named.prompt_raw = text;
    if (Array.isArray(info.widgets_values)) {
      let index = 0;
      for (const item of node.widgets || []) {
        if (item?.serialize === false) continue;
        if (item?.name === "prompt_raw") {
          info.widgets_values[index] = text;
          break;
        }
        index += 1;
      }
    }
  }
}

function paintOutputSize(node, width, height) {
  const follow = !!widget(node, "跟随参考图")?.value;
  const widthOut = node.outputs?.[WIDTH_SLOT];
  const heightOut = node.outputs?.[HEIGHT_SLOT];
  const widthLabel = follow && width ? `宽度 ${width}` : "宽度";
  const heightLabel = follow && height ? `高度 ${height}` : "高度";
  if (widthOut?.type === "INT") {
    widthOut.label = widthLabel;
    widthOut.localized_name = widthLabel;
  }
  if (heightOut?.type === "INT") {
    heightOut.label = heightLabel;
    heightOut.localized_name = heightLabel;
  }
}

function syncFollow(node) {
  const images = readImages(node);
  const follow = !!widget(node, "跟随参考图")?.value;
  let stored = Math.max(1, Math.round(Number(widget(node, "参考图")?.value) || 1));
  if (stored > SLOT_CEILING) stored = SLOT_CEILING;
  const box = node.__tmpFollowBox;
  const check = node.__tmpFollow;
  const select = node.__tmpRef;
  const pixels = node.__tmpPixels;
  const grid = node.__tmpSizeGrid;
  if (check) check.checked = follow;
  if (box) box.classList.toggle("is-off", !follow);
  if (grid) {
    grid.classList.toggle("is-locked", follow);
    grid.title = follow ? "跟随参考图时，宽高用参考图的像素尺寸" : "";
  }
  if (select) {
    const values = [];
    for (let index = 1; index <= Math.max(1, images.length); index += 1) values.push(index);
    if (stored > values.length && stored <= SLOT_CEILING) values.push(stored);
    const signature = values.join(",");
    if (select.dataset.signature !== signature) {
      select.replaceChildren();
      for (const value of values) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = `图${value}`;
        select.appendChild(option);
      }
      select.dataset.signature = signature;
    }
    if (document.activeElement !== select) select.value = String(stored);
    select.title = "用这一张参考图的宽高";
  }
  let size = null;
  if (!pixels) {
    paintOutputSize(node, 0, 0);
    return;
  }
  if (!follow) {
    pixels.textContent = "";
    paintOutputSize(node, 0, 0);
    return;
  }
  if (!images.length) {
    pixels.textContent = "还没有参考图";
    paintOutputSize(node, 0, 0);
    return;
  }
  if (stored > images.length) {
    pixels.textContent = `图${stored} 还没上传`;
    paintOutputSize(node, 0, 0);
    return;
  }
  const item = images[stored - 1];
  size = knownSize(item);
  if (size === undefined) {
    pixels.textContent = "读取尺寸…";
    paintOutputSize(node, 0, 0);
    probeSize(item).then(() => {
      if (widget(node, "跟随参考图")?.value) refreshChrome(node);
    });
    return;
  }
  if (!size) {
    pixels.textContent = "读不到尺寸";
    paintOutputSize(node, 0, 0);
    return;
  }
  pixels.textContent = `${size[0]}×${size[1]}`;
  paintOutputSize(node, size[0], size[1]);
  node.setDirtyCanvas?.(true, true);
}

function refreshChrome(node) {
  const stats = connectionStats(node);
  const images = readImages(node);
  const fmt = resolvedFormat(node);
  setSilent(node, "送出格式", fmt);
  writeLinked(node);
  if (node.__tmpSend) node.__tmpSend.textContent = `送出 ${tagFor(fmt, 1)}`;
  if (node.__tmpFormat) {
    const choice = widget(node, "引用格式")?.value || "自动";
    node.__tmpFormat.textContent = formatLabel(FORMATS.includes(choice) ? choice : "自动");
  }
  const room = Math.max(0, stats.prefix - images.length);
  const held = images.length > 0 && !promptHasRef(node);
  if (node.__tmpPlus) {
    node.__tmpPlus.disabled = room <= 0;
    node.__tmpPlus.title = room > 0
      ? `还能上传 ${room} 张`
      : (stats.prefix === 0 ? "先把右侧第一个图片接点接出去" : "再接下一路线，才能继续上传");
  }
  if (node.__tmpStatus) {
    if (held) {
      node.__tmpStatus.textContent = `已上传 ${images.length} 张，提示词里没有引用，这次不送图。`;
    } else if (stats.prefix === 0) {
      node.__tmpStatus.textContent = "先接右侧第一个图片接点。接几路，就能传几张。";
    } else if (room > 0) {
      node.__tmpStatus.textContent = `已上传 ${images.length} 张，空接点不送图。还能再传 ${room} 张。`;
    } else if (stats.prefix >= SLOT_CEILING) {
      node.__tmpStatus.textContent = `已接 ${stats.prefix} 路，接点已经加满。`;
    } else {
      node.__tmpStatus.textContent = `已接 ${stats.prefix} 路，已上传 ${images.length} 张。再接下一路线，就可以继续上传。`;
    }
  }
  if (node.__tmpAspect && document.activeElement !== node.__tmpAspect) node.__tmpAspect.value = widget(node, "宽高比")?.value || "16:9";
  if (node.__tmpMp && document.activeElement !== node.__tmpMp) node.__tmpMp.value = String(widget(node, "百万像素")?.value ?? 8);
  if (node.__tmpMultiple && document.activeElement !== node.__tmpMultiple) node.__tmpMultiple.value = String(widget(node, "对齐倍数")?.value ?? 32);
  syncFollow(node);
  const editor = node.__tmpEditor;
  if (editor) {
    editor.querySelectorAll(".tmp-ip-chip").forEach((chip) => {
      const number = Number(chip.dataset.index);
      const item = images[number - 1];
      chip.classList.toggle("missing", !item);
      const label = chip.querySelector(".tmp-ip-chip-label");
      if (label) label.textContent = tagFor(fmt, number);
      let img = chip.querySelector("img");
      if (item) {
        const url = viewUrl(item);
        if (!img) {
          img = document.createElement("img");
          img.alt = "";
          chip.insertBefore(img, chip.firstChild);
        }
        if (img.src !== url) img.src = url;
      } else if (img) {
        img.remove();
      }
    });
  }
}

function renderGrid(node) {
  const grid = node.__tmpGrid;
  if (!grid) return;
  const images = readImages(node);
  grid.replaceChildren();
  images.forEach((item, index) => {
    const shot = document.createElement("div");
    shot.className = "tmp-ip-shot";
    shot.draggable = true;
    shot.title = "双击放大";
    shot.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPreview(item, `图${index + 1}`);
    });
    const img = document.createElement("img");
    img.alt = "";
    img.src = viewUrl(item);
    img.addEventListener("load", () => {
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
      rememberSize(item, [img.naturalWidth, img.naturalHeight]);
      if (widget(node, "跟随参考图")?.value) refreshChrome(node);
    });
    const badge = document.createElement("span");
    badge.className = "tmp-ip-badge";
    badge.textContent = `图${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tmp-ip-x";
    remove.textContent = "×";
    remove.title = "移除";
    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      const current = readImages(node);
      const removed = current[index];
      current.splice(index, 1);
      writeImages(node, current);
      deleteUpload(removed);
      renderGrid(node);
      refreshChrome(node);
      ensureOutputs(node);
      markDirty(node);
    });
    shot.addEventListener("dragstart", (event) => {
      node.__tmpDrag = index;
      shot.classList.add("dragging");
      event.stopPropagation();
    });
    shot.addEventListener("dragend", () => {
      node.__tmpDrag = null;
      shot.classList.remove("dragging");
    });
    shot.addEventListener("dragover", (event) => {
      if (node.__tmpDrag == null) return;
      event.preventDefault();
      event.stopPropagation();
    });
    shot.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const from = node.__tmpDrag;
      node.__tmpDrag = null;
      if (from == null || from === index) return;
      const next = readImages(node);
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      writeImages(node, next);
      renderGrid(node);
      refreshChrome(node);
      markDirty(node);
    });
    shot.append(img, badge, remove);
    grid.appendChild(shot);
  });
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "tmp-ip-plus";
  plus.textContent = "+";
  node.__tmpPlus = plus;
  plus.addEventListener("pointerdown", (event) => event.stopPropagation());
  plus.addEventListener("click", (event) => {
    event.stopPropagation();
    const room = connectionStats(node).prefix - readImages(node).length;
    if (room <= 0) {
      refreshChrome(node);
      return;
    }
    pickImages(node, room);
  });
  grid.appendChild(plus);
  refreshChrome(node);
}

function pickImages(node, room) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);
  input.onchange = async () => {
    const files = Array.from(input.files || []).slice(0, room);
    input.remove();
    await addFiles(node, files);
  };
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

function uploadName(file) {
  const match = String(file?.name || "").match(/(\.[A-Za-z0-9]{1,8})$/);
  const ext = /^\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(match?.[1] || "") ? match[1].toLowerCase() : ".png";
  const rand = Math.random().toString(36).slice(2, 8);
  return `feimao_${Date.now().toString(36)}_${rand}${ext}`;
}

function deleteUpload(item) {
  const filename = String(item?.filename || "");
  const subfolder = String(item?.subfolder || "");
  if (!filename.startsWith("feimao_") || subfolder !== "feimao_prompt") return;
  void api.fetchApi("/feimao/prompt_image/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder }),
  }).catch(() => {});
}

async function uploadFile(file) {
  const filename = uploadName(file);
  const body = new FormData();
  body.append("image", file, filename);
  body.append("overwrite", "true");
  body.append("type", "input");
  body.append("subfolder", "feimao_prompt");
  const resp = await api.fetchApi("/upload/image", { method: "POST", body });
  if (!resp.ok) throw new Error((await resp.text()) || `上传失败 ${resp.status}`);
  const data = await resp.json();
  if (!data?.name) throw new Error("上传没有返回文件名");
  const stored = String(data.name);
  return {
    filename: stored,
    subfolder: data.subfolder || "feimao_prompt",
    type: data.type || "input",
    name: file.name.replace(/\.[^.]+$/, ""),
    token: stored,
  };
}

async function addFiles(node, files) {
  const room = connectionStats(node).prefix - readImages(node).length;
  const list = Array.from(files || []).filter((file) => String(file.type || "").startsWith("image/")).slice(0, Math.max(0, room));
  if (!list.length) {
    refreshChrome(node);
    return;
  }
  const next = readImages(node);
  for (const file of list) {
    try {
      next.push(await uploadFile(file));
    } catch (err) {
      if (node.__tmpStatus) node.__tmpStatus.textContent = `上传失败：${err?.message || err}`;
      break;
    }
  }
  writeImages(node, next);
  ensureOutputs(node);
  renderGrid(node);
  refreshChrome(node);
  markDirty(node);
}

const menu = document.createElement("div");
menu.className = "tmp-ip-menu hidden";
document.body.appendChild(menu);
let menuNode = null;
let menuInfo = null;
let menuActive = 0;

function hideMenu() {
  menu.classList.add("hidden");
  menuNode = null;
  menuInfo = null;
}

function textBeforeCaret(editor) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !editor.contains(sel.anchorNode) || sel.anchorNode.nodeType !== Node.TEXT_NODE) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  const text = sel.anchorNode.data.slice(0, sel.anchorOffset);
  const at = text.lastIndexOf("@");
  if (at < 0) return null;
  const query = text.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { node: sel.anchorNode, at, offset: sel.anchorOffset, query };
}

function placeMenu(x, y) {
  menu.classList.remove("hidden");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = y + rect.height + 12 > window.innerHeight ? Math.max(8, y - rect.height - 8) : y + 8;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
}

function showMenu(node, info) {
  const images = readImages(node);
  const fmt = resolvedFormat(node);
  const query = String(info.query || "").toLowerCase();
  const items = images
    .map((item, index) => ({ item, number: index + 1 }))
    .filter(({ item, number }) => {
      if (!query) return true;
      const hay = `${item.name || ""} ${item.filename || ""} 图${number} image_${number - 1} ${tagFor(fmt, number)}`.toLowerCase();
      return hay.includes(query);
    });
  menu.replaceChildren();
  menuNode = node;
  menuInfo = info;
  menuActive = 0;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "tmp-ip-empty";
    empty.textContent = images.length ? "没有匹配的图" : "还没有图。先接右侧接点，再点加号上传。";
    menu.appendChild(empty);
  }
  items.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tmp-ip-item";
    const img = document.createElement("img");
    img.alt = "";
    img.src = viewUrl(entry.item);
    const text = document.createElement("span");
    const strong = document.createElement("b");
    strong.textContent = tagFor(fmt, entry.number);
    text.append(strong, document.createTextNode(`  ${entry.item.name || entry.item.filename}`));
    button.append(img, text);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => insertMention(node, info, entry.number));
    if (index === 0) button.classList.add("active");
    menu.appendChild(button);
  });
  menu.__items = items;
  const rect = info.node.parentElement?.getBoundingClientRect?.() || node.__tmpEditor.getBoundingClientRect();
  const sel = window.getSelection();
  const caret = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : rect;
  placeMenu(caret.left || rect.left, caret.bottom || rect.bottom);
}

function insertMention(node, info, number) {
  const textNode = info.node;
  if (!textNode?.parentNode) return;
  const before = textNode.data.slice(0, info.at);
  const after = textNode.data.slice(info.offset);
  textNode.data = before;
  const chip = makeChip(node, number);
  const rest = document.createTextNode(after);
  textNode.parentNode.insertBefore(chip, textNode.nextSibling);
  textNode.parentNode.insertBefore(rest, chip.nextSibling);
  const range = document.createRange();
  range.setStart(rest, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  writePromptFromEditor(node);
  hideMenu();
  markDirty(node);
}

function moveMenu(delta) {
  const buttons = [...menu.querySelectorAll(".tmp-ip-item")];
  if (!buttons.length) return;
  menuActive = (menuActive + delta + buttons.length) % buttons.length;
  buttons.forEach((button, index) => button.classList.toggle("active", index === menuActive));
  buttons[menuActive].scrollIntoView({ block: "nearest" });
}

function chooseMenu() {
  const items = menu.__items || [];
  const entry = items[menuActive];
  if (!menuNode || !menuInfo || !entry) return;
  insertMention(menuNode, menuInfo, entry.number);
}

function placeCaretAtStart(editor) {
  const range = document.createRange();
  range.setStart(editor, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function bindEditor(node, editor) {
  const stop = (event) => event.stopPropagation();
  editor.addEventListener("pointerdown", stop);
  editor.addEventListener("focus", () => {
    if (!editor.classList.contains("is-empty")) return;
    requestAnimationFrame(() => {
      if (document.activeElement === editor && editor.classList.contains("is-empty")) placeCaretAtStart(editor);
    });
  });
  editor.addEventListener("mousedown", stop);
  editor.addEventListener("wheel", stop);
  editor.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("hidden") || menuNode !== node) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveMenu(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveMenu(-1);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      chooseMenu();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideMenu();
    }
  });
  editor.addEventListener("input", () => {
    writePromptFromEditor(node);
    const info = textBeforeCaret(editor);
    if (info) showMenu(node, info);
    else if (menuNode === node) hideMenu();
    markDirty(node);
  });
  editor.addEventListener("copy", (event) => {
    const range = editorSelectionRange(editor);
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData("text/plain", exportTags(rangeTokens(range), node));
  });
  editor.addEventListener("cut", (event) => {
    const range = editorSelectionRange(editor);
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData("text/plain", exportTags(rangeTokens(range), node));
    range.deleteContents();
    writePromptFromEditor(node);
    const offset = caretTokenOffset(editor);
    if (/\{\{img:\d+\}\}/.test(widget(node, "prompt_raw")?.value || "")) {
      renderEditor(node);
      if (offset != null) placeCaretAt(editor, offset);
    }
    markDirty(node);
  });
  editor.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (text == null) return;
    event.preventDefault();
    event.stopPropagation();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    range.deleteContents();
    const nodeText = document.createTextNode(text);
    range.insertNode(nodeText);
    range.setStartAfter(nodeText);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    writePromptFromEditor(node);
    const offset = caretTokenOffset(editor);
    if (/\{\{img:\d+\}\}/.test(widget(node, "prompt_raw")?.value || "")) {
      renderEditor(node);
      if (offset != null) placeCaretAt(editor, offset);
    }
    markDirty(node);
  });
  editor.addEventListener("blur", () => {
    setTimeout(() => {
      if (menu.contains(document.activeElement)) return;
      hideMenu();
      writePromptFromEditor(node);
      renderEditor(node);
    }, 120);
  });
}

function buildUI(node) {
  if (node.__tmpBuilt) return;
  node.__tmpBuilt = true;
  ensureStyle();
  hideWidgets(node);
  const root = document.createElement("div");
  root.className = "tmp-ip";
  const bar = document.createElement("div");
  bar.className = "tmp-ip-bar";
  const format = document.createElement("button");
  format.type = "button";
  format.className = "tmp-ip-picker";
  const formatMenu = document.createElement("div");
  formatMenu.className = "tmp-ip-menu hidden";
  for (const name of FORMATS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tmp-ip-item tmp-ip-fmt";
    item.textContent = formatLabel(name);
    item.addEventListener("pointerdown", (event) => event.stopPropagation());
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      setSilent(node, "引用格式", name);
      formatMenu.classList.add("hidden");
      refreshChrome(node);
      renderEditor(node);
      markDirty(node);
    });
    formatMenu.appendChild(item);
  }
  document.body.appendChild(formatMenu);
  format.addEventListener("pointerdown", (event) => event.stopPropagation());
  format.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = formatMenu.classList.contains("hidden");
    formatMenu.classList.toggle("hidden");
    if (!opening) return;
    const rect = format.getBoundingClientRect();
    formatMenu.style.left = `${rect.left}px`;
    formatMenu.style.top = `${rect.bottom + 4}px`;
    formatMenu.style.minWidth = "148px";
  });
  document.addEventListener("pointerdown", (event) => {
    if (formatMenu.contains(event.target) || format.contains(event.target)) return;
    formatMenu.classList.add("hidden");
  });
  const send = document.createElement("div");
  send.className = "tmp-ip-send";
  bar.append(format, send);
  const editor = document.createElement("div");
  editor.className = "tmp-ip-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.dataset.placeholder = "写提示词，输入 @ 引用下面的图";
  const grid = document.createElement("div");
  grid.className = "tmp-ip-grid";
  const status = document.createElement("div");
  status.className = "tmp-ip-status";
  const size = document.createElement("div");
  size.className = "tmp-ip-size";
  const followBox = document.createElement("div");
  followBox.className = "tmp-ip-follow";
  const followLabel = document.createElement("label");
  followLabel.className = "tmp-ip-follow-check";
  const follow = document.createElement("input");
  follow.type = "checkbox";
  follow.title = "打开后，宽度和高度使用所选参考图的像素尺寸";
  const followText = document.createElement("span");
  followText.textContent = "跟随参考图";
  followLabel.append(follow, followText);
  const refSelect = document.createElement("select");
  refSelect.title = "用这一张参考图的宽高";
  const pixels = document.createElement("div");
  pixels.className = "tmp-ip-pixels";
  followBox.append(followLabel, refSelect, pixels);
  const sizeGrid = document.createElement("div");
  sizeGrid.className = "tmp-ip-size-grid";
  const stop = (event) => event.stopPropagation();
  const field = (title, control) => {
    const wrap = document.createElement("label");
    wrap.className = "tmp-ip-field";
    wrap.append(title, control);
    control.addEventListener("pointerdown", stop);
    return wrap;
  };
  const aspect = document.createElement("select");
  for (const [name] of ASPECTS) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    aspect.appendChild(option);
  }
  aspect.value = "16:9";
  const mp = document.createElement("input");
  mp.type = "number";
  mp.min = "0.1";
  mp.max = "16";
  mp.step = "0.1";
  mp.value = "8";
  const multiple = document.createElement("select");
  for (const value of MULTIPLES) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} 倍`;
    multiple.appendChild(option);
  }
  multiple.value = "32";
  const commitSize = () => {
    setSilent(node, "宽高比", aspect.value);
    const pixels = Math.min(16, Math.max(0.1, Number(mp.value) || 1));
    if (document.activeElement !== mp) mp.value = String(pixels);
    setSilent(node, "百万像素", pixels);
    setSilent(node, "对齐倍数", Number(multiple.value) || 16);
    refreshChrome(node);
    markDirty(node);
  };
  aspect.addEventListener("change", commitSize);
  multiple.addEventListener("change", commitSize);
  mp.addEventListener("change", commitSize);
  sizeGrid.append(field("宽高比", aspect), field("百万像素", mp), field("对齐倍数", multiple));
  follow.addEventListener("change", () => {
    setSilent(node, "跟随参考图", follow.checked);
    refreshChrome(node);
    markDirty(node);
  });
  refSelect.addEventListener("change", () => {
    setSilent(node, "参考图", Math.max(1, Math.round(Number(refSelect.value) || 1)));
    refreshChrome(node);
    markDirty(node);
  });
  for (const control of [followLabel, follow, refSelect]) {
    control.addEventListener("pointerdown", stop);
  }
  size.append(followBox, sizeGrid);
  const grip = document.createElement("div");
  grip.className = "tmp-ip-grip";
  grip.title = "按住上下拖，调整提示词高度";
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startH = node.size?.[1] || NODE_HEIGHT;
    const scale = app.canvas?.ds?.scale || 1;
    const move = (ev) => {
      applyNodeHeight(node, startH + (ev.clientY - startY) / scale);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      markDirty(node);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  root.append(bar, editor, grid, status, size, grip);
  node.__tmpFormat = format;
  node.__tmpSend = send;
  node.__tmpEditor = editor;
  node.__tmpGrid = grid;
  node.__tmpStatus = status;
  node.__tmpAspect = aspect;
  node.__tmpMp = mp;
  node.__tmpMultiple = multiple;
  node.__tmpFollowBox = followBox;
  node.__tmpFollow = follow;
  node.__tmpRef = refSelect;
  node.__tmpPixels = pixels;
  node.__tmpSizeGrid = sizeGrid;
  bindEditor(node, editor);
  root.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer?.types || []].includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
  });
  root.addEventListener("drop", (event) => {
    const files = [...event.dataTransfer?.files || []];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const room = connectionStats(node).prefix - readImages(node).length;
    void addFiles(node, files.slice(0, Math.max(0, room)));
  });
  root.addEventListener("paste", (event) => {
    if (editor.contains(event.target)) return;
    const files = [...event.clipboardData?.files || []];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const room = connectionStats(node).prefix - readImages(node).length;
    void addFiles(node, files.slice(0, Math.max(0, room)));
  });
  const dom = node.addDOMWidget("tmp_ip_ui", "tmp_ip", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => widgetBox(node),
    getMaxHeight: () => widgetBox(node),
  });
  if (dom) {
    dom.computeLayoutSize = () => {
      const box = widgetBox(node);
      return { minHeight: box, maxHeight: box, minWidth: 0 };
    };
  }
  root.style.width = "100%";
  root.style.height = "auto";
  root.style.maxHeight = "none";
  captureImages(node);
  renderEditor(node);
  renderGrid(node);
  refreshChrome(node);
}

function restore(node, tries = 0) {
  if (graphLoading() && tries < 40) {
    setTimeout(() => restore(node, tries + 1), 50);
    return;
  }
  node.__tmpPromptExtra = 0;
  if (node.__tmpEditor) node.__tmpEditor.style.height = "84px";
  captureImages(node);
  hideWidgets(node);
  ensureOutputs(node);
  renderGrid(node);
  maybeAutoFirst(node);
  trimKnownTargets(node);
  hydratePrompt(node);
  fitCompact(node);
  setTimeout(() => hideWidgets(node), 50);
  setTimeout(() => hideWidgets(node), 300);
}

function hydratePrompt(node, tries = 0) {
  const typed = node.__tmpEditor ? serializeEditor(node.__tmpEditor) : "";
  if (typed && tries > 0) {
    node.__tmpPromptReady = true;
    writePromptFromEditor(node);
    refreshChrome(node);
    return;
  }
  renderEditor(node);
  refreshChrome(node);
  if (readPrompt(node) || tries >= 20) {
    node.__tmpPromptReady = true;
    return;
  }
  setTimeout(() => hydratePrompt(node, tries + 1), 50);
}

function fitCompact(node) {
  const w = node.size?.[0] || NODE_WIDTH;
  const h = node.size?.[1] || NODE_HEIGHT;
  const nextW = w < 320 ? NODE_WIDTH : w;
  const nextH = intendedHeight(node);
  if (Math.abs(nextW - w) < 2 && Math.abs(nextH - h) < 2) return;
  node.__tmpFitting = true;
  try {
    node.setSize?.([nextW, nextH]);
  } finally {
    node.__tmpFitting = false;
  }
}

app.registerExtension({
  name: "TE.ManPro.ImagePrompt",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (H3_TYPES.has(nodeData?.name)) {
      const onConnections = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function () {
        const result = onConnections?.apply(this, arguments);
        const node = this;
        if (!node.__tmpTrimming) requestAnimationFrame(() => trimSpareInputs(node));
        return result;
      };
      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const result = onConfigure?.apply(this, arguments);
        const node = this;
        const run = (tries = 0) => {
          if (graphLoading() && tries < 40) {
            setTimeout(() => run(tries + 1), 50);
            return;
          }
          trimSpareInputs(node);
        };
        setTimeout(() => run(), 0);
        return result;
      };
      return;
    }
    if (nodeData?.name !== NODE_CLASS) return;
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onCreated?.apply(this, arguments);
      try {
        buildUI(this);
        if (!graphLoading()) {
          this.__tmpPromptReady = true;
          ensureOutputs(this);
          refreshChrome(this);
          this.setSize?.([NODE_WIDTH, NODE_HEIGHT]);
        }
      } catch (err) {
        console.error("[feimao tools 图片提示词]", err);
      }
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      setTimeout(() => restore(this), 0);
      return result;
    };
    const onConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = onConnections?.apply(this, arguments);
      if (this.__tmpEnsuring || this.__tmpSyncing || graphLoading()) return result;
      ensureOutputs(this);
      writeLinked(this);
      maybeAutoFirst(this);
      trimKnownTargets(this);
      refreshChrome(this);
      return result;
    };
    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const result = onResize?.apply(this, arguments);
      if (this.__tmpFitting || graphLoading()) return result;
      const h = size?.[1] ?? this.size?.[1];
      if (h && Math.abs(h - intendedHeight(this)) > 4) fitCompact(this);
      return result;
    };
    const onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (info) {
      try {
        writeLinked(this);
        setSilent(this, "送出格式", resolvedFormat(this));
        stampPrompt(this, info);
      } catch (_) {}
      return onSerialize?.apply(this, arguments);
    };
  },
});

document.addEventListener("pointerdown", (event) => {
  if (!menu.contains(event.target)) hideMenu();
});
