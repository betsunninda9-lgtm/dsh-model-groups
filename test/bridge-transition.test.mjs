import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeController } from '../src/bridge/controller.js';
import { startBridgeWhenSettingsReady } from '../src/bridge/startup.js';
import { applyBridgeShared, publicBridgeShared, validateBridgeShared } from '../src/bridge/shared.js';
const clone = value => structuredClone(value);
function store(providers = {}) { let state = { revision: 0, providers: clone(providers) }; return {
  read: async () => clone(state), async writeProvider(route, record, revision) { assert.equal(revision, state.revision); state.revision++; state.providers[route] = clone(record); return clone(state); },
}; }
const entry = { name: 'Old', apiKeyEnv: 'WORK_KEY', models: [{ id: 'wire', input: ['text', 'image'], contextWindow: 12000 }] };
const legacy = { api: 'openai-completions', baseURL: 'https://old.invalid/v1', apiKeyEnv: 'ROOT_KEY', headers: { 'X-Owner': 'keep' }, models: [], multiKey: true, keyEntries: { old: entry } };
const draft = { enabled: true, keyEntries: { old: entry } };

test('shared defaults are visible, editable and journaled without exposing or losing original credentials', async () => {
  const storage = store(), native = store({ route: legacy }); const prepared = [];
  const controller = createBridgeController({ storage, native, prepare: async (_r, _d, original) => { prepared.push(clone(original)); return { guardCredential: 'LOCAL' }; } });
  assert.deepEqual((await controller.snapshot()).providers.route.shared, publicBridgeShared(legacy));
  await controller.save('route', draft, 0);
  const shared = { api: 'anthropic-messages', baseURL: 'https://new.invalid/anthropic', headers: { 'X-Owner': 'updated' } };
  await controller.save('route', { ...draft, shared }, (await storage.read()).revision);
  assert.equal(prepared.at(-1).apiKeyEnv, 'ROOT_KEY'); assert.equal(prepared.at(-1).baseURL, shared.baseURL);
  assert.deepEqual((await controller.snapshot()).providers.route.shared, { displayName: '', ...shared });
  assert.equal((await controller.snapshot()).providers.route.singleKey.apiKeyEnv, 'ROOT_KEY');
  assert.doesNotMatch(JSON.stringify(await controller.snapshot()), /LOCAL/);
  await controller.save('route', { ...draft, enabled: false }, (await storage.read()).revision);
  assert.deepEqual((await native.read()).providers.route, { ...legacy, ...shared, multiKey: false });
  assert.throws(() => validateBridgeShared({ apiKey: 'forbidden' }), { code: 'INVALID_SHARED_CONFIG' });
  assert.throws(() => validateBridgeShared({ headers: { Authorization: 'forbidden' } }), { code: 'USE_CREDENTIAL_REFERENCE' });
  assert.throws(() => validateBridgeShared({ baseURL: 'https://user:password@example.invalid' }), { code: 'INVALID_ENDPOINT' });
  assert.equal(applyBridgeShared(legacy, { api: null, baseURL: '' }).api, undefined);
});

test('a captured legacy handoff restores data omitted by the pristine native schema, preserving all key identities', async () => {
  const ordinary = clone(legacy); delete ordinary.multiKey; delete ordinary.keyEntries;
  const native = store({ route: ordinary }), storage = store();
  const controller = createBridgeController({ storage, native, prepare: async (_r, _d, original) => {
    assert.equal(original.apiKeyEnv, 'ROOT_KEY'); assert.equal(original.baseURL, legacy.baseURL); return { guardCredential: 'LOCAL' };
  } });
  assert.deepEqual(await controller.importLegacy({ route: legacy }), { imported: ['route'], conflicts: [] });
  assert.equal((await controller.snapshot()).providers.route.keyEntries.old.apiKeyEnv, entry.apiKeyEnv);
  assert.equal((await controller.synchronize()).ok, true);
  const saved = (await storage.read()).providers.route;
  assert.deepEqual(saved.original.profile, legacy); assert.equal(saved.active, true); assert.equal(saved.migrationOriginal, undefined);
  assert.deepEqual(await controller.importLegacy({ route: { ...legacy, baseURL: 'https://stale.invalid' } }), { imported: [], conflicts: [] });
  assert.deepEqual((await storage.read()).providers.route, saved, 'a repeated handoff never overwrites committed data');
});

test('a stale handoff refuses changed native defaults and a later edit stops activation', async () => {
  const ordinary = clone(legacy); delete ordinary.multiKey; delete ordinary.keyEntries;
  const native = store({ route: { ...ordinary, baseURL: 'https://edited.invalid' } }), storage = store();
  const controller = createBridgeController({ storage, native, prepare: async () => ({ guardCredential: 'LOCAL' }) });
  assert.deepEqual(await controller.importLegacy({ route: legacy }), { imported: [], conflicts: ['route'] });
  assert.deepEqual((await storage.read()).providers, {});
  await native.writeProvider('route', ordinary, (await native.read()).revision);
  await controller.importLegacy({ route: legacy });
  await native.writeProvider('route', { ...ordinary, api: 'anthropic-messages' }, (await native.read()).revision);
  assert.equal((await controller.synchronize()).ok, false);
  assert.equal((await native.read()).providers.route.api, 'anthropic-messages');
});

test('startup tolerates synchronous Settings notifications while probing readiness', async () => {
  const hooks = new Map(); let count = 0, reads = 0;
  const ctx = { settings: { describe() { if (++reads < 4) hooks.get('settings/document-updated')?.(); return [{ ns: 'model-groups' }]; } },
    on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); }, effect(fn) { fn(); } };
  const startup = startBridgeWhenSettingsReady(ctx, 'model-groups', async () => { count++; });
  await startup.attempt(); assert.equal(count, 1); assert.equal(reads, 1);
});

test('startup waits until the real Settings form becomes active and initializes only once', async () => {
  let visible = false, starts = 0; const hooks = new Map(), cleanup = [];
  const ctx = { settings: { describe: () => visible ? [{ ns: 'model-groups' }] : [] },
    on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); }, effect(fn) { cleanup.push(fn()); } };
  const startup = startBridgeWhenSettingsReady(ctx, 'model-groups', async () => { starts++; });
  await Promise.resolve(); assert.equal(starts, 0);
  visible = true; await hooks.get('internal/status')(); assert.equal(starts, 1); assert.equal(startup.complete, true);
  await hooks.get('settings/document-updated')(); assert.equal(starts, 1);
  cleanup.forEach(fn => fn()); assert.equal(hooks.size, 0);
});
