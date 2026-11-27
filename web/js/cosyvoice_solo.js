import { app } from "../../../scripts/app.js";

const NODE_CLASS = "feimao_tools_CosyVoice_Solo";
const MAX_SPEAKERS = 6;

const DIALECTS = [
    "普通话", "四川话", "重庆话", "广东话", "粤语", "上海话", "东北话", "北京话", "天津话",
    "河南话", "山东话", "湖南话", "湖北话", "江西话", "福建话", "闽南话", "客家话",
    "陕西话", "山西话", "云南话", "英语", "日语", "韩语",
];
const EMOTIONS = [
    "开心", "生气", "伤心", "恐惧", "惊讶", "厌恶", "平静", "温柔",
    "激动", "悲伤", "严肃", "撒娇", "疲惫", "冷酷", "慵懒", "神秘",
];
const SOUNDS = [
    ["breath", "换气"],
    ["laughter", "笑"],
    ["sigh", "叹气"],
    ["cough", "咳嗽"],
    ["gasp", "倒抽气"],
    ["cry", "哭腔"],
];
const PAUSES = ["0.4", "1.0", "1.5"];
const ROLES = ["S1", "S2", "S3", "S4", "S5", "S6"];

const AI_GUIDE = `你在写配音剧本。写完后只输出剧本本身，不要标题，不要解释，不要用 markdown。

一个人说话时，不要写角色。
多个人说话时，每行开头写角色，对应接上的参考音：
[S1] [S2] [S3] [S4] [S5] [S6]
没写角色的行，跟着上一行的人。第一行没写就是 S1。不要写 S7，也不要写角色名字。

格式：
- 一行一句。
- 标签用英文方括号。
- 一句可以连着写多个标签。
- 没写方言、没写情绪的句子，不要硬加标签。没写方言时按普通话读。

方言和语种，写在这句需要它的位置：
[普通话] [四川话] [重庆话] [广东话] [粤语] [上海话] [东北话] [北京话] [天津话] [河南话] [山东话] [湖南话] [湖北话] [江西话] [福建话] [闽南话] [客家话] [陕西话] [山西话] [云南话] [英语] [日语] [韩语]

情绪：
[开心] [生气] [伤心] [恐惧] [惊讶] [厌恶] [平静] [温柔] [激动] [悲伤] [严肃] [撒娇] [疲惫] [冷酷] [慵懒] [神秘]

同一句里换着说，标签写在换的那个字前面，这一句不要拆成两行：
[普通话]前半句，[四川话]后半句。

副语写在要发出这个声音的位置：
[breath] 换气
[laughter] 笑
[sigh] 叹气
[cough] 咳嗽
[gasp] 倒抽气
[cry] 哭腔

停顿是精确静音，不会被读出来。秒数可以改：
[pause 0.4]
[pause 1.0]
[pause 1.5]
单独一行只写停顿，就是这段静音。

不要自己另起注释。# 只用来弹出标签，@ 只用来选已经接上的参考音。

单人示例：
[普通话] 大家好，我是今天的讲述人。
[开心] 今天只讲一件事。
[pause 0.4]
[四川话][撒娇] 你要不要听嘛。

多人示例：
[S1][普通话] 大家好，我是今天的讲述人。
[S2][开心] 那我们开始吧。
[S1][pause 0.4]
[S1] 先看参考音，再看标签。
`;

function tag(name) {
    return `[${name}] `;
}

function modeWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "模式");
}

function isMulti(node) {
    return modeWidget(node)?.value === "多人";
}

function slotOf(input) {
    const match = /^S([2-6])$/.exec(input?.name || "");
    return match ? Number(match[1]) : 0;
}

function hideModeWidget(widget) {
    if (!widget || widget._feimaoHidden) return;
    widget._feimaoHidden = true;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, minWidth: 0 });
}

