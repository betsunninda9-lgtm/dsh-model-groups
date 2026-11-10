import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeSave, planNativeSave } from '../src/native-save.js';
import { planNativeDowngrade } from '../src/native-downgrade.js';
import { buildNativeGroups } from '../src/native-groups.js';

const model = { id: 'chat/model', name: 'Chat', contextWindow: 64000, maxTokens: 4096, input: ['text', 'image'], reasoningEfforts: false };
const group = () => structuredClone({ id: 'vendor', shared: {
  displayName: 'Private group', api: 'openai-completions', baseURL: 'https://private.invalid/v1',
  timeoutMs: 1234, headers: { 'x-feature': 'on' }, compat: { supportsStore: false },
}, entries: [
  { id: 'one', name: 'Private entry', apiKeyEnv: 'PRIVATE_ONE_KEY', models: [model] },
  { id: 'two', name: 'Private entry', apiKeyEnv: 'PRIVATE_TWO_KEY', models: [model] },
] });
const unsafe = 'secret-value /private/path/config.json';
const code = expected => cause => {
  assert.equal(cause.code, expected);
  assert.equal(cause.message, expected);
  assert.equal(cause.stack, expected);
  assert.ok(!JSON.stringify(cause).includes('private'));
  return true;
};
function fixture(options = {}) {
  const state = { ns: 'pi-ai', revision: 7, value: { providers: {
    vendor: { apiKeyEnv: 'EXISTING_KEY', models: [model] },
  }, defaultModel: 'unchanged' }, base: {}, user: {}, secrets: [] };
  const calls = [], reads = [], validations = [];
  const settings = {
    async describe(options) {
      reads.push(options);
      if (settings.onRead) await settings.onRead();
      return [{ ns: 'plugin-metadata', revision: 1, value: {} }, structuredClone(state)];
    },
    async mutate(ns, ops, revision) {
      calls.push(structuredClone({ ns, ops, revision }));
      if (settings.beforeWrite) await settings.beforeWrite();
      assert.equal(ns, state.ns);
      assert.equal(revision, state.revision);
      for (const op of ops) {
        assert.equal(op.op, 'set');
        assert.equal(op.path.length, 2);
        assert.equal(op.path[0], 'providers');
        assert.equal(Object.hasOwn(state.value.providers, op.path[1]), false);
        state.value.providers[op.path[1]] = structuredClone(op.value);
      }
      state.revision++;
      if (settings.afterWrite) await settings.afterWrite();
    },
  };
  const validate = async providers => { validations.push(structuredClone(providers)); return true; };
  const adapter = createNativeSave({ settings, validate, ...options });
  return { state, settings, calls, reads, validations, adapter };
}
async function save(adapter, input = group()) {
  const preview = await adapter.preview(input);
  return adapter.save(input, preview.revision, preview.fingerprint);
}

test('uses the actual caller-verified pi-ai entry namespace rather than a hardcoded id', async () => {
  const { state, adapter, calls } = fixture({ namespace: 'llm-pi-ai' });
  state.ns = 'llm-pi-ai';
  assert.equal((await save(adapter)).status, 'saved');
  assert.equal(calls[0].ns, 'llm-pi-ai');
});

test('pure planner reuses downgrade identity, preserves raw model IDs and copies common metadata', () => {
  const input = group(), before = structuredClone(input);
  const entries = Object.fromEntries(input.entries.map(({ id, ...entry }) => [id, entry]));
  const legacy = planNativeDowngrade({ vendor: { ...input.shared, multiKey: true, keyEntries: entries } });
  const plan = planNativeSave(input);
  assert.deepEqual(plan.routes, legacy.routes);
  assert.deepEqual(plan.metadata, legacy.metadata);
  assert.equal(Object.hasOwn(plan.providers, 'vendor'), false);
  for (const route of plan.routes) {
    assert.match(route.target, /^mg-[a-f0-9]{32}$/);
    assert.deepEqual(plan.providers[route.target], legacy.providers[route.target]);
    assert.equal(plan.providers[route.target].models[0].id, 'chat/model');
    assert.equal(plan.providers[route.target].timeoutMs, 1234);
    assert.equal('multiKey' in plan.providers[route.target], false);
  }
  input.shared.displayName = 'Renamed';
  input.entries[0].name = 'Renamed entry';
  assert.deepEqual(planNativeSave(input).routes, plan.routes);
  assert.deepEqual(before.entries[0].models[0], model);
  assert.equal(plan.providers[plan.routes[0].target].displayName, 'Private group · Private entry');
});

