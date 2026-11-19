const entryFields = [
  'name', 'apiKeyEnv', 'api', 'baseURL', 'headers', 'models', 'sortOrder',
  'capabilityDefaults', 'capabilityBatch',
];
const unsafe = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function copyData(value) {
  if (Array.isArray(value)) return value.map(copyData);
  if (plain(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !unsafe(key))
    .map(([key, child]) => [key, copyData(child)]));
  if (value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  throw Object.assign(new Error('INVALID_LEGACY_BRIDGE_DATA'), { code: 'INVALID_LEGACY_BRIDGE_DATA' });
}

/**
 * Recover reviewable key groups from a native Settings snapshot. This does not
 * claim that the currently loaded native adapter supports the old extension,
 * activate a projection, or change the original profile used for restoration.
 * Omitted connection fields continue to inherit from that original profile.
 */
export function extractLegacyBridgeDraft(profile) {
  if (!plain(profile) || !Object.hasOwn(profile, 'keyEntries') || !plain(profile.keyEntries)) return undefined;
  const keyEntries = {};
  for (const [id, entry] of Object.entries(profile.keyEntries)) {
    if (unsafe(id) || !plain(entry)) continue;
    const value = {};
    for (const field of entryFields) if (Object.hasOwn(entry, field)) value[field] = copyData(entry[field]);
    // Defining the id as data also keeps a malformed old id from changing the
    // output object's prototype. Normal save validation remains authoritative.
    Object.defineProperty(keyEntries, id, { value, enumerable: true, configurable: true, writable: true });
  }
  if (!Object.keys(keyEntries).length) return undefined;
  return { enabled: profile.multiKey === true, keyEntries };
}
