import { app } from "../../../scripts/app.js";

const NODE_CLASS = "feimao_tools_Resolution";
const DEFAULT_ASPECT = "16:9 (Widescreen)";
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

function calcSize(aspect, megapixels, multiple) {
  const mp = Number.isFinite(Number(megapixels)) ? Number(megapixels) : 1;
  const step = Math.max(1, Math.round(Number(multiple) || 16));
  const total = mp * 1024 * 1024;
  if (aspect === COVER_ASPECT) {
    const height = Math.max(step, pyRound(Math.sqrt(total / COVER_RATIO) / step) * step);
    const width = Math.max(step, pyRound((height * COVER_RATIO) / step) * step);
    return [width, height];
  }
  const pair = RATIO_PARTS[aspect] || RATIO_PARTS[DEFAULT_ASPECT];
  const scale = Math.sqrt(total / (pair[0] * pair[1]));
  const width = Math.max(step, pyRound((pair[0] * scale) / step) * step);
  const height = Math.max(step, pyRound((pair[1] * scale) / step) * step);
  return [width, height];
}

function widget(node, name) {
  return (node.widgets || []).find((item) => item.name === name);
}

function writeNumber(item, value) {
  if (!item || item.value === value) return;
  item.value = value;
  if (item.inputEl) item.inputEl.value = String(value);
}

function setLocked(item, locked) {
  if (!item) return;
  item.disabled = locked;
  if (item.inputEl) item.inputEl.disabled = locked;
}

function sync(node) {
  if (node.__teResSyncing) return;
  node.__teResSyncing = true;
  try {
    const custom = !!widget(node, "自定义尺寸")?.value;
    const width = widget(node, "宽度");
    const height = widget(node, "高度");
    setLocked(width, !custom);
    setLocked(height, !custom);
    if (custom) return;
    const [w, h] = calcSize(
      widget(node, "宽高比")?.value,
      widget(node, "百万像素")?.value,
      widget(node, "对齐倍数")?.value,
    );
    writeNumber(width, w);
    writeNumber(height, h);
    node.graph?.setDirtyCanvas(true, false);
  } finally {
    node.__teResSyncing = false;
  }
}

function hook(node) {
  if (node.__teResHooked) return;
  node.__teResHooked = true;
  for (const name of ["宽高比", "百万像素", "对齐倍数", "自定义尺寸"]) {
    const item = widget(node, name);
    if (!item) continue;
    const previous = item.callback;
    item.callback = function () {
      const result = previous?.apply(this, arguments);
      sync(node);
      return result;
    };
  }
  sync(node);
}

app.registerExtension({
  name: "TE.ManPro.Resolution",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      hook(this);
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      queueMicrotask(() => hook(this));
      return result;
    };
  },
});
