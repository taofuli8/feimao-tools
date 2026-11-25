import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { hideComfyWidget, useDomLayout } from "./hide_widget.js";

const NODE_CLASS = "feimao_tools_Board";
const COLOR_HEX = { 纯红: "#ff0000", 纯绿: "#00ff00", 纯蓝: "#0000ff" };
const PRESET_PARTS = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "21:9": [21, 9],
  "9:21": [9, 21],
};
const RATIO_CHOICES = ["9:16", "16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"];
const CORNERS = {
  tl: { signs: [-1, -1], cursor: "nwse-resize", anchor: "br" },
  tr: { signs: [1, -1], cursor: "nesw-resize", anchor: "bl" },
  bl: { signs: [-1, 1], cursor: "nesw-resize", anchor: "tr" },
  br: { signs: [1, 1], cursor: "nwse-resize", anchor: "tl" },
};
const SIDE_NAMES = { left: "左", right: "右", top: "上", bottom: "下" };
const BASELINE_KEYS = ["模式", "百万像素", "倍数", "外补颜色", "预设", "图像缩放", "左", "右", "上", "下", "羽化"];
const loaderSubscriptions = new WeakMap();

function widget(node, name) {
  return (node.widgets || []).find((item) => item.name === name);
}

function pyRound(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const base = Math.floor(abs + 1e-8);
  const frac = abs - base;
  if (frac > 0.5 + 1e-8) return sign * (base + 1);
  if (frac < 0.5 - 1e-8) return sign * base;
  return sign * (base % 2 === 0 ? base : base + 1);
}

function ratioChoices(mode) {
  if (mode === "通用") return RATIO_CHOICES.concat(["跟随参考图"]);
  return ["自由"].concat(RATIO_CHOICES);
}

function ratioOutputSize(megapixels, multiple, pair) {
  const total = Math.trunc(Number(megapixels) * 1024 * 1024);
  const scale = Math.sqrt(total / (pair[0] * pair[1]));
  let width = Math.max(1, pyRound(pair[0] * scale));
  let height = Math.max(1, pyRound(pair[1] * scale));
  multiple = Math.max(1, Math.round(Number(multiple) || 1));
  if (multiple <= 1) return [width, height];
  return [
    Math.max(multiple, Math.floor(width / multiple) * multiple),
    Math.max(multiple, Math.floor(height / multiple) * multiple),
  ];
}

function finalSize(width, height, megapixels, multiple) {
  width = Math.max(1, Math.round(Number(width) || 1));
  height = Math.max(1, Math.round(Number(height) || 1));
  const total = Math.trunc(Number(megapixels) * 1024 * 1024);
  const scaleBy = Math.sqrt(total / (width * height));
  width = Math.max(1, pyRound(width * scaleBy));
  height = Math.max(1, pyRound(height * scaleBy));
  multiple = Math.max(1, Math.round(Number(multiple) || 1));
  if (multiple <= 1) return [width, height];
  const targetW = Math.floor(width / multiple) * multiple;
  const targetH = Math.floor(height / multiple) * multiple;
  if (targetW <= 0 || targetH <= 0 || (targetW === width && targetH === height)) return [width, height];
  return [targetW, targetH];
}

function constrain(values, iw, ih, preset, edges = []) {
  const pads = {
    left: Math.max(0, Math.round(Number(values.left) || 0)),
    right: Math.max(0, Math.round(Number(values.right) || 0)),
    top: Math.max(0, Math.round(Number(values.top) || 0)),
    bottom: Math.max(0, Math.round(Number(values.bottom) || 0)),
  };
  const pair = PRESET_PARTS[preset];
  if (!pair || iw <= 0 || ih <= 0) return pads;
  let [rw, rh] = pair;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const divisor = gcd(rw, rh) || 1;
  rw /= divisor;
  rh /= divisor;
  const widthFactor = (iw + pads.left + pads.right) / rw;
  const heightFactor = (ih + pads.top + pads.bottom) / rh;
  const horizontal = edges.some((key) => key === "left" || key === "right");
  const vertical = edges.some((key) => key === "top" || key === "bottom");
  const desired = horizontal && !vertical ? widthFactor : vertical && !horizontal ? heightFactor : Math.max(widthFactor, heightFactor);
  const factor = Math.ceil(Math.max(iw / rw, ih / rh, desired) - 1e-9);
  const result = { ...pads };
  for (const [start, end, totalRaw] of [
    ["left", "right", factor * rw - iw],
    ["top", "bottom", factor * rh - ih],
  ]) {
    const total = Math.max(0, Math.round(totalRaw));
    const sum = pads[start] + pads[end];
    let first;
    if (edges.includes(start) && !edges.includes(end)) first = total - pads[end];
    else if (edges.includes(end) && !edges.includes(start)) first = pads[start];
    else first = sum ? Math.round((total * pads[start]) / sum) : Math.floor(total / 2);
    first = Math.max(0, Math.min(total, Math.round(first)));
    result[start] = first;
    result[end] = total - first;
  }
  return result;
}

function frameFromCorner(anchorX, anchorY, signX, signY, pointerX, pointerY, aspect, imgL, imgT, imgR, imgB) {
  let dx = pointerX - anchorX;
  let dy = pointerY - anchorY;
  if (signX < 0) dx = Math.min(0, dx);
  else dx = Math.max(0, dx);
  if (signY < 0) dy = Math.min(0, dy);
  else dy = Math.max(0, dy);
  const minW = Math.max(1, signX < 0 ? anchorX - imgL : imgR - anchorX);
  const minH = Math.max(1, signY < 0 ? anchorY - imgT : imgB - anchorY);
  let width = Math.max(minW, Math.abs(dx));
  let height = Math.max(minH, Math.abs(dy));
  if (aspect) {
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    if (width < minW) {
      width = minW;
      height = width / aspect;
    }
    if (height < minH) {
      height = minH;
      width = height * aspect;
    }
  }
  const x = signX < 0 ? anchorX - width : anchorX;
  const y = signY < 0 ? anchorY - height : anchorY;
  return {
    left: Math.max(0, Math.round(imgL - x)),
    top: Math.max(0, Math.round(imgT - y)),
    right: Math.max(0, Math.round(x + width - imgR)),
    bottom: Math.max(0, Math.round(y + height - imgB)),
  };
}

function fillHoles(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index] || mask[index]) return;
    seen[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index] && !seen[index]) mask[index] = 1;
  }
}

function editorAnnotation(key) {
  const [kind, subfolder, ...rest] = String(key || "").split("|");
  const filename = rest.join("|");
  if (!clipspacePaintName(filename)) return "";
  const path = subfolder ? `${subfolder}/${filename}` : filename;
  return `${path} [${kind || "input"}]`;
}

function clipspacePaintName(filename) {
  const match = String(filename || "").match(/clipspace-painted(?:-masked)?-(\d+)\.png$/i);
  return match ? `clipspace-paint-${match[1]}.png` : "";
}

function isClipspaceFile(filename) {
  return /clipspace-(?:painted(?:-masked)?|paint)-\d+\.png$/i.test(String(filename || ""));
}

function filenameFromUrl(src) {
  try {
    const url = new URL(src, window.location.origin);
    return {
      filename: url.searchParams.get("filename") || "",
      type: url.searchParams.get("type") || "input",
      subfolder: url.searchParams.get("subfolder") || "",
    };
  } catch {
    return null;
  }
}

function parseAnnotated(value) {
  let raw = String(value || "").trim().replaceAll("\\", "/");
  if (!raw) return null;
  const annotated = raw.match(/\[(input|output|temp)\]\s*$/);
  const kind = annotated?.[1] || "input";
  if (annotated) raw = raw.slice(0, annotated.index).trim();
  const parts = raw.split("/");
  const filename = parts.pop();
  if (!filename) return null;
  return { filename, type: kind, subfolder: parts.join("/") };
}

function shiftPads(start, dx, dy) {
  const sumX = start.left + start.right;
  const sumY = start.top + start.bottom;
  const left = Math.max(0, Math.min(sumX, Math.round(start.left + dx)));
  const top = Math.max(0, Math.min(sumY, Math.round(start.top + dy)));
  return { left, right: sumX - left, top, bottom: sumY - top };
}

function imageUrl(filename, type = "input", subfolder = "") {
  const params = new URLSearchParams({ filename: String(filename || ""), type, rand: String(Date.now()) });
  if (subfolder) params.set("subfolder", subfolder);
  return api.apiURL(`/view?${params}`);
}

function graphLink(id) {
  if (id == null) return null;
  const graph = app.graph;
  if (!graph) return null;
  if (typeof graph.getLink === "function") {
    const found = graph.getLink(id);
    if (found) return found;
  }
  const links = graph.links;
  if (!links) return null;
  if (typeof links.get === "function") return links.get(id) ?? links.get(Number(id)) ?? links.get(String(id)) ?? null;
  return links[id] ?? links[String(id)] ?? null;
}

function fileFromWidget(value) {
  if (value == null || value === "" || value === "无") return null;
  if (typeof value === "object") {
    const filename = String(value.filename || value.name || "").replaceAll("\\", "/").split("/").pop();
    if (!filename) return null;
    return { filename, type: value.type || "input", subfolder: value.subfolder || "" };
  }
  return parseAnnotated(value);
}

function loaderInfo(node) {
  const input = node.inputs?.find((item) => item.name === "图像" || item.label === "图像");
  const link = graphLink(input?.link);
  const originId = link?.origin_id ?? link?.originId;
  const upstream = originId == null ? null : app.graph?.getNodeById?.(originId);
  if (!upstream) return null;
  const source = upstream.widgets?.find((item) => ["image", "图像"].includes(item.name));
  const parsed = fileFromWidget(source?.value);
  if (parsed?.filename) {
    return {
      node: upstream,
      key: `${parsed.type}|${parsed.subfolder}|${parsed.filename}`,
      url: imageUrl(parsed.filename, parsed.type, parsed.subfolder),
    };
  }
  const shown = upstream.imgs?.[upstream.imageIndex || 0] || upstream.imgs?.[0];
  const src = shown?.currentSrc || shown?.src || "";
  const fromSrc = src && !src.startsWith("data:") ? filenameFromUrl(src) : null;
  if (fromSrc?.filename) {
    return { node: upstream, key: `${fromSrc.type}|${fromSrc.subfolder}|${fromSrc.filename}`, url: src };
  }
  return { node: upstream, key: "", url: null };
}

function loaderFileUrl(node) {
  const seen = new Set();
  const pending = [];
  const imageInput = node.inputs?.find((item) => item.name === "图像" || item.label === "图像");
  if (imageInput?.link != null) pending.push(imageInput.link);
  while (pending.length) {
    const link = graphLink(pending.shift());
    const originId = link?.origin_id ?? link?.originId;
    if (originId == null || seen.has(originId)) continue;
    seen.add(originId);
    const upstream = app.graph?.getNodeById?.(originId);
    if (!upstream) continue;
    const source = upstream.widgets?.find((item) => ["image", "图像"].includes(item.name));
    const parsed = fileFromWidget(source?.value);
    if (parsed?.filename && !isClipspaceFile(parsed.filename)) {
      return imageUrl(parsed.filename, parsed.type || "input", parsed.subfolder || "");
    }
    for (const item of upstream.inputs || []) {
      if (item?.link == null) continue;
      const type = String(item.type || "");
      const name = String(item.name || "");
      if (type === "IMAGE" || name === "图像" || name === "image" || name === "images") pending.push(item.link);
    }
  }
  return null;
}

function subscribeLoader(loader, notify) {
  if (!loader) return () => {};
  let subscription = loaderSubscriptions.get(loader);
  if (!subscription) {
    subscription = { listeners: new Set(), hooks: [] };
    const source = loader.widgets?.find((item) => ["image", "图像"].includes(item.name));
    for (const [owner, key] of [[source, "callback"], [loader, "onWidgetChanged"]]) {
      if (!owner) continue;
      const original = owner[key];
      const wrapped = function () {
        const result = original?.apply(this, arguments);
        for (const listener of subscription.listeners) listener();
        return result;
      };
      subscription.hooks.push({ owner, key, original, wrapped });
      owner[key] = wrapped;
    }
    loaderSubscriptions.set(loader, subscription);
  }
  subscription.listeners.add(notify);
  return () => {
    subscription.listeners.delete(notify);
    if (subscription.listeners.size) return;
    for (const { owner, key, original, wrapped } of subscription.hooks) {
      if (owner[key] === wrapped) owner[key] = original;
    }
    loaderSubscriptions.delete(loader);
  };
}

