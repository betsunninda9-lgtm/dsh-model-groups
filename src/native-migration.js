import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { downgradeSelection } from './native-downgrade.js';

const locks = new WeakSet();
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw Object.assign(new Error(code), { code, stack: code }); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision = value => (Number.isSafeInteger(value) && value >= 0) ||
  (typeof value === 'string' && value.length > 0);
const copy = value => structuredClone(value);

/** Adapter-only scaffolding, NOT a runtime integration or uninstall procedure.
 *
 * `plan` is mandatory: a trusted planNativeDowngrade result for the SAME config
 * handled by `stage`. Its preview must expose planFingerprint, the SHA-256 of
 * JSON.stringify(plan.routes), to bind the mapping. No name-based inference.
 * `routes` must enumerate ALL current selections (including default as an item),
 * report complete/quiescent truthfully, and atomically CAS the entire selection.
 * Its host must maintain quiescence across inspection/CAS; there is no global
 * transaction or cross-process lock here. IDs must be stable opaque strings.
 * `journal` is private durable storage with read-after-write semantics, exclusively
 * owned by this operation. It stores current selection snapshots, never config or
 * credentials. Injected adapters are trusted; no disk/services are accessed here.
 *
 * migrate() always re-inspects; preview() is read-only and is not an approval
 * token. Intent is durable BEFORE each side effect; uncertain writes stop without
 * rollback. Retry with the SAME journal/plan; exact intended results are accepted
 * only for attempted steps. Raw selections are checked but never written.
 * Completion leaves legacy configs, patches, installation and historical events
 * untouched. It means only routes-migrated, NEVER uninstall-safe.
 */
