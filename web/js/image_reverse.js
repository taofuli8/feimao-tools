import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { hideComfyWidget, useDomLayout } from "./hide_widget.js";

const NODE_CLASS = "feimao_tools_Image_Reverse";
const STYLE_ID = "tmp-rev-style-v3";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tmp-rev { width:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:8px; color:var(--input-text); }
    .tmp-rev-label { font-size:12px; font-weight:700; color:#ddd; }
    .tmp-rev-prompt, .tmp-rev-result { width:100%; box-sizing:border-box; resize:vertical; border-radius:8px;
      border:1px solid rgba(255,255,255,.16); background:rgba(0,0,0,.28); color:#eee; font:13px/1.45 inherit; padding:8px; }
    .tmp-rev-prompt { min-height:72px; height:96px; }
    .tmp-rev-result { min-height:160px; height:210px; white-space:pre-wrap; }
    .tmp-rev-actions, .tmp-rev-copies, .tmp-rev-grids { display:flex; gap:8px; }
    .tmp-rev-actions button, .tmp-rev-copies button, .tmp-rev-grids button { flex:1; border:0; border-radius:8px; padding:8px 10px; font-weight:750; cursor:pointer; }
    .tmp-rev-go { background:#2f6fed; color:#fff; }
    .tmp-rev-copy, .tmp-rev-ai { background:#1c1c1c; color:#fff; border:1px solid rgba(255,255,255,.35) !important; }
    .tmp-rev-ai { background:#1f6b45; }
    .tmp-rev-go:disabled { opacity:.55; cursor:wait; }
    .tmp-rev-status { min-height:18px; font-size:12px; color:#bbb; }
  `;
  document.head.appendChild(style);
}

function widget(node, name) {
  return (node.widgets || []).find((item) => item?.name === name);
}

function hideWidget(node, name) {
  hideComfyWidget(widget(node, name));
}

function isReverse(node) {
  return !!node && (node.comfyClass === NODE_CLASS || node.type === NODE_CLASS);
}

function readResult(node) {
  return String(node.__tmpResult?.value || widget(node, "结果")?.value || "");
}

function showResult(node, text) {
  const value = String(text || "");
  const item = widget(node, "结果");
  if (item) item.value = value;
  if (node.__tmpResult) node.__tmpResult.value = value;
}

function graphLink(node, id) {
  const graph = node.graph || app.graph;
  return graph?.getLink?.(id) || graph?.links?.[id] || null;
}

function linkOriginId(link) {
  if (!link) return null;
  if (Array.isArray(link)) return link[1];
  return link.origin_id ?? link.originId ?? null;
}

function editorToTokens(root) {
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
  return out.replace(/\u00a0/g, " ").replace(/\n+$/g, "");
}

function sourcePromptNode(node) {
  const input = (node.inputs || []).find((item) => item?.name === "合成提示词");
  if (input?.link == null) return null;
  const origin = linkOriginId(graphLink(node, input.link));
  return origin == null ? null : (node.graph || app.graph)?.getNodeById?.(origin) || null;
}

function sourceStyle(node) {
  const source = sourcePromptNode(node);
  const choice = source ? widget(source, "引用格式")?.value || "自动" : "自动";
  const sent = source ? widget(source, "送出格式")?.value || "H3 <Picture N>" : "H3 <Picture N>";
  const style = choice && choice !== "自动" ? choice : sent;
  const leadRaw = source ? Number(widget(source, "外部图片")?.value || 0) : 0;
  const lead = Number.isFinite(leadRaw) ? Math.max(0, Math.min(20, Math.round(leadRaw))) : 0;
  return { qwen: String(style).startsWith("千问"), lead };
}

function tagForSource(node, number) {
  const style = sourceStyle(node);
  const shown = Number(number) + style.lead;
  return style.qwen ? `<image${shown}>` : `<Picture ${shown}>`;
}

function adaptRuleTags(node, text) {
  return String(text).replace(/<image\s*(\d+)\s*>/gi, (_, number) => tagForSource(node, Number(number)));
}

const GRID_RULES = {
  "九宫格": `你是电影分镜提示词作者。输入是【故事】文本，以及故事里用图片编号点名的人物和场景参考。请直接输出一段完整的中文提示词（可直接喂给出图模型），只输出提示词正文，不要解释、不要加标题。

【参考素材职责】（各管各，不许混用）
- <image0> 是空白九宫格模板，由工作流的开关接入，不从图片提示词节点出。只负责 3×3 网格和分隔线。提示词里必须写到 <image0>，不要改这个编号，不要删掉。
- 人物和场景用我原文里的编号，从 <image1> 起。有几张、先后顺序都以原文为准，不要重排，不要改号，不要合并。
- 每张图是人物还是场景，以故事原文的写法为准。人物图只定这个人的脸、发型、体型、服装、配饰。场景图只定这一处的空间、陈设、光线时段。

【全局一致性】
- 9 格里，同一个人的脸、发型、服装不许变；同一处场景的陈设和光线不许变。故事没写的人物不要多出来。
- 防串脸：不同人物的脸和衣服不许互换。外形相近时，每格重复这个人的可见区分点（发型轮廓、服装颜色、左右站位）。
- 轴线：同一场景里同框的人，先定左右站位、各自视线和摄像机在哪一侧。正反打、过肩不许越轴，9 格屏幕方向保持一致。换场景就按原文换，不要把这一处的陈设画进另一处。

【种子扩写（输入只有一句话时）】
- 如果【故事】只有谁、在哪、一句话（如“多年不见相认”“同学聚餐”“上学路上”），你先把它扩成完整起承转合再拆9格。
- 扩写按三选一贴合主题：温情向（相遇→小冲突→意外→和解）、搞笑向（追逐→倒霉→反杀→和好）、悬疑向（平静→异样→揭秘→反转）。
- 反转必须有且只能有一个，落点必须收住（和好/相认/告别三选一贴合主题的）。
- 扩出来的起承转合只用在分格里，不要输出扩写过程，只输出最终提示词。

【9 格剧情】
- 把【故事】压缩成 9 个连续可见节拍，每格一个主要信息、一个清晰瞬间，不在同一格叠加多个时间状态。
- 默认节奏供参考（按故事自然调整，不硬套）：建立→入场→纠葛→反应→对抗→情绪点→反转→高潮→落点收束。
- 景别按故事安排，保证有一两个能看清脸的中近景或近景，其余远近搭配。
- 每格写清：出场人物+位置朝向、景别机位、动作、表情视线、本格剧情信息。

【排版与排除项】
- 输出一张 3×3 九宫格，9 格从左到右、从上到下读，格间细白线分隔，不越格不跨线，不缺格不重叠。
- 格子里不许出现任何数字编号、文字、水印、logo、对话框、字幕、拟声词。
- 【故事】里混着的音效配乐只当节奏参考、一律不画；时长只用来分配 9 格剧情比重；对白只当表情演技参考。`,
  "六宫格": `你是电影分镜提示词作者。输入是【故事】文本，以及故事里用图片编号点名的人物和场景参考。请直接输出一段完整的中文提示词（可直接喂给出图模型），只输出提示词正文，不要解释、不要加标题。

【参考素材职责】（各管各，不许混用）
- <image0> 是空白六宫格模板，由工作流的开关接入，不从图片提示词节点出。只负责 2×3 网格（3列×2行）和分隔线。提示词里必须写到 <image0>，不要改这个编号，不要删掉。
- 人物和场景用我原文里的编号，从 <image1> 起。有几张、先后顺序都以原文为准，不要重排，不要改号，不要合并。
- 每张图是人物还是场景，以故事原文的写法为准。人物图只定这个人的脸、发型、体型、服装、配饰。场景图只定这一处的空间、陈设、光线时段。

【全局一致性】
- 6 格里，同一个人的脸、发型、服装不许变；同一处场景的陈设和光线不许变。故事没写的人物不要多出来。
- 防串脸：不同人物的脸和衣服不许互换。外形相近时，每格重复这个人的可见区分点（发型轮廓、服装颜色、左右站位）。
- 轴线：同一场景里同框的人，先定左右站位、各自视线和摄像机在哪一侧。正反打、过肩不许越轴，6 格屏幕方向保持一致。换场景就按原文换，不要把这一处的陈设画进另一处。

【种子扩写（输入只有一句话时）】
- 如果【故事】只有谁、在哪、一句话（如“多年不见相认”“同学聚餐”“上学路上”），你先把它扩成完整起承转合再拆6格。
- 扩写按三选一贴合主题：温情向（相遇→小冲突→意外→和解）、搞笑向（追逐→倒霉→反杀→和好）、悬疑向（平静→异样→揭秘→反转）。
- 反转必须有且只能有一个，落点必须收住（和好/相认/告别三选一贴合主题的）。
- 扩出来的起承转合只用在分格里，不要输出扩写过程，只输出最终提示词。

【6 格剧情】
- 把【故事】压缩成 6 个连续可见节拍，每格一个主要信息、一个清晰瞬间，不在同一格叠加多个时间状态。
- 默认节奏供参考（按故事自然调整，不硬套）：建立→入场→纠葛→情绪点→反转→落点收束。
- 景别按故事安排，保证有一两个能看清脸的中近景或近景，其余远近搭配。
- 每格写清：出场人物+位置朝向、景别机位、动作、表情视线、本格剧情信息。

【排版与排除项】
- 输出一张 2×3 六宫格（3列×2行），6 格从左到右、从上到下读，格间细白线分隔，不越格不跨线，不缺格不重叠。
- 格子里不许出现任何数字编号、文字、水印、logo、对话框、字幕、拟声词。
- 【故事】里混着的音效配乐只当节奏参考、一律不画；时长只用来分配 6 格剧情比重；对白只当表情演技参考。`,
};

function sourceRaw(node) {
  const source = sourcePromptNode(node);
  if (!source) return "";
  if (source.__tmpPromptReady && source.__tmpEditor) return editorToTokens(source.__tmpEditor);
  return String(widget(source, "prompt_raw")?.value || "");
}

function sourcePromptText(node) {
  return sourceRaw(node).replace(/\{\{img:(\d+)\}\}/g, (_, number) => tagForSource(node, Number(number)));
}

function referencedNumbers(raw) {
  const seen = [];
  const pattern = /\{\{img:(\d+)\}\}|<Picture\s+(\d+)\s*>|<image\s*(\d+)\s*>|@图片\s*(\d+)/gi;
  let match = pattern.exec(raw);
  while (match) {
    const number = Number(match[1] || match[2] || match[3] || match[4]);
    if (number > 0 && !seen.includes(number)) seen.push(number);
    match = pattern.exec(raw);
  }
  return seen;
}


function captionMap(text) {
  const map = new Map();
  const pattern = /<Picture\s+(\d+)\s*>([\s\S]*?)(?=<Picture\s+\d+\s*>|$)/gi;
  let match = pattern.exec(text);
  while (match) {
    map.set(Number(match[1]), match[2].trim());
    match = pattern.exec(text);
  }
  return map;
}

function gridText(node, mode) {
  const numbers = referencedNumbers(sourceRaw(node));
  const captions = captionMap(readResult(node));
  const lines = numbers.map((number) => `${tagForSource(node, number)}${captions.get(number) || ""}`);
  return [
    "这是我要合成的图片内容--",
    sourcePromptText(node).trim(),
    "",
    "这是每张图片的内容-",
    lines.join("\n\n"),
    "",
    `请根据每张图片的内容扩写我原来的合成需求。人物和场景有几张、先后顺序、图片编号，都以我原文为准，不要改编号，不要增删我点过名的图。${tagForSource(node, 0)} 是空白宫格模板，工作流已经接好，提示词里要写到它，不要把它算进我上传的图。只返回扩写好的提示词正文，不要解释，不要加标题。`,
    "",
    adaptRuleTags(node, GRID_RULES[mode]),
  ].join("\n");
}

function aiText(node) {
  return [
    "这是我要合成的图片内容--",
    sourcePromptText(node).trim(),
    "",
    "这是每张图片的内容-",
    readResult(node).trim(),
    "",
    "请根据每张图片的内容扩写并优化我原来的合成需求。不要把各张图的反推提示词单独写成一段返回，扩写结果里要保留我原来提示词中的合成需求。扩写结果必须是一整段完整提示词，不要分段，不要换行，只返回扩写好的提示词。",
  ].join("\n");
}

function failureText(err) {
  const body = err?.response;
  const error = body?.error;
  if (typeof error === "string" && error) return error;
  if (error?.message) return String(error.message);
  const nodeErrors = body?.node_errors;
  if (nodeErrors) {
    const first = Object.values(nodeErrors)[0];
    const message = first?.errors?.[0]?.message || first?.errors?.[0]?.details;
    if (message) return String(message);
  }
  return err?.message || "反推没有排上队";
}

function enableBranch(node) {
  const saved = [];
  const seen = new Set();
  const graph = node.graph || app.graph;
  const walk = (current) => {
    if (!current || seen.has(current.id)) return;
    seen.add(current.id);
    saved.push([current, current.mode]);
    current.mode = 0;
    for (const input of current.inputs || []) {
      if (input?.link == null) continue;
      const origin = linkOriginId(graphLink(current, input.link));
      if (origin == null) continue;
      walk(graph?.getNodeById?.(origin));
    }
  };
  walk(node);
  return saved;
}

async function startReverse(node) {
  const saved = enableBranch(node);
  const runFlag = widget(node, "本次执行");
  if (runFlag) runFlag.value = true;
  if (node.__tmpGo) node.__tmpGo.disabled = true;
  if (node.__tmpStatus) node.__tmpStatus.textContent = "正在反推已上传的图…";
  try {
    const promptBox = node.__tmpPrompt;
    const promptWidget = widget(node, "提示词");
    if (promptBox && promptWidget) promptWidget.value = promptBox.value;
    const packed = await app.graphToPrompt();
    await api.queuePrompt(0, packed, { partialExecutionTargets: [String(node.id)] });
  } catch (err) {
    if (node.__tmpStatus) node.__tmpStatus.textContent = failureText(err);
    if (node.__tmpGo) node.__tmpGo.disabled = false;
  } finally {
    if (runFlag) runFlag.value = false;
    for (const [current, mode] of saved) current.mode = mode;
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
}

async function copyResult(node) {
  const text = readResult(node);
  if (!text) {
    if (node.__tmpStatus) node.__tmpStatus.textContent = "还没有反推结果";
    return;
  }
  await writeClipboard(text);
  if (node.__tmpStatus) node.__tmpStatus.textContent = "已复制反推结果";
}

async function copyForAi(node) {
  if (!sourcePromptNode(node)) {
    if (node.__tmpStatus) node.__tmpStatus.textContent = "先把图片提示词的「提示词」接到这里";
    return;
  }
  await writeClipboard(aiText(node));
  if (node.__tmpStatus) node.__tmpStatus.textContent = readResult(node).trim() ? "已复制给 AI" : "已复制给 AI，反推结果还是空的";
}

async function copyGrid(node, mode) {
  if (!sourcePromptNode(node)) {
    if (node.__tmpStatus) node.__tmpStatus.textContent = "先把图片提示词的「提示词」接到这里";
    return;
  }
  await writeClipboard(gridText(node, mode));
  const empty = !readResult(node).trim();
  if (node.__tmpStatus) node.__tmpStatus.textContent = empty ? `已复制${mode}提示词，反推结果还是空的` : `已复制${mode}提示词`;
}

function buildUI(node) {
  if (node.__tmpBuilt) return;
  node.__tmpBuilt = true;
  ensureStyle();
  hideWidget(node, "提示词");
  hideWidget(node, "结果");
  hideWidget(node, "本次执行");
  const root = document.createElement("div");
  root.className = "tmp-rev";
  const promptLabel = document.createElement("div");
  promptLabel.className = "tmp-rev-label";
  promptLabel.textContent = "反推要求";
  const prompt = document.createElement("textarea");
  prompt.className = "tmp-rev-prompt";
  prompt.value = String(widget(node, "提示词")?.value || "");
  prompt.addEventListener("input", () => {
    const item = widget(node, "提示词");
    if (item) item.value = prompt.value;
  });
  const resultLabel = document.createElement("div");
  resultLabel.className = "tmp-rev-label";
  resultLabel.textContent = "反推结果";
  const result = document.createElement("textarea");
  result.className = "tmp-rev-result";
  result.readOnly = true;
  result.value = String(widget(node, "结果")?.value || "");
  const actions = document.createElement("div");
  actions.className = "tmp-rev-actions";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "tmp-rev-go";
  go.textContent = "开始反推";
  go.addEventListener("click", (event) => {
    event.stopPropagation();
    void startReverse(node);
  });
  const copies = document.createElement("div");
  copies.className = "tmp-rev-copies";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "tmp-rev-copy";
  copy.textContent = "一键复制";
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyResult(node);
  });
  const ai = document.createElement("button");
  ai.type = "button";
  ai.className = "tmp-rev-ai";
  ai.textContent = "复制给AI";
  ai.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyForAi(node);
  });
  const status = document.createElement("div");
  status.className = "tmp-rev-status";
  const grids = document.createElement("div");
  grids.className = "tmp-rev-grids";
  for (const mode of ["九宫格", "六宫格"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tmp-rev-ai";
    button.textContent = `复制${mode}提示词`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void copyGrid(node, mode);
    });
    grids.appendChild(button);
  }
  actions.append(go);
  copies.append(copy, ai);
  root.append(promptLabel, prompt, resultLabel, result, actions, copies, grids, status);
  node.__tmpPrompt = prompt;
  node.__tmpResult = result;
  node.__tmpGo = go;
  node.__tmpStatus = status;
  const dom = node.addDOMWidget("tmp_rev_ui", "tmp_rev", root, {
    serialize: false,
    hideOnZoom: false,
  });
  useDomLayout(dom, 508, 508);
  root.style.width = "100%";
  root.style.height = "100%";
  root.style.maxHeight = "100%";
  root.style.overflow = "auto";
}

function onExecuted(event) {
  const detail = event.detail || event;
  const node = app.graph?.getNodeById?.(detail?.node) || app.graph?.getNodeById?.(Number(detail?.node));
  if (!isReverse(node)) return;
  const text = detail?.output?.text?.[0];
  if (typeof text !== "string") return;
  showResult(node, text);
  if (node.__tmpGo) node.__tmpGo.disabled = false;
  if (node.__tmpStatus) node.__tmpStatus.textContent = text ? `已写出 ${text.split("<Picture ").length - 1} 张` : "没有得到反推文字";
}

app.registerExtension({
  name: "feimao.tools.ImageReverse",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onCreated?.apply(this, arguments);
      try { buildUI(this); } catch (err) { console.error("[feimao tools 批量反推]", err); }
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      const node = this;
      setTimeout(() => {
        hideWidget(node, "提示词");
        hideWidget(node, "结果");
        hideWidget(node, "本次执行");
        if (node.__tmpPrompt) node.__tmpPrompt.value = String(widget(node, "提示词")?.value || "");
        if (node.__tmpResult) node.__tmpResult.value = String(widget(node, "结果")?.value || "");
      }, 0);
      return result;
    };
  },
  setup() {
    api.addEventListener("executed", onExecuted);
    api.addEventListener("execution_error", (event) => {
      const detail = event.detail || event;
      const node = app.graph?.getNodeById?.(detail?.node) || app.graph?.getNodeById?.(Number(detail?.node));
      if (!isReverse(node)) return;
      if (node.__tmpGo) node.__tmpGo.disabled = false;
      if (node.__tmpStatus) node.__tmpStatus.textContent = detail?.exception_message || "反推失败";
    });
    api.addEventListener("execution_interrupted", () => {
      for (const node of app.graph?.nodes || []) {
        if (!isReverse(node)) continue;
        if (node.__tmpGo) node.__tmpGo.disabled = false;
      }
    });
  },
});
