import { isDeepStrictEqual } from 'node:util';
const fail = code => { throw Object.assign(new Error(code), { code, stack: code }); };
/** Revision-checked metadata-only merge. Unknown/differing group ownership is a
 * conflict, never a reason to overwrite user changes. Native routes are external.
 */
export function createNativeMetadataSave({ settings, namespace, validate } = {}) {
  if (typeof settings?.describe !== 'function' || typeof settings?.mutate !== 'function' || typeof namespace !== 'string' || !namespace || typeof validate !== 'function') fail('METADATA_INVALID_ADAPTER');
  return {
    async merge(metadata) {
      try {
        const input = structuredClone(metadata);
        if (validate(input) === false) fail('METADATA_INVALID');
        const docs = await settings.describe({ redactSecrets: true });
        const matches = docs.filter(doc => doc.ns === namespace);
        if (matches.length !== 1) fail('METADATA_UNAVAILABLE');
        const doc = matches[0], groups = structuredClone(doc.value?.groups ?? {});
        const operations = [];
        for (const [id, value] of Object.entries(input.groups ?? {})) {
          if (Object.hasOwn(groups, id)) {
            if (!isDeepStrictEqual(groups[id], value)) fail('METADATA_CONFLICT');
          } else { groups[id] = value; operations.push({ op: 'set', path: ['groups', id], value }); }
        }
        if (validate({ groups }) === false) fail('METADATA_INVALID');
        if (operations.length) await settings.mutate(namespace, operations, doc.revision);
        const current = (await settings.describe({ redactSecrets: true })).filter(item => item.ns === namespace);
        if (current.length !== 1) fail('METADATA_UNVERIFIED');
        for (const [id, value] of Object.entries(input.groups ?? {})) {
          if (!isDeepStrictEqual(current[0].value?.groups?.[id], value)) fail('METADATA_UNVERIFIED');
        }
        return { status: 'verified', metadata: input };
      } catch { fail('METADATA_SAVE_FAILED'); }
    },
  };
}
