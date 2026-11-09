import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { newRoute, newGroupId, namespace, validateConfig, Config, unwrapConfig } from '../src/host/config.js';
import { mountRoutes } from '../src/host/routes.js';
import { createController } from '../src/host/controller.js';
const collect = async iterable => { const result = []; for await (const chunk of iterable) result.push(chunk); return result; };
const request = provider => ({ provider, model: 'synthetic-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic prompt' }] }] });
function fixture() {
  const a = newRoute(), b = newRoute(), groupId = newGroupId();
  const config = { groups: { [groupId]: { name: 'Synthetic Supplier', api: 'openai-completions', baseURL: 'http://127.0.0.1:9/v1', entries: { [a]: { name: 'Synthetic Alpha', models: ['synthetic-model'] }, [b]: { name: 'Synthetic Beta', models: ['synthetic-model'] } } } }, tombstones: {} };
  return { a, b, groupId, config };
}
async function runtime(t) {
  const ctx = new Context(); const fiber = ctx.plugin(LlmRuntime); await fiber.await(); t.after(() => fiber.dispose());
  const records = new Map();
  ctx.provide('credentials', { readRecord: async key => records.get(key), describeRecord: async key => ({ configured: records.has(key), kind: records.get(key)?.kind, writable: true }), modifyRecord: async (key, mutate) => { const record = await mutate(records.get(key)); if (record) records.set(key, record); return record; }, deleteRecord: async key => { records.delete(key); } });
  return { ctx, records };
}
function remove(config, groupId, route) { const next = structuredClone(config); delete next.groups[groupId].entries[route]; next.tombstones[route] = true; return next; }

test('explicit schema validates dictionaries, endpoint and persistent tombstones', () => {
  const { config, a, groupId } = fixture();
  assert.deepEqual(unwrapConfig(Config(config)), config);
  assert.deepEqual(validateConfig(config), config);
  const removed = remove(config, groupId, a); assert.deepEqual(validateConfig(removed, config), removed);
  assert.throws(() => validateConfig(config, removed), /retired|Tombstones/);
  const invalid = structuredClone(config); invalid.groups[groupId].baseURL = 'https://synthetic:secret@example.invalid';
  assert.throws(() => validateConfig(invalid), /endpoint/);
  assert.throws(() => validateConfig({ ...config, apiKey: 'synthetic' }), /fields/);
});

test('two official adapters dispatch exact synthetic keys and preserve unrelated prepared call', async t => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    seen.push({ auth: req.headers.authorization, body: JSON.parse(raw), path: req.url });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic response' }, finish_reason: null }] })+'\n\ndata: '+JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const { ctx, records } = await runtime(t); const { a, b, groupId, config } = fixture();
  config.groups[groupId].baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  for (const route of [a, b]) records.set(credentialKey(namespace, route), { kind: 'api-key', key: `synthetic-${route}` });
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  assert.notEqual(mounted.routes.get(a).adapter, mounted.routes.get(b).adapter);
  for (const route of [a, b]) { assert.equal((await ctx.llm.listModels(route)).length, 1); const result = await collect(ctx.llm.stream(request(route))); assert.equal(result.at(-1).reason.kind, 'stop'); }
  assert.deepEqual(seen.map(item => item.auth), [a,b].map(route => `Bearer synthetic-${route}`));
  assert.ok(seen.every(item => item.body.model === 'synthetic-model'));
  const preparedA = await ctx.llm.prepareCall({ provider: a, model: 'synthetic-model' });
  const preparedB = await ctx.llm.prepareCall({ provider: b, model: 'synthetic-model' });
  const next = structuredClone(config); next.groups[groupId].entries[a].name = 'Synthetic Changed'; mounted.update(next);
  assert.match(JSON.stringify(await collect(preparedA.stream(request(a)))), /STALE_CONFIGURATION/);
  assert.equal((await collect(preparedB.stream(request(b)))).at(-1).reason.kind, 'stop');
  const preparedDeleted = await ctx.llm.prepareCall({ provider: a, model: 'synthetic-model' });
  mounted.update(remove(next, groupId, a));
  assert.match(JSON.stringify(await collect(preparedDeleted.stream(request(a)))), /MISSING_CREDENTIAL/);
  assert.deepEqual(ctx.llm.listProviders().map(item => item.id), [b]);
});

for (const action of ['delete', 'update', 'dispose']) test(`credential await race refuses dispatch on ${action}`, async t => {
  const { ctx, records } = await runtime(t); const { a, groupId, config } = fixture();
  records.set(credentialKey(namespace, a), { kind: 'api-key', key: 'synthetic-secret' });
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  const prepared = await ctx.llm.prepareCall({ provider: a, model: 'synthetic-model' });
  let release, entered; const pending = new Promise(resolve => { entered = resolve; });
  ctx.credentials.readRecord = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const result = collect(prepared.stream(request(a))); await pending;
  if (action === 'delete') mounted.update(remove(config, groupId, a));
  else if (action === 'dispose') mounted.dispose();
  else { const next = structuredClone(config); next.groups[groupId].baseURL += '/changed'; mounted.update(next); }
  release({ kind: 'api-key', key: 'synthetic-secret' });
  assert.match(JSON.stringify(await result), action === 'update' ? /STALE_CONFIGURATION/ : /MISSING_CREDENTIAL/);
});

