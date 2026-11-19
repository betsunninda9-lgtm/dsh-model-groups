import { materializeCapabilityEntry } from '../capability-defaults.js';

export const copyEditorValue = value => JSON.parse(JSON.stringify(value));
export function sameEditorValue(left, right) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export function bridgeEditorDraft(record) {
  const keyEntries = {};
  for (const [id, entry] of Object.entries(record?.keyEntries ?? {})) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) continue;
    keyEntries[id] = materializeCapabilityEntry({
      name: typeof entry?.name === 'string' ? entry.name : id,
      ...Object.fromEntries(['api', 'baseURL', 'headers', 'capabilityDefaults', 'capabilityBatch', 'sortOrder'].filter(key => entry?.[key] !== undefined).map(key => [key, copyEditorValue(entry[key])])),
      ...(typeof entry?.apiKeyEnv === 'string' && entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
      models: Array.isArray(entry?.models) ? copyEditorValue(entry.models) : [],
    });
  }
  return { enabled: record?.enabled === true, keyEntries,
    singleKey: { apiKeyEnv: record?.singleKey?.apiKeyEnv ?? '', models: copyEditorValue(record?.singleKey?.models ?? []) },
    shared: { displayName: record?.shared?.displayName ?? '', api: record?.shared?.api ?? '', baseURL: record?.shared?.baseURL ?? '', headersText: JSON.stringify(record?.shared?.headers ?? {}, null, 2) } };
}
export function editorSharedValue(draft) {
  const headers = JSON.parse(draft.shared.headersText || '{}');
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some(value => typeof value !== 'string')) throw new Error('INVALID_HEADERS');
  return { displayName: draft.shared.displayName.trim() || null, api: draft.shared.api || null, baseURL: draft.shared.baseURL.trim(), headers };
}
function semanticEditorDraft(draft) {
  let shared;
  try { shared = editorSharedValue(draft); } catch { shared = { invalidHeadersText: draft.shared.headersText, ...draft.shared }; }
  return { enabled: draft.enabled, shared, singleKey: draft.singleKey,
    // Dictionary field order is irrelevant, but a user's group order is real.
    keyEntries: Object.entries(draft.keyEntries).map(([id, entry]) => [id, materializeCapabilityEntry(entry)]) };
}
export const bridgeEditorChanged = (draft, baseline) => !sameEditorValue(semanticEditorDraft(draft), semanticEditorDraft(baseline));
export function editorFieldPatch(next, before) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => !sameEditorValue(value, before[key])));
}
export function singleKeyReference(route) {
  const stem = String(route).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `${/^[A-Z_]/.test(stem) ? stem : `DSH_${stem}`}_API_KEY`;
}
