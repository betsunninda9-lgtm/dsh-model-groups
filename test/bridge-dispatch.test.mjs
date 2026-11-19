import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeDispatch, remapBridgeHistory, bridgeFailure } from '../src/bridge/dispatch.js';

const alias = '@dsh-key/key-a/wire';
const active = () => ({ enabled: true, active: true, confirmed: true, generation: 3,
  original: { present: true, profile: { apiKeyEnv: 'ROOT' } }, keyEntries: { 'key-a': { apiKeyEnv: 'KEY_A', models: [{ id: 'wire' }] } } });
const done = { type: 'finish', reason: { kind: 'stop' } };
async function collect(value) { const chunks = []; for await (const chunk of value) chunks.push(chunk); return chunks; }
function install(callbacks) {
  let middleware, removed = false;
  const dispose = createBridgeDispatch({ on(name, callback) { assert.equal(name, 'llm/stream'); middleware = callback; return () => { removed = true; }; } }, callbacks);
  return { stream: (options, next = async function* () { throw new Error('native must not dispatch'); }) => collect(middleware(options, next)), dispose, removed: () => removed };
}
const options = model => ({ provider: 'original', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] });

test('bridge keeps public identity and captures one detached generation for alias and raw selections', async () => {
  const snapshot = active();
  const calls = [];
  const bridge = install({ readSnapshot: async provider => { assert.equal(provider, 'original'); return snapshot; },
    projectionMatches: async () => true,
    async *execute(request) { calls.push(request); snapshot.keyEntries['key-a'].apiKeyEnv = 'CHANGED'; yield done; } });
  const selected = options(alias);
  assert.deepEqual(await bridge.stream(selected), [done]);
  assert.equal(selected.provider, 'original');
  assert.equal(selected.model, alias);
  assert.equal(calls[0].model, 'wire');
  assert.equal(calls[0].entryId, 'key-a');
  assert.equal(calls[0].snapshot.keyEntries['key-a'].apiKeyEnv, 'KEY_A');
  assert.deepEqual(await bridge.stream(options('old-raw-model')), [done]);
  assert.equal(calls[1].entryId, undefined);
  assert.equal(calls[1].model, 'old-raw-model');
  bridge.dispose(); assert.equal(bridge.removed(), true);
});

test('unmanaged raw providers pass through; aliases with no active bridge fail closed', async () => {
  let calls = 0;
  const bridge = install({ readSnapshot: () => undefined, execute() { calls += 1; } });
  const next = async function* () { yield done; };
  assert.deepEqual(await bridge.stream(options('plain'), next), [done]);
  const failure = await bridge.stream(options(alias), next);
  assert.equal(failure[0].reason.failure.code, 'BRIDGE_DISABLED');
  assert.equal(calls, 0);
});

test('projection conflicts, missing keys, malformed aliases and absent models cannot hit a native or fallback key', async () => {
  const cases = [
    { snapshot: { ...active(), confirmed: false }, model: 'old-raw-model', code: 'BRIDGE_CONFIG_CONFLICT' },
    { snapshot: active(), matches: false, model: alias, code: 'BRIDGE_CONFIG_CONFLICT' },
    { snapshot: active(), model: '@dsh-key/gone/wire', code: 'UNKNOWN_KEY_ENTRY' },
    { snapshot: active(), model: '@dsh-key/key-a/gone', code: 'UNKNOWN_MODEL' },
    { snapshot: active(), model: '@dsh-key/%6bey-a/wire', code: 'INVALID_MODEL_IDENTITY' },
  ];
  for (const item of cases) {
    const bridge = install({ readSnapshot: () => item.snapshot, projectionMatches: () => item.matches !== false,
      execute() { assert.fail('invalid selection must not execute'); } });
    const chunks = await bridge.stream(options(item.model));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].reason.failure.code, item.code);
  }
});

test('execution errors, missing terminal chunks and cancellation produce one standard finish', async () => {
  const error = Object.assign(new Error('secret-token https://private-host'), { code: 'MISSING_CREDENTIAL' });
  const bridge = install({ readSnapshot: active, async *execute() { throw error; } });
  const chunks = await bridge.stream(options(alias));
  assert.equal(chunks[0].reason.failure.code, 'MISSING_CREDENTIAL');
  assert.doesNotMatch(JSON.stringify(chunks), /secret-token|private-host/);
  const incomplete = install({ readSnapshot: active, async *execute() { yield { type: 'text-delta', index: 0, text: 'partial' }; } });
  assert.equal((await incomplete.stream(options(alias))).at(-1).reason.kind, 'error');
  const controller = new AbortController(); controller.abort();
  assert.equal((await bridge.stream({ ...options(alias), signal: controller.signal }))[0].reason.kind, 'aborted');
});

test('terminal finish closes the private iterator and cannot be followed by a second finish', async () => {
  let closed = false;
  const bridge = install({ readSnapshot: active, async *execute() { try { yield done; assert.fail('must close at finish'); } finally { closed = true; } } });
  assert.deepEqual(await bridge.stream(options(alias)), [done]);
  assert.equal(closed, true);
});

