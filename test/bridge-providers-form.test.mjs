import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeProvidersForm } from '../src/bridge/providers-form.js';
import { buildModelHierarchy } from '../src/hierarchy.js';
import { createStore } from './helpers/picker-harness.mjs';

const nativeSnapshot = () => ({ status: 'ready', revision: 3, writable: true,
  value: { otherSetting: 'kept', providers: { sample: { api: 'openai-completions', baseURL: 'http://127.0.0.1/bridge', extra: 'kept' },
    untouched: { models: [{ id: 'ordinary' }] } } } });
const bridgeSnapshot = (overrides = {}) => ({ status: 'ready', revision: 9,
  providers: { sample: { enabled: true, active: true, confirmed: true,
    keyEntries: { work: { name: '工作凭据', apiKeyEnv: 'WORK_KEY', models: [{ id: 'model-a' }] } }, ...overrides } } });

test('confirmed overlay drives the existing hierarchy without mutating either form', () => {
  const original = nativeSnapshot(), sidecar = bridgeSnapshot();
  const native = createStore(original), bridge = createStore(sidecar);
  const form = createBridgeProvidersForm(native, bridge);
  const snapshot = form.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.value.otherSetting, 'kept');
  assert.equal(snapshot.value.providers.sample.extra, 'kept');
  assert.equal(snapshot.value.providers.untouched, original.value.providers.untouched);
  assert.equal(snapshot.value.providers.sample.keyEntries, sidecar.providers.sample.keyEntries);
  assert.equal(snapshot.value.providers.sample.multiKey, true);
  assert.equal(snapshot.value.providers.sample.bridgeRouting, true);
  assert.equal(original.value.providers.sample.bridgeRouting, undefined);
  assert.equal(original.value.providers.sample.multiKey, undefined);
  assert.equal(Object.hasOwn(form, 'mutate'), false);
  assert.equal(form.getSnapshot(), snapshot, 'React reads a stable snapshot until an input changes');
  const groups = [{ id: 'sample', models: [{ id: '@dsh-key/work/model-a', name: 'Model A' }] }];
  const hierarchy = buildModelHierarchy(groups, snapshot.value.providers, {});
  assert.equal(hierarchy[0].kind, 'multi');
  assert.equal(hierarchy[0].children[0].name, '工作凭据');
  assert.equal(hierarchy[0].children[0].models[0].id, '@dsh-key/work/model-a');
  form.dispose();
  assert.equal(form.getSnapshot(), original, 'retained faces stop advertising bridge ownership after disposal');
});

test('every inactive, unconfirmed or malformed route stays native', () => {
  for (const change of [{ enabled: false }, { active: false }, { confirmed: false }, { active: undefined }, { confirmed: undefined }, { keyEntries: null }, { keyEntries: [] }]) {
    const original = nativeSnapshot();
    const native = createStore(original), bridge = createStore(bridgeSnapshot(change));
    const form = createBridgeProvidersForm(native, bridge);
    assert.equal(form.getSnapshot(), original);
    assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
    form.dispose();
  }
});

test('loading holds valid snapshots but explicit disable, denial and shutdown remove the overlay', () => {
  const native = createStore(nativeSnapshot()), bridge = createStore(bridgeSnapshot());
  const form = createBridgeProvidersForm(native, bridge);
  const ready = form.getSnapshot();
  let updates = 0;
  const unsubscribe = form.subscribe(() => { updates++; });
  native.set({ status: 'loading' });
  bridge.set({ status: 'loading' });
  assert.equal(form.getSnapshot(), ready);
  assert.equal(updates, 0, 'transient refresh does not empty the picker');
  bridge.set(bridgeSnapshot({ enabled: false }));
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  assert.equal(updates, 1);
  bridge.set(bridgeSnapshot());
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, true);
  bridge.set({ status: 'forbidden' });
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  bridge.set({ status: 'loading' });
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined, 'denial invalidates held bridge state');
  bridge.set(bridgeSnapshot());
  bridge.set({ status: 'unavailable' });
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  native.set({ status: 'forbidden' });
  assert.equal(form.getSnapshot().status, 'forbidden');
  native.set({ status: 'loading' });
  assert.equal(form.getSnapshot().status, 'loading', 'denial invalidates held native state');
  unsubscribe();
  form.dispose();
  assert.equal(native.subscriberCount, 0);
  assert.equal(bridge.subscriberCount, 0);
});

test('ConfigForms-shaped sidecars refresh once and repeated notifications retain the cache', () => {
  const native = createStore(nativeSnapshot());
  const initial = bridgeSnapshot();
  const bridge = createStore({ status: 'ready', value: { providers: initial.providers } });
  const form = createBridgeProvidersForm(native, bridge);
  let changes = 0;
  form.subscribe(() => { changes++; });
  const first = form.getSnapshot();
  bridge.set(bridge.getSnapshot());
  assert.equal(form.getSnapshot(), first);
  assert.equal(changes, 0);
  const changed = bridgeSnapshot();
  changed.providers.sample.keyEntries.work.name = '另一名称';
  bridge.set({ status: 'ready', value: { providers: changed.providers } });
  assert.equal(changes, 1);
  assert.equal(form.getSnapshot().value.providers.sample.keyEntries.work.name, '另一名称');
  form.dispose();
  form.dispose();
  const last = form.getSnapshot();
  bridge.set(bridge.getSnapshot());
  assert.equal(form.getSnapshot(), last);
  assert.equal(changes, 1);
});

