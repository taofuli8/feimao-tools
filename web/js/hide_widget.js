// ComfyUI frontend 1.59 keeps widget visibility on options.hidden and
// options.surfaces. The hidden setter only writes options.hidden while the
// type is still a normal widget type. Turning the type into "converted-widget"
// skips that write. Opening a workflow then syncs the type back, the raw
// control returns, and a multiline string pushes the DOM panel out of the node.
// Pin every surface to "never" and put the height back to zero. If a later
// pass replaces the visibility object, the next draw pins it again.

const NEVER = { canvas: "never", vueNode: "never", panel: "never" };

function legacyHidingType(type) {
  const text = String(type || "");
  const lower = text.toLowerCase();
  return text === "converted-widget" || text.startsWith("converted-widget:") || lower.includes("hidden") || lower.startsWith("tschide");
}

function visibilityOf(widget) {
  return widget?._visibility || widget?.visibility || null;
}

function isPinned(widget) {
  const vis = visibilityOf(widget);
  if (vis?.surfaces) {
    const surfaces = vis.surfaces;
    if (surfaces.canvas !== "never" || surfaces.vueNode !== "never" || surfaces.panel !== "never") return false;
  } else if (widget?.hidden !== true && !legacyHidingType(widget?.type)) {
    return false;
  }
  const layout = widget?.computeLayoutSize?.();
  return !!layout && layout.minHeight === 0 && layout.maxHeight === 0 && widget?.options?.hidden === true;
}

function scheduleArrange(node) {
  if (!node || node.__tmpHideArrange) return;
  node.__tmpHideArrange = true;
  requestAnimationFrame(() => {
    node.__tmpHideArrange = false;
    try {
      node.arrange?.();
    } catch (_) {}
    try {
      node.setDirtyCanvas?.(true, false);
    } catch (_) {}
  });
}

function ensureGuard(node) {
  if (!node || node.__tmpHideGuard) return;
  node.__tmpHideGuard = true;
  const prev = node.onDrawBackground;
  node.onDrawBackground = function () {
    const names = this.__tmpHideNames;
    if (names?.size) {
      let changed = false;
      for (const widget of this.widgets || []) {
        if (!names.has(widget?.name) || isPinned(widget)) continue;
        hideComfyWidget(widget, widget.__tmpKeepType === true, true);
        changed = true;
      }
      if (changed) scheduleArrange(this);
    }
    return prev?.apply(this, arguments);
  };
}

export function hideComfyWidget(widget, keepType = false, fromGuard = false) {
  if (!widget) return;
  widget.__tmpKeepType = !!keepType;
  const options = widget.options || (widget.options = {});
  try {
    options.hidden = true;
  } catch (_) {}
  try {
    options.surfaces = { ...NEVER };
  } catch (_) {}

  const modern = !!visibilityOf(widget);
  if (modern && legacyHidingType(widget.type) && widget.__tmpOrigType) {
    try {
      widget.type = widget.__tmpOrigType;
    } catch (_) {}
  }
  try {
    widget.hidden = true;
  } catch (_) {}
  if (!modern && !keepType && !legacyHidingType(widget.type)) {
    if (!widget.__tmpOrigType) widget.__tmpOrigType = widget.type;
    try {
      widget.type = "converted-widget";
    } catch (_) {}
    try {
      widget.hidden = true;
    } catch (_) {}
  }

  const vis = visibilityOf(widget);
  if (vis) {
    try {
      vis.surfaces = { ...NEVER };
      if (vis.suppression) vis.suppression.byExtension = true;
    } catch (_) {}
  }

  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
  if (widget.serialize !== false) widget.serialize = true;
  if (typeof widget.draw === "function") widget.draw = function () {};
  for (const el of [widget.element, widget.inputEl]) {
    if (!el?.style) continue;
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("max-height", "0", "important");
    el.style.setProperty("overflow", "hidden", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("padding", "0", "important");
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
  }

  const node = widget.node;
  if (!node) return;
  node.__tmpHideNames ??= new Set();
  node.__tmpHideNames.add(widget.name);
  ensureGuard(node);
  if (!fromGuard) scheduleArrange(node);
}

// Frontend 1.59 uses computeSize before computeLayoutSize. A DOM widget that
// still has computeSize stays at a single control row, and the HTML panel
// sits in a corner of the node. Clear it and let min/max height own the slot.
export function useDomLayout(widget, minHeight, maxHeight = Number.MAX_SAFE_INTEGER) {
  if (!widget) return;
  const min = () => (typeof minHeight === "function" ? minHeight() : minHeight);
  const max = () => (typeof maxHeight === "function" ? maxHeight() : maxHeight);
  const options = widget.options || (widget.options = {});
  options.getMinHeight = min;
  options.getMaxHeight = max;
  options.hideOnZoom = false;
  widget.computeLayoutSize = () => ({ minHeight: min(), maxHeight: max(), minWidth: 0 });
  widget.computeSize = null;
}
