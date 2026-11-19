import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeController } from '../src/bridge/controller.js';
import { createBridgeRouting } from '../src/bridge/routing.js';
import { publicBridgeSingleKey, validateBridgeSingleKey, applyBridgeSingleKey } from '../src/bridge/single-key.js';
import { sameEditorValue, bridgeEditorDraft, bridgeEditorChanged } from '../src/bridge/editor-state.js';
import { mountLegacyCard as mount, cardSnapshot } from './helpers/bridge-card-harness.mjs';
const clone = value => structuredClone(value);
function memory(providers = {}) {
  let state = { revision: 0, providers: clone(providers) }; const writes = [];
  return { writes, read: async () => clone(state), async writeProvider(route, value, revision) {
    assert.equal(revision, state.revision); writes.push({ route, value: clone(value) });
    state = { revision: state.revision + 1, providers: { ...state.providers, [route]: clone(value) } }; return clone(state);
  } };
}
const original = { displayName: '原供应商', api: 'openai-completions', baseURL: 'https://shared.example/v1', apiKeyEnv: 'ORIGINAL_ROOT_KEY',
  headers: { 'X-Tenant': 'retained' }, compat: { keepHostOption: true },
  models: [{ id: 'root-model', name: 'Root', input: ['text'], contextWindow: 12000, maxTokens: 2048, compat: { keepModelOption: true } }] };
const entries = { work: { name: '工作', apiKeyEnv: 'WORK_KEY', api: 'anthropic-messages', baseURL: 'https://key.example/anthropic', models: [{ id: 'work-model', input: ['text', 'image'] }] } };
function transaction() {
  const storage = memory(), native = memory({ supplier: original, untouched: { displayName: '保留' } });
  const controller = createBridgeController({ storage, native, prepare: async (provider, draft, root) => {
    const models = { legacy: clone(root.models ?? []), keyEntries: Object.fromEntries(Object.entries(draft.keyEntries).map(([id, entry]) => [id, clone(entry.models)])) };
    return { guardCredential: 'LOCAL_GUARD', models, routing: createBridgeRouting(provider, draft, root, models) };
  } });
  return { controller, native, storage };
}

test('name-only edits preserve root secrets, key overrides, route IDs and admitted model IDs', async () => {
  const { controller, native, storage } = transaction();
  await controller.save('supplier', { enabled: true, keyEntries: entries }, 0);
  const before = (await native.read()).providers.supplier;
  const snap = await controller.snapshot();
  assert.equal(snap.providers.supplier.shared.displayName, original.displayName);
  assert.doesNotMatch(JSON.stringify(snap), /fixture-secret|LOCAL_GUARD/);
  await controller.save('supplier', { enabled: true, keyEntries: entries, shared: { displayName: '新供应商' }, expectedNativeRevision: snap.nativeRevision }, snap.revision);
  const active = (await storage.read()).providers.supplier;
  assert.deepEqual(active.original.profile.headers, original.headers);
  assert.equal(active.original.profile.apiKeyEnv, original.apiKeyEnv);
  assert.deepEqual(active.keyEntries, entries);
  const after = (await native.read()).providers.supplier;
  assert.equal(after.displayName, '新供应商'); assert.deepEqual(after.models, before.models, 'renaming does not change routed identities');
  await controller.save('supplier', { enabled: false, keyEntries: entries }, (await storage.read()).revision);
  assert.deepEqual((await native.read()).providers, { supplier: { ...original, displayName: '新供应商' }, untouched: { displayName: '保留' } });
});

test('root model and credential edits compose with shared edits in a single journaled transaction', async () => {
  const { controller, native, storage } = transaction();
  const models = [{ id: 'root-model', input: ['text', 'image'], contextWindow: 32000, reasoningEfforts: false }];
  await controller.save('supplier', { enabled: false, keyEntries: entries, shared: { displayName: '单密钥新名称' }, singleKey: { apiKeyEnv: 'NEW_ROOT_KEY', models }, expectedNativeRevision: 0 }, 0);
  const saved = (await native.read()).providers.supplier;
  assert.equal(saved.displayName, '单密钥新名称'); assert.equal(saved.apiKeyEnv, 'NEW_ROOT_KEY');
  assert.deepEqual(saved.headers, original.headers); assert.deepEqual(saved.compat, original.compat);
  assert.equal(saved.models[0].name, undefined); assert.equal(saved.models[0].maxTokens, undefined);
  assert.deepEqual(saved.models[0].compat, original.models[0].compat);
  assert.equal(saved.models[0].contextWindow, 32000); assert.deepEqual(saved.models[0].input, ['text', 'image']);
  assert.equal(native.writes.length, 1); assert.equal(storage.writes.length, 2, 'journal then commit');
  const snap = await controller.snapshot();
  await controller.save('supplier', { enabled: true, keyEntries: entries }, snap.revision);
  const managed = (await storage.read()).providers.supplier;
  assert.equal(managed.original.profile.apiKeyEnv, 'NEW_ROOT_KEY'); assert.equal(managed.original.profile.models[0].contextWindow, 32000);
  await controller.save('supplier', { enabled: false, keyEntries: entries }, (await storage.read()).revision);
  assert.deepEqual((await native.read()).providers.supplier, saved);
});