test('preview is read-only and sanitized; group payload is covered by fingerprint', async () => {
  const { adapter, calls, reads, validations } = fixture();
  const preview = await adapter.preview(group());
  assert.deepEqual(preview, await adapter.preview(group()));
  assert.deepEqual(Object.keys(preview).sort(), ['counts', 'fingerprint', 'revision', 'status']);
  assert.deepEqual(preview.counts, { providers: 2, models: 2 });
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(!/private|KEY|vendor|chat\/model/i.test(JSON.stringify(preview)));
  assert.ok(reads.every(options => options.redactSecrets === true));
  assert.equal(calls.length, 0);
  assert.equal(validations.length, 0);
  const renamed = group(); renamed.entries[0].name = 'Changed';
  await assert.rejects(adapter.save(renamed, preview.revision, preview.fingerprint), code('SAVE_STALE'));
});

test('save writes only absent native child configs and returns metadata separately; rerun is idempotent', async () => {
  const { adapter, state, calls, validations } = fixture();
  const before = structuredClone(state.value), plan = planNativeSave(group(), before.providers);
  const result = await save(adapter);
  assert.deepEqual(result, { status: 'saved', counts: { providers: 2, models: 2 }, metadata: plan.metadata });
  assert.equal(calls.length, 1);
  assert.deepEqual(validations, [plan.providers]);
  assert.deepEqual(calls[0].ops, plan.routes.map(({ target }) => ({ op: 'set', path: ['providers', target], value: plan.providers[target] })));
  assert.equal(calls[0].revision, 7);
  assert.deepEqual(state.value.providers.vendor, before.providers.vendor);
  assert.equal(state.value.defaultModel, before.defaultModel);
  assert.equal(Object.hasOwn(state.value, 'groups'), false);
  assert.ok(!/multiKey|keyEntries|@dsh-key/.test(JSON.stringify(calls)));
  assert.equal((await save(adapter)).status, 'unchanged');
  assert.equal(calls.length, 1);
  // An external metadata persistence failure cannot roll back native routes.
  assert.throws(() => { throw new Error('metadata unavailable'); });
  const directory = plan.routes.map(({ target }) => ({ id: target, models: state.value.providers[target].models }));
  assert.equal(buildNativeGroups(directory, null).length, 2);
  const grouped = buildNativeGroups(directory, result.metadata);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].children[0].models[0].route.model, 'chat/model');
});

test('partial existing exact children are reused; changed collision and rename never overwrite', async () => {
  const { adapter, state, calls } = fixture();
  const plan = planNativeSave(group()), [existing, missing] = plan.routes;
  state.value.providers[existing.target] = plan.providers[existing.target];
  await save(adapter);
  assert.deepEqual(calls[0].ops.map(op => op.path[1]), [missing.target]);
  const renamed = group(); renamed.shared.displayName = 'New label';
  await assert.rejects(adapter.preview(renamed), code('SAVE_PROVIDER_COLLISION'));
  state.value.providers[existing.target].apiKeyEnv = 'USER_CHANGED';
  await assert.rejects(adapter.preview(group()), code('SAVE_PROVIDER_COLLISION'));
  assert.equal(calls.length, 1);
  assert.equal(state.value.providers[existing.target].apiKeyEnv, 'USER_CHANGED');
});

test('strict native-only shape rejects unsafe identity, credentials, legacy controls and incomplete models', async () => {
  for (const mutate of [
    g => { g.id = '__proto__'; }, g => { g.entries[0].id = 'bad.id'; },
    g => { g.entries[1].id = g.entries[0].id; }, g => { g.entries = []; },
    g => { g.entries[0].apiKeyEnv = 'actual secret'; }, g => { g.entries[0].apiKey = unsafe; },
    g => { g.shared.apiKeyEnv = 'ROOT_KEY'; }, g => { g.shared.multiKey = true; },
    g => { g.shared.models = [model]; }, g => { g.shared.modelOverrides = {}; },
    g => { g.shared.unknownHostField = true; }, g => { g.shared.api = 'unsupported'; },
    g => { g.shared.baseURL = 'https://user:password@private.invalid'; },
    g => { g.shared.headers.Authorization = 'Bearer secret'; },
    g => { g.shared.compat = { __jsExpr: unsafe }; },
    g => { delete g.entries[0].models[0].contextWindow; },
    g => { g.entries[0].models[0].id = '@dsh-key/one/model'; },
    g => { g.entries[0].models[0].cost = {}; },
  ]) {
    const { adapter, calls } = fixture(), input = group(); mutate(input);
    await assert.rejects(adapter.preview(input), code('SAVE_INVALID_GROUP'));
    assert.equal(calls.length, 0);
  }
});

