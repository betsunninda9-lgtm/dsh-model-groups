import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { setupBridgeHost } = await import(process.env.DSH_BRIDGE_ENTRY
  ? pathToFileURL(path.resolve(process.env.DSH_BRIDGE_ENTRY)).href : '../src/bridge/host.js');
import { createBridgeRuntime } from '../src/bridge/runtime.js';
import { discoverBridgeModels } from '../src/bridge/discovery.js';

const clone = value => structuredClone(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeTargets = [
  '@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
  '@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
  '@deepseek-ai/dsh-llm/lib/typert.host.js',
  '@deepseek-ai/dsh-llm/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-api-remotes/lib/client.js',
];
async function hashes(root) {
  return Promise.all(nativeTargets.map(async target => [target, digest(await readFile(path.join(root, 'node_modules', target)))]));
}
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }
function routedAlias(snapshot, entryId, modelId) {
  const token = Object.keys(snapshot.routing ?? {}).find(key => snapshot.routing[key] === entryId);
  assert.ok(token, `a versioned route must exist for ${String(entryId)}`);
  return `@dsh-key/${token}/${encodeURIComponent(modelId)}`;
}

/** The fixture changes import addresses only; neither implementation is patched by the test. */
async function publicModules(root, portRoot, pristine = true) {
  const require = createRequire(path.join(root, 'package.json'));
  const sourceFile = path.join(portRoot, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
  let source = await readFile(sourceFile, 'utf8');
  const sourceHash = digest(source);
  if (!pristine && !source.includes('keyEntries')) {
    const { planPatches } = await import('../scripts/native-patches.mjs');
    source = planPatches(portRoot, 'apply').find(plan => plan.name === 'pi-ai.patch.json').result;
  }
  if (pristine) assert.doesNotMatch(source, /keyEntries|multiKey/, 'this integration fixture must be the ordinary, unpatched pi-ai implementation');
  else assert.match(source, /keyEntries/, 'the second fixture must exercise the previously patched multi-key implementation');
  const imports = [...source.matchAll(/^import (.+) from "([^"]+)";$/gm)].map(match => match[2]).filter(value => !value.startsWith('node:'));
  // Node's import condition is required for pi-ai's import-only package exports.
  const resolution = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e',
    'console.log(JSON.stringify(Object.fromEntries(JSON.parse(process.argv[1]).map(s => [s, import.meta.resolve(s, process.argv[2])]))))',
    JSON.stringify(imports), pathToFileURL(path.join(root, 'package.json')).href], { encoding: 'utf8', timeout: 10000 });
  assert.equal(resolution.status, 0, resolution.stderr);
  const addresses = JSON.parse(resolution.stdout);
  const relocated = source.replace(/^import (.+) from "([^"]+)";$/gm, (line, names, specifier) =>
    addresses[specifier] ? `import ${names} from ${JSON.stringify(addresses[specifier])};` : line);
  const pi = await import('data:text/javascript;base64,' + Buffer.from(relocated).toString('base64'));
  const loadModule = specifier => specifier === '@deepseek-ai/dsh-llm-pi-ai'
    ? Promise.resolve(pi) : import(pathToFileURL(require.resolve(specifier)).href);
  return { pi, loadModule, sourceFile, sourceHash };
}

async function requestBridge(handler, method, input) {
  assert.equal(typeof handler, 'function');
  const request = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
  request.method = method;
  request.headers = input === undefined ? {} : { 'content-type': 'application/json' };
  let status, body;
  await handler(request, { writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); } });
  return { status, body };
}

async function startEndpoint() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const pieces = []; for await (const piece of request) pieces.push(piece);
    const body = pieces.length ? JSON.parse(Buffer.concat(pieces).toString('utf8')) : undefined;
    requests.push({ path: request.url, method: request.method, model: body?.model, authorization: request.headers.authorization,
      apiKey: request.headers['x-api-key'], custom: request.headers['x-entry'], version: request.headers['anthropic-version'] });
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'discovered-local-model' }] })); return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (request.url.endsWith('/chat/completions')) {
      const common = { id: 'host-local-chat', object: 'chat.completion.chunk', created: 0, model: body.model };
      response.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'host-openai' }, finish_reason: null }] }) + '\n\n');
      response.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n');
      response.end('data: [DONE]\n\n');
    } else if (new URL(request.url, 'http://local-fixture').pathname.endsWith('/v1/messages')) {
      const emit = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      emit('message_start', { message: { id: 'host_msg_local', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'host-anthropic' } });
      emit('content_block_stop', { index: 0 });
      emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      emit('message_stop', {}); response.end();
    } else response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, requests, origin: `http://127.0.0.1:${server.address().port}` };
}

