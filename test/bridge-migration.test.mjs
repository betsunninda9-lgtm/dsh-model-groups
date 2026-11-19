import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { extractLegacyBridgeDraft } from '../src/bridge/migration.js';
import { validateBridgeDraft } from '../src/bridge/profile.js';

const profile = () => ({
  multiKey: true, api: 'anthropic-messages', baseURL: 'https://root.invalid', apiKeyEnv: 'ROOT_KEY',
  models: [], keyEntries: {
    inherited: { name: 'Inherit root', apiKeyEnv: 'INHERITED_KEY', sortOrder: 4,
      headers: { 'X-Tenant': 'tenant-a' }, capabilityDefaults: { vision: true, reasoning: false }, capabilityBatch: { vision: true },
      models: [{ id: 'model/a', name: 'A', contextWindow: 12000, maxTokens: 2048, input: ['text', 'image'],
        reasoningEfforts: false, capabilityOverrides: { vision: 'original' }, compat: { supportsTemperature: false } }] },
    explicit: { name: 'Explicit', api: 'openai-responses', baseURL: 'https://entry.invalid/v1', apiKeyEnv: 'EXPLICIT_KEY',
      models: [{ id: 'model-b' }] },
  },
});

test('extracts existing identities and all declared entry settings without materializing root inheritance', () => {
  const original = profile(), before = structuredClone(original);
  const draft = extractLegacyBridgeDraft(original);
  assert.deepEqual(draft, { enabled: true, keyEntries: original.keyEntries });
  const admitted = validateBridgeDraft(draft);
  assert.deepEqual(admitted.keyEntries.inherited.models[0], {
    id: 'model/a', name: 'A', contextWindow: 12000, maxTokens: 2048,
    input: ['text', 'image'], reasoningEfforts: false, compat: { supportsTemperature: false },
  }, 'effective legacy capabilities are explicit before adapter admission');
  assert.deepEqual(admitted.keyEntries.inherited.capabilityBatch, { vision: true, reasoning: false });
  assert.equal(Object.hasOwn(admitted.keyEntries.inherited, 'capabilityDefaults'), false);
  assert.deepEqual(admitted.keyEntries.explicit, draft.keyEntries.explicit);
  assert.deepEqual(validateBridgeDraft(admitted), admitted, 'materialization is idempotent');
  assert.equal(Object.hasOwn(draft.keyEntries.inherited, 'api'), false);
  assert.equal(Object.hasOwn(draft.keyEntries.inherited, 'baseURL'), false);
  assert.equal(draft.keyEntries.explicit.api, 'openai-responses');
  assert.equal(draft.keyEntries.explicit.baseURL, 'https://entry.invalid/v1');
  draft.keyEntries.inherited.models[0].name = 'Independent draft';
  draft.keyEntries.inherited.headers['X-Tenant'] = 'changed';
  assert.deepEqual(original, before, 'the exact original remains available for restoration');
  for (const field of ['active', 'confirmed', 'projection', 'original', 'revision']) assert.equal(field in draft, false);
});

test('retains disabled groups for review and never silently enables them', () => {
  const original = profile(); original.multiKey = false;
  assert.equal(extractLegacyBridgeDraft(original).enabled, false);
  delete original.multiKey;
  assert.equal(extractLegacyBridgeDraft(original).enabled, false);
});

test('absence and empty legacy dictionaries do not create a migration draft', () => {
  for (const input of [undefined, null, [], {}, { multiKey: true }, { keyEntries: {} }, { keyEntries: [] },
    { keyEntries: null }, Object.create({ keyEntries: profile().keyEntries })]) assert.equal(extractLegacyBridgeDraft(input), undefined);
});

test('keeps reviewable invalid values for normal save validation without exposing raw entry secrets', () => {
  const original = profile();
  original.keyEntries.inherited.api = 'future-protocol';
  original.keyEntries.inherited.apiKey = 'synthetic-secret';
  original.keyEntries.inherited.password = 'synthetic-secret';
  original.keyEntries.inherited.projection = { internal: true };
  const draft = extractLegacyBridgeDraft(original);
  assert.equal(draft.keyEntries.inherited.api, 'future-protocol');
  assert.throws(() => validateBridgeDraft(draft), /INVALID_PROTOCOL/);
  assert.doesNotMatch(JSON.stringify(draft), /synthetic-secret|projection/);
});

