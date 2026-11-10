import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { artifact, base, previous, source } from '../scripts/settings-models-collapse.mjs';
import { sha256, transformSource } from '../scripts/native-patches.mjs';

// Evaluate the ACTUAL generated host functions, not a parallel implementation.
// This tiny hook renderer preserves function-component hook slots across renders;
// JSX children stay descriptors so mounting/visibility can be inspected directly.
function harness() {
  let cursor = 0, effects = [], slots = [], pending = false;
  const react = {
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
      return [slots[id], value => { const next = typeof value === 'function' ? value(slots[id]) : value; if (next !== slots[id]) { slots[id] = next; pending = true; } }];
    },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
    useId() { const id = cursor++; return slots[id] ??= ':fixture-id:'; },
    useEffect(fn, deps) {
      const id = cursor++, previous = slots[id];
      if (!previous || deps.some((value, i) => !Object.is(previous[i], value))) { slots[id] = deps; effects.push(fn); }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const start = source.indexOf('const MULTI_KEY_ENTRY_ID');
  const end = source.indexOf('\t\t//#endregion', start);
  const context = vm.createContext({ react, react_jsx_runtime: { jsx, jsxs: jsx }, ModelsSection_module_css_default: {},
    _deepseek_ai_dsh_client_ui_primitives: {}, crypto: { randomUUID: () => 'fixture' }, structuredClone,
    apiKeyFailure: value => /\n/.test(value) ? 'badKey' : undefined,
    modelDrafts: value => Array.isArray(value) ? value : [],
    validateDeepSeekModels: models => models.some(m => !m.id) ? { index: 0, key: 'badModel' } : undefined,
    validateReasoningEfforts: () => undefined,
    ApiKeyInput: function ApiKeyInput() {}, ModelListEditor: function ModelListEditor() {},
  });
  vm.runInContext(source.slice(start, end) + '\nthis.Editor = MultiKeyEntriesEditor;this.dirty = multiKeyEntryDirty;this.store = storeMultiKeyDrafts;', context);
  return { context, render(props) {
    let tree, rounds = 0;
    do { pending = false; cursor = 0; effects = []; tree = context.Editor(props); for (const fn of effects) fn(); if (++rounds > 20) throw new Error('Hook render loop'); } while (pending);
    return tree;
  } };
}
function flatten(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(flatten);
  return [tree, ...flatten(tree.props?.children)];
}
const get = (tree, predicate) => flatten(tree).find(predicate);
const card = (tree, id = 'one') => get(tree, node => node.props?.['data-key-entry-id'] === id);
const toggle = tree => get(card(tree), node => Object.hasOwn(node.props ?? {}, 'aria-expanded'));
const model = tree => get(card(tree), node => node.type?.name === 'ModelListEditor');
function props() {
  const entries = { one: { name: 'Saved key', apiKeyEnv: 'P_MULTKEY_ONE_API_KEY', models: [{ id: 'm' }] } };
  const p = { route: 'p', entries: structuredClone(entries), persistedEntries: entries, keyDrafts: {}, confirmations: {}, probe: { provider: 'p' }, operations: {}, t: value => value,
    onChange: next => { p.entries = next; },
    onKeyDraftsChange: update => { p.keyDrafts = typeof update === 'function' ? update(p.keyDrafts) : update; },
    onConfirmationsChange: update => { p.confirmations = typeof update === 'function' ? update(p.confirmations) : update; } };
  return p;
}

test('generated shipped settings patch is hash locked, current and reversible in memory', () => {
  assert.equal(artifact.variants.length, 1);
  // Full-host hash/reversibility is additionally checked by the shipped native
  // test with explicit DSH_ROOT; this suite has no installed-host dependency.
  assert.equal(artifact.baseSha256, artifact.variants[0].baseSha256);
  const shipped = JSON.parse(fs.readFileSync(new URL('../native/settings-models.patch.json', import.meta.url), 'utf8'));
  assert.deepEqual(shipped, artifact);
  new vm.Script(source);
  for (const version of ['beta3', 'beta4', 'beta5']) {
    const old = JSON.parse(fs.readFileSync(new URL(`fixtures/settings-models/${version}.json`, import.meta.url), 'utf8'));
    assert.equal(old.resultSha256, artifact.variants[0].resultSha256);
    assert.deepEqual(old.replacements, artifact.variants[0].replacements);
  }
});

test('saved defaults collapsed; key controls stay visible and masked by original component; new row expands', () => {
  const h = harness(), p = props(); let tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-expanded'], false);
  assert.equal(card(tree).props['data-key-entry-dirty'], false);
  const details = get(card(tree), node => node.props?.['data-key-entry-details']);
  assert.equal(details.props.hidden, true);
  assert.equal(details.props.style.display, 'none');
  assert.ok(get(card(tree), node => node.type?.name === 'ApiKeyInput'));
  assert.ok(model(tree), 'model editor remains mounted while hidden');
  assert.ok(get(details, node => node.props?.children === 'multiKeyRemove'));
  assert.equal(toggle(tree).props['aria-controls'], details.props.id);
  get(tree, node => node.type === 'button' && node.props.children === 'multiKeyAdd').props.onClick();
  tree = h.render(p);
  assert.equal(card(tree, 'kfixture').props['data-key-entry-expanded'], true);
  assert.equal(card(tree, 'kfixture').props['data-key-entry-dirty'], true);
});

test('manual collapse retains profile drafts, key text, confirmation and mounted details', () => {
  const h = harness(), p = props(); let tree = h.render(p);
  toggle(tree).props.onClick(); tree = h.render(p);
  get(tree, n => n.type === 'input' && n.props.type === 'text').props.onChange({ target: { value: 'Draft name' } });
  get(tree, n => n.type?.name === 'ApiKeyInput').props.onChange({ target: { value: 'typed-not-fetched-secret' } });
  tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-dirty'], true);
  toggle(tree).props.onClick(); tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-expanded'], false);
  assert.equal(p.entries.one.name, 'Draft name');
  assert.equal(p.keyDrafts.one, 'typed-not-fetched-secret');
  assert.equal(model(tree).props.models[0].id, 'm');
  assert.equal(get(tree, n => n.type?.name === 'ApiKeyInput').props.value, p.keyDrafts.one);
  model(tree).props.onChange([{ id: 'draft-model' }]);
  tree = h.render(p);
  toggle(tree).props.onClick(); tree = h.render(p);
  assert.equal(model(tree).props.models[0].id, 'draft-model');
  assert.equal(p.entries.one.name, 'Draft name');
  assert.equal(card(tree).key, 'one', 'stable React card identity preserves child hook state');
});

test('validation opens affected entries; save failure reopens after manual collapse; success collapses only saved snapshots', () => {
  const h = harness(), p = props(); let tree = h.render(p);
  p.entries.one.name = ''; tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-expanded'], true);
  p.entries.one.name = 'fixed'; tree = h.render(p);
  toggle(tree).props.onClick(); tree = h.render(p);
  p.saveState = { ok: false, entries: structuredClone(p.entries) }; tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-expanded'], true);
  const submitted = structuredClone(p.entries);
  p.entries.other = { name: 'Added while saving', models: [{ id: 'new' }] };
  p.saveState = { ok: true, entries: submitted }; p.savedEntries = submitted;
  tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-expanded'], false);
  assert.equal(card(tree).props['data-key-entry-dirty'], false);
  assert.equal(card(tree, 'other').props['data-key-entry-expanded'], true);
  assert.equal(card(tree, 'other').props['data-key-entry-dirty'], true);
});

test('equivalent fresh descriptor objects do not reopen or recollapse manually toggled saved entries', () => {
  const h = harness(), p = props(); let tree = h.render(p);
  toggle(tree).props.onClick(); tree = h.render(p);
  p.persistedEntries = structuredClone(p.persistedEntries); p.entries = structuredClone(p.entries);
  tree = h.render(p);
  assert.equal(card(tree).props['data-key-entry-expanded'], true);
  assert.equal(card(tree).props['data-key-entry-dirty'], false);
  toggle(tree).props.onClick(); tree = h.render(p);
  p.persistedEntries = structuredClone(p.persistedEntries);
  assert.equal(card(h.render(p)).props['data-key-entry-expanded'], false);
});

test('a success cannot collapse a newer draft or an outstanding key', () => {
  for (const change of [p => { p.entries.one.name = 'newer'; }, p => { p.keyDrafts.one = 'newer-secret'; }]) {
    const h = harness(), p = props(); let tree = h.render(p); toggle(tree).props.onClick(); tree = h.render(p);
    const submitted = structuredClone(p.entries); change(p);
    p.saveState = { ok: true, entries: submitted }; p.savedEntries = submitted;
    tree = h.render(p);
    assert.equal(card(tree).props['data-key-entry-expanded'], true);
    assert.equal(card(tree).props['data-key-entry-dirty'], true);
  }
});

test('partial credential failure retains unfinished draft and never clears concurrent replacement', async () => {
  const h = harness(), entries = { one: { apiKeyEnv: 'A' }, two: { apiKeyEnv: 'B' } };
  let drafts = { one: 'first', two: 'second' }; const writes = [];
  const operations = { async storeCredential(ref, value) { writes.push([ref, value]); return ref === 'B' ? 'failed' : undefined; } };
  const failure = await h.context.store(operations, entries, { ...drafts }, update => { drafts = update(drafts); });
  assert.equal(failure, 'failed'); assert.equal(drafts.one, ''); assert.equal(drafts.two, 'second');
  assert.deepEqual(writes, [['A', 'first'], ['B', 'second']]);
  drafts = { one: 'newer-secret' };
  await h.context.store({ async storeCredential() {} }, { one: entries.one }, { one: 'older-secret' }, update => { drafts = update(drafts); });
  assert.equal(drafts.one, 'newer-secret');
});

test('owner outcome wiring preserves create close and reports normalized save snapshots without a new endpoint', () => {
  const custom = source.slice(source.indexOf('function CustomProviderCard(props)'), source.indexOf('//#region lib/types/client/ProviderEditor'));
  const provider = source.slice(source.indexOf('function ProviderEditor(props)'), source.indexOf('//#region lib/types/client/ModelsSection'));
  assert.match(custom, /const outcome = await createOnce\(\);[\s\S]*setEntrySaveState\(\{ ok: outcome === void 0/);
  assert.match(custom, /props\.onClose\(true\)/);
  assert.doesNotMatch(custom, /if \(!multiKey\) props\.onClose/);
  assert.match(provider, /const failure = await applyOnce\(\);[\s\S]*setEntrySaveState\(\{ ok: failure === void 0/);
  assert.match(provider, /normalizedMultiKeyEntries\(props\.provider, keyEntries\)/);
  assert.match(provider, /if \(!multiKey\) props\.onClose\(true\)/);
  for (const code of [custom, provider]) {
    assert.match(code, /saveState: entrySaveState/);
    assert.match(code, /catch \{[\s\S]*setEntrySaveState\(\{ ok: false/);
    assert.match(code, /saving\.current = false/);
    assert.match(code, /storeMultiKeyDrafts\(operations,/);
  }
});

test('existing footer remains the only commit interface and becomes offset sticky', () => {
  const footer = source.slice(source.indexOf('function EditorFooter(props)'), source.indexOf('//#region lib/types/client/ModelInputTypes'));
  assert.match(footer, /position: "sticky"/);
  assert.match(footer, /safe-area-inset-bottom/);
  assert.match(footer, /--dsh-model-save-offset/);
  assert.match(footer, /onClick: props.onSubmit/);
  assert.equal((source.match(/function EditorFooter\(/g) ?? []).length, 1);
  assert.equal((source.match(/setEntrySaveState\(\{ ok:/g) ?? []).length, 4);
  assert.equal(source.includes('credentials/get'), previous.includes('credentials/get'));
});
