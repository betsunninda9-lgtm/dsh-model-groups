import { isDeepStrictEqual } from 'node:util';
import { createNativeSave, planNativeSave } from './native-save.js';
import { createNativeMetadataSave } from './native-metadata-save.js';
import { createNativeGroupSave } from './native-group-save.js';

const fail = code => { throw Object.assign(new Error(code), { code, stack: code }); };
const safeNamespace = value => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const errors = new Set(['OPERATIONS_NAMESPACE_UNAVAILABLE', 'OPERATIONS_FAILED',
  'SAVE_BUSY', 'SAVE_READ_FAILED', 'SAVE_NAMESPACE_UNAVAILABLE', 'SAVE_INVALID_GROUP',
  'SAVE_PROVIDER_COLLISION', 'SAVE_STALE', 'SAVE_VALIDATION_FAILED', 'SAVE_UNVERIFIED',
  'GROUP_SAVE_BUSY', 'GROUP_SAVE_UNVERIFIED']);

/** Local new-group operations only. nativeConfig MUST be the pristine host Config
 * schema and resolveNative its local profile/catalog resolver, not a credential
 * resolver or adapter. Namespace identity comes exclusively from the live editor.
 * Metadata is a separate provider-first merge, never a cross-namespace transaction.
 */
export function createNativeOperations({ settings, configEditor, metadataNamespace,
  validateMetadata, resolveNative, nativeConfig } = {}) {
  if (typeof settings?.describe !== 'function' || typeof settings?.mutate !== 'function' ||
    typeof configEditor?.configuration !== 'function' || !safeNamespace(metadataNamespace) ||
    typeof validateMetadata !== 'function' || typeof resolveNative !== 'function' ||
    typeof nativeConfig?.parse !== 'function') fail('OPERATIONS_INVALID_ADAPTER');

  const namespace = () => {
    try {
      // Installed settings uses these descriptors and state 2 for live fibers.
      const descriptors = configEditor.configuration();
      if (!Array.isArray(descriptors)) fail('OPERATIONS_NAMESPACE_UNAVAILABLE');
      const entries = descriptors.map(item => item?.entry).filter(entry =>
        entry?.fiber?.runtime?.name === 'llm-pi-ai' && entry.fiber.state === 2);
      if (entries.length !== 1 || !safeNamespace(entries[0].options?.id) ||
        entries[0].options.id === metadataNamespace) fail('OPERATIONS_NAMESPACE_UNAVAILABLE');
      return entries[0].options.id;
    } catch { fail('OPERATIONS_NAMESPACE_UNAVAILABLE'); }
  };
  const adapters = new Map();
  const adapterFor = ns => {
    if (adapters.has(ns)) return adapters.get(ns);
    let targets;
    const native = createNativeSave({ settings, namespace: ns, validate: async providers => {
      // A fresh-only save must not silently combine legacy and native layouts.
      for (const profile of Object.values(providers)) {
        if (profile && (Object.hasOwn(profile, 'keyEntries') || Object.hasOwn(profile, 'multiKey'))) {
          fail('SAVE_VALIDATION_FAILED');
        }
      }
      if (namespace() !== ns || !targets) fail('SAVE_VALIDATION_FAILED');
      const raw = { providers: structuredClone(providers) };
      const parsed = await nativeConfig.parse(raw);
      if (!isDeepStrictEqual(raw, { providers }) || !parsed || !parsed.providers) fail('SAVE_VALIDATION_FAILED');
      const input = structuredClone(parsed.providers);
      const resolved = await resolveNative(input);
      if (!isDeepStrictEqual(input, parsed.providers) || !(resolved instanceof Map)) fail('SAVE_VALIDATION_FAILED');
      // Existing unrelated catalog profiles may be unresolved locally. Only the
      // exact generated targets must be serviceable; do not call getModels/auth.
      for (const target of targets) {
        const profile = resolved.get(target);
        if (!profile || profile.catalogError !== undefined || !(profile.modelErrors instanceof Map) ||
          profile.modelErrors.size !== 0 || !profile.piProvider) fail('SAVE_VALIDATION_FAILED');
      }
      if (namespace() !== ns) fail('SAVE_VALIDATION_FAILED');
      return true;
    } });
    const metadata = createNativeMetadataSave({ settings, namespace: metadataNamespace, validate: validateMetadata });
    const adapter = createNativeGroupSave({ native: {
      preview: group => native.preview(group),
      async save(group, revision, fingerprint) {
        // GroupSave's stable busy guard protects this operation-local scope,
        // including the subsequent metadata write, across repeated API calls.
        targets = planNativeSave(group).routes.map(route => route.target);
        try { return await native.save(group, revision, fingerprint); }
        finally { targets = undefined; }
      },
    }, metadata });
    adapters.set(ns, adapter);
    return adapter;
  };
  const run = async (method, group, revision, fingerprint) => {
    try {
      let input;
      try { input = structuredClone(group); } catch { fail('SAVE_INVALID_GROUP'); }
      const ns = namespace();
      return await adapterFor(ns)[method](input, revision, fingerprint);
    } catch (cause) {
      // Rebuild even recognized errors: injected host exceptions must never
      // escape with a message, stack, cause or arbitrary attached properties.
      fail(errors.has(cause?.code) ? cause.code : 'OPERATIONS_FAILED');
    }
  };
  return Object.freeze({
    preview: group => run('preview', group),
    save: (group, revision, fingerprint) => run('save', group, revision, fingerprint),
  });
}
