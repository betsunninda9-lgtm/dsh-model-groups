import { isDeepStrictEqual } from 'node:util';
const error = code => Object.assign(new Error(code), { code, stack: code });
/** Provider-first commit orchestration. No global transaction claim. Metadata
 * adapter must merge under a revision guard and validate duplicate claims.
 * Failure after native save deliberately leaves usable providers in place.
 */
export function createNativeGroupSave({ native, metadata } = {}) {
  if (typeof native?.preview !== 'function' || typeof native?.save !== 'function' || typeof metadata?.merge !== 'function') throw error('GROUP_SAVE_INVALID_ADAPTER');
  let busy = false;
  return {
    preview: group => native.preview(group),
    async save(group, revision, fingerprint) {
      if (busy) throw error('GROUP_SAVE_BUSY');
      busy = true;
      try {
        const result = await native.save(group, revision, fingerprint);
        if (!['saved', 'unchanged'].includes(result?.status) || !result.metadata?.groups) throw error('GROUP_SAVE_UNVERIFIED');
        const value = structuredClone(result.metadata);
        try {
          const receipt = await metadata.merge(structuredClone(value));
          if (receipt?.status !== 'verified' || !isDeepStrictEqual(receipt.metadata, value)) throw error('GROUP_SAVE_METADATA_UNVERIFIED');
          return { status: 'saved', nativeStatus: result.status, counts: result.counts };
        } catch {
          return { status: 'native-saved-metadata-pending', nativeStatus: result.status, counts: result.counts,
            code: 'GROUP_SAVE_METADATA_PENDING' };
        }
      } finally { busy = false; }
    },
  };
}
