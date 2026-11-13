import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { source } from '../scripts/settings-models-collapse.mjs';

const json = value => JSON.parse(JSON.stringify(value));
const flatten = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(flatten) : [tree, ...flatten(tree.props?.children)];
const get = (tree, key, value = true) => flatten(tree).find(node => node.props?.[key] === value);
const component = (tree, name) => flatten(tree).find(node => node.type?.name === name);
function renderer(name) {
  let slots = [], cursor = 0, effects = [], pending = false;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], update => { const next = typeof update === 'function' ? update(slots[i]) : update; if (next !== slots[i]) { slots[i] = next; pending = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useId() { cursor++; return 'test'; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i][index])) { slots[i] = deps; effects.push(fn); } }
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const primitive = name => ({ [name]: function () {} })[name];
  const context = vm.createContext({ react, react_jsx_runtime: { jsx, jsxs: jsx, Fragment: 'fragment' },
    ModelsSection_module_css_default: new Proxy({}, { get: (_target, key) => 'native-' + key }),
    _deepseek_ai_dsh_client_ui_primitives: new Proxy({}, { get: (_target, key) => primitive(key) }),
    ModelInputTypes: primitive('ModelInputTypes'), ModelReasoningEfforts: primitive('ModelReasoningEfforts'),
    ApiKeyInput: primitive('ApiKeyInput'), modelDrafts: value => Array.isArray(value) ? value : [],
    textOf: (model, field) => typeof model[field] === 'string' ? model[field] : '', numberOf: (model, field) => typeof model[field] === 'number' ? model[field] : undefined,
    capacitySpelling: value => value === undefined ? '' : String(value), parseCapacity: value => Number(value), CAPACITY_HINT: { contextWindow: '128000', maxTokens: '8192' },
    adopt: candidate => ({ id: candidate.id, ...(candidate.name ? { name: candidate.name } : {}) }),
    protocolLabel: (_t, value) => value, apiKeyFailure: () => undefined, validateDeepSeekModels: () => undefined, validateReasoningEfforts: () => undefined,
    crypto: { randomUUID: () => 'test-id' }, structuredClone,
  });
  const start = source.indexOf('function rowHalf(event)');
  const end = source.indexOf('\n\t\t//#endregion', source.indexOf('function MultiKeyEntriesEditor(props)'));
  vm.runInContext(source.slice(start, end) + `\nthis.Component = ${name};this.normalize=normalizedMultiKeyEntries;`, context);
  return { context, render(props) { let tree, tries = 0; do { pending = false; cursor = 0; effects = []; tree = context.Component(props); effects.forEach(fn => fn()); if (++tries > 20) throw new Error('render loop'); } while (pending); return tree; } };
}
function groupProps(entry = { name: 'Group', models: [{ id: 'one', input: ['text'], reasoningEfforts: false }, { id: 'two', input: ['text', 'image'], reasoningEfforts: { off: null, high: 'custom' } }] }) {
  const p = { entry, disabled: false, t: key => key, onChange: next => { p.entry = next; } }; return p;
}
function listProps(models) {
  const p = { models, disabled: false, probe: {}, operations: {}, reasoningLevels: ['off', 'low', 'medium', 'high'], t: key => key, onBusyChange() {}, onChange: next => { p.models = next; } }; return p;
}
function editorProps(entry) {
  const entries = { one: entry, two: { name: 'Other', apiKeyEnv: 'OTHER_API_KEY', models: [{ id: 'other' }] } };
  const p = { route: 'p', entries, persistedEntries: structuredClone(entries), keyDrafts: {}, confirmations: {}, probe: {}, operations: {}, t: key => key, onChange: next => { p.entries = next; }, onKeyDraftsChange() {}, onConfirmationsChange() {} }; return p;
}

test('group layout contains only two native switches, with no policy card, selector, explanation, or model summaries', () => {
  const r = renderer('GroupCapabilityBatch'), p = groupProps(), tree = r.render(p);
  assert.equal(flatten(tree).filter(n => n.type?.name === 'Switch').length, 2);
  assert.equal(flatten(tree).filter(n => ['section', 'p', 'select', 'button', 'strong'].includes(n.type)).length, 0);
  assert.equal(tree.props.className, 'native-field');
  assert.equal(Object.hasOwn(tree.props, 'style'), false);
  assert.ok(get(tree, 'data-capability-batch', 'vision')); assert.ok(get(tree, 'data-capability-batch', 'reasoning'));
});

