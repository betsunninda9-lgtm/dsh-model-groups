import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
  vm.runInContext(source.slice(start, end) + `\nthis.Component = ${name};`, context);
  return { render(props) { let tree, tries = 0; do { pending = false; cursor = 0; effects = []; tree = context.Component(props); effects.forEach(fn => fn()); if (++tries > 20) throw new Error('render loop'); } while (pending); return tree; } };
}
function groupProps(entry = { name: 'Group', models: [{ id: 'one', input: ['text'], reasoningEfforts: false }, { id: 'two', input: ['text', 'image'], reasoningEfforts: { off: null, high: 'custom' } }] }) {
  const p = { entry, disabled: false, t: key => key, onChange: next => { p.entry = next; } }; return p;
}
function listProps(models, defaults) {
  const p = { models, capabilityDefaults: defaults, disabled: false, probe: {}, operations: {}, reasoningLevels: ['off', 'low', 'medium', 'high'], t: key => key, onBusyChange() {}, onChange: next => { p.models = next; } }; return p;
}
function rowProps(model, defaults) {
  const p = { model, capabilityDefaults: defaults, position: 1, rowKey: 0, order: {}, disabled: false, t: key => key, expanded: true, contextWindow: { value: '', placeholder: '' }, maxTokens: { value: '', placeholder: '' }, reasoningLevels: ['off', 'low', 'high'], onChange: next => { p.model = next; } }; return p;
}

test('first enable preserves existing fields by default, applies only a draft, and new models follow', () => {
  const r = renderer('GroupCapabilityDefaults'), p = groupProps(); const original = structuredClone(p.entry);
  let tree = r.render(p);
  get(tree, 'data-capability-default', 'vision').props.onChange(false);
  assert.deepEqual(p.entry, original, 'uncommitted enable choice does not silently edit existing models');
  tree = r.render(p); get(tree, 'data-capability-enable').props.onClick();
  assert.deepEqual(json(p.entry.capabilityDefaults), { vision: false, reasoning: true });
  assert.deepEqual(json(p.entry.models[0]), { ...original.models[0], capabilityOverrides: { vision: 'original', reasoning: 'original' } });
  assert.deepEqual(json(p.entry.models[1].reasoningEfforts), { off: null, high: 'custom' });
  const list = renderer('ModelListEditor'), lp = listProps(p.entry.models, p.entry.capabilityDefaults);
  const listTree = list.render(lp);
  const row = component(listTree, 'ModelRow');
  assert.deepEqual(json(row.props.capabilityDefaults), { vision: false, reasoning: true });
  flatten(listTree).find(n => n.type === 'button' && n.props.className === 'native-addModelButton').props.onClick();
  assert.equal(lp.models.at(-1).id, ''); assert.equal(lp.models.at(-1).capabilityOverrides, undefined);
});

test('all-follow enable leaves raw model flags intact and reset is confirmable draft metadata only', () => {
  const r = renderer('GroupCapabilityDefaults'), p = groupProps(); const raw = structuredClone(p.entry.models);
  let tree = r.render(p);
  get(tree, 'data-capability-initial-mode').props.onChange({ target: { value: 'follow' } });
  tree = r.render(p); get(tree, 'data-capability-enable').props.onClick();
  assert.deepEqual(json(p.entry.models), raw);
  p.entry.models[0].capabilityOverrides = { vision: false, reasoning: 'original' };
  tree = r.render(p); get(tree, 'data-capability-reset').props.onClick();
  tree = r.render(p); assert.ok(get(tree, 'data-capability-reset-confirm')); assert.ok(p.entry.models[0].capabilityOverrides);
  get(tree, 'data-capability-reset-cancel').props.onClick(); tree = r.render(p); assert.ok(p.entry.models[0].capabilityOverrides);
  get(tree, 'data-capability-reset').props.onClick(); tree = r.render(p); get(tree, 'data-capability-reset-accept').props.onClick();
  assert.deepEqual(json(p.entry.models), raw);
});