function syncSpeakers(node) {
    if (!node?.inputs || node._feimaoSyncing) return;
    node._feimaoSyncing = true;
    try {
        const multi = isMulti(node);
        node._feimaoMulti = multi;
        const first = node.inputs.find((input) => input.name === "参考音频");
        if (first) first.label = multi ? "S1" : "参考音频";
        if (!multi) {
            for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
                const input = node.inputs[index];
                if (slotOf(input) > 1 && input.link == null) node.removeInput(index);
            }
        } else {
            let highest = 1;
            for (const input of node.inputs) {
                if (input.link != null) highest = Math.max(highest, slotOf(input));
            }
            const wanted = Math.min(MAX_SPEAKERS, Math.max(2, highest + 1));
            for (let slot = 2; slot <= wanted; slot += 1) {
                if (!node.inputs.some((input) => slotOf(input) === slot)) node.addInput(`S${slot}`, "AUDIO");
            }
            for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
                const input = node.inputs[index];
                const slot = slotOf(input);
                if (slot > wanted && input.link == null) node.removeInput(index);
            }
            for (const input of node.inputs) {
                const slot = slotOf(input);
                if (slot) input.label = `S${slot}`;
            }
        }
        node._feimaoSyncPanel?.();
        growIfNeeded(node);
        node.setDirtyCanvas?.(true, true);
    } finally {
        node._feimaoSyncing = false;
    }
}

function bindNode(node) {
    if (node._feimaoBound) return;
    node._feimaoBound = true;
    node._feimaoSyncSpeakers = () => syncSpeakers(node);
    const previousConnections = node.onConnectionsChange;
    node.onConnectionsChange = function (...args) {
        const result = previousConnections?.apply(this, args);
        setTimeout(() => syncSpeakers(this), 0);
        return result;
    };
    const previousConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = previousConfigure?.apply(this, args);
        syncSpeakers(this);
        setTimeout(() => syncSpeakers(this), 0);
        return result;
    };
    const widget = modeWidget(node);
    if (widget && !widget._feimaoModeHook) {
        widget._feimaoModeHook = true;
        const previous = widget.callback;
        widget.callback = function (...args) {
            const result = previous?.apply(this, args);
            syncSpeakers(node);
            return result;
        };
    }
}

function growIfNeeded(node) {
    const fitted = node.computeSize?.();
    const current = node.size;
    if (!fitted || !current) return;
    const width = Math.max(current[0], fitted[0]);
    const height = Math.max(current[1], fitted[1]);
    if (width > current[0] + 1 || height > current[1] + 1) node.setSize([width, height]);
}

function scriptWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "剧本");
}

function scriptArea(widget) {
    if (!widget) return null;
    if (widget.inputEl?.tagName === "TEXTAREA") return widget.inputEl;
    const element = widget.element;
    if (element?.tagName === "TEXTAREA") return element;
    return element?.querySelector?.("textarea") || null;
}

function nodeById(id) {
    const nodes = app.graph?.nodes || app.graph?._nodes || [];
    return nodes.find((node) => String(node?.id) === String(id) && node.comfyClass === NODE_CLASS) || null;
}

function scriptTextareas(node) {
    const areas = [];
    const primary = scriptArea(scriptWidget(node));
    if (primary instanceof HTMLTextAreaElement) areas.push(primary);
    const root = document.querySelector(`[data-node-id="${node.id}"]`);
    root?.querySelectorAll("textarea").forEach((area) => {
        if (!areas.includes(area)) areas.push(area);
    });
    return areas;
}

const scriptCaret = new WeakMap();
let lastScriptArea = null;
let lastScriptNodeId = null;

function rememberCaret(area) {
    if (!(area instanceof HTMLTextAreaElement)) return;
    const host = area.closest?.("[data-node-id]");
    const nodeId = host?.dataset?.nodeId || (nodeForArea(area) ? String(nodeForArea(area).id) : "");
    if (!nodeId || !nodeById(nodeId)) return;
    scriptCaret.set(area, {
        start: area.selectionStart ?? 0,
        end: area.selectionEnd ?? area.selectionStart ?? 0,
    });
    lastScriptArea = area;
    lastScriptNodeId = String(nodeId);
}

document.addEventListener("selectionchange", () => {
    if (document.activeElement instanceof HTMLTextAreaElement) rememberCaret(document.activeElement);
}, true);
for (const type of ["keyup", "mouseup", "focusout"]) {
    document.addEventListener(type, (event) => rememberCaret(event.target), true);
}

function setAreaValue(area, value) {
    const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (proto?.set) proto.set.call(area, value);
    else area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));
}

function caretOf(node, area, current) {
    const areas = scriptTextareas(node);
    const live = document.activeElement instanceof HTMLTextAreaElement && areas.includes(document.activeElement)
        ? document.activeElement
        : null;
    const savedArea = !live && lastScriptArea && lastScriptNodeId === String(node.id) && areas.includes(lastScriptArea)
        ? lastScriptArea
        : null;
    const target = live || savedArea || area;
    if (!target) return { area: null, start: current.length, end: current.length };
    if (live) {
        const start = live.selectionStart ?? current.length;
        return { area: live, start, end: live.selectionEnd ?? start };
    }
    const saved = scriptCaret.get(target);
    if (!saved) return { area: target, start: current.length, end: current.length };
    const start = Math.min(saved.start, current.length);
    const end = Math.min(Math.max(saved.end, start), current.length);
    return { area: target, start, end };
}