test('the new host entry cannot reach any legacy host-file patch planner', async () => {
  const visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /(?:import|export)[\s\S]*?from\s+['"][^'"]*(?:native-patches|auto-patch|maintenance\.js)/,
      `bridge execution must not import a legacy host-file planner: ${file}`);
    for (const match of source.matchAll(/(?:import|export)\s+[^;]*?from\s+['"](\.[^'"]+)['"]/g)) {
      await visit(path.resolve(path.dirname(file), match[1]));
    }
  }
  await visit(fileURLToPath(new URL('../src/bridge/host.js', import.meta.url)));
  assert.ok(visited.size >= 6);
});

for (const fixture of [{ name: 'unpatched public pi-ai', pristine: true }, { name: 'existing legacy-patched pi-ai', pristine: false }])
test(`host Settings admits aliases, dispatches original-provider requests and restores native settings (${fixture.name})`, async t => {
  const root = process.env.DSH_ROOT;
  const portRoot = fixture.pristine ? process.env.DSH_PORT_ROOT : root;
  if (!root || !portRoot) return t.skip('Set DSH_ROOT and DSH_PORT_ROOT for real public Core plus both pi-ai runtime fixtures');
  const untouched = await hashes(root);
  const { pi, loadModule, sourceFile, sourceHash } = await publicModules(root, portRoot, fixture.pristine);
  const [{ Context }, { LlmRuntime }] = await Promise.all([loadModule('@deepseek-ai/cordis'), loadModule('@deepseek-ai/dsh-llm')]);
  const { server, requests, origin } = await startEndpoint();
  const ctx = new Context();
  const main = new LlmRuntime(ctx);
  const provider = 'anthropic'; // A catalog provider proves that identity is preserved even across independent APIs.
  const original = { api: 'openai-completions', apiKeyEnv: 'TEST_ROOT', baseURL: origin + '/v1',
    headers: { 'x-root': 'original' }, models: [{ id: 'legacy', contextWindow: 8192, maxTokens: 1024, input: ['text'] }] };
  const documents = {
    'llm-pi-ai': { revision: 0, value: { providers: { [provider]: clone(original) } } },
    'model-groups': { revision: 0, value: { bridge: { providers: {} } } },
  };
  const mutations = [];
  const secrets = new Map([['TEST_ROOT', 'dummy-root-only'], ['TEST_A', 'dummy-key-a-only'], ['TEST_B', 'dummy-key-b-only']]);
  const credentialWrites = [];
  let outer, bridgeFiber, host, handler;
  async function replaceOuter(value) {
    const config = pi.Config(value);
    await outer?.dispose();
    outer = ctx.plugin({ name: 'ordinary-native-pi-ai-fixture', apply(child) { pi.apply(child, config); } });
    await outer;
  }
  ctx.provide('credentials', {
    async resolve(ref) { const value = secrets.get(ref); return value === undefined ? undefined : { value }; },
    async describe(ref) { return { configured: secrets.has(ref) }; },
    async set(ref, value) { secrets.set(ref, value); credentialWrites.push({ ref, value }); },
    async readRecord() {}, async listRecords() { return []; },
  });
  ctx.provide('settings', {
    configure() {},
    describe() { return Object.entries(documents).map(([ns, item]) => ({ ns, revision: item.revision, value: clone(item.value) })); },
    async mutate(namespace, operations, expectedRevision) {
      const current = documents[namespace];
      if (current.revision !== expectedRevision) throw Object.assign(new Error('SETTINGS_CONFLICT'), { code: 'SETTINGS_CONFLICT' });
      const next = clone(current.value);
      for (const operation of operations) {
        let target = next;
        for (const key of operation.path.slice(0, -1)) target = target[key] ??= {};
        const key = operation.path.at(-1);
        if (operation.op === 'unset') delete target[key];
        else if (operation.op === 'set') target[key] = clone(operation.value);
        else assert.fail('unknown Settings operation');
      }
      // This is the fixture's only persistence seam. Adapter admission and HTTP
      // transport use the actual public implementations, including schema validation.
      if (namespace === 'llm-pi-ai') await replaceOuter(next);
      documents[namespace] = { revision: current.revision + 1, value: next };
      mutations.push({ namespace, operations: clone(operations) });
    },
  });
  ctx.provide('webServer', { register(descriptor) { handler = descriptor.handler; return () => { handler = undefined; }; } });
  ctx.provide('connection', { admit() { return { peer: { principal: { kind: 'owner' } } }; } });
  const run = async model => {
    const prepared = await main.prepareCall({ provider, model }, AbortSignal.timeout(10000));
    assert.equal(prepared.config.provider, provider);
    assert.equal(prepared.config.model, model);
    const chunks = await collect(prepared.stream({ ...prepared.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'loopback fixture only' }] }], signal: AbortSignal.timeout(10000) }));
    assert.equal(chunks.at(-1)?.reason.kind, 'stop', JSON.stringify(chunks.at(-1)));
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta'));
    return chunks;
  };
  try {
    await replaceOuter(documents['llm-pi-ai'].value);
    bridgeFiber = ctx.plugin({ name: 'model-groups-host-fixture', apply(child) {
      host = setupBridgeHost(child, { runtime: createBridgeRuntime(child, { loadModule, discoverEndpoint: discoverBridgeModels }) });
    } });
    await bridgeFiber; await host.ready;
    const initial = await requestBridge(handler, 'GET');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.value.providers[provider], { enabled: false, active: false, confirmed: false, keyEntries: {},
      singleKey: { apiKeyEnv: original.apiKeyEnv, models: original.models },
      shared: { displayName: '', api: original.api, baseURL: original.baseURL, headers: original.headers } });
    assert.equal(mutations.length, 0, 'first install and GET may not write either Settings namespace');
    assert.equal(credentialWrites.length, 0, 'grouping alone must not install a guard credential');
    assert.deepEqual((await main.listModels(provider)).map(model => model.id), ['legacy']);
    assert.deepEqual(main.listProviders().map(item => item.id), [provider]);
    const nativeRawPrepared = await main.prepareCall({ provider, model: 'legacy' }, AbortSignal.timeout(10000));
    const draft = { enabled: true, keyEntries: {
      a: { name: 'OpenAI entry', api: 'openai-completions', apiKeyEnv: 'TEST_A',
        models: [{ id: 'wire-a', contextWindow: 8192, maxTokens: 1024, input: ['text'] }] },
      b: { name: 'Anthropic entry', api: 'anthropic-messages', apiKeyEnv: 'TEST_B', baseURL: origin + '/anthropic/v1',
        headers: { 'x-entry': 'b' }, models: [{ id: 'wire-b', contextWindow: 8192, maxTokens: 1024, input: ['text'] }] },
    } };
    const emptyLegacyRoot = { ...clone(original), multiKey: true, keyEntries: clone(draft.keyEntries), models: [], apiKeyEnv: 'ABSENT_ROOT_CREDENTIAL' };
    const capabilities = await host.runtime.prepare('old-custom-without-root-models', draft, emptyLegacyRoot);
    assert.deepEqual(capabilities.models.legacy, []);
    assert.deepEqual(capabilities.models.keyEntries.a.map(model => model.id), ['wire-a']);
    assert.deepEqual(capabilities.models.keyEntries.b.map(model => model.id), ['wire-b']);
    await assert.rejects(() => host.runtime.prepare('old-custom-without-root-models', {
      enabled: true, keyEntries: { broken: { ...draft.keyEntries.a, apiKeyEnv: undefined } },
    }, emptyLegacyRoot), { code: 'MISSING_CREDENTIAL' }, 'the empty root exception must not bypass independent-entry validation');
    const admissionOnly = { api: 'openai-completions', baseURL: 'http://127.0.0.1:1/closed', apiKeyEnv: 'TEST_A',
      models: [{ id: '@dsh-key/a/wire-a', contextWindow: 8192, maxTokens: 1024 }] };
    if (fixture.pristine) assert.equal(await host.runtime.probeProjection(provider, admissionOnly, '@dsh-key/a/wire-a'), true);
    await assert.rejects(() => host.runtime.probeProjection(provider, admissionOnly, '@dsh-key/a/absent'), { code: 'BRIDGE_PROJECTION_UNSUPPORTED' });
    assert.equal(requests.length, 0, 'capability and admission probes must not perform provider HTTP requests');
    const saved = await requestBridge(handler, 'POST', { action: 'save', provider, draft, expectedRevision: initial.body.value.revision });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.value.providers[provider].confirmed, true);
    assert.equal(mutations.filter(item => item.namespace === 'llm-pi-ai').length, 1);
    assert.equal(credentialWrites.length, 1);
    assert.equal(credentialWrites[0].value, 'dsh-model-groups-local-routing-only');
    assert.notEqual(credentialWrites[0].value, secrets.get('TEST_ROOT'));
    assert.equal(documents['llm-pi-ai'].value.providers[provider].apiKeyEnv, credentialWrites[0].ref);
    assert.deepEqual(main.listProviders().map(item => item.id), [provider], 'no private execution provider may leak into the main registry');
    const admitted = await host.controller.executionSnapshot(provider);
    assert.equal(admitted.keyEntries.b.baseURL, origin + '/anthropic/v1', 'URL normalization belongs to execution, not the saved user configuration');
    const aliasA = routedAlias(admitted, 'a', 'wire-a'), aliasB = routedAlias(admitted, 'b', 'wire-b');
    const rootAlias = routedAlias(admitted, null, 'legacy');
    const listedIds = (await main.listModels(provider)).map(model => model.id);
    assert.deepEqual(listedIds.filter(id => id.startsWith('@dsh-key/')).sort(), [aliasA, aliasB, rootAlias].sort());
    const nativeRawExtras = listedIds.filter(id => !id.startsWith('@dsh-key/'));
    if (fixture.pristine) assert.deepEqual(nativeRawExtras, []);
    if (nativeRawExtras.length) {
      const rawPrepared = await main.prepareCall({ provider, model: nativeRawExtras[0] });
      const blocked = await collect(rawPrepared.stream({ ...rawPrepared.config, messages: [] }));
      assert.equal(blocked.at(-1).reason.failure.code, 'BRIDGE_CONFIG_CONFLICT');
      assert.equal(requests.length, 0, 'legacy catalog extras cannot bypass versioned routing or send the guard credential');
    }
    await run(aliasA);
    await run(aliasB);
    await run(rootAlias);
    assert.deepEqual(requests.map(request => request.model), ['wire-a', 'wire-b', 'legacy']);
    assert.deepEqual(requests.map(request => request.path), ['/v1/chat/completions', '/anthropic/v1/messages?beta=true', '/v1/chat/completions']);
    assert.equal(requests[0].authorization, 'Bearer dummy-key-a-only');
    assert.equal(requests[1].apiKey, 'dummy-key-b-only');
    assert.equal(requests[1].authorization, undefined);
    assert.equal(requests[1].custom, 'b');
    assert.equal(requests[2].authorization, 'Bearer dummy-root-only');
    assert.doesNotMatch(JSON.stringify(requests), /dsh-model-groups-local-routing-only|@dsh-key/);
    const oldRaw = await collect(nativeRawPrepared.stream({ ...nativeRawPrepared.config, messages: [] }));
    assert.equal(oldRaw.at(-1).reason.failure.code, 'BRIDGE_CONFIG_CONFLICT');
    assert.equal(requests.length, 3, 'an old raw preparation must not bypass the versioned compatibility selection');
    const found = await requestBridge(handler, 'POST', { action: 'discover', provider, entryId: 'b', draft: draft.keyEntries.b });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.deepEqual(found.body.value.models, [{ id: 'discovered-local-model' }]);
    assert.equal(requests.at(-1).path, '/anthropic/v1/models');
    assert.equal(requests.at(-1).apiKey, 'dummy-key-b-only');
    assert.equal(requests.at(-1).authorization, undefined);
    assert.equal(requests.at(-1).version, '2023-06-01');
    const preparedA = await main.prepareCall({ provider, model: aliasA }, AbortSignal.timeout(10000));
    const changedDraft = clone(draft);
    changedDraft.keyEntries.a.apiKeyEnv = 'TEST_B';
    changedDraft.keyEntries.a.models[0].contextWindow = 4096;
    changedDraft.keyEntries.a.models[0].maxTokens = 512;
    const changed = await requestBridge(handler, 'POST', { action: 'save', provider,
      draft: changedDraft, expectedRevision: saved.body.value.revision });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const afterChange = await host.controller.executionSnapshot(provider);
    const aliasA2 = routedAlias(afterChange, 'a', 'wire-a');
    assert.notEqual(aliasA2, aliasA, 'an execution-profile change must change the hidden routing identity');
    const beforeStale = requests.length;
    const stale = await collect(preparedA.stream({ ...preparedA.config, messages: [{ role: 'user', content: [] }] }));
    assert.equal(stale.length, 1);
    assert.equal(stale[0].reason.failure.code, 'BRIDGE_CONFIG_CONFLICT');
    assert.equal(requests.length, beforeStale, 'old prepared requests must fail before any upstream HTTP or new-key execution');
    await run(aliasA2);
    assert.equal(requests.at(-1).authorization, 'Bearer dummy-key-b-only');
    assert.equal(requests.at(-1).model, 'wire-a');
    const closed = await requestBridge(handler, 'POST', { action: 'save', provider,
      draft: { ...changedDraft, enabled: false }, expectedRevision: changed.body.value.revision });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.value.providers[provider].active, false);
    assert.deepEqual(documents['llm-pi-ai'].value.providers[provider], await host.runtime.normalizeProfile(provider, original));
    assert.equal(mutations.filter(item => item.namespace === 'llm-pi-ai').length, 3);
    assert.deepEqual((await main.listModels(provider)).map(model => model.id), ['legacy']);
    await assert.rejects(() => main.prepareCall({ provider, model: aliasA2 }), { code: 'UNKNOWN_MODEL' });
    await run('legacy');
    assert.equal(requests.at(-1).authorization, 'Bearer dummy-root-only');
    assert.deepEqual(main.listProviders().map(item => item.id), [provider]);
  } finally {
    await bridgeFiber?.dispose();
    await outer?.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  assert.deepEqual(await hashes(root), untouched, 'no host program may be edited by enabling or closing the bridge');
  assert.equal(digest(await readFile(sourceFile)), sourceHash, 'the public port fixture remains byte-for-byte unchanged');
});

