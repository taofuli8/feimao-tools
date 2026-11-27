import { app } from "../../../scripts/app.js";

const NODE_CLASS = "feimao_tools_Audio_Clip";

const LABELS = {
    audio: "音频",
    开始: "开始",
    时长: "时长",
};

function ensurePlayer(nodeData) {
    const required = nodeData.input?.required;
    if (!required?.audio) return;
    // 官方上传按钮创建时就会读试听控件。上传项必须排在试听后面，否则节点创建中断，外框变红。
    const upload = required.upload;
    if (upload) delete required.upload;
    if (!required.audioUI && !nodeData.input?.optional?.audioUI) {
        required.audioUI = ["AUDIO_UI", {}];
    }
    if (upload) required.upload = upload;
}

function widgetValue(node, name, fallback) {
    const value = node.widgets?.find((widget) => widget.name === name)?.value;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function bindPlayer(node) {
    const widget = node.widgets?.find((item) => item.name === "audioUI");
    const player = widget?.element;
    if (!(player instanceof HTMLAudioElement) || player.dataset.feimaoClip) return;
    player.dataset.feimaoClip = "1";
    player.addEventListener("play", () => {
        const start = Math.max(0, widgetValue(node, "开始", 0));
        if (start > 0 && Math.abs(player.currentTime - start) > 0.2) player.currentTime = start;
    });
    player.addEventListener("timeupdate", () => {
        const start = Math.max(0, widgetValue(node, "开始", 0));
        const length = widgetValue(node, "时长", 0);
        if (length > 0 && player.currentTime >= start + length) {
            player.pause();
            player.currentTime = start;
        }
    });
}

function labelWidgets(node) {
    for (const widget of node.widgets || []) {
        if (LABELS[widget.name]) widget.label = LABELS[widget.name];
        if (widget.name === "upload") widget.label = "上传参考音";
    }
    bindPlayer(node);
}

app.registerExtension({
    name: "feimao.audio.clip",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_CLASS) return;
        ensurePlayer(nodeData);
    },
    nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        labelWidgets(node);
        const previous = node.onConfigure;
        node.onConfigure = function () {
            const result = previous?.apply(this, arguments);
            labelWidgets(this);
            return result;
        };
    },
});
