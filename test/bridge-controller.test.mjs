import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeAlias, createBridgeProjection, sameBridgeValue, validateBridgeDraft } from '../src/bridge/profile.js';
import { createBridgeController } from '../src/bridge/controller.js';
import { createBridgeRouting } from '../src/bridge/routing.js';

const draft = { enabled: true, keyEntries: { first: { name: 'First', api: 'anthropic-messages', apiKeyEnv: 'FIRST_KEY', models: [{ id: 'claude/example', name: 'Example', contextWindow: 200000, maxTokens: 8192, input: ['text', 'image'], reasoningEfforts: false }] } } };
const original = { displayName: 'Original', api: 'anthropic-messages', baseURL: 'https://original.invalid', apiKeyEnv: 'ROOT_KEY', headers: { 'x-custom': 'root' }, compat: { rootOnly: true }, modelOverrides: { 'old-model': {} }, models: [{ id: 'old-model', name: 'Old' }] };
const clone = value => structuredClone(value);
function documentStore(providers = {}) {
  let value = { revision: 1, providers: clone(providers) };
  return {
    read: async () => clone(value),
    async writeProvider(route, profile, expected) {
      assert.equal(expected, value.revision, 'write must protect the whole namespace revision');
      value.revision++;
      if (profile === undefined) delete value.providers[route]; else value.providers[route] = clone(profile);
      return clone(value);
    },
  };
}
function fixture() {
  const storage = documentStore();
  const native = documentStore({ original: clone(original), unrelated: { displayName: 'Keep' } });
  const controller = createBridgeController({ storage, native, prepare: async () => ({ guardCredential: 'BRIDGE_LOCAL_GUARD' }) });
  return { controller, storage, native };
}

test('ordinary profile projection preserves public identities and capability fields without multikey schema fields', () => {
  const value = createBridgeProjection(original, draft, { guardCredential: 'GUARD' });
  assert.deepEqual(value.models[0], original.models[0]);
  assert.deepEqual(value.models[1], { ...draft.keyEntries.first.models[0], id: '@dsh-key/first/claude%2Fexample' });
  assert.equal(value.apiKeyEnv, 'GUARD');
  assert.equal(value.api, 'openai-completions');
  assert.match(value.baseURL, /^http:\/\/127\.0\.0\.1:/);
  assert.deepEqual(value.headers, {});
  assert.equal(value.compat, undefined);
  assert.equal(value.modelOverrides, undefined);
  assert.equal(value.multiKey, undefined);
  assert.equal(value.keyEntries, undefined);
  assert.equal(original.apiKeyEnv, 'ROOT_KEY');
  assert.equal(bridgeAlias('first', 'claude/example'), value.models[1].id);
});

test('draft validation rejects ambiguous identities, raw secrets and invalid endpoints', () => {
  for (const keyEntries of [
    { first: { headers: { Authorization: 'must-not-store' }, models: [] } },
    { first: { models: [{ id: 'x', apiKey: 'must-not-store' }] } },
    { first: { models: [{ id: 'x', headers: { 'x-api-key': 'must-not-store' } }] } },
    { first: { models: [{ id: 'x' }, { id: 'x' }] } },
    { first: { apiKey: 'must-not-store', models: [] } },
    { first: { baseURL: 'https://user:secret@example.invalid', models: [] } },
    { first: { api: 'unknown', models: [] } },
    { first: { models: [{ id: '@dsh-key/nested/x' }] } },
    JSON.parse('{"__proto__":{"models":[]}}'),
  ]) assert.throws(() => validateBridgeDraft({ enabled: true, keyEntries }));
  assert.equal(sameBridgeValue({ a: 1, b: [2] }, { b: [2], a: 1 }), true);
  assert.equal(createBridgeProjection({ ...original, multiKey: true }, draft, { guardCredential: 'GUARD' }).multiKey, undefined);
});

test('enable journals before native changes and disable restores exact original with unrelated providers intact', async () => {
  const { controller, storage, native } = fixture();
  const write = native.writeProvider;
  native.writeProvider = async (...args) => {
    assert.ok((await storage.read()).providers.original.pending, 'journal must precede native write');
    return write(...args);
  };
  await controller.save('original', draft, 1);
  const snapshot = await controller.snapshot();
  assert.equal(snapshot.providers.original.confirmed, true);
  assert.equal(snapshot.providers.original.original, undefined);
  assert.equal(snapshot.providers.original.singleKey.apiKeyEnv, 'ROOT_KEY', 'credential references are editable metadata, never secret values');
  assert.equal(JSON.stringify(snapshot).includes('BRIDGE_LOCAL_GUARD'), false);
  assert.equal((await controller.executionSnapshot('original')).original.profile.apiKeyEnv, 'ROOT_KEY');
  await controller.save('original', { ...draft, enabled: false }, snapshot.revision);
  assert.deepEqual((await native.read()).providers, { original, unrelated: { displayName: 'Keep' } });
  assert.equal(await controller.executionSnapshot('original'), undefined);
});

