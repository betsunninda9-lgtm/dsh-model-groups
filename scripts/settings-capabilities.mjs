import { applyModelCapabilities } from '../src/capability-defaults.js';

// Functions are embedded into the verified host bundle; keep them self-contained.
export function GroupCapabilityDefaults({ entry, onChange, disabled, t }) {
  const [mode, setMode] = (0, react.useState)('preserve');
  const [vision, setVision] = (0, react.useState)(true);
  const [reasoning, setReasoning] = (0, react.useState)(true);
  const [confirm, setConfirm] = (0, react.useState)(false);
  const defaults = entry.capabilityDefaults;
  const models = Array.isArray(entry.models) ? entry.models : [];
  const exceptions = models.filter(model => ['vision', 'reasoning'].some(key => model.capabilityOverrides?.[key] !== void 0)).length;
  const h = react_jsx_runtime.jsx, hs = react_jsx_runtime.jsxs;
  const css = ModelsSection_module_css_default;
  const button = (label, action, extra = {}) => h('button', { type: 'button', className: css.secondaryButton, disabled, onClick: () => { if (!disabled) action(); }, children: t(label), ...extra });
  const toggle = (key, value, change) => hs('div', { className: css.field, style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 }, children: [h('span', { children: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning') }), h(_deepseek_ai_dsh_client_ui_primitives.Switch, { 'data-capability-default': key, label: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning'), checked: value, disabled, onChange: value => { if (!disabled) change(value); } })] });
  return hs('section', { 'data-group-capabilities': true, style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, borderTop: '0.5px solid var(--dsw-alias-settings-card-stroke)', paddingTop: 12 }, children: [
    h('strong', { children: t('capabilityDefaultsTitle') }),
    h('p', { className: css.advancedHint, children: t(defaults ? 'capabilityDefaultsHelp' : 'capabilityEnableHelp') }),
    toggle('vision', defaults ? defaults.vision : vision, value => defaults ? onChange({ ...entry, capabilityDefaults: { ...defaults, vision: value } }) : setVision(value)),
    toggle('reasoning', defaults ? defaults.reasoning : reasoning, value => defaults ? onChange({ ...entry, capabilityDefaults: { ...defaults, reasoning: value } }) : setReasoning(value)),
    !defaults ? hs(react_jsx_runtime.Fragment, { children: [
      hs('label', { className: css.field, children: [h('span', { children: t('capabilityExisting') }), hs('select', { 'data-capability-initial-mode': true, className: css.input + ' ' + css.selectInput, value: mode, disabled, onChange: event => { if (!disabled && ['preserve', 'follow'].includes(event.target.value)) setMode(event.target.value); }, children: [h('option', { value: 'preserve', children: t('capabilityPreserve') }), h('option', { value: 'follow', children: t('capabilityAllFollow') })] })] }),
      button('capabilityEnable', () => onChange({ ...entry, capabilityDefaults: { vision, reasoning }, models: models.map(model => { const { capabilityOverrides, ...rest } = model; return mode === 'preserve' ? { ...rest, capabilityOverrides: { vision: 'original', reasoning: 'original' } } : rest; }) }), { 'data-capability-enable': true })
    ] }) : hs(react_jsx_runtime.Fragment, { children: [
      h('p', { 'data-capability-count': true, className: css.advancedHint, children: t('capabilityCounts').replace('{follow}', String(models.length - exceptions)).replace('{exceptions}', String(exceptions)) }),
      confirm ? hs('div', { 'data-capability-reset-confirm': true, role: 'group', style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
        h('p', { className: css.advancedHint, children: t('capabilityResetHelp').replace('{count}', String(exceptions)) }),
        button('capabilityResetConfirm', () => { onChange({ ...entry, models: models.map(model => { const { capabilityOverrides, ...rest } = model; return rest; }) }); setConfirm(false); }, { 'data-capability-reset-accept': true }),
        button('cancel', () => setConfirm(false), { 'data-capability-reset-cancel': true })
      ] }) : button('capabilityReset', () => setConfirm(true), { 'data-capability-reset': true, disabled: disabled || exceptions === 0 })
    ] })
  ] });
}

