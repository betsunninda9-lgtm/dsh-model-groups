import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { bridgeHttpHandler } from '../src/bridge/http.js';
import { createBridgeStore } from '../src/bridge/store.js';
import { discoverBridgeModels } from '../src/bridge/discovery.js';
import { createBridgeSettingsStore } from '../src/bridge/settings-store.js';
import { Config } from '../src/bridge/config.js';

const owner = { admit: () => ({ peer: { principal: { kind: 'owner' } } }) };
async function invoke(controller, input, connection = owner) {
  const req = Readable.from([JSON.stringify(input)]);
  req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
  let status, value;
  await bridgeHttpHandler(controller, connection)(req, { writeHead(code) { status = code; }, end(body) { value = JSON.parse(body); } });
  return { status, value };
}
const response = value => ({ ok: true, status: 200, json: async () => ({ ok: true, value }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('owner admission precedes all credential and profile operations; errors never echo secrets', async () => {
  let called = 0;
  const controller = { async setCredential() { called++; throw new Error('raw-private-value'); } };
  const denied = await invoke(controller, { action: 'credential', ref: 'KEY', value: 'private-value' }, { admit: () => undefined });
  assert.equal(denied.status, 403); assert.equal(called, 0);
  const failed = await invoke(controller, { action: 'credential', ref: 'KEY', value: 'private-value' });
  assert.equal(failed.status, 409);
  assert.equal(JSON.stringify(failed).includes('private-value'), false);
  assert.equal(failed.value.error.code, 'FAILED');
  const success = await invoke({ async setCredential(ref, value) { assert.equal(ref, 'KEY'); assert.equal(value, 'private-value'); return { ok: true }; } }, { action: 'credential', ref: 'KEY', value: 'private-value' });
  assert.equal(success.status, 200);
  assert.equal(JSON.stringify(success).includes('private-value'), false);
});

test('HTTP save returns committed snapshot rather than exposing internal transaction data', async () => {
  const calls = [];
  const result = await invoke({
    async save(...args) { calls.push(args); },
    async snapshot() { return { status: 'ready', revision: 4, providers: {} }; },
  }, { action: 'save', provider: 'route', draft: { enabled: false }, expectedRevision: 2 });
  assert.deepEqual(calls, [['route', { enabled: false }, 2]]);
  assert.equal(result.value.value.revision, 4);
});

test('a GET started during save cannot overwrite the committed UI snapshot', async () => {
  const read = deferred(), write = deferred();
  const store = createBridgeStore({ fetch: (_url, options) => options.method === 'POST' ? write.promise : read.promise });
  const save = store.save('route', { enabled: false }, 1);
  const refreshing = store.refresh();
  await Promise.resolve();
  write.resolve(response({ status: 'ready', revision: 5, providers: {} }));
  assert.deepEqual(await save, { ok: true });
  read.resolve(response({ status: 'ready', revision: 2, providers: {} }));
  await refreshing;
  assert.equal(store.getSnapshot().revision, 5);
  store.dispose();
});

test('credential UI operation uses only the credential action and never enters snapshot', async () => {
  const requests = [];
  const store = createBridgeStore({ fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return response({ ok: true }); } });
  assert.deepEqual(await store.setCredential('NEW_KEY', 'temporary-private-value'), { ok: true });
  assert.deepEqual(requests, [{ action: 'credential', ref: 'NEW_KEY', value: 'temporary-private-value' }]);
  assert.equal(JSON.stringify(store.getSnapshot()).includes('temporary-private-value'), false);
  store.dispose();
});

test('hidden plugin Config and public Settings adapter use volatile fields and native revisions', async () => {
  const config = Config({});
  assert.deepEqual(config.bridge.get(), { providers: {} });
  const calls = [];
  const settings = {
    describe: () => [{ ns: 'model-groups', revision: 7, value: { bridge: { providers: { route: { enabled: false } } } } }],
    mutate: async (...args) => { calls.push(args); },
  };
  const store = createBridgeSettingsStore(settings);
  assert.deepEqual(await store.read(), { revision: 7, providers: { route: { enabled: false } } });
  await store.writeProvider('route', { enabled: true }, 7);
  assert.deepEqual(calls, [['model-groups', [{ op: 'set', path: ['bridge', 'providers', 'route'], value: { enabled: true } }], 7]]);
});

for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) test(`${api} discovery sends only the selected credential to the explicit endpoint`, async () => {
  let requests = 0;
  const models = await discoverBridgeModels({
    profile: { api, baseURL: 'http://127.0.0.1:12345/prefix/v1/', apiKeyEnv: 'ENTRY_KEY', headers: { 'x-custom': 'kept' } },
    ctx: { credentials: { async resolve(ref) { assert.equal(ref, 'ENTRY_KEY'); return { value: 'selected-secret' }; } } },
  }, { fetch: async (url, options) => {
    requests++;
    assert.equal(String(url), 'http://127.0.0.1:12345/prefix/v1/models');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.get('x-custom'), 'kept');
    if (api === 'anthropic-messages') {
      assert.equal(options.headers.get('x-api-key'), 'selected-secret');
      assert.equal(options.headers.get('anthropic-version'), '2023-06-01');
      assert.equal(options.headers.has('authorization'), false);
    } else {
      assert.equal(options.headers.get('authorization'), 'Bearer selected-secret');
      assert.equal(options.headers.has('x-api-key'), false);
    }
    return new Response(JSON.stringify({ data: [{ id: 'new-model', display_name: 'New' }, { id: 'new-model' }, { id: '' }] }));
  } });
  assert.equal(requests, 1);
  assert.deepEqual(models, [{ id: 'new-model', name: 'New' }]);
});

test('failed model discovery never falls back to a catalog or returns upstream body', async () => {
  let calls = 0;
  await assert.rejects(discoverBridgeModels({ profile: { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', apiKeyEnv: 'KEY' }, ctx: { credentials: { resolve: async () => ({ value: 'secret' }) } } }, { fetch: async () => { calls++; return new Response('private-upstream-body', { status: 401 }); } }), /DISCOVERY_REQUEST_FAILED/);
  assert.equal(calls, 1);
});
