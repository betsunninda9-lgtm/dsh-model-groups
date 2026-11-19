import { createBridgeProjection, publicBridgeEntries, sameBridgeValue, validateBridgeDraft } from './profile.js';
import { extractLegacyBridgeDraft } from './migration.js';
import { applyBridgeSingleKey, publicBridgeSingleKey, validateBridgeSingleKey } from './single-key.js';
import { applyBridgeShared, publicBridgeShared, validateBridgeShared } from './shared.js';

const copy = value => value === undefined ? undefined : structuredClone(value);
const owns = (object, key) => Object.hasOwn(object ?? {}, key);
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const projectedCaptureMatches = (actual, captured) => {
  if (Array.isArray(captured)) return Array.isArray(actual) && actual.length === captured.length
    && captured.every((item, index) => projectedCaptureMatches(actual[index], item));
  if (captured && typeof captured === 'object') return actual && typeof actual === 'object'
    && Object.entries(captured).every(([key, value]) => !owns(actual, key) || projectedCaptureMatches(actual[key], value));
  return sameBridgeValue(actual, captured);
};
const location = (document, route) => ({ present: owns(document.providers, route), profile: copy(document.providers?.[route]) });
const matches = (document, route, expected) => {
  const actual = location(document, route);
  return actual.present === expected.present && sameBridgeValue(actual.profile, expected.profile);
};

/**
 * A durable two-document transaction. Both adapters must use revision-checked
 * writes through their respective Settings namespaces. A pending journal is
 * persisted before touching the native namespace, so a crash is recoverable.
 */
