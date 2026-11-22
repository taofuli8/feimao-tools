import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { hideComfyWidget, useDomLayout } from "./hide_widget.js";

const NODE_CLASS = "feimao_tools_Batch_Prompt";
const NAME_SEP = "----";
const STYLE_ID = "te-man-pro-batch-style-v9";
const PROMPTS_PROP = "te_man_pro_prompts";
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
const DEFAULT_ASPECT = "9:16 (Portrait Widescreen)";
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

function calcSize(aspect, megapixels, multiple) {
  const mp = Number.isFinite(Number(megapixels)) ? Number(megapixels) : 1;
  const step = Math.max(1, Math.round(Number(multiple) || 16));
  const total = mp * 1024 * 1024;
  if (aspect === COVER_ASPECT) {
    const height = Math.max(step, Math.round(Math.sqrt(total / COVER_RATIO) / step) * step);
    const width = Math.max(step, Math.round((height * COVER_RATIO) / step) * step);
    return [width, height];
  }
  const pair = RATIO_PARTS[aspect] || RATIO_PARTS[DEFAULT_ASPECT];
  const scale = Math.sqrt(total / (pair[0] * pair[1]));
  const width = Math.max(step, Math.round((pair[0] * scale) / step) * step);
  const height = Math.max(step, Math.round((pair[1] * scale) / step) * step);
  return [width, height];
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    .dom-widget:has(> .tmp-batch) { overflow:hidden; }
    .tmp-batch { width:100%; height:100%; min-height:0; max-height:100%; box-sizing:border-box; padding:8px; display:flex; flex-direction:column; gap:8px;
      overflow:hidden; background:rgba(18,18,18,.58); border:1px solid rgba(255,255,255,.12); border-radius:10px; color:var(--input-text); }
    .tmp-row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; width:100%; flex:0 0 auto; }
    .tmp-cfg { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; width:100%; box-sizing:border-box; flex:0 0 auto; }
    .tmp-field { display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; max-width:100%; }
    .tmp-field > span { white-space:nowrap; font-size:12px; line-height:1; }
    .tmp-cfg input[type=number] { width:72px; flex:0 0 72px; box-sizing:border-box; background:rgba(0,0,0,.35); color:inherit;
      border:1px solid rgba(255,255,255,.14); border-radius:6px; padding:4px 6px; }
    .tmp-cfg select { width:78px; flex:0 0 78px; min-width:78px; max-width:78px; }
    .tmp-cfg .status { flex:1 0 auto; margin-left:auto; white-space:nowrap; font-size:12px; opacity:.85; text-align:right; }
    .tmp-batch button { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16); color:inherit;
      border-radius:6px; padding:4px 8px; cursor:pointer; font-size:12px; }
    .tmp-batch button:hover { background:rgba(255,255,255,.16); }
    .tmp-batch button.primary { border-color:rgba(255,180,60,.7); background:rgba(180,110,20,.35); }
    .tmp-batch button.on { border-color:rgba(255,160,60,.85); background:rgba(200,110,30,.35); }
    .tmp-batch button.danger { border-color:rgba(255,90,90,.45); color:#ffb4b4; }
    .tmp-import-panel { display:none; flex-direction:column; gap:6px; width:100%; flex:0 0 auto; }
    .tmp-import-panel.show { display:flex; }
    .tmp-import { width:100%; min-height:110px; resize:vertical; box-sizing:border-box; background:rgba(0,0,0,.35);
      color:inherit; border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px; font:inherit; }
    .tmp-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); grid-auto-rows:230px; gap:8px;
      flex:1 1 auto; min-height:0; overflow:auto; align-content:start; align-items:stretch; }
    .tmp-list.single { display:flex; grid-auto-rows:unset; }
    .tmp-card { height:230px; max-height:230px; border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px;
      background:rgba(0,0,0,.28); display:flex; flex-direction:column; gap:6px; min-width:0; min-height:0;
      overflow:hidden; cursor:pointer; box-sizing:border-box; }
    .tmp-list.single .tmp-card { flex:1 1 auto; width:100%; height:100%; max-height:none; min-height:0; }
    .tmp-card.active { border-color:rgba(255,160,60,.9); box-shadow:0 0 0 1px rgba(255,160,60,.35); }
    .tmp-card-head { display:flex; gap:3px; align-items:center; flex-wrap:nowrap; width:100%; min-width:0; }
    .tmp-index { font-weight:700; font-size:12px; flex:0 0 auto; white-space:nowrap; }
    .tmp-name { flex:1 1 auto; min-width:0; font-size:12px; padding:1px 4px; border-radius:4px;
      border:1px dashed transparent; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tmp-name:hover { border-color:rgba(255,255,255,.25); }
    .tmp-name.editing { border:1px solid rgba(80,160,255,.7); background:rgba(0,0,0,.4); outline:none; white-space:normal; }
    .tmp-card-actions { display:flex; gap:2px; flex-wrap:nowrap; flex:0 0 auto; align-items:center; }
    .tmp-card-actions button { padding:1px 4px; font-size:11px; white-space:nowrap; line-height:1.2; }
    .tmp-card-aspect { display:flex; align-items:center; gap:6px; width:100%; min-width:0; }
    .tmp-card-aspect > span { flex:0 0 auto; white-space:nowrap; font-size:11px; opacity:.8; }
    .tmp-card-aspect select { flex:1 1 auto; width:100%; min-width:0; box-sizing:border-box;
      background:rgba(0,0,0,.45); color:inherit; border:1px solid rgba(255,255,255,.2); border-radius:6px; padding:3px 6px; font-size:12px; }
    .tmp-card-body { flex:1 1 auto; min-height:0; overflow:auto; font-size:11px; line-height:1.35; opacity:.9;
      white-space:pre-wrap; word-break:break-word; }
    .tmp-status { flex:0 0 auto; font-size:12px; line-height:1.4; opacity:.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tmp-modal { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; }
    .tmp-modal-box { width:min(720px,92vw); max-height:80vh; background:#1e1e1e; color:#eee; border:1px solid rgba(255,255,255,.18);
      border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; }
    .tmp-modal-box textarea { width:100%; min-height:280px; resize:vertical; box-sizing:border-box; background:#111; color:#eee;
      border:1px solid rgba(255,255,255,.18); border-radius:8px; padding:10px; font:inherit; }
    .tmp-modal-actions { display:flex; gap:8px; justify-content:flex-end; }
  `;
  document.head.appendChild(el);
}

function defaultName(i) {
  return `默认${String(i).padStart(2, "0")}`;
}

function sanitizeName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .trim();
}

function parsePromptText(text, startIndex = 1, fallbackName = null) {
  let normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  try {
    const data = JSON.parse(normalized);
    if (Array.isArray(data)) {
      return data
        .map((x, i) => {
          if (typeof x === "string") return parsePromptText(x, startIndex + i, fallbackName)[0];
          if (x && typeof x === "object") {
            const t = String(x.text || x.prompt || "").trim();
            if (!t) return null;
            const name = sanitizeName(x.name) || fallbackName || defaultName(startIndex + i);
            return withNameAspect({
              name,
              text: t,
              aspect: normalizeAspect(x.aspect),
            });
          }
          return null;
        })
        .filter(Boolean);
    }
  } catch (_) {}

  if (/^\s*-{3,}\s*$/m.test(normalized)) {
    const parts = normalized.split(/^\s*-{3,}\s*$/m).map((s) => s.trim()).filter(Boolean);
    const out = [];
    let idx = startIndex;
    for (const part of parts) {
      const got = parsePromptText(part, idx, fallbackName);
      out.push(...got);
      idx = startIndex + out.length;
    }
    return out;
  }

  const items = [];
  let index = startIndex;
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = String(current.text || "").trim();
    if (text) {
      current.text = text;
      items.push(current);
      index += 1;
    }
    current = null;
  };
  for (const raw of normalized.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.includes(NAME_SEP)) {
      flush();
      const p = line.indexOf(NAME_SEP);
      const left = sanitizeName(line.slice(0, p));
      const right = line.slice(p + NAME_SEP.length).trim();
      current = { name: left || sanitizeName(fallbackName) || defaultName(index), text: right, aspect: "" };
      continue;
    }
    if (current) {
      current.text = current.text ? `${current.text}\n${line}` : line;
      continue;
    }
    items.push({ name: sanitizeName(fallbackName) || defaultName(index), text: line, aspect: "" });
    index += 1;
  }
  flush();
  return items.map(withNameAspect);
}

const ASPECT_RULES = [
  [/2\.35\s*[:：比/xX×-]\s*1/, COVER_ASPECT],
  [/21\s*[:：比/xX×-]\s*9/, "21:9 (Ultrawide)"],
  [/16\s*[:：比/xX×-]\s*9/, "16:9 (Widescreen)"],
  [/9\s*[:：比/xX×-]\s*16/, "9:16 (Portrait Widescreen)"],
  [/3\s*[:：比/xX×-]\s*4/, "3:4 (Portrait Standard)"],
  [/4\s*[:：比/xX×-]\s*3/, "4:3 (Standard)"],
  [/2\s*[:：比/xX×-]\s*3/, "2:3 (Portrait Photo)"],
  [/3\s*[:：比/xX×-]\s*2/, "3:2 (Photo)"],
  [/1\s*[:：比/xX×-]\s*1/, "1:1 (Square)"],
];

function matchAspect(text) {
  const source = String(text || "");
  if (!source) return "";
  let best = null;
  for (const [pattern, id] of ASPECT_RULES) {
    const hit = pattern.exec(source);
    if (!hit) continue;
    if (!best || hit.index < best.index) best = { index: hit.index, id };
  }
  return best ? best.id : "";
}

function aspectFromName(name) {
  return matchAspect(name);
}

function resolvedAspect(item) {
  if (!item) return "";
  return normalizeAspect(item.aspect) || aspectFromName(item.name);
}

function withNameAspect(item) {
  if (!item) return item;
  item.aspect = resolvedAspect(item);
  return item;
}

function normalizeAspect(value) {
  const text = String(value || "").trim();
  return ASPECTS.some(([, full]) => full === text) ? text : "";
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

function ensureResolutionWidgets(node) {
  const aspect = widget(node, "默认宽高比");
  if (aspect) {
    const valid = normalizeAspect(aspect.value) || DEFAULT_ASPECT;
    if (aspect.value !== valid) setWidget(node, "默认宽高比", valid);
    aspect.serializeValue = () => normalizeAspect(aspect.value) || DEFAULT_ASPECT;
  }
  const mp = widget(node, "百万像素");
  if (mp) {
    const n = Number(mp.value);
    const next = Number.isFinite(n) && n >= 0.1 && n <= 16 ? n : 1;
    if (mp.value !== next) setWidget(node, "百万像素", next);
    mp.serializeValue = () => {
      const cur = Number(mp.value);
      return Number.isFinite(cur) && cur >= 0.1 && cur <= 16 ? cur : 1;
    };
  }
  const step = widget(node, "对齐倍数");
  if (step) {
    const n = Number(step.value);
    const next = Number.isFinite(n) && n >= 8 && n <= 128 ? Math.round(n) : 16;
    if (step.value !== next) setWidget(node, "对齐倍数", next);
    step.serializeValue = () => {
      const cur = Number(step.value);
      return Number.isFinite(cur) && cur >= 8 && cur <= 128 ? Math.round(cur) : 16;
    };
  }
}

function normalizeItems(items) {
  return (items || [])
    .filter((x) => x && String(x.text || "").trim())
    .map((x, i) => ({
      name: sanitizeName(x.name) || defaultName(i + 1),
      text: String(x.text || "").trim(),
      aspect: normalizeAspect(x.aspect) || aspectFromName(x.name),
    }));
}

function parseItemsPayload(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return normalizeItems(
      list.map((x, i) => {
        if (typeof x === "string") return parsePromptText(x, i + 1)[0] || null;
        return x;
      })
    );
  } catch {
    return [];
  }
}

function readItems(node) {
  const fromWidget = parseItemsPayload(widget(node, "prompts_json")?.value || "[]");
  if (fromWidget.length) return fromWidget;
  const fromProps = node.properties?.[PROMPTS_PROP];
  if (fromProps) return parseItemsPayload(fromProps);
  return [];
}

function storageKey(node) {
  return `te_man_pro_prompts_${node?.id ?? "default"}`;
}

function persistLocal(node, payload) {
  try {
    localStorage.setItem(storageKey(node), JSON.stringify(payload));
    localStorage.setItem("te_man_pro_prompts_latest", JSON.stringify({ node_id: node?.id, prompts: payload }));
  } catch (_) {}
}

function loadLocal(node) {
  try {
    const raw = localStorage.getItem(storageKey(node));
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  try {
    const latest = localStorage.getItem("te_man_pro_prompts_latest");
    if (latest) return JSON.parse(latest)?.prompts;
  } catch (_) {}
  return null;
}

async function persistDisk(node, payload) {
  try {
    await api.fetchApi("/te_man_pro/prompts_save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: String(node?.id ?? "default"), prompts: payload }),
    });
  } catch (_) {}
}

async function loadDisk(node) {
  try {
    const resp = await api.fetchApi(
      `/te_man_pro/prompts_load?node_id=${encodeURIComponent(String(node?.id ?? "default"))}`
    );
    const data = await resp.json();
    return data?.prompts || null;
  } catch (_) {
    return null;
  }
}

function markGraphDirty(node) {
  try {
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
  } catch (_) {}
}

function writeItems(node, items) {
  const normalized = normalizeItems(items);
  const text = JSON.stringify(normalized);
  setWidget(node, "prompts_json", text);
  hideWidgets(node);
  const payload = {
    items: normalized,
    index: Number(widget(node, "index")?.value || 0),
    max_tasks: Number(widget(node, "最大任务数")?.value || 100),
  };
  node.properties = node.properties || {};
  node.properties[PROMPTS_PROP] = payload;
  persistLocal(node, payload);
  markGraphDirty(node);
  void persistDisk(node, payload);
  return normalized;
}

async function restorePrompts(node) {
  let items = readItems(node);
  let index = Number(widget(node, "index")?.value || 0);
  let maxTasks = Number(widget(node, "最大任务数")?.value || 100);

  if (!items.length) {
    const local = loadLocal(node);
    if (local?.items?.length) {
      items = normalizeItems(local.items);
      index = Number(local.index || 0);
      maxTasks = Number(local.max_tasks || maxTasks);
    }
  }
  if (!items.length) {
    const disk = await loadDisk(node);
    if (disk?.items?.length) {
      items = normalizeItems(disk.items);
      index = Number(disk.index || 0);
      maxTasks = Number(disk.max_tasks || maxTasks);
    }
  }

  if (items.length) {
    setWidget(node, "prompts_json", JSON.stringify(items));
    setWidget(node, "index", Math.max(0, Math.min(index, items.length - 1)));
    setWidget(node, "最大任务数", Math.max(1, maxTasks || 100));
    node.properties = node.properties || {};
    node.properties[PROMPTS_PROP] = { items, index, max_tasks: maxTasks };
  }
  node.__tmpRender?.();
  return items;
}

function ensureAspectWidget(node) {
  ensureResolutionWidgets(node);
  return normalizeAspect(widget(node, "默认宽高比")?.value) || DEFAULT_ASPECT;
}

function hideWidgets(node) {
  const keepType = new Set(["prompts_json", "默认宽高比", "百万像素", "对齐倍数"]);
  for (const name of ["prompts_json", "index", "最大任务数", "默认宽高比", "百万像素", "对齐倍数"]) {
    hideComfyWidget(widget(node, name), keepType.has(name));
  }
}

function pickFiles({ multiple = false, directory = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.multiple = multiple;
    if (directory) {
      input.webkitdirectory = true;
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    };
    input.addEventListener("cancel", () => {
      input.remove();
      resolve([]);
    });
    input.click();
  });
}

async function readText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buf));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(buf));
  }
}

function openEditModal({ title, text, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "tmp-modal";
  const box = document.createElement("div");
  box.className = "tmp-modal-box";
  const h = document.createElement("div");
  h.textContent = title;
  const ta = document.createElement("textarea");
  ta.value = text || "";
  const actions = document.createElement("div");
  actions.className = "tmp-modal-actions";
  const cancel = document.createElement("button");
  cancel.textContent = "取消";
  const ok = document.createElement("button");
  ok.textContent = "保存";
  ok.className = "primary";
  actions.append(cancel, ok);
  box.append(h, ta, actions);
  overlay.append(box);
  document.body.appendChild(overlay);
  ta.focus();
  const close = () => overlay.remove();
  cancel.onclick = close;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  ok.onclick = () => {
    onSave(ta.value);
    close();
  };
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
    if (typeof api.interrupt === "function") {
      await api.interrupt();
    } else {
      await api.fetchApi("/interrupt", { method: "POST" });
    }
  } catch (_) {}
  try {
    if (typeof api.clearItems === "function") {
      await api.clearItems("queue");
    } else {
      await api.fetchApi("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
    }
  } catch (_) {
    try {
      await api.fetchApi("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
    } catch (_) {}
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    const running = Array.isArray(data?.queue_running) ? data.queue_running.length : 0;
    const pending = Array.isArray(data?.queue_pending) ? data.queue_pending.length : 0;
    return { running, pending };
  } catch (_) {
    return null;
  }
}

async function waitUntilIdleOrStop(node) {
  // Backup if websocket completion events are missed.
  let sawBusy = false;
  const started = Date.now();
  for (;;) {
    if (node.__tmpStop) return { ok: false, interrupted: true };
    const counts = await getQueueCounts();
    if (counts) {
      const busy = counts.running + counts.pending > 0;
      if (busy) sawBusy = true;
      if (sawBusy && !busy) return { ok: true };
      // queuePrompt may have blocked until finish; after a while with no busy, accept done.
      if (!sawBusy && Date.now() - started > 2500) return { ok: true };
    }
    await sleep(250);
  }
}

async function queueOneAndWait(node) {
  // Listen first so we don't miss fast completion events.
  const waiter = waitForExecution();
  const stopPoll = new Promise((resolve) => {
    const t = setInterval(() => {
      if (node.__tmpStop) {
        clearInterval(t);
        waiter.cancel({ ok: false, interrupted: true, fromPoll: true });
        resolve({ ok: false, interrupted: true, fromPoll: true });
      }
    }, 150);
    waiter.promise.finally(() => clearInterval(t));
  });

  try {
    const queued = app.queuePrompt(0);
    if (queued && typeof queued.then === "function") {
      await queued;
    }
  } catch (err) {
    waiter.cancel({ ok: false, interrupted: !!node.__tmpStop, error: err });
    if (node.__tmpStop) return { ok: false, interrupted: true };
    throw err;
  }

  // Prefer execution_* events; also poll queue idle as a fallback.
  return Promise.race([waiter.promise, stopPoll, waitUntilIdleOrStop(node)]);
}

async function runBatch(node, indices, setStatus) {
  const maxTasks = Number(widget(node, "最大任务数")?.value || 100);
  let list = indices.slice();
  if (maxTasks > 0 && list.length > maxTasks) list = list.slice(0, maxTasks);
  node.__tmpStop = false;
  node.__tmpBatchRunning = true;
  let doneCount = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      if (node.__tmpStop) {
        setStatus(`已停止（完成 ${doneCount}/${list.length}）`);
        return;
      }
      const idx = list[i];
      ensureResolutionWidgets(node);
      setWidget(node, "index", idx);
      setStatus(`执行中 ${i + 1}/${list.length}（#${String(idx + 1).padStart(2, "0")}）`);
      node.__tmpRender?.();
      try {
        const result = await queueOneAndWait(node);
        if (node.__tmpStop || result?.interrupted) {
          await interruptAndClearQueue();
          setStatus(`已停止（完成 ${doneCount}/${list.length}）`);
          return;
        }
        if (result && result.ok === false && !result.interrupted) {
          setStatus(`第 ${idx + 1} 条失败`);
          return;
        }
        doneCount += 1;
      } catch (err) {
        if (node.__tmpStop) {
          await interruptAndClearQueue();
          setStatus(`已停止（完成 ${doneCount}/${list.length}）`);
          return;
        }
        setStatus(`第 ${idx + 1} 条失败: ${err?.message || err}`);
        return;
      }
    }
    setStatus(`完成，共执行 ${doneCount} 条`);
  } finally {
    node.__tmpBatchRunning = false;
  }
}

