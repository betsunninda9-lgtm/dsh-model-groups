import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { planPatches } from '../scripts/native-patches.mjs';
import { planNativeDowngrade } from '../src/native-downgrade.js';
import { createNativeValidation } from '../src/native-validation.js';
import { loadNativeHostResolvers } from '../src/native-host-resolver.js';

test('pristine host resolver accepts generated native profiles without reading credentials or changing installed files', async t => {
  if (!process.env.DSH_ROOT) { t.skip('Set DSH_ROOT to verify pristine host resolver in memory'); return; }
  const root = path.resolve(process.env.DSH_ROOT);
  const patch = planPatches(root, 'revert').find(item => item.name === 'pi-ai.patch.json');
  assert.ok(patch);
  const imports = [...patch.result.matchAll(/from "([^"\n]+)"/g)].map(match => match[1]).filter(specifier => !specifier.startsWith('node:'));
  const resolution = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e',
    'const [parent,specifiers]=process.argv.slice(1); console.log(JSON.stringify(JSON.parse(specifiers).map(s=>[s,import.meta.resolve(s,parent)])))',
    pathToFileURL(patch.file).href, JSON.stringify(imports)], { encoding: 'utf8' });
  assert.equal(resolution.status, 0, 'host ESM dependency resolution failed');
  const resolvedImports = new Map(JSON.parse(resolution.stdout));
  // Imports are resolved beside the original host, but its pristine source is
  // evaluated from an in-memory data URL; no installed file is ever overwritten.
  const source = patch.result.replace(/from "([^"\n]+)"/g, (match, specifier) => {
    if (specifier.startsWith('node:')) return match;
    return `from ${JSON.stringify(resolvedImports.get(specifier))}`;
  }) + '\nexport { resolveProfiles as testResolveProfiles };';
  const { testResolveProfiles } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const patchedText = planPatches(root, 'apply').find(item => item.name === 'pi-ai.patch.json').result;
  const patchedSource = patchedText.replace(/from "([^"\n]+)"/g, (match, specifier) => specifier.startsWith('node:') ? match : `from ${JSON.stringify(resolvedImports.get(specifier))}`)
    + '\nexport { resolveProfiles as testResolveProfiles };';
  const patched = await import(`data:text/javascript;base64,${Buffer.from(patchedSource).toString('base64')}`);
  const runtimeResolvers = await loadNativeHostResolvers(root);
  assert.equal(typeof runtimeResolvers.resolveNative, 'function');
  assert.equal(typeof runtimeResolvers.resolveLegacy, 'function');
  const models = [{ id: 'fixture-custom-model', name: 'Fixture', contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false }];
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const providers = { fixture: { displayName: 'Fixture group', api, baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE_ROOT', models, multiKey: true,
      keyEntries: { first: { name: 'Key one', apiKeyEnv: 'FIXTURE_ONE', models }, second: { name: 'Key two', apiKeyEnv: 'FIXTURE_TWO', models } } } };
    const planned = planNativeDowngrade(providers);
    const validate = createNativeValidation({ source: providers, plan: planned, resolveLegacy: patched.testResolveProfiles, resolveNative: testResolveProfiles });
    assert.equal(await validate(planned.providers), true);
    assert.equal(await createNativeValidation({ source: providers, plan: planned, ...runtimeResolvers })(planned.providers), true);
    const legacy = patched.testResolveProfiles(providers);
    const resolved = testResolveProfiles(planned.providers);
    assert.equal(resolved.size, 3);
    for (const route of planned.routes) {
      const child = resolved.get(route.target);
      assert.ok(child);
      assert.equal(child.catalogError, undefined);
      assert.equal(child.modelErrors.size, 0);
      assert.equal(child.apiKeyEnv, providers.fixture.keyEntries[route.entryId].apiKeyEnv);
      assert.ok(child.piProvider, 'custom native provider must resolve locally');
      const prior = legacy.get('fixture').keyEntries.get(route.entryId);
      const normalizedModels = profile => profile.piProvider.getModels().map(({ provider, ...model }) => model);
      assert.deepEqual(normalizedModels(child), normalizedModels(prior));
      for (const field of ['apiKeyEnv', 'api', 'baseURL', 'configuredMaxTokens', 'retryPolicy', 'streamIdleTimeoutMs', 'maxRequestImageBytes', 'maxRequestImages', 'imageOffloadCountQuantum', 'requestImagePixelBudget', 'requestImageMaxBytes']) {
        assert.deepEqual(child[field], prior[field], `native route must preserve ${field}`);
      }
    }
  }
  // Explicit protocol/core fields are not enough to preserve built-in catalog
  // costs and compatibility. Refuse such routes rather than silently degrading.
  const catalogModels = [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'], reasoningEfforts: false }];
  const catalogProviders = { openai: { api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE_ROOT', models: catalogModels, multiKey: true,
    keyEntries: { first: { name: 'Key one', apiKeyEnv: 'FIXTURE_ONE', models: catalogModels } } } };
  const catalogPlan = planNativeDowngrade(catalogProviders);
  const catalogValidation = createNativeValidation({ source: catalogProviders, plan: catalogPlan, resolveLegacy: patched.testResolveProfiles, resolveNative: testResolveProfiles });
  await assert.rejects(() => catalogValidation(catalogPlan.providers), /NATIVE_VALIDATION_SEMANTICS_CHANGED/);
});
