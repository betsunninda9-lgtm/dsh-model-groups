// Only display preferences live here; no models, credentials, or session data.
export const STORAGE_KEY = 'dsh:model-groups:v1';
export const MODE_STORAGE_KEY = 'dsh:model-groups:mode';

export function getMenuMode(getStorage = () => globalThis.localStorage) {
  try {
    const val = getStorage()?.getItem(MODE_STORAGE_KEY);
    return val === 'inline' ? 'inline' : 'panel';
  } catch {
    return 'panel';
  }
}

export function setMenuMode(mode, getStorage = () => globalThis.localStorage) {
  try {
    getStorage()?.setItem(MODE_STORAGE_KEY, mode === 'inline' ? 'inline' : 'panel');
  } catch { /* private mode */ }
}

export function parsePreferences(text) {
  try {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !value.expanded || Array.isArray(value.expanded)) return {};
    return Object.fromEntries(Object.entries(value.expanded).filter(([, expanded]) => typeof expanded === 'boolean'));
  } catch {
    return {};
  }
}

export function isGroupExpanded(preferences, providerId, currentProvider) {
  return Object.hasOwn(preferences, providerId) ? preferences[providerId] : providerId === currentProvider;
}

/** Search reveals matching models without changing the saved group preference. */
export function visibleModelGroups(groups, preferences, currentProvider, searching) {
  return groups.map(group => ({
    ...group,
    expanded: searching || isGroupExpanded(preferences, group.id, currentProvider),
  }));
}

/** A storage failure degrades to in-memory preferences, never breaks the picker. */
export function createGroupPreferences(getStorage = () => globalThis.localStorage) {
  let preferences = {};
  const listeners = new Set();
  const publish = next => {
    preferences = next;
    for (const listener of listeners) listener();
  };
  try { preferences = parsePreferences(getStorage()?.getItem(STORAGE_KEY)); } catch { /* private mode */ }
  return {
    getSnapshot: () => preferences,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setExpanded(providerIds, expanded) {
      const next = { ...preferences, ...Object.fromEntries(providerIds.map(id => [id, expanded])) };
      publish(next);
      try { getStorage()?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, expanded: next })); } catch { /* quota / private mode */ }
    },
    sync(text) { publish(parsePreferences(text)); },
  };
}