test('actual ModelRow exposes follow/on/off choices, reports effective flags and preserves custom wire values', () => {
  const row = renderer('ModelRow'), p = rowProps({ id: 'one', input: ['text'], reasoningEfforts: { off: null, high: 'wire-special' } }, { vision: true, reasoning: true });
  let tree = row.render(p); const choices = component(tree, 'ModelCapabilityChoices'); assert.ok(choices);
  assert.equal(component(tree, 'ModelInputTypes'), undefined, 'following group has no conflicting legacy toggle');
  const select = renderer('ModelCapabilityChoices');
  let choiceTree = select.render(choices.props); assert.equal(get(choiceTree, 'data-model-capability', 'vision').props.value, 'follow');
  get(choiceTree, 'data-model-capability', 'reasoning').props.onChange({ target: { value: 'false' } });
  assert.equal(p.model.capabilityOverrides.reasoning, false); assert.equal(p.model.reasoningEfforts.high, 'wire-special');
  tree = row.render(p); choiceTree = select.render(component(tree, 'ModelCapabilityChoices').props);
  get(choiceTree, 'data-model-capability', 'reasoning').props.onChange({ target: { value: 'true' } });
  tree = row.render(p); const native = component(tree, 'ModelReasoningEfforts'); assert.equal(native.props.model.reasoningEfforts.high, 'wire-special');
  native.props.onChange({ ...native.props.model, reasoningEfforts: { off: null, high: 'custom-2' } });
  assert.equal(p.model.capabilityOverrides.reasoning, true); assert.equal(p.model.reasoningEfforts.high, 'custom-2');
  assert.deepEqual(json(p.model.input), ['text'], 'editing reasoning does not materialize derived vision field');
  tree = row.render(p);
  const offNative = component(tree, 'ModelReasoningEfforts');
  offNative.props.onChange({ ...offNative.props.model, reasoningEfforts: undefined });
  assert.equal(p.model.capabilityOverrides.reasoning, false);
  assert.equal(p.model.reasoningEfforts.high, 'custom-2', 'native off preserves the raw custom map behind explicit off');
  tree = row.render(p); choiceTree = select.render(component(tree, 'ModelCapabilityChoices').props);
  get(choiceTree, 'data-model-capability', 'reasoning').props.onChange({ target: { value: 'true' } });
  tree = row.render(p); assert.equal(component(tree, 'ModelReasoningEfforts').props.model.reasoningEfforts.high, 'custom-2');
  tree = row.render(p); choiceTree = select.render(component(tree, 'ModelCapabilityChoices').props);
  get(choiceTree, 'data-model-capability', 'reasoning').props.onChange({ target: { value: 'follow' } });
  assert.equal(p.model.capabilityOverrides, undefined); assert.equal(p.model.reasoningEfforts.high, 'custom-2');
});

test('legacy original choice is conditional and native edits become explicit exceptions', () => {
  const row = renderer('ModelRow'), p = rowProps({ id: 'one', capabilityOverrides: { vision: 'original', reasoning: 'original' } }, { vision: true, reasoning: true });
  p.inputFallback = ['text', 'image'];
  let tree = row.render(p), choices = renderer('ModelCapabilityChoices').render(component(tree, 'ModelCapabilityChoices').props);
  assert.equal(get(choices, 'data-model-capability', 'vision').props.value, 'original');
  assert.ok(flatten(choices).some(n => n.type === 'option' && n.props.value === 'original'));
  const native = component(tree, 'ModelInputTypes'); native.props.onChange({ ...native.props.model, input: ['text'] });
  assert.equal(p.model.capabilityOverrides.vision, false); assert.deepEqual(json(p.model.input), ['text']);
  tree = row.render(p); choices = renderer('ModelCapabilityChoices').render(component(tree, 'ModelCapabilityChoices').props);
  assert.equal(flatten(get(choices, 'data-model-capability', 'vision')).some(n => n.type === 'option' && n.props.value === 'original'), false);
});