function placeCaret(area, cursor) {
    if (!(area instanceof HTMLTextAreaElement)) return;
    area.focus();
    area.selectionStart = cursor;
    area.selectionEnd = cursor;
    scriptCaret.set(area, { start: cursor, end: cursor });
    lastScriptArea = area;
}

function insertTag(node, text) {
    const widget = scriptWidget(node);
    if (!widget || !text) return false;
    const areas = scriptTextareas(node);
    const area = areas[0] || null;
    const caret = caretOf(node, area, String(widget.value ?? area?.value ?? ""));
    const source = caret.area || area;
    const current = source ? source.value : String(widget.value ?? "");
    const next = current.slice(0, caret.start) + text + current.slice(caret.end);
    const cursor = caret.start + text.length;
    for (const item of areas) setAreaValue(item, next);
    widget.value = next;
    widget.callback?.(next);
    const focus = caret.area || area;
    if (focus) {
        placeCaret(focus, cursor);
        lastScriptNodeId = String(node.id);
        requestAnimationFrame(() => placeCaret(focus, cursor));
    }
    return true;
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
        document.body.appendChild(area);
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

function flash(button, text) {
    const label = button.dataset.label || button.textContent;
    button.dataset.label = label;
    button.textContent = text;
    window.setTimeout(() => {
        button.textContent = button.dataset.label;
    }, 900);
}

function stop(event) {
    event.preventDefault();
    event.stopPropagation();
}

function makeRow(labelText, options, toValue, node) {
    const row = document.createElement("div");
    row.className = "feimao-cosy-row";

    const label = document.createElement("span");
    label.textContent = labelText;

    const select = document.createElement("select");
    function fill(nextOptions) {
        const previous = select.value;
        select.replaceChildren();
        nextOptions.forEach((option) => {
            const value = Array.isArray(option) ? option[0] : option;
            const text = Array.isArray(option) ? (option[0] ? `${option[0]}  ${option[1]}` : option[1]) : option;
            const item = document.createElement("option");
            item.value = value ? toValue(value) : "";
            item.textContent = text;
            select.appendChild(item);
        });
        if ([...select.options].some((item) => item.value === previous)) select.value = previous;
    }
    fill(options);
    row.setOptions = fill;

    function action(text, primary, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = primary ? "feimao-cosy-solid" : "feimao-cosy-ghost";
        button.textContent = text;
        button.dataset.label = text;
        button.addEventListener("mousedown", stop);
        button.addEventListener("pointerdown", (event) => event.stopPropagation());
        button.addEventListener("click", async (event) => {
            stop(event);
            const ok = await onClick();
            if (ok == null) return;
            flash(button, ok ? (primary ? "已写入" : "已复制") : "失败");
        });
        return button;
    }

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(action("复制", false, () => (select.value ? copyText(select.value) : null)));
    row.appendChild(action("确认", true, async () => (select.value ? insertTag(node, select.value) : null)));
    return row;
}

function makeModeSwitch(node) {
    const wrap = document.createElement("div");
    wrap.className = "feimao-cosy-mode";
    const buttons = {};
    for (const name of ["单人", "多人"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = name;
        button.addEventListener("mousedown", stop);
        button.addEventListener("click", (event) => {
            stop(event);
            const widget = modeWidget(node);
            if (!widget || widget.value === name) return;
            widget.value = name;
            widget.callback?.(name);
            paint();
            syncSpeakers(node);
        });
        buttons[name] = button;
        wrap.appendChild(button);
    }
    function paint() {
        const current = isMulti(node) ? "多人" : "单人";
        for (const [name, button] of Object.entries(buttons)) {
            button.classList.toggle("on", name === current);
        }
    }
    wrap.paint = paint;
    paint();
    return wrap;
}

const quickStyle = document.createElement("style");
quickStyle.textContent = `
.feimao-cosy { display:flex; flex-direction:column; gap:8px; padding:2px 1px 0; color:#f6f1e8;
  font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
.feimao-cosy-mode { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; background:#100e0c; border-radius:12px; }
.feimao-cosy-mode button { height:34px; border:0; border-radius:9px; cursor:pointer; font-size:13px; letter-spacing:.12em;
  background:transparent; color:#8d867c; }
.feimao-cosy-mode button.on { background:#f3ecdf; color:#1c1612; font-weight:650; }
.feimao-cosy-hint { margin:0 6px; font-size:12px; line-height:1.55; color:#8d867c; }
.feimao-cosy-rows { display:flex; flex-direction:column; gap:6px; padding:8px; background:#100e0c; border-radius:12px; }
.feimao-cosy-row { display:grid; grid-template-columns:36px minmax(0,1fr) 44px 52px; gap:8px; align-items:center; }
.feimao-cosy-row > span { font-size:12px; color:#d9d0c3; }
.feimao-cosy select { width:100%; height:32px; min-width:0; padding:0 8px; color:#f6f1e8; background:#1a1613;
  border:1px solid #3a332c; border-radius:8px; outline:none; font-size:12px; }
.feimao-cosy select:focus { border-color:#e2b15a; }
.feimao-cosy-ghost, .feimao-cosy-solid { height:32px; padding:0; border-radius:8px; cursor:pointer; font-size:12px; }
.feimao-cosy-ghost { color:#c8bfb0; background:transparent; border:0; }
.feimao-cosy-ghost:hover { color:#f6f1e8; }
.feimao-cosy-solid { color:#1c1612; background:#f3ecdf; border:0; font-weight:650; }
.feimao-cosy-solid:hover { background:#fff8ee; }
.feimao-cosy-guide { height:36px; cursor:pointer; color:#f3ecdf; background:transparent; border:1px solid #3a332c;
  border-radius:10px; font-size:12px; letter-spacing:.06em; }
.feimao-cosy-guide:hover { border-color:#e2b15a; color:#fff8ee; }
.feimao-cosy-menu { position:fixed; z-index:10050; min-width:220px; max-width:320px; max-height:280px; overflow:auto;
  background:#1c1814; border:1px solid #3a332c; border-radius:12px; box-shadow:0 16px 40px rgba(0,0,0,.55); padding:4px; }
.feimao-cosy-menu.hidden { display:none; }
.feimao-cosy-menu button { display:flex; align-items:center; gap:10px; width:100%; box-sizing:border-box; border:0; border-radius:8px;
  background:transparent; color:#f6f1e8; text-align:left; cursor:pointer; padding:7px 8px; font-size:12px; }
.feimao-cosy-menu button.on, .feimao-cosy-menu button:hover { background:#2a241c; }
.feimao-cosy-menu b { font-weight:650; color:#e2b15a; }
.feimao-cosy-menu span { margin-left:auto; color:#8d867c; font-size:11px; }
.feimao-cosy-menu .empty { padding:8px 10px; color:#8d867c; font-size:12px; }
`;
document.head.appendChild(quickStyle);

const quickMenu = document.createElement("div");
quickMenu.className = "feimao-cosy-menu hidden";
document.body.appendChild(quickMenu);
let quickNode = null;
let quickArea = null;
let quickAt = -1;
let quickQuery = "";
let quickIndex = 0;

function hideQuickMenu() {
    quickMenu.classList.add("hidden");
    quickNode = null;
    quickArea = null;
    quickAt = -1;
    quickQuery = "";
    quickIndex = 0;
}

function quickButtons() {
    return [...quickMenu.querySelectorAll("button")];
}

function paintQuickIndex() {
    const buttons = quickButtons();
    if (!buttons.length) {
        quickIndex = 0;
        return;
    }
    quickIndex = Math.max(0, Math.min(quickIndex, buttons.length - 1));
    buttons.forEach((button, index) => button.classList.toggle("on", index === quickIndex));
    buttons[quickIndex]?.scrollIntoView({ block: "nearest" });
}

function caretRect(area) {
    const style = window.getComputedStyle(area);
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;";
    for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing"]) {
        host.style[key] = style[key];
    }
    host.style.width = `${area.clientWidth}px`;
    host.textContent = area.value.slice(0, area.selectionStart ?? 0);
    const mark = document.createElement("span");
    mark.textContent = "\u200b";
    host.appendChild(mark);
    document.body.appendChild(host);
    const markBox = mark.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    host.remove();
    const box = area.getBoundingClientRect();
    const left = box.left + (markBox.left - hostBox.left) - area.scrollLeft;
    const top = box.top + (markBox.top - hostBox.top) - area.scrollTop;
    const line = Number.parseFloat(style.lineHeight) || markBox.height || 18;
    return { left, top, bottom: top + line, height: line };
}

function placeQuickMenu(area) {
    const caret = caretRect(area);
    quickMenu.classList.remove("hidden");
    const width = Math.min(320, quickMenu.offsetWidth || 240);
    const height = Math.min(280, quickMenu.offsetHeight || 160);
    let left = caret.left;
    let top = caret.bottom + 4;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (top + height > window.innerHeight - 8) top = Math.max(8, caret.top - height - 4);
    quickMenu.style.left = `${Math.max(8, left)}px`;
    quickMenu.style.top = `${Math.max(8, top)}px`;
}

function linkedSpeakers(node) {
    const items = [];
    const first = (node.inputs || []).find((input) => input.name === "参考音频");
    if (first?.link != null) {
        items.push({ tag: "[S1] ", title: isMulti(node) ? "S1" : "参考音", note: "已接入" });
    }
    if (!isMulti(node)) return items;
    const extras = (node.inputs || [])
        .map((input) => ({ input, slot: slotOf(input) }))
        .filter((item) => item.slot > 1 && item.input.link != null)
        .sort((a, b) => a.slot - b.slot);
    for (const item of extras) {
        items.push({ tag: `[S${item.slot}] `, title: `S${item.slot}`, note: "已接入" });
    }
    return items;
}

function tagChoices() {
    const items = [];
    for (const name of DIALECTS) items.push({ tag: `[${name}] `, title: name, note: "方言" });
    for (const name of EMOTIONS) items.push({ tag: `[${name}] `, title: name, note: "情绪" });
    for (const [name, label] of SOUNDS) items.push({ tag: `[${name}] `, title: name, note: label });
    for (const seconds of PAUSES) items.push({ tag: `[pause ${seconds}] `, title: `pause ${seconds}`, note: "停顿" });
    return items;
}

function triggerBeforeCaret(area) {
    const pos = area.selectionStart ?? 0;
    const text = area.value.slice(0, pos);
    for (let index = text.length - 1; index >= 0; index -= 1) {
        const char = text[index];
        if (char === "@" || char === "#") {
            return { at: index, kind: char === "@" ? "audio" : "tag", query: text.slice(index + 1) };
        }
        if (/\s/.test(char)) return null;
    }
    return null;
}

function nodeForArea(area) {
    const host = area?.closest?.("[data-node-id]");
    const hosted = host?.dataset?.nodeId ? nodeById(host.dataset.nodeId) : null;
    if (hosted) return hosted;
    const nodes = app.graph?.nodes || app.graph?._nodes || [];
    for (const node of nodes) {
        if (node?.comfyClass !== NODE_CLASS) continue;
        const widget = scriptWidget(node);
        if (!widget) continue;
        if (widget.inputEl === area || widget.element === area) return node;
        if (widget.element?.contains?.(area)) return node;
    }
    return null;
}

function linkedRoleOptions(node) {
    const linked = linkedSpeakers(node);
    if (!linked.length) return [["", "先接上参考音"]];
    return linked.map((item) => item.title);
}

function writeQuickTag(node, area, insert) {
    const value = area.value;
    const next = `${value.slice(0, quickAt)}${insert}${value.slice(quickAt + 1 + quickQuery.length)}`;
    setAreaValue(area, next);
    const cursor = quickAt + insert.length;
    area.selectionStart = cursor;
    area.selectionEnd = cursor;
    const widget = scriptWidget(node);
    if (widget) {
        widget.value = next;
        widget.callback?.(next);
    }
    hideQuickMenu();
    area.focus();
}

function showQuickMenu(node, area, info) {
    const query = String(info.query || "").toLowerCase();
    const source = info.kind === "audio" ? linkedSpeakers(node) : tagChoices();
    const matched = source.filter((item) => !query || `${item.title} ${item.note} ${item.tag}`.toLowerCase().includes(query));
    quickMenu.replaceChildren();
    quickNode = node;
    quickArea = area;
    quickAt = info.at;
    quickQuery = info.query || "";
    quickIndex = 0;
    if (!matched.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = info.kind === "audio"
            ? (source.length ? "没有匹配的参考音" : "还没有接上参考音")
            : "没有匹配的标签";
        quickMenu.appendChild(empty);
    }
    matched.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.tag = item.tag;
        const title = document.createElement("b");
        title.textContent = item.title;
        const note = document.createElement("span");
        note.textContent = item.note;
        button.append(title, note);
        button.addEventListener("pointerenter", () => {
            quickIndex = quickButtons().indexOf(button);
            paintQuickIndex();
        });
        button.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            writeQuickTag(node, area, item.tag);
        });
        quickMenu.appendChild(button);
    });
    paintQuickIndex();
    placeQuickMenu(area);
}

