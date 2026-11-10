import test from 'node:test';
import assert from 'node:assert/strict';
import { planNativeDowngrade, downgradeSelection } from '../src/native-downgrade.js';
const model = { id: 'chat/model', contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false };
const source = () => structuredClone({ vendor: { displayName: 'Vendor', api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'ROOT_KEY', models: [model], timeoutMs: 1234, multiKey: true, keyEntries: { first: { name: 'Same name', apiKeyEnv: 'FIRST_KEY', models: [model] }, second: { name: 'Same name', apiKeyEnv: 'SECOND_KEY', models: [model] } } } });
test('native downgrade preserves exact references, shared options, legacy route and stable distinct identities without writes', () => {
  const providers = source(), before = structuredClone(providers);
  const plan = planNativeDowngrade(providers);
  assert.deepEqual(providers, before);
  assert.deepEqual(plan, planNativeDowngrade(providers));
  assert.equal(Object.keys(plan.providers).length, 3);
  assert.notEqual(plan.routes[0].target, plan.routes[1].target);
  assert.equal(plan.providers.vendor.apiKeyEnv, 'ROOT_KEY');
  assert.equal(plan.providers.vendor.multiKey, undefined);
  assert.equal(plan.providers.vendor.keyEntries, undefined);
  for (const route of plan.routes) {
    assert.equal(plan.providers[route.target].apiKeyEnv, providers.vendor.keyEntries[route.entryId].apiKeyEnv);
    assert.equal(plan.providers[route.target].timeoutMs, 1234);
  }
  const selected = downgradeSelection({ provider: 'vendor', model: '@dsh-key/second/chat%2Fmodel', reasoningEffort: 'high' }, plan);
  assert.equal(selected.provider, plan.routes[1].target);
  assert.equal(selected.model, 'chat/model');
  assert.equal(selected.reasoningEffort, 'high');
  assert.deepEqual(downgradeSelection({ provider: 'vendor', model: 'chat/model' }, plan), { provider: 'vendor', model: 'chat/model' });
  assert.throws(() => downgradeSelection({ provider: 'foreign', model: '@dsh-key/second/chat%2Fmodel' }, plan), /UNKNOWN_ROUTE/);
});
test('unknown defaults, collision, disabled keys, duplicate models and dynamic config fail closed', () => {
  let value = source(); delete value.vendor.api;
  assert.throws(() => planNativeDowngrade(value), /CATALOG_DEFAULTS/);
  value = source(); delete value.vendor.keyEntries.first.models[0].reasoningEfforts;
  assert.throws(() => planNativeDowngrade(value), /MODEL_DEFAULTS/);
  value = source(); value.vendor.multiKey = false;
  assert.throws(() => planNativeDowngrade(value), /DISABLED_ENTRIES/);
  value = source(); value.vendor.keyEntries.first.models.push({ ...model });
  assert.throws(() => planNativeDowngrade(value), /INVALID_MODELS/);
  value = source(); const target = planNativeDowngrade(value).routes[0].target; value[target] = {};
  assert.throws(() => planNativeDowngrade(value), /COLLISION/);
  value = source(); value.vendor.api = 'bedrock-converse-stream';
  assert.throws(() => planNativeDowngrade(value), /CATALOG_DEFAULTS/);
  value = source(); value.vendor.headers = { Authorization: 'not-a-real-key' };
  assert.throws(() => planNativeDowngrade(value), /AUTH_HEADER_OVERRIDE/);
  value = source(); value.vendor.keyEntries.first.models[0].headers = {};
  assert.throws(() => planNativeDowngrade(value), /UNREPRESENTABLE_MODEL/);
  value = source(); value.vendor.baseURL = { __jsExpr: 'not executed' };
  assert.throws(() => planNativeDowngrade(value), /UNSUPPORTED_CONFIG/);
});
