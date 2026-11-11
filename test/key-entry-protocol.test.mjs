import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sha256, transformSource } from '../scripts/native-patches.mjs';
import { buildProtocolArtifact, protocolReplacements } from '../scripts/pi-ai-protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'native/pi-ai.patch.json'), 'utf8'));
const previous = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/pi-ai/v0.3.5.json'), 'utf8'));
const revisions = value => [value, ...(value.variants ?? []).map(variant => ({ ...value, ...variant, current: variant.current === true }))];
const current = revisions(artifact).filter(revision => revision.current === true);

// These are real host bundles, never hand-written replacement implementations.
// Optional extra pristine/legacy sources let release verification cover every base.
const dshRoot = process.env.DSH_ROOT ?? '/opt/dsh';
const hostSourcePath = path.join(dshRoot, artifact.target);
const candidates = new Set((process.env.PI_AI_SOURCES ?? '').split(path.delimiter).filter(Boolean));
if (fs.existsSync(hostSourcePath)) candidates.add(hostSourcePath);
const backups = path.join(root, 'native/backups');
if (fs.existsSync(backups)) for (const name of fs.readdirSync(backups)) {
  if (/^dsh-llm-pi-ai-index\.js-[0-9a-f]{64}\.js$/.test(name)) candidates.add(path.join(backups, name));
}
const bases = new Map();
for (const file of candidates) {
  const source = fs.readFileSync(file, 'utf8');
  const hash = sha256(source);
  const revision = revisions(artifact).find(value => value.resultSha256 === hash) ?? revisions(artifact).find(value => value.baseSha256 === hash);
  assert.ok(revision, `Unrecognized explicitly supplied pi-ai source: ${file}`);
  const pristine = hash === revision.baseSha256 ? source : transformSource(source, revision, true);
  assert.equal(sha256(pristine), revision.baseSha256);
  bases.set(revision.baseSha256, pristine);
}
const dependencyPath = path.join(dshRoot, 'package.json');
const require = fs.existsSync(dependencyPath) ? createRequire(dependencyPath) : undefined;

function runtime(source) {
  const requests = [];
  const probes = [];
  const model = { id: 'catalog-model', name: 'Catalog model', api: 'openai-completions', provider: 'catalog-route', baseUrl: 'https://catalog.invalid/v1', input: ['text'], contextWindow: 4096, maxTokens: 512, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const usage = { input: 11, output: 7, cacheRead: 5, cacheWrite: 3, totalTokens: 26, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const implementation = api => ({
    async *streamSimple(selected, context, options) {
      requests.push({ api, model: selected, context, options });
      yield { type: 'done', message: { role: 'assistant', api, provider: selected.provider, model: selected.id, content: [{ type: 'text', text: 'test output' }], usage, stopReason: 'stop', timestamp: 0 } };
    },
    stream() { throw new Error('Unexpected non-simple stream'); },
  });
  const catalog = { id: 'catalog-route', name: 'Catalog route', baseUrl: model.baseUrl, auth: { apiKey: {} }, getModels: () => [model], ...implementation(model.api) };
  const deps = {};
  for (const line of source.match(/^import .*;$/gm) ?? []) {
    const named = /^import \{ (.+) \} from "([^"]+)";$/.exec(line);
    if (named && !named[2].startsWith('@earendil-works/')) {
      const module = require(named[2]);
      for (const name of named[1].split(', ')) deps[name] = module[name];
    }
  }
  const schema = require('@deepseek-ai/schemastery');
  Object.assign(deps, {
    z: schema.default ?? schema,
    builtinProviders: () => [catalog],
    getBuiltinModels: provider => provider === catalog.id ? [model] : [],
    getAllBuiltinModels: provider => provider === catalog.id ? [model] : [],
    builtinModels: () => {
      const providers = new Map();
      return {
        clearProviders: () => providers.clear(),
        setProvider: provider => providers.set(provider.id, provider),
        getModels: provider => providers.get(provider)?.getModels() ?? [],
        getModel: (provider, id) => providers.get(provider)?.getModels().find(value => value.id === id),
        streamSimple: (selected, context, options) => providers.get(selected.provider).streamSimple(selected, context, options),
      };
    },
    openAICompletionsApi: () => implementation('openai-completions'),
    openAIResponsesApi: () => implementation('openai-responses'),
    anthropicMessagesApi: () => implementation('anthropic-messages'),
    isContextOverflow: () => false,
    fetch: async (url, options) => {
      probes.push({ url, options });
      return new Response(JSON.stringify({ data: [{ id: 'probe-model', display_name: 'From endpoint', context_window: 8192 }] }), { headers: { 'content-type': 'application/json' } });
    },
  });
  const body = source.replace(/^import .*;\n/gm, '').replace(/^export \{[^\n]+\};?\s*$/m, '');
  const module = new Function(...Object.keys(deps), `${body}\nreturn { Config, keyEntryProfile, PiAiAdapter, resolveProfiles, supportedProtocols, discoverModels, registrationFacts, keyModelId, catalogProvider, validKeyEntryId, LlmError };`)(...Object.values(deps));
  const start = source.indexOf('const storedDiscoveryProfile =');
  const end = source.indexOf('\n\tctx.llm.registerModelDiscovery', start);
  assert.ok(start > 0 && end > start);
  module.storedDiscoveryProfile = (profiles, resolveApiKey) => new Function('profiles', 'resolveApiKey', 'catalogProvider', 'validKeyEntryId', 'LlmError', `${source.slice(start, end)}\nreturn storedDiscoveryProfile;`)(() => profiles, resolveApiKey, module.catalogProvider, module.validKeyEntryId, module.LlmError);
  return { ...module, requests, probes };
}

