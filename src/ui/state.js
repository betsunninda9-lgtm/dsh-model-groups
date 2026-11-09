// Pure UI transformations. Route IDs and effort IDs are never inferred from labels.
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
export function selectionFor(current, provider, model) {
  if (current?.provider === provider && current.model === model.id) return { ...current };
  return { provider, model: model.id, ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }) };
}
export function withEffort(current, effort) {
  const { reasoningEffort: ignored, ...selection } = current;
  return { ...selection, ...(effort === undefined ? {} : { reasoningEffort: effort }) };
}
export function groupDirectory(catalog, config, query = '') {
  const owners = new Map();
  for (const [id, group] of Object.entries(config?.groups || {})) {
    for (const [route, entry] of Object.entries(group.entries || {})) owners.set(route, { id, group, entry });
  }
  const suppliers = new Map();
  const q = query.trim().toLocaleLowerCase();
  // Keep official/account providers first, and preserve catalog order otherwise.
  const ordered = [...catalog].sort((a, b) => Number(['deepseek-account', 'deepseek'].includes(b.id)) - Number(['deepseek-account', 'deepseek'].includes(a.id)));
  for (const provider of ordered) {
    const owner = owners.get(provider.id);
    const id = owner?.id ?? `provider:${provider.id}`;
    const name = owner?.group.name || provider.name || provider.id;
    const entryName = owner?.entry.name || provider.name || provider.id;
    const models = provider.models.filter(model => !q || `${name} ${entryName} ${provider.id} ${model.name || ''} ${model.id}`.toLocaleLowerCase().includes(q));
    if (!models.length) continue;
    if (!suppliers.has(id)) suppliers.set(id, { id, name, entries: [] });
    suppliers.get(id).entries.push({ route: provider.id, name: entryName, models });
  }
  return [...suppliers.values()];
}
export function parseModels(text) {
  return [...new Set(text.split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
}
export function newId(prefix, crypto = globalThis.crypto) {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  // getRandomValues remains available on ordinary HTTP LAN origins, unlike randomUUID.
  // Use cryptographic entropy and RFC 4122 variant/version bits, never Math.random.
  if (!crypto?.getRandomValues) throw new Error('Cryptographic random values are unavailable in this browser.');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function copyConfig(value) {
  return structuredClone({ groups: value?.groups || {}, tombstones: value?.tombstones || {} });
}
export function removeEntry(config, groupId, route) {
  const next = copyConfig(config);
  delete next.groups[groupId].entries[route];
  next.tombstones[route] = true;
  return next;
}
export function removeGroup(config, groupId) {
  const next = copyConfig(config);
  for (const route of Object.keys(next.groups[groupId].entries)) next.tombstones[route] = true;
  delete next.groups[groupId];
  return next;
}
export function configOperations(config) {
  return [{ op: 'set', path: ['groups'], value: config.groups }, { op: 'set', path: ['tombstones'], value: config.tombstones }];
}