test('failed registration and directory update rollback only new routes', async t => {
  const { ctx } = await runtime(t); const { a, b, groupId, config } = fixture();
  const original = ctx.llm.registerAdapter.bind(ctx.llm); let count = 0;
  ctx.llm.registerAdapter = (...args) => { if (++count === 2) throw new Error('Synthetic registration failure'); return original(...args); };
  assert.throws(() => mountRoutes(ctx, config), /registration failure/);
  assert.deepEqual(ctx.llm.listProviders(), []);
  ctx.llm.registerAdapter = original;
  const onlyA = structuredClone(config); delete onlyA.groups[groupId].entries[b];
  const mounted = mountRoutes(ctx, onlyA); t.after(mounted.dispose);
  const profile = mounted.routes.get(a).profile;
  const directory = ctx.llm.registerConfigurableProviders([{ provider: b, displayName: 'Synthetic foreign directory', settingsNs: 'synthetic-other', settingsPath: [] }]); t.after(directory);
  assert.throws(() => mounted.update(config));
  assert.deepEqual(ctx.llm.listProviders().map(item => item.id), [a]);
  assert.equal(mounted.routes.get(a).profile, profile);
});

test('directory failure after new adapter registration rolls back the new adapter', async t => {
  const { ctx } = await runtime(t); const { config, a, b, groupId } = fixture();
  const register = ctx.llm.registerConfigurableProviders.bind(ctx.llm);
  ctx.llm.registerConfigurableProviders = entries => { const handle = register(entries); handle.replace = () => { throw new Error('Synthetic directory failure'); }; return handle; };
  const initial = structuredClone(config); delete initial.groups[groupId].entries[b];
  const mounted = mountRoutes(ctx,initial); t.after(mounted.dispose); const profile = mounted.routes.get(a).profile;
  const changed = structuredClone(config); changed.groups[groupId].entries[a].name = 'Synthetic pending rename';
  assert.throws(() => mounted.update(changed),/directory failure/);
  assert.equal(mounted.routes.get(a).profile,profile);
  assert.deepEqual(ctx.llm.listProviders().map(item=>item.id),[a]);
  assert.deepEqual(mounted.snapshot(),initial);
});

for (const api of ['openai-completions', 'anthropic-messages', 'openai-responses']) test(`public ${api} factory prepares model with independent route`, async t => {
  const { ctx, records } = await runtime(t); const { config, a, groupId } = fixture(); config.groups[groupId].api = api;
  records.set(credentialKey(namespace, a), { kind: 'api-key', key: 'synthetic-secret' });
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  assert.equal((await mounted.routes.get(a).adapter.prepareCall(a, 'synthetic-model')).model.provider, a);
  assert.equal((await ctx.llm.listModels(a)).length, 1);
});

