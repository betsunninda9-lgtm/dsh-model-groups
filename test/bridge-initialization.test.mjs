import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import test from 'node:test';
import { setupBridgeHost } from '../src/bridge/host.js';
import { createBridgeStore } from '../src/bridge/store.js';

const clone = value => structuredClone(value);
function memoryStore(providers, transaction) {
  let value = { revision: 0, providers: clone(providers) };
  return { read: async () => clone(value), async writeProvider(route, record, revision) {
    if (transaction.getStore()) throw new Error('HMR transactions cannot be nested');
    assert.equal(revision, value.revision); value.revision++; value.providers[route] = clone(record); return clone(value);
  } };
}

test('a failed HMR-context migration can resume through an admitted owner POST; GET and guests never write', async () => {
  const transaction = new AsyncLocalStorage();
  const old = { api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'ROOT', models: [], multiKey: true,
    keyEntries: { work: { name: 'Work', apiKeyEnv: 'WORK', models: [{ id: 'wire', input: ['text'], contextWindow: 8192, maxTokens: 1024 }] } } };
  const storage = memoryStore({}, transaction), native = memoryStore({ route: old }, transaction);
  let handler;
  const ctx = { settings: { documentPath: '/memory-only/bridge-not-written.yml' }, logger: { warn() {} }, on: () => () => {},
    effect(fn) { return fn(); }, webServer: { register(route) { handler = route.handler; return () => {}; } },
    connection: { admit: request => request.owner ? { peer: { principal: { kind: 'owner' } } } : { rejection: 403 } },
    credentials: { describe: async () => ({ configured: true }) } };
  const runtime = { prepare: async (_provider, draft) => ({ models: { legacy: [], keyEntries: Object.fromEntries(Object.entries(draft.keyEntries).map(([id, entry]) => [id, entry.models])) } }), probeProjection: async () => true, dispose: async () => {} };
  let host;
  await transaction.run(true, async () => { host = setupBridgeHost(ctx, { storage, native, runtime }); await host.ready; });
  assert.deepEqual((await storage.read()).providers, {});
  const request = async (method, input, owner = true) => {
    const req = Readable.from(input ? [Buffer.from(JSON.stringify(input))] : []); Object.assign(req, { method, owner, headers: { 'content-type': 'application/json' } });
    let status, value; await handler(req, { writeHead(code) { status = code; }, end(body) { value = JSON.parse(body); } }); return { status, value };
  };
  const get = await request('GET'); assert.equal(get.value.value.initializationRequired, true);
  assert.deepEqual((await storage.read()).providers, {}, 'GET remains read-only');
  assert.equal((await request('POST', { action: 'initialize' }, false)).status, 403);
  assert.deepEqual((await storage.read()).providers, {}, 'guest cannot start migration');
  const initialized = await request('POST', { action: 'initialize' });
  assert.equal(initialized.status, 200); assert.equal(initialized.value.value.providers.route.confirmed, true);
  assert.equal((await storage.read()).providers.route.keyEntries.work.apiKeyEnv, 'WORK');
  assert.equal((await request('GET')).value.value.initializationRequired, undefined);
});

test('the original model card explicitly initializes once after a pending read, before publishing its snapshot', async () => {
  const calls = []; const ready = { status: 'ready', revision: 1, writable: true, providers: { route: { enabled: true } } };
  const store = createBridgeStore({ fetch: async (_url, options) => {
    calls.push(options.method ?? 'GET');
    if (options.method === 'POST') assert.deepEqual(JSON.parse(options.body), { action: 'initialize' });
    return { ok: true, json: async () => ({ ok: true, value: calls.length === 1 ? { ...ready, initializationRequired: true } : ready }) };
  } });
  await store.refresh(); assert.deepEqual(calls, ['GET', 'POST']); assert.deepEqual(store.getSnapshot(), ready);
  await store.refresh(); assert.deepEqual(calls, ['GET', 'POST', 'GET']); store.dispose();
});