function refreshQuickMenu(area) {
    const node = nodeForArea(area);
    if (!node) {
        if (quickArea === area) hideQuickMenu();
        return;
    }
    const info = triggerBeforeCaret(area);
    if (!info) {
        if (quickArea === area) hideQuickMenu();
        return;
    }
    showQuickMenu(node, area, info);
}

document.addEventListener("input", (event) => {
    const area = event.target;
    if (area?.tagName !== "TEXTAREA") return;
    refreshQuickMenu(area);
}, true);

document.addEventListener("keyup", (event) => {
    const area = event.target;
    if (area?.tagName !== "TEXTAREA") return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") refreshQuickMenu(area);
}, true);

document.addEventListener("keydown", (event) => {
    if (quickMenu.classList.contains("hidden")) return;
    const area = event.target;
    if (area !== quickArea) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const buttons = quickButtons();
        if (!buttons.length) return;
        event.preventDefault();
        event.stopPropagation();
        quickIndex = (quickIndex + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        paintQuickIndex();
        return;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        const button = quickButtons()[quickIndex];
        if (!button?.dataset.tag) return;
        event.preventDefault();
        event.stopPropagation();
        writeQuickTag(quickNode, quickArea, button.dataset.tag);
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hideQuickMenu();
    }
}, true);

