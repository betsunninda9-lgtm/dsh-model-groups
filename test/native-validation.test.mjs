import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeValidation } from '../src/native-validation.js';
const fixture = (change = () => {}) => {
  const source = { old: {} }, plan = { providers: { old: {}, child: {} }, routes: [{ provider: 'old', entryId: 'one', target: 'child' }] };
  const profile = provider => ({ provider, displayName: provider, apiKeyEnv: 'REFERENCE_ONLY', configuredMaxTokens: new Map([['model', 4096]]), piProvider: { getModels: () => [{ id: 'model', provider, cost: { input: 0 }, contextWindow: 64000, compat: { supportsStore: false } }] } });
  return { plan, validate: createNativeValidation({ source, plan,
    resolveLegacy: () => new Map([['old', { keyEntries: new Map([['one', profile('old')]]) }]]),
    resolveNative: () => { const value = profile('child'); change(value); return new Map([['child', value]]); },
  }) };
};
test('semantic validation permits only route/display identity differences', async () => {
  const { validate, plan } = fixture();
  assert.equal(await validate(plan.providers), true);
  await assert.rejects(() => validate({ child: {} }), /PLAN_CHANGED/);
});
test('credential reference, costs, compatibility and output caps remain semantic blockers', async () => {
  for (const change of [p => { p.apiKeyEnv = 'OTHER_REFERENCE'; }, p => { p.configuredMaxTokens.set('model', 2000); },
    p => { const get = p.piProvider.getModels; p.piProvider.getModels = () => get().map(m => ({ ...m, cost: { input: 1 } })); },
    p => { const get = p.piProvider.getModels; p.piProvider.getModels = () => get().map(m => ({ ...m, compat: { supportsStore: true } })); }]) {
    const { validate, plan } = fixture(change);
    await assert.rejects(() => validate(plan.providers), /SEMANTICS_CHANGED/);
  }
});
test('resolver failures expose no arbitrary messages or private paths', async () => {
  const plan = { providers: {}, routes: [] };
  const validate = createNativeValidation({ source: {}, plan, resolveLegacy: () => { throw new Error('/private/secret'); }, resolveNative: () => new Map() });
  await assert.rejects(() => validate({}), error => error.code === 'NATIVE_VALIDATION_FAILED' && !String(error.stack).includes('private'));
});
