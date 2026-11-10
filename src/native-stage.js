import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { planNativeDowngrade } from './native-downgrade.js';

const locks = new WeakMap();
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const plannerCodes = new Set([
  'DOWNGRADE_UNSUPPORTED_CONFIG', 'DOWNGRADE_INVALID_PROVIDER', 'DOWNGRADE_INVALID_ENTRIES',
  'DOWNGRADE_DISABLED_ENTRIES', 'DOWNGRADE_INVALID_ENTRY', 'DOWNGRADE_CATALOG_DEFAULTS_REQUIRED',
  'DOWNGRADE_INVALID_MODELS', 'DOWNGRADE_MODEL_DEFAULTS_REQUIRED',
  'DOWNGRADE_UNREPRESENTABLE_MODEL', 'DOWNGRADE_PROVIDER_COLLISION', 'DOWNGRADE_AUTH_HEADER_OVERRIDE',
]);
const error = code => Object.assign(new Error(code), { code, stack: code });
const fail = code => { throw error(code); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Stage-only adapter. `validate` MUST be a trusted original-host semantic/schema
 * validator, not a credential resolver. No validator is installed automatically.
 * Preview tokens cover the whole observed configuration, not only its providers.
 * The host's revision-checked mutate is the cross-process concurrency boundary;
 * this busy guard only serializes calls sharing this settings object/namespace.
 */
export function createNativeStage({ settings, namespace, validate } = {}) {
  if (!settings || typeof settings.describe !== 'function' || typeof settings.mutate !== 'function' ||
    typeof namespace !== 'string' || !namespace || typeof validate !== 'function') fail('STAGE_INVALID_ADAPTER');
  if (!locks.has(settings)) locks.set(settings, new Set());
  const busy = locks.get(settings);

  const read = async () => {
    const documents = await settings.describe({ redactSecrets: true });
    if (!Array.isArray(documents)) fail('STAGE_READ_FAILED');
    const matches = documents.filter(doc => doc?.ns === namespace);
    if (matches.length !== 1) fail('STAGE_NAMESPACE_UNAVAILABLE');
    const doc = structuredClone(matches[0]);
    if (!Number.isSafeInteger(doc.revision) || doc.revision < 0 || !plain(doc.value) ||
      !Object.hasOwn(doc.value, 'providers') || !plain(doc.value.providers)) fail('STAGE_READ_FAILED');
    return { doc, fingerprint: digest([namespace, doc.revision, doc.value, doc.base, doc.user, doc.secrets]) };
  };
  const plan = snapshot => {
    try { return planNativeDowngrade(snapshot.doc.value.providers, { allowExistingExact: true }); }
    catch (cause) { throw error(plannerCodes.has(cause?.message) ? cause.message : 'STAGE_PLAN_FAILED'); }
  };
  const counts = planned => ({
    providers: planned.routes.length,
    models: planned.routes.reduce((total, route) => total + route.models.length, 0),
  });
  const exclusive = async operation => {
    if (busy.has(namespace)) fail('STAGE_BUSY');
    busy.add(namespace);
    try { return await operation(); }
    finally { busy.delete(namespace); }
  };
  const observe = async () => {
    try { return await read(); }
    catch (cause) {
      throw error(['STAGE_NAMESPACE_UNAVAILABLE', 'STAGE_READ_FAILED'].includes(cause?.code) ? cause.code : 'STAGE_READ_FAILED');
    }
  };
  const check = (snapshot, revision, fingerprint) => {
    if (snapshot.doc.revision !== revision || snapshot.fingerprint !== fingerprint) fail('STAGE_STALE');
  };

  return {
    preview: () => exclusive(async () => {
      const snapshot = await observe();
      const planned = plan(snapshot);
      return { status: 'preview', revision: snapshot.doc.revision, fingerprint: snapshot.fingerprint, planFingerprint: digest(planned.routes), counts: counts(planned) };
    }),
    stage: (expectedRevision, expectedFingerprint) => exclusive(async () => {
      const snapshot = await observe();
      check(snapshot, expectedRevision, expectedFingerprint);
      const planned = plan(snapshot);
      // Validate the original-host representation, whose legacy source copies
      // omit plugin-only fields. Only child additions below will be persisted;
      // the live legacy source (including keyEntries and aliases) stays intact.
      const validationInput = structuredClone(planned.providers);
      try {
        const result = await validate(validationInput);
        if (result === false || !isDeepStrictEqual(validationInput, planned.providers)) fail('STAGE_VALIDATION_FAILED');
      } catch { fail('STAGE_VALIDATION_FAILED'); }
      // Validation may have yielded while another editor changed configuration.
      check(await observe(), expectedRevision, expectedFingerprint);
      // Exact pre-existing children are reusable, never writable. The planner
      // rejects differing collisions; even an exact child gets no set operation.
      const additions = planned.routes.filter(route => !Object.hasOwn(snapshot.doc.value.providers, route.target));
      if (!additions.length) return { status: 'unchanged', counts: counts(planned) };
      const ops = additions.map(route => ({
        op: 'set', path: ['providers', route.target], value: structuredClone(planned.providers[route.target]),
      }));
      try {
        // Once invoked, a thrown host error can still mean persistence happened.
        // Do not retry, roll back, or delete potentially racing edits.
        await settings.mutate(namespace, ops, expectedRevision);
        const persisted = await read();
        for (const { target } of planned.routes) {
          if (!Object.hasOwn(persisted.doc.value.providers, target) ||
            !isDeepStrictEqual(persisted.doc.value.providers[target], planned.providers[target])) fail('STAGE_UNVERIFIED');
        }
      } catch { fail('STAGE_UNVERIFIED'); }
      return { status: 'staged', counts: counts(planned) };
    }),
  };
}
