import { app } from "../../../scripts/app.js";
import { hideComfyWidget, useDomLayout } from "./hide_widget.js";

const NODE_CLASS = "feimao_tools_Preset_Prompt";
const CUSTOM = "自定义";
const STORAGE_KEY = "feimao.presetPrompt.library";

const FACTORY = {
  四视图: "生成这个角色的四视图，从左到右分别为：面部特写，全身正面，全身侧面，全身背面，灰色背景",
  修复老照片: "对这张老照片进行完整修复与上色：彻底去除画面中所有划痕、缺损、污渍与霉点，将模糊的面部五官、衣物与背景重建为清晰锐利的高清细节，恢复自然的皮肤纹理、皱纹层次、头发丝与布料质感；随后为整张照片上自然真实的色彩，还原为干净通透的彩色人像，肤色红润真实、衣物呈现可信的固有色，整体色彩明亮干净、清晰通透，如同清晰彩色照片；完整保留人物的脸型、五官比例与相对位置、表情与神态、姿态以及衣物的款式结构，保持构图、取景与画面缩放完全不变，人物始终为同一可辨认的本人。",
  产品精修: "对图中的产品进行精修，去除产品所有划痕、缺损、污渍、锈迹与杂质，恢复产品崭新的状态，清晰呈现产品原有的材质与结构细节，精细的光照效果与质感，表面干净。构图保持原图产品摆放与视角不变。\n同时对产品进行抠图，将产品从场景中提取出来，输出仅保留产品，透明背景。保留产品完整主体，边缘干净利落、无残留背景色边或锯齿。",
  九宫格表情包: "根据图中人物制作九宫格表情包，表情依次为：开心，吐舌，愤怒，悲伤，生气，恐惧，哭泣，微笑，害羞。最终输出包含9个表情的九宫格图片",
  桌面手办: "按照图中人物的1/7比例，在写实的风格和环境下，制作一个商业化的全身逼真人物模型。保持人物姿势不变，将人物模型放置在电脑桌上，使用圆形透明亚克力底座，底座上不带任何文字。在电脑屏幕上，展示人物模型的ZBrush建模过程。在电脑屏幕旁边，放置一个印有原画的BANDAI风格玩具包装盒。",
  水印移除: "干净无水印的原图，画面纯净完整，无任何文字、logo、签名、角标、贴纸和UI元素；保持参考图的主体、构图、颜色、光线、阴影和透视，真实照片质感，高清细节，边缘自然。",
  图像扩展: "将蓝色区域全部补绘为自然、完整的图像内容。严格参考原图边缘，沿原有画面向外延伸，保持场景、物体、背景、纹理、色彩、光照、透视和空间结构连续一致。新增内容必须与原图无缝衔接，不得出现蓝色、空白或拼接痕迹。原图已有内容必须完整保留，禁止重绘、修改、移动或裁剪。只生成蓝色区域，绝不改变原图尺寸、位置和构图。",
  元素移除: "将绿色遮罩区域替换为与周围环境自然一致的背景，延续[墙面/地面/桌面/衣服]的纹理、光照、阴影和透视，边缘自然融合，真实照片质感，遮罩以外内容保持不变。",
};

const BUILTIN = Object.keys(FACTORY);

function widget(node, name) {
  return (node.widgets || []).find((item) => item?.name === name);
}

function parseLibrary(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || typeof data.texts !== "object") return null;
    return data;
  } catch (_) {
    return null;
  }
}

