import test from 'node:test';
import assert from 'node:assert/strict';
import { planNativeDowngrade, downgradeSelection } from '../src/native-downgrade.js';
import { buildNativeHierarchy } from '../src/native-groups.js';
import { visibleHierarchyModels } from '../src/hierarchy.js';

test('native plan metadata groups exact native routes while removing the display layer leaves all native choices intact', () => {
  const model = { id: 'same-model', name: 'Same model', contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false };
  const original = { 'vendor.with.long-id': { displayName: 'Shared endpoint', api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'ROOT', models: [model], multiKey: true, keyEntries: {
    a: { name: 'First', apiKeyEnv: 'KEY_A', models: [model] }, b: { name: 'Second', apiKeyEnv: 'KEY_B', models: [model] },
  } } };
  const plan = planNativeDowngrade(original);
  const directory = Object.entries(plan.providers).map(([id, profile]) => ({ id, provider: { name: profile.displayName }, models: structuredClone(profile.models) }));
  const grouped = buildNativeHierarchy(directory, plan.metadata);
  const root = grouped.find(item => item.kind === 'multi');
  assert.equal(root.name, 'Shared endpoint');
  assert.deepEqual(root.children.map(child => child.name), ['First', 'Second']);
  const preferences = Object.fromEntries([root.key, ...root.children.map(child => child.key)].map(key => [key, true]));
  const routes = visibleHierarchyModels(buildNativeHierarchy(directory, plan.metadata, preferences));
  assert.deepEqual(routes, plan.routes.map(route => ({ provider: route.target, model: 'same-model' })));
  const selected = downgradeSelection({ provider: 'vendor.with.long-id', model: '@dsh-key/b/same-model' }, plan);
  // Simulated stock selector has only the native directory: no plugin functions or aliases required.
  assert.ok(directory.find(group => group.id === selected.provider)?.models.some(model => model.id === selected.model));
  assert.equal(directory.length, 3);
  assert.equal(JSON.stringify(plan.metadata).includes('KEY_A'), false);
  assert.equal(JSON.stringify(plan.metadata).includes('apiKeyEnv'), false);
  assert.equal(JSON.stringify(plan.metadata).includes('https://'), false);
  assert.equal(directory.every(group => group.models.every(model => !model.id.startsWith('@dsh-key/'))), true);
  assert.deepEqual(buildNativeHierarchy(directory, {}).map(item => item.group), directory);
});