async function loadUpstreamPreview(node, signal) {
  const { output } = await app.graphToPrompt();
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const imageInput = output?.[String(node.id)]?.inputs?.["图像"];
  if (!Array.isArray(imageInput) || imageInput.length < 2 || !output[String(imageInput[0])]) {
    throw new Error("请先连接图像");
  }
  const prompt = {};
  const include = (id) => {
    id = String(id);
    if (prompt[id]) return;
    const entry = output[id];
    if (!entry) throw new Error("找不到上游节点");
    prompt[id] = entry;
    for (const value of Object.values(entry.inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && output[String(value[0])]) include(value[0]);
    }
  };
  include(imageInput[0]);
  const target = `feimao_board_preview_${crypto.randomUUID()}`;
  prompt[target] = { class_type: "PreviewImage", inputs: { images: imageInput } };
  const listeners = [];
  let settled = false;
  let finish = null;
  const cleanup = () => {
    for (const [type, fn] of listeners) api.removeEventListener(type, fn);
    signal.removeEventListener("abort", onAbort);
  };
  const onAbort = () => finish?.(null, new DOMException("aborted", "AbortError"));
  const done = new Promise((resolve, reject) => {
    finish = (url, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(url);
    };
  });
  signal.addEventListener("abort", onAbort, { once: true });
  const listen = (type, fn) => {
    listeners.push([type, fn]);
    api.addEventListener(type, fn);
  };
  let promptId = "";
  const deliver = (images) => {
    const ref = images?.[0];
    if (!ref?.filename) return;
    finish(imageUrl(ref.filename, ref.type || "temp", ref.subfolder || ""));
  };
  listen("executed", (event) => {
    if (String(event.detail?.node) === target) deliver(event.detail.output?.images);
  });
  listen("execution_success", async (event) => {
    if (!promptId || event.detail?.prompt_id !== promptId || settled) return;
    try {
      const response = await api.fetchApi(`/history/${encodeURIComponent(promptId)}`, { signal });
      if (!response.ok) throw new Error("读取预览结果失败");
      const history = await response.json();
      const images = history[promptId]?.outputs?.[target]?.images;
      if (!images?.length) throw new Error("上游没有返回图像");
      deliver(images);
    } catch (error) {
      finish(null, error);
    }
  });
  for (const type of ["execution_error", "execution_interrupted"]) {
    listen(type, (event) => {
      if (!promptId || event.detail?.prompt_id !== promptId) return;
      finish(null, new Error(event.detail?.exception_message || "上游执行已中断"));
    });
  }
  try {
    const response = await api.fetchApi("/prompt", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        client_id: api.clientId || api.initialClientId || "",
        partial_execution_targets: [target],
      }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error?.message || "预览任务提交失败");
    promptId = result.prompt_id;
  } catch (error) {
    finish(null, error);
  }
  return done;
}