function config(extra = {}) {
  return { gateway: { api: 'openai-completions', baseURL: 'https://gateway.invalid/v1', apiKeyEnv: 'ROOT_API_KEY', models: [{ id: 'shared-wire-model' }], multiKey: true, keyEntries: {
    inherited: { name: 'Inherited', apiKeyEnv: 'INHERITED_API_KEY', models: [{ id: 'shared-wire-model' }] },
    overridden: { name: 'Messages', apiKeyEnv: 'OVERRIDE_API_KEY', api: 'anthropic-messages', models: [{ id: 'shared-wire-model' }] },
    responses: { name: 'Responses', apiKeyEnv: 'RESPONSES_API_KEY', api: 'openai-responses', models: [{ id: 'neutral-model-name' }] },
  }, ...extra } };
}

function schemaProviders(module, providers) {
  const checked = module.Config({ providers: structuredClone(providers) });
  return checked.providers.get();
}

async function chunks(iterator) {
  const values = [];
  for await (const value of iterator) values.push(value);
  return values;
}

// Always runs, including a checkout without any host installation.
test('every released pi-ai revision keeps its exact hashes and original reversible literals', () => {
  assert.equal(artifact.requiresCurrent, true);
  const all = revisions(artifact);
  for (const old of revisions(previous)) {
    const retained = all.find(value => value.resultSha256 === old.resultSha256);
    assert.ok(retained, old.resultSha256);
    assert.equal(retained.baseSha256, old.baseSha256);
    assert.deepEqual(retained.replacements, old.replacements);
    assert.notEqual(retained.current, true);
  }
  assert.equal(new Set(current.map(value => value.baseSha256)).size, current.length);
  assert.equal(current.length, 2, 'only two bases have verified source bytes; no fabricated third hash');
  for (const revision of current) assert.deepEqual(revision.replacements.slice(-protocolReplacements().length), protocolReplacements());
});

test('protocol generator fails closed for unknown sources', () => {
  assert.throws(() => buildProtocolArtifact(previous, ['not the real host']), /Unrecognized pi-ai source/);
});

test('real host protocol tests are configured', { skip: bases.size > 0 && require ? false : 'Set DSH_ROOT and PI_AI_SOURCES to real known host bundles; no network download is performed' }, () => {
  assert.ok(bases.size > 0);
});

