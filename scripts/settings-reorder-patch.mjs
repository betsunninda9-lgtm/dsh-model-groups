import { createSettingsReorder, useSettingsReorder } from './settings-reorder.mjs';

export function addSettingsReorder(initial, apply) {
  let current = initial;
  const replace = (before, after) => { apply(before, after); current = current.replace(before, after); };
  const anchor = 'const MULTI_KEY_ENTRY_ID =';
  replace(anchor, `${createSettingsReorder.toString()}\n\t\t${useSettingsReorder.toString()}\n\t\t${anchor}`);
  replace('const anyBusy = Object.values(busyEntries).some(Boolean);', `const anyBusy = Object.values(busyEntries).some(Boolean);
\t\t\tconst savedEntryOrder = Object.keys(props.savedEntries ?? props.persistedEntries ?? {});
\t\t\tconst reorder = useSettingsReorder({ disabled: disabled || anyBusy, selector: "[data-key-entry-id]", move: (id, offset) => {
\t\t\t\tconst ordered = Object.entries(entries), from = ordered.findIndex(([key]) => key === id), to = from + offset;
\t\t\t\tif (from < 0 || to < 0 || to >= ordered.length) return;
\t\t\t\tconst [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved);
\t\t\t\tonChange(Object.fromEntries(ordered));
\t\t\t} });`);
  replace('const dirty = multiKeyEntryDirty(entry, props.savedEntries?.[id] ?? props.persistedEntries?.[id], draft);', 'const dirty = savedEntryOrder.indexOf(id) !== index || multiKeyEntryDirty(entry, props.savedEntries?.[id] ?? props.persistedEntries?.[id], draft);');
  const before = 'children: [(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["rowName"],';
  replace(before, `children: [(0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\ttype: "button", className: ModelsSection_module_css_default["iconButton"],
\t\t\t\t\t\t\t\t"data-key-entry-handle": id, "aria-label": t("multiKeyReorder") + " " + heading,
\t\t\t\t\t\t\t\t"aria-keyshortcuts": "ArrowUp ArrowDown", "aria-description": t("multiKeyReorderHelp"), title: t("multiKeyReorderHelp"),
\t\t\t\t\t\t\t\tdisabled: disabled || anyBusy, ...reorder(id),
\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDragHandleOutlineRegular, { size: 14 })
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["rowName"],`);
  // ModelRow keeps the native useModelRows onMove action, moving row-local drafts
  // and stable keys together. The pointer preview never mutates React-owned DOM.
  replace('const preview = (0, _deepseek_ai_dsh_client_ui_primitives.useRowDragPreview)(ModelsSection_module_css_default["modelDragPreview"]);', 'const reorder = useSettingsReorder({ disabled, selector: "[data-row-key]", move: (_key, offset) => props.order.onMove(offset) });');
  const start = current.indexOf('\n\t\t\t\tonDragOver: (event) => {', current.indexOf('function ModelRow(props)'));
  const end = current.indexOf('\n\t\t\t\tchildren:', start);
  if (start < 0 || end < start) throw new Error('Missing model drag row anchor');
  replace(current.slice(start, end), '\n\t\t\t\t// Reordering is handled by the pointer handle below.');
  const dragStart = current.indexOf('\n\t\t\t\t\t\t\t\tdraggable: !disabled,', current.indexOf('function ModelRow(props)'));
  const dragEnd = current.indexOf('\n\t\t\t\t\t\t\t\tchildren:', dragStart);
  if (dragStart < 0 || dragEnd < dragStart) throw new Error('Missing model drag handle anchor');
  replace(current.slice(dragStart, dragEnd), '\n\t\t\t\t\t\t\t\t...reorder(props.rowKey),');
  replace('label: t("reorderModelHelp"),', 'label: t("modelReorderTouchHelp"),');
  replace('"aria-description": t("reorderModelHelp"),', '"aria-description": t("modelReorderTouchHelp"),');
  for (const [locale, values] of Object.entries({
    en: { multiKeyReorder: 'Reorder key group', multiKeyReorderHelp: 'Hold the handle to reorder; or use Arrow Up/Down. Save with the other edits.' },
    zh: { multiKeyReorder: '调整密钥分组顺序', multiKeyReorderHelp: '长按手柄拖动，或用上下方向键调整；与其他改动一起保存。' }
  })) {
    const text = Object.entries({ ...values, modelReorderTouchHelp: values.multiKeyReorderHelp }).map(([key, value]) => `\t\t\t${key}: ${JSON.stringify(value)},\n`).join('');
    replace(`const ${locale} = {\n`, `const ${locale} = {\n${text}`);
  }
}