function createBoard(node) {
  const root = document.createElement("div");
  root.className = "feimao-board";
  root.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;min-height:360px;box-sizing:border-box;color:#d5dbe3;font:12px/1.4 sans-serif;user-select:none;gap:6px;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;flex:0 0 auto;flex-wrap:wrap;gap:6px;align-items:center;";
  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.textContent = "加载";
  loadBtn.title = "加载图像节点上的原图";
  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.textContent = "默认";
  restoreBtn.title = "清除全部遮罩，保持当前模式";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "清除遮罩";
  clearBtn.title = "清空遮罩编辑器、矩形、圆形和画笔";
  const rectBtn = document.createElement("button");
  rectBtn.type = "button";
  rectBtn.textContent = "矩形";
  rectBtn.title = "拖出矩形。按住 Shift 加选，按住 Alt 减选";
  const ellipseBtn = document.createElement("button");
  ellipseBtn.type = "button";
  ellipseBtn.textContent = "圆形";
  ellipseBtn.title = "在预览上拖出一个圆形遮罩";
  const brushBtn = document.createElement("button");
  brushBtn.type = "button";
  brushBtn.textContent = "画笔";
  brushBtn.title = "在预览上按住拖动，画出遮罩";
  const eraserBtn = document.createElement("button");
  eraserBtn.type = "button";
  eraserBtn.textContent = "橡皮";
  eraserBtn.title = "按住拖动，擦掉遮罩";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = "#0000ff";
  colorInput.title = "取色。选中的颜色会作为外补颜色或遮罩颜色";
  colorInput.style.cssText = "width:28px;height:28px;padding:0;border:1px solid #59616d;border-radius:4px;background:#171b22;cursor:pointer;";
  for (const button of [loadBtn, restoreBtn, clearBtn, rectBtn, ellipseBtn, brushBtn, eraserBtn]) {
    button.style.cssText = "flex:0 0 auto;white-space:nowrap;background:#30343c;color:#e8eef7;border:1px solid #59616d;border-radius:4px;padding:4px 10px;font:inherit;cursor:pointer;";
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("keydown", (event) => event.stopPropagation());
  }
  clearBtn.style.display = "none";
  rectBtn.style.display = "none";
  ellipseBtn.style.display = "none";
  brushBtn.style.display = "none";
  eraserBtn.style.display = "none";
  const toolRow = document.createElement("div");
  toolRow.style.cssText = "display:none;flex:0 0 auto;flex-direction:column;align-items:stretch;gap:4px;width:100%;";
  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = "画笔大小";
  sizeLabel.style.cssText = "flex:0 0 56px;";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "2";
  sizeInput.max = "512";
  sizeInput.step = "1";
  sizeInput.value = "32";
  sizeInput.title = "画笔直径，按原图像素计算";
  sizeInput.style.cssText = "flex:1 1 auto;width:auto;min-width:0;accent-color:#3d6ad6;";
  const sizeValue = document.createElement("span");
  sizeValue.textContent = "32px";
  sizeValue.style.cssText = "flex:0 0 42px;color:#d5dbe3;";
  const brushLine = document.createElement("div");
  brushLine.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;min-width:0;";
  brushLine.append(sizeLabel, sizeInput, sizeValue);
  const eraserLabel = document.createElement("span");
  eraserLabel.textContent = "橡皮大小";
  eraserLabel.style.cssText = "flex:0 0 56px;";
  const eraserInput = document.createElement("input");
  eraserInput.type = "range";
  eraserInput.min = "2";
  eraserInput.max = "512";
  eraserInput.step = "1";
  eraserInput.value = "32";
  eraserInput.title = "橡皮直径，按原图像素计算";
  eraserInput.style.cssText = "flex:1 1 auto;width:auto;min-width:0;accent-color:#3d6ad6;";
  const eraserValue = document.createElement("span");
  eraserValue.textContent = "32px";
  eraserValue.style.cssText = "flex:0 0 42px;color:#d5dbe3;";
  const eraserLine = document.createElement("div");
  eraserLine.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;min-width:0;";
  eraserLine.append(eraserLabel, eraserInput, eraserValue);
  toolRow.append(brushLine, eraserLine);
  toolRow.addEventListener("pointerdown", (event) => event.stopPropagation());
  const statusEl = document.createElement("div");
  statusEl.style.cssText = "color:#9aa4af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  bar.append(loadBtn, restoreBtn, colorInput, clearBtn, rectBtn, ellipseBtn, brushBtn, eraserBtn);
  const viewport = document.createElement("div");
  viewport.style.cssText = "position:relative;flex:1 1 auto;min-height:220px;overflow:hidden;background:#171b22;border:1px solid #59616d;border-radius:4px;cursor:default;touch-action:none;";
  viewport.title = "外补：拖四角改画框，拖原图移动，滚轮缩放。遮罩：矩形、圆形或画笔。画笔大小在上方。空白处拖动平移，滚轮放大画面，双击打开遮罩编辑器。";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  viewport.append(canvas);
  const foot = document.createElement("div");
  foot.style.cssText = "flex:0 0 auto;";
  const sizeEl = document.createElement("div");
  sizeEl.style.cssText = "font-size:14px;font-weight:600;color:#f2f5f8;";
  const metaEl = document.createElement("div");
  metaEl.style.cssText = "color:#9aa4af;margin-top:2px;";
  foot.append(statusEl, sizeEl, metaEl);
  root.append(toolRow, bar, viewport, foot);
  bar.addEventListener("pointerdown", (event) => event.stopPropagation());

  const dom = node.addDOMWidget("feimao_board_view", "feimao_board", root, {
    serialize: false,
    hideOnZoom: false,
  });
  dom.serialize = false;
  useDomLayout(dom, 420);

  const state = {
    image: null,
    mask: null,
    maskWidth: 0,
    maskHeight: 0,
    tint: null,
    tintKey: "",
    requestId: 0,
    writing: false,
    userEdited: false,
    baseline: null,
    baselineGen: 0,
    originKey: "",
    originValue: "",
    dragging: null,
    pointerMoved: false,
    shape: null,
    rects: [],
    draftRect: null,
    hoverRect: null,
    strokes: [],
    liveStroke: null,
    erasers: [],
    liveEraser: null,
    invertMask: false,
    eraserSize: 32,
    closeMask: false,
    brushSize: 32,
    brushBits: null,
    brushWidth: 0,
    brushHeight: 0,
    brushKey: "",
    brushView: null,
    brushViewKey: "",
    shapeTool: "",
    view: { zoom: 1, panX: 0, panY: 0 },
    picked: "",
    layout: null,
    disposed: false,
    loaderKey: "",
    loaderNodeId: null,
    controller: null,
    lastScale: null,
    maskButton: null,
    maskButtonShown: null,
  };

  function setStatus(text, isError = false) {
    statusEl.textContent = text || "";
    statusEl.style.color = isError ? "#ff8d8d" : "#9aa4af";
  }
  function numberValue(name) {
    const value = Number(widget(node, name)?.value);
    return Number.isFinite(value) ? value : 0;
  }
  function readPads() {
    return { left: numberValue("左"), right: numberValue("右"), top: numberValue("上"), bottom: numberValue("下") };
  }
  function presetName() {
    const value = String(widget(node, "预设")?.value || "自由");
    if (value === "自由" || value === "跟随参考图" || PRESET_PARTS[value]) return value;
    return "自由";
  }
  function modeName() {
    const value = widget(node, "模式")?.value;
    if (value === "遮罩" || value === "通用") return value;
    return "外补";
  }
  function customSizeOn() {
    return widget(node, "自定义尺寸")?.value === "开";
  }
  function generalOutputSize(width, height) {
    const preset = presetName();
    if (customSizeOn()) {
      return [
        Math.max(1, Math.round(numberValue("自定义宽") || 1)),
        Math.max(1, Math.round(numberValue("自定义高") || 1)),
      ];
    }
    const pair = PRESET_PARTS[preset];
    if (pair) return ratioOutputSize(numberValue("百万像素"), numberValue("倍数"), pair);
    if (preset === "跟随参考图") {
      return finalSize(Math.max(1, width || 1), Math.max(1, height || 1), numberValue("百万像素"), numberValue("倍数"));
    }
    const baseW = Math.max(1, width || 1);
    const baseH = Math.max(1, height || 1);
    if (widget(node, "走缩放")?.value === "关闭") return [baseW, baseH];
    return finalSize(baseW, baseH, numberValue("百万像素"), numberValue("倍数"));
  }
  function imageScale() {
    const value = Number(widget(node, "图像缩放")?.value);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  function scaledSize() {
    const [iw, ih] = imageSize();
    if (!iw || !ih) return [0, 0];
    return [Math.max(1, pyRound(iw * imageScale())), Math.max(1, pyRound(ih * imageScale()))];
  }
  function normalizeHex(value) {
    let raw = String(value || "").trim();
    if (!raw) return "";
    if (!raw.startsWith("#")) raw = `#${raw}`;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) raw = `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : "";
  }
  function padColor() {
    const name = widget(node, "外补颜色")?.value;
    if (name === "自动") return modeName() === "遮罩" ? autoSeamColor() : "#0000ff";
    if (name === "自定义") return normalizeHex(widget(node, "自定义颜色")?.value) || normalizeHex(state.picked) || "#0000ff";
    return COLOR_HEX[name] || "#0000ff";
  }
  function ensureCustomColorChoice() {
    const item = widget(node, "外补颜色");
    if (!item) return;
    const current = Array.isArray(item.options?.values) ? item.options.values.slice() : ["纯红", "纯绿", "纯蓝"];
    let changed = false;
    if (!current.includes("自动")) {
      const at = current.indexOf("自定义");
      if (at >= 0) current.splice(at, 0, "自动");
      else current.push("自动");
      changed = true;
    }
    if (!current.includes("自定义")) {
      current.push("自定义");
      changed = true;
    }
    if (changed) item.options = { ...(item.options || {}), values: current };
  }
  function imagePixels() {
    const img = state.image;
    const width = img?.naturalWidth || img?.width || 0;
    const height = img?.naturalHeight || img?.height || 0;
    if (!img || !width || !height) return null;
    if (state.pixels && state.pixelsImage === img && state.pixelsWidth === width) return state.pixels;
    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    offCtx.drawImage(img, 0, 0, width, height);
    let data;
    try {
      data = offCtx.getImageData(0, 0, width, height).data;
    } catch (_) {
      return null;
    }
    state.pixels = data;
    state.pixelsImage = img;
    state.pixelsWidth = width;
    return data;
  }
  function autoSeamColor() {
    const shape = state.shape;
    let sig = 0;
    if (state.mask) {
      const step = Math.max(1, Math.floor(state.mask.length / 64));
      for (let index = 0; index < state.mask.length; index += step) sig = (sig + state.mask[index] * (index + 1)) % 1000003;
    }
    let strokeSig = state.closeMask ? 1 : 0;
    for (const stroke of state.strokes || []) {
      const last = stroke.pts?.[stroke.pts.length - 1];
      strokeSig = (strokeSig + stroke.pts.length * 17 + Math.round((stroke.r || 0) * 10000)) % 1000003;
      if (last) strokeSig = (strokeSig + Math.round(last[0] * 1000) + Math.round(last[1] * 1000)) % 1000003;
    }
    let rectSig = 0;
    for (const rect of state.rects || []) {
      rectSig = (rectSig * 33 + (rect.op === "sub" ? 2 : 1) + Math.round(rect.x * 1000) + Math.round(rect.y * 1000) + Math.round(rect.w * 1000) + Math.round(rect.h * 1000)) % 1000003;
    }
    const key = `${state.image?.src || ""}|${state.maskWidth}x${state.maskHeight}:${state.maskCount}:${sig}|${shape ? `${shape.kind}:${shape.x}:${shape.y}:${shape.w}:${shape.h}` : ""}|${rectSig}|${strokeSig}`;
    if (state.autoColorKey === key && state.autoColor) return state.autoColor;
    state.autoColorKey = key;
    state.autoColor = sampleLeftSeam() || "#0000ff";
    return state.autoColor;
  }
  function sampleLeftSeam() {
    const img = state.image;
    const width = img?.naturalWidth || img?.width || 0;
    const height = img?.naturalHeight || img?.height || 0;
    const pixels = imagePixels();
    const mask = state.mask;
    if (!pixels || !width || !height) return "";
    if (!(state.maskCount > 0) && !state.shape && !(state.rects || []).length && !(state.strokes || []).length && !(state.erasers || []).length && !state.invertMask) return "";
    ensureBrushBits();
    ensureEraserBits();
    const same = mask && state.maskWidth === width && state.maskHeight === height;
    const shape = state.shape;
    const shapeX0 = shape ? Math.max(0, Math.floor(shape.x * width)) : width;
    const shapeX1 = shape ? Math.min(width, Math.ceil((shape.x + shape.w) * width)) : 0;
    const shapeY0 = shape ? Math.max(0, Math.floor(shape.y * height)) : 0;
    const shapeY1 = shape ? Math.min(height, Math.ceil((shape.y + shape.h) * height)) : 0;
    const covered = (x, y) => {
      let on = false;
      if (same && mask[y * width + x]) on = true;
      else if (!same && mask && state.maskWidth > 0 && state.maskHeight > 0) {
        const mx = Math.min(state.maskWidth - 1, Math.floor((x * state.maskWidth) / width));
        const my = Math.min(state.maskHeight - 1, Math.floor((y * state.maskHeight) / height));
        if (mask[my * state.maskWidth + mx]) on = true;
      }
      if (state.brushBits && state.brushWidth === width && state.brushHeight === height && state.brushBits[y * width + x]) on = true;
      let shapeOn = false;
      if (shape?.kind === "ellipse" && x >= shapeX0 && x < shapeX1 && y >= shapeY0 && y < shapeY1) {
        const x0 = shape.x * width;
        const x1 = (shape.x + shape.w) * width;
        const y0 = shape.y * height;
        const y1 = (shape.y + shape.h) * height;
        const rx = Math.max((x1 - x0) * 0.5, 1e-4);
        const ry = Math.max((y1 - y0) * 0.5, 1e-4);
        const dx = (x - (x0 + x1) * 0.5) / rx;
        const dy = (y - (y0 + y1) * 0.5) / ry;
        shapeOn = dx * dx + dy * dy <= 1;
      }
      const rects = state.draftRect?.replace ? [state.draftRect] : (state.draftRect ? (state.rects || []).concat([state.draftRect]) : (state.rects || []));
      if (state.draftRect?.replace) shapeOn = false;
      for (const rect of rects) {
        const x0 = rect.x * width;
        const x1 = (rect.x + rect.w) * width;
        const y0 = rect.y * height;
        const y1 = (rect.y + rect.h) * height;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) shapeOn = rect.op !== "sub";
      }
      on = on || shapeOn;
      if (state.invertMask) on = !on;
      if (state.eraserBits && state.eraserWidth === width && state.eraserHeight === height && state.eraserBits[y * width + x]) on = false;
      return on;
    };
    let minX = shape ? shapeX0 : width;
    for (const rect of state.rects || []) {
      if (rect.op === "sub") continue;
      minX = Math.min(minX, Math.max(0, Math.floor(rect.x * width)));
    }
    for (let x = 0; x < width; x++) {
      if (!state.invertMask && x < minX && !mask && !state.brushBits) continue;
      const picked = [];
      for (let y = 0; y < height; y++) {
        if (!covered(x, y)) continue;
        const left = x > 0 && !covered(x - 1, y);
        const up = y > 0 && !covered(x, y - 1);
        const down = y + 1 < height && !covered(x, y + 1);
        const right = x + 1 < width && !covered(x + 1, y);
        let sx = x;
        let sy = y;
        if (left) sx = x - 1;
        else if (up) sy = y - 1;
        else if (down) sy = y + 1;
        else if (right) sx = x + 1;
        else continue;
        const offset = (sy * width + sx) * 4;
        picked.push([y, pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
      }
      if (!picked.length) continue;
      picked.sort((a, b) => a[0] - b[0]);
      const mid = picked[Math.floor(picked.length / 2)];
      const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
      return `#${part(mid[1])}${part(mid[2])}${part(mid[3])}`;
    }
    return "";
  }
  function round4(value) {
    return Math.round(Number(value) * 10000) / 10000;
  }
  function readStrokes(items) {
    const strokes = [];
    if (!Array.isArray(items)) return strokes;
    for (const item of items) {
      const radius = Number(item?.r);
      if (!(radius > 0) || !Array.isArray(item?.pts)) continue;
      const pts = [];
      for (const pt of item.pts) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const x = Number(pt[0]);
        const y = Number(pt[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pts.push([clamp(x, 0, 1), clamp(y, 0, 1)]);
      }
      if (pts.length) strokes.push({ r: Math.min(radius, 2), pts });
    }
    return strokes;
  }
  function rectRecord(item, op = "add") {
    const shape = clampShape({ kind: "rect", x: Number(item?.x), y: Number(item?.y), w: Number(item?.w), h: Number(item?.h) });
    if (!(shape.w > 0.01 && shape.h > 0.01)) return null;
    return { op: op === "sub" || item?.op === "sub" ? "sub" : "add", x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  function parseMarkup(text) {
    const empty = { shape: null, rects: [], strokes: [], erasers: [], close: false, size: 32, eraserSize: 32, invert: false };
    try {
      const data = JSON.parse(String(text || ""));
      if (!data || typeof data !== "object") return empty;
      const rects = [];
      if (Array.isArray(data.rects)) {
        for (const item of data.rects) {
          const rect = rectRecord(item, item?.op);
          if (rect) rects.push(rect);
        }
      }
      let shape = null;
      if (data.kind === "ellipse") {
        shape = clampShape({ kind: "ellipse", x: Number(data.x), y: Number(data.y), w: Number(data.w), h: Number(data.h) });
        if (!(shape.w > 0.01 && shape.h > 0.01)) shape = null;
      } else if (data.kind === "rect" && !rects.length) {
        const rect = rectRecord(data, "add");
        if (rect) rects.push(rect);
      }
      const strokes = readStrokes(data.strokes);
      const erasers = readStrokes(data.erasers);
      return {
        shape,
        rects,
        strokes,
        erasers,
        close: Boolean(data.close),
        size: clamp(Math.round(Number(data.size) || 32), 2, 512),
        eraserSize: clamp(Math.round(Number(data.eraserSize) || 32), 2, 512),
        invert: Boolean(data.invert),
      };
    } catch (_) {
      return empty;
    }
  }
  function loadMarkup() {
    const parsed = parseMarkup(widget(node, "框选")?.value);
    state.shape = parsed.shape;
    state.rects = parsed.rects;
    state.draftRect = null;
    state.strokes = parsed.strokes;
    state.erasers = parsed.erasers;
    const closeItem = widget(node, "遮罩闭合");
    const invertItem = widget(node, "遮罩反转");
    if (closeItem && parsed.close && closeItem.value !== "开") setWidgetValue("遮罩闭合", "开");
    if (invertItem && parsed.invert && invertItem.value !== "开") setWidgetValue("遮罩反转", "开");
    state.closeMask = closeItem ? closeItem.value === "开" : parsed.close;
    state.invertMask = invertItem ? invertItem.value === "开" : parsed.invert;
    state.eraserSize = parsed.eraserSize;
    state.brushSize = parsed.size;
    state.brushKey = "";
    state.brushBits = null;
    state.brushView = null;
    state.baseKey = "";
    state.finalKey = "";
    sizeInput.value = String(state.brushSize);
    sizeValue.textContent = `${state.brushSize}px`;
    eraserInput.value = String(state.eraserSize);
    eraserValue.textContent = `${state.eraserSize}px`;
  }
  function persistMarkup() {
    const doc = {};
    if (state.shape?.kind === "ellipse") {
      doc.kind = "ellipse";
      doc.x = round4(state.shape.x);
      doc.y = round4(state.shape.y);
      doc.w = round4(state.shape.w);
      doc.h = round4(state.shape.h);
    } else if (state.rects.length === 1 && state.rects[0].op !== "sub") {
      doc.kind = "rect";
      doc.x = round4(state.rects[0].x);
      doc.y = round4(state.rects[0].y);
      doc.w = round4(state.rects[0].w);
      doc.h = round4(state.rects[0].h);
    }
    if (state.rects.length) {
      doc.rects = state.rects.map((rect) => ({
        op: rect.op === "sub" ? "sub" : "add",
        x: round4(rect.x),
        y: round4(rect.y),
        w: round4(rect.w),
        h: round4(rect.h),
      }));
    }
    if (state.strokes.length) {
      doc.strokes = state.strokes.map((stroke) => ({
        r: round4(stroke.r),
        pts: stroke.pts.map(([x, y]) => [round4(x), round4(y)]),
      }));
    }
    if (state.erasers.length) {
      doc.erasers = state.erasers.map((stroke) => ({
        r: round4(stroke.r),
        pts: stroke.pts.map(([x, y]) => [round4(x), round4(y)]),
      }));
    }
    if (state.closeMask) doc.close = 1;
    if (state.invertMask) doc.invert = 1;
    if (state.brushSize && state.brushSize !== 32) doc.size = state.brushSize;
    if (state.eraserSize && state.eraserSize !== 32) doc.eraserSize = state.eraserSize;
    const text = Object.keys(doc).length ? JSON.stringify(doc) : "";
    state.writing = true;
    try {
      setWidgetValue("框选", text);
    } finally {
      state.writing = false;
    }
  }
  function writeShape(shape) {
    state.shape = shape?.kind === "ellipse" ? shape : null;
    if (shape?.kind === "rect") {
      const rect = rectRecord(shape, "add");
      state.rects = rect ? [rect] : [];
    }
    persistMarkup();
  }
  function writeRects(rects) {
    state.rects = rects;
    persistMarkup();
  }
  function clearMarkup() {
    state.shape = null;
    state.rects = [];
    state.draftRect = null;
    state.hoverRect = null;
    state.strokes = [];
    state.liveStroke = null;
    state.erasers = [];
    state.liveEraser = null;
    state.closeMask = false;
    state.invertMask = false;
    setWidgetValue("遮罩闭合", "关");
    setWidgetValue("遮罩反转", "关");
    state.brushKey = "";
    state.brushBits = null;
    state.brushView = null;
    state.baseKey = "";
    state.eraserKey = "";
    state.finalKey = "";
    persistMarkup();
  }
  function brushRadius() {
    const [width] = imageSize();
    return clamp(Number(state.brushSize) || 32, 2, 512) / Math.max(1, width || 1024);
  }
  function eraserRadius() {
    const [width] = imageSize();
    return clamp(Number(state.eraserSize) || 32, 2, 512) / Math.max(1, width || 1024);
  }
  function stampDisk(bits, width, height, cx, cy, rad) {
    const rad2 = rad * rad;
    const left = Math.max(0, Math.floor(cx - rad));
    const right = Math.min(width, Math.ceil(cx + rad) + 1);
    const top = Math.max(0, Math.floor(cy - rad));
    const bottom = Math.min(height, Math.ceil(cy + rad) + 1);
    for (let y = top; y < bottom; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      const row = y * width;
      for (let x = left; x < right; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy2 <= rad2) bits[row + x] = 1;
      }
    }
  }
  function fillClosed(bits, width, height) {
    const seen = new Uint8Array(width * height);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (seen[index] || bits[index]) return;
      seen[index] = 1;
      stack.push(index);
    };
    for (let x = 0; x < width; x++) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      push(0, y);
      push(width - 1, y);
    }
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = (index - x) / width;
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    for (let index = 0; index < bits.length; index++) {
      if (!bits[index] && !seen[index]) bits[index] = 1;
    }
  }
  function rasterStrokes(width, height, strokes, close) {
    const bits = new Uint8Array(width * height);
    for (const stroke of strokes) {
      const rad = Math.max(0.5, stroke.r * width);
      const coords = [[stroke.pts[0][0] * width, stroke.pts[0][1] * height]];
      for (let index = 1; index < stroke.pts.length; index++) {
        const x0 = stroke.pts[index - 1][0] * width;
        const y0 = stroke.pts[index - 1][1] * height;
        const x1 = stroke.pts[index][0] * width;
        const y1 = stroke.pts[index][1] * height;
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(dist / Math.max(0.75, rad * 0.45)));
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          coords.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
        }
      }
      for (const [cx, cy] of coords) stampDisk(bits, width, height, cx, cy, rad);
    }
    if (close) fillClosed(bits, width, height);
    return bits;
  }
  function ensureBrushBits() {
    const [width, height] = imageSize();
    if (!width || !height || !state.strokes.length) {
      state.brushBits = null;
      state.brushWidth = 0;
      state.brushHeight = 0;
      return null;
    }
    let sig = state.closeMask ? 1 : 0;
    for (const stroke of state.strokes) {
      const first = stroke.pts[0];
      const last = stroke.pts[stroke.pts.length - 1];
      sig = (sig * 33 + stroke.pts.length + Math.round((stroke.r || 0) * 10000)) % 10000019;
      sig = (sig + Math.round(first[0] * 10000) + Math.round(first[1] * 10000) + Math.round(last[0] * 10000) + Math.round(last[1] * 10000)) % 10000019;
    }
    const key = `${width}x${height}|${sig}`;
    if (state.brushKey === key && state.brushBits) return state.brushBits;
    state.brushBits = rasterStrokes(width, height, state.strokes, state.closeMask);
    state.brushWidth = width;
    state.brushHeight = height;
    state.brushKey = key;
    state.brushView = null;
    state.brushViewKey = "";
    return state.brushBits;
  }
  function brushView(color) {
    const bits = ensureBrushBits();
    if (!bits) return null;
    const key = `${state.brushKey}|${color}`;
    if (state.brushViewKey === key && state.brushView) return state.brushView;
    const view = document.createElement("canvas");
    view.width = state.brushWidth;
    view.height = state.brushHeight;
    const ctx = view.getContext("2d");
    const image = ctx.createImageData(state.brushWidth, state.brushHeight);
    const [red, green, blue] = hexRgb(color);
    const data = image.data;
    for (let index = 0; index < bits.length; index++) {
      if (!bits[index]) continue;
      const offset = index * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 115;
    }
    ctx.putImageData(image, 0, 0);
    state.brushView = view;
    state.brushViewKey = key;
    return view;
  }
  function commitStroke() {
    const stroke = state.liveStroke;
    state.liveStroke = null;
    if (!stroke?.pts?.length) return;
    state.strokes.push(stroke);
    state.brushKey = "";
    state.baseKey = "";
    persistMarkup();
  }
  function commitEraser() {
    const stroke = state.liveEraser;
    state.liveEraser = null;
    if (!stroke?.pts?.length) return;
    state.erasers.push(stroke);
    state.eraserKey = "";
    state.finalKey = "";
    persistMarkup();
  }
  function paintSpan(bits, width, height, x0, x1, y0, y1, value) {
    const left = Math.max(0, Math.ceil(x0 - 1e-9));
    const right = Math.min(width, Math.ceil(x1 - 1e-9));
    const top = Math.max(0, Math.ceil(y0 - 1e-9));
    const bottom = Math.min(height, Math.ceil(y1 - 1e-9));
    for (let y = top; y < bottom; y++) {
      const row = y * width;
      for (let x = left; x < right; x++) bits[row + x] = value;
    }
  }
  function paintEllipseBits(bits, width, height, shape) {
    const x0 = shape.x * width;
    const x1 = (shape.x + shape.w) * width;
    const y0 = shape.y * height;
    const y1 = (shape.y + shape.h) * height;
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const rx = Math.max((x1 - x0) * 0.5, 1e-4);
    const ry = Math.max((y1 - y0) * 0.5, 1e-4);
    const left = Math.max(0, Math.floor(x0));
    const right = Math.min(width, Math.ceil(x1));
    const top = Math.max(0, Math.floor(y0));
    const bottom = Math.min(height, Math.ceil(y1));
    for (let y = top; y < bottom; y++) {
      const dy = (y - cy) / ry;
      const row = y * width;
      for (let x = left; x < right; x++) {
        const dx = (x - cx) / rx;
        if (dx * dx + dy * dy <= 1) bits[row + x] = 1;
      }
    }
  }
  function ensureEraserBits() {
    const [width, height] = imageSize();
    if (!width || !height || !state.erasers.length) {
      state.eraserBits = null;
      state.eraserWidth = 0;
      state.eraserHeight = 0;
      return null;
    }
    const last = state.erasers[state.erasers.length - 1];
    const key = `${width}x${height}|${state.erasers.length}|${last.pts.length}|${Math.round(last.r * 10000)}|${Math.round(last.pts[0][0] * 1000)}|${Math.round(last.pts[last.pts.length - 1][1] * 1000)}`;
    if (state.eraserKey === key && state.eraserBits) return state.eraserBits;
    state.eraserBits = rasterStrokes(width, height, state.erasers, false);
    state.eraserWidth = width;
    state.eraserHeight = height;
    state.eraserKey = key;
    state.finalKey = "";
    return state.eraserBits;
  }
  function ensureBaseBits() {
    const [width, height] = imageSize();
    if (!width || !height) return null;
    ensureBrushBits();
    const shape = state.shape;
    const draft = state.draftRect;
    const rectSig = (state.rects || []).map((rect) => `${rect.op}:${rect.x}:${rect.y}:${rect.w}:${rect.h}`).join(",");
    const key = `${width}x${height}|${state.maskCount}|${state.maskWidth}x${state.maskHeight}|${state.brushKey}|${shape ? `${shape.kind}:${shape.x}:${shape.y}:${shape.w}:${shape.h}` : ""}|${rectSig}|${draft ? `${draft.op}:${draft.x}:${draft.y}:${draft.w}:${draft.h}:${draft.replace ? 1 : 0}` : ""}`;
    if (state.baseKey === key && state.baseBits) return state.baseBits;
    const bits = new Uint8Array(width * height);
    if (state.mask && state.maskCount && state.maskWidth && state.maskHeight) {
      for (let y = 0; y < height; y++) {
        const my = Math.min(state.maskHeight - 1, Math.floor((y * state.maskHeight) / height));
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const mx = Math.min(state.maskWidth - 1, Math.floor((x * state.maskWidth) / width));
          if (state.mask[my * state.maskWidth + mx]) bits[row + x] = 1;
        }
      }
    }
    const shapeBits = new Uint8Array(width * height);
    for (const item of selectionList()) {
      if (item.kind === "ellipse") paintEllipseBits(shapeBits, width, height, item);
      else paintSpan(shapeBits, width, height, item.x * width, (item.x + item.w) * width, item.y * height, (item.y + item.h) * height, item.op === "sub" ? 0 : 1);
    }
    const brush = state.brushBits;
    for (let index = 0; index < bits.length; index++) {
      if (shapeBits[index] || (brush && state.brushWidth === width && brush[index])) bits[index] = 1;
    }
    state.baseBits = bits;
    state.baseKey = key;
    state.finalKey = "";
    return bits;
  }
  function ensureFinalView(color) {
    const base = ensureBaseBits();
    const [width, height] = imageSize();
    if (!base || !width || !height) return null;
    const eraser = ensureEraserBits();
    const key = `${state.baseKey}|${state.eraserKey || ""}|${state.invertMask ? 1 : 0}|${color}`;
    if (state.finalKey === key && state.finalView) return state.finalView;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const off = canvas.getContext("2d");
    const image = off.createImageData(width, height);
    const [red, green, blue] = hexRgb(color);
    const data = image.data;
    let any = false;
    for (let index = 0; index < base.length; index++) {
      let on = base[index] ? 1 : 0;
      if (state.invertMask) on = on ? 0 : 1;
      if (eraser && eraser[index]) on = 0;
      if (!on) continue;
      any = true;
      const offset = index * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 115;
    }
    if (!any) {
      state.finalView = null;
      state.finalKey = key;
      return null;
    }
    off.putImageData(image, 0, 0);
    state.finalView = canvas;
    state.finalKey = key;
    return canvas;
  }
  function paintScreenStroke(ctx, layout, stroke, mode, color) {
    if (!stroke?.pts?.length) return;
    const rad = Math.max(0.5, stroke.r * layout.totalW * layout.scale);
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = rad * 2;
    ctx.beginPath();
    stroke.pts.forEach(([nx, ny], index) => {
      const px = layout.x + nx * layout.totalW * layout.scale;
      const py = layout.y + ny * layout.totalH * layout.scale;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (stroke.pts.length === 1) {
      const px = layout.x + stroke.pts[0][0] * layout.totalW * layout.scale;
      const py = layout.y + stroke.pts[0][1] * layout.totalH * layout.scale;
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawMaskOverlay(ctx, layout) {
    const color = padColor();
    const view = ensureFinalView(color);
    const live = state.liveStroke;
    const erasing = state.liveEraser;
    if (!view && !live && !erasing) return;
    const width = Math.max(1, Math.round(viewport.clientWidth || layout.totalW));
    const height = Math.max(1, Math.round(viewport.clientHeight || layout.totalH));
    let scratch = state.overlayCanvas;
    if (!scratch || scratch.width !== width || scratch.height !== height) {
      scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      state.overlayCanvas = scratch;
    }
    const off = scratch.getContext("2d");
    off.clearRect(0, 0, width, height);
    off.globalCompositeOperation = "source-over";
    if (view) off.drawImage(view, layout.x, layout.y, layout.totalW * layout.scale, layout.totalH * layout.scale);
    const [red, green, blue] = hexRgb(color);
    if (live) paintScreenStroke(off, layout, live, state.invertMask ? "destination-out" : "source-over", `rgba(${red},${green},${blue},0.45)`);
    if (erasing) paintScreenStroke(off, layout, erasing, "destination-out", "#000");
    ctx.drawImage(scratch, 0, 0);
  }
  function clampShape(shape) {
    const w = clamp(Number(shape.w) || 0, 0.02, 1);
    const h = clamp(Number(shape.h) || 0, 0.02, 1);
    return {
      kind: shape.kind === "ellipse" ? "ellipse" : "rect",
      x: clamp(Number(shape.x) || 0, 0, 1 - w),
      y: clamp(Number(shape.y) || 0, 0, 1 - h),
      w,
      h,
    };
  }
  function imageSize() {
    return [state.image?.naturalWidth || state.image?.width || 0, state.image?.naturalHeight || state.image?.height || 0];
  }
  function writePads(pads) {
    state.writing = true;
    try {
      for (const [key, name] of Object.entries(SIDE_NAMES)) {
        const item = widget(node, name);
        if (!item) continue;
        const value = Math.max(0, Math.round(Number(pads[key]) || 0));
        item.value = value;
        if (item.inputEl) item.inputEl.value = String(value);
      }
    } finally {
      state.writing = false;
    }
  }
  function setWidgetValue(name, value) {
    const item = widget(node, name);
    if (!item) return;
    item.value = value;
    if (item.inputEl) item.inputEl.value = String(value);
  }
  function snapshot() {
    const saved = {};
    for (const name of BASELINE_KEYS) saved[name] = widget(node, name)?.value;
    saved.image = widget(node, "image")?.value ?? "";
    return saved;
  }
  function scheduleBaseline() {
    const gen = ++state.baselineGen;
    const capture = () => {
      if (state.disposed || state.userEdited || state.baselineGen !== gen) return;
      state.baseline = snapshot();
    };
    capture();
    requestAnimationFrame(() => requestAnimationFrame(capture));
  }
  function originUrl() {
    if (!state.originKey) return null;
    const [kind, subfolder, ...rest] = state.originKey.split("|");
    const filename = rest.join("|");
    if (!filename || isClipspaceFile(filename)) return null;
    return imageUrl(filename, kind || "input", subfolder);
  }
  function initialImageUrl() {
    const info = loaderInfo(node);
    const filename = String(info?.key || "").split("|").slice(2).join("|");
    if (info?.url && filename && !isClipspaceFile(filename)) return info.url;
    return originUrl() || loaderFileUrl(node);
  }
  function loadBoardImage() {
    const url = initialImageUrl();
    if (!url) {
      setStatus("没有找到图像加载节点上的原图", true);
      return Promise.resolve(false);
    }
    return setImage(url).then(() => {
      if (state.disposed) return false;
      const [width, height] = imageSize();
      setStatus(`已加载图像节点的原图 ${width}×${height}`);
      return true;
    });
  }
  function clearMask() {
    state.userEdited = true;
    clearMaskFile();
    state.tint = null;
    state.mask = null;
    state.maskCount = 0;
    state.maskError = "";
    state.liveStroke = null;
    clearMarkup();
    loadBoardImage().then((ok) => {
      if (!state.disposed && ok) setStatus("已清除遮罩");
    }).catch((error) => {
      if (!state.disposed) setStatus(error?.message || "图像预览加载失败", true);
    });
  }
  function restore() {
    if (modeName() === "外补") {
      state.userEdited = true;
      writePads({ left: 0, right: 0, top: 0, bottom: 0 });
      draw();
      setStatus("上下左右已归零");
      return;
    }
    clearMask();
  }
  function setWidgetShown(item, shown) {
    if (!item) return;
    const options = item.options || (item.options = {});
    const vis = item._visibility || item.visibility;
    if (shown) {
      options.hidden = false;
      try { item.hidden = false; } catch (_) {}
      if (item.__feimaoComputeSize) item.computeSize = item.__feimaoComputeSize;
      else delete item.computeSize;
      delete item.computeLayoutSize;
      if (vis) {
        try { vis.surfaces = { canvas: "shown", vueNode: "shown", panel: "shown" }; } catch (_) {}
      }
      return;
    }
    if (!item.__feimaoComputeSize && typeof item.computeSize === "function") item.__feimaoComputeSize = item.computeSize;
    options.hidden = true;
    try { item.hidden = true; } catch (_) {}
    item.computeSize = () => [0, -4];
    item.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    if (vis) {
      try { vis.surfaces = { canvas: "never", vueNode: "never", panel: "never" }; } catch (_) {}
    }
  }
  function syncColorLabel(maskMode) {
    const item = widget(node, "外补颜色");
    if (!item) return;
    const label = maskMode ? "遮罩颜色" : "外补颜色";
    const tip = maskMode ? "选自动时，取遮罩最左侧接缝外侧的颜色" : "外补区域涂成这里选中的颜色";
    if (item.__feimaoColorLabel !== `${label}|${tip}`) {
      item.__feimaoColorLabel = `${label}|${tip}`;
      try { item.label = label; } catch (_) {}
      if (item.options) item.options.tooltip = tip;
      item.tooltip = tip;
      const input = (node.inputs || []).find((entry) => entry?.widget?.name === "外补颜色" || entry?.name === "外补颜色");
      if (input) {
        input.label = label;
        input.localized_name = label;
      }
      node.setDirtyCanvas?.(true, true);
    }
  }
  function syncScaleLabel() {
    const item = widget(node, "走缩放");
    if (!item || item.__feimaoScaleLabel) return;
    item.__feimaoScaleLabel = true;
    try { item.label = "缩放"; } catch (_) {}
    item.localized_name = "缩放";
    const tip = "开启时，画完后再按百万像素缩放，并把宽高收到倍数。关闭时按画板当前宽高原样输出。";
    if (item.options) item.options.tooltip = tip;
    item.tooltip = tip;
    const input = (node.inputs || []).find((entry) => entry?.widget?.name === "走缩放" || entry?.name === "走缩放");
    if (input) {
      input.label = "缩放";
      input.localized_name = "缩放";
    }
  }
  function ensureRatioChoices() {
    const item = widget(node, "预设");
    if (!item) return;
    if (!item.__feimaoRatioFn) {
      item.__feimaoRatioFn = true;
      const options = item.options || (item.options = {});
      options.values = () => ratioChoices(modeName());
    }
    const select = item.inputEl;
    if (select?.tagName !== "SELECT") return;
    const choices = ratioChoices(modeName());
    const existing = Array.from(select.options).map((option) => option.value);
    if (existing.length === choices.length && existing.every((value, index) => value === choices[index])) return;
    select.replaceChildren(...choices.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      return option;
    }));
    if (choices.includes(String(item.value || ""))) select.value = String(item.value);
  }
  function syncRatioValue(mode) {
    ensureRatioChoices();
    const choices = ratioChoices(mode);
    const current = String(widget(node, "预设")?.value || "");
    state.ratioMemory = state.ratioMemory || {};
    const fallback = mode === "通用" ? "1:1" : "自由";
    if (!state.lastMode) {
      state.lastMode = mode;
      const next = choices.includes(current) ? current : fallback;
      if (next !== current) {
        state.writing = true;
        try { setWidgetValue("预设", next); } finally { state.writing = false; }
      }
      state.ratioMemory[mode] = next;
      return;
    }
    if (state.lastMode === mode) {
      if (choices.includes(current)) state.ratioMemory[mode] = current;
      return;
    }
    state.ratioMemory[state.lastMode] = current;
    const remembered = state.ratioMemory[mode];
    const next = remembered && choices.includes(remembered) ? remembered : fallback;
    if (next !== current) {
      state.writing = true;
      try { setWidgetValue("预设", next); } finally { state.writing = false; }
    }
    state.ratioMemory[mode] = next;
    state.lastMode = mode;
  }
  function syncRatioLabel(general) {
    const item = widget(node, "预设");
    if (!item) return;
    const label = "宽高比";
    const tip = general
      ? "只决定输出的宽和高，不裁切原图。跟随参考图按参考图自己的比例。要手填宽高，打开下面的自定义尺寸。"
      : "按这个比例调整外补画框，原图完整留在框内。自由不锁定比例。";
    if (item.__feimaoRatioLabel === `${label}|${tip}`) return;
    item.__feimaoRatioLabel = `${label}|${tip}`;
    try { item.label = label; } catch (_) {}
    item.localized_name = label;
    if (item.options) item.options.tooltip = tip;
    item.tooltip = tip;
    const input = (node.inputs || []).find((entry) => entry?.widget?.name === "预设" || entry?.name === "预设");
    if (input) {
      input.label = label;
      input.localized_name = label;
    }
  }
  function syncChrome() {
    const mode = modeName();
    const maskMode = mode === "遮罩";
    const general = mode === "通用";
    syncColorLabel(maskMode);
    syncScaleLabel();
    syncRatioValue(mode);
    syncRatioLabel(general);
    const closeItem = widget(node, "遮罩闭合");
    const invertItem = widget(node, "遮罩反转");
    if (closeItem) state.closeMask = closeItem.value === "开";
    if (invertItem) state.invertMask = invertItem.value === "开";
    const customOn = general && customSizeOn();
    for (const name of ["预设", "图像缩放", "左", "右", "上", "下", "羽化"]) {
      const item = widget(node, name);
      if (!item) continue;
      const disabled = maskMode || (customOn && name === "预设");
      item.disabled = disabled;
      if (item.inputEl) item.inputEl.disabled = disabled;
    }
    const scaleOff = customOn || (!general && widget(node, "走缩放")?.value === "关闭");
    for (const name of ["百万像素", "倍数"]) {
      const item = widget(node, name);
      if (!item) continue;
      item.disabled = scaleOff;
      if (item.inputEl) item.inputEl.disabled = scaleOff;
    }
    restoreBtn.style.display = general ? "none" : "";
    restoreBtn.title = modeName() === "外补" ? "把上下左右设为 0" : "清除全部遮罩，保持当前模式";
    colorInput.style.display = general ? "none" : "";
    clearBtn.style.display = maskMode ? "" : "none";
    rectBtn.style.display = maskMode ? "" : "none";
    ellipseBtn.style.display = maskMode ? "" : "none";
    brushBtn.style.display = maskMode ? "" : "none";
    eraserBtn.style.display = maskMode ? "" : "none";
    toolRow.style.display = maskMode ? "flex" : "none";
    viewport.title = general
      ? "通用：宽高比只决定输出的宽和高，不裁切原图。打开自定义尺寸后，改填宽度和高度。"
      : "外补：拖四角改画框，拖原图移动，滚轮缩放。遮罩：矩形、圆形或画笔。画笔大小在上方。空白处拖动平移，滚轮放大画面，双击打开遮罩编辑器。";
    rectBtn.style.background = state.shapeTool === "rect" ? "#3d6ad6" : "#30343c";
    ellipseBtn.style.background = state.shapeTool === "ellipse" ? "#3d6ad6" : "#30343c";
    brushBtn.style.background = state.shapeTool === "brush" ? "#3d6ad6" : "#30343c";
    eraserBtn.style.background = state.shapeTool === "eraser" ? "#3d6ad6" : "#30343c";
    let arrange = false;
    for (const name of ["外补颜色", "图像缩放", "左", "右", "上", "下", "羽化"]) {
      const item = widget(node, name);
      if (!item || item.__feimaoPadShown === !general) continue;
      item.__feimaoPadShown = !general;
      setWidgetShown(item, !general);
      arrange = true;
    }
    const showCustom = customOn;
    for (const [name, label] of [["自定义宽", "宽度"], ["自定义高", "高度"]]) {
      const item = widget(node, name);
      if (!item || item.__feimaoSizeLabel) continue;
      item.__feimaoSizeLabel = true;
      try { item.label = label; } catch (_) {}
      item.localized_name = label;
    }
    const sizeSwitch = widget(node, "自定义尺寸");
    if (sizeSwitch && sizeSwitch.__feimaoShown !== general) {
      sizeSwitch.__feimaoShown = general;
      setWidgetShown(sizeSwitch, general);
      arrange = true;
    }
    for (const name of ["自定义宽", "自定义高"]) {
      const item = widget(node, name);
      if (!item || item.__feimaoCustomShown === showCustom) continue;
      item.__feimaoCustomShown = showCustom;
      setWidgetShown(item, showCustom);
      arrange = true;
    }
    for (const name of ["遮罩闭合", "遮罩反转"]) {
      const item = widget(node, name);
      if (!item || item.__feimaoShown === maskMode) continue;
      item.__feimaoShown = maskMode;
      setWidgetShown(item, maskMode);
      arrange = true;
    }
    const swatch = padColor();
    if (colorInput.value.toLowerCase() !== swatch) colorInput.value = swatch;
    if (state.maskButton && state.maskButtonShown !== maskMode) {
      state.maskButtonShown = maskMode;
      setWidgetShown(state.maskButton, maskMode);
      arrange = true;
    }
    if (arrange && node.graph) {
      try { node.arrange?.(); } catch (_) {}
    }
  }
  function changeScale(next) {
    const [iw, ih] = imageSize();
    const prev = state.lastScale || imageScale();
    let scale = clamp(Number(next) || prev, 0.05, 8);
    if (iw > 0 && ih > 0) {
      const oldW = Math.max(1, pyRound(iw * prev));
      const oldH = Math.max(1, pyRound(ih * prev));
      const pads = readPads();
      const totalW = oldW + pads.left + pads.right;
      const totalH = oldH + pads.top + pads.bottom;
      scale = Math.min(scale, totalW / iw, totalH / ih);
      const newW = Math.max(1, pyRound(iw * scale));
      const newH = Math.max(1, pyRound(ih * scale));
      const cx = pads.left + oldW / 2;
      const cy = pads.top + oldH / 2;
      let left = Math.round(cx - newW / 2);
      let top = Math.round(cy - newH / 2);
      let right = totalW - left - newW;
      let bottom = totalH - top - newH;
      if (left < 0) {
        right += left;
        left = 0;
      }
      if (top < 0) {
        bottom += top;
        top = 0;
      }
      if (right < 0) {
        left = Math.max(0, left + right);
        right = 0;
      }
      if (bottom < 0) {
        top = Math.max(0, top + bottom);
        bottom = 0;
      }
      state.writing = true;
      try {
        setWidgetValue("图像缩放", Math.round(scale * 1000) / 1000);
        writePads({ left, right, top: Math.max(0, top), bottom: Math.max(0, bottom) });
      } finally {
        state.writing = false;
      }
    } else {
      setWidgetValue("图像缩放", Math.round(scale * 1000) / 1000);
    }
    state.lastScale = imageScale();
    draw();
  }
  function applyPreset() {
    const [imgW, imgH] = scaledSize();
    const name = presetName();
    if (!state.image || modeName() !== "外补" || name === "自由" || imgW <= 0 || imgH <= 0) {
      draw();
      return;
    }
    writePads(constrain({ left: 0, right: 0, top: 0, bottom: 0 }, imgW, imgH, name, []));
    draw();
    setStatus(`已按 ${name} 调整画框`);
  }
  function onWidget(name) {
    if (state.writing || state.disposed) return;
    state.userEdited = true;
    if (name === "模式") {
      state.tint = null;
      draw();
      return;
    }
    if (name === "预设") {
      applyPreset();
      return;
    }
    if (name === "图像缩放") {
      const next = imageScale();
      if (Math.abs(next - (state.lastScale || next)) > 1e-6) changeScale(next);
      else draw();
      return;
    }
    if (name === "外补颜色" || name === "自定义颜色") state.tint = null;
    if (name === "遮罩闭合" || name === "遮罩反转") {
      state.closeMask = widget(node, "遮罩闭合")?.value === "开";
      state.invertMask = widget(node, "遮罩反转")?.value === "开";
      state.brushKey = "";
      state.baseKey = "";
      state.finalKey = "";
      state.userEdited = true;
      persistMarkup();
      draw();
      return;
    }
    if (name === "走缩放") {
      draw();
      const scaleOff = widget(node, "走缩放")?.value === "关闭";
      const url = loaderFileUrl(node);
      if (url) {
        const maskFile = modeName() === "遮罩" ? parseAnnotated(widget(node, "image")?.value) : null;
        setImage(url, { maskFile }).then(() => {
          if (state.disposed) return;
          const [width, height] = imageSize();
          setStatus(scaleOff ? `已加载原图 ${width}×${height}` : `已加载上游图像 ${width}×${height}`);
        }).catch((error) => {
          if (!state.disposed) setStatus(error?.message || "图像预览加载失败", true);
        });
      }
      return;
    }
    const side = Object.keys(SIDE_NAMES).find((key) => SIDE_NAMES[key] === name);
    const [imgW, imgH] = scaledSize();
    if (side && state.image && modeName() === "外补" && presetName() !== "自由") {
      writePads(constrain(readPads(), imgW, imgH, presetName(), [side]));
    }
    draw();
  }
  function rememberEditorFile(value) {
    const item = widget(node, "image");
    if (!item || String(item.value || "") === value) return;
    state.writing = true;
    try {
      item.value = value;
      if (item.inputEl) item.inputEl.value = value;
    } finally {
      state.writing = false;
    }
  }
  function clearMaskFile() {
    const item = widget(node, "image");
    if (!item || !String(item.value || "").trim()) return;
    state.writing = true;
    try {
      item.value = "";
      if (item.inputEl) item.inputEl.value = "";
    } finally {
      state.writing = false;
    }
  }
  function onMaskFile() {
    if (state.writing || state.disposed) return;
    const parsed = parseAnnotated(widget(node, "image")?.value);
    if (!parsed) return;
    state.userEdited = true;
    setImage(imageUrl(parsed.filename, parsed.type, parsed.subfolder))
      .then(() => {
        if (!state.disposed) setStatus("遮罩已写入");
      })
      .catch((error) => {
        if (!state.disposed) setStatus(error?.message || "遮罩预览失败", true);
      });
  }
  function ensureMaskLink(loader) {
    const input = node.inputs?.find((item) => item.name === "遮罩");
    if (!input || input.link != null || !loader?.outputs) return;
    const slot = loader.outputs.findIndex((item) => item?.type === "MASK" || item?.name === "MASK" || item?.name === "遮罩");
    const inputIndex = node.inputs.indexOf(input);
    if (slot < 0 || inputIndex < 0) return;
    try {
      loader.connect(slot, node, inputIndex);
    } catch (_) {}
  }
  function launchEditor(target) {
    setStatus("正在打开遮罩编辑器");
    const run = () => {
      try { app.canvas?.deselectAll?.(); } catch (_) {}
      try { app.canvas?.selectNode?.(target); } catch (_) {}
      try {
        if (app.extensionManager?.command?.execute) {
          app.extensionManager.command.execute("Comfy.MaskEditor.OpenMaskEditor");
          return;
        }
      } catch (_) {}
      const open = app.open_maskeditor || app.constructor?.open_maskeditor;
      if (typeof open === "function") open.call(app);
      else setStatus("当前界面没有遮罩编辑器", true);
    };
    setTimeout(run, 80);
  }
  function openMaskEditor() {
    const info = loaderInfo(node);
    const loader = info?.node;
    if (loader) {
      if (!loader.imgs?.length && state.image) {
        loader.imgs = [state.image];
        loader.imageIndex = 0;
      }
      if (!loader.imgs?.length) {
        setStatus("加载图像节点上还没有图像", true);
        return;
      }
      ensureMaskLink(loader);
      launchEditor(loader);
      return;
    }
    if (!state.image) {
      setStatus("先加载图像，再打开遮罩编辑器", true);
      return;
    }
    const src = state.image.currentSrc || state.image.src || "";
    if (!src || src.startsWith("data:")) {
      setStatus("请从加载图像节点接入，才能保存遮罩", true);
      return;
    }
    node.imgs = [state.image];
    node.imageIndex = 0;
    launchEditor(node);
  }
  const maskButton = node.addWidget("button", "打开遮罩编辑器", "", () => openMaskEditor(), { serialize: false });
  maskButton.serialize = false;
  maskButton.__feimaoComputeSize = maskButton.computeSize;
  maskButton.tooltip = "像加载图像一样打开遮罩编辑器，涂完保存即可";
  state.maskButton = maskButton;
  const buttonIndex = node.widgets.indexOf(maskButton);
  if (buttonIndex >= 0) node.widgets.splice(buttonIndex, 1);
  const modeIndex = node.widgets.findIndex((item) => item.name === "模式");
  node.widgets.splice(modeIndex >= 0 ? modeIndex + 1 : node.widgets.length, 0, maskButton);

  function bindWidgets() {
    hideComfyWidget(widget(node, "image"), true);
    hideComfyWidget(widget(node, "自定义颜色"), true);
    hideComfyWidget(widget(node, "框选"), true);
    ensureCustomColorChoice();
    if (!state.writing) loadMarkup();
    for (const name of BASELINE_KEYS.concat(["自定义颜色", "走缩放", "遮罩闭合", "遮罩反转", "自定义宽", "自定义高", "自定义尺寸"])) {
      const item = widget(node, name);
      if (!item || item.__feimaoBoardBound) continue;
      item.__feimaoBoardBound = true;
      const previous = item.callback;
      item.callback = function () {
        const result = previous?.apply(this, arguments);
        onWidget(name);
        return result;
      };
    }
    const maskFile = widget(node, "image");
    if (maskFile && !maskFile.__feimaoMaskBound) {
      maskFile.__feimaoMaskBound = true;
      const previous = maskFile.callback;
      maskFile.callback = function () {
        const result = previous?.apply(this, arguments);
        onMaskFile();
        return result;
      };
    }
  }

  function drawFeather(ctx, layout, color) {
    if (state.dragging) return;
    const feather = Math.max(0, numberValue("羽化"));
    const { iw, ih, scale } = layout;
    if (feather <= 0 || feather * 2 >= iw || feather * 2 >= ih || scale <= 0) return;
    const imgW = Math.max(1, Math.round(iw * scale));
    const imgH = Math.max(1, Math.round(ih * scale));
    if (imgW * imgH > 700 * 700) return;
    const [red, green, blue] = hexRgb(color);
    const off = document.createElement("canvas");
    off.width = imgW;
    off.height = imgH;
    const offCtx = off.getContext("2d");
    const data = offCtx.createImageData(imgW, imgH);
    const pixels = data.data;
    const { left, right, top, bottom } = layout;
    for (let py = 0; py < imgH; py++) {
      const sy = (py + 0.5) / scale;
      const dt = top ? sy : ih;
      const db = bottom ? ih - sy : ih;
      for (let px = 0; px < imgW; px++) {
        const sx = (px + 0.5) / scale;
        const dl = left ? sx : iw;
        const dr = right ? iw - sx : iw;
        const distance = Math.min(dt, db, dl, dr);
        if (distance >= feather) continue;
        const fade = (feather - distance) / feather;
        const index = (py * imgW + px) * 4;
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
        pixels[index + 3] = Math.round(fade * fade * 255);
      }
    }
    offCtx.putImageData(data, 0, 0);
    ctx.drawImage(off, layout.x + left * scale, layout.y + top * scale, imgW, imgH);
  }

  function ensureTint() {
    if (!state.mask || !state.maskCount) return null;
    const key = `${state.maskWidth}x${state.maskHeight}:${padColor()}`;
    if (state.tint && state.tintKey === key) return state.tint;
    const off = document.createElement("canvas");
    off.width = state.maskWidth;
    off.height = state.maskHeight;
    const offCtx = off.getContext("2d");
    const data = offCtx.createImageData(state.maskWidth, state.maskHeight);
    const [red, green, blue] = hexRgb(padColor());
    const pixels = data.data;
    for (let index = 0; index < state.mask.length; index++) {
      if (!state.mask[index]) continue;
      const offset = index * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
    offCtx.putImageData(data, 0, 0);
    state.tint = off;
    state.tintKey = key;
    return off;
  }

  function viewFit(width, height, totalW, totalH) {
    const margin = 22;
    const availW = Math.max(1, width - margin * 2);
    const availH = Math.max(1, height - margin * 2);
    const fit = Math.min(availW / totalW, availH / totalH);
    const scale = fit * (state.view?.zoom || 1);
    return {
      scale,
      fit,
      x: (width - totalW * scale) / 2 + (state.view?.panX || 0),
      y: (height - totalH * scale) / 2 + (state.view?.panY || 0),
    };
  }
  function shapeBox(layout, shape) {
    return {
      x: layout.x + shape.x * layout.totalW * layout.scale,
      y: layout.y + shape.y * layout.totalH * layout.scale,
      w: shape.w * layout.totalW * layout.scale,
      h: shape.h * layout.totalH * layout.scale,
    };
  }
  function drawShape(ctx, layout, shape) {
    const box = shapeBox(layout, shape);
    ctx.save();
    ctx.beginPath();
    if (shape.kind === "ellipse") {
      ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, Math.max(0.5, Math.abs(box.w) / 2), Math.max(0.5, Math.abs(box.h) / 2), 0, 0, Math.PI * 2);
    } else {
      ctx.rect(box.x, box.y, box.w, box.h);
    }
    const [red, green, blue] = hexRgb(padColor());
    ctx.fillStyle = `rgba(${red},${green},${blue},0.45)`;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    for (const [cx, cy] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    }
    ctx.restore();
  }
  function selectionList() {
    if (state.draftRect?.replace) return [state.draftRect];
    const items = [];
    if (state.shape?.kind === "ellipse") items.push({ ...state.shape, op: "add" });
    for (const rect of state.rects) items.push(rect);
    if (state.draftRect) items.push(state.draftRect);
    return items;
  }
  function drawSelection(ctx, layout, paintFill = true) {
    const items = selectionList();
    if (!items.length) return;
    const width = Math.max(1, Math.ceil(layout.totalW * layout.scale));
    const height = Math.max(1, Math.ceil(layout.totalH * layout.scale));
    let off = state.selectionCanvas;
    if (!off || off.width !== width || off.height !== height) {
      off = document.createElement("canvas");
      off.width = width;
      off.height = height;
      state.selectionCanvas = off;
    }
    const offCtx = off.getContext("2d");
    offCtx.clearRect(0, 0, width, height);
    const [red, green, blue] = hexRgb(padColor());
    const scaleX = width / Math.max(layout.totalW, 1e-4);
    const scaleY = height / Math.max(layout.totalH, 1e-4);
    for (const item of items) {
      const box = shapeBox(layout, item);
      const x = (box.x - layout.x) * scaleX;
      const y = (box.y - layout.y) * scaleY;
      const w = box.w * scaleX;
      const h = box.h * scaleY;
      offCtx.globalCompositeOperation = item.op === "sub" ? "destination-out" : "source-over";
      offCtx.fillStyle = item.op === "sub" ? "#000" : `rgba(${red},${green},${blue},0.45)`;
      offCtx.beginPath();
      if (item.kind === "ellipse") offCtx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, Math.abs(w) / 2), Math.max(0.5, Math.abs(h) / 2), 0, 0, Math.PI * 2);
      else offCtx.rect(x, y, w, h);
      offCtx.fill();
    }
    if (paintFill) ctx.drawImage(off, layout.x, layout.y, layout.totalW * layout.scale, layout.totalH * layout.scale);
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const item of items) {
      const box = shapeBox(layout, item);
      ctx.beginPath();
      if (item.kind === "ellipse") ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, Math.max(0.5, Math.abs(box.w) / 2), Math.max(0.5, Math.abs(box.h) / 2), 0, 0, Math.PI * 2);
      else ctx.rect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = item.op === "sub" ? "#ffb4b4" : "#ffffff";
      ctx.setLineDash(item.op === "sub" ? [5, 4] : []);
      ctx.stroke();
    }
    const handle = !state.draftRect && state.dragging?.rectIndex != null
      ? state.rects[state.dragging.rectIndex]
      : !state.draftRect && state.hoverRect != null
        ? state.rects[state.hoverRect]
        : state.rects.length === 1 && !state.draftRect
          ? state.rects[0]
          : state.shape?.kind === "ellipse" && !state.rects.length && !state.draftRect
            ? state.shape
            : null;
    if (handle) {
      const box = shapeBox(layout, handle);
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffffff";
      for (const [cx, cy] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
      }
    }
    ctx.restore();
  }
  function drawLiveStroke(ctx, layout) {
    const stroke = state.liveStroke;
    if (!stroke?.pts?.length) return;
    const [red, green, blue] = hexRgb(padColor());
    const color = `rgba(${red},${green},${blue},0.45)`;
    const rad = Math.max(0.5, stroke.r * layout.totalW * layout.scale);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = rad * 2;
    ctx.beginPath();
    stroke.pts.forEach(([nx, ny], index) => {
      const px = layout.x + nx * layout.totalW * layout.scale;
      const py = layout.y + ny * layout.totalH * layout.scale;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (stroke.pts.length === 1) {
      const px = layout.x + stroke.pts[0][0] * layout.totalW * layout.scale;
      const py = layout.y + stroke.pts[0][1] * layout.totalH * layout.scale;
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    if (state.disposed) return;
    syncChrome();
    if (state.lastScale == null) state.lastScale = imageScale();
    const ctx = canvas.getContext("2d");
    const rect = viewport.getBoundingClientRect();
    const width = Math.max(1, viewport.clientWidth || rect.width);
    const height = Math.max(1, viewport.clientHeight || rect.height);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const [nativeW, nativeH] = imageSize();
    const mode = modeName();
    const maskMode = mode === "遮罩";
    const general = mode === "通用";
    const [imgW, imgH] = maskMode || general ? [nativeW, nativeH] : scaledSize();
    const pads = maskMode || general ? { left: 0, right: 0, top: 0, bottom: 0 } : readPads();
    if (!state.image || imgW <= 0 || imgH <= 0) {
      state.layout = null;
      ctx.fillStyle = "#9aa4af";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(general ? "点「加载」预览图像" : maskMode ? "点「加载」预览遮罩" : "点「加载」预览外补效果", width / 2, height / 2);
      if (general) {
        const [outW, outH] = generalOutputSize(0, 0);
        sizeEl.textContent = `输出尺寸  ${outW} × ${outH}`;
        metaEl.textContent = customSizeOn()
          ? "自定义尺寸已开，输出用填写的宽度和高度"
          : "宽高比、百万像素和倍数只决定输出的宽和高";
      } else {
        sizeEl.textContent = "实际尺寸  加载后显示";
        metaEl.textContent = maskMode ? "把模式设为遮罩后，点上边的「打开遮罩编辑器」" : "比例、缩放用上边的参数。拖四角改画框，拖原图移动位置";
      }
      return;
    }
    const totalW = imgW + pads.left + pads.right;
    const totalH = imgH + pads.top + pads.bottom;
    const margin = 22;
    const availW = Math.max(1, width - margin * 2);
    const availH = Math.max(1, height - margin * 2);
    const frozen = state.dragging?.kind && state.dragging.kind !== "pan" ? state.dragging.fit : null;
    const viewed = maskMode ? viewFit(width, height, totalW, totalH) : null;
    const scale = frozen ? frozen.scale : viewed ? viewed.scale : Math.min(availW / totalW, availH / totalH);
    const x = frozen ? frozen.x : viewed ? viewed.x : (width - totalW * scale) / 2;
    const y = frozen ? frozen.y : viewed ? viewed.y : (height - totalH * scale) / 2;
    const layout = { x, y, scale, iw: imgW, ih: imgH, totalW, totalH, ...pads };
    state.layout = layout;
    if (maskMode) {
      ctx.drawImage(state.image, x, y, totalW * scale, totalH * scale);
      drawMaskOverlay(ctx, layout);
      drawSelection(ctx, layout, false);
    } else if (general) {
      ctx.drawImage(state.image, x, y, totalW * scale, totalH * scale);
    } else {
      const color = padColor();
      ctx.fillStyle = color;
      ctx.fillRect(x, y, totalW * scale, totalH * scale);
      ctx.drawImage(state.image, x + pads.left * scale, y + pads.top * scale, imgW * scale, imgH * scale);
      drawFeather(ctx, layout, color);
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + pads.left * scale, y + pads.top * scale, imgW * scale, imgH * scale);
      ctx.strokeStyle = "#f4f7fb";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, totalW * scale, totalH * scale);
      drawHandles(ctx, layout, state.dragging?.corner);
      drawPadLabels(ctx, layout);
    }
    const [outW, outH] = general
      ? generalOutputSize(nativeW, nativeH)
      : widget(node, "走缩放")?.value === "关闭"
        ? [totalW, totalH]
        : finalSize(totalW, totalH, numberValue("百万像素"), numberValue("倍数"));
    sizeEl.textContent = general ? `输出尺寸  ${outW} × ${outH}` : `实际尺寸  ${outW} × ${outH}`;
    if (maskMode) {
      const shapeHint = state.shapeTool === "brush"
        ? "按住拖动即可画遮罩。取消画笔后，空白处可拖动平移"
        : state.shapeTool === "eraser"
          ? "按住拖动擦掉遮罩。橡皮大小在上方"
          : state.shapeTool === "rect"
          ? "拖出矩形。Shift 加选，Alt 减选。拖已有矩形可移动，拖四角缩放"
          : state.shape || state.rects.length
            ? "拖框移动，拖四角或在框上滚轮缩放"
            : "点矩形、圆形或画笔后在画面上绘制";
      const closeNote = state.closeMask ? "遮罩闭合已开，封闭区域会填满。" : "";
      const invertNote = state.invertMask ? "遮罩反转已开。" : "";
      const autoNote = widget(node, "外补颜色")?.value === "自动" ? `自动颜色 ${padColor()}。` : "";
      metaEl.textContent = state.maskError || `${autoNote}${closeNote}${invertNote}${shapeHint}。滚轮放大。双击打开遮罩编辑器`;
    } else if (general) {
      const ratio = presetName();
      metaEl.textContent = customSizeOn()
        ? `自定义尺寸输出 ${outW} × ${outH}。原图不按宽高比裁切`
        : `宽高比 ${ratio} 决定输出 ${outW} × ${outH}。原图不按宽高比裁切`;
    } else {
      metaEl.textContent = `画板 ${totalW} × ${totalH}  ·  原图 ${nativeW} × ${nativeH}  ·  参考图 ${Math.round(imageScale() * 100)}%`;
    }
  }

  function cornerScreen(name, layout) {
    const { x, y, scale, totalW, totalH } = layout;
    if (name === "tl") return [x, y];
    if (name === "tr") return [x + totalW * scale, y];
    if (name === "bl") return [x, y + totalH * scale];
    return [x + totalW * scale, y + totalH * scale];
  }
  function hitTest(point) {
    const p = state.layout;
    if (!p || modeName() !== "外补") return null;
    for (const name of ["tl", "tr", "bl", "br"]) {
      const [cx, cy] = cornerScreen(name, p);
      if (Math.hypot(point.x - cx, point.y - cy) <= 18) return { kind: "corner", corner: name, cursor: CORNERS[name].cursor };
    }
    const imgX = p.x + p.left * p.scale;
    const imgY = p.y + p.top * p.scale;
    const imgW = p.iw * p.scale;
    const imgH = p.ih * p.scale;
    if (point.x >= imgX && point.x <= imgX + imgW && point.y >= imgY && point.y <= imgY + imgH) {
      return { kind: "image", cursor: "move" };
    }
    return null;
  }
  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, viewport.clientWidth || rect.width || 1);
    const height = Math.max(1, viewport.clientHeight || rect.height || 1);
    const scaleX = rect.width > 0 ? width / rect.width : 1;
    const scaleY = rect.height > 0 ? height / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }
  function boardPoint(event) {
    const p = state.layout;
    const point = localPoint(event);
    return { x: (point.x - p.x) / p.scale, y: (point.y - p.y) / p.scale };
  }
  function boxHit(point, box, ellipse) {
    const handles = {
      tl: [box.x, box.y],
      tr: [box.x + box.w, box.y],
      bl: [box.x, box.y + box.h],
      br: [box.x + box.w, box.y + box.h],
    };
    for (const name of ["tl", "tr", "bl", "br"]) {
      const [cx, cy] = handles[name];
      if (Math.hypot(point.x - cx, point.y - cy) <= 12) return { kind: "shape-resize", corner: name, cursor: CORNERS[name].cursor };
    }
    const nx = (point.x - box.x) / Math.max(box.w, 1);
    const ny = (point.y - box.y) / Math.max(box.h, 1);
    const inside = ellipse
      ? (nx - 0.5) ** 2 * 4 + (ny - 0.5) ** 2 * 4 <= 1
      : nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    return inside ? { kind: "shape-move", cursor: "move" } : null;
  }
  function shapeHit(point) {
    const p = state.layout;
    if (!p || modeName() !== "遮罩") return null;
    for (let index = state.rects.length - 1; index >= 0; index -= 1) {
      const hit = boxHit(point, shapeBox(p, state.rects[index]), false);
      if (hit) return { ...hit, rectIndex: index };
    }
    if (state.shape?.kind === "ellipse") {
      const hit = boxHit(point, shapeBox(p, state.shape), true);
      if (hit) return hit;
    }
    return null;
  }
  function screenToNorm(point) {
    const p = state.layout;
    return {
      x: (point.x - p.x) / (p.totalW * p.scale),
      y: (point.y - p.y) / (p.totalH * p.scale),
    };
  }
  function scaleShape(factor) {
    const shape = state.shape;
    if (!shape) return;
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const w = clamp(shape.w * factor, 0.02, 1);
    const h = clamp(shape.h * factor, 0.02, 1);
    writeShape(clampShape({ kind: shape.kind, x: cx - w / 2, y: cy - h / 2, w, h }));
  }
  function scaleRect(index, factor) {
    const rect = state.rects[index];
    if (!rect) return;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const w = clamp(rect.w * factor, 0.02, 1);
    const h = clamp(rect.h * factor, 0.02, 1);
    const next = state.rects.slice();
    const sized = clampShape({ kind: "rect", x: cx - w / 2, y: cy - h / 2, w, h });
    next[index] = { op: rect.op, x: sized.x, y: sized.y, w: sized.w, h: sized.h };
    writeRects(next);
  }
  function zoomView(point, factor) {
    const p = state.layout;
    const totalW = p?.totalW || 0;
    const totalH = p?.totalH || 0;
    if (!p || totalW <= 0 || totalH <= 0) return;
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    const margin = 22;
    const fit = Math.min(Math.max(1, width - margin * 2) / totalW, Math.max(1, height - margin * 2) / totalH);
    const zoom = clamp((state.view.zoom || 1) * factor, 0.25, 8);
    const scale = fit * zoom;
    const u = (point.x - p.x) / p.scale;
    const v = (point.y - p.y) / p.scale;
    state.view.zoom = zoom;
    state.view.panX = point.x - u * scale - (width - totalW * scale) / 2;
    state.view.panY = point.y - v * scale - (height - totalH * scale) / 2;
    draw();
  }
  function onDragMove(event) {
    const origin = state.dragging;
    if (!origin || !state.layout) return;
    if (origin.kind === "pan") {
      const point = localPoint(event);
      state.view.panX = origin.panX + (point.x - origin.startX);
      state.view.panY = origin.panY + (point.y - origin.startY);
      state.pointerMoved = true;
      draw();
      event.preventDefault();
      return;
    }
    if (origin.kind === "brush" || origin.kind === "eraser") {
      const norm = screenToNorm(localPoint(event));
      const x = clamp(norm.x, 0, 1);
      const y = clamp(norm.y, 0, 1);
      const stroke = origin.kind === "eraser" ? state.liveEraser : state.liveStroke;
      const pts = stroke?.pts;
      const last = pts?.[pts.length - 1];
      const minStep = Math.max(0.0015, (stroke?.r || 0.01) * 0.2);
      if (pts && (!last || Math.hypot(x - last[0], y - last[1]) >= minStep)) pts.push([x, y]);
      state.pointerMoved = true;
      draw();
      event.preventDefault();
      return;
    }
    if (origin.kind === "shape-move" || origin.kind === "shape-resize" || origin.kind === "shape-create") {
      const norm = screenToNorm(localPoint(event));
      norm.x = clamp(norm.x, 0, 1);
      norm.y = clamp(norm.y, 0, 1);
      state.pointerMoved = true;
      if (origin.kind === "shape-move" && origin.rectIndex != null) {
        const moved = clampShape({
          kind: "rect",
          x: origin.rect.x + (norm.x - origin.startNorm.x),
          y: origin.rect.y + (norm.y - origin.startNorm.y),
          w: origin.rect.w,
          h: origin.rect.h,
        });
        const next = state.rects.slice();
        next[origin.rectIndex] = { op: origin.rect.op, x: moved.x, y: moved.y, w: moved.w, h: moved.h };
        writeRects(next);
      } else if (origin.kind === "shape-move") {
        writeShape(clampShape({
          kind: origin.shape.kind,
          x: origin.shape.x + (norm.x - origin.startNorm.x),
          y: origin.shape.y + (norm.y - origin.startNorm.y),
          w: origin.shape.w,
          h: origin.shape.h,
        }));
      } else if (origin.kind === "shape-resize" && origin.rectIndex != null) {
        const x = Math.min(origin.ax, norm.x);
        const y = Math.min(origin.ay, norm.y);
        const w = Math.abs(norm.x - origin.ax);
        const h = Math.abs(norm.y - origin.ay);
        if (w >= 0.02 && h >= 0.02) {
          const next = state.rects.slice();
          next[origin.rectIndex] = { op: origin.op, x, y, w, h };
          writeRects(next);
        }
      } else if (origin.kind === "shape-resize") {
        const x = Math.min(origin.ax, norm.x);
        const y = Math.min(origin.ay, norm.y);
        const w = Math.abs(norm.x - origin.ax);
        const h = Math.abs(norm.y - origin.ay);
        if (w >= 0.02 && h >= 0.02) writeShape({ kind: origin.shapeKind, x, y, w, h });
      } else if (origin.tool === "rect") {
        const x = Math.min(origin.startNorm.x, norm.x);
        const y = Math.min(origin.startNorm.y, norm.y);
        const w = Math.abs(norm.x - origin.startNorm.x);
        const h = Math.abs(norm.y - origin.startNorm.y);
        state.draftRect = w >= 0.01 && h >= 0.01
          ? { op: origin.op === "sub" ? "sub" : "add", x, y, w, h, replace: origin.op === "replace" }
          : null;
      } else {
        const x = Math.min(origin.startNorm.x, norm.x);
        const y = Math.min(origin.startNorm.y, norm.y);
        const w = Math.abs(norm.x - origin.startNorm.x);
        const h = Math.abs(norm.y - origin.startNorm.y);
        if (w >= 0.01 && h >= 0.01) writeShape(clampShape({ kind: origin.tool, x, y, w, h }));
        else state.shape = origin.previous;
      }
      draw();
      event.preventDefault();
      return;
    }
    const point = boardPoint(event);
    if (origin.kind === "image") {
      const dx = point.x - origin.startX;
      const dy = point.y - origin.startY;
      const next = shiftPads(origin.startPads, dx, dy);
      writePads(next);
      const room = origin.startPads.left + origin.startPads.right + origin.startPads.top + origin.startPads.bottom;
      const moved = next.left !== origin.startPads.left || next.top !== origin.startPads.top;
      if (!room && !moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) setStatus("原图已经贴着画框，先拖四角留出空白");
      draw();
      event.preventDefault();
      return;
    }
    const spec = CORNERS[origin.corner];
    const parts = PRESET_PARTS[presetName()];
    writePads(frameFromCorner(
      origin.anchorX,
      origin.anchorY,
      spec.signs[0],
      spec.signs[1],
      point.x,
      point.y,
      parts ? parts[0] / parts[1] : null,
      origin.imgL,
      origin.imgT,
      origin.imgR,
      origin.imgB,
    ));
    draw();
    event.preventDefault();
  }
  function endDrag() {
    const origin = state.dragging;
    if (!origin) return;
    if (origin.kind === "brush") commitStroke();
    if (origin.kind === "eraser") commitEraser();
    if (origin.kind === "shape-create" && origin.tool === "rect") {
      const draft = state.draftRect;
      state.draftRect = null;
      if (draft && draft.w >= 0.02 && draft.h >= 0.02) {
        const rect = { op: draft.op === "sub" ? "sub" : "add", x: draft.x, y: draft.y, w: draft.w, h: draft.h };
        if (origin.op === "replace") {
          state.shape = null;
          state.rects = [rect];
        } else {
          state.rects = state.rects.concat([rect]);
        }
        persistMarkup();
      }
    } else if (origin.kind === "shape-create" && state.shape === origin.previous) {
      writeShape(origin.previous);
    } else if (origin.kind === "shape-create" && origin.tool === "ellipse") {
      state.rects = [];
      persistMarkup();
    }
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    state.dragging = null;
    viewport.style.cursor = "default";
    node.graph?.setDirtyCanvas?.(true, true);
    draw();
  }
  function beginDrag(dragging, cursor) {
    state.pointerMoved = false;
    state.dragging = dragging;
    viewport.style.cursor = cursor || "default";
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }
  viewport.addEventListener("pointermove", (event) => {
    if (state.dragging) return;
    const point = localPoint(event);
    if (modeName() === "遮罩") {
      if ((state.shapeTool === "brush" || state.shapeTool === "eraser") && state.layout) {
        const norm = screenToNorm(point);
        const inside = norm.x >= 0 && norm.y >= 0 && norm.x <= 1 && norm.y <= 1;
        viewport.style.cursor = inside ? "crosshair" : "grab";
        return;
      }
      const hit = shapeHit(point);
      if (state.hoverRect !== (hit?.rectIndex ?? null)) {
        state.hoverRect = hit?.rectIndex ?? null;
        draw();
      }
      viewport.style.cursor = hit?.cursor || (state.shapeTool ? "crosshair" : "grab");
      return;
    }
    const hit = hitTest(point);
    viewport.style.cursor = hit?.cursor || "default";
  });
  viewport.addEventListener("pointerenter", () => {
    state.overView = true;
  });
  viewport.addEventListener("pointerleave", () => {
    if (!state.dragging) {
      state.overView = false;
      viewport.style.cursor = "default";
    }
  });
  const stopAltMenu = (event) => {
    if (state.disposed || !state.overView || state.shapeTool !== "rect" || event.key !== "Alt") return;
    event.preventDefault();
  };
  window.addEventListener("keydown", stopAltMenu, true);
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.layout) return;
    if (modeName() === "遮罩") {
      const point = localPoint(event);
      const hit = shapeHit(point);
      const norm = screenToNorm(point);
      const inside = norm.x >= 0 && norm.y >= 0 && norm.x <= 1 && norm.y <= 1;
      event.preventDefault();
      event.stopPropagation();
      state.userEdited = true;
      const fit = { x: state.layout.x, y: state.layout.y, scale: state.layout.scale };
      if (state.shapeTool === "brush" && inside) {
        state.liveStroke = {
          r: brushRadius(),
          pts: [[clamp(norm.x, 0, 1), clamp(norm.y, 0, 1)]],
        };
        beginDrag({ kind: "brush", fit }, "crosshair");
      } else if (state.shapeTool === "eraser" && inside) {
        state.liveEraser = {
          r: eraserRadius(),
          pts: [[clamp(norm.x, 0, 1), clamp(norm.y, 0, 1)]],
        };
        beginDrag({ kind: "eraser", fit }, "crosshair");
      } else if (state.shapeTool === "rect" && inside && (event.altKey || event.shiftKey)) {
        beginDrag({
          kind: "shape-create",
          tool: "rect",
          op: event.altKey ? "sub" : "add",
          startNorm: { x: clamp(norm.x, 0, 1), y: clamp(norm.y, 0, 1) },
          previous: state.shape,
          fit,
        }, "crosshair");
      } else if (hit?.kind === "shape-resize") {
        const box = hit.rectIndex != null ? state.rects[hit.rectIndex] : state.shape;
        const anchors = {
          tl: [box.x + box.w, box.y + box.h],
          tr: [box.x, box.y + box.h],
          bl: [box.x + box.w, box.y],
          br: [box.x, box.y],
        };
        const [ax, ay] = anchors[hit.corner];
        beginDrag({
          kind: "shape-resize",
          corner: hit.corner,
          ax,
          ay,
          shapeKind: box.kind || "rect",
          rectIndex: hit.rectIndex,
          op: box.op,
          fit,
        }, hit.cursor);
      } else if (hit?.kind === "shape-move") {
        beginDrag({
          kind: "shape-move",
          shape: hit.rectIndex == null ? { ...state.shape } : null,
          rect: hit.rectIndex != null ? { ...state.rects[hit.rectIndex] } : null,
          rectIndex: hit.rectIndex,
          startNorm: norm,
          fit,
        }, hit.cursor);
      } else if (state.shapeTool === "rect" || state.shapeTool === "ellipse") {
        beginDrag({
          kind: "shape-create",
          tool: state.shapeTool,
          op: "replace",
          startNorm: { x: clamp(norm.x, 0, 1), y: clamp(norm.y, 0, 1) },
          previous: state.shape,
          fit,
        }, "crosshair");
      } else {
        beginDrag({ kind: "pan", startX: point.x, startY: point.y, panX: state.view.panX, panY: state.view.panY }, "grabbing");
      }
      return;
    }
    if (modeName() !== "外补") return;
    const hit = hitTest(localPoint(event));
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    state.userEdited = true;
    const [imgW, imgH] = scaledSize();
    const pads = readPads();
    const imgL = pads.left;
    const imgT = pads.top;
    const imgR = pads.left + imgW;
    const imgB = pads.top + imgH;
    const totalW = imgR + pads.right;
    const totalH = imgB + pads.bottom;
    const anchors = {
      tl: [totalW, totalH],
      tr: [0, totalH],
      bl: [totalW, 0],
      br: [0, 0],
    };
    const fit = { x: state.layout.x, y: state.layout.y, scale: state.layout.scale };
    if (hit.kind === "image") {
      const point = boardPoint(event);
      beginDrag({ kind: "image", fit, startX: point.x, startY: point.y, startPads: readPads() }, hit.cursor);
    } else {
      const [anchorX, anchorY] = anchors[hit.corner];
      beginDrag({ kind: "corner", corner: hit.corner, anchorX, anchorY, imgL, imgT, imgR, imgB, fit }, hit.cursor);
    }
  });
  viewport.addEventListener("dblclick", (event) => {
    if (modeName() !== "遮罩" || state.pointerMoved) return;
    event.preventDefault();
    event.stopPropagation();
    openMaskEditor();
  });
  viewport.addEventListener("wheel", (event) => {
    if (!state.image) return;
    if (modeName() === "遮罩") {
      if (!state.layout) return;
      event.preventDefault();
      event.stopPropagation();
      const point = localPoint(event);
      const hit = shapeHit(point);
      if (hit?.rectIndex != null) {
        scaleRect(hit.rectIndex, event.deltaY < 0 ? 1.08 : 1 / 1.08);
        draw();
      } else if (hit && state.shape?.kind === "ellipse") {
        scaleShape(event.deltaY < 0 ? 1.08 : 1 / 1.08);
        draw();
      } else zoomView(point, event.deltaY < 0 ? 1.12 : 1 / 1.12);
      return;
    }
    if (modeName() !== "外补") return;
    event.preventDefault();
    event.stopPropagation();
    state.userEdited = true;
    changeScale(imageScale() * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, { passive: false, capture: true });

  function setImage(src, options = {}) {
    const requestId = ++state.requestId;
    if (!src) {
      state.image = null;
      state.mask = null;
      state.maskCount = 0;
      state.maskError = "";
      state.tint = null;
      draw();
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (state.disposed || requestId !== state.requestId) {
          resolve();
          return;
        }
        state.image = img;
        state.pixels = null;
        state.autoColorKey = "";
        state.tint = null;
        const applyExtracted = (extracted) => {
          state.mask = extracted?.mask || null;
          state.maskWidth = extracted?.width || 0;
          state.maskHeight = extracted?.height || 0;
          state.maskCount = extracted?.count || 0;
          state.maskError = extracted ? "" : "无法读取遮罩";
          state.tint = null;
          state.baseKey = "";
          state.finalKey = "";
        };
        const finish = () => {
          if (state.lastScale == null) state.lastScale = imageScale();
          const pads = readPads();
          if (modeName() === "外补" && presetName() !== "自由" && pads.left + pads.right + pads.top + pads.bottom === 0) applyPreset();
          else {
            draw();
            const colorName = widget(node, "外补颜色")?.value || "纯蓝";
            if (modeName() === "遮罩" && state.maskCount) setStatus(`遮罩颜色 ${colorName}`);
          }
          resolve();
        };
        const maskFile = options.maskFile || null;
        const paintFromMask = maskFile ? clipspacePaintName(maskFile.filename) : "";
        const ref = filenameFromUrl(src);
        const paintName = paintFromMask || clipspacePaintName(ref?.filename);
        const paintType = paintFromMask ? maskFile.type : ref?.type;
        const paintFolder = paintFromMask ? maskFile.subfolder : ref?.subfolder;
        if (!paintName) {
          applyExtracted(options.maskFile ? { mask: null, width: 0, height: 0, count: 0 } : readMask(img));
          finish();
          return;
        }
        const paint = new Image();
        paint.onload = () => {
          if (state.disposed || requestId !== state.requestId) {
            resolve();
            return;
          }
          applyExtracted(readPaintMask(paint));
          finish();
        };
        paint.onerror = () => {
          if (state.disposed || requestId !== state.requestId) {
            resolve();
            return;
          }
          applyExtracted(readMask(img));
          finish();
        };
        paint.src = imageUrl(paintName, paintType || "input", paintFolder || "");
      };
      img.onerror = () => reject(new Error("图像预览加载失败"));
      img.src = src;
    });
  }

  async function loadPreview() {
    setStatus("正在加载图像节点的图片…");
    try {
      await loadBoardImage();
    } catch (error) {
      if (!state.disposed) setStatus(error?.message || "图像预览加载失败", true);
    }
  }

  loadBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    loadPreview().catch((error) => {
      if (state.disposed) return;
      setStatus(error?.message || "预览加载失败", true);
    });
  });
  restoreBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    restore();
  });
  clearBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearMask();
  });
  colorInput.addEventListener("input", () => {
    state.picked = colorInput.value;
    ensureCustomColorChoice();
    setWidgetValue("外补颜色", "自定义");
    setWidgetValue("自定义颜色", colorInput.value);
    state.tint = null;
    state.userEdited = true;
    draw();
  });
  function chooseTool(kind) {
    state.shapeTool = state.shapeTool === kind ? "" : kind;
    draw();
  }
  rectBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    chooseTool("rect");
  });
  ellipseBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    chooseTool("ellipse");
  });
  brushBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    chooseTool("brush");
  });
  eraserBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    chooseTool("eraser");
  });
  sizeInput.addEventListener("input", () => {
    state.brushSize = clamp(Math.round(Number(sizeInput.value) || 32), 2, 512);
    sizeValue.textContent = `${state.brushSize}px`;
    persistMarkup();
  });
  eraserInput.addEventListener("input", () => {
    state.eraserSize = clamp(Math.round(Number(eraserInput.value) || 32), 2, 512);
    eraserValue.textContent = `${state.eraserSize}px`;
    persistMarkup();
  });

  function watchLoader(force = false) {
    const info = loaderInfo(node);
    const loaderId = info?.node?.id ?? null;
    if (loaderId !== state.loaderNodeId) {
      state.unbindLoader?.();
      state.unbindLoader = null;
      state.loaderNodeId = loaderId;
      if (info?.node) state.unbindLoader = subscribeLoader(info.node, () => watchLoader(true));
    }
    const key = info?.key || "";
    if (key && !isClipspaceFile(String(key).split("|").slice(2).join("|"))) {
      const source = info?.node?.widgets?.find((item) => ["image", "图像"].includes(item.name));
      state.originKey = key;
      state.originValue = String(source?.value || "");
    }
    if (!force && key === state.loaderKey) return;
    const previous = state.loaderKey;
    state.loaderKey = key;
    const editorFile = editorAnnotation(key);
    if (previous && key !== previous && !editorFile) clearMaskFile();
    if (editorFile) rememberEditorFile(editorFile);
    if (modeName() !== "遮罩") return;
    const painted = parseAnnotated(widget(node, "image")?.value);
    const photo = loaderFileUrl(node);
    if (painted && photo) {
      setImage(photo, { maskFile: painted }).catch((error) => {
        if (!state.disposed) setStatus(error.message || "图像预览加载失败", true);
      });
      return;
    }
    const url = painted ? imageUrl(painted.filename, painted.type, painted.subfolder) : info?.url;
    if (url) {
      setImage(url).catch((error) => {
        if (!state.disposed) setStatus(error.message || "图像预览加载失败", true);
      });
      return;
    }
    if (previous && !key) {
      state.image = null;
      draw();
    }
  }

  const resized = node.onResize;
  node.onResize = function () {
    const result = resized?.apply(this, arguments);
    draw();
    return result;
  };
  const removed = node.onRemoved;
  node.onRemoved = function () {
    if (state.disposed) return removed?.apply(this, arguments);
    state.disposed = true;
    window.removeEventListener("keydown", stopAltMenu, true);
    endDrag();
    state.controller?.abort();
    state.unbindLoader?.();
    state.requestId += 1;
    observer.disconnect();
    return removed?.apply(this, arguments);
  };
  const connections = node.onConnectionsChange;
  node.onConnectionsChange = function (type, index) {
    const result = connections?.apply(this, arguments);
    if (type === 1 && this.inputs?.[index]?.name === "图像") watchLoader(true);
    return result;
  };
  const observer = new ResizeObserver(() => draw());
  observer.observe(viewport);
  bindWidgets();
  draw();
  return { scheduleBaseline, watchLoader, bindWidgets, draw };
}

