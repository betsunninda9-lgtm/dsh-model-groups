import { isGroupExpanded } from './group-state.js';

// This namespace is a selection identity, never an upstream model id or secret.
export const KEY_MODEL_PREFIX = '@dsh-key/';
const KEY_ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const forbiddenEntry = id => ['__proto__', 'prototype', 'constructor'].includes(id);

export function decodeKeyModelId(model) {
  if (typeof model !== 'string' || !model.startsWith(KEY_MODEL_PREFIX)) return undefined;
  const parts = model.slice(KEY_MODEL_PREFIX.length).split('/');
  if (parts.length !== 2) return undefined;
  try {
    const entryId = decodeURIComponent(parts[0]);
    const modelId = decodeURIComponent(parts[1]);
    if (!KEY_ENTRY_ID.test(entryId) || forbiddenEntry(entryId) || !modelId || modelId.startsWith(KEY_MODEL_PREFIX)) return undefined;
    if (`${KEY_MODEL_PREFIX}${encodeURIComponent(entryId)}/${encodeURIComponent(modelId)}` !== model) return undefined;
    return { entryId, modelId };
  } catch { return undefined; }
}

/** Explicit ranks survive host equality checks, schema parsing, and reloads.
 * Unranked legacy/new entries retain their existing relative order at the end.
 */
export function orderedKeyEntries(entries) {
  const rank = entry => Number.isSafeInteger(entry?.sortOrder) && entry.sortOrder >= 0 ? entry.sortOrder : Infinity;
  return Object.entries(entries ?? {}).sort(([, left], [, right]) => {
    const a = rank(left), b = rank(right);
    return a === b ? 0 : a < b ? -1 : 1;
  });
}

export function keyEntryGroupKey(provider, entryId) {
  return `@key/${encodeURIComponent(provider)}/${encodeURIComponent(entryId)}`;
}

export function keyEntryName(providers, provider, entryId) {
  const entries = Object.hasOwn(providers ?? {}, provider) ? providers[provider]?.keyEntries : undefined;
  const entry = entries && Object.hasOwn(entries, entryId) ? entries[entryId] : undefined;
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : entryId;
}

/** Preserve every original provider fold; only real multi-key routes gain children.
 * `providers` may be undefined while the native settings form is loading. In
 * that case aliases still remain identifiable, without inventing credentials.
 */
export function buildModelHierarchy(groups, providers, preferences, current = null) {
  return groups.map(group => {
    const profile = Object.hasOwn(providers ?? {}, group.id) ? providers[group.id] : undefined;
    const aliases = group.models.filter(model => decodeKeyModelId(model.id));
    const multi = profile?.multiKey === true || (providers === undefined && aliases.length > 0);
    const root = {
      kind: multi ? 'multi' : 'provider', key: group.id, id: group.id,
      name: group.provider?.name ?? group.name ?? group.id, group,
      current: current?.provider === group.id,
      expanded: isGroupExpanded(preferences, group.id, current?.provider),
    };
    if (!multi) {
      // A catalog refresh can race with disabling multi-key. Do not offer stale
      // aliases as if they belonged to the single-key credential.
      return { ...root, group: { ...group, models: group.models.filter(model => !model.id.startsWith(KEY_MODEL_PREFIX)) }, modelCount: group.models.filter(model => !model.id.startsWith(KEY_MODEL_PREFIX)).length };
    }
    const byEntry = new Map();
    const configured = profile?.keyEntries && typeof profile.keyEntries === 'object' ? profile.keyEntries : {};
    for (const [entryId] of orderedKeyEntries(configured)) {
      if (KEY_ENTRY_ID.test(entryId) && !forbiddenEntry(entryId)) byEntry.set(entryId, []);
    }
    for (const model of aliases) {
      const { entryId } = decodeKeyModelId(model.id);
      // Do not revive a removed entry from an old directory snapshot.
      if (providers !== undefined && !Object.hasOwn(configured, entryId)) continue;
      if (!byEntry.has(entryId)) byEntry.set(entryId, []);
      byEntry.get(entryId).push(model);
    }
    const selectedEntry = current?.provider === group.id ? decodeKeyModelId(current.model)?.entryId : undefined;
    const children = [...byEntry].filter(([, models]) => models.length > 0).map(([entryId, models]) => {
      const key = keyEntryGroupKey(group.id, entryId);
      const active = root.current && selectedEntry === entryId;
      // Catalog refreshes may use a different order from the saved editor rows.
      // Empty lists inherit catalog order; unconfigured models stay stable last.
      const configuredModels = Object.hasOwn(configured, entryId) ? configured[entryId]?.models : undefined;
      if (Array.isArray(configuredModels) && configuredModels.length > 0) {
        const order = new Map();
        for (const model of configuredModels) {
          if (typeof model?.id === 'string' && !order.has(model.id)) order.set(model.id, order.size);
        }
        const rank = model => order.get(decodeKeyModelId(model.id).modelId) ?? order.size;
        models.sort((left, right) => rank(left) - rank(right));
      }
      return { ...group, key, entryId, name: keyEntryName(providers, group.id, entryId), models, current: active,
        expanded: Object.hasOwn(preferences, key) ? preferences[key] : active };
    });
    // Legacy raw selections keep their exact original credential. Offer only the
    // current raw model here, not an extra editable/key-group configuration.
    if (root.current && !selectedEntry) {
      const legacy = group.models.filter(model => model.id === current.model && !model.id.startsWith(KEY_MODEL_PREFIX));
      if (legacy.length) {
        const key = keyEntryGroupKey(group.id, '@legacy');
        children.push({ ...group, key, entryId: undefined, legacy: true, name: 'Legacy single key', models: legacy, current: true,
          expanded: Object.hasOwn(preferences, key) ? preferences[key] : true });
      }
    }
    return { ...root, children, modelCount: children.reduce((sum, child) => sum + child.models.length, 0) };
  });
}

export function visibleHierarchyModels(entries) {
  return entries.flatMap(entry => {
    if (!entry.expanded) return [];
    const groups = entry.kind === 'multi' ? entry.children.filter(child => child.expanded) : [entry.group];
    return groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id })));
  });
}

export function hierarchyExpansionKeys(entries) {
  return entries.flatMap(entry => [entry.key, ...(entry.kind === 'multi' ? entry.children.map(child => child.key) : [])]);
}

/** Search temporarily expands matching provider/key paths, never saved folds. */
export function filterModelHierarchy(entries, query, rankModels) {
  const needle = query.trim();
  if (!needle) return entries;
  const matchesName = names => rankModels(names.filter(Boolean).map(name => ({ name })), needle).length > 0;
  return entries.flatMap(entry => {
    const all = matchesName([entry.name, entry.id]);
    if (entry.kind !== 'multi') {
      const models = all ? entry.group.models : rankModels(entry.group.models, needle);
      return models.length ? [{ ...entry, expanded: true, modelCount: models.length, group: { ...entry.group, models } }] : [];
    }
    const children = entry.children.flatMap(child => {
      const models = all || matchesName([child.name, child.entryId]) ? child.models : rankModels(child.models, needle);
      return models.length ? [{ ...child, expanded: true, models }] : [];
    });
    return children.length ? [{ ...entry, expanded: true, children, modelCount: children.reduce((sum, child) => sum + child.models.length, 0) }] : [];
  });
}