function buildUI(node) {
  if (node.__tmpBuilt) return;
  node.__tmpBuilt = true;
  ensureStyle();
  hideWidgets(node);
  if (!widget(node, "prompts_json")?.value) setWidget(node, "prompts_json", "[]");

  const root = document.createElement("div");
  root.className = "tmp-batch";

  const mk = (label, cls = "") => {
    const b = document.createElement("button");
    b.textContent = label;
    if (cls) b.className = cls;
    return b;
  };

  const actions = document.createElement("div");
  actions.className = "tmp-row";
  const btnBatch = mk("批量执行", "primary");
  const btnSingle = mk("单选执行");
  const btnAdd = mk("新增卡片");
  const btnImportText = mk("导入文本");
  const btnTxt = mk("txt分割导入");
  const btnFolder = mk("导入txt文件夹");
  const btnSaveTxt = mk("保存提示词");
  const btnClear = mk("清空", "danger");
  const btnStop = mk("停止执行");
  actions.append(btnBatch, btnSingle, btnAdd, btnImportText, btnTxt, btnFolder, btnSaveTxt, btnClear, btnStop);

  const cfg = document.createElement("div");
  cfg.className = "tmp-cfg";
  const field = (label, control) => {
    const box = document.createElement("label");
    box.className = "tmp-field";
    const text = document.createElement("span");
    text.textContent = label;
    box.append(text, control);
    return box;
  };
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "1";
  maxInput.value = String(widget(node, "最大任务数")?.value ?? 100);
  maxInput.onchange = () => setWidget(node, "最大任务数", Math.max(1, Number(maxInput.value || 100)));
  const info = document.createElement("span");
  info.className = "status";
  const aspectSelect = document.createElement("select");
  for (const [short, full] of ASPECTS) {
    const opt = document.createElement("option");
    opt.value = full;
    opt.textContent = short;
    aspectSelect.appendChild(opt);
  }
  aspectSelect.value = ensureAspectWidget(node);
  aspectSelect.onchange = () => {
    setWidget(node, "默认宽高比", aspectSelect.value);
    setStatus(`统一宽高比：${aspectSelect.value}`);
    render();
  };
  const mpInput = document.createElement("input");
  mpInput.type = "number";
  mpInput.min = "0.1";
  mpInput.max = "16";
  mpInput.step = "0.1";
  mpInput.value = String(widget(node, "百万像素")?.value ?? 1);
  const commitMp = () => {
    const n = Math.min(16, Math.max(0.1, Number(mpInput.value || 1)));
    setWidget(node, "百万像素", Math.round(n * 10) / 10);
    render();
  };
  mpInput.addEventListener("change", commitMp);
  mpInput.addEventListener("keydown", (e) => e.stopPropagation());
  const stepInput = document.createElement("input");
  stepInput.type = "number";
  stepInput.min = "8";
  stepInput.max = "128";
  stepInput.step = "4";
  stepInput.value = String(widget(node, "对齐倍数")?.value ?? 16);
  const commitStep = () => {
    setWidget(node, "对齐倍数", Math.min(128, Math.max(8, Math.round(Number(stepInput.value || 16)))));
    render();
  };
  stepInput.addEventListener("change", commitStep);
  stepInput.addEventListener("keydown", (e) => e.stopPropagation());
  cfg.append(field("最大任务", maxInput), field("宽高比", aspectSelect), field("百万像素", mpInput), field("倍数", stepInput), info);

  const importPanel = document.createElement("div");
  importPanel.className = "tmp-import-panel";
  const importBox = document.createElement("textarea");
  importBox.className = "tmp-import";
  importBox.placeholder = "16-9-gpt----提示词\n\n4-3-gpt----提示词\n\n3-4-gpt----提示词\n\n标题里的 16-9、4-3、3-4 会自动选宽高比。空行分隔。";
  importBox.addEventListener("keydown", (e) => e.stopPropagation());
  const importActions = document.createElement("div");
  importActions.className = "tmp-row";
  const btnAppend = mk("追加导入");
  const btnReplace = mk("替换导入", "primary");
  importActions.append(btnAppend, btnReplace);
  importPanel.append(importBox, importActions);

  const list = document.createElement("div");
  list.className = "tmp-list";
  const status = document.createElement("div");
  status.className = "tmp-status";
  status.textContent = "准备就绪";

  root.append(actions, cfg, importPanel, list, status);

  const setStatus = (t) => {
    status.textContent = t;
  };

  let importOpen = false;
  const setImportOpen = (open) => {
    importOpen = open;
    importPanel.classList.toggle("show", open);
    btnImportText.classList.toggle("on", open);
  };

  let rendering = false;
  const render = () => {
    if (rendering) return;
    rendering = true;
    try {
      const items = readItems(node);
      const current = Number(widget(node, "index")?.value || 0);
      const globalAspect = ensureAspectWidget(node);
      if (aspectSelect.value !== globalAspect) aspectSelect.value = globalAspect;
      const mp = Number(widget(node, "百万像素")?.value || 1);
      const step = Number(widget(node, "对齐倍数")?.value || 16);
      if (document.activeElement !== mpInput) mpInput.value = String(mp);
      if (document.activeElement !== stepInput) stepInput.value = String(step);
      const currentAspect = normalizeAspect(items[current]?.aspect) || globalAspect;
      const [cw, ch] = calcSize(currentAspect, mp, step);
      info.textContent = `共 ${items.length} 条 · ${mp}MP → ${cw}×${ch}`;
      list.classList.toggle("single", items.length === 1);
      list.replaceChildren();

      items.forEach((item, i) => {
        const card = document.createElement("div");
        card.className = "tmp-card" + (i === current ? " active" : "");
        card.title = "双击放大编辑提示词";

        const head = document.createElement("div");
        head.className = "tmp-card-head";
        const indexEl = document.createElement("span");
        indexEl.className = "tmp-index";
        indexEl.textContent = `#${String(i + 1).padStart(2, "0")}`;
        const nameEl = document.createElement("span");
        nameEl.className = "tmp-name";
        nameEl.textContent = item.name || defaultName(i + 1);
        nameEl.title = "双击修改资产名";
        nameEl.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          nameEl.contentEditable = "true";
          nameEl.classList.add("editing");
          nameEl.focus();
        });
        const commitName = () => {
          nameEl.contentEditable = "false";
          nameEl.classList.remove("editing");
          const next = readItems(node);
          next[i].name = sanitizeName(nameEl.textContent) || defaultName(i + 1);
          const matched = aspectFromName(next[i].name);
          if (matched) next[i].aspect = matched;
          writeItems(node, next);
          render();
        };
        nameEl.addEventListener("blur", commitName);
        nameEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nameEl.blur();
          }
          e.stopPropagation();
        });
        const actionsRow = document.createElement("div");
        actionsRow.className = "tmp-card-actions";
        const btnPick = mk("单选");
        btnPick.onclick = (e) => {
          e.stopPropagation();
          setWidget(node, "index", i);
          render();
          setStatus(`已单选第 ${i + 1} 条`);
        };
        const btnUp = mk("↑");
        btnUp.onclick = (e) => {
          e.stopPropagation();
          if (i === 0) return;
          const next = readItems(node);
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
          writeItems(node, next);
          render();
        };
        const btnDown = mk("↓");
        btnDown.onclick = (e) => {
          e.stopPropagation();
          const next = readItems(node);
          if (i >= next.length - 1) return;
          [next[i + 1], next[i]] = [next[i], next[i + 1]];
          writeItems(node, next);
          render();
        };
        const btnDel = mk("删", "danger");
        btnDel.onclick = (e) => {
          e.stopPropagation();
          const next = readItems(node);
          next.splice(i, 1);
          writeItems(node, next);
          const cur = Number(widget(node, "index")?.value || 0);
          if (cur >= next.length) setWidget(node, "index", Math.max(0, next.length - 1));
          render();
        };
        actionsRow.append(btnPick, btnUp, btnDown, btnDel);
        head.append(indexEl, nameEl, actionsRow);

        const aspectRow = document.createElement("div");
        aspectRow.className = "tmp-card-aspect";
        const cardAspectFull = normalizeAspect(item.aspect) || globalAspect;
        const [cardW, cardH] = calcSize(cardAspectFull, mp, step);
        const aspectTag = document.createElement("span");
        aspectTag.textContent = `${cardW}×${cardH}`;
        const cardAspect = document.createElement("select");
        const follow = document.createElement("option");
        follow.value = "";
        follow.textContent = `跟随统一 ${ASPECTS.find(([, full]) => full === globalAspect)?.[0] || ""}`;
        cardAspect.appendChild(follow);
        for (const [short, full] of ASPECTS) {
          const opt = document.createElement("option");
          opt.value = full;
          opt.textContent = short;
          cardAspect.appendChild(opt);
        }
        cardAspect.value = normalizeAspect(item.aspect) || "";
        cardAspect.title = "标题里的 16-9、4-3、3-4 会自动选上。手选别的比例会盖过标题。";
        cardAspect.addEventListener("mousedown", (e) => e.stopPropagation());
        cardAspect.addEventListener("dblclick", (e) => e.stopPropagation());
        cardAspect.onchange = (e) => {
          e.stopPropagation();
          const next = readItems(node);
          next[i].aspect = normalizeAspect(cardAspect.value);
          writeItems(node, next);
          render();
        };
        aspectRow.append(aspectTag, cardAspect);

        const body = document.createElement("div");
        body.className = "tmp-card-body";
        body.textContent = item.text;

        card.ondblclick = () => {
          openEditModal({
            title: `#${String(i + 1).padStart(2, "0")} ${item.name || defaultName(i + 1)}`,
            text: item.text,
            onSave: (value) => {
              const next = readItems(node);
              next[i].text = value;
              writeItems(node, next);
              render();
            },
          });
        };

        card.addEventListener("click", (e) => {
          if (e.target.closest("button, select")) return;
          if (nameEl.isContentEditable) return;
          setWidget(node, "index", i);
          for (const el of list.querySelectorAll(".tmp-card.active")) el.classList.remove("active");
          card.classList.add("active");
          const picked = normalizeAspect(readItems(node)[i]?.aspect) || globalAspect;
          const [pw, ph] = calcSize(picked, mp, step);
          info.textContent = `共 ${items.length} 条 · ${mp}MP → ${pw}×${ph}`;
        });

        card.append(head, aspectRow, body);
        list.appendChild(card);
      });

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "tmp-status";
        empty.textContent = "暂无提示词。可点「导入文本」粘贴，或新增卡片。";
        list.appendChild(empty);
      }
    } finally {
      rendering = false;
    }
  };

  node.__tmpRender = render;

  const mergeImport = (parsed, mode) => {
    if (!parsed.length) {
      setStatus("没有导入到有效提示词");
      return;
    }
    const current = mode === "replace" ? [] : readItems(node).map((x) => ({ ...x }));
    const incoming = parsed.map((x) => ({ ...x, aspect: normalizeAspect(x.aspect) }));
    const merged = writeItems(node, current.concat(incoming));
    setWidget(node, "index", 0);
    importBox.value = "";
    setImportOpen(false);
    hideWidgets(node);
    setStatus(`已导入 ${parsed.length} 条，当前共 ${merged.length} 条`);
    requestAnimationFrame(() => render());
  };

  btnSaveTxt.onclick = () => {
    const items = readItems(node);
    if (!items.length) return setStatus("没有可保存的提示词");
    const text =
      items
        .map((item) => `${item.name}${NAME_SEP}${String(item.text || "").trim()}`)
        .join("\n\n") + "\n";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "提示词.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(`已保存 ${items.length} 条提示词（名字----提示词，条目之间空行）`);
  };

  btnImportText.onclick = () => setImportOpen(!importOpen);
  btnAppend.onclick = () => mergeImport(parsePromptText(importBox.value), "append");
  btnReplace.onclick = () => mergeImport(parsePromptText(importBox.value), "replace");

  btnAdd.onclick = () => {
    const next = readItems(node);
    next.push({ name: defaultName(next.length + 1), text: "新提示词" });
    writeItems(node, next);
    setWidget(node, "index", next.length - 1);
    render();
  };

  btnTxt.onclick = async () => {
    const files = await pickFiles({ multiple: true });
    if (!files.length) return;
    const collected = [];
    let index = 1;
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name, "zh"))) {
      const text = await readText(file);
      const parsed = parsePromptText(text, index);
      collected.push(...parsed);
      index += Math.max(parsed.length, 1);
    }
    mergeImport(collected, "append");
  };

  btnFolder.onclick = async () => {
    const files = await pickFiles({ multiple: true, directory: true });
    const txts = files.filter((f) => /\.txt$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, "zh"));
    if (!txts.length) return setStatus("文件夹里没有 txt");
    const collected = [];
    let index = 1;
    for (const file of txts) {
      const stem = file.name.replace(/\.txt$/i, "");
      const text = await readText(file);
      const parsed = parsePromptText(text, index, stem);
      collected.push(...parsed);
      index += Math.max(parsed.length, 1);
    }
    mergeImport(collected, "append");
  };

  btnClear.onclick = () => {
    writeItems(node, []);
    setWidget(node, "index", 0);
    setStatus("已清空提示词");
    render();
  };
  btnStop.onclick = async () => {
    node.__tmpStop = true;
    setStatus("正在停止…");
    await interruptAndClearQueue();
    setStatus(node.__tmpBatchRunning ? "已请求停止，等待当前任务中断…" : "已停止");
  };
  btnSingle.onclick = async () => {
    const items = readItems(node);
    if (!items.length) return setStatus("没有可执行提示词");
    await runBatch(node, [Number(widget(node, "index")?.value || 0)], setStatus);
    render();
  };
  btnBatch.title = "从当前选中的提示词开始，执行到最后一条";
  btnBatch.onclick = async () => {
    const items = readItems(node);
    if (!items.length) return setStatus("没有可执行提示词");
    let start = Number(widget(node, "index")?.value || 0);
    if (!Number.isFinite(start)) start = 0;
    start = Math.max(0, Math.min(items.length - 1, Math.floor(start)));
    const indices = [];
    for (let i = start; i < items.length; i++) indices.push(i);
    await runBatch(node, indices, setStatus);
    render();
  };

  const dom = node.addDOMWidget("te_man_pro_batch_ui", "te_man_pro_batch", root, {
    serialize: false,
    hideOnZoom: false,
  });
  useDomLayout(dom, 280);
  root.style.height = "100%";
  root.style.maxHeight = "100%";
  root.style.minHeight = "0";
  root.style.overflow = "hidden";

  render();
  void restorePrompts(node);
}

app.registerExtension({
  name: "TE.ManPro.BatchPrompt",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      try {
        buildUI(this);
      } catch (err) {
        console.error("[feimao tools Batch]", err);
      }
      return r;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const restore = () => {
        hideWidgets(this);
        ensureResolutionWidgets(this);
        this.__tmpRender?.();
        void restorePrompts(this);
      };
      queueMicrotask(restore);
      setTimeout(restore, 0);
      setTimeout(restore, 120);
      return r;
    };
    const onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (o) {
      try {
        const items = readItems(this);
        const payload = {
          items,
          index: Number(widget(this, "index")?.value || 0),
          max_tasks: Number(widget(this, "最大任务数")?.value || 100),
        };
        setWidget(this, "prompts_json", JSON.stringify(items));
        this.properties = this.properties || {};
        this.properties[PROMPTS_PROP] = payload;
        if (o) {
          o.properties = o.properties || {};
          o.properties[PROMPTS_PROP] = payload;
        }
        persistLocal(this, payload);
        void persistDisk(this, payload);
      } catch (_) {}
      return onSerialize?.apply(this, arguments);
    };
  },
});