test('a stale native revision refuses ordinary edits before either namespace is written', async () => {
  const { controller, native, storage } = transaction();
  const snap = await controller.snapshot();
  await native.writeProvider('supplier', { ...original, displayName: '外部新名称' }, 0);
  const writes = native.writes.length;
  await assert.rejects(controller.save('supplier', { enabled: false, keyEntries: {}, shared: { displayName: '旧草稿' }, expectedNativeRevision: snap.nativeRevision }, snap.revision), { code: 'NATIVE_CONFIG_CONFLICT' });
  assert.equal(storage.writes.length, 0); assert.equal(native.writes.length, writes);
  assert.equal((await native.read()).providers.supplier.displayName, '外部新名称');
});

test('root metadata is projected safely and rejects config secrets or unobserved model fields', () => {
  const visible = publicBridgeSingleKey(original);
  assert.equal(visible.apiKeyEnv, 'ORIGINAL_ROOT_KEY'); assert.equal(visible.models[0].compat, undefined);
  assert.doesNotMatch(JSON.stringify(visible), /fixture-secret/);
  assert.deepEqual(publicBridgeSingleKey({ apiKeyEnv: 'DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD' }), { apiKeyEnv: '', models: [] });
  for (const patch of [{ apiKey: 'not-permitted' }, { models: [{ id: 'x', headers: { Authorization: 'not-permitted' } }] }, { apiKeyEnv: 'BAD\nREF' }]) assert.throws(() => validateBridgeSingleKey(patch));
  const cleared = applyBridgeSingleKey(original, { apiKeyEnv: null, models: [] });
  assert.equal(cleared.apiKeyEnv, undefined); assert.deepEqual(cleared.models, []); assert.deepEqual(cleared.headers, original.headers);
});

