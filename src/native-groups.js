// Display-only projection. This module does not read configuration or synthesize
// providers/models: the directory is the sole authority for available routes.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SAFE_PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const safe = (value, pattern) => typeof value === 'string' && pattern.test(value) && !RESERVED.has(value);
const record = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, key) => record(value) && Object.hasOwn(value, key) ? value[key] : undefined;
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const key = (...parts) => JSON.stringify(parts);

/**
 * Project native directory groups into display containers.
 *
 * directoryGroups: ordered [{ id: actualProviderId, provider?: { name },
 *   name?, models: [{ id: rawModelId, name?, ... }] }].
 * metadata: { groups: { groupId: { name?, entries: {
 *   entryId: { name?, provider: actualProviderId }
 * } } } }. Only own properties on plain/null-prototype records are used.
 * current: optional { provider: actualProviderId, model: rawModelId }.
 *
 * Returns roots of kind 'group' (children of kind 'entry') or 'provider'.
 * Native rows carry actual `id`/`provider`, original `group`, and model rows
 * with original `model`/`group` references and exact `{provider, model}` route.
 * Group-container IDs and JSON-tuple UI keys are never route identities.
 *
 * Native directory order controls roots, children and models; a container is
 * placed at its first native child. Missing providers yield no available child
 * or empty container. Metadata never adds models, filters them, or rewrites IDs.
 * Any malformed entry invalidates its entire display container. A provider
 * claimed more than once invalidates EVERY claiming container (including its
 * other children); ambiguous duplicate directory IDs do likewise. Native rows
 * always survive ungrouped when metadata cannot be applied safely.
 * Inputs and referenced native objects are never mutated.
 */
export function buildNativeGroups(directoryGroups, metadata, current = null) {
  const directory = Array.isArray(directoryGroups) ? directoryGroups : [];
  const definitions = own(metadata, 'groups');
  const plans = new Map();
  const claims = new Map();
  const nativeCounts = new Map();
  for (const group of directory) nativeCounts.set(group.id, (nativeCounts.get(group.id) ?? 0) + 1);

  if (record(definitions)) {
    for (const groupId of Object.keys(definitions)) {
      const definition = own(definitions, groupId);
      const entries = own(definition, 'entries');
      if (!record(entries)) continue;
      const plan = { groupId, name: label(own(definition, 'name'), groupId), valid: safe(groupId, SAFE_ID), entries: [] };
      plans.set(groupId, plan);
      for (const entryId of Object.keys(entries)) {
        const entry = own(entries, entryId);
        const provider = own(entry, 'provider');
        if (!safe(entryId, SAFE_ID)) plan.valid = false;
        if (!safe(provider, SAFE_PROVIDER)) {
          plan.valid = false;
          continue;
        }
        const assignment = { plan, entryId, provider, name: label(own(entry, 'name'), entryId) };
        plan.entries.push(assignment);
        if (!claims.has(provider)) claims.set(provider, []);
        claims.get(provider).push(assignment);
      }
    }
  }

  for (const [provider, assignments] of claims) {
    if (assignments.length > 1 || (nativeCounts.get(provider) ?? 0) > 1) {
      for (const assignment of assignments) assignment.plan.valid = false;
    }
  }
  const assigned = new Map();
  for (const plan of plans.values()) {
    if (plan.valid) for (const entry of plan.entries) assigned.set(entry.provider, entry);
  }

  const roots = [];
  const containers = new Map();
  for (const [index, group] of directory.entries()) {
    const assignment = assigned.get(group.id);
    const identity = (nativeCounts.get(group.id) ?? 0) > 1 ? [group.id, index] : [group.id];
    const rowKey = key('provider', ...identity);
    const models = group.models.map((model, modelIndex) => ({
      key: key('model', ...identity, model.id, modelIndex),
      id: model.id,
      name: label(model.name, model.id),
      provider: group.id,
      route: { provider: group.id, model: model.id },
      group,
      model,
      current: current?.provider === group.id && current?.model === model.id,
    }));
    const row = {
      kind: assignment ? 'entry' : 'provider',
      key: rowKey,
      id: group.id,
      provider: group.id,
      name: assignment?.name ?? label(group.provider?.name, label(group.name, group.id)),
      group,
      models,
      modelCount: models.length,
      current: current?.provider === group.id,
    };
    if (!assignment) {
      roots.push(row);
      continue;
    }
    const { plan, entryId } = assignment;
    row.groupId = plan.groupId;
    row.entryId = entryId;
    row.key = key('entry', plan.groupId, entryId);
    if (!containers.has(plan.groupId)) {
      const container = {
        kind: 'group', key: key('group', plan.groupId), id: plan.groupId,
        groupId: plan.groupId, name: plan.name, children: [], modelCount: 0, current: false,
      };
      containers.set(plan.groupId, container);
      roots.push(container);
    }
    const container = containers.get(plan.groupId);
    container.children.push(row);
    container.modelCount += models.length;
    container.current ||= row.current;
  }
  return roots;
}

/**
 * Compatibility view for the existing hierarchy renderer/search helpers.
 * Display containers use kind:'multi'; child `id` and original model objects
 * remain native, so visibleHierarchyModels emits actual provider/raw-model
 * routes. Preferences are a display-only { [key]: boolean } record; by default
 * only the current provider's ancestor and child are expanded.
 */
export function buildNativeHierarchy(directoryGroups, metadata, preferences = {}, current = null) {
  const expanded = (row) => {
    const saved = own(preferences, row.key);
    return typeof saved === 'boolean' ? saved : row.current;
  };
  return buildNativeGroups(directoryGroups, metadata, current).map(root => {
    if (root.kind !== 'group') {
      return {
        kind: 'provider', key: root.key, id: root.id, name: root.name,
        group: root.group, current: root.current, expanded: expanded(root),
        modelCount: root.modelCount,
      };
    }
    return {
      kind: 'multi', key: root.key, id: root.id, groupId: root.groupId,
      name: root.name, current: root.current, expanded: expanded(root),
      modelCount: root.modelCount,
      children: root.children.map(child => ({
        ...child.group,
        key: child.key, entryId: child.entryId, groupId: child.groupId,
        name: child.name, group: child.group, current: child.current,
        expanded: expanded(child),
      })),
    };
  });
}