test('batch switch changes only its capability and native single-model edits survive later rendering', () => {
  const r = renderer('GroupCapabilityBatch'), p = groupProps(); let tree = r.render(p);
  get(tree, 'data-capability-batch', 'vision').props.onChange(true);
  assert.ok(p.entry.models.every(model => model.input.includes('image')));
  assert.equal(p.entry.models[0].reasoningEfforts, false); assert.equal(p.entry.models[1].reasoningEfforts.high, 'custom');
  assert.deepEqual(json(p.entry.capabilityBatch), { vision: true });
  p.entry.models[0] = { ...p.entry.models[0], input: ['text'] };
  tree = r.render(p); assert.equal(p.entry.models[0].input.includes('image'), false, 'last batch is not a continuously enforced rule');
  get(tree, 'data-capability-batch', 'reasoning').props.onChange(true);
  assert.deepEqual(json(p.entry.models[0].input), ['text'], 'other capability batch does not undo single model exception');
  assert.equal(p.entry.models[1].reasoningEfforts.high, 'custom');
  tree = r.render(p); get(tree, 'data-capability-batch', 'vision').props.onChange(false);
  assert.ok(p.entry.models.every(model => !model.input.includes('image')));
  tree = r.render(p); get(tree, 'data-capability-batch', 'reasoning').props.onChange(false);
  assert.ok(p.entry.models.every(model => model.reasoningEfforts === false));
});

test('ModelRow markup and logic exactly match the accepted stable 0.3.9 row', () => {
  let expected = fs.readFileSync(new URL('fixtures/settings-models/model-rows.js.txt', import.meta.url), 'utf8');
  const stable = JSON.parse(fs.readFileSync(new URL('fixtures/settings-models/v0.3.9.json', import.meta.url), 'utf8'));
  for (const { before, after } of stable.replacements) if (expected.includes(before)) expected = expected.split(before).join(after);
  const row = text => { const start = text.indexOf('function ModelRow(props) {'); return text.slice(start, text.indexOf('\n\t\t//#endregion', start)); };
  assert.equal(row(source), row(expected));
});

test('actual ModelRow and ModelListEditor retain original fields and original change handlers', () => {
  const r = renderer('ModelRow'); const onChange = () => {};
  const p = { model: { id: 'one', input: ['text'], reasoningEfforts: { high: 'custom' } }, position: 1, rowKey: 0, order: {}, disabled: false, t: key => key, expanded: true, contextWindow: { value: '', placeholder: '' }, maxTokens: { value: '', placeholder: '' }, reasoningLevels: ['off', 'low', 'high'], onChange };
  const tree = r.render(p);
  assert.equal(component(tree, 'ModelInputTypes').props.model, p.model);
  assert.equal(component(tree, 'ModelReasoningEfforts').props.model, p.model);
  assert.equal(component(tree, 'ModelInputTypes').props.onChange, onChange);
  assert.equal(component(tree, 'ModelReasoningEfforts').props.onChange, onChange);
  assert.equal(component(tree, 'ModelCapabilityChoices'), undefined);
  assert.equal(flatten(tree).some(n => n.type === 'select' || n.props?.['data-model-capabilities']), false);
  const list = renderer('ModelListEditor').render(listProps([p.model]));
  assert.equal(Object.hasOwn(component(list, 'ModelRow').props, 'capabilityDefaults'), false);
});

test('group callbacks stay local, materialize beta policy, and preserve native edits through save and reload', () => {
  const legacy = { name: 'One', apiKeyEnv: 'ONE_API_KEY', capabilityDefaults: { vision: true, reasoning: true }, models: [{ id: 'one', input: ['text'], reasoningEfforts: { off: null, high: 'custom' } }] };
  const r = renderer('MultiKeyEntriesEditor'), p = editorProps(legacy); let tree = r.render(p);
  const group = get(tree, 'data-key-entry-id', 'one');
  assert.equal(group.props['data-key-entry-dirty'], false, 'display migration does not dirty untouched profile');
  const modelList = component(group, 'ModelListEditor');
  assert.ok(modelList.props.models[0].input.includes('image'));
  assert.ok(p.entries.one.capabilityDefaults, 'render does not write any config');
  modelList.props.onChange([{ ...modelList.props.models[0], input: ['text'], reasoningEfforts: false }]);
  assert.equal(p.entries.one.capabilityDefaults, undefined);
  assert.equal(p.entries.one.models[0].capabilityOverrides, undefined);
  assert.deepEqual(json(p.entries.one.models[0].input), ['text']);
  assert.equal(p.entries.two.models[0].id, 'other'); assert.equal(p.entries.two.capabilityBatch, undefined);
  const saved = json(r.context.normalize('p', p.entries));
  const next = editorProps(saved.one); next.persistedEntries = structuredClone(next.entries);
  tree = renderer('MultiKeyEntriesEditor').render(next);
  const loaded = component(get(tree, 'data-key-entry-id', 'one'), 'ModelListEditor').props.models[0];
  assert.deepEqual(json(loaded.input), ['text']); assert.equal(loaded.reasoningEfforts, false);
});