for (const fixture of [{ name: 'unpatched public pi-ai', pristine: true }, { name: 'existing legacy-patched pi-ai', pristine: false }])
test(`entry-only legacy migration can close and reopen without a root credential (${fixture.name})`, async t => {
  const root = process.env.DSH_ROOT;
  const portRoot = fixture.pristine ? process.env.DSH_PORT_ROOT : root;
  if (!root || !portRoot) return t.skip('Set DSH_ROOT and DSH_PORT_ROOT for both real pi-ai configuration implementations');
  const untouched = await hashes(root);
  const { pi, loadModule, sourceFile, sourceHash } = await publicModules(root, portRoot, fixture.pristine);
  const [{ Context }, { LlmRuntime }] = await Promise.all([loadModule('@deepseek-ai/cordis'), loadModule('@deepseek-ai/dsh-llm')]);
  const ctx = new Context();
  const main = new LlmRuntime(ctx);
  const provider = 'entry-only-legacy-provider';
  const entry = { name: 'Only independent key', api: 'openai-completions', apiKeyEnv: 'ONLY_ENTRY_KEY', models: [{ id: 'wire-only', contextWindow: 8192, maxTokens: 1024 }] };
  const original = { api: 'openai-completions', baseURL: 'http://127.0.0.1:1/closed', models: [], multiKey: true, keyEntries: { only: clone(entry) } };
  const documents = {
    'llm-pi-ai': { revision: 0, value: { providers: { [provider]: clone(original) } } },
    'model-groups': { revision: 0, value: { bridge: { providers: {} } } },
  };
  const secrets = new Map([['ONLY_ENTRY_KEY', 'dummy-entry-only']]);
  const mutations = [];
  let outer, bridgeFiber, host;
  async function replaceOuter(value) {
    const config = pi.Config(value);
    await outer?.dispose();
    outer = ctx.plugin({ name: 'entry-only-native-fixture', apply(child) { pi.apply(child, config); } });
    await outer;
  }
  ctx.provide('credentials', {
    async resolve(ref) { const value = secrets.get(ref); return value === undefined ? undefined : { value }; },
    async describe(ref) { return { configured: secrets.has(ref) }; },
    async set(ref, value) { secrets.set(ref, value); }, async readRecord() {}, async listRecords() { return []; },
  });
  ctx.provide('settings', {
    configure() {},
    describe() { return Object.entries(documents).map(([ns, document]) => ({ ns, revision: document.revision, value: clone(document.value) })); },
    async mutate(namespace, operations, revision) {
      const before = documents[namespace];
      assert.equal(before.revision, revision, 'every write must retain the Settings revision check');
      const next = clone(before.value);
      for (const operation of operations) {
        let target = next;
        for (const key of operation.path.slice(0, -1)) target = target[key] ??= {};
        const key = operation.path.at(-1);
        if (operation.op === 'set') target[key] = clone(operation.value);
        else if (operation.op === 'unset') delete target[key];
        else assert.fail('unexpected Settings operation');
      }
      if (namespace === 'llm-pi-ai') await replaceOuter(next);
      documents[namespace] = { revision: before.revision + 1, value: next };
      mutations.push(namespace);
    },
  });
  ctx.provide('webServer', { register() { return () => {}; } });
  ctx.provide('connection', {});
  try {
    await replaceOuter(documents['llm-pi-ai'].value);
    bridgeFiber = ctx.plugin({ name: 'entry-only-bridge-fixture', apply(child) {
      host = setupBridgeHost(child, { runtime: createBridgeRuntime(child, { loadModule }) });
    } });
    await bridgeFiber; await host.ready;
    const migrated = await host.controller.snapshot();
    assert.equal(migrated.providers[provider].active, true, 'the original opted-in entry configuration must migrate automatically');
    assert.equal(migrated.providers[provider].confirmed, true);
    const migratedAlias = routedAlias(migrated.providers[provider], 'only', 'wire-only');
    assert.deepEqual((await main.listModels(provider)).map(model => model.id), [migratedAlias]);
    const draft = { enabled: true, keyEntries: { only: clone(entry) } };
    const closed = await host.controller.save(provider, { ...draft, enabled: false }, migrated.revision);
    const restored = documents['llm-pi-ai'].value.providers[provider];
    assert.equal(restored.multiKey, false);
    assert.equal(restored.apiKeyEnv, undefined, 'closing may not fabricate a root credential');
    assert.deepEqual(restored.models, []);
    assert.deepEqual(restored.keyEntries, (await host.runtime.normalizeProfile(provider, original)).keyEntries);
    const writesBeforeInvalid = mutations.length;
    await assert.rejects(() => host.controller.save(provider, {
      enabled: true, keyEntries: { only: { ...entry, apiKeyEnv: undefined } },
    }, closed.revision), { code: 'MISSING_CREDENTIAL' });
    assert.equal(mutations.length, writesBeforeInvalid, 'an invalid entry must still fail before either Settings namespace changes');
    const reopened = await host.controller.save(provider, draft, closed.revision);
    const final = await host.controller.snapshot();
    assert.equal(final.revision, reopened.revision);
    assert.equal(final.providers[provider].confirmed, true);
    assert.equal(final.providers[provider].active, true);
    const reopenedAlias = routedAlias(final.providers[provider], 'only', 'wire-only');
    assert.deepEqual((await main.listModels(provider)).map(model => model.id), [reopenedAlias]);
    const prepared = await main.prepareCall({ provider, model: reopenedAlias });
    assert.equal(prepared.config.model, reopenedAlias);
    assert.equal(prepared.config.provider, provider);
    await assert.rejects(() => host.runtime.prepare(provider, draft, { ...restored, api: 'invalid-native-protocol', models: [{ id: 'real-root-model' }] }),
      'a nonempty root model list cannot use the entry-only exception');
  } finally {
    await bridgeFiber?.dispose(); await outer?.dispose();
  }
  assert.deepEqual(await hashes(root), untouched);
  assert.equal(digest(await readFile(sourceFile)), sourceHash);
});
