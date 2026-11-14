import { applyModelCapabilities, validateCapabilityBatch, applyModelBatchCapabilities, materializeCapabilityEntry, applyCapabilityBatch, mergeCapabilityModels } from '../src/capability-defaults.js';

// Embedded into the verified host bundle. These functions modify drafts only.
export function GroupCapabilityBatch({ entry, onChange, disabled, t }) {
  const migrated = materializeCapabilityEntry(entry);
  const jsx = react_jsx_runtime.jsx, jsxs = react_jsx_runtime.jsxs;
  const css = ModelsSection_module_css_default;
  return jsxs('div', { 'data-group-capabilities': true, className: css.field, children: ['vision', 'reasoning'].map(key => jsxs('div', {
    className: css.modelReasoningHead,
    children: [jsx('span', { className: css.fieldLabel, children: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning') }), jsx(_deepseek_ai_dsh_client_ui_primitives.Switch, {
      'data-capability-batch': key, label: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning'), checked: migrated.capabilityBatch?.[key] === true, disabled,
      onChange: enabled => { if (!disabled && typeof enabled === 'boolean') onChange(applyCapabilityBatch(entry, key, enabled)); }
    })]
  }, key)) });
}

export function addSettingsCapabilities(initial, apply) {
  let source = initial;
  const replace = (before, after) => { if (source.split(before).length !== 2) throw new Error('Expected unique capability batch anchor: ' + before.slice(0, 120)); apply(before, after); source = source.replace(before, after); };
  const helpers = [applyModelCapabilities, validateCapabilityBatch, applyModelBatchCapabilities, materializeCapabilityEntry, applyCapabilityBatch, mergeCapabilityModels, GroupCapabilityBatch].map(fn => fn.toString()).join('\n');
  replace('const MULTI_KEY_PROTOCOLS =', helpers + '\n\t\tconst MULTI_KEY_PROTOCOLS =');
  replace('JSON.stringify(entry) !== JSON.stringify(saved)', 'JSON.stringify(materializeCapabilityEntry(entry)) !== JSON.stringify(materializeCapabilityEntry(saved))');
  // Normalization materializes old beta policies when the existing save is used.
  // Rendering retains raw entries for unchanged dirty/saved snapshot comparison.
  replace('return Object.fromEntries(orderedKeyEntries(entries).map(([id, entry]) => {', 'return Object.fromEntries(orderedKeyEntries(entries).map(([id, rawEntry]) => {\n\t\t\t\tconst entry = materializeCapabilityEntry(rawEntry);');
  const groupModel = source.indexOf('models: modelDrafts(entry.models), onChange: (models) => update(id, { models }),');
  const groupStart = source.lastIndexOf('(0, react_jsx_runtime.jsx)(ModelListEditor, {', groupModel);
  if (groupModel < 0 || groupStart < 0) throw new Error('Missing group model editor batch anchor');
  const groupBefore = source.slice(groupStart, groupModel);
  replace(groupBefore + 'models: modelDrafts(entry.models), onChange: (models) => update(id, { models }),',
    '(0, react_jsx_runtime.jsx)(GroupCapabilityBatch, { entry, t, disabled: disabled || anyBusy, onChange: (next) => { if (!disabled && !anyBusy) onChange({ ...entries, [id]: next }); } }), ' + groupBefore + 'models: modelDrafts(materializeCapabilityEntry(entry).models), onChange: (models) => { if (!disabled && !anyBusy) onChange({ ...entries, [id]: mergeCapabilityModels(entry, models) }); },');
  for (const [locale, labels] of Object.entries({ en: { capabilityVision: 'Image input', capabilityReasoning: 'Reasoning effort' }, zh: { capabilityVision: '识图', capabilityReasoning: '思考强度' } })) {
    const text = Object.entries(labels).map(([key, value]) => `\t\t\t${key}: ${JSON.stringify(value)},\n`).join('');
    replace(`const ${locale} = {\n`, `const ${locale} = {\n${text}`);
  }
  return source;
}