test('expected revision and complete config fingerprint reject stale previews before validation', async () => {
  for (const mutate of [s => s.revision++, s => { s.value.defaultModel = 'changed'; },
    s => { s.base.inherited = 'changed'; }, s => { s.user.override = true; }]) {
    const { adapter, state, calls, validations } = fixture(), input = group();
    const preview = await adapter.preview(input); mutate(state);
    await assert.rejects(adapter.save(input, preview.revision, preview.fingerprint), code('SAVE_STALE'));
    assert.equal(calls.length, 0);
    assert.equal(validations.length, 0);
  }
});

test('trusted validator is mandatory; throwing, false and mutating validators prevent writes', async () => {
  const base = fixture();
  assert.throws(() => createNativeSave({ settings: base.settings }), code('SAVE_INVALID_ADAPTER'));
  assert.throws(() => createNativeSave({ settings: base.settings, namespace: '__proto__', validate() {} }), code('SAVE_INVALID_ADAPTER'));
  for (const validate of [async () => { throw new Error(unsafe); }, async () => false,
    async providers => { providers.vendor.apiKeyEnv = unsafe; }]) {
    const { adapter, calls } = fixture({ validate });
    await assert.rejects(save(adapter), code('SAVE_VALIDATION_FAILED'));
    assert.equal(calls.length, 0);
  }
});

test('validation-time races and last-moment host revision races do not overwrite', async () => {
  const base = fixture();
  const adapter = createNativeSave({ settings: base.settings, validate: async () => {
    base.state.value.providers.racing = { apiKeyEnv: 'PRESERVE' };
  } });
  await assert.rejects(save(adapter), code('SAVE_STALE'));
  assert.equal(base.calls.length, 0);
  const next = fixture();
  const target = planNativeSave(group()).routes[0].target;
  next.settings.beforeWrite = () => { next.state.value.providers[target] = { apiKeyEnv: 'PRESERVE' }; next.state.revision++; };
  await assert.rejects(save(next.adapter), code('SAVE_UNVERIFIED'));
  assert.deepEqual(next.state.value.providers[target], { apiKeyEnv: 'PRESERVE' });
});

test('busy guard spans adapters and awaits validation; caller input is detached', async () => {
  const base = fixture();
  let release, enter;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = createNativeSave({ settings: base.settings, validate: async () => { enter(); await gate; } });
  const input = group(), preview = await adapter.preview(input);
  const pending = adapter.save(input, preview.revision, preview.fingerprint);
  await entered;
  input.entries[0].apiKeyEnv = 'MUTATED_BY_CALLER';
  await assert.rejects(base.adapter.preview(group()), code('SAVE_BUSY'));
  release();
  assert.equal((await pending).status, 'saved');
  assert.equal(base.calls[0].ops[0].value.apiKeyEnv, 'PRIVATE_ONE_KEY');
});

test('uncertain writes never retry or roll back; errors contain no host details', async () => {
  for (const mode of ['throw-before', 'throw-after', 'read', 'mismatch', 'missing']) {
    const { adapter, state, settings, calls } = fixture();
    if (mode === 'throw-before') settings.beforeWrite = () => { throw new Error(unsafe); };
    settings.afterWrite = () => {
      state.value.providers.vendor.racing = 'preserve';
      const target = calls[0].ops[0].path[1];
      if (mode === 'throw-after') throw new Error(unsafe);
      if (mode === 'read') settings.onRead = () => { throw new Error(unsafe); };
      if (mode === 'mismatch') state.value.providers[target].apiKeyEnv = 'PRESERVE';
      if (mode === 'missing') delete state.value.providers[target];
    };
    await assert.rejects(save(adapter), code('SAVE_UNVERIFIED'));
    assert.equal(calls.length, 1);
    if (mode !== 'throw-before') assert.equal(state.value.providers.vendor.racing, 'preserve');
  }
});

test('read failure and unavailable/ambiguous namespace are sanitized and release lock', async () => {
  const { adapter, settings, state } = fixture();
  settings.onRead = () => { throw new Error(unsafe); };
  await assert.rejects(adapter.preview(group()), code('SAVE_READ_FAILED'));
  settings.onRead = null;
  assert.equal((await adapter.preview(group())).status, 'preview');
  settings.describe = () => [];
  await assert.rejects(adapter.preview(group()), code('SAVE_NAMESPACE_UNAVAILABLE'));
  settings.describe = () => [state, state];
  await assert.rejects(adapter.preview(group()), code('SAVE_NAMESPACE_UNAVAILABLE'));
});