function readCached() {
  try {
    return parseLibrary(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

function addExtra(extras, name) {
  if (!name || BUILTIN.includes(name) || name === CUSTOM || extras.includes(name)) return;
  extras.push(name);
}

function buildLibrary(node) {
  const file = parseLibrary(widget(node, "预设库")?.value);
  const cached = readCached();
  const live = node.__feimaoPreset?.lib;
  const texts = { [CUSTOM]: "" };
  for (const name of BUILTIN) texts[name] = FACTORY[name];
  for (const data of [cached, file, live]) {
    if (!data?.texts) continue;
    for (const [name, text] of Object.entries(data.texts)) {
      if (!name) continue;
      texts[name] = String(text ?? "");
    }
  }
  const extras = [];
  for (const data of [file, cached, live]) {
    if (!data) continue;
    for (const name of data.order || []) addExtra(extras, name);
    for (const name of Object.keys(data.texts || {})) addExtra(extras, name);
  }
  return { order: [...BUILTIN, ...extras, CUSTOM], texts };
}

function setChoices(combo, names) {
  if (!combo) return;
  const values = names.slice();
  combo.options = { ...(combo.options || {}), values };
  combo.__feimaoOwnOptions = true;
}

function promptElement(node, promptWidget) {
  const panelText = node.__feimaoPresetPanel?.text;
  const field = promptWidget?.inputEl;
  if (field && field !== panelText && field.tagName === "TEXTAREA") return field;
  return null;
}

function currentPrompt(node) {
  const field = node.__feimaoPresetPanel?.text;
  if (field) return field.value;
  const promptWidget = widget(node, "提示词");
  const stored = String(promptWidget?.value ?? "");
  const element = promptElement(node, promptWidget);
  if (element?.isConnected && (element.value || !stored)) return element.value;
  return stored;
}

function setPrompt(node, text) {
  const promptWidget = widget(node, "提示词");
  const state = node.__feimaoPreset;
  if (state) state.writing = true;
  try {
    if (promptWidget) {
      promptWidget.value = text;
      const element = promptElement(node, promptWidget);
      if (element && element.value !== text) element.value = text;
    }
    const field = node.__feimaoPresetPanel?.text;
    if (field && field.value !== text) field.value = text;
  } finally {
    if (state) state.writing = false;
  }
}

function writeLibrary(node) {
  const state = node.__feimaoPreset;
  const lib = state?.lib;
  if (!lib || state.savingLib) return;
  const text = JSON.stringify({ order: lib.order, texts: lib.texts });
  const store = widget(node, "预设库");
  state.savingLib = true;
  try {
    if (store && store.value !== text) store.value = text;
    localStorage.setItem(STORAGE_KEY, text);
  } catch (_) {
  } finally {
    state.savingLib = false;
  }
  if (store && store.value !== text && !state.savingLib) {
    state.savingLib = true;
    try { store.value = text; } catch (_) {}
    finally { state.savingLib = false; }
  }
}

function flushLibrary(node) {
  const state = node.__feimaoPreset;
  if (!state) return;
  clearTimeout(state.libTimer);
  writeLibrary(node);
}

function rememberCurrent() {}

function buttonStyle(kind) {
  const common = "height:30px;padding:0 12px;border-radius:6px;font:12px/1 sans-serif;cursor:pointer;flex:0 0 auto;";
  if (kind === "primary") return `${common}background:#2c4266;color:#e7f0ff;border:1px solid #4d6fa3;`;
  if (kind === "danger") return `${common}background:#3a2428;color:#ffd0d0;border:1px solid #8a4a4a;`;
  return `${common}background:#2a303a;color:#d5dbe3;border:1px solid #4a5362;`;
}

function panelClosed(row) {
  return !row || row.style.display === "none";
}

function press(element, action) {
  let locked = false;
  const run = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    locked = true;
    setTimeout(() => {
      locked = false;
    }, 280);
    action();
  };
  element.addEventListener("pointerup", run);
  element.addEventListener("click", run);
}

function refreshPanel(node) {
  const panel = node.__feimaoPresetPanel;
  const state = node.__feimaoPreset;
  if (!panel || !state?.lib || state.refreshing) return;
  state.refreshing = true;
  try {
    refreshPanelBody(panel, state);
  } finally {
    state.refreshing = false;
  }
}

function refreshPanelBody(panel, state) {
  const { order, texts } = state.lib;
  const name = order.includes(state.current) ? state.current : order[0];
  state.current = name;
  const typing = document.activeElement === panel.text;
  const currentNames = [...panel.select.options].map((option) => option.value);
  const sameList = currentNames.length === order.length && currentNames.every((item, index) => item === order[index]);
  if (!sameList) {
    const frag = document.createDocumentFragment();
    for (const item of order) {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      frag.append(option);
    }
    panel.select.replaceChildren(frag);
  }
  if (panel.select.value !== name) panel.select.value = name;
  if (!typing && !state.dirty) panel.text.value = texts[name] ?? "";
  const editing = !!state.editing;
  panel.text.readOnly = false;
  panel.text.style.background = "#1b2028";
  panel.text.style.borderColor = state.dirty ? "#8a6a3a" : "#3c4654";
  panel.select.disabled = false;
  panel.editButton.style.background = editing ? "#2c4266" : "#2a303a";
  panel.editButton.style.borderColor = editing ? "#4d6fa3" : "#4a5362";
  panel.editButton.style.color = editing ? "#e7f0ff" : "#d5dbe3";
  panel.saveItem.disabled = !editing;
  panel.exitItem.disabled = !editing;
  panel.saveItem.style.opacity = editing ? "1" : "0.4";
  panel.exitItem.style.opacity = editing ? "1" : "0.4";
  panel.deleteItem.disabled = order.length <= 1;
  panel.deleteItem.style.opacity = order.length <= 1 ? "0.4" : "1";
  const missing = BUILTIN.some((item) => !order.includes(item));
  panel.restore.style.display = missing ? "" : "none";
  if (!name) panel.hint.textContent = "";
  else if (state.dirty) panel.hint.textContent = `「${name}」是临时修改，切换预设会还原`;
  else if (!editing) panel.hint.textContent = `当前预设「${name}」`;
  else panel.hint.textContent = `正在编辑「${name}」`;
}

function closeMenu(node) {
  const menu = node.__feimaoPresetPanel?.menu;
  if (menu) menu.style.display = "none";
}

function toggleMenu(node) {
  const menu = node.__feimaoPresetPanel?.menu;
  if (!menu) return;
  menu.style.display = panelClosed(menu) ? "flex" : "none";
}

function enterEdit(node) {
  const state = node.__feimaoPreset;
  if (!state) return;
  state.editing = true;
  const saved = state.lib?.texts?.[state.current] ?? "";
  state.dirty = (panelText(node) ?? "") !== saved;
  refreshPanel(node);
  node.__feimaoPresetPanel?.text?.focus();
}

function savePreset(node) {
  const state = node.__feimaoPreset;
  const panel = node.__feimaoPresetPanel;
  if (!state?.lib || !state.current) return;
  const text = panelText(node) ?? "";
  state.lib.texts[state.current] = text;
  state.dirty = false;
  state.editing = false;
  setPrompt(node, text);
  flushLibrary(node);
  setChoices(widget(node, "预设"), state.lib.order);
  showAdd(node, false);
  showDelete(node, false);
  closeMenu(node);
  refreshPanel(node);
  if (panel) panel.hint.textContent = `「${state.current}」已保存`;
}

function exitEdit(node) {
  const state = node.__feimaoPreset;
  if (!state) return;
  state.editing = false;
  state.dirty = false;
  setPrompt(node, state.lib?.texts?.[state.current] ?? "");
  showAdd(node, false);
  showDelete(node, false);
  closeMenu(node);
  refreshPanel(node);
}

function showAdd(node, open) {
  const panel = node.__feimaoPresetPanel;
  if (!panel) return;
  panel.addRow.style.display = open ? "flex" : "none";
  panel.confirmRow.style.display = "none";
  if (open) {
    panel.nameInput.value = "";
    panel.nameInput.focus();
  }
}

function showDelete(node, open) {
  const panel = node.__feimaoPresetPanel;
  const state = node.__feimaoPreset;
  if (!panel) return;
  panel.confirmRow.style.display = open ? "flex" : "none";
  panel.addRow.style.display = "none";
  if (open) panel.confirmText.textContent = `删除「${state?.current || ""}」？`;
}

function addPreset(node, name) {
  const state = node.__feimaoPreset;
  const panel = node.__feimaoPresetPanel;
  const lib = state?.lib;
  const title = String(name || "").trim();
  if (!lib || !title) {
    if (panel) panel.hint.textContent = "先写一个预设名称";
    return;
  }
  if (state.adding) return;
  state.adding = true;
  state.editing = true;
  state.dirty = false;
  try {
    if (!lib.order.includes(title)) {
      const at = lib.order.indexOf(CUSTOM);
      lib.order.splice(at < 0 ? lib.order.length : at, 0, title);
      lib.texts[title] = "";
    }
    setChoices(widget(node, "预设"), lib.order);
    state.current = "";
    switchTo(node, title);
    flushLibrary(node);
    showAdd(node, false);
    closeMenu(node);
    refreshPanel(node);
    if (panel) panel.hint.textContent = `已新增「${title}」，写下的内容会立刻保存`;
    panel?.text?.focus();
  } finally {
    state.adding = false;
  }
}

function deletePreset(node) {
  const state = node.__feimaoPreset;
  const lib = state?.lib;
  const name = state?.current;
  if (!lib || !name || lib.order.length <= 1) return;
  const index = lib.order.indexOf(name);
  lib.order = lib.order.filter((item) => item !== name);
  delete lib.texts[name];
  const next = lib.order[Math.max(0, index - 1)] || lib.order[0];
  setChoices(widget(node, "预设"), lib.order);
  state.current = "";
  switchTo(node, next);
  writeLibrary(node);
  showDelete(node, false);
  refreshPanel(node);
}

function restoreBuiltins(node) {
  const state = node.__feimaoPreset;
  const lib = state?.lib;
  if (!lib) return;
  const extras = lib.order.filter((item) => !BUILTIN.includes(item) && item !== CUSTOM);
  lib.order = [...BUILTIN, ...extras, CUSTOM];
  for (const name of BUILTIN) {
    if (!Object.prototype.hasOwnProperty.call(lib.texts, name) || lib.texts[name] == null) lib.texts[name] = FACTORY[name];
  }
  if (!Object.prototype.hasOwnProperty.call(lib.texts, CUSTOM)) lib.texts[CUSTOM] = "";
  setChoices(widget(node, "预设"), lib.order);
  writeLibrary(node);
  refreshPanel(node);
}

function panelText(node) {
  const field = node.__feimaoPresetPanel?.text;
  return field ? field.value : null;
}

function mountPanel(node) {
  if (node.__feimaoPresetPanel) return;
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;gap:8px;box-sizing:border-box;height:100%;min-height:300px;padding:2px;color:#d7dee8;font:12px/1.4 sans-serif;pointer-events:auto;";
  const fieldStyle = "box-sizing:border-box;width:100%;background:#1b2028;color:#e8eef7;border:1px solid #3c4654;border-radius:6px;padding:7px 10px;font:13px/1.5 sans-serif;outline:none;";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:6px;align-items:center;";
  const select = document.createElement("select");
  select.style.cssText = `${fieldStyle}height:32px;padding:0 8px;flex:1 1 auto;cursor:pointer;`;
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "编辑 ▾";
  editButton.title = "编辑当前预设";
  editButton.style.cssText = buttonStyle();
  head.append(select, editButton);

  const menu = document.createElement("div");
  menu.style.cssText = "display:none;flex-direction:column;gap:2px;background:#1b2028;border:1px solid #3c4654;border-radius:8px;padding:4px;";
  const itemStyle = "display:block;width:100%;text-align:left;height:30px;padding:0 10px;border:0;border-radius:5px;background:transparent;color:#e8eef7;cursor:pointer;font:12px/1 sans-serif;";
  const menuItem = (label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = itemStyle;
    button.addEventListener("pointerenter", () => {
      if (!button.disabled) button.style.background = "#2a3344";
    });
    button.addEventListener("pointerleave", () => {
      button.style.background = "transparent";
    });
    menu.append(button);
    return button;
  };
  const saveItem = menuItem("保存");
  const addItem = menuItem("新增");
  const deleteItem = menuItem("删除");
  const exitItem = menuItem("退出编辑");
  exitItem.style.color = "#f0c9c9";

  const addRow = document.createElement("div");
  addRow.style.cssText = "display:none;gap:6px;align-items:center;";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "新预设的名称";
  nameInput.style.cssText = `${fieldStyle}height:32px;flex:1 1 auto;`;
  const addOk = document.createElement("button");
  addOk.type = "button";
  addOk.textContent = "确定";
  addOk.style.cssText = buttonStyle("primary");
  const addCancel = document.createElement("button");
  addCancel.type = "button";
  addCancel.textContent = "取消";
  addCancel.style.cssText = buttonStyle();
  addRow.append(nameInput, addOk, addCancel);

  const confirmRow = document.createElement("div");
  confirmRow.style.cssText = "display:none;gap:6px;align-items:center;";
  const confirmText = document.createElement("span");
  confirmText.style.cssText = "flex:1 1 auto;color:#f0c9c9;";
  const deleteOk = document.createElement("button");
  deleteOk.type = "button";
  deleteOk.textContent = "删除";
  deleteOk.style.cssText = buttonStyle("danger");
  const deleteCancel = document.createElement("button");
  deleteCancel.type = "button";
  deleteCancel.textContent = "取消";
  deleteCancel.style.cssText = buttonStyle();
  confirmRow.append(confirmText, deleteOk, deleteCancel);

  const text = document.createElement("textarea");
  text.spellcheck = false;
  text.style.cssText = `${fieldStyle}flex:1 1 auto;min-height:180px;resize:none;`;
  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;gap:8px;align-items:center;min-height:16px;";
  const hint = document.createElement("span");
  hint.style.cssText = "flex:1 1 auto;color:#8e99a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.textContent = "恢复内置";
  restore.title = "把删掉的内置预设加回来，已有文字保持不变";
  restore.style.cssText = `${buttonStyle()}height:24px;padding:0 8px;display:none;`;
  foot.append(hint, restore);
  root.append(head, menu, addRow, confirmRow, text, foot);

  const stop = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", stop);
  root.addEventListener("wheel", stop, { passive: true });

  press(editButton, () => {
    const state = node.__feimaoPreset;
    if (!state?.editing) enterEdit(node);
    toggleMenu(node);
  });
  press(saveItem, () => savePreset(node));
  press(addItem, () => {
    closeMenu(node);
    if (!node.__feimaoPreset?.editing) enterEdit(node);
    showAdd(node, true);
  });
  press(deleteItem, () => {
    if (deleteItem.disabled) return;
    closeMenu(node);
    if (!node.__feimaoPreset?.editing) enterEdit(node);
    showDelete(node, true);
  });
  press(exitItem, () => exitEdit(node));
  press(addCancel, () => showAdd(node, false));
  press(addOk, () => addPreset(node, nameInput.value));
  nameInput.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      addPreset(node, nameInput.value);
    } else if (event.key === "Escape") {
      showAdd(node, false);
    }
  });
  press(deleteCancel, () => showDelete(node, false));
  press(deleteOk, () => deletePreset(node));
  press(restore, () => restoreBuiltins(node));
  select.addEventListener("change", () => {
    const state = node.__feimaoPreset;
    if (!state || state.refreshing || state.writing || state.adding || state.switching) return;
    if (!select.value || select.value === state.current) return;
    state.editing = false;
    state.dirty = false;
    switchTo(node, select.value);
    showAdd(node, false);
    showDelete(node, false);
    closeMenu(node);
  });
  text.addEventListener("input", () => {
    const state = node.__feimaoPreset;
    if (!state || state.writing || !state.current || !state.lib) return;
    const saved = state.lib.texts[state.current] ?? "";
    state.dirty = text.value !== saved;
    setPrompt(node, text.value);
    clearTimeout(state.libTimer);
    node.__feimaoPresetPanel.hint.textContent = state.dirty
      ? `「${state.current}」临时修改，还没保存。切换预设会还原`
      : `当前预设「${state.current}」`;
    text.style.borderColor = state.dirty ? "#8a6a3a" : "#3c4654";
  });

  const dom = node.addDOMWidget("feimao_preset_panel", "feimao_preset_panel", root, {
    serialize: false,
    hideOnZoom: false,
  });
  dom.serialize = false;
  useDomLayout(dom, 340);
  node.__feimaoPresetPanel = {
    select, text, hint, restore, addRow, confirmRow, nameInput, confirmText,
    editButton, menu, saveItem, deleteItem, exitItem,
  };
}