document.addEventListener("focusout", (event) => {
    if (event.target !== quickArea) return;
    window.setTimeout(() => {
        if (quickMenu.contains(document.activeElement)) return;
        if (document.activeElement !== quickArea) hideQuickMenu();
    }, 160);
}, true);

function addPanel(node) {
    if (node._feimaoCosyPanel) return;
    node._feimaoCosyPanel = true;
    hideModeWidget(modeWidget(node));
    bindNode(node);

    const root = document.createElement("div");
    root.className = "feimao-cosy";
    root.addEventListener("mousedown", (event) => event.stopPropagation());
    root.addEventListener("pointerdown", (event) => event.stopPropagation());

    const mode = makeModeSwitch(node);
    const hint = document.createElement("div");
    hint.className = "feimao-cosy-hint";
    const rows = document.createElement("div");
    rows.className = "feimao-cosy-rows";
    const roleRow = makeRow("角色", ROLES, tag, node);
    rows.appendChild(roleRow);
    rows.appendChild(makeRow("方言", DIALECTS, tag, node));
    rows.appendChild(makeRow("情绪", EMOTIONS, tag, node));
    rows.appendChild(makeRow("副语", SOUNDS, (name) => tag(name), node));
    rows.appendChild(makeRow("停顿", PAUSES, (seconds) => `[pause ${seconds}] `, node));
    root.appendChild(mode);
    root.appendChild(hint);
    root.appendChild(rows);

    const guide = document.createElement("button");
    guide.type = "button";
    guide.className = "feimao-cosy-guide";
    guide.textContent = "复制说明书给 AI";
    guide.dataset.label = "复制说明书给 AI";
    guide.title = "贴给写稿的 AI。它按这个格式写完，再整段贴回剧本。";
    guide.addEventListener("mousedown", stop);
    guide.addEventListener("click", async (event) => {
        stop(event);
        const ok = await copyText(AI_GUIDE);
        flash(guide, ok ? "说明书已复制" : "失败");
    });
    root.appendChild(guide);

    function syncPanel() {
        const multi = isMulti(node);
        mode.paint();
        roleRow.setOptions?.(linkedRoleOptions(node));
        roleRow.style.display = multi ? "grid" : "none";
        hint.textContent = multi
            ? "@ 选已经接上的参考音，# 选方言、情绪、副语和停顿。接上一条会再长出下一条，最多 S6。"
            : "@ 插入当前参考音，# 选方言、情绪、副语和停顿。";
    }
    node._feimaoSyncPanel = syncPanel;
    syncPanel();

    node.addDOMWidget("feimao_cosy_tags", "div", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => (node._feimaoMulti ? 360 : 318),
    });
    requestAnimationFrame(() => syncSpeakers(node));
}

function paintNode(node) {
    node.color = "#2c2824";
    node.bgcolor = "#171512";
}

app.registerExtension({
    name: "feimao.cosyvoice.solo",
    nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        paintNode(node);
        addPanel(node);
        const previous = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = previous?.apply(this, args);
            paintNode(this);
            return result;
        };
    },
});