function hexRgb(hex) {
  const value = parseInt(String(hex).slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function readPaintMask(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return { mask: null, width: 0, height: 0, count: 0 };
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let index = 0; index < mask.length; index++) {
    const on = pixels[index * 4 + 3] > 8 ? 1 : 0;
    mask[index] = on;
    count += on;
  }
  if (count) fillHoles(mask, width, height);
  let filled = 0;
  for (let index = 0; index < mask.length; index++) filled += mask[index];
  return { mask, width, height, count: filled };
}

function readMask(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return { mask: null, width: 0, height: 0, count: 0 };
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let index = 0; index < mask.length; index++) {
    const on = 255 - pixels[index * 4 + 3] > 8 ? 1 : 0;
    mask[index] = on;
    count += on;
  }
  if (count) fillHoles(mask, width, height);
  let filled = 0;
  for (let index = 0; index < mask.length; index++) filled += mask[index];
  return { mask, width, height, count: filled };
}

function drawHandles(ctx, layout, active) {
  const names = ["tl", "tr", "bl", "br"];
  names.forEach((name, index) => {
    const points = [
      [layout.x, layout.y],
      [layout.x + layout.totalW * layout.scale, layout.y],
      [layout.x, layout.y + layout.totalH * layout.scale],
      [layout.x + layout.totalW * layout.scale, layout.y + layout.totalH * layout.scale],
    ];
    const [px, py] = points[index];
    const size = name === active ? 14 : 12;
    ctx.beginPath();
    ctx.rect(px - size / 2, py - size / 2, size, size);
    ctx.fillStyle = name === active ? "#7aa2ff" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#111111";
    ctx.stroke();
  });
}