function assignCombo(node, name) {
  const state = node.__feimaoPreset;
  const combo = widget(node, "预设");
  if (!state || !combo || combo.value === name) return;
  const panelSelect = node.__feimaoPresetPanel?.select;
  state.writing = true;
  try {
    combo.value = name;
    const field = combo.inputEl;
    if (field && field !== panelSelect && field.value !== name) field.value = name;
  } catch (_) {}
  finally {
    state.writing = false;
  }
}

function switchTo(node, name) {
  const state = node.__feimaoPreset;
  if (!state || !name || name === state.current || state.switching) return;
  state.switching = true;
  try {
    state.dirty = false;
    state.current = name;
    if (state.lib && !state.lib.order.includes(name)) {
      const at = state.lib.order.indexOf(CUSTOM);
      state.lib.order.splice(at < 0 ? state.lib.order.length : at, 0, name);
      if (!Object.prototype.hasOwnProperty.call(state.lib.texts, name)) state.lib.texts[name] = "";
    }
    setChoices(widget(node, "预设"), state.lib?.order || [name]);
    assignCombo(node, name);
    setPrompt(node, state.lib?.texts?.[name] ?? "");
    refreshPanel(node);
    node.setDirtyCanvas?.(true, true);
  } finally {
    state.switching = false;
  }
}

