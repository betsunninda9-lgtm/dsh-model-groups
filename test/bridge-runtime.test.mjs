import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createBridgeDispatch } from '../src/bridge/dispatch.js';
import { bridgeExecutionProfile, bridgeDirectoryModel, createBridgeRuntime } from '../src/bridge/runtime.js';
import { createBridgeRouting } from '../src/bridge/routing.js';

async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }

test('entry execution inherits ordinary settings but never falls back to the root credential', () => {
  const root = { apiKeyEnv: 'ROOT', baseURL: 'https://example.test/v1', api: 'openai-completions',
    headers: { 'x-shared': 'yes' }, modelOverrides: { legacy: {} }, models: [{ id: 'legacy' }] };
  const original = structuredClone(root);
  const profile = bridgeExecutionProfile({ present: true, profile: root }, { name: 'Entry', apiKeyEnv: 'ENTRY', api: 'anthropic-messages', models: [{ id: 'wire' }], headers: { 'x-entry': 'yes' } });
  assert.equal(profile.apiKeyEnv, 'ENTRY');
  assert.equal(profile.api, 'anthropic-messages');
  assert.equal(profile.baseURL, 'https://example.test/', 'an inherited Anthropic endpoint also drops the SDK-owned version suffix');
  assert.deepEqual(profile.models, [{ id: 'wire' }]);
  assert.equal(profile.modelOverrides, undefined);
  assert.deepEqual(profile.headers, { 'x-shared': 'yes', 'x-entry': 'yes' });
  assert.deepEqual(root, original);
  assert.throws(() => bridgeExecutionProfile(root, { models: [{ id: 'wire' }] }), { code: 'MISSING_CREDENTIAL' });
  assert.equal(bridgeExecutionProfile(root).apiKeyEnv, 'ROOT', 'legacy raw selections retain the original key');
});