export function ModelCapabilityChoices({ model, defaults, inputFallback, position, disabled, t, onChange, expanded }) {
  if (!defaults) return null;
  const h = react_jsx_runtime.jsx, hs = react_jsx_runtime.jsxs;
  const effective = applyModelCapabilities(model, defaults);
  const state = key => key === 'vision' ? effective.input === void 0 && inputFallback === void 0 ? void 0 : (effective.input ?? inputFallback).includes('image') : effective.reasoningEfforts === void 0 ? void 0 : effective.reasoningEfforts !== false;
  const actual = key => t(state(key) === void 0 ? 'capabilityCatalog' : state(key) ? 'capabilityEnabled' : 'capabilityDisabled');
  const text = key => {
    const value = model.capabilityOverrides?.[key];
    return t(value === 'original' ? 'capabilityOriginal' : value === void 0 ? 'capabilityFollow' : value ? 'capabilityOn' : 'capabilityOff') + ' · ' + actual(key);
  };
  return hs('div', { 'data-model-capabilities': true, style: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }, children: ['vision', 'reasoning'].map(key => expanded ? hs('label', { className: ModelsSection_module_css_default.field, children: [h('span', { children: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning') + ' · ' + actual(key) }), hs('select', { 'data-model-capability': key, 'aria-label': t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning') + ' ' + position, className: ModelsSection_module_css_default.input + ' ' + ModelsSection_module_css_default.selectInput, value: model.capabilityOverrides?.[key] === void 0 ? 'follow' : String(model.capabilityOverrides[key]), disabled, onChange: event => {
    if (disabled || !['follow', 'true', 'false', 'original'].includes(event.target.value)) return;
    if (event.target.value === 'original' && model.capabilityOverrides?.[key] !== 'original') return;
    const overrides = { ...model.capabilityOverrides };
    if (event.target.value === 'follow') delete overrides[key]; else overrides[key] = event.target.value === 'original' ? 'original' : event.target.value === 'true';
    const { capabilityOverrides, ...rest } = model;
    onChange(Object.keys(overrides).length ? { ...rest, capabilityOverrides: overrides } : rest);
  }, children: [h('option', { value: 'follow', children: t('capabilityFollow') }), h('option', { value: 'true', children: t('capabilityOn') }), h('option', { value: 'false', children: t('capabilityOff') }), model.capabilityOverrides?.[key] === 'original' ? h('option', { value: 'original', children: t('capabilityOriginal') }) : null] })] }, key) : h('span', { className: ModelsSection_module_css_default.advancedHint, children: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning') + ': ' + text(key) }, key)) });
}

export function addSettingsCapabilities(initial, apply, { fullSource = false } = {}) {
  let source = initial;
  const replace = (before, after) => { if (source.split(before).length !== 2) throw new Error('Expected unique capability anchor: ' + before.slice(0, 120)); apply(before, after); source = source.replace(before, after); };
  replace('const MULTI_KEY_PROTOCOLS =', `${applyModelCapabilities.toString()}\n${GroupCapabilityDefaults.toString()}\n${ModelCapabilityChoices.toString()}\n\t\tconst MULTI_KEY_PROTOCOLS =`);
  const groupModel = source.indexOf('models: modelDrafts(entry.models), onChange: (models) => update(id, { models }),');
  const groupStart = source.lastIndexOf('(0, react_jsx_runtime.jsx)(ModelListEditor, {', groupModel);
  if (groupModel < 0 || groupStart < 0) throw new Error('Missing group model editor capability anchor');
  const groupBefore = source.slice(groupStart, groupModel);
  replace(groupBefore + 'models: modelDrafts(entry.models),', `(0, react_jsx_runtime.jsx)(GroupCapabilityDefaults, { entry, t, disabled: disabled || anyBusy, onChange: (next) => { if (!disabled && !anyBusy) update(id, next); } }), ` + groupBefore + 'capabilityDefaults: entry.capabilityDefaults, models: modelDrafts(entry.models),');
  replace('const { model, position, t, disabled } = props;', `const { model, position, t } = props;\n\t\t\tconst disabled = props.disabled || props.capabilityBusy === true;\n\t\t\tconst capabilityDefaults = props.capabilityDefaults;\n\t\t\tconst effectiveCapabilities = capabilityDefaults ? applyModelCapabilities(model, capabilityDefaults) : model;\n\t\t\tconst capabilityNative = (key) => !capabilityDefaults || model.capabilityOverrides?.[key] === "original" || model.capabilityOverrides?.[key] === true;\n\t\t\tconst capabilityChange = (key, next) => {\n\t\t\t\tif (disabled) return;\n\t\t\t\tif (!capabilityDefaults) { props.onChange(next); return; }\n\t\t\t\tconst field = key === "vision" ? "input" : "reasoningEfforts";\n\t\t\t\tconst keepRawReasoning = key === "reasoning" && (next.reasoningEfforts === false || next.reasoningEfforts === void 0);\n\t\t\t\tconst changed = { ...model, ...keepRawReasoning ? {} : { [field]: next[field] }, capabilityOverrides: { ...model.capabilityOverrides, [key]: key === "vision" ? (next.input ?? props.inputFallback ?? ["text"]).includes("image") : next.reasoningEfforts !== false && next.reasoningEfforts !== void 0 } };\n\t\t\t\tif (!keepRawReasoning && next[field] === void 0) delete changed[field];\n\t\t\t\tprops.onChange(changed);\n\t\t\t};`);
  replace('modelField("name"),\n\t\t\t\t\t\tprops.expanded ?', `modelField("name"),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(ModelCapabilityChoices, { model, defaults: capabilityDefaults, inputFallback: props.inputFallback, position, disabled, t, onChange: props.onChange, expanded: props.expanded }),\n\t\t\t\t\t\tprops.expanded ?`);
  replace('(0, react_jsx_runtime.jsx)(ModelInputTypes, {\n\t\t\t\t\t\t\t\t\tmodel,', `capabilityNative("vision") ? (0, react_jsx_runtime.jsx)(ModelInputTypes, {\n\t\t\t\t\t\t\t\t\tmodel: effectiveCapabilities,`);
  replace('onChange: props.onChange\n\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\tprops.reasoningLevels', `onChange: (next) => capabilityChange("vision", next)\n\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\tprops.reasoningLevels`);
  replace('props.reasoningLevels !== void 0 && props.reasoningLevels.length > 0 ?', 'capabilityNative("reasoning") && props.reasoningLevels !== void 0 && props.reasoningLevels.length > 0 ?');
  replace('(0, react_jsx_runtime.jsx)(ModelReasoningEfforts, {\n\t\t\t\t\t\t\t\t\tmodel,', '(0, react_jsx_runtime.jsx)(ModelReasoningEfforts, {\n\t\t\t\t\t\t\t\t\tmodel: effectiveCapabilities,');
  replace('onChange: props.onChange\n\t\t\t\t\t\t\t\t}) : null', 'onChange: (next) => capabilityChange("reasoning", next)\n\t\t\t\t\t\t\t\t}) : null');
  if (fullSource || source.includes('function ModelListEditor(props) {')) {
    const before = 'children: rowState.rows.map(({ model, key, expanded, order }, index) => (0, react_jsx_runtime.jsx)(ModelRow, {\n\t\t\t\t\t\t\trowKey: key,';
    replace(before, before.replace('rowKey: key,', 'capabilityDefaults: props.capabilityDefaults, capabilityBusy: busy,\n\t\t\t\t\t\t\trowKey: key,'));
  }
  const locales = {
    en: { capabilityDefaultsTitle: 'Model capability defaults', capabilityVision: 'Image input', capabilityReasoning: 'Reasoning effort selection', capabilityDefaultsHelp: 'New models follow these defaults. Individual settings stay unchanged. Save with the existing Apply button.', capabilityEnableHelp: 'Enable group defaults explicitly. This advertises capabilities; your relay must support them.', capabilityExisting: 'Existing models', capabilityPreserve: 'Keep existing settings (recommended)', capabilityAllFollow: 'Make all follow this group', capabilityEnable: 'Enable group defaults', capabilityCounts: '{follow} follow group · {exceptions} have individual settings', capabilityReset: 'Make all follow group', capabilityResetHelp: 'Clear individual settings on {count} models? Raw model fields are retained. This edits the draft only.', capabilityResetConfirm: 'Confirm follow group', capabilityOriginal: 'Keep original settings', capabilityFollow: 'Follow group', capabilityOn: 'Individually enabled', capabilityOff: 'Individually disabled', capabilityEnabled: 'Enabled', capabilityCatalog: 'Uses original model configuration', capabilityDisabled: 'Disabled' },
    zh: { capabilityDefaultsTitle: '模型能力默认设置', capabilityVision: '识图', capabilityReasoning: '思考强度设置', capabilityDefaultsHelp: '新加入的模型自动跟随；单独设置过的模型保持原设置。仍由原来的保存按钮提交。', capabilityEnableHelp: '启用分组规则前先选择已有模型如何处理。此设置声明可用能力，中转站本身仍需支持。', capabilityExisting: '已有模型如何处理', capabilityPreserve: '保留现有模型设置（推荐）', capabilityAllFollow: '现有模型全部跟随分组', capabilityEnable: '启用分组默认规则', capabilityCounts: '{follow} 个模型跟随分组 · {exceptions} 个模型有单独设置', capabilityReset: '全部恢复跟随分组', capabilityResetHelp: '清除 {count} 个模型的单独设置？原始模型字段保留；此操作只修改草稿。', capabilityResetConfirm: '确认全部跟随', capabilityOriginal: '保留原设置', capabilityFollow: '跟随分组', capabilityOn: '单独开启', capabilityOff: '单独关闭', capabilityEnabled: '已开启', capabilityCatalog: '按模型原配置', capabilityDisabled: '已关闭' }
  };
  for (const [locale, values] of Object.entries(locales)) replace(`const ${locale} = {\n`, `const ${locale} = {\n${Object.entries(values).map(([key, value]) => `\t\t\t${key}: ${JSON.stringify(value)},\n`).join('')}`);
  return source;
}