function bind(node) {
  const state = node.__feimaoPreset;
  const combo = widget(node, "预设");
  const promptWidget = widget(node, "提示词");
  if (combo && !combo.__feimaoWrapped) {
    combo.__feimaoPrevCallback = combo.callback;
    combo.__feimaoWrapped = true;
    combo.callback = function () {
      const result = combo.__feimaoPrevCallback?.apply(this, arguments);
      if (!state.writing && !state.adding && !state.refreshing && !state.switching) switchTo(node, this.value);
      return result;
    };
  }
  if (promptWidget && !promptWidget.__feimaoWrapped) {
    promptWidget.__feimaoPrevCallback = promptWidget.callback;
    promptWidget.__feimaoWrapped = true;
    promptWidget.callback = function () {
      return promptWidget.__feimaoPrevCallback?.apply(this, arguments);
    };
  }
}

function sync(node, info) {
  const state = node.__feimaoPreset;
  if (state.savingLib) return;
  for (const name of ["预设", "提示词", "预设库"]) hideComfyWidget(widget(node, name), true);
  const lib = buildLibrary(node);
  state.lib = lib;
  const combo = widget(node, "预设");
  const keepCurrent = !!(state.current && lib.order.includes(state.current));
  const fromGraph = String(info?.widgets_values?.[0] || combo?.value || BUILTIN[0]);
  const savedName = keepCurrent ? state.current : fromGraph;
  if (!lib.order.includes(savedName)) {
    const at = lib.order.indexOf(CUSTOM);
    lib.order.splice(at < 0 ? lib.order.length : at, 0, savedName);
    if (!Object.prototype.hasOwnProperty.call(lib.texts, savedName)) lib.texts[savedName] = "";
  }
  setChoices(combo, lib.order);
  state.writing = true;
  try {
    if (combo && combo.value !== savedName) combo.value = savedName;
  } finally {
    state.writing = false;
  }
  state.current = savedName;
  if (!keepCurrent && !state.dirty) {
    const live = String(widget(node, "提示词")?.value ?? "");
    if (live !== (lib.texts[savedName] ?? "")) lib.texts[savedName] = live;
  }
  if (keepCurrent && !state.dirty) setPrompt(node, lib.texts[savedName] ?? "");
  writeLibrary(node);
  refreshPanel(node);
}

function setup(node, info) {
  if (!node.__feimaoPreset) node.__feimaoPreset = { writing: false, current: "", lib: null, editing: false, dirty: false, refreshing: false, adding: false, switching: false };
  bind(node);
  mountPanel(node);
  sync(node, info);
}

app.registerExtension({
  name: "feimao.tools.presetPrompt",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const created = nodeType.prototype.onNodeCreated;
    const configured = nodeType.prototype.onConfigure;
    const computeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const size = computeSize?.apply(this, arguments) || [360, 420];
      size[0] = Math.max(360, size[0]);
      size[1] = Math.max(420, size[1]);
      return size;
    };
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      setup(this);
      return result;
    };
    nodeType.prototype.onConfigure = function (info) {
      const result = configured?.apply(this, arguments);
      setup(this, info);
      return result;
    };
  },
});
