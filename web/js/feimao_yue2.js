import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_CLASS = "YuE2MusicCreate";
const FOLDER_SIZE = 20;
const FOLDER_GAP = 6;

function collapseWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.serialize = false;
    widget.options ??= {};
    widget.options.hidden = true;
    widget.options.serialize = false;
    widget.options.surfaces = { canvas: "never", vueNode: "never", panel: "never" };
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, minWidth: 0 });
}

function hideExtraRows(widget) {
    if (widget?.name === "upload" || widget?.name === "audioUI" || widget?.type === "audioUI" || widget?.type === "feimaoAudio") {
        collapseWidget(widget);
    }
}

function uploadedName(data) {
    if (!data?.name) return "";
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

async function uploadAudio(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("overwrite", "true");
    body.append("type", "input");
    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) throw new Error(`上传失败 ${response.status}`);
    return uploadedName(await response.json());
}

function chooseReference(widget) {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus,.wma,.aiff,.aif,.mp4,.webm";
    picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file) return;
        try {
            const name = await uploadAudio(file);
            if (!name) return;
            const values = widget.options?.values;
            if (Array.isArray(values) && !values.includes(name)) values.push(name);
            widget.value = name;
            widget.callback?.(name);
        } catch (error) {
            console.error("[feimao yue2]", error);
            alert(`参考音乐上传失败：${error.message || error}`);
        }
    };
    picker.click();
}

function paintFolder(ctx, x, y, height) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = "#222";
    ctx.strokeStyle = "#666";
    ctx.roundRect(x, y, height, height, height * 0.5);
    ctx.fill();
    ctx.stroke();
    const centerX = x + height * 0.5;
    const centerY = y + height * 0.52;
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(centerX - 5.5, centerY - 3, 11, 7.5, 1.2);
    ctx.moveTo(centerX - 5.5, centerY - 1.2);
    ctx.lineTo(centerX - 2.2, centerY - 4.2);
    ctx.lineTo(centerX + 0.4, centerY - 1.2);
    ctx.stroke();
    ctx.restore();
}

function folderStartsAt(width) {
    return width - 15 - FOLDER_SIZE;
}

function attachFolderButton(widget) {
    if (!widget || widget.__feimaoFolder) return;
    widget.__feimaoFolder = true;
    widget.label = "参考音乐";

    const originalDraw = typeof widget.draw === "function" ? widget.draw : null;
    const originalDrawWidget = typeof widget.drawWidget === "function" ? widget.drawWidget.bind(widget) : null;
    const originalClick = typeof widget.onClick === "function" ? widget.onClick.bind(widget) : null;

    widget.draw = function (ctx, node, width, y, height, lowQuality) {
        const drawWidth = Math.max(120, width - FOLDER_SIZE - FOLDER_GAP);
        if (originalDraw) originalDraw.call(this, ctx, node, drawWidth, y, height, lowQuality);
        else if (originalDrawWidget) originalDrawWidget(ctx, { width: drawWidth, showText: true });
        paintFolder(ctx, folderStartsAt(width), this.y ?? y, this.height ?? height);
    };

    widget.onClick = function (args) {
        const event = args?.e;
        const node = args?.node;
        if (event && node) {
            const x = event.canvasX - node.pos[0];
            const width = this.width || node.size[0];
            if (x >= folderStartsAt(width)) {
                chooseReference(this);
                return;
            }
        }
        return originalClick?.(args);
    };
}

const FIELD_LABELS = {
    音乐描述: "风格",
    歌词: "歌词",
};

function addFieldLabel(widget, text) {
    const textarea = widget?.element;
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.dataset.feimaoLabel) return;
    const box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;min-height:0;box-sizing:border-box;gap:4px;";
    const label = document.createElement("div");
    label.textContent = text;
    label.style.cssText = "flex:none;height:16px;line-height:16px;font-size:13px;color:#f2f2f2;padding:0 2px;";
    textarea.dataset.feimaoLabel = text;
    textarea.style.flex = "1 1 auto";
    textarea.style.minHeight = "0";
    textarea.style.width = "100%";
    box.append(label, textarea);
    widget.element = box;
    widget.label = text;
}

function lyricsArea(widget) {
    const element = widget?.element;
    if (element instanceof HTMLTextAreaElement) return element;
    return element?.querySelector?.("textarea") ?? null;
}

function setLyricsLocked(node) {
    const mode = node.widgets?.find((widget) => widget.name === "制作类型");
    const lyrics = node.widgets?.find((widget) => widget.name === "歌词");
    const area = lyricsArea(lyrics);
    if (!area) return;
    const locked = mode?.value === "纯音乐" || mode?.value === "ABC曲谱";
    area.readOnly = locked;
    area.style.opacity = locked ? "0.45" : "1";
    area.title = locked ? "这个模式不使用歌词" : "";
    const label = lyrics.element instanceof HTMLElement ? lyrics.element.querySelector?.("div") : null;
    if (label && label !== area) label.style.opacity = locked ? "0.45" : "1";
}

function bindLyricsLock(node) {
    setLyricsLocked(node);
    if (node.__feimaoLyricsLock) return;
    node.__feimaoLyricsLock = true;
    const mode = node.widgets?.find((widget) => widget.name === "制作类型");
    if (mode) {
        const previous = mode.callback;
        mode.callback = function () {
            const result = previous?.apply(this, arguments);
            setLyricsLocked(node);
            return result;
        };
    }
    const previousConfigure = node.onConfigure;
    node.onConfigure = function () {
        const result = previousConfigure?.apply(this, arguments);
        setLyricsLocked(node);
        return result;
    };
}

function ensureAudioPreview(nodeData) {
    const required = nodeData.input?.required;
    if (!required?.audio) return;
    const upload = required.upload;
    if (upload) delete required.upload;
    if (!required.audioUI && !nodeData.input?.optional?.audioUI) {
        required.audioUI = ["AUDIO_UI", { hidden: true }];
    }
    if (upload) required.upload = upload;
}

app.registerExtension({
    name: "feimao.yue2",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_CLASS || nodeType.prototype.__feimaoYue2Patched) return;
        ensureAudioPreview(nodeData);
        nodeType.prototype.__feimaoYue2Patched = true;
        const addWidget = nodeType.prototype.addWidget;
        nodeType.prototype.addWidget = function () {
            const widget = addWidget.apply(this, arguments);
            hideExtraRows(widget);
            if (widget?.name === "audio") attachFolderButton(widget);
            return widget;
        };
        const addDOMWidget = nodeType.prototype.addDOMWidget;
        nodeType.prototype.addDOMWidget = function () {
            const widget = addDOMWidget.apply(this, arguments);
            hideExtraRows(widget);
            return widget;
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        try {
            const audio = node.widgets?.find((widget) => widget.name === "audio");
            if (audio) attachFolderButton(audio);
            for (const widget of node.widgets ?? []) {
                hideExtraRows(widget);
                const text = FIELD_LABELS[widget.name];
                if (text) addFieldLabel(widget, text);
            }
            bindLyricsLock(node);
        } catch (error) {
            console.error("[feimao yue2]", error);
        }
    },
});
