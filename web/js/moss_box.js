import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { hideComfyWidget } from "./hide_widget.js";

const NODE_CLASS = "feimao_tools_Moss_Box";
const MIN_BOX = 12;
const HANDLE = 9;
const STYLE_ID = "tmp-moss-style";
function ratioText(width, height, aspect) {
  const name = String(aspect || "").split(" (")[0].trim();
  if (name) return name;
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h)) || 1;
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
}

function aiLead(width, height, aspect, megapixels) {
  const ratio = ratioText(width, height, aspect);
  const mp = Number(megapixels);
  const mpText = Number.isFinite(mp) ? `${mp} 百万像素` : "";
  return [
    `这是一张 ${ratio} 的设计海报（画布 ${width}×${height}${mpText ? `，约 ${mpText}` : ""}）。`,
    "请帮我扩写和优化这份 MOSS 自定义画框提示词的排版与内容，让画面更完整、层级更清楚、文案更有设计感。",
    "扩写要求：",
    "1. 按这张海报的比例来排，注意上下留白、主视觉重心和文字可读性，不要挤在一边。",
    "2. summary.caption 写成更完整的整图描述，交代主题、氛围、光影、主体和背景。",
    "3. 文字框补充更具体的字体、字号层级、颜色、描边、对齐方式；画面框补充构图、人物/物体动作、材质和光影细节。",
    "4. 可调整框的位置和大小，必要时增减框，但整体仍像一张可落地的海报版面。",
    "5. 调色板第一个颜色是框的标签色，文字框可再给填充色/描边色。",
    "输出要求：",
    "只返回优化后的完整 JSON，不要解释，我要原样粘贴回去生成。",
    "保持 summary、items、bbox_coord_space 为 abs_centralized、bbox_format 为 yxyx。",
    "bbox 仍是以画面中心为原点的 [上, 左, 下, 右] 像素坐标。",
    "",
    "",
  ].join("\n");
}

