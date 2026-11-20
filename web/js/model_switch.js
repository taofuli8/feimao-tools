import { app } from "../../../scripts/app.js";

const NODE_CLASS = "feimao_tools_Model_Switch";
const WIDGET_NAME = "使用模型";
const HIDDEN_WIDGET = "__te_hidden_socket__";

// Keep this list in the same order as nodes_model_switch.py MODELS.
const MODELS = [
  ["MOSS", "MOSS图像"],
  ["千问", "千问图像"],
  ["Krea2", "Krea2图像"],
  ["Z-image", "Z-image图像"],
];
const ALL_NAMES = MODELS.map(([name]) => name);

let loadingGraph = 0;
let revealing = false;
let dragWatchReady = false;

function graphIsLoading() {
  return loadingGraph > 0 || !!app.configuringGraph || !!app.canvas?.configuringGraph;
}

function isSwitchNode(node) {
  return node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS;
}

function socketInput(node, socket) {
  return (node.inputs || []).find((item) => item?.name === socket || item?.localized_name === socket);
}

function isLinked(node, input) {
  const index = node.inputs?.indexOf(input) ?? -1;
  if (index < 0) return false;
  if (typeof node.isInputConnected === "function") return !!node.isInputConnected(index);
  return !!input?.isConnected;
}

function linkedNames(node) {
  const names = [];
  for (const [name, socket] of MODELS) {
    const input = socketInput(node, socket);
    if (input && isLinked(node, input)) names.push(name);
  }
  return names;
}

function isHiddenMarker(input) {
  return input?.widget?.name === HIDDEN_WIDGET;
}

function hideSocket(input) {
  if (input.widget && !isHiddenMarker(input)) return;
  if (!isHiddenMarker(input)) input.widget = { name: HIDDEN_WIDGET };
}

function showSocket(input) {
  if (!isHiddenMarker(input)) return;
  delete input.widget;
  if (isHiddenMarker(input)) input.widget = undefined;
}

function ensureOwnOptions(widget) {
  if (widget.__teSwitchOptions) return widget.__teSwitchOptions;
  const current = widget.options?.values;
  const seed = Array.isArray(current) ? current.filter((name) => ALL_NAMES.includes(name)) : ALL_NAMES;
  widget.__teSwitchOptions = { ...(widget.options || {}), values: seed.length ? seed.slice() : ALL_NAMES.slice() };
  widget.options = widget.__teSwitchOptions;
  return widget.__teSwitchOptions;
}

function applyLayout(node) {
  if (!node || graphIsLoading()) return;
  const linked = linkedNames(node);
  const widget = (node.widgets || []).find((item) => item?.name === WIDGET_NAME);
  if (widget) {
    const options = ensureOwnOptions(widget);
    const choices = linked.length ? linked : ALL_NAMES;
    const same = options.values.length === choices.length && options.values.every((name, index) => name === choices[index]);
    if (!same) options.values = choices.slice();
    if (linked.length && !choices.includes(widget.value)) {
      widget.value = choices[0];
      node.graph?.setDirtyCanvas?.(true, true);
    }
  }

  const showEmpty = !!node.__teShowEmpty || revealing || linked.length === 0;
  for (const [, socket] of MODELS) {
    const input = socketInput(node, socket);
    if (!input) continue;
    if (isLinked(node, input) || showEmpty) showSocket(input);
    else hideSocket(input);
  }
  node.setDirtyCanvas?.(true, true);
}

function eachSwitch(visit) {
  const nodes = app.graph?.nodes || [];
  for (const node of nodes) {
    if (!isSwitchNode(node)) continue;
    visit(node);
  }
}

function hook(node) {
  if (!node || node.__teSwitchHooked) return;
  node.__teSwitchHooked = true;
  const previous = node.onConnectionsChange;
  node.onConnectionsChange = function () {
    const result = previous?.apply(this, arguments);
    applyLayout(this);
    return result;
  };
  applyLayout(node);
}

function wrapSerialize(nodeType) {
  const proto = nodeType.prototype;
  if (proto.__teSerializeWrapped) return;
  proto.__teSerializeWrapped = true;
  const original = proto.serialize;
  if (typeof original !== "function") return;
  proto.serialize = function () {
    const hidden = [];
    for (const input of this.inputs || []) {
      if (!isHiddenMarker(input)) continue;
      hidden.push(input);
      showSocket(input);
    }
    try {
      return original.apply(this, arguments);
    } finally {
      for (const input of hidden) hideSocket(input);
    }
  };
}

function watchLinkDrag() {
  const canvas = app.canvas;
  const events = canvas?.linkConnector?.events;
  if (!events || dragWatchReady) return;
  dragWatchReady = true;
  const refresh = () => {
    const connector = canvas.linkConnector;
    const next = !!(connector?.isConnecting && connector.state?.connectingTo === "input");
    if (next === revealing) return;
    revealing = next;
    eachSwitch(applyLayout);
  };
  events.addEventListener("reset", () => {
    revealing = false;
    eachSwitch(applyLayout);
  });
  events.addEventListener("link-created", () => {
    revealing = false;
    eachSwitch(applyLayout);
  });
  window.addEventListener("pointerdown", () => requestAnimationFrame(refresh), true);
  window.addEventListener("pointermove", () => {
    if (canvas.linkConnector?.isConnecting) refresh();
  }, true);
}

app.registerExtension({
  name: "TE.ManPro.ModelSwitch",
  setup() {
    watchLinkDrag();
  },
  beforeConfigureGraph() {
    loadingGraph += 1;
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    wrapSerialize(nodeType);
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      hook(this);
      return result;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        if (!app.configuringGraph && !app.canvas?.configuringGraph) loadingGraph = 0;
        hook(this);
        applyLayout(this);
      });
      return result;
    };
    const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      const result = getExtraMenuOptions?.apply(this, arguments);
      const hidden = MODELS.filter(([, socket]) => {
        const input = socketInput(this, socket);
        return input && !isLinked(this, input);
      });
      if (hidden.length || this.__teShowEmpty) {
        options.push({
          content: this.__teShowEmpty ? "收起未接线的模型" : "显示未接线的模型",
          callback: () => {
            this.__teShowEmpty = !this.__teShowEmpty;
            applyLayout(this);
          },
        });
      }
      return result;
    };
  },
  nodeCreated(node) {
    if (!isSwitchNode(node)) return;
    hook(node);
  },
  afterConfigureGraph() {
    loadingGraph = 0;
    watchLinkDrag();
    eachSwitch((node) => {
      hook(node);
      applyLayout(node);
    });
  },
});
