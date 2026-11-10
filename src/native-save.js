import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { planNativeDowngrade } from './native-downgrade.js';

const locks = new WeakMap();
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const label = value => typeof value === 'string' && !!value.trim() && value.length <= 120;
const error = code => Object.assign(new Error(code), { code, stack: code });
const fail = code => { throw error(code); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Original host profile fields only; identity, credentials, root models and legacy
// controls are deliberately absent. The injected native validator checks semantics.
const commonFields = new Set(['displayName', 'api', 'baseURL', 'compat',
  'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'headers', 'reasoning',
  'thinkingBudgets', 'cacheRetention', 'transport', 'timeoutMs',
  'websocketConnectTimeoutMs', 'streamIdleTimeoutMs', 'maxRequestImageBytes',
  'maxRequestImages', 'imageOffloadCountQuantum', 'requestImagePixelBudget',
  'requestImageMaxBytes', 'retryPolicy']);
const jsonData = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !plain(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    !['__proto__', 'prototype', 'constructor', '__jsExpr'].includes(key) && jsonData(item));
};

/** Pure new-group planner. group = { id, shared: { displayName, api, baseURL,
 * ...hostCommonFields }, entries: [{ id, name, apiKeyEnv, models }] }.
 * IDs are caller-owned stable identities, never derived from editable labels.
 * The synthetic legacy-shaped source is used ONLY to reuse the conservative
 * downgrade checks/ID scheme. It is never returned or persisted as a provider.
 */