test('semantic dirty checking ignores property order and treats a real edit-and-revert as clean', () => {
  const before = bridgeEditorDraft(cardSnapshot().providers.sample), same = clone(before);
  same.keyEntries.work = Object.fromEntries(Object.entries(same.keyEntries.work).reverse());
  same.shared.headersText = '{"B":"2","A":"1"}'; before.shared.headersText = '{"A":"1","B":"2"}';
  assert.equal(sameEditorValue({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(bridgeEditorChanged(same, before), false);
  same.shared.displayName = 'Different'; assert.equal(bridgeEditorChanged(same, before), true);
  same.shared.displayName = before.shared.displayName; assert.equal(bridgeEditorChanged(same, before), false);
});

test('name and JSON-header edits revert cleanly without retaining false unsaved markers', () => {
  const snapshot = cardSnapshot(); snapshot.providers.sample.shared = { displayName: '供应商原名', headers: { A: '1', B: '2' } };
  const app = mount({ snapshot }); assert.equal(app.button('保存').props.disabled, true);
  app.change('供应商名称', '新名'); assert.equal(app.button('保存').props.disabled, false);
  app.change('供应商名称', '供应商原名'); assert.equal(app.button('保存').props.disabled, true);
  app.change('共用请求头 JSON', '{"B":"2","A":"1"}'); assert.equal(app.button('保存').props.disabled, true);
  assert.doesNotMatch(app.text(), /未保存/); app.dispose();
});

test('a single-key editor has one Save, root models and credentials, and no inactive multikey card', async () => {
  const snapshot = cardSnapshot(); snapshot.nativeRevision = 3;
  snapshot.providers.sample = { enabled: false, shared: { displayName: '普通供应商', api: original.api, baseURL: original.baseURL }, singleKey: publicBridgeSingleKey(original), keyEntries: {} };
  let closed; const app = mount({ snapshot, onClose: changed => { closed = changed; } });
  assert.equal(app.nodes().filter(node => node.props?.['data-key-entry-id']).length, 0);
  assert.doesNotMatch(app.text(), /共用配置/); assert.ok(app.input('单密钥 API 密钥'));
  assert.equal(app.nodes().filter(node => node.type === 'button' && app.text(node) === '保存').length, 1);
  app.change('供应商名称', '新单密钥名称'); app.change('单密钥 API 密钥', 'synthetic-new-root-key');
  app.click('保存'); await app.settle();
  assert.deepEqual(app.calls.credentials, [{ reference: 'ORIGINAL_ROOT_KEY', value: 'synthetic-new-root-key' }]);
  assert.deepEqual(app.calls.save[0].draft.shared, { displayName: '新单密钥名称' });
  assert.deepEqual(app.calls.save[0].draft.singleKey, { apiKeyEnv: 'ORIGINAL_ROOT_KEY' });
  assert.equal(app.calls.save[0].draft.expectedNativeRevision, 3);
  assert.doesNotMatch(JSON.stringify(app.calls.save), /synthetic-new-root-key/); assert.equal(closed, true);
  app.dispose();
});

test('folding retains the full local draft while Cancel discards it and closes the parent editor', () => {
  const close = []; const app = mount({ onClose: changed => close.push(changed) });
  app.click('展开详情'); app.change('配置名称 1', '折叠前草稿'); app.change('供应商名称', '供应商草稿');
  app.setOpen(false); assert.equal(app.input('供应商名称').props.disabled, true);
  app.setOpen(true); assert.equal(app.input('供应商名称').props.value, '供应商草稿'); assert.equal(app.input('配置名称 1').props.value, '折叠前草稿');
  app.click('取消'); assert.deepEqual(close, [false]); assert.equal(app.input('供应商名称').props.value, '');
  assert.equal(app.button('保存').props.disabled, true); assert.equal(app.calls.save.length, 0); app.dispose();
});

test('a late save never closes an unrelated editor opened after the first editor was folded', async () => {
  let finish; const close = [];
  const app = mount({ onClose: changed => close.push(changed), save: () => new Promise(resolve => { finish = resolve; }) });
  app.change('供应商名称', '更名'); app.click('保存'); app.setOpen(false);
  finish({ ok: true }); await app.settle(); assert.deepEqual(close, []); app.dispose();
});

test('read-only prevents edits and writes but still permits cancelling the native editor', () => {
  let closed; const app = mount({ readOnly: true, onClose: changed => { closed = changed; } });
  assert.equal(app.input('供应商名称').props.disabled, true); assert.equal(app.button('保存').props.disabled, true);
  assert.notEqual(app.button('取消').props.disabled, true); app.click('取消'); assert.equal(closed, false);
  assert.equal(app.calls.save.length, 0); assert.equal(app.calls.credentials.length, 0); app.dispose();
});


test('an ordinary rename never deletes hidden native authentication headers or secret values', async () => {
  const root = { ...clone(original), headers: { Authorization: 'fixture-secret-not-for-public-snapshot', 'X-Tenant': 'retained' } };
  const native = memory({ supplier: root }), storage = memory();
  const controller = createBridgeController({ native, storage, prepare: async () => { throw new Error('ordinary rename must not prepare a multikey runtime'); } });
  const snap = await controller.snapshot(); assert.doesNotMatch(JSON.stringify(snap), /fixture-secret-not-for-public-snapshot/);
  await controller.save('supplier', { enabled: false, keyEntries: {}, shared: { displayName: '只改名称' } }, snap.revision);
  assert.deepEqual((await native.read()).providers.supplier, { ...root, displayName: '只改名称' });
});


for (const scope of ['provider', 'public-settings']) test(`a discovery response arriving after folding ${scope} cannot reopen an old selection dialog`, async () => {
  let finish; const app = mount({ discover: () => new Promise(resolve => { finish = resolve; }) });
  const fold = expanded => {
    if (scope === 'provider') app.setOpen(expanded);
    else { app.nodes().find(node => node.props?.['data-bridge-public-settings']).props.onToggle({ currentTarget: { open: expanded } }); app.flush(); }
  };
  app.click('展开详情'); app.click('获取可用模型'); fold(false);
  finish({ ok: true, models: [{ id: 'late-result' }] }); await app.settle();
  fold(true); await app.settle();
  assert.equal(app.nodes().filter(node => node.props?.role === 'dialog').length, 0);
  assert.equal(app.calls.save.length, 0); assert.equal(app.calls.credentials.length, 0); app.dispose();
});
