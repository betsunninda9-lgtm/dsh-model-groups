import { isDeepStrictEqual } from 'node:util';

const fail = code => { throw Object.assign(new Error(code), { code, stack: code }); };
const own = (value, name) => value !== null && typeof value === 'object' && Object.hasOwn(value, name);
// Only generated provider identity and its display label are allowed to differ.
// Cost, API defaults, compatibility flags and all model fields remain significant.
const modelIdentity = model => {
  const { provider, ...rest } = model;
  return rest;
};
const profileIdentity = profile => {
  const { provider, displayName, multiKey, keyEntries, keyEntryId, keyEntryName, piProvider, ...raw } = profile;
  const rest = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  if (!piProvider || typeof piProvider.getModels !== 'function' || profile.catalogError || (profile.modelErrors?.size ?? 0) > 0) fail('NATIVE_VALIDATION_UNRESOLVED');
  return { profile: rest, models: piProvider.getModels().map(modelIdentity) };
};

/** Pure semantic gate. Injected resolvers must only resolve configuration/catalog
 * metadata locally: no credential/environment resolution, model calls or writes.
 * Original resolver must be the pristine supported host, never its patched Config.
 * source is a detached legacy provider snapshot. This gate is not a migration.
 */
export function createNativeValidation({ source, plan, resolveLegacy, resolveNative } = {}) {
  if (!source || !plan?.providers || !Array.isArray(plan.routes) || typeof resolveLegacy !== 'function' || typeof resolveNative !== 'function') fail('NATIVE_VALIDATION_INVALID_ADAPTER');
  let expected, legacy;
  try {
    expected = structuredClone(plan);
    legacy = structuredClone(source);
  } catch { fail('NATIVE_VALIDATION_INVALID_ADAPTER'); }
  return async candidate => {
    if (!isDeepStrictEqual(candidate, expected.providers)) fail('NATIVE_VALIDATION_PLAN_CHANGED');
    const oldInput = structuredClone(legacy), newInput = structuredClone(candidate);
    let before, after;
    try {
      before = await resolveLegacy(oldInput);
      after = await resolveNative(newInput);
      if (!isDeepStrictEqual(oldInput, legacy) || !isDeepStrictEqual(newInput, candidate)) fail('NATIVE_VALIDATION_MUTATED');
      if (!(before instanceof Map) || !(after instanceof Map)) fail('NATIVE_VALIDATION_UNRESOLVED');
      const seen = new Set();
      for (const route of expected.routes) {
        if (!route || typeof route.target !== 'string' || seen.has(route.target)) fail('NATIVE_VALIDATION_INVALID_ROUTE');
        seen.add(route.target);
        const prior = before.get(route.provider)?.keyEntries?.get(route.entryId);
        const next = after.get(route.target);
        if (!prior || !next || !own(candidate, route.target)) fail('NATIVE_VALIDATION_UNRESOLVED');
        if (!isDeepStrictEqual(profileIdentity(prior), profileIdentity(next))) fail('NATIVE_VALIDATION_SEMANTICS_CHANGED');
      }
    } catch (error) {
      if (['NATIVE_VALIDATION_MUTATED', 'NATIVE_VALIDATION_UNRESOLVED', 'NATIVE_VALIDATION_INVALID_ROUTE', 'NATIVE_VALIDATION_SEMANTICS_CHANGED'].includes(error?.code)) throw error;
      fail('NATIVE_VALIDATION_FAILED');
    }
    return true;
  };
}