function drawPadLabels(ctx, layout) {
  const { x, y, scale, iw, ih, left, right, top, bottom, totalW, totalH } = layout;
  const items = [
    [left, x + (left * scale) / 2, y + (totalH * scale) / 2],
    [right, x + (left + iw) * scale + (right * scale) / 2, y + (totalH * scale) / 2],
    [top, x + (totalW * scale) / 2, y + (top * scale) / 2],
    [bottom, x + (totalW * scale) / 2, y + (top + ih) * scale + (bottom * scale) / 2],
  ];
  ctx.save();
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,.75)";
  ctx.fillStyle = "#ffffff";
  for (const [value, px, py] of items) {
    if (value <= 0) continue;
    const text = String(value);
    ctx.strokeText(text, px, py);
    ctx.fillText(text, px, py);
  }
  ctx.restore();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureBoard(node) {
  if (!node.__feimaoBoard) node.__feimaoBoard = createBoard(node);
  return node.__feimaoBoard;
}

app.registerExtension({
  name: "feimao.tools.board",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const created = nodeType.prototype.onNodeCreated;
    const configured = nodeType.prototype.onConfigure;
    const computeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const size = computeSize?.apply(this, arguments) || [400, 720];
      size[0] = Math.max(400, size[0]);
      size[1] = Math.max(700, size[1]);
      return size;
    };
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      const board = ensureBoard(this);
      board.bindWidgets();
      board.scheduleBaseline();
      board.watchLoader(true);
      return result;
    };
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      const board = ensureBoard(this);
      board.bindWidgets();
      board.scheduleBaseline();
      board.watchLoader(true);
      return result;
    };
  },
});