for (const api of ['anthropic-messages', 'openai-responses']) test(`${api} real HTTP wire uses only the owned synthetic credential`, async t => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    seen.push({ headers: req.headers, path: req.url, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, value) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
    if (api === 'anthropic-messages') res.end(
      event('message_start', { message: { id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }) +
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Synthetic reply' } }) +
      event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) + event('message_stop', {}));
    else res.end(event('response.created', { response: { id: 'synthetic', model: 'synthetic-model', status: 'in_progress', output: [] } }) +
      event('response.output_item.added', { output_index: 0, item: { id: 'synthetic-message', type: 'message', role: 'assistant', content: [] } }) +
      event('response.content_part.added', { item_id: 'synthetic-message', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }) +
      event('response.output_text.delta', { item_id: 'synthetic-message', output_index: 0, content_index: 0, delta: 'Synthetic reply' }) +
      event('response.completed', { response: { id: 'synthetic', model: 'synthetic-model', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const { ctx, records } = await runtime(t); const { config, a, groupId } = fixture();
  config.groups[groupId].api = api; config.groups[groupId].baseURL = `http://127.0.0.1:${server.address().port}${api === 'anthropic-messages' ? '' : '/v1'}`;
  records.set(credentialKey(namespace,a), { kind: 'api-key', key: 'synthetic-protocol-key' });
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  const chunks = await collect(ctx.llm.stream(request(a)));
  assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks));
  assert.equal(seen.length, 1); assert.equal(seen[0].body.model, 'synthetic-model');
  if (api === 'anthropic-messages') { assert.equal(seen[0].headers['x-api-key'], 'synthetic-protocol-key'); assert.equal(seen[0].path, '/v1/messages?beta=true'); }
  else { assert.equal(seen[0].headers.authorization, 'Bearer synthetic-protocol-key'); assert.equal(seen[0].path, '/v1/responses'); }
});

test('controller persists metadata with revisions and keeps credential writes out of config', async t => {
  const { ctx, records } = await runtime(t); const { config, a, groupId } = fixture();
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose); let revision = 1; let persisted = structuredClone(config);
  ctx.provide('settings', { writable: true, describe: () => [{ ns: namespace, revision, value: persisted }], mutate: async (ns, ops, expected) => { const next=Object.fromEntries(ops.map(op=>[op.path[0],op.value])); assert.equal(ns, namespace); assert.equal(expected, revision); mounted.update(next); persisted = structuredClone(next); revision++; } });
  const controller = createController(ctx, mounted);
  const saved = await controller.setCredential(a, 'synthetic-only-secret'); assert.equal(saved.configured, true);
  assert.equal(records.get(credentialKey(namespace,a)).key, 'synthetic-only-secret');
  assert.ok(!JSON.stringify(await controller.snapshot()).includes('synthetic-only-secret'));
  assert.ok(!JSON.stringify(persisted).includes('synthetic-only-secret'));
  await assert.rejects(controller.updateEntry(groupId, a, { name: 'Synthetic rename' }, 0), /SETTINGS_CONFLICT/);
  await controller.updateEntry(groupId, a, { name: 'Synthetic rename' }, 1);
  await controller.deleteEntry(groupId, a, 2);
  assert.equal(persisted.tombstones[a], true);
  await assert.rejects(controller.setCredential(a, 'synthetic'), /unavailable/);
  assert.equal((await controller.snapshot()).revision, 3);
});

test('failed settings persistence leaves routes and credentials unchanged', async t => {
  const { ctx } = await runtime(t); const { config, a, groupId } = fixture();
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  ctx.provide('settings', { writable: true, describe: () => [{ ns: namespace, revision: 1 }], mutate: async () => { throw new Error('Synthetic disk failure'); } });
  const controller = createController(ctx, mounted); const profile = mounted.routes.get(a).profile;
  await assert.rejects(controller.deleteEntry(groupId, a, 1), /disk failure/);
  assert.deepEqual(mounted.snapshot(), config); assert.equal(mounted.routes.get(a).profile, profile);
});

test('missing record never consults ambient credentials or another route', async t => {
  const { ctx, records } = await runtime(t); const { config, a, b } = fixture();
  ctx.credentials.resolve = async () => { throw new Error('Ambient resolution must not happen'); };
  records.set(credentialKey(namespace,b), { kind: 'api-key', key: 'synthetic-other' });
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  assert.deepEqual(await ctx.llm.listModels(a), []); assert.equal((await ctx.llm.listModels(b)).length, 1);
  assert.match(JSON.stringify(await collect(ctx.llm.stream(request(a)))), /MISSING_CREDENTIAL/);
});

test('deleting an active route aborts its official SDK request', async t => {
  let accepted; const arrived = new Promise(resolve => { accepted = resolve; });
  const server = createServer(async (req,res) => { for await (const chunk of req) {} res.writeHead(200,{'content-type':'text/event-stream'}); res.flushHeaders(); accepted(); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const { ctx, records } = await runtime(t); const { config, a, b, groupId } = fixture();
  config.groups[groupId].baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  records.set(credentialKey(namespace,a),{kind:'api-key',key:'synthetic-active'});
  const mounted = mountRoutes(ctx,config); t.after(mounted.dispose);
  const result = collect(ctx.llm.stream(request(a))); await arrived;
  const adapter = mounted.routes.get(a).adapter; assert.ok(adapter.active.size > 0);
  mounted.update(remove(config,groupId,a));
  const chunks = await result; assert.equal(adapter.active.size,0); assert.ok(chunks.length > 0);
  assert.deepEqual(ctx.llm.listProviders().map(item=>item.id),[b]);
});

for (const existing of [false,true]) test(`credential save racing deletion ${existing ? 'preserves previous record' : 'removes newly saved orphan'}`, async t => {
  const { ctx, records } = await runtime(t); const { config, a, groupId } = fixture();
  const mounted = mountRoutes(ctx, config); t.after(mounted.dispose);
  ctx.provide('settings', { writable: true, describe: () => [{ ns: namespace, revision: 1 }] });
  let release, entered; const pending = new Promise(resolve => { entered = resolve; });
  const address = credentialKey(namespace,a);
  if (existing) records.set(address,{kind:'api-key',key:'synthetic-previous'});
  let first = true;
  ctx.credentials.modifyRecord = async (key, mutate) => { const value = await mutate(records.get(key)); if (first) { first=false; entered(); await new Promise(resolve => { release = resolve; }); } if(value) records.set(key,value); return value; };
  const controller = createController(ctx,mounted); const result = controller.setCredential(a,'synthetic-only'); await pending;
  mounted.update(remove(config,groupId,a)); release();
  await assert.rejects(result,/deleted/); assert.equal(records.has(address),existing);
  if(existing) assert.equal(records.get(address).key,'synthetic-previous');
});