test('entry capability policy is materialized before native profile preparation without changing saved models', () => {
  const entry = { apiKeyEnv: 'ENTRY', capabilityDefaults: { vision: true, reasoning: true }, models: [{ id: 'wire', input: ['text'] }] };
  const saved = structuredClone(entry);
  const profile = bridgeExecutionProfile({}, entry);
  assert.deepEqual(profile.models[0].input, ['text', 'image']);
  assert.deepEqual(profile.models[0].reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high' });
  assert.equal(profile.capabilityDefaults, undefined);
  assert.equal(profile.models[0].capabilityOverrides, undefined);
  assert.deepEqual(entry, saved);
});

test('Anthropic entries normalize only the terminal version path and leave native roots and other protocols unchanged', () => {
  const root = { api: 'anthropic-messages', apiKeyEnv: 'ROOT', baseURL: 'https://example.test/anthropic/v1?tenant=a%2Fb#marker', models: [] };
  const saved = structuredClone(root);
  const entry = { apiKeyEnv: 'SELECTED', models: [{ id: 'wire' }] };
  const effective = bridgeExecutionProfile(root, entry);
  assert.equal(effective.baseURL, 'https://example.test/anthropic?tenant=a%2Fb#marker');
  assert.equal(effective.apiKeyEnv, 'SELECTED');
  assert.deepEqual(bridgeExecutionProfile(root), root, 'native root transport must retain its exact original URL');
  assert.deepEqual(root, saved);
  for (const [api, input, expected] of [
    ['anthropic-messages', 'https://example.test/v1', 'https://example.test/'],
    ['anthropic-messages', 'https://example.test/anthropic/v1/', 'https://example.test/anthropic'],
    ['anthropic-messages', 'https://example.test/custom/v10', 'https://example.test/custom/v10'],
    ['anthropic-messages', 'https://example.test/v1/custom', 'https://example.test/v1/custom'],
    ['openai-completions', 'https://example.test/anthropic/v1', 'https://example.test/anthropic/v1'],
    ['openai-responses', 'https://example.test/anthropic/v1', 'https://example.test/anthropic/v1'],
  ]) assert.equal(bridgeExecutionProfile(root, { ...entry, api, baseURL: input }).baseURL, expected);
});

test('entry authentication headers cannot replace the selected key at any request layer', () => {
  for (const field of ['headers', 'model']) {
    for (const name of ['Authorization', 'x-api-key', 'api-key', 'Proxy-Authorization']) {
      const entry = { apiKeyEnv: 'ENTRY', models: [{ id: 'wire' }] };
      if (field === 'headers') entry.headers = { [name]: 'private' };
      else entry.models[0].headers = { [name]: 'private' };
      assert.throws(() => bridgeExecutionProfile({}, entry), { code: 'AUTH_HEADER_CONFLICT' });
    }
  }
  assert.throws(() => bridgeExecutionProfile({ headers: { authorization: 'private' } }, { apiKeyEnv: 'ENTRY', models: [] }), { code: 'AUTH_HEADER_CONFLICT' });
});

test('directory projection preserves available native capabilities without leaking protocol compat', () => {
  const info = { id: 'wire', name: 'Wire', inputModalities: ['text', 'image'], context: { contextWindow: 8192 }, defaultMaxTokens: 1000,
    reasoning: { efforts: [{ id: 'off' }, { id: 'low' }] }, toolUpdate: 'in-history' };
  assert.deepEqual(bridgeDirectoryModel(info, { compat: { thinkingFormat: 'anthropic' } }), {
    id: 'wire', name: 'Wire', contextWindow: 8192, maxTokens: 1000, input: ['text', 'image'], reasoningEfforts: { off: null, low: 'low' },
  });
  assert.equal(bridgeDirectoryModel({ id: 'wire' }, {}, { defaultMaxTokens: 128000 }).maxTokens, undefined,
    'a profile fallback is not a public catalog model output limit');
});

test('protocol-aware discovery receives the effective profile and fails closed without an Anthropic hook', async () => {
  const calls = [];
  const ctx = { get: name => name === 'llm' ? { listConfigurableProviders: () => [{ provider: 'known', defaultBaseURL: 'https://api.example.test' }] } : undefined };
  const runtime = createBridgeRuntime(ctx, { discoverEndpoint(request) { calls.push(request); return [{ id: 'found' }]; } });
  const entry = { apiKeyEnv: 'SELECTED', models: [] };
  assert.deepEqual(await runtime.discover('known', 'key', entry, { api: 'anthropic-messages' }), [{ id: 'found' }]);
  assert.equal(calls[0].profile.api, 'anthropic-messages');
  assert.equal(calls[0].profile.apiKeyEnv, 'SELECTED');
  assert.equal(calls[0].profile.baseURL, 'https://api.example.test');
  assert.equal(calls[0].ctx, ctx);
  await assert.rejects(() => runtime.discover('known', 'key', entry, {}), { code: 'DISCOVERY_PROTOCOL_REQUIRED' });
  const noHook = createBridgeRuntime(ctx);
  await assert.rejects(() => noHook.discover('known', 'key', entry, { api: 'anthropic-messages' }), { code: 'DISCOVERY_UNSUPPORTED' });
  await runtime.dispose(); await noHook.dispose();
  await assert.rejects(() => runtime.discover('known', 'key', entry, { api: 'anthropic-messages' }), { code: 'BRIDGE_RUNTIME_UNAVAILABLE' });
});

test('private dispatch preserves hidden request descriptors and unknown symbol metadata', async () => {
  const metadata = Symbol('public-hook-request-metadata');
  let captured;
  class Runtime {
    async prepareCall(config) { return { config, async *stream(request) { captured = request; yield { type: 'finish', reason: { kind: 'stop' } }; } }; }
  }
  const ctx = {
    isolate() { return this; },
    plugin(plugin) { plugin.apply(this); const fiber = Promise.resolve(); fiber.dispose = async () => {}; return fiber; },
  };
  const runtime = createBridgeRuntime(ctx, { loadModule: async name => name === '@deepseek-ai/dsh-llm'
    ? { LlmRuntime: Runtime } : { Config: config => config, apply() {} } });
  const options = { provider: 'known', model: '@dsh-key/a/wire', messages: [{ role: 'user', content: [] }] };
  Object.defineProperty(options, metadata, { value: { kind: 'recall' }, enumerable: false, writable: false });
  Object.freeze(options);
  try {
    await collect(runtime.execute({ provider: 'known', entryId: 'a', model: 'wire', publicModel: options.model,
      snapshot: { keyEntries: { a: { apiKeyEnv: 'SELECTED', models: [{ id: 'wire' }] } } }, options }));
    assert.equal(captured[metadata], options[metadata]);
    assert.deepEqual(Object.getOwnPropertyDescriptor(captured, metadata), Object.getOwnPropertyDescriptor(options, metadata));
    assert.equal(captured.model, 'wire');
    assert.equal(options.model, '@dsh-key/a/wire');
  } finally { await runtime.dispose(); }
});

test('real public isolate serves versioned OpenAI/Anthropic/root aliases and discovery without modifying the main registry', async t => {
  const rootPath = process.env.DSH_ROOT;
  if (!rootPath) return t.skip('Set DSH_ROOT to test installed public runtime APIs against a loopback fixture');
  const require = createRequire(path.join(rootPath, 'package.json'));
  const loadModule = specifier => import(pathToFileURL(require.resolve(specifier)).href);
  const [{ Context }, { LlmRuntime }] = await Promise.all([loadModule('@deepseek-ai/cordis'), loadModule('@deepseek-ai/dsh-llm')]);
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const pieces = []; for await (const piece of request) pieces.push(piece);
    const body = pieces.length ? JSON.parse(Buffer.concat(pieces).toString()) : undefined;
    requests.push({ path: request.url, model: body?.model, authorization: request.headers.authorization,
      apiKey: request.headers['x-api-key'], custom: request.headers['x-entry'] });
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'discovered-model' }] })); return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (request.url.endsWith('/chat/completions')) {
      const common = { id: 'local-chat', object: 'chat.completion.chunk', created: 0, model: body.model };
      response.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'openai-local' }, finish_reason: null }] }) + '\n\n');
      response.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n');
      response.end('data: [DONE]\n\n');
    } else {
      const emit = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      emit('message_start', { message: { id: 'msg_local', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'anthropic-local' } });
      emit('content_block_stop', { index: 0 });
      emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      emit('message_stop', {}); response.end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ctx = new Context();
  const main = new LlmRuntime(ctx);
  let settings = 0, authorization = 0, snapshots = 0;
  ctx.provide('credentials', { async resolve(ref) { return { value: `dummy-${ref}` }; }, async readRecord() {}, async listRecords() { return []; } });
  ctx.provide('settings', { configure() { settings += 1; } });
  ctx.provide('authorization', { registerFlow() { authorization += 1; } });
  const runtime = createBridgeRuntime(ctx, { loadModule, maxIdle: 2 });
  const original = { api: 'openai-completions', baseURL: origin + '/v1', apiKeyEnv: 'ROOT', models: [{ id: 'legacy', contextWindow: 8192, maxTokens: 1000 }] };
  const entries = {
    a: { apiKeyEnv: 'A', api: 'openai-completions', models: [{ id: 'wire-a', contextWindow: 8192, maxTokens: 1000 }] },
    b: { apiKeyEnv: 'B', api: 'anthropic-messages', baseURL: origin + '/anthropic/v1', headers: { 'x-entry': 'entry-b' }, models: [{ id: 'wire-b', contextWindow: 8192, maxTokens: 1000 }] },
  };
  const saved = { enabled: true, active: true, confirmed: true, generation: 1, original: { present: true, profile: original }, keyEntries: entries };
  const remove = createBridgeDispatch(ctx, { readSnapshot: () => { snapshots += 1; return saved; }, execute: runtime.execute });
  try {
    const prepared = await runtime.prepare('bridge-local', saved, original);
    assert.deepEqual(prepared.models.legacy.map(model => model.id), ['legacy']);
    assert.deepEqual(prepared.models.keyEntries.a.map(model => model.id), ['wire-a']);
    assert.deepEqual(prepared.models.keyEntries.b.map(model => model.id), ['wire-b']);
    const run = model => collect(ctx.waterfall(main, 'llm/stream', { provider: 'bridge-local', model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'local only' }] }], signal: AbortSignal.timeout(10000) }, () => { assert.fail('main adapter must not execute'); }));
    const selected = (stable, wire) => {
      const token = Object.keys(saved.routing).find(key => saved.routing[key] === stable);
      assert.ok(token);
      return `@dsh-key/${token}/${encodeURIComponent(wire)}`;
    };
    saved.routing = createBridgeRouting('bridge-local', saved, original, prepared.models);
    saved.rootModels = prepared.models.legacy;
    for (const model of [selected('a', 'wire-a'), selected('b', 'wire-b'), selected(null, 'legacy')]) {
      const chunks = await run(model);
      assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1)));
      assert.ok(chunks.some(chunk => chunk.type === 'text-delta'));
    }
    assert.equal(snapshots, 3, 'the isolated LLM must not re-enter the outer interceptor');
    assert.equal(requests[0].authorization, 'Bearer dummy-A');
    assert.equal(requests[1].apiKey, 'dummy-B');
    assert.equal(requests[1].path, '/anthropic/v1/messages?beta=true', 'the real SDK must append its version path exactly once');
    assert.equal(requests[1].custom, 'entry-b');
    assert.equal(requests[2].authorization, 'Bearer dummy-ROOT');
    assert.deepEqual(requests.slice(0, 3).map(request => request.model), ['wire-a', 'wire-b', 'legacy']);
    const discovered = await runtime.discover('bridge-local', 'a', entries.a, original);
    assert.deepEqual(discovered.map(model => model.id), ['discovered-model']);
    assert.equal(requests.at(-1).authorization, 'Bearer dummy-A');
    assert.equal(main.listProviders().length, 0);
    assert.equal(main.listConfigurableProviders().length, 0);
    assert.equal(settings, 0); assert.equal(authorization, 0);
  } finally {
    remove(); await runtime.dispose();
    await new Promise(resolve => server.close(resolve)); server.closeAllConnections();
  }
  await assert.rejects(() => runtime.prepare('bridge-local', saved, original), { code: 'BRIDGE_RUNTIME_UNAVAILABLE' });
});