test('legacy beta group name edit becomes clean after normalized save without rewriting its untouched draft during render', () => {
  const legacy = { name: 'One', apiKeyEnv: 'ONE_API_KEY', capabilityDefaults: { vision: true, reasoning: true }, models: [{ id: 'one', input: ['text'], reasoningEfforts: false }] };
  const r = renderer('MultiKeyEntriesEditor'), p = editorProps(legacy);
  let tree = r.render(p), group = get(tree, 'data-key-entry-id', 'one');
  assert.equal(group.props['data-key-entry-dirty'], false);
  flatten(group).find(n => n.type === 'input' && n.props.type === 'text' && n.props.value === 'One').props.onChange({ target: { value: 'Renamed' } });
  tree = r.render(p); group = get(tree, 'data-key-entry-id', 'one');
  assert.equal(group.props['data-key-entry-dirty'], true);
  assert.ok(p.entries.one.capabilityDefaults, 'name edit does not prematurely convert draft metadata');
  const saved = json(r.context.normalize('p', p.entries));
  assert.equal(saved.one.capabilityDefaults, undefined);
  p.saveState = { ok: true, entries: saved }; p.savedEntries = saved;
  tree = r.render(p); group = get(tree, 'data-key-entry-id', 'one');
  assert.equal(group.props['data-key-entry-dirty'], false, 'normalized successful save clears the unsaved marker');
  assert.equal(group.props['data-key-entry-expanded'], false, 'acknowledged snapshot can collapse normally');
});

test('new manually added models inherit last group batch without rewriting existing single-model settings', () => {
  const r = renderer('MultiKeyEntriesEditor'), p = editorProps({ name: 'One', apiKeyEnv: 'ONE_API_KEY', capabilityBatch: { vision: true, reasoning: false }, models: [{ id: 'old', input: ['text'], reasoningEfforts: { high: 'custom' } }] });
  const listNode = component(get(r.render(p), 'data-key-entry-id', 'one'), 'ModelListEditor');
  const list = renderer('ModelListEditor'), lp = { ...listProps(listNode.props.models), onChange: listNode.props.onChange };
  const tree = list.render(lp);
  flatten(tree).find(n => n.type === 'button' && n.props.className === 'native-addModelButton').props.onClick();
  assert.deepEqual(json(p.entries.one.models[0].input), ['text']); assert.equal(p.entries.one.models[0].reasoningEfforts.high, 'custom');
  assert.equal(p.entries.one.models[1].id, ''); assert.ok(p.entries.one.models[1].input.includes('image')); assert.equal(p.entries.one.models[1].reasoningEfforts, false);
});

test('fetched new model IDs inherit batch while retained IDs preserve raw individual settings', async () => {
  const r = renderer('MultiKeyEntriesEditor'), p = editorProps({ name: 'One', apiKeyEnv: 'ONE_API_KEY', capabilityBatch: { vision: true, reasoning: true }, models: [{ id: 'old', input: ['text'], reasoningEfforts: false }] });
  const node = component(get(r.render(p), 'data-key-entry-id', 'one'), 'ModelListEditor');
  const list = renderer('ModelListEditor'), lp = { ...listProps(node.props.models), probe: { provider: 'p' }, onChange: node.props.onChange, operations: { discoverModels: async () => ({ kind: 'found', models: [{ id: 'old' }, { id: 'new' }] }) } };
  let tree = list.render(lp);
  flatten(tree).find(n => n.type === 'button' && n.props.children === 'fetchModels').props.onClick();
  await new Promise(done => setImmediate(done));
  tree = list.render(lp); flatten(tree).find(n => n.props?.children === 'fetchSelectAll' && n.props.onClick).props.onClick();
  tree = list.render(lp); flatten(component(tree, 'Modal').props.footer).find(n => n.props?.children === 'fetchAdopt' && n.props.onClick).props.onClick();
  assert.deepEqual(json(p.entries.one.models[0].input), ['text']); assert.equal(p.entries.one.models[0].reasoningEfforts, false);
  assert.equal(p.entries.one.models[1].id, 'new'); assert.ok(p.entries.one.models[1].input.includes('image')); assert.equal(p.entries.one.models[1].reasoningEfforts.high, 'high');
});

test('disabled group switches and busy wrapper cannot mutate any entry', () => {
  const r = renderer('GroupCapabilityBatch'), p = groupProps(); p.disabled = true;
  get(r.render(p), 'data-capability-batch', 'vision').props.onChange(true);
  assert.equal(p.entry.capabilityBatch, undefined);
  const editor = renderer('MultiKeyEntriesEditor'), ep = editorProps({ name: 'One', apiKeyEnv: 'ONE_API_KEY', models: [{ id: 'one' }] });
  let tree = editor.render(ep); component(get(tree, 'data-key-entry-id', 'one'), 'ModelListEditor').props.onBusyChange(true);
  tree = editor.render(ep); const g = get(tree, 'data-key-entry-id', 'one'), before = ep.entries;
  assert.equal(component(g, 'GroupCapabilityBatch').props.disabled, true);
  component(g, 'GroupCapabilityBatch').props.onChange({ ...ep.entries.one, capabilityBatch: { vision: true } });
  assert.equal(ep.entries, before);
});