for (const revision of current) {
  const pristine = bases.get(revision.baseSha256);
  test(`real pi-ai ${revision.baseSha256.slice(0, 12)}: roundtrip, legacy upgrade, generator reproducibility`, { skip: !pristine && 'Supply this pristine/patched bundle via PI_AI_SOURCES' }, () => {
    const source = transformSource(pristine, revision);
    assert.equal(sha256(source), revision.resultSha256);
    assert.equal(transformSource(source, revision, true), pristine);
    for (const legacy of revisions(artifact).filter(value => value.current !== true && value.baseSha256 === revision.baseSha256)) {
      const old = transformSource(pristine, legacy);
      assert.equal(sha256(old), legacy.resultSha256);
      assert.equal(transformSource(transformSource(old, legacy, true), revision), source);
    }
    assert.throws(() => transformSource(`${source}\n`, revision, true), /hash mismatch/);
    const known = [bases.get(previous.baseSha256), pristine].filter(Boolean);
    const built = buildProtocolArtifact(previous, known);
    assert.equal(revisions(built).find(value => value.current && value.baseSha256 === revision.baseSha256)?.resultSha256, revision.resultSha256);
    const regenerated = buildProtocolArtifact(artifact, known);
    assert.equal(revisions(regenerated).filter(value => value.current && value.baseSha256 === revision.baseSha256).length, 1);
  });

  const enabled = pristine && require;
  test(`real pi-ai ${revision.baseSha256.slice(0, 12)}: actual optional schema and strict/deferred fail-closed resolver`, { skip: !enabled }, () => {
    const module = runtime(transformSource(pristine, revision));
    const inputs = config();
    const checked = schemaProviders(module, inputs);
    assert.equal(checked.gateway.keyEntries.inherited.api, undefined);
    assert.equal(checked.gateway.keyEntries.overridden.api, 'anthropic-messages');
    assert.equal(module.keyEntryProfile.dict.api.meta.required, undefined);
    assert.deepEqual(module.keyEntryProfile.dict.api.list.map(value => value.value), module.supportedProtocols());
    for (const api of module.supportedProtocols()) assert.equal(module.keyEntryProfile({ ...inputs.gateway.keyEntries.inherited, api }).api, api);
    for (const api of ['', 'claude', 'constructor', 'azure-openai-responses', 1, {}, []]) {
      const invalid = config();
      invalid.gateway.keyEntries.overridden.api = api;
      assert.throws(() => schemaProviders(module, invalid), /expected/);
    }
    // Schemastery accepts null for optional values; the real resolver must still
    // reject it (also when multiKey is disabled or catalog errors are deferred).
    for (const api of [null, '', 'claude', 'constructor', 'azure-openai-responses', 1, {}, []]) for (const validation of ['strict', 'deferred']) for (const multiKey of [true, false]) {
      const invalid = config({ multiKey });
      invalid.gateway.keyEntries.overridden.api = api;
      assert.throws(() => module.resolveProfiles(invalid, validation), /api must be a supported protocol/);
    }
    for (const api of [undefined, ...module.supportedProtocols()]) {
      const valid = config();
      if (api === undefined) delete valid.gateway.keyEntries.overridden.api;
      else valid.gateway.keyEntries.overridden.api = api;
      const root = module.resolveProfiles(schemaProviders(module, valid)).get('gateway');
      assert.equal(root.api, 'openai-completions');
      assert.equal(root.keyEntries.get('overridden').api, api ?? root.api);
      assert.equal(root.keyEntries.get('overridden').piProvider.getModels()[0].api, api ?? root.api);
      assert.equal(root.keyEntries.get('inherited').api, root.api);
    }
  });

  test(`real pi-ai ${revision.baseSha256.slice(0, 12)}: actual adapter dispatch and usage retain exact owner/protocol`, { skip: !enabled }, async () => {
    const module = runtime(transformSource(pristine, revision));
    let profiles = module.resolveProfiles(schemaProviders(module, config()));
    const keyReads = [];
    const adapter = new module.PiAiAdapter({ profiles: () => profiles, resolveApiKey: async (provider, owner) => { keyReads.push({ provider, id: owner.keyEntryId }); return `fake-test-${owner.keyEntryId ?? 'root'}`; } });
    const options = { provider: 'gateway', messages: [{ role: 'user', content: [{ type: 'text', text: 'offline test' }] }] };
    const listed = await adapter.listModels('gateway');
    assert.ok(listed.some(value => value.id === 'shared-wire-model'), 'old root model remains usable');
    for (const [id, api, wireModel] of [[undefined, 'openai-completions', 'shared-wire-model'], ['inherited', 'openai-completions', 'shared-wire-model'], ['overridden', 'anthropic-messages', 'shared-wire-model'], ['responses', 'openai-responses', 'neutral-model-name']]) {
      const selected = id === undefined ? wireModel : module.keyModelId(id, wireModel);
      const result = await chunks(adapter.stream({ ...options, model: selected }));
      const dispatched = module.requests.at(-1);
      assert.equal(dispatched.api, api);
      assert.equal(dispatched.model.api, api);
      assert.equal(dispatched.model.id, wireModel, 'encoded public selection never reaches the endpoint');
      assert.equal(dispatched.options.apiKey, `fake-test-${id ?? 'root'}`);
      assert.deepEqual(result.find(value => value.type === 'usage').usage, { inputTokens: 11, outputTokens: 7, totalTokens: 26, cacheReadTokens: 5, cacheWriteTokens: 3 });
      const finish = result.find(value => value.type === 'finish');
      assert.equal(finish.replayState.response.api, api);
      assert.equal(finish.replayState.response.model, selected);
      assert.equal(keyReads.at(-1).id, id);
    }
    // A prepared step keeps its selected API while later calls see edits.
    const selected = module.keyModelId('overridden', 'shared-wire-model');
    const prepared = await adapter.prepareCall('gateway', selected);
    const changed = config();
    changed.gateway.keyEntries.overridden.api = 'openai-responses';
    profiles = module.resolveProfiles(schemaProviders(module, changed));
    await chunks(prepared.stream({ ...options, model: selected }));
    assert.equal(module.requests.at(-1).api, 'anthropic-messages');
    await chunks(adapter.stream({ ...options, model: selected }));
    assert.equal(module.requests.at(-1).api, 'openai-responses');
  });

  test(`real pi-ai ${revision.baseSha256.slice(0, 12)}: absent override preserves catalog and disabled legacy behavior`, { skip: !enabled }, async () => {
    const module = runtime(transformSource(pristine, revision));
    const providers = { 'catalog-route': { multiKey: true, models: [], keyEntries: { one: { name: 'No override', apiKeyEnv: 'ENTRY_API_KEY', models: [{ id: 'catalog-model' }] }, two: { name: 'Explicit', apiKeyEnv: 'SECOND_API_KEY', api: 'anthropic-messages', models: [{ id: 'catalog-model' }] } } } };
    const profiles = module.resolveProfiles(schemaProviders(module, providers));
    const entry = profiles.get('catalog-route').keyEntries.get('one');
    assert.equal(entry.api, undefined);
    assert.equal(entry.piProvider.getModels()[0].api, 'openai-completions');
    assert.equal(profiles.get('catalog-route').keyEntries.get('two').piProvider.getModels()[0].api, 'anthropic-messages');
    const disabled = config({ multiKey: false });
    const resolved = module.resolveProfiles(schemaProviders(module, disabled)).get('gateway');
    assert.equal(resolved.keyEntries.size, 0);
    assert.equal(resolved.piProvider.getModels()[0].api, 'openai-completions');
    const stored = module.storedDiscoveryProfile(profiles, async () => 'fake-probe-key');
    assert.equal(stored('catalog-route', 'one').api, undefined);
    const catalog = await module.discoverModels({ provider: 'catalog-route', keyEntryId: 'one' }, () => stored('catalog-route', 'one'));
    assert.equal(catalog[0].id, 'catalog-model');
    assert.equal(module.probes.length, 0);
  });

  test(`real pi-ai ${revision.baseSha256.slice(0, 12)}: endpoint discovery uses inherited/explicit/draft API and native auth`, { skip: !enabled }, async () => {
    const module = runtime(transformSource(pristine, revision));
    const profiles = module.resolveProfiles(schemaProviders(module, config()));
    const stored = module.storedDiscoveryProfile(profiles, async (_provider, owner) => `fake-probe-${owner.keyEntryId}`);
    assert.equal(stored('gateway', 'inherited').api, 'openai-completions');
    assert.equal(stored('gateway', 'overridden').api, 'anthropic-messages');
    assert.equal(stored('gateway', 'overridden').baseURL, 'https://gateway.invalid/v1');
    for (const [id, api] of [['inherited', 'openai-completions'], ['overridden', 'anthropic-messages'], ['responses', 'openai-responses']]) {
      const result = await module.discoverModels({ provider: 'gateway', keyEntryId: id }, () => stored('gateway', id));
      assert.equal(result[0].id, 'probe-model');
      const probe = module.probes.at(-1);
      assert.equal(probe.url, api === 'anthropic-messages' ? 'https://gateway.invalid/v1/models?limit=1000' : 'https://gateway.invalid/v1/models');
      assert.equal(probe.options.headers.get(api === 'anthropic-messages' ? 'x-api-key' : 'authorization'), api === 'anthropic-messages' ? `fake-probe-${id}` : `Bearer fake-probe-${id}`);
      assert.equal(probe.options.headers.get('anthropic-version'), api === 'anthropic-messages' ? '2023-06-01' : null);
    }
    await module.discoverModels({ provider: 'gateway', keyEntryId: 'overridden', api: 'openai-responses', baseURL: 'https://draft.invalid/proxy', apiKey: 'fake-draft-key' }, () => stored('gateway', 'overridden'));
    assert.equal(module.probes.at(-1).url, 'https://draft.invalid/proxy/models');
    assert.equal(module.probes.at(-1).options.headers.get('authorization'), 'Bearer fake-draft-key');
    // Installed catalog must not silently defeat a key-entry override.
    const catalogProfiles = module.resolveProfiles(schemaProviders(module, { 'catalog-route': { models: [], multiKey: true, keyEntries: { one: { name: 'Messages', apiKeyEnv: 'ENTRY_API_KEY', api: 'anthropic-messages', models: [{ id: 'catalog-model' }] } } } }));
    const catalogStored = module.storedDiscoveryProfile(catalogProfiles, async () => 'fake-catalog-key');
    await module.discoverModels({ provider: 'catalog-route', keyEntryId: 'one' }, () => catalogStored('catalog-route', 'one'));
    assert.equal(module.probes.at(-1).url, 'https://catalog.invalid/v1/models?limit=1000');
    const count = module.probes.length;
    for (const api of [null, '', 'claude', 'constructor', 'unsupported-api', 1, {}]) {
      await assert.rejects(module.discoverModels({ provider: 'catalog-route', keyEntryId: 'one', api }, () => catalogStored('catalog-route', 'one')), error => error.code === 'INVALID_CONFIG');
      await assert.rejects(module.discoverModels({ provider: 'catalog-route', api }), error => error.code === 'INVALID_CONFIG');
    }
    await assert.rejects(module.discoverModels({ provider: 'catalog-route', keyEntryId: 'missing', api: 'anthropic-messages' }, () => catalogStored('catalog-route', 'missing')), error => error.code === 'INVALID_CONFIG');
    assert.equal(module.probes.length, count, 'invalid protocol/entry never issues an endpoint call');
  });

  test(`real pi-ai ${revision.baseSha256.slice(0, 12)}: empty entry API edits invalidate registration facts`, { skip: !enabled }, () => {
    const module = runtime(transformSource(pristine, revision));
    const before = config();
    before.gateway.keyEntries.overridden.models = [];
    const after = structuredClone(before);
    after.gateway.keyEntries.overridden.api = 'openai-responses';
    const beforeFacts = module.registrationFacts(module.resolveProfiles(schemaProviders(module, before)));
    const afterFacts = module.registrationFacts(module.resolveProfiles(schemaProviders(module, after)));
    assert.notDeepEqual(beforeFacts, afterFacts);
    assert.equal(beforeFacts[0].keyEntries.find(value => value.id === 'overridden').api, 'anthropic-messages');
  });
}