test('concurrent native profile edits stop management without overwriting the new profile', async () => {
  const { controller, storage, native } = fixture();
  await controller.save('original', draft, 1);
  const current = await native.read();
  const edited = { ...current.providers.original, baseURL: 'https://user-edited.invalid' };
  await native.writeProvider('original', edited, current.revision);
  await assert.rejects(controller.save('original', draft, (await storage.read()).revision), /NATIVE_CONFIG_CONFLICT/);
  await assert.rejects(controller.executionSnapshot('original'), /NATIVE_CONFIG_CONFLICT/);
  assert.deepEqual((await native.read()).providers.original, edited);
  assert.equal((await controller.snapshot()).providers.original.confirmed, false);
  assert.equal((await controller.snapshot()).providers.original.conflict, true);
  await controller.save('original', { ...draft, enabled: false }, (await storage.read()).revision);
  assert.deepEqual((await native.read()).providers.original, edited, 'explicit close preserves an external edit');
  assert.equal(await controller.executionSnapshot('original'), undefined);
});

test('a failed native write restores previous plugin record and leaves native config unchanged', async () => {
  const { controller, storage, native } = fixture();
  native.writeProvider = async () => { throw new Error('write refused'); };
  await assert.rejects(controller.save('original', draft, 1), /write refused/);
  assert.equal((await storage.read()).providers.original, undefined);
  assert.deepEqual((await native.read()).providers.original, original);
});

test('commit failure leaves recoverable journal; recovery verifies native state before committing', async () => {
  const { controller, storage, native } = fixture();
  const write = storage.writeProvider;
  let count = 0;
  storage.writeProvider = async (...args) => {
    if (++count >= 2) throw new Error('durable commit unavailable');
    return write(...args);
  };
  await assert.rejects(controller.save('original', draft, 1), /durable commit unavailable/);
  assert.ok((await storage.read()).providers.original.pending);
  assert.equal((await controller.executionSnapshot('original')).enabled, true);
  storage.writeProvider = write;
  await controller.recover();
  assert.equal((await storage.read()).providers.original.pending, undefined);
  assert.equal((await controller.snapshot()).providers.original.confirmed, true);
  assert.equal((await native.read()).providers.original.models[1].id, '@dsh-key/first/claude%2Fexample');
});

test('schema validation and revision conflicts occur before any native write', async () => {
  const { controller, storage, native } = fixture();
  const before = await native.read();
  await assert.rejects(controller.save('original', draft, 0), /SETTINGS_CONFLICT/);
  await assert.rejects(controller.save('original', { enabled: true, keyEntries: {} }, 1), /EMPTY_KEY_ENTRIES/);
  assert.deepEqual(await native.read(), before);
  assert.deepEqual((await storage.read()).providers, {});
});

test('legacy projection uses guard-only entry metadata and preserves wire model IDs', () => {
  const prior = { ...original, multiKey: true, keyEntries: draft.keyEntries };
  const projected = createBridgeProjection(prior, draft, { guardCredential: 'LOCAL_GUARD', projectionMode: 'legacy' });
  assert.equal(projected.multiKey, true);
  assert.deepEqual(projected.models, original.models);
  assert.equal(projected.keyEntries.first.apiKeyEnv, 'LOCAL_GUARD');
  assert.equal(projected.keyEntries.first.api, 'openai-completions');
  assert.equal(projected.keyEntries.first.baseURL, undefined);
  assert.equal(projected.keyEntries.first.models[0].id, 'claude/example');
  assert.equal(JSON.stringify(projected).includes('FIRST_KEY'), false);
  assert.equal(prior.keyEntries.first.apiKeyEnv, 'FIRST_KEY');
});

test('fresh startup is read-only and legacy import preserves identities and exact restoration', async () => {
  const { controller, storage, native } = fixture();
  const before = await native.read();
  assert.deepEqual(await controller.synchronize(), { ok: true, failures: [] });
  assert.equal((await storage.read()).revision, 1);
  assert.deepEqual(await native.read(), before);
  const legacy = { ...original, multiKey: true, keyEntries: draft.keyEntries };
  await native.writeProvider('original', legacy, before.revision);
  const preview = await controller.snapshot();
  assert.equal(preview.providers.original.migration, true);
  assert.deepEqual(preview.providers.original.keyEntries, draft.keyEntries);
  assert.deepEqual(await controller.synchronize(), { ok: true, failures: [] });
  assert.equal((await controller.executionSnapshot('original')).original.profile.multiKey, true);
  assert.deepEqual((await controller.snapshot()).providers.original.keyEntries, draft.keyEntries);
  await controller.save('original', { ...draft, enabled: false }, (await storage.read()).revision);
  assert.deepEqual((await native.read()).providers.original, { ...legacy, multiKey: false });
});