test('replay is retained for precisely the selected key and never copied across keys on the same provider', () => {
  const block = { type: 'image', image: { kind: 'attachment', id: 'example' } };
  const messages = [
    { role: 'assistant', content: [block], source: { provider: 'original', model: alias, replayState: { signature: 'same-key' } } },
    { role: 'assistant', content: [], source: { provider: 'original', model: '@dsh-key/key-b/wire', replayState: { signature: 'other-key' } } },
    { role: 'assistant', content: [], source: { provider: 'other', model: 'wire', replayState: { signature: 'other-provider' } } },
  ];
  const original = structuredClone(messages);
  const remapped = remapBridgeHistory(messages, { provider: 'original', publicModel: alias, model: 'wire' });
  assert.equal(remapped[0].source.model, 'wire');
  assert.deepEqual(remapped[0].source.replayState, { signature: 'same-key' });
  assert.equal(remapped[0].content[0], block);
  assert.equal(remapped[1].source.replayState, undefined);
  assert.equal(remapped[2], messages[2]);
  assert.deepEqual(messages, original);
});

test('explicitly admitted native legacy aliases pass through without enabling stranded bridge projections', async () => {
  let called = 0;
  const bridge = install({ readSnapshot: () => ({ legacyNative: true, keyEntries: { 'key-a': { models: [{ id: 'wire' }] } } }),
    execute() { assert.fail('native legacy selection must not execute in the bridge'); } });
  const next = async function* () { called++; yield done; };
  assert.deepEqual(await bridge.stream(options(alias), next), [done]);
  for (const model of ['@dsh-key/key-a/gone', '@dsh-key/key-b/wire', '@dsh-key/%6bey-a/wire']) {
    assert.equal((await bridge.stream(options(model), next))[0].reason.failure.code, 'BRIDGE_DISABLED');
  }
  assert.equal(called, 1);
});

test('versioned aliases bind stable entries and root models while raw selections require reselection', async () => {
  const entryToken = 'g_' + 'a'.repeat(64), rootToken = 'g_' + 'b'.repeat(64);
  const snapshot = { ...active(), routing: { [entryToken]: 'key-a', [rootToken]: null }, rootModels: [{ id: 'legacy' }] };
  const calls = [];
  const bridge = install({ readSnapshot: () => snapshot, async *execute(request) { calls.push(request); yield done; } });
  const selected = `@dsh-key/${entryToken}/wire`, legacy = `@dsh-key/${rootToken}/legacy`;
  assert.deepEqual(await bridge.stream(options(selected)), [done]);
  assert.equal(calls[0].entryId, 'key-a');
  assert.equal(calls[0].model, 'wire');
  assert.equal(calls[0].publicModel, selected);
  assert.deepEqual(await bridge.stream(options(legacy)), [done]);
  assert.equal(calls[1].entryId, undefined);
  assert.equal(calls[1].model, 'legacy');
  let nativeCalls = 0;
  assert.equal((await bridge.stream(options('legacy'), async function* () { nativeCalls++; yield done; }))[0].reason.failure.code, 'BRIDGE_CONFIG_CONFLICT');
  assert.equal(nativeCalls, 0);
  assert.equal(calls.length, 2, 'raw calls must not adopt the current bridge root profile');
});

test('changed or unversioned tokens fail before execution and cannot borrow a newly selected credential', async () => {
  const tokenA = 'g_' + 'a'.repeat(64), tokenB = 'g_' + 'b'.repeat(64), rootToken = 'g_' + 'c'.repeat(64);
  let snapshot = { ...active(), routing: { [tokenA]: 'key-a' }, rootModels: [] };
  let calls = 0;
  const bridge = install({ readSnapshot: () => snapshot, async *execute() { calls++; yield done; } });
  const preparedPublicModel = `@dsh-key/${tokenA}/wire`;
  snapshot = { ...snapshot, generation: 4, routing: { [tokenB]: 'key-a', [rootToken]: null },
    keyEntries: { 'key-a': { apiKeyEnv: 'KEY_B', models: [{ id: 'wire' }] } }, rootModels: [{ id: 'legacy' }] };
  for (const model of [preparedPublicModel, alias, '@dsh-key/%6bey-a/wire']) {
    assert.equal((await bridge.stream(options(model)))[0].reason.failure.code, 'BRIDGE_CONFIG_CONFLICT');
  }
  for (const model of [`@dsh-key/${tokenB}/gone`, `@dsh-key/${rootToken}/wire`]) {
    assert.equal((await bridge.stream(options(model)))[0].reason.failure.code, 'UNKNOWN_MODEL');
  }
  assert.equal(calls, 0);
  assert.deepEqual(await bridge.stream(options(`@dsh-key/${tokenB}/wire`)), [done]);
  assert.equal(calls, 1);
});

test('foreign thrown values do not execute property accessors or leak values', () => {
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('private'); } });
  assert.equal(bridgeFailure(hostile).reason.failure.code, 'BRIDGE_EXECUTION_FAILED');
});