function aiDesignLead(width, height, aspect, megapixels, caption) {
  const ratio = ratioText(width, height, aspect);
  const mp = Number(megapixels);
  const mpText = Number.isFinite(mp) ? `${mp} 百万像素` : "";
  const desc = String(caption || "").trim() || "（整图描述还没写，请按海报主题自行补全）";
  return [
    `这是一张 ${ratio} 的设计海报（画布 ${width}×${height}${mpText ? `，约 ${mpText}` : ""}）。`,
    "请基于我设定的宽高比和整图描述，帮我扩写并设计一套 MOSS 自定义画框布局。",
    "整图描述：",
    desc,
    "",
    "设计要求：",
    "1. 严格按这张海报的比例排版，安排标题、副标题、主视觉、说明文字等层级，留白合理，不要挤在一边。",
    "2. summary.caption 在原有整图描述上扩写得更完整，写清主题、氛围、光影、主体和背景。",
    "3. items 里同时设计文字框和画面框：文字框写具体文案，并说明字体、字号层级、颜色、描边、对齐；画面框写构图、人物/物体、材质和光影。",
    "4. 每个框都要有合理的 bbox，覆盖完整版面；调色板第一个颜色是框的标签色，文字框可再给填充色/描边色。",
    "5. 直接给我可回填生成的完整 JSON，不要解释。",
    "",
    "必须返回下面这种格式（字段名保持一致）：",
    "{",
    '  "summary": { "caption": "扩写后的整图描述" },',
    '  "items": [',
    '    {',
    '      "label": "text",',
    '      "caption": "字体、颜色、描边、对齐等排版说明",',
    '      "text": "要印在图上的文字",',
    '      "palette": ["#主色", "#描边色"],',
    '      "bbox": [上, 左, 下, 右]',
    "    },",
    "    {",
    '      "label": "object",',
    '      "caption": "这块画面的详细描述",',
    '      "palette": ["#标签色"],',
    '      "bbox": [上, 左, 下, 右]',
    "    }",
    "  ],",
    '  "bbox_coord_space": "abs_centralized",',
    '  "bbox_format": "yxyx"',
    "}",
    "",
    `说明：bbox 是以画面中心为原点的像素坐标 [上, 左, 下, 右]，画布宽 ${width}、高 ${height}。只返回 JSON。`,
    "",
    "",
  ].join("\n");
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tmp-moss { height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; gap:6px; padding:6px;
      background:#1c1c20; color:#d8d8de; border-radius:8px; overflow:hidden; font:12px system-ui,sans-serif; }
    .tmp-moss-bar, .tmp-moss-size { display:flex; flex-wrap:wrap; gap:6px; align-items:center; flex:0 0 auto; }
    .tmp-moss-size select { height:28px; max-width:168px; margin:0; }
    .tmp-moss-size input[type="number"] { width:72px; }
    .tmp-moss button { min-height:28px; padding:0 10px; color:#f4f4f5; background:#3b3e43; border:1px solid #565a60; border-radius:4px; cursor:pointer; }
    .tmp-moss button:hover:not(:disabled) { background:#494d53; }
    .tmp-moss button:disabled { opacity:.55; cursor:default; }
    .tmp-moss button.primary { background:#347257; border-color:#438e6c; }
    .tmp-moss button.on { background:#5a5e66; color:#fff; }
    .tmp-moss-stage { position:relative; flex:1 1 auto; min-height:280px; background:#141416; border-radius:6px; overflow:hidden; }
    .tmp-moss-stage canvas { position:absolute; inset:0; width:100%; height:100%; display:block; outline:none; cursor:crosshair; touch-action:none; }
    .tmp-moss-form { display:flex; flex-direction:column; gap:6px; flex:0 0 auto; }
    .tmp-moss-types { display:flex; height:26px; border:1px solid #3a3a42; border-radius:6px; overflow:hidden; }
    .tmp-moss-types button { flex:1; height:100%; border:0; border-radius:0; background:#26262c; color:#8b8b96; }
    .tmp-moss-field { display:flex; flex-direction:column; gap:2px; color:#8b8b96; }
    .tmp-moss-field input, .tmp-moss-field textarea, .tmp-moss-paste, .tmp-moss select {
      box-sizing:border-box; border:1px solid #3a3a42; border-radius:6px; background:#26262c; color:#d8d8de; padding:4px 6px; font:12px system-ui,sans-serif; outline:none; }
    .tmp-moss-field textarea { height:52px; resize:vertical; }
    .tmp-moss-colors { display:flex; align-items:center; gap:6px; color:#8b8b96; flex-wrap:wrap; }
    .tmp-moss-colors div { display:flex; gap:4px; align-items:center; }
    .tmp-moss-colors input[type="color"] {
      width:28px; height:28px; padding:0; border:1px solid #565a60; border-radius:4px;
      background:#26262c; cursor:pointer;
    }
    .tmp-moss-colors input[type="text"].tmp-moss-hex {
      width:78px; height:28px; box-sizing:border-box;
      border:1px solid #3a3a42; border-radius:6px; background:#26262c; color:#d8d8de; padding:0 6px;
    }
    .tmp-moss-swatch {
      width:22px; height:22px; border:1px solid #565a60; border-radius:4px; cursor:pointer; padding:0;
    }
    .tmp-moss-swatch.on { outline:2px solid #f2d06b; outline-offset:1px; }
    .tmp-moss-caption { height:52px; resize:vertical; }
    .tmp-moss-colors select { margin-left:auto; height:24px; max-width:150px; }
    .tmp-moss-paste-label { display:flex; justify-content:space-between; align-items:center; gap:8px; color:#8b8b96; }
    .tmp-moss-status { margin-left:auto; color:#f2d06b; font-weight:600; }
    .tmp-moss-status.ok { color:#78c896; }
    .tmp-moss-status.err { color:#e0966a; }
    .tmp-moss-mode { color:#8b8b96; font-weight:400; }
    .tmp-moss-paste { height:140px; resize:vertical; }
    .tmp-moss-paste.used { border-color:#438e6c; }
    .tmp-moss-notice { display:none; }
    .tmp-moss-menu {
      position:fixed; z-index:10000; min-width:148px; padding:4px;
      background:#26262c; border:1px solid #565a60; border-radius:6px;
      box-shadow:0 8px 24px rgba(0,0,0,.45); display:none;
    }
    .tmp-moss-menu button {
      display:block; width:100%; text-align:left; min-height:28px;
      margin:0; border:0; border-radius:4px; background:transparent; color:#d8d8de; cursor:pointer;
    }
    .tmp-moss-menu button:hover:not(:disabled) { background:#3b3e43; }
    .tmp-moss-menu button:disabled { opacity:.45; cursor:default; }
    .tmp-moss-menu hr { border:0; border-top:1px solid #3a3a42; margin:4px 0; }
  `;
  document.head.appendChild(style);
}

function widget(node, name) {
  return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function graphLink(graph, id) {
  if (!graph?.links || id == null) return null;
  return typeof graph.links.get === "function" ? graph.links.get(id) : graph.links[id];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round9(value) {
  const scaled = value * 1e9;
  const sign = scaled < 0 ? -1 : 1;
  const abs = Math.abs(scaled);
  const base = Math.floor(abs + 1e-8);
  const frac = abs - base;
  let rounded = base;
  if (frac > 0.5 + 1e-8) rounded = base + 1;
  else if (frac < 0.5 - 1e-8) rounded = base;
  else rounded = base % 2 === 0 ? base : base + 1;
  return (sign * rounded) / 1e9;
}

function numberFromNode(node) {
  if (!node) return null;
  for (const name of ["value", "width", "height"]) {
    const value = Number(widget(node, name)?.value);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function textFromNode(node) {
  if (!node) return null;
  for (const name of ["value", "整图描述", "text", "prompt"]) {
    const item = widget(node, name);
    if (item && typeof item.value === "string") return item.value;
  }
  return null;
}

function linkedNumber(node, inputName, fallback) {
  const input = (node.inputs || []).find((item) => item?.name === inputName);
  if (input?.link != null) {
    const link = graphLink(node.graph, input.link);
    const origin = link ? node.graph?.getNodeById?.(link.origin_id) : null;
    const value = numberFromNode(origin);
    if (value) return value;
  }
  const local = Number(widget(node, inputName)?.value);
  return Number.isFinite(local) && local > 0 ? local : fallback;
}

function linkedText(node, inputName) {
  const input = (node.inputs || []).find((item) => item?.name === inputName);
  if (input?.link != null) {
    const link = graphLink(node.graph, input.link);
    const origin = link ? node.graph?.getNodeById?.(link.origin_id) : null;
    const text = textFromNode(origin);
    if (text != null) return text;
  }
  return String(widget(node, inputName)?.value ?? "");
}

function parseBoxes(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || "[]"));
  } catch {
    return [];
  }
  if (parsed && !Array.isArray(parsed)) parsed = parsed.items || parsed.elements || parsed.boxes || [];
  if (!Array.isArray(parsed)) return [];
  const boxes = [];
  for (const box of parsed) {
    if (!box || !Array.isArray(box.bbox) || box.bbox.length !== 4) continue;
    const bbox = box.bbox.map((value) => clamp(Math.round(Number(value) || 0), 0, 1000));
    if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) continue;
    const next = {
      type: box.type === "text" ? "text" : "obj",
      text: String(box.text || ""),
      desc: String(box.desc || box.caption || ""),
      bbox,
    };
    if (box.role) next.role = String(box.role);
    if (Array.isArray(box.palette) && box.palette.length) next.palette = box.palette.map(String).slice(0, 5);
    boxes.push(next);
  }
  return boxes;
}

function serializeBoxes(boxes) {
  return JSON.stringify(boxes.map((box) => {
    const item = { type: box.type === "text" ? "text" : "obj" };
    if (box.role) item.role = box.role;
    if (item.type === "text") item.text = box.text || "";
    item.desc = box.desc || "";
    if (box.palette?.length) item.palette = box.palette.slice(0, 5);
    item.bbox = box.bbox;
    return item;
  }));
}

function pixelBBox(bbox, width, height) {
  const [y0, x0, y1, x1] = bbox;
  return [
    Math.floor(round9((y0 * height) / 1000)) - Math.floor(height / 2),
    Math.floor(round9((x0 * width) / 1000)) - Math.floor(width / 2),
    Math.ceil(round9((y1 * height) / 1000)) - Math.floor(height / 2),
    Math.ceil(round9((x1 * width) / 1000)) - Math.floor(width / 2),
  ];
}

function extractJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try { return JSON.parse(raw.slice(objectStart, objectEnd + 1)); } catch { /* 继续找数组 */ }
  }
  const listStart = raw.indexOf("[");
  const listEnd = raw.lastIndexOf("]");
  if (listStart >= 0 && listEnd > listStart) {
    try { return JSON.parse(raw.slice(listStart, listEnd + 1)); } catch { return null; }
  }
  return null;
}

function usesPixelBBox(data, items) {
  if (data && !Array.isArray(data) && data.bbox_coord_space === "abs_centralized") return true;
  return items.some((item) => {
    if (item?.label === "text" || item?.label === "object") return true;
    return Array.isArray(item?.bbox) && item.bbox.some((value) => value < 0 || value > 1000);
  });
}

function bboxFromPixels(bbox, width, height) {
  const [y0, x0, y1, x1] = bbox.map(Number);
  const axis = (pixel, size) => clamp(Math.round(((pixel + Math.floor(size / 2)) * 1000) / size), 0, 1000);
  const next = [axis(y0, height), axis(x0, width), axis(y1, height), axis(x1, width)];
  if (next[2] <= next[0]) next[2] = Math.min(1000, next[0] + MIN_BOX);
  if (next[3] <= next[1]) next[3] = Math.min(1000, next[1] + MIN_BOX);
  return next;
}

function layoutFromPrompt(text, width, height) {
  const data = extractJson(text);
  if (!data) return null;
  const items = Array.isArray(data) ? data : data.items || data.elements || data.boxes;
  if (!Array.isArray(items)) return null;
  const pixel = usesPixelBBox(data, items);
  const boxes = [];
  for (const item of items) {
    if (!item || !Array.isArray(item.bbox) || item.bbox.length !== 4) continue;
    const bbox = pixel ? bboxFromPixels(item.bbox, width, height) : item.bbox.map((value) => clamp(Math.round(Number(value) || 0), 0, 1000));
    if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) continue;
    const type = item.type === "text" || item.label === "text" ? "text" : "obj";
    const next = { type, text: String(item.text || ""), desc: String(item.desc || item.caption || ""), bbox };
    if (item.role) next.role = String(item.role);
    const palette = Array.isArray(item.palette) ? item.palette : item.color_palette;
    if (Array.isArray(palette) && palette.length) next.palette = palette.map(String).slice(0, 5);
    boxes.push(next);
  }
  if (!boxes.length) return null;
  const caption = Array.isArray(data) ? null : data.summary?.caption ?? data.caption;
  return { caption: caption == null ? null : String(caption), boxes };
}

function layoutPrompt(node, boxes) {
  const width = linkedNumber(node, "宽度", 1024);
  const height = linkedNumber(node, "高度", 1536);
  const items = boxes.map((box) => {
    const label = box.type === "text" ? "text" : "object";
    const item = { label, caption: box.desc || "" };
    if (label === "text") item.text = box.text || "";
    if (box.palette?.length) item.palette = box.palette.slice(0, 5);
    item.bbox = pixelBBox(box.bbox, width, height);
    return item;
  });
  return JSON.stringify({
    summary: { caption: linkedText(node, "整图描述").trim() },
    items,
    bbox_coord_space: "abs_centralized",
    bbox_format: "yxyx",
  });
}

function hideWidget(item) {
  hideComfyWidget(item);
}

function hideEditorWidgets(node) {
  hideWidget(widget(node, "boxes"));
  hideWidget(widget(node, "粘贴提示词"));
  hideWidget(widget(node, "宽度"));
  hideWidget(widget(node, "高度"));
  hideWidget(widget(node, "整图描述"));
  hideWidget(widget(node, "宽高比"));
  hideWidget(widget(node, "百万像素"));
}

const ASPECTS = [
  ["1:1", "1:1 (Square)"],
  ["2:3", "2:3 (Portrait Photo)"],
  ["3:2", "3:2 (Photo)"],
  ["3:4", "3:4 (Portrait Standard)"],
  ["4:3", "4:3 (Standard)"],
  ["9:16", "9:16 (Portrait Widescreen)"],
  ["16:9", "16:9 (Widescreen)"],
  ["21:9", "21:9 (Ultrawide)"],
  ["2.35:1", "2.35:1 (公众号首条封面)"],
];
const RATIO_PARTS = {
  "1:1 (Square)": [1, 1],
  "2:3 (Portrait Photo)": [2, 3],
  "3:2 (Photo)": [3, 2],
  "3:4 (Portrait Standard)": [3, 4],
  "4:3 (Standard)": [4, 3],
  "9:16 (Portrait Widescreen)": [9, 16],
  "16:9 (Widescreen)": [16, 9],
  "21:9 (Ultrawide)": [21, 9],
};
const COVER_ASPECT = "2.35:1 (公众号首条封面)";
const COVER_RATIO = 2.35;

function calcSize(aspect, megapixels) {
  const mp = Number.isFinite(Number(megapixels)) ? Number(megapixels) : 1;
  const step = 16;
  const total = mp * 1024 * 1024;
  if (aspect === COVER_ASPECT) {
    const height = Math.max(step, Math.round(Math.sqrt(total / COVER_RATIO) / step) * step);
    const width = Math.max(step, Math.round((height * COVER_RATIO) / step) * step);
    return [width, height];
  }
  const pair = RATIO_PARTS[aspect] || [2, 3];
  const scale = Math.sqrt(total / (pair[0] * pair[1]));
  return [
    Math.max(step, Math.round((pair[0] * scale) / step) * step),
    Math.max(step, Math.round((pair[1] * scale) / step) * step),
  ];
}

function snapSize(value) {
  const snapped = Math.round(Number(value) / 16) * 16;
  return Math.max(16, Math.min(16384, snapped || 16));
}

function button(label, className) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.className = className || "";
  el.addEventListener("pointerdown", (event) => event.stopPropagation());
  el.addEventListener("keydown", (event) => event.stopPropagation());
  return el;
}

async function copyText(text) {
  const value = String(text ?? "");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* Electron / 权限不足时走兜底 */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  area.remove();
  return ok;
}

async function readClipboard() {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    /* 浏览器可能拦剪贴板读取 */
  }
  return null;
}

function downstream(node) {
  const found = [];
  const seen = new Set();
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    if (current !== node) found.push(current);
    for (const output of current.outputs || []) {
      for (const linkId of output.links || []) {
        const link = graphLink(current.graph, linkId);
        const next = link ? current.graph?.getNodeById?.(link.target_id) : null;
        if (next) stack.push(next);
      }
    }
  }
  return found;
}

function isOutputNode(node) {
  const data = node?.constructor?.nodeData;
  if (!data) return node?.type === "SaveImage";
  return (data.nodeDef ?? data).output_node === true;
}

function rerollSeeds(nodes) {
  for (const node of nodes) {
    const seed = widget(node, "seed") || widget(node, "noise_seed");
    if (!seed) continue;
    const max = Number(seed.options?.max) || 0xffffffffffff;
    seed.value = Math.floor(Math.random() * max);
  }
}

function build(node) {
  if (node.__tmpMoss) return;
  node.__tmpMoss = true;
  ensureStyle();
  hideEditorWidgets(node);

  const state = { boxes: parseBoxes(widget(node, "boxes")?.value), selected: -1, drag: null, grid: true, notice: "" };
  const root = document.createElement("div");
  root.className = "tmp-moss";
  root.style.height = "100%";
  root.style.minHeight = "0";

  const sizeRow = document.createElement("div");
  sizeRow.className = "tmp-moss-size";
  function sizeField(label, name, fallback) {
    const wrap = document.createElement("label");
    wrap.className = "tmp-moss-field";
    wrap.style.flexDirection = "row";
    wrap.style.alignItems = "center";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "16";
    input.max = "16384";
    input.step = "16";
    input.value = String(linkedNumber(node, name, fallback));
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 16) return;
      const item = widget(node, name);
      if (item) item.value = value;
      draw();
    });
    input.addEventListener("change", () => {
      const value = snapSize(input.value);
      input.value = String(value);
      const item = widget(node, name);
      if (item) item.value = value;
      draw();
    });
    wrap.append(span, input);
    return { wrap, input, name };
  }
  const widthField = sizeField("宽度", "宽度", 1024);
  const heightField = sizeField("高度", "高度", 1536);
  const aspectWrap = document.createElement("label");
  aspectWrap.className = "tmp-moss-field";
  aspectWrap.style.flexDirection = "row";
  aspectWrap.style.alignItems = "center";
  const aspectLabel = document.createElement("span");
  aspectLabel.textContent = "宽高比";
  const aspect = document.createElement("select");
  for (const [label, value] of ASPECTS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    aspect.append(option);
  }
  aspect.value = String(widget(node, "宽高比")?.value || "2:3 (Portrait Photo)");
  if (!aspect.value) aspect.value = "2:3 (Portrait Photo)";
  aspect.addEventListener("pointerdown", (event) => event.stopPropagation());
  aspect.addEventListener("keydown", (event) => event.stopPropagation());
  aspectWrap.append(aspectLabel, aspect);
  const mpWrap = document.createElement("label");
  mpWrap.className = "tmp-moss-field";
  mpWrap.style.flexDirection = "row";
  mpWrap.style.alignItems = "center";
  const mpLabel = document.createElement("span");
  mpLabel.textContent = "百万像素";
  const mpInput = document.createElement("input");
  mpInput.type = "number";
  mpInput.min = "0.1";
  mpInput.max = "16";
  mpInput.step = "0.1";
  mpInput.value = String(widget(node, "百万像素")?.value ?? 1.5);
  mpInput.addEventListener("pointerdown", (event) => event.stopPropagation());
  mpInput.addEventListener("keydown", (event) => event.stopPropagation());
  mpWrap.append(mpLabel, mpInput);
  function applyPreset() {
    const ratio = widget(node, "宽高比");
    if (ratio) ratio.value = aspect.value;
    const mp = Number(mpInput.value);
    const mpWidget = widget(node, "百万像素");
    if (mpWidget && Number.isFinite(mp)) mpWidget.value = mp;
    const [nextWidth, nextHeight] = calcSize(aspect.value, mp);
    widthField.input.value = String(nextWidth);
    heightField.input.value = String(nextHeight);
    const widthWidget = widget(node, "宽度");
    const heightWidget = widget(node, "高度");
    if (widthWidget) widthWidget.value = nextWidth;
    if (heightWidget) heightWidget.value = nextHeight;
    draw();
  }
  aspect.addEventListener("change", applyPreset);
  mpInput.addEventListener("change", applyPreset);
  sizeRow.append(aspectWrap, mpWrap, widthField.wrap, heightField.wrap);
  sizeRow.title = "改宽高比或百万像素会重算宽度和高度。这两个输出接到空 Latent（Flux2）";

  const captionField = document.createElement("label");
  captionField.className = "tmp-moss-field";
  const captionLabel = document.createElement("span");
  captionLabel.textContent = "整图描述";
  const caption = document.createElement("textarea");
  caption.className = "tmp-moss-caption";
  caption.value = String(widget(node, "整图描述")?.value || "");
  caption.addEventListener("pointerdown", (event) => event.stopPropagation());
  caption.addEventListener("keydown", (event) => event.stopPropagation());
  caption.addEventListener("input", () => {
    const item = widget(node, "整图描述");
    if (item) item.value = caption.value;
  });
  captionField.append(captionLabel, caption);

  const bar = document.createElement("div");
  bar.className = "tmp-moss-bar";
  const addBtn = button("新建画框", "primary");
  const gridBtn = button("网格", "on");
  const deleteBtn = button("删除所选");
  const clearBtn = button("清空画布");
  const designAiBtn = button("复制给AI", "primary");
  const runBtn = button("生成图片", "primary");
  const againBtn = button("重新生成图片");
  addBtn.title = "新建文字框；也可在画布上右键";
  deleteBtn.title = "删除当前选中的框；也可在画布上右键";
  clearBtn.title = "清除画布上的全部画框";
  designAiBtn.title = "按宽高比和整图描述，复制一段让 AI 扩写并设计画框 JSON 的提示词";
  bar.append(addBtn, gridBtn, deleteBtn, clearBtn, designAiBtn, runBtn, againBtn);

  const menu = document.createElement("div");
  menu.className = "tmp-moss-menu";
  const menuAddText = button("新建文字框");
  const menuAddObj = button("新建画面框");
  const menuDelete = button("删除所选");
  const menuColor = button("调整框颜色");
  menu.append(menuAddText, menuAddObj, menuDelete, menuColor);
  document.body.appendChild(menu);
  const menuColorPick = document.createElement("input");
  menuColorPick.type = "color";
  menuColorPick.style.cssText = "position:fixed;width:32px;height:32px;opacity:0.01;left:0;top:0;z-index:10001;";
  document.body.appendChild(menuColorPick);
  let menuPoint = null;

  const stageWrap = document.createElement("div");
  stageWrap.className = "tmp-moss-stage";
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  stageWrap.appendChild(canvas);

  const form = document.createElement("div");
  form.className = "tmp-moss-form";
  const typeRow = document.createElement("div");
  typeRow.className = "tmp-moss-types";
  const objBtn = button("画面描述");
  const textBtn = button("排版文字");
  typeRow.append(objBtn, textBtn);

  function field(label, multiline) {
    const wrap = document.createElement("label");
    wrap.className = "tmp-moss-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) input.type = "text";
    wrap.append(span, input);
    return { wrap, input };
  }
  const textField = field("文本", false);
  const descField = field("描述", true);

  const colorRow = document.createElement("div");
  colorRow.className = "tmp-moss-colors";
  const swatches = document.createElement("div");
  const addColor = button("+");
  addColor.title = "添加一个颜色，第一个颜色是框的颜色";
  const colorEdit = document.createElement("input");
  colorEdit.type = "color";
  colorEdit.value = "#78c896";
  colorEdit.title = "先选颜色，再点确认";
  colorEdit.addEventListener("pointerdown", (event) => event.stopPropagation());
  colorEdit.addEventListener("click", (event) => event.stopPropagation());
  const hexEdit = document.createElement("input");
  hexEdit.type = "text";
  hexEdit.className = "tmp-moss-hex";
  hexEdit.value = "#78c896";
  hexEdit.maxLength = 7;
  hexEdit.placeholder = "#RRGGBB";
  hexEdit.title = "也可直接填十六进制颜色";
  hexEdit.addEventListener("pointerdown", (event) => event.stopPropagation());
  hexEdit.addEventListener("keydown", (event) => event.stopPropagation());
  const confirmColor = button("确认", "primary");
  confirmColor.title = "把当前颜色应用到选中的色位";
  const picker = document.createElement("select");
  let colorIndex = 0;
  colorRow.append(document.createTextNode("调色板"), swatches, addColor, colorEdit, hexEdit, confirmColor, picker);
  colorEdit.addEventListener("input", () => { hexEdit.value = colorEdit.value; });
  hexEdit.addEventListener("change", () => {
    const value = String(hexEdit.value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      colorEdit.value = value;
      hexEdit.value = value.toLowerCase();
    }
  });

  const pasteLabel = document.createElement("div");
  pasteLabel.className = "tmp-moss-paste-label";
  const pasteName = document.createElement("span");
  pasteName.textContent = "提示词";
  const statusMark = document.createElement("span");
  statusMark.className = "tmp-moss-status";
  const pasteMark = document.createElement("span");
  pasteMark.className = "tmp-moss-mode";
  pasteLabel.append(pasteName, statusMark, pasteMark);
  const pasteBar = document.createElement("div");
  pasteBar.className = "tmp-moss-bar";
  const previewBtn = button("预览");
  const copyBtn = button("复制原文");
  const aiBtn = button("复制给AI");
  const pasteBtn = button("粘贴");
  const fillBtn = button("回填", "primary");
  const clearPaste = button("清空粘贴");
  previewBtn.title = "把当前画布编译出的最终提示词显示在下面";
  copyBtn.title = "复制当前最终提示词";
  aiBtn.title = "复制最终提示词，并带上画幅比例和扩写优化要求";
  pasteBtn.title = "把剪贴板内容贴进提示词框";
  fillBtn.title = "把下面的 JSON 写回整图描述和画框，直接看版面";
  clearPaste.title = "清空后，生成改回按画布编译";
  pasteBar.append(previewBtn, copyBtn, aiBtn, pasteBtn, fillBtn, clearPaste);
  const paste = document.createElement("textarea");
  paste.className = "tmp-moss-paste";
  paste.placeholder = "点「预览」查看当前提示词，或把 AI 改好的 JSON 贴在这里。点「回填」写回画布看版面。只有你改过或贴过、还没回填的内容才会用来生成。";
  paste.value = String(widget(node, "粘贴提示词")?.value || "");

  form.append(typeRow, textField.wrap, descField.wrap, colorRow, pasteLabel, pasteBar, paste);
  root.append(sizeRow, captionField, bar, stageWrap, form);
  for (const el of [form, paste, textField.input, descField.input, picker]) {
    el.addEventListener("pointerdown", (event) => event.stopPropagation());
    el.addEventListener("keydown", (event) => event.stopPropagation());
  }

  root.style.width = "100%";
  root.style.height = "100%";
  root.style.minHeight = "0";
  root.style.maxHeight = "100%";
  root.style.boxSizing = "border-box";
  const mossWidget = node.addDOMWidget("tmp_moss_ui", "tmp_moss", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 720,
  });
  if (mossWidget) {
    mossWidget.computeLayoutSize = () => ({
      minHeight: 720,
      maxHeight: Infinity,
      minWidth: 0,
    });
  }

  let noticeTimer = 0;
  function setNotice(text, kind = "ok") {
    state.notice = text || "";
    statusMark.textContent = state.notice;
    statusMark.classList.toggle("ok", Boolean(text) && kind !== "err");
    statusMark.classList.toggle("err", Boolean(text) && kind === "err");
    if (noticeTimer) clearTimeout(noticeTimer);
    if (text) {
      noticeTimer = setTimeout(() => {
        if (state.notice === text) {
          statusMark.textContent = "";
          statusMark.classList.remove("ok", "err");
          state.notice = "";
        }
      }, 3500);
    }
  }

  function writeBoxes() {
    const item = widget(node, "boxes");
    if (item) item.value = serializeBoxes(state.boxes);
  }

  let previewing = false;

  function writePaste() {
    const item = widget(node, "粘贴提示词");
    const pasted = previewing ? "" : paste.value;
    if (item) item.value = pasted;
    const used = pasted.trim().length > 0;
    paste.classList.toggle("used", used);
    pasteMark.textContent = previewing ? "预览，生成仍按画布" : (used ? "生成时用这段" : "留空则按画布生成");
  }

  function showPreview() {
    let text = layoutPrompt(node, state.boxes);
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* 保持原样 */ }
    previewing = true;
    paste.value = text;
    writePaste();
    setNotice("已显示当前提示词");
  }

  function selectedBox() {
    return state.boxes[state.selected] || null;
  }

  function boxLabel(box, index) {
    const kind = box.type === "text" ? "文字" : "画面";
    const raw = (box.type === "text" ? box.text : box.desc) || "";
    const brief = raw.replace(/\s+/g, " ").trim().slice(0, 10);
    return String(index + 1).padStart(2, "0") + " " + kind + (brief ? " · " + brief : "");
  }

  function defaultPalette(type) {
    return type === "obj" ? ["#e0966a"] : ["#78c896", "#ffffff"];
  }

  function ensurePalette(box) {
    if (!box) return null;
    if (!Array.isArray(box.palette) || !box.palette.length) {
      box.palette = defaultPalette(box.type);
    }
    box.palette = box.palette.slice(0, 5).map((color) => (/^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : "#ffffff"));
    return box.palette;
  }

  function setBoxColor(box, color, index = 0) {
    if (!box) return;
    ensurePalette(box);
    const next = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
    while (box.palette.length <= index) box.palette.push("#ffffff");
    box.palette[index] = next;
    writeBoxes();
    syncForm();
    draw();
  }

  function syncForm() {
    const box = selectedBox();
    if (box) ensurePalette(box);
    objBtn.classList.toggle("on", box?.type === "obj");
    textBtn.classList.toggle("on", box?.type === "text");
    objBtn.disabled = textBtn.disabled = !box;
    textField.input.disabled = !box || box.type !== "text";
    textField.input.value = box?.text || "";
    textField.input.placeholder = box && box.type !== "text" ? "画面框不输出文字" : "";
    descField.input.disabled = !box;
    descField.input.value = box?.desc || "";
    descField.input.placeholder = box ? "描述这个框里的内容" : "先选中一个框";
    const colors = box?.palette || [];
    if (colorIndex >= colors.length) colorIndex = Math.max(0, colors.length - 1);
    swatches.innerHTML = "";
    colors.slice(0, 5).forEach((color, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tmp-moss-swatch" + (index === colorIndex ? " on" : "");
      chip.style.background = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
      chip.title = index === 0 ? "框颜色，点选后改色并确认；右键删除" : "点选后改色并确认；右键删除";
      chip.addEventListener("pointerdown", (event) => event.stopPropagation());
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        colorIndex = index;
        const next = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
        colorEdit.value = next;
        hexEdit.value = next;
        syncForm();
      });
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!box?.palette) return;
        box.palette.splice(index, 1);
        if (!box.palette.length) box.palette = defaultPalette(box.type);
        colorIndex = Math.min(colorIndex, box.palette.length - 1);
        syncForm();
        writeBoxes();
        draw();
      });
      swatches.appendChild(chip);
    });
    if (box && colors[colorIndex]) {
      const current = /^#[0-9a-f]{6}$/i.test(colors[colorIndex]) ? colors[colorIndex] : "#ffffff";
      colorEdit.value = current;
      hexEdit.value = current;
    }
    const canEdit = Boolean(box);
    colorEdit.disabled = hexEdit.disabled = confirmColor.disabled = !canEdit;
    addColor.disabled = !box || colors.length >= 5;
    const current = String(state.selected);
    picker.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "-1";
    empty.textContent = state.boxes.length ? "选择框" : "暂无框";
    picker.appendChild(empty);
    state.boxes.forEach((box, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = boxLabel(box, index);
      picker.appendChild(option);
    });
    picker.value = current;
    if (picker.value !== current) picker.value = "-1";
    picker.disabled = !state.boxes.length;
    deleteBtn.disabled = !box;
    gridBtn.classList.toggle("on", state.grid);
  }

  function stageOf(width, height) {
    const ratio = linkedNumber(node, "宽度", 1024) / linkedNumber(node, "高度", 1536);
    let w = Math.max(1, width - 10);
    let h = w / ratio;
    if (h > height - 10) {
      h = Math.max(1, height - 10);
      w = h * ratio;
    }
    return { x: (width - w) / 2, y: (height - h) / 2, w, h };
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const lines = [];
    let line = "";
    for (const char of String(text)) {
      if (char === "\n") {
        lines.push(line);
        line = "";
      } else if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line += char;
      }
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    return lines.slice(0, maxLines);
  }

  function draw() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(40, stageWrap.clientWidth || 320);
    const height = Math.max(40, stageWrap.clientHeight || 360);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const stage = stageOf(width, height);
    ctx.fillStyle = "#1c1c20";
    ctx.fillRect(stage.x, stage.y, stage.w, stage.h);
    if (state.grid) {
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      for (let x = stage.x + 8; x < stage.x + stage.w; x += 16) {
        for (let y = stage.y + 8; y < stage.y + stage.h; y += 16) ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    ctx.strokeStyle = "#4a4a52";
    ctx.strokeRect(stage.x + 0.5, stage.y + 0.5, stage.w - 1, stage.h - 1);
    state.boxes.forEach((box, index) => {
      const [y0, x0, y1, x1] = box.bbox;
      const left = stage.x + (x0 / 1000) * stage.w;
      const top = stage.y + (y0 / 1000) * stage.h;
      const right = stage.x + (x1 / 1000) * stage.w;
      const bottom = stage.y + (y1 / 1000) * stage.h;
      const color = box.palette?.[0] && /^#[0-9a-f]{6}$/i.test(box.palette[0])
        ? box.palette[0]
        : box.type === "text" ? "#78c896" : "#e0966a";
      ctx.fillStyle = color + "22";
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = index === state.selected ? "#f2d06b" : color;
      ctx.lineWidth = index === state.selected ? 2 : 1;
      ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, right - left - 1), Math.max(1, bottom - top - 1));
      const tag = String(index + 1).padStart(2, "0");
      ctx.font = "10px system-ui, sans-serif";
      const tagWidth = Math.max(22, ctx.measureText(tag).width + 8);
      ctx.fillStyle = color;
      ctx.fillRect(left, top, tagWidth, 15);
      const rgb = parseInt(color.slice(1), 16);
      const ink = 0.299 * (rgb >> 16) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255) > 150 ? "#141416" : "#ffffff";
      ctx.fillStyle = ink;
      ctx.fillText(tag, left + 4, top + 11);
      if (index === state.selected) {
        ctx.fillStyle = "#f2d06b";
        for (const [hx, hy] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
          ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
        }
      }
      const body = box.type === "text"
        ? "“" + (box.text || "") + "”" + (box.desc ? " — " + box.desc : "")
        : box.desc || "";
      if (body && bottom - top > 26 && right - left > 30) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left + 3, top + 16, right - left - 6, bottom - top - 19);
        ctx.clip();
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillStyle = "rgba(232,232,238,0.78)";
        const lines = wrapText(ctx, body, right - left - 8, Math.max(1, Math.floor((bottom - top - 22) / 13)));
        lines.forEach((line, lineIndex) => ctx.fillText(line, left + 5, top + 29 + lineIndex * 13));
        ctx.restore();
      }
    });
    if (!state.boxes.length) {
      ctx.fillStyle = "rgba(180,180,190,0.75)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("右键新建或删除画框；上方可清空画布；拖动已有框可移动和缩放", stage.x + 10, stage.y + 22);
    }
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    const stage = stageOf(rect.width, rect.height);
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    return {
      stage,
      sx,
      sy,
      nx: clamp(((sx - stage.x) / stage.w) * 1000, 0, 1000),
      ny: clamp(((sy - stage.y) / stage.h) * 1000, 0, 1000),
    };
  }

  function hit(point) {
    const { stage, sx, sy } = point;
    const near = (x, y) => Math.abs(sx - x) <= HANDLE && Math.abs(sy - y) <= HANDLE;
    for (let index = state.boxes.length - 1; index >= 0; index -= 1) {
      const [y0, x0, y1, x1] = state.boxes[index].bbox;
      const left = stage.x + (x0 / 1000) * stage.w;
      const top = stage.y + (y0 / 1000) * stage.h;
      const right = stage.x + (x1 / 1000) * stage.w;
      const bottom = stage.y + (y1 / 1000) * stage.h;
      if (near(left, top)) return { index, mode: "resize-nw" };
      if (near(right, top)) return { index, mode: "resize-ne" };
      if (near(left, bottom)) return { index, mode: "resize-sw" };
      if (near(right, bottom)) return { index, mode: "resize-se" };
      if (sx >= left && sx <= right && sy >= top && sy <= bottom) return { index, mode: "move" };
    }
    return null;
  }

  function resizeBBox(start, mode, nx, ny) {
    let [y0, x0, y1, x1] = start;
    if (mode === "resize-nw") {
      y0 = Math.round(clamp(ny, 0, y1 - MIN_BOX));
      x0 = Math.round(clamp(nx, 0, x1 - MIN_BOX));
    } else if (mode === "resize-ne") {
      y0 = Math.round(clamp(ny, 0, y1 - MIN_BOX));
      x1 = Math.round(clamp(nx, x0 + MIN_BOX, 1000));
    } else if (mode === "resize-sw") {
      y1 = Math.round(clamp(ny, y0 + MIN_BOX, 1000));
      x0 = Math.round(clamp(nx, 0, x1 - MIN_BOX));
    } else {
      y1 = Math.round(clamp(ny, y0 + MIN_BOX, 1000));
      x1 = Math.round(clamp(nx, x0 + MIN_BOX, 1000));
    }
    return [y0, x0, y1, x1];
  }

  function cursorFor(mode) {
    if (mode === "resize-nw" || mode === "resize-se") return "nwse-resize";
    if (mode === "resize-ne" || mode === "resize-sw") return "nesw-resize";
    if (mode === "move") return "move";
    return "crosshair";
  }

  function finishBox(box) {
    let [y0, x0, y1, x1] = box.bbox;
    if (y1 - y0 < MIN_BOX) {
      y0 = clamp(y0, 0, 1000 - MIN_BOX);
      y1 = y0 + MIN_BOX;
    }
    if (x1 - x0 < MIN_BOX) {
      x0 = clamp(x0, 0, 1000 - MIN_BOX);
      x1 = x0 + MIN_BOX;
    }
    box.bbox = [y0, x0, y1, x1];
  }

  function addBox(type, at) {
    const boxHeight = type === "obj" ? 320 : 90;
    const boxWidth = type === "obj" ? 420 : 520;
    let y0;
    let x0;
    if (at) {
      y0 = clamp(Math.round(at.ny - boxHeight / 2), 0, 1000 - boxHeight);
      x0 = clamp(Math.round(at.nx - boxWidth / 2), 0, 1000 - boxWidth);
    } else {
      const count = state.boxes.length;
      const shift = (count % 6) * 28;
      y0 = clamp((type === "obj" ? 180 : 40) + shift, 0, 1000 - boxHeight);
      x0 = clamp((type === "obj" ? 160 : 80) + shift, 0, 1000 - boxWidth);
    }
    state.boxes.push({
      type,
      text: "",
      desc: "",
      palette: defaultPalette(type),
      bbox: [y0, x0, y0 + boxHeight, x0 + boxWidth],
    });
    state.selected = state.boxes.length - 1;
    syncForm();
    writeBoxes();
    draw();
    setNotice(type === "obj" ? "已新建画面框" : "已新建文字框");
  }

  function deleteSelected() {
    if (state.selected < 0) {
      setNotice("没有选中的画框", "err");
      return;
    }
    state.boxes.splice(state.selected, 1);
    state.selected = Math.min(state.selected, state.boxes.length - 1);
    syncForm();
    writeBoxes();
    draw();
    setNotice("已删除所选画框");
  }

  function clearBoxes() {
    if (!state.boxes.length) {
      setNotice("画布已经是空的", "err");
      return;
    }
    state.boxes = [];
    state.selected = -1;
    state.drag = null;
    syncForm();
    writeBoxes();
    draw();
    setNotice("已清空画布");
  }

  function hideMenu() {
    menu.style.display = "none";
    menuPoint = null;
  }

  function showMenu(event, point) {
    event.preventDefault();
    event.stopPropagation();
    menuPoint = point;
    const hasBox = state.selected >= 0 || Boolean(hit(point));
    menuDelete.disabled = !hasBox;
    menuColor.disabled = !hasBox;
    menu.style.display = "block";
    const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 2) return;
    hideMenu();
    canvas.focus();
    const point = pointer(event);
    if (point.sx < point.stage.x || point.sx > point.stage.x + point.stage.w || point.sy < point.stage.y || point.sy > point.stage.y + point.stage.h) return;
    const found = hit(point);
    if (found) {
      canvas.setPointerCapture?.(event.pointerId);
      state.selected = found.index;
      state.drag = { mode: found.mode, index: found.index, origin: point, start: [...state.boxes[found.index].bbox] };
      syncForm();
      draw();
      return;
    }
    state.selected = -1;
    state.drag = null;
    syncForm();
    draw();
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = pointer(event);
    if (!state.drag) {
      canvas.style.cursor = cursorFor(hit(point)?.mode);
      return;
    }
    const drag = state.drag;
    const box = state.boxes[drag.index];
    if (!box) return;
    canvas.style.cursor = cursorFor(drag.mode);
    if (drag.mode === "move") {
      const dx = Math.round(((point.sx - drag.origin.sx) / point.stage.w) * 1000);
      const dy = Math.round(((point.sy - drag.origin.sy) / point.stage.h) * 1000);
      const height = drag.start[2] - drag.start[0];
      const width = drag.start[3] - drag.start[1];
      const y0 = Math.round(clamp(drag.start[0] + dy, 0, 1000 - height));
      const x0 = Math.round(clamp(drag.start[1] + dx, 0, 1000 - width));
      box.bbox = [y0, x0, y0 + height, x0 + width];
    } else if (String(drag.mode).startsWith("resize")) {
      box.bbox = resizeBBox(drag.start, drag.mode, point.nx, point.ny);
    }
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    const drag = state.drag;
    state.drag = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    canvas.style.cursor = cursorFor(hit(pointer(event))?.mode);
    if (!drag) {
      draw();
      return;
    }
    finishBox(state.boxes[drag.index]);
    writeBoxes();
    draw();
  });
  canvas.addEventListener("pointercancel", () => {
    state.drag = null;
    canvas.style.cursor = "crosshair";
    draw();
  });
  canvas.addEventListener("contextmenu", (event) => {
    const point = pointer(event);
    const found = hit(point);
    if (found) {
      state.selected = found.index;
      syncForm();
      draw();
    }
    showMenu(event, point);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target) && event.target !== canvas) hideMenu();
  }, true);
  canvas.addEventListener("keydown", (event) => {
    if (state.selected < 0) return;
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    deleteSelected();
  });

  picker.addEventListener("change", () => {
    const index = Number(picker.value);
    state.selected = Number.isInteger(index) && index >= 0 && index < state.boxes.length ? index : -1;
    syncForm();
    draw();
  });
  objBtn.addEventListener("click", () => {
    const box = selectedBox();
    if (!box) return;
    box.type = "obj";
    syncForm();
    writeBoxes();
    draw();
  });
  textBtn.addEventListener("click", () => {
    const box = selectedBox();
    if (!box) return;
    box.type = "text";
    syncForm();
    writeBoxes();
    draw();
  });
  textField.input.addEventListener("input", () => {
    const box = selectedBox();
    if (!box) return;
    box.text = textField.input.value;
    writeBoxes();
    draw();
  });
  descField.input.addEventListener("input", () => {
    const box = selectedBox();
    if (!box) return;
    box.desc = descField.input.value;
    writeBoxes();
    draw();
  });
  addColor.addEventListener("click", () => {
    const box = selectedBox();
    if (!box) return;
    ensurePalette(box);
    if (box.palette.length >= 5) return;
    box.palette.push("#ffffff");
    colorIndex = box.palette.length - 1;
    colorEdit.value = "#ffffff";
    hexEdit.value = "#ffffff";
    syncForm();
    writeBoxes();
    draw();
  });
  confirmColor.addEventListener("click", () => {
    const box = selectedBox();
    if (!box) {
      setNotice("先选中一个画框", "err");
      return;
    }
    ensurePalette(box);
    let value = String(hexEdit.value || colorEdit.value || "").trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) value = colorEdit.value;
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      setNotice("颜色格式要用 #RRGGBB", "err");
      return;
    }
    value = value.toLowerCase();
    colorEdit.value = value;
    hexEdit.value = value;
    if (colorIndex < 0 || colorIndex >= box.palette.length) colorIndex = 0;
    setBoxColor(box, value, colorIndex);
    setNotice(colorIndex === 0 ? "已确认框颜色" : `已确认颜色 ${colorIndex + 1}`);
  });
  addBtn.addEventListener("click", () => addBox(selectedBox()?.type === "obj" ? "obj" : "text"));
  gridBtn.addEventListener("click", () => {
    state.grid = !state.grid;
    syncForm();
    draw();
  });
  deleteBtn.addEventListener("click", deleteSelected);
  clearBtn.addEventListener("click", clearBoxes);
  designAiBtn.addEventListener("click", async () => {
    try {
      const width = snapSize(widthField.input.value);
      const height = snapSize(heightField.input.value);
      const aspectValue = aspect.value || String(widget(node, "宽高比")?.value || "");
      const megapixels = Number(mpInput.value);
      const captionWidget = widget(node, "整图描述");
      if (captionWidget) captionWidget.value = caption.value;
      const payload = aiDesignLead(width, height, aspectValue, megapixels, caption.value);
      const ok = await copyText(payload);
      setNotice(ok ? `已复制设计提示（${ratioText(width, height, aspectValue)}）` : "复制失败", ok ? "ok" : "err");
    } catch (error) {
      setNotice(String(error?.message || error || "复制失败"), "err");
    }
  });
  menuAddText.addEventListener("click", () => {
    const at = menuPoint;
    hideMenu();
    addBox("text", at);
  });
  menuAddObj.addEventListener("click", () => {
    const at = menuPoint;
    hideMenu();
    addBox("obj", at);
  });
  menuDelete.addEventListener("click", () => {
    hideMenu();
    deleteSelected();
  });
  menuColor.addEventListener("click", () => {
    const box = selectedBox();
    hideMenu();
    if (!box) {
      setNotice("先选中一个画框", "err");
      return;
    }
    ensurePalette(box);
    menuColorPick.value = box.palette[0];
    const onPick = () => {
      setBoxColor(box, menuColorPick.value, 0);
      setNotice("已调整框颜色");
      menuColorPick.removeEventListener("input", onPick);
      menuColorPick.removeEventListener("change", onDone);
    };
    const onDone = () => {
      setBoxColor(box, menuColorPick.value, 0);
      setNotice("已调整框颜色");
      menuColorPick.removeEventListener("input", onPick);
      menuColorPick.removeEventListener("change", onDone);
    };
    menuColorPick.addEventListener("input", onPick);
    menuColorPick.addEventListener("change", onDone);
    requestAnimationFrame(() => menuColorPick.click());
  });
  previewBtn.addEventListener("click", showPreview);
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(layoutPrompt(node, state.boxes));
    setNotice(ok ? "已复制原文" : "复制失败", ok ? "ok" : "err");
  });
  aiBtn.addEventListener("click", async () => {
    try {
      const width = snapSize(widthField.input.value);
      const height = snapSize(heightField.input.value);
      const aspectValue = aspect.value || String(widget(node, "宽高比")?.value || "");
      const megapixels = Number(mpInput.value);
      const payload = aiLead(width, height, aspectValue, megapixels) + layoutPrompt(node, state.boxes);
      const ok = await copyText(payload);
      setNotice(ok ? `已复制给 AI（${ratioText(width, height, aspectValue)}）` : "复制失败", ok ? "ok" : "err");
    } catch (error) {
      setNotice(String(error?.message || error || "复制失败"), "err");
    }
  });
  pasteBtn.addEventListener("click", async () => {
    const text = await readClipboard();
    if (text == null) {
      setNotice("无法读取剪贴板，请在框里 Ctrl+V", "err");
      paste.focus();
      return;
    }
    previewing = false;
    paste.value = text;
    writePaste();
    setNotice(text.trim() ? "已粘贴剪贴板内容" : "剪贴板是空的", text.trim() ? "ok" : "err");
  });
  fillBtn.addEventListener("click", () => {
    const width = snapSize(widthField.input.value);
    const height = snapSize(heightField.input.value);
    const filled = layoutFromPrompt(paste.value, width, height);
    if (!filled) {
      setNotice("没有读到画框 JSON", "err");
      return;
    }
    state.boxes = filled.boxes;
    state.selected = 0;
    state.drag = null;
    writeBoxes();
    if (filled.caption != null) {
      caption.value = filled.caption;
      const captionWidget = widget(node, "整图描述");
      if (captionWidget) captionWidget.value = filled.caption;
    }
    previewing = true;
    writePaste();
    syncForm();
    draw();
    setNotice(`已回填 ${filled.boxes.length} 个画框`);
  });
  paste.addEventListener("input", () => {
    previewing = false;
    writePaste();
  });
  clearPaste.addEventListener("click", () => {
    previewing = false;
    paste.value = "";
    writePaste();
    setNotice("已清空粘贴");
  });

  async function run(reroll) {
    writeBoxes();
    writePaste();
    const captionWidget = widget(node, "整图描述");
    if (captionWidget) captionWidget.value = caption.value;
    for (const field of [widthField, heightField]) {
      const value = snapSize(field.input.value);
      field.input.value = String(value);
      const item = widget(node, field.name);
      if (item) item.value = value;
    }
    if (reroll) rerollSeeds(downstream(node));
    runBtn.disabled = againBtn.disabled = true;
    setNotice("正在加入队列…");
    try {
      const result = await app.graphToPrompt();
      const prompt = result?.output;
      if (!prompt) throw new Error("没有拿到可执行的工作流");
      const targets = downstream(node).filter(isOutputNode).map((item) => String(item.id));
      const body = { client_id: api.clientId || api.initialClientId || "", prompt };
      if (targets.length) body.partial_execution_targets = targets;
      const response = await api.fetchApi("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw new Error(payload?.error?.message || "队列失败");
      setNotice(payload.prompt_id ? "已加入队列" : "已提交");
    } catch (error) {
      setNotice(String(error?.message || error || "生成失败"));
    } finally {
      runBtn.disabled = againBtn.disabled = false;
    }
  }
  runBtn.addEventListener("click", () => run(false));
  againBtn.addEventListener("click", () => run(true));

  node.__tmpMossReload = () => {
    state.boxes = parseBoxes(widget(node, "boxes")?.value);
    state.selected = -1;
    state.drag = null;
    paste.value = String(widget(node, "粘贴提示词")?.value || "");
    previewing = false;
    caption.value = String(widget(node, "整图描述")?.value || "");
    aspect.value = String(widget(node, "宽高比")?.value || "2:3 (Portrait Photo)");
    if (![...aspect.options].some((option) => option.value === aspect.value)) aspect.value = "2:3 (Portrait Photo)";
    mpInput.value = String(widget(node, "百万像素")?.value ?? 1.5);
    widthField.input.value = String(linkedNumber(node, "宽度", 1024));
    heightField.input.value = String(linkedNumber(node, "高度", 1536));
    hideEditorWidgets(node);
    writePaste();
    syncForm();
    draw();
  };

  writePaste();
  syncForm();
  draw();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => draw()).observe(stageWrap);
  hideEditorWidgets(node);
  const width = Math.min(Math.max(Number(node.size?.[0]) || 860, 760), 920);
  const height = Math.max(Number(node.size?.[1]) || 960, 900);
  node.setSize([width, height]);
  requestAnimationFrame(() => {
    hideEditorWidgets(node);
    const wrap = root.parentElement;
    if (wrap) {
      wrap.style.width = "100%";
      wrap.style.maxWidth = "100%";
      wrap.style.boxSizing = "border-box";
      wrap.style.overflow = "hidden";
    }
    node.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "TE.ManPro.MossBox",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onCreated?.apply(this, arguments);
      try { build(this); } catch (error) { console.error("[feimao tools 画框]", error); }
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      const node = this;
      const reload = () => node.__tmpMossReload?.();
      queueMicrotask(reload);
      setTimeout(reload, 0);
      return result;
    };
  },
});