test('unconfigured group retains native model editor behavior and disabled capability controls do not edit', () => {
  const row = renderer('ModelRow'), p = rowProps({ id: 'one' }, undefined);
  let tree = row.render(p); assert.ok(component(tree, 'ModelInputTypes')); assert.ok(component(tree, 'ModelReasoningEfforts'));
  assert.equal(renderer('ModelCapabilityChoices').render(component(tree, 'ModelCapabilityChoices').props), null);
  const group = renderer('GroupCapabilityDefaults'), gp = groupProps(); gp.disabled = true;
  tree = group.render(gp); get(tree, 'data-capability-enable').props.onClick(); assert.equal(gp.entry.capabilityDefaults, undefined);
  get(tree, 'data-capability-default', 'vision').props.onChange(false);
  gp.disabled = false; tree = group.render(gp); assert.equal(get(tree, 'data-capability-default', 'vision').props.checked, true);
  const choices = renderer('ModelCapabilityChoices'), cp = { model: { id: 'one' }, defaults: { vision: true, reasoning: true }, disabled: true, expanded: true, t: key => key, onChange() { throw new Error('disabled changed'); } };
  get(choices.render(cp), 'data-model-capability', 'vision').props.onChange({ target: { value: 'false' } });
});

test('fetched lists retain old exceptions by model identity and new IDs follow group; busy rows cannot edit', async () => {
  const existing = { id: 'old', input: ['text'], reasoningEfforts: { high: 'wire' }, capabilityOverrides: { vision: false, reasoning: 'original' } };
  const r = renderer('ModelListEditor'), p = listProps([existing], { vision: true, reasoning: true });
  let resolve;
  p.probe = { provider: 'p' };
  p.operations = { discoverModels: () => new Promise(done => { resolve = done; }) };
  let tree = r.render(p);
  flatten(tree).find(n => n.type === 'button' && n.props.children === 'fetchModels').props.onClick();
  tree = r.render(p);
  const row = component(tree, 'ModelRow'); assert.equal(row.props.capabilityBusy, true);
  const rowTree = renderer('ModelRow').render({ ...row.props, expanded: true });
  const choiceTree = renderer('ModelCapabilityChoices').render(component(rowTree, 'ModelCapabilityChoices').props);
  assert.equal(get(choiceTree, 'data-model-capability', 'vision').props.disabled, true);
  resolve({ kind: 'found', models: [{ id: 'old' }, { id: 'new' }] });
  await new Promise(done => setImmediate(done));
  tree = r.render(p);
  flatten(tree).find(n => n.props?.children === 'fetchSelectAll' && n.props.onClick).props.onClick();
  tree = r.render(p);
  assert.equal(flatten(tree).filter(n => n.type === 'input' && n.props.type === 'checkbox' && n.props.checked).length, 2, 'both fetched IDs selected: ' + JSON.stringify(component(tree, 'Modal').props.children));
  flatten(component(tree, 'Modal').props.footer).find(n => n.props?.children === 'fetchAdopt' && n.props.onClick).props.onClick();
  assert.equal(p.models.length, 2, JSON.stringify(p.models));
  assert.equal(p.models[0], existing); assert.equal(p.models[0].capabilityOverrides.vision, false);
  assert.equal(p.models[1].id, 'new'); assert.equal(p.models[1].capabilityOverrides, undefined);
});

test('group wrapper passes defaults only into its ModelListEditor and edits that same group', () => {
  const r = renderer('MultiKeyEntriesEditor');
  const entries = { one: { name: 'One', apiKeyEnv: 'ONE_API_KEY', models: [{ id: 'one' }], capabilityDefaults: { vision: true, reasoning: false } }, two: { name: 'Two', apiKeyEnv: 'TWO_API_KEY', models: [{ id: 'two' }] } };
  const p = { route: 'p', entries, persistedEntries: entries, keyDrafts: {}, confirmations: {}, probe: {}, operations: {}, t: key => key, onChange: next => { p.entries = next; }, onKeyDraftsChange() {}, onConfirmationsChange() {} };
  const tree = r.render(p), first = get(tree, 'data-key-entry-id', 'one'), second = get(tree, 'data-key-entry-id', 'two');
  assert.deepEqual(json(component(first, 'ModelListEditor').props.capabilityDefaults), { vision: true, reasoning: false });
  assert.equal(component(second, 'ModelListEditor').props.capabilityDefaults, undefined);
  component(first, 'GroupCapabilityDefaults').props.onChange({ ...entries.one, capabilityDefaults: { vision: false, reasoning: false } });
  assert.equal(p.entries.one.capabilityDefaults.vision, false); assert.equal(p.entries.two, entries.two);
});
