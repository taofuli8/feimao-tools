// ComfyUI 0.45.2 ships frontend 1.58. Widget visibility is stored in
// options.hidden, and the hidden setter only writes that flag while the
// type is still a normal widget type. Setting type to "converted-widget"
// first skips the store. Opening a workflow then syncs the type back and
// the raw controls return. A multiline string expands and draws its JSON.

export function hideComfyWidget(widget, keepType = false) {
  if (!widget) return;
  try {
    widget.hidden = true;
  } catch (_) {}
  if (!keepType && widget.type !== "converted-widget") {
    if (!widget.__tmpOrigType) widget.__tmpOrigType = widget.type;
    widget.type = "converted-widget";
  }
  try {
    widget.hidden = true;
  } catch (_) {}
  const options = widget.options;
  if (options) {
    try {
      options.hidden = true;
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
}