test('missing forms and unsafe property names never invent an active route', () => {
  const absent = createBridgeProvidersForm(undefined, undefined);
  assert.equal(absent.getSnapshot().status, 'unavailable');
  absent.dispose();
  const native = createStore(nativeSnapshot());
  const providers = JSON.parse('{"__proto__":{"enabled":true,"active":true,"confirmed":true,"keyEntries":{}},"constructor":{"enabled":true,"active":true,"confirmed":true,"keyEntries":{}}}');
  const form = createBridgeProvidersForm(native, createStore({ status: 'ready', providers }));
  assert.equal(form.getSnapshot(), native.getSnapshot());
  assert.equal({}.multiKey, undefined);
  form.dispose();
});

test('versioned tokens map to stable key names and order while stale aliases stay unlisted', () => {
  const sidecar = bridgeSnapshot({
    keyEntries: {
      work: { name: '工作凭据', sortOrder: 20, models: [{ id: 'model-a', input: ['text', 'image'] }] },
      personal: { name: '个人凭据', sortOrder: 5, models: [{ id: 'model-b' }] },
    },
    routing: { g_new_work: 'work', g_new_personal: 'personal', g_missing: 'removed' },
  });
  const native = createStore(nativeSnapshot()), bridge = createStore(sidecar);
  const form = createBridgeProvidersForm(native, bridge);
  const snapshot = form.getSnapshot();
  const entries = snapshot.value.providers.sample.keyEntries;
  assert.deepEqual(Object.keys(entries), ['g_new_personal', 'g_new_work']);
  assert.equal(entries.g_new_work.name, '工作凭据');
  assert.equal(Object.hasOwn(entries, 'work'), false, 'stable card IDs are not runtime routing tokens');
  const directory = [{ id: 'sample', models: [
    { id: '@dsh-key/g_old_work/model-a' },
    { id: '@dsh-key/g_new_work/model-a' },
    { id: '@dsh-key/g_new_personal/model-b' },
  ] }];
  const hierarchy = buildModelHierarchy(directory, snapshot.value.providers, {}, { provider: 'sample', model: '@dsh-key/g_old_work/model-a' });
  assert.deepEqual(hierarchy[0].children.map(entry => [entry.entryId, entry.name]), [
    ['g_new_personal', '个人凭据'], ['g_new_work', '工作凭据'],
  ]);
  assert.equal(hierarchy[0].children.some(entry => entry.current), false, 'a stale selection is never changed to another token');
  assert.equal(form.getSnapshot(), snapshot);
  const renewed = { ...sidecar, providers: { sample: { ...sidecar.providers.sample, routing: { g_next_work: 'work' } } } };
  bridge.set(renewed);
  assert.deepEqual(Object.keys(form.getSnapshot().value.providers.sample.keyEntries), ['g_next_work']);
  assert.equal(snapshot.value.providers.sample.keyEntries.g_new_work.name, '工作凭据', 'held snapshots remain stable');
  form.dispose();
});

test('root routing gets a final compatibility group and projected data is independent of both forms', () => {
  const original = nativeSnapshot();
  const sidecar = bridgeSnapshot({
    keyEntries: {
      work: { name: '工作凭据', models: [{ id: 'model-a', input: ['text', 'image'], reasoningEfforts: { off: null, high: 'deep' } }] },
    },
    routing: { g_root: null, g_work: 'work', __ignored: 'missing' },
    rootModels: [{ id: 'original', input: ['text'], reasoningEfforts: { off: null, low: 'low' } }],
  });
  const before = JSON.parse(JSON.stringify(sidecar));
  const form = createBridgeProvidersForm(createStore(original), createStore(sidecar));
  const projected = form.getSnapshot().value.providers.sample;
  assert.deepEqual(Object.keys(projected.keyEntries), ['g_work', 'g_root']);
  assert.equal(projected.keyEntries.g_root.name, '原单密钥（兼容旧会话）');
  assert.equal(projected.keyEntries.g_root.sortOrder, 1);
  assert.deepEqual(projected.keyEntries.g_root.models, sidecar.providers.sample.rootModels);
  const hierarchy = buildModelHierarchy([{ id: 'sample', models: [
    { id: '@dsh-key/g_root/original' }, { id: '@dsh-key/g_work/model-a' },
  ] }], { sample: projected }, {});
  assert.deepEqual(hierarchy[0].children.map(entry => entry.name), ['工作凭据', '原单密钥（兼容旧会话）']);
  projected.keyEntries.g_work.models[0].input.push('test-only');
  projected.keyEntries.g_work.models[0].reasoningEfforts.high = 'test-only';
  projected.keyEntries.g_root.models[0].input.push('test-only');
  projected.keyEntries.g_root.models[0].reasoningEfforts.low = 'test-only';
  assert.deepEqual(sidecar, before);
  assert.equal(original.value.providers.sample.multiKey, undefined);
  form.dispose();
});