export function createNativeMigration({ stage, routes, journal, plan } = {}) {
  if (!stage || typeof stage.preview !== 'function' || typeof stage.stage !== 'function' ||
    !routes || typeof routes.inspect !== 'function' || typeof routes.compareAndSelect !== 'function' ||
    !journal || typeof journal.read !== 'function' || typeof journal.write !== 'function') fail('MIGRATION_INVALID_ADAPTER');

  let mapping;
  try {
    if (!plain(plan) || !Array.isArray(plan.routes)) fail('MIGRATION_INVALID_PLAN');
    mapping = copy(plan.routes);
    const sources = new Set(), targets = new Set();
    for (const route of mapping) {
      if (!plain(route) || ['provider', 'entryId', 'target'].some(key => typeof route[key] !== 'string' || !route[key]) ||
        route.provider === route.target || !Array.isArray(route.models) || !route.models.length ||
        route.models.some(model => typeof model !== 'string' || !model || model.startsWith('@dsh-key/')) ||
        new Set(route.models).size !== route.models.length) fail('MIGRATION_INVALID_PLAN');
      const source = JSON.stringify([route.provider, route.entryId]);
      if (sources.has(source) || targets.has(route.target)) fail('MIGRATION_INVALID_PLAN');
      sources.add(source); targets.add(route.target);
    }
    if (mapping.some(route => targets.has(route.provider))) fail('MIGRATION_INVALID_PLAN');
  } catch { fail('MIGRATION_INVALID_PLAN'); }
  const planFingerprint = digest(mapping);
  const mapped = selection => {
    try { return downgradeSelection(selection, { routes: mapping }); }
    catch { fail('MIGRATION_UNKNOWN_SELECTION'); }
  };
  const inspect = async () => {
    let snapshot;
    try { snapshot = copy(await routes.inspect()); }
    catch { fail('MIGRATION_INSPECT_FAILED'); }
    if (!plain(snapshot) || snapshot.complete !== true) fail('MIGRATION_INCOMPLETE');
    if (snapshot.quiescent !== true) fail('MIGRATION_NOT_QUIESCENT');
    if (!revision(snapshot.revision) || !Array.isArray(snapshot.items)) fail('MIGRATION_INVALID_INVENTORY');
    const ids = new Set();
    for (const item of snapshot.items) {
      if (!plain(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail('MIGRATION_INVALID_INVENTORY');
      ids.add(item.id);
      mapped(item.selection); // Fail closed even for unknown aliases not yet visited.
    }
    return snapshot;
  };
  const readJournal = async () => {
    try { return copy(await journal.read()); }
    catch { fail('MIGRATION_JOURNAL_FAILED'); }
  };
  const save = async record => {
    try { await journal.write(copy(record)); }
    catch { fail('MIGRATION_JOURNAL_FAILED'); }
  };
  const fresh = snapshot => ({
    version: 1, planFingerprint, phase: 'prepared',
    items: snapshot.items.map(({ id, selection }) => {
      const next = mapped(selection);
      return { id, expected: copy(selection), next,
        state: isDeepStrictEqual(selection, next) ? 'unchanged' : 'pending' };
    }),
  });
  const validateRecord = record => {
    if (!plain(record) || record.version !== 1 || record.planFingerprint !== planFingerprint ||
      !['prepared', 'stage-intent', 'stage-ready', 'routes-migrated'].includes(record.phase) ||
      !Array.isArray(record.items)) fail('MIGRATION_INVALID_JOURNAL');
    const ids = new Set();
    for (const item of record.items) {
      if (!plain(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        !['pending', 'intent', 'done', 'unchanged'].includes(item.state)) fail('MIGRATION_INVALID_JOURNAL');
      ids.add(item.id);
      if (!isDeepStrictEqual(mapped(item.expected), item.next) ||
        (isDeepStrictEqual(item.expected, item.next) !== (item.state === 'unchanged')) ||
        (record.phase === 'routes-migrated' && !['done', 'unchanged'].includes(item.state))) fail('MIGRATION_INVALID_JOURNAL');
    }
    return record;
  };
  const reconcile = (record, snapshot) => {
    const current = new Map(snapshot.items.map(item => [item.id, item.selection]));
    if (current.size !== record.items.length) fail('MIGRATION_ROUTE_CHANGED');
    for (const item of record.items) {
      if (!current.has(item.id)) fail('MIGRATION_ROUTE_CHANGED');
      const selection = current.get(item.id);
      if (item.state === 'done') {
        if (!isDeepStrictEqual(selection, item.next)) fail('MIGRATION_ROUTE_CHANGED');
      } else if (item.state === 'intent' && isDeepStrictEqual(selection, item.next)) {
        item.state = 'done';
      } else if (!isDeepStrictEqual(selection, item.expected)) fail('MIGRATION_ROUTE_CHANGED');
    }
  };
  const observe = async () => {
    const snapshot = await inspect();
    const stored = await readJournal();
    const record = stored == null ? fresh(snapshot) : validateRecord(stored);
    reconcile(record, snapshot);
    return { record, snapshot };
  };
  const counts = record => ({ total: record.items.length,
    mapped: record.items.filter(item => item.state !== 'unchanged').length,
    migrated: record.items.filter(item => item.state === 'done').length });
  const exclusive = async operation => {
    if (locks.has(journal)) fail('MIGRATION_BUSY');
    locks.add(journal);
    try { return await operation(); }
    finally { locks.delete(journal); }
  };

  const stagePreview = async () => {
    let preview;
    try { preview = await stage.preview(); }
    catch { fail('MIGRATION_STAGE_FAILED'); }
    if (!revision(preview?.revision) || typeof preview.fingerprint !== 'string' || !preview.fingerprint ||
      preview.planFingerprint !== planFingerprint) fail('MIGRATION_PLAN_MISMATCH');
    return preview;
  };
  return {
    preview: () => exclusive(async () => {
      const { record } = await observe();
      await stagePreview();
      return { status: 'preview', counts: counts(record) };
    }),
    migrate: () => exclusive(async () => {
      const { record } = await observe();
      const preview = await stagePreview();
      await save(record);
      // Even resumed/completed operations revalidate idempotent additions FIRST.
      // A stage exception may mean additions persisted; no selection is attempted.
      record.phase = 'stage-intent';
      await save(record);
      try {
        const staged = await stage.stage(preview.revision, preview.fingerprint);
        if (!['staged', 'unchanged'].includes(staged?.status)) fail('MIGRATION_STAGE_FAILED');
      } catch { fail('MIGRATION_STAGE_FAILED'); }
      record.phase = 'stage-ready';
      await save(record);
      for (const item of record.items) {
        // Inspect every item, not just the next CAS target, to catch unrelated edits.
        reconcile(record, await inspect());
        if (['done', 'unchanged'].includes(item.state)) continue;
        item.state = 'intent';
        await save(record);
        let selected;
        try { selected = await routes.compareAndSelect(item.id, copy(item.expected), copy(item.next)); }
        catch { fail('MIGRATION_SELECT_UNVERIFIED'); }
        if (selected !== true) fail('MIGRATION_ROUTE_CHANGED');
        reconcile(record, await inspect());
        if (item.state !== 'done') fail('MIGRATION_SELECT_UNVERIFIED');
        await save(record);
      }
      reconcile(record, await inspect());
      record.phase = 'routes-migrated';
      await save(record);
      return { status: 'routes-migrated', counts: counts(record) };
    }),
  };
}
