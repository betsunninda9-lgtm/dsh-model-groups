import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeStage } from '../src/native-stage.js';
import { planNativeDowngrade } from '../src/native-downgrade.js';

const model = { id: 'chat/model', contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false };
const source = () => ({
  vendor: { displayName: 'Private vendor', api: 'openai-completions', baseURL: 'https://private.invalid/v1',
    apiKeyEnv: 'PRIVATE_ROOT_KEY', models: [model], multiKey: true,
    keyEntries: {
      one: { name: 'Private entry', apiKeyEnv: 'PRIVATE_ONE_KEY', models: [model] },
      two: { name: 'Private entry', apiKeyEnv: 'PRIVATE_TWO_KEY', models: [model] },
    } },
  native: { api: 'openai-responses', apiKeyEnv: 'EXISTING_KEY', models: [model] },
});
const unsafe = 'secret-value /private/path/config.json';
function fixture(options = {}) {
  const state = { ns: 'actual-host-instance', revision: 7,
    value: { providers: source(), defaultModel: '@dsh-key/one/chat%2Fmodel' },
    base: {}, user: {}, secrets: [] };
  const calls = [], reads = [], validations = [];
  const settings = {
    async describe(options) {
      reads.push(options);
      if (settings.onRead) await settings.onRead();
      return [{ ns: 'not-the-host', revision: 1, value: { providers: {} } }, structuredClone(state)];
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
  const validate = async providers => { validations.push(structuredClone(providers)); };
  const adapter = createNativeStage({ settings, namespace: state.ns, validate, ...options });
  return { state, settings, calls, reads, validations, adapter };
}
const code = expected => cause => {
  assert.equal(cause.code, expected);
  assert.equal(cause.message, expected);
  assert.equal(cause.stack, expected);
  assert.ok(!JSON.stringify(cause).includes('private'));
  return true;
};
const stage = async adapter => {
  const preview = await adapter.preview();
  return adapter.stage(preview.revision, preview.fingerprint);
};

test('preview is read-only, redacted, namespace-specific, stable, and contains no references/config', async () => {
  const { adapter, reads, calls, validations } = fixture();
  const preview = await adapter.preview();
  assert.deepEqual(preview, await adapter.preview());
  assert.deepEqual(Object.keys(preview).sort(), ['counts', 'fingerprint', 'planFingerprint', 'revision', 'status']);
  assert.match(preview.planFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.counts, { providers: 2, models: 2 });
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(preview.revision, 7);
  assert.ok(!/private|KEY|vendor|actual-host|chat\/model/i.test(JSON.stringify(preview)));
  assert.ok(reads.every(options => options.redactSecrets === true));
  assert.equal(calls.length, 0);
  assert.equal(validations.length, 0);
});

test('stages only child set ops once; preserves native, source, keys, aliases and shared options', async () => {
  const { adapter, state, calls, validations } = fixture();
  const before = structuredClone(state.value), planned = planNativeDowngrade(before.providers);
  assert.deepEqual(await stage(adapter), { status: 'staged', counts: { providers: 2, models: 2 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ns, state.ns);
  assert.equal(calls[0].revision, 7);
  assert.deepEqual(validations, [planned.providers]);
  assert.deepEqual(state.value.providers.vendor, before.providers.vendor);
  assert.deepEqual(state.value.providers.native, before.providers.native);
  assert.equal(state.value.defaultModel, before.defaultModel);
  assert.deepEqual(calls[0].ops, planned.routes.map(({ target }) => ({
    op: 'set', path: ['providers', target], value: planned.providers[target],
  })));
  for (const { target } of planned.routes) assert.deepEqual(state.value.providers[target], planned.providers[target]);
  // Reruns reuse exact children without ever writing them again.
  const staged = structuredClone(state.value);
  assert.deepEqual(await stage(adapter), { status: 'unchanged', counts: { providers: 2, models: 2 } });
  assert.equal(calls.length, 1);
  assert.deepEqual(state.value, staged);
});

test('partial staging only adds absent children; differing existing children fail closed', async () => {
  const { adapter, state, calls } = fixture();
  const planned = planNativeDowngrade(state.value.providers);
  const [existing, missing] = planned.routes;
  state.value.providers[existing.target] = structuredClone(planned.providers[existing.target]);
  assert.equal((await stage(adapter)).status, 'staged');
  assert.deepEqual(calls[0].ops.map(op => op.path[1]), [missing.target]);
  state.value.providers[existing.target].apiKeyEnv = 'USER_CHANGED_KEY';
  await assert.rejects(adapter.preview(), code('DOWNGRADE_PROVIDER_COLLISION'));
  assert.equal(state.value.providers[existing.target].apiKeyEnv, 'USER_CHANGED_KEY');
  assert.equal(calls.length, 1);
});

test('existing exact children changed during validation are never overwritten', async () => {
  const base = fixture();
  const planned = planNativeDowngrade(base.state.value.providers);
  const target = planned.routes[0].target;
  base.state.value.providers[target] = structuredClone(planned.providers[target]);
  const adapter = createNativeStage({ settings: base.settings, namespace: base.state.ns,
    validate: async () => { base.state.value.providers[target].apiKeyEnv = 'RACING_KEY'; } });
  await assert.rejects(stage(adapter), code('STAGE_STALE'));
  assert.equal(base.calls.length, 0);
  assert.equal(base.state.value.providers[target].apiKeyEnv, 'RACING_KEY');
});

test('a race after freshness read is refused by host revision checking without overwriting', async () => {
  const { adapter, state, settings, calls } = fixture();
  const target = planNativeDowngrade(state.value.providers).routes[0].target;
  settings.beforeWrite = () => {
    state.value.providers[target] = { apiKeyEnv: 'RACING_KEY' };
    state.revision++;
  };
  await assert.rejects(stage(adapter), code('STAGE_UNVERIFIED'));
  assert.equal(calls.length, 1);
  assert.deepEqual(state.value.providers[target], { apiKeyEnv: 'RACING_KEY' });
});

test('revision and full-config fingerprint mismatches fail before validation or mutation', async () => {
  for (const change of [state => state.revision++, state => { state.value.defaultModel = 'changed'; },
    state => { state.base.inherited = 'changed'; }, state => { state.user.override = 'changed'; }]) {
    const { adapter, state, calls, validations } = fixture();
    const preview = await adapter.preview();
    change(state);
    await assert.rejects(adapter.stage(preview.revision, preview.fingerprint), code('STAGE_STALE'));
    assert.equal(calls.length, 0);
    assert.equal(validations.length, 0);
  }
});

test('mandatory validator is awaited; failures, false and mutation are sanitized and never written', async () => {
  assert.throws(() => createNativeStage({ settings: {}, namespace: 'x' }), code('STAGE_INVALID_ADAPTER'));
  const base = fixture();
  assert.throws(() => createNativeStage({ settings: base.settings, namespace: 'x' }), code('STAGE_INVALID_ADAPTER'));
  for (const validate of [async () => { throw new Error(unsafe); }, async () => false,
    async providers => { providers.native.apiKeyEnv = unsafe; }]) {
    const { adapter, calls } = fixture({ validate });
    await assert.rejects(stage(adapter), code('STAGE_VALIDATION_FAILED'));
    assert.equal(calls.length, 0);
  }
});

test('busy serialization covers preview, stage and adapters for the same settings namespace', async () => {
  const base = fixture();
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = createNativeStage({ settings: base.settings, namespace: base.state.ns,
    validate: async () => { entered(); await gate; } });
  const preview = await adapter.preview();
  const pending = adapter.stage(preview.revision, preview.fingerprint);
  await waiting;
  assert.equal(base.calls.length, 0);
  await assert.rejects(adapter.preview(), code('STAGE_BUSY'));
  await assert.rejects(base.adapter.stage(preview.revision, preview.fingerprint), code('STAGE_BUSY'));
  release();
  assert.equal((await pending).status, 'staged');
});

test('fresh read after async validation prevents concurrent edits and native collision writes', async () => {
  const base = fixture();
  const adapter = createNativeStage({ settings: base.settings, namespace: base.state.ns,
    validate: async providers => {
      const target = Object.keys(providers).find(id => id.startsWith('mg-'));
      base.state.value.providers[target] = { apiKeyEnv: 'RACING_NATIVE' };
    } });
  await assert.rejects(stage(adapter), code('STAGE_STALE'));
  assert.equal(base.calls.length, 0);
});

test('planner conservatism and collisions fail closed without mutation', async () => {
  for (const [change, expected] of [
    [state => { delete state.value.providers.vendor.api; }, 'DOWNGRADE_CATALOG_DEFAULTS_REQUIRED'],
    [state => { delete state.value.providers.vendor.keyEntries.one.models[0].maxTokens; }, 'DOWNGRADE_MODEL_DEFAULTS_REQUIRED'],
    [state => { const plan = planNativeDowngrade(state.value.providers); state.value.providers[plan.routes[0].target] = {}; }, 'DOWNGRADE_PROVIDER_COLLISION'],
  ]) {
    const { adapter, state, calls } = fixture();
    // Avoid modifying the shared fixture model used by other tests.
    state.value = structuredClone(state.value);
    change(state);
    await assert.rejects(adapter.preview(), code(expected));
    assert.equal(calls.length, 0);
  }
});

test('postwrite mismatch, read failure, and mutation rejection are uncertain; never roll back racing edits', async () => {
  for (const mode of ['mismatch', 'read', 'throw-after', 'throw-before', 'missing']) {
    const { adapter, state, settings, calls } = fixture();
    settings.afterWrite = () => {
      state.value.providers.native.racing = 'preserve';
      const target = calls[0].ops[0].path[1];
      if (mode === 'mismatch') state.value.providers[target].apiKeyEnv = 'RACING_KEY';
      if (mode === 'missing') delete state.value.providers[target];
      if (mode === 'read') settings.onRead = () => { throw new Error(unsafe); };
      if (mode === 'throw-after') throw new Error(unsafe);
    };
    if (mode === 'throw-before') settings.beforeWrite = () => { throw new Error(unsafe); };
    await assert.rejects(stage(adapter), code('STAGE_UNVERIFIED'));
    assert.equal(calls.length, 1);
    if (mode !== 'throw-before') assert.equal(state.value.providers.native.racing, 'preserve');
    assert.equal(state.value.providers.vendor.keyEntries.one.apiKeyEnv, 'PRIVATE_ONE_KEY');
  }
});

test('read failures and missing/ambiguous actual namespace have safe errors and release busy guard', async () => {
  const { adapter, settings, state } = fixture();
  settings.onRead = () => { throw new Error(unsafe); };
  await assert.rejects(adapter.preview(), code('STAGE_READ_FAILED'));
  settings.onRead = null;
  assert.equal((await adapter.preview()).status, 'preview');
  settings.describe = () => [];
  await assert.rejects(adapter.preview(), code('STAGE_NAMESPACE_UNAVAILABLE'));
  settings.describe = () => [state, state];
  await assert.rejects(adapter.preview(), code('STAGE_NAMESPACE_UNAVAILABLE'));
});

test('no child routes validates but performs no mutation', async () => {
  const { adapter, state, validations, calls } = fixture();
  state.value.providers = { native: structuredClone(state.value.providers.native) };
  assert.deepEqual(await stage(adapter), { status: 'unchanged', counts: { providers: 0, models: 0 } });
  assert.equal(validations.length, 1);
  assert.equal(calls.length, 0);
});