export function planNativeSave(group, providers = {}) {
  try {
    if (!plain(group) || !jsonData(group) || !safeId(group.id) ||
      Object.keys(group).some(key => !['id', 'shared', 'entries'].includes(key)) ||
      !plain(group.shared) || !label(group.shared.displayName) ||
      Object.keys(group.shared).some(key => !commonFields.has(key)) ||
      !Array.isArray(group.entries) || !group.entries.length || !plain(providers)) fail('SAVE_INVALID_GROUP');
    const url = new URL(group.shared.baseURL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('SAVE_INVALID_GROUP');
    const entries = {};
    for (const entry of group.entries) {
      if (!plain(entry) || !safeId(entry.id) || Object.hasOwn(entries, entry.id) || !label(entry.name) ||
        Object.keys(entry).some(key => !['id', 'name', 'apiKeyEnv', 'models'].includes(key))) fail('SAVE_INVALID_GROUP');
      const { id, ...value } = entry;
      entries[id] = structuredClone(value);
    }
    const synthetic = { [group.id]: { ...structuredClone(group.shared), multiKey: true, keyEntries: entries } };
    const planned = planNativeDowngrade(synthetic);
    const candidate = structuredClone(providers);
    for (const { target } of planned.routes) {
      const child = planned.providers[target];
      if (Object.hasOwn(providers, target) && !isDeepStrictEqual(providers[target], child)) fail('SAVE_PROVIDER_COLLISION');
      candidate[target] = child;
    }
    return { providers: candidate, routes: planned.routes, metadata: planned.metadata };
  } catch (cause) {
    if (['SAVE_INVALID_GROUP', 'SAVE_PROVIDER_COLLISION'].includes(cause?.code)) throw cause;
    // No user-supplied strings or host exception details cross this boundary.
    fail('SAVE_INVALID_GROUP');
  }
}

/** Injected core only: no runtime/UI wiring, migration, network or credentials.
 * validate(providers) MUST be a trusted LOCAL original-host schema + semantic
 * validator, not a credential resolver. Passing it is mandatory, including no-op
 * saves. A callback cannot prove its own trust; caller owns that boundary.
 *
 * Only absent child provider paths are written via one revision-checked mutate in
 * the pi-ai namespace. Existing exact children are reusable but never overwritten.
 * Display metadata is returned separately for caller persistence: this makes NO
 * cross-namespace atomicity claim. Metadata failure leaves native routes usable.
 * Renaming labels preserves IDs but changed existing children intentionally fail
 * closed in this first implementation. There are no updates/deletes/root writes.
 */
export function createNativeSave({ settings, namespace = 'pi-ai', validate } = {}) {
  if (!settings || typeof settings.describe !== 'function' || typeof settings.mutate !== 'function' ||
    typeof namespace !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(namespace) || ['__proto__', 'prototype', 'constructor'].includes(namespace) || typeof validate !== 'function') fail('SAVE_INVALID_ADAPTER');
  if (!locks.has(settings)) locks.set(settings, new Set());
  const busy = locks.get(settings);
  const exclusive = async operation => {
    if (busy.has(namespace)) fail('SAVE_BUSY');
    busy.add(namespace);
    try { return await operation(); } finally { busy.delete(namespace); }
  };
  const read = async () => {
    try {
      const docs = await settings.describe({ redactSecrets: true });
      if (!Array.isArray(docs)) fail('SAVE_READ_FAILED');
      const matches = docs.filter(doc => doc?.ns === namespace);
      if (matches.length !== 1) fail('SAVE_NAMESPACE_UNAVAILABLE');
      const doc = structuredClone(matches[0]);
      if (!Number.isSafeInteger(doc.revision) || doc.revision < 0 || !plain(doc.value) ||
        !Object.hasOwn(doc.value, 'providers') || !plain(doc.value.providers)) fail('SAVE_READ_FAILED');
      return doc;
    } catch (cause) {
      fail(cause?.code === 'SAVE_NAMESPACE_UNAVAILABLE' ? cause.code : 'SAVE_READ_FAILED');
    }
  };
  const fingerprint = (doc, group) => {
    try { return digest([namespace, doc.revision, doc.value, doc.base, doc.user, doc.secrets, group]); }
    catch { fail('SAVE_READ_FAILED'); }
  };
  const check = (doc, group, revision, token) => {
    if (doc.revision !== revision || fingerprint(doc, group) !== token) fail('SAVE_STALE');
  };
  const counts = plan => ({ providers: plan.routes.length,
    models: plan.routes.reduce((total, route) => total + route.models.length, 0) });
  return {
    preview: group => exclusive(async () => {
      let input;
      try { input = structuredClone(group); } catch { fail('SAVE_INVALID_GROUP'); }
      const doc = await read();
      const plan = planNativeSave(input, doc.value.providers);
      return { status: 'preview', revision: doc.revision, fingerprint: fingerprint(doc, input), counts: counts(plan) };
    }),
    save: (group, expectedRevision, expectedFingerprint) => exclusive(async () => {
      // Detach before the first await: caller edits cannot change an in-flight save.
      let input;
      try { input = structuredClone(group); } catch { fail('SAVE_INVALID_GROUP'); }
      const doc = await read();
      const plan = planNativeSave(input, doc.value.providers);
      check(doc, input, expectedRevision, expectedFingerprint);
      const candidate = structuredClone(plan.providers);
      try {
        const result = await validate(candidate);
        if (result === false || !isDeepStrictEqual(candidate, plan.providers)) fail('SAVE_VALIDATION_FAILED');
      } catch { fail('SAVE_VALIDATION_FAILED'); }
      check(await read(), input, expectedRevision, expectedFingerprint);
      const additions = plan.routes.filter(route => !Object.hasOwn(doc.value.providers, route.target));
      if (additions.length) {
        const ops = additions.map(({ target }) => ({ op: 'set', path: ['providers', target], value: structuredClone(plan.providers[target]) }));
        try {
          await settings.mutate(namespace, ops, expectedRevision);
          const persisted = await read();
          for (const { target } of plan.routes) {
            if (!Object.hasOwn(persisted.value.providers, target) ||
              !isDeepStrictEqual(persisted.value.providers[target], plan.providers[target])) fail('SAVE_UNVERIFIED');
          }
        } catch { fail('SAVE_UNVERIFIED'); }
      }
      // Never retry or roll back an uncertain host write, nor write metadata here.
      return { status: additions.length ? 'saved' : 'unchanged', counts: counts(plan), metadata: structuredClone(plan.metadata) };
    }),
  };
}