export function createBridgeController({ storage, native, prepare, discover, credentials, normalizeNative = (_route, profile) => profile }) {
  let busy = false;
  const exclusive = async operation => {
    if (busy) throw failure('BRIDGE_BUSY');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  };
  async function writeRecord(route, record, revision) {
    return storage.writeProvider(route, copy(record), revision);
  }
  async function settle(route, document, nativeDocument) {
    const record = document.providers?.[route];
    const pending = record?.pending;
    if (!pending) return document;
    // Prefer target on no-op projections: the native state already admits it.
    if (matches(nativeDocument, route, pending.after)) return writeRecord(route, pending.target, document.revision);
    if (matches(nativeDocument, route, pending.before)) return writeRecord(route, pending.previous, document.revision);
    throw failure('NATIVE_CONFIG_CONFLICT');
  }
  async function recover() {
    return exclusive(async () => {
      let document = await storage.read();
      const conflicts = [];
      // A Loader-name change can leave a profile override visible as `user`
      // while the live value is empty. Reattach only our verified records;
      // never pretend an ignored override is already active.
      const ignored = await storage.readIgnoredProviders?.();
      for (const [route, record] of Object.entries(ignored ?? {})) {
        if (owns(document.providers, route)) continue;
        let admitted = false;
        let draft;
        try {
          draft = validateBridgeDraft(record);
          const current = await native.read();
          admitted = record?.pending
            ? matches(current, route, record.pending.before) || matches(current, route, record.pending.after)
            : record?.active === true && record?.confirmed === true && typeof record.original?.present === 'boolean'
              && sameBridgeValue(current.providers?.[route], record.projection);
        } catch { /* Invalid or unrelated profile data is never adopted. */ }
        if (!admitted) { conflicts.push(route); continue; }
        document = await writeRecord(route, { ...copy(record), ...draft }, document.revision);
      }
      for (const route of Object.keys(document.providers ?? {})) {
        if (!document.providers[route]?.pending) continue;
        try { document = await settle(route, document, await native.read()); }
        catch { conflicts.push(route); document = await storage.read(); }
      }
      return { ...document, recoveryConflicts: conflicts };
    });
  }
  async function save(route, draft, expectedRevision) {
    return exclusive(async () => {
      if (typeof route !== 'string' || !route || ['__proto__', 'constructor', 'prototype'].includes(route)) throw failure('INVALID_PROVIDER');
      const config = validateBridgeDraft(draft);
      const sharedPatch = draft.shared === undefined ? undefined : validateBridgeShared(draft.shared);
      const singlePatch = draft.singleKey === undefined ? undefined : validateBridgeSingleKey(draft.singleKey);
      let document = await storage.read();
      if (document.revision !== expectedRevision) throw failure('SETTINGS_CONFLICT');
      let nativeDocument = await native.read();
      if (draft.expectedNativeRevision !== undefined && (!Number.isSafeInteger(draft.expectedNativeRevision) || draft.expectedNativeRevision !== nativeDocument.revision)) throw failure('NATIVE_CONFIG_CONFLICT');
      if (document.providers?.[route]?.pending) {
        const pending = document.providers[route].pending;
        if (!matches(nativeDocument, route, pending.after) && !matches(nativeDocument, route, pending.before) && !config.enabled) {
          const original = pending.target?.original ?? pending.previous?.original ?? pending.before;
          document = await writeRecord(route, { ...config, active: false, confirmed: false, original: copy(original),
            generation: (pending.target?.generation ?? 0) + 1 }, document.revision);
          return { ok: true, revision: document.revision };
        }
        document = await settle(route, document, nativeDocument);
        // Recovery changes the durable revision; the user must review it.
        throw failure('SETTINGS_CONFLICT');
      }
      const previous = copy(document.providers?.[route]);
      const before = location(nativeDocument, route);
      const nativeConflict = previous?.active && !sameBridgeValue(before.profile, previous.projection);
      if (nativeConflict && config.enabled) throw failure('NATIVE_CONFIG_CONFLICT');
      if (previous?.migrationOriginal && !matches(nativeDocument, route, previous.migrationBaseline)) throw failure('NATIVE_CONFIG_CONFLICT');
      const baseOriginal = copy(previous?.active ? previous.original : previous?.migrationOriginal ?? before);
      const original = sharedPatch === undefined && singlePatch === undefined ? baseOriginal : { ...baseOriginal, present: true,
        profile: applyBridgeSingleKey(applyBridgeShared(baseOriginal.profile, sharedPatch), singlePatch) };
      let target;
      let after;
      if (config.enabled) {
        const prepared = await prepare(route, copy(config), copy(original.profile));
        const projection = await normalizeNative(route, createBridgeProjection(original.profile, config, prepared));
        if (previous?.active && sameBridgeValue(previous.original, original) && sameBridgeValue(previous.projection, projection)
          && sameBridgeValue({ enabled: previous.enabled, keyEntries: previous.keyEntries }, config)) {
          return { ok: true, revision: document.revision };
        }
        target = { ...config, active: true, confirmed: true, original: copy(original), projection,
          ...(prepared.routing === undefined ? {} : { routing: copy(prepared.routing), rootModels: copy(prepared.models?.legacy ?? []) }),
          generation: (previous?.generation ?? 0) + 1 };
        after = { present: true, profile: copy(projection) };
      } else {
        target = { ...config, active: false, confirmed: false, original: copy(original),
          generation: (previous?.generation ?? 0) + 1 };
        after = copy(previous?.active && !nativeConflict ? original : before);
        if (sharedPatch !== undefined || singlePatch !== undefined) {
          after.present = true;
          after.profile = applyBridgeSingleKey(applyBridgeShared(after.profile, sharedPatch), singlePatch);
        }
        // Closing a migrated legacy setup must also turn off its native
        // multi-key switch, while retaining the saved entries and raw backup.
        if (!nativeConflict && after.profile?.multiKey === true) after.profile.multiKey = false;
        if (after.present) after.profile = await normalizeNative(route, after.profile);
      }
      // Configuration may change while backend capabilities/credentials resolve.
      nativeDocument = await native.read();
      if (!matches(nativeDocument, route, before)) throw failure('NATIVE_CONFIG_CONFLICT');
      const staged = { ...(previous ?? { ...config, active: false, confirmed: false }),
        pending: { previous, target, before, after } };
      document = await writeRecord(route, staged, document.revision);
      try {
        if (!matches(nativeDocument, route, after)) {
          await native.writeProvider(route, after.present ? after.profile : undefined, nativeDocument.revision);
        }
        const verified = await native.read();
        if (!matches(verified, route, after)) throw failure('NATIVE_CONFIG_CONFLICT');
        document = await writeRecord(route, target, document.revision);
        return { ok: true, revision: document.revision };
      } catch (error) {
        // A thrown write may already have committed. Inspect before deciding;
        // never replay a write or overwrite a concurrent native edit.
        const currentNative = await native.read();
        try { await settle(route, document, currentNative); } catch { /* Durable journal remains for explicit recovery. */ }
        throw error;
      }
    });
  }
  async function snapshot() {
    const document = await storage.read();
    const nativeDocument = await native.read();
    const providers = {};
    for (const [route, saved] of Object.entries(document.providers ?? {})) {
      let record = saved;
      if (saved.pending) {
        if (matches(nativeDocument, route, saved.pending.after)) record = saved.pending.target;
        else if (matches(nativeDocument, route, saved.pending.before)) record = saved.pending.previous;
        else record = { ...saved, confirmed: false, conflict: true };
      }
      if (!record) continue;
      // Public UI data never includes original profiles, internal guard refs,
      // journals, or complete native projection values.
      providers[route] = { enabled: record.enabled, active: record.active,
        confirmed: record.confirmed && (!record.active || sameBridgeValue(nativeDocument.providers?.[route], record.projection)),
        keyEntries: publicBridgeEntries(record.keyEntries), generation: record.generation,
        shared: publicBridgeShared(record.active ? record.original?.profile : record.migrationOriginal?.profile ?? nativeDocument.providers?.[route]),
        singleKey: publicBridgeSingleKey(record.active ? record.original?.profile : record.migrationOriginal?.profile ?? nativeDocument.providers?.[route]),
        ...(record.routing === undefined ? {} : { routing: copy(record.routing), rootModels: copy(record.rootModels ?? []) }),
        conflict: record.conflict === true || (record.active === true && !sameBridgeValue(nativeDocument.providers?.[route], record.projection)) };
    }
    for (const [route, profile] of Object.entries(nativeDocument.providers ?? {})) {
      if (owns(providers, route)) continue;
      const legacy = extractLegacyBridgeDraft(profile);
      if (legacy) providers[route] = { ...legacy, singleKey: publicBridgeSingleKey(profile), shared: publicBridgeShared(profile), keyEntries: publicBridgeEntries(legacy.keyEntries), active: false, confirmed: false, migration: true };
      else providers[route] = { enabled: false, active: false, confirmed: false, keyEntries: {}, singleKey: publicBridgeSingleKey(profile), shared: publicBridgeShared(profile) };
    }
    return { status: 'ready', revision: document.revision, nativeRevision: nativeDocument.revision, writable: true, providers };
  }
  async function synchronize() {
    // Re-evaluate capabilities after a host replacement only while the native
    // profile still equals our last committed projection. Explicit user edits
    // remain conflicts rather than being overwritten by a startup loop.
    let document = await storage.read();
    const nativeDocument = await native.read();
    const routes = new Set([...Object.keys(document.providers ?? {}), ...Object.keys(nativeDocument.providers ?? {})]);
    const failures = [];
    for (const route of routes) {
      const saved = document.providers?.[route];
      const draft = saved?.active || saved?.migrationOriginal ? { enabled: saved.enabled, keyEntries: saved.keyEntries }
        : !saved ? extractLegacyBridgeDraft(nativeDocument.providers?.[route]) : undefined;
      if (!draft) continue;
      try { await save(route, draft, document.revision); }
      catch { failures.push(route); }
      document = await storage.read();
    }
    return { ok: failures.length === 0, failures };
  }
  async function importLegacy(profiles) {
    return exclusive(async () => {
      let document = await storage.read();
      const nativeDocument = await native.read();
      const imported = [], conflicts = [];
      for (const [route, profile] of Object.entries(profiles ?? {})) {
        if (owns(document.providers, route)) continue;
        const draft = extractLegacyBridgeDraft(profile);
        if (!draft) continue;
        if (!owns(nativeDocument.providers, route)) { conflicts.push(route); continue; }
        const current = nativeDocument.providers[route];
        // Undeclared old fields can disappear from the new native schema. Every
        // still-visible original field must agree with the captured source.
        if (Object.entries(profile).some(([key, value]) => !['keyEntries', 'multiKey'].includes(key)
          && owns(current, key) && !projectedCaptureMatches(current[key], value))) { conflicts.push(route); continue; }
        const record = { ...validateBridgeDraft(draft), active: false, confirmed: false,
          migrationOriginal: { present: true, profile: copy(profile) }, migrationBaseline: location(nativeDocument, route) };
        document = await writeRecord(route, record, document.revision);
        imported.push(route);
      }
      return { imported, conflicts };
    });
  }
  async function executionSnapshot(route) {
    const document = await storage.read();
    const nativeDocument = await native.read();
    let record = document.providers?.[route];
    if (record?.pending) {
      if (matches(nativeDocument, route, record.pending.after)) record = record.pending.target;
      else if (matches(nativeDocument, route, record.pending.before)) record = record.pending.previous;
      else throw failure('NATIVE_CONFIG_CONFLICT');
    }
    if (!record?.enabled || !record.active) {
      const profile = nativeDocument.providers?.[route];
      // Preserve a genuinely native legacy setup when migration could not be
      // completed. Never pass through a stranded local bridge projection.
      if (profile?.multiKey === true
        && profile.baseURL !== 'http://127.0.0.1:1/dsh-model-groups-disabled'
        && profile.apiKeyEnv !== 'DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD') {
        return { legacyNative: true, keyEntries: copy(profile.keyEntries ?? {}) };
      }
      return undefined;
    }
    if (!sameBridgeValue(nativeDocument.providers?.[route], record.projection)) throw failure('NATIVE_CONFIG_CONFLICT');
    return copy(record);
  }
  return { save, recover, synchronize, importLegacy, snapshot, executionSnapshot,
    async setCredential(ref, value) {
      if (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(ref)) throw failure('INVALID_CREDENTIAL_REFERENCE');
      if (typeof value !== 'string' || !value.trim() || value.length > 16384 || /[\r\n\0]/.test(value)) throw failure('INVALID_CREDENTIAL_VALUE');
      if (!credentials?.set) throw failure('CREDENTIALS_UNAVAILABLE');
      await credentials.set(ref, value);
      return { ok: true };
    },
    async discover(route, entryId, entryDraft, { apiKey, shared } = {}) {
      if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 16384 || !/^[\x21-\x7E]+$/.test(apiKey))) throw failure('INVALID_CREDENTIAL_VALUE');
      // A draft model list may still contain its empty add-row. Discovery does
      // not execute those models and never saves the transient credential.
      const entry = { ...copy(entryDraft), models: [] };
      if (entryId === undefined) validateBridgeSingleKey(entry);
      else validateBridgeDraft({ enabled: true, keyEntries: { [entryId]: entry } });
      if (!discover) throw failure('DISCOVERY_UNAVAILABLE');
      return { ok: true, models: await discover(route, entryId, entry, { apiKey, ...(shared === undefined ? {} : { shared: validateBridgeShared(shared) }) }) };
    } };
}