test('unsafe dictionary names and nested prototype keys cannot alter output prototypes', () => {
  const input = JSON.parse('{"multiKey":true,"keyEntries":{"__proto__":{"name":"bad"},"constructor":{"name":"bad"},"prototype":{"name":"bad"},"safe":{"name":"Safe","apiKeyEnv":"SAFE_KEY","models":[{"id":"model","compat":{"__proto__":{"polluted":true},"supportsTemperature":false}}]}}}');
  const draft = extractLegacyBridgeDraft(input);
  assert.deepEqual(Object.keys(draft.keyEntries), ['safe']);
  assert.equal(Object.getPrototypeOf(draft.keyEntries), Object.prototype);
  assert.deepEqual(draft.keyEntries.safe.models[0].compat, { supportsTemperature: false });
  assert.equal({}.polluted, undefined);
});

function actualConfig(root, dependencyRoot = root) {
  const require = createRequire(join(dependencyRoot, 'package.json'));
  const source = readFileSync(join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8');
  const dependencies = {};
  for (const line of source.match(/^import .*;$/gm) ?? []) {
    const named = /^import \{ (.+) \} from "([^"]+)";$/.exec(line);
    if (named && !named[2].startsWith('@earendil-works/')) {
      const imported = require(named[2]);
      for (const name of named[1].split(', ')) dependencies[name] = imported[name];
    }
  }
  const schema = require('@deepseek-ai/schemastery');
  Object.assign(dependencies, {
    z: schema.default ?? schema,
    builtinProviders: () => [], getBuiltinModels: () => [], getAllBuiltinModels: () => [],
    builtinModels: () => ({ getModels: () => [], getModel: () => undefined }),
    openAICompletionsApi: () => ({ api: 'openai-completions' }),
    openAIResponsesApi: () => ({ api: 'openai-responses' }),
    anthropicMessagesApi: () => ({ api: 'anthropic-messages' }),
    isContextOverflow: () => false,
    fetch: () => { throw new Error('NETWORK_FORBIDDEN_IN_MIGRATION_TEST'); },
  });
  const body = source.replace(/^import .*;\n/gm, '').replace(/^export \{[^\n]+\};?\s*$/m, '');
  return new Function(...Object.keys(dependencies), `${body}\nreturn Config;`)(...Object.values(dependencies));
}

for (const [label, root, dependencyRoot] of [
  ['installed', process.env.DSH_ROOT, process.env.DSH_ROOT],
  ['unmodified port', process.env.DSH_PORT_ROOT, process.env.DSH_ROOT ?? process.env.DSH_PORT_ROOT],
]) test(`actual ${label} native Config retains legacy data through ordinary and standard-schema parsing`, { skip: !root }, async () => {
  const Config = actualConfig(root, dependencyRoot);
  const original = { providers: { synthetic: profile() } }, before = structuredClone(original);
  const parsed = Config(structuredClone(original)).providers.get().synthetic;
  const standard = await Config['~standard'].validate(structuredClone(original));
  assert.equal(standard.issues, undefined);
  const standardProfile = standard.value.providers.get().synthetic;
  assert.deepEqual(extractLegacyBridgeDraft(standardProfile), extractLegacyBridgeDraft(parsed));
  const draft = extractLegacyBridgeDraft(parsed);
  assert.equal(draft.keyEntries.inherited.name, 'Inherit root');
  assert.equal(draft.keyEntries.inherited.apiKeyEnv, 'INHERITED_KEY');
  assert.equal(draft.keyEntries.inherited.headers['X-Tenant'], 'tenant-a');
  assert.equal(Object.hasOwn(draft.keyEntries.inherited, 'api'), false);
  assert.equal(Object.hasOwn(draft.keyEntries.inherited, 'baseURL'), false);
  assert.deepEqual(original, before);
});