test('startup readmission changes projection mode without altering credentials or touching native edits', async () => {
  const storage = documentStore();
  const native = documentStore({ original });
  let projectionMode = 'ordinary';
  const controller = createBridgeController({ storage, native, prepare: async () => ({ guardCredential: 'GUARD', projectionMode }) });
  await controller.save('original', draft, 1);
  const stable = await storage.read();
  await controller.synchronize();
  assert.equal((await storage.read()).revision, stable.revision, 'unchanged startup must not rewrite config');
  projectionMode = 'legacy';
  assert.deepEqual(await controller.synchronize(), { ok: true, failures: [] });
  assert.equal((await native.read()).providers.original.multiKey, true);
  assert.deepEqual((await storage.read()).providers.original.keyEntries, draft.keyEntries);
  projectionMode = 'ordinary';
  await controller.synchronize();
  assert.equal((await native.read()).providers.original.multiKey, undefined);
  const current = await native.read();
  const edited = { ...current.providers.original, displayName: 'User edit' };
  await native.writeProvider('original', edited, current.revision);
  const result = await controller.synchronize();
  assert.deepEqual(result, { ok: false, failures: ['original'] });
  assert.deepEqual((await native.read()).providers.original, edited);
});

test('legacy capability defaults become explicit metadata before admission and remain individually editable', () => {
  const source = { enabled: true, keyEntries: { first: { apiKeyEnv: 'FIRST_KEY', capabilityDefaults: { vision: true, reasoning: true }, models: [{ id: 'x' }] } } };
  const validated = validateBridgeDraft(source);
  assert.deepEqual(validated.keyEntries.first.models[0].input, ['text', 'image']);
  assert.deepEqual(validated.keyEntries.first.models[0].reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high' });
  assert.deepEqual(source.keyEntries.first.models, [{ id: 'x' }], 'migration must not mutate the original profile');
  validated.keyEntries.first.models[0].input = ['text'];
  assert.deepEqual(validateBridgeDraft(validated).keyEntries.first.models[0].input, ['text']);
});

test('unactivated legacy previews and disabled saves cannot expose raw authentication fields', async () => {
  const secret = 'synthetic-private-header-value';
  const profile = { ...clone(original), multiKey: false, keyEntries: { first: {
    models: [{ id: 'x', apiKey: secret, headers: { 'x-api-key': secret, 'x-feature': 'keep' } }],
    headers: { Authorization: secret, 'x-feature': 'keep' },
  } } };
  const storage = documentStore();
  const native = documentStore({ original: profile });
  const controller = createBridgeController({ storage, native });
  const snapshot = await controller.snapshot();
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.deepEqual(snapshot.providers.original.keyEntries.first.headers, { 'x-feature': 'keep' });
  assert.deepEqual(snapshot.providers.original.keyEntries.first.models[0], { id: 'x', headers: { 'x-feature': 'keep' } });
  assert.deepEqual((await native.read()).providers.original, profile, 'redaction is a public projection, not a native write');
  await assert.rejects(controller.save('original', { enabled: false, keyEntries: profile.keyEntries }, 1), /USE_CREDENTIAL_REFERENCE/);
  assert.equal((await storage.read()).revision, 1);
});

test('production aliases bind configuration and capabilities and include a versioned original-root choice', () => {
  const models = { legacy: original.models, keyEntries: { first: draft.keyEntries.first.models } };
  const routing = createBridgeRouting('original', draft, original, models);
  const entryToken = Object.keys(routing).find(token => routing[token] === 'first');
  const rootToken = Object.keys(routing).find(token => routing[token] === null);
  assert.match(entryToken, /^g_[a-f0-9]{64}$/);
  assert.ok(rootToken && rootToken !== entryToken);
  assert.deepEqual(createBridgeRouting('original', clone(draft), clone(original), clone(models)), routing);
  const renamed = clone(draft); renamed.keyEntries.first.name = 'Renamed'; renamed.keyEntries.first.models[0].name = 'New label';
  const relabeled = clone(models); relabeled.keyEntries.first[0].name = 'New label';
  assert.deepEqual(createBridgeRouting('original', renamed, original, relabeled), routing, 'presentation labels do not invalidate prepared selections');
  const changed = clone(draft); changed.keyEntries.first.apiKeyEnv = 'ANOTHER_KEY';
  assert.equal(Object.hasOwn(createBridgeRouting('original', changed, original, models), entryToken), false);
  const capabilities = clone(models); capabilities.keyEntries.first[0].maxTokens = 1024;
  assert.equal(Object.hasOwn(createBridgeRouting('original', draft, original, capabilities), entryToken), false);
  for (const projectionMode of ['ordinary', 'legacy']) {
    const profile = createBridgeProjection(original, draft, { guardCredential: 'GUARD', models, routing, projectionMode });
    if (projectionMode === 'ordinary') {
      assert.deepEqual(profile.models.map(model => model.id), [bridgeAlias(entryToken, 'claude/example'), bridgeAlias(rootToken, 'old-model')]);
    } else {
      assert.deepEqual(profile.models, []);
      assert.deepEqual(Object.keys(profile.keyEntries), [entryToken, rootToken]);
      assert.equal(profile.keyEntries[rootToken].models[0].id, 'old-model');
    }
    assert.equal(JSON.stringify(profile).includes('FIRST_KEY'), false);
    assert.equal(JSON.stringify(profile).includes('ROOT_KEY'), false);
  }
});
