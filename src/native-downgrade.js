import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { decodeKeyModelId } from './hierarchy.js';

const fail = code => { throw new Error(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const reserved = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const hasExpression = value => value && typeof value === 'object' && (Object.hasOwn(value, '__jsExpr') || Object.values(value).some(hasExpression));

/** Pure preview only. No settings writes, credential access, session changes or patch removal.
 * Explicit api/baseURL/models required: changing provider identity loses catalog defaults.
 * Caller must validate the result with the original host schema before committing anything.
 */
export function planNativeDowngrade(providers, { allowExistingExact = false } = {}) {
  if (!plain(providers) || hasExpression(providers)) fail('DOWNGRADE_UNSUPPORTED_CONFIG');
  const result = structuredClone(providers), routes = [];
  for (const [provider, source] of Object.entries(providers)) {
    if (reserved(provider) || !plain(source)) fail('DOWNGRADE_INVALID_PROVIDER');
    const entries = source.keyEntries ?? {};
    if (!plain(entries)) fail('DOWNGRADE_INVALID_ENTRIES');
    if (Object.keys(entries).length && source.multiKey !== true) fail('DOWNGRADE_DISABLED_ENTRIES');
    for (const [entryId, entry] of Object.entries(entries)) {
      if (!decodeKeyModelId(`@dsh-key/${encodeURIComponent(entryId)}/probe`) || !plain(entry)
        || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 120
        || typeof entry.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyEnv)
        || !Array.isArray(entry.models) || !entry.models.length) fail('DOWNGRADE_INVALID_ENTRY');
      if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(source.api) || typeof source.baseURL !== 'string' || !source.baseURL) fail('DOWNGRADE_CATALOG_DEFAULTS_REQUIRED');
      if (Object.keys(source.headers ?? {}).some(name => ['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cf-aig-authorization', 'x-goog-api-key'].includes(name.toLowerCase()))) fail('DOWNGRADE_AUTH_HEADER_OVERRIDE');
      const ids = new Set();
      for (const model of entry.models) {
        if (!plain(model) || typeof model.id !== 'string' || !model.id || model.id.startsWith('@dsh-key/') || ids.has(model.id)) fail('DOWNGRADE_INVALID_MODELS');
        ids.add(model.id);
        // Catalog-only metadata must be materialized by a trusted host adapter first.
        if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0
          || !Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0
          || !Array.isArray(model.input) || !model.input.length || model.input.some(mode => !['text', 'image'].includes(mode))
          || !(model.reasoningEfforts === false || (plain(model.reasoningEfforts) && Object.keys(model.reasoningEfforts).length > 0
            && Object.entries(model.reasoningEfforts).every(([level, wire]) => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level) && (typeof wire === 'string' || (level === 'off' && wire === null)))))) fail('DOWNGRADE_MODEL_DEFAULTS_REQUIRED');
        if (Object.keys(model).some(key => !['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat'].includes(key))) fail('DOWNGRADE_UNREPRESENTABLE_MODEL');
      }
      const suffix = crypto.createHash('sha256').update(JSON.stringify([provider, entryId])).digest('hex').slice(0, 32);
      const target = `mg-${suffix}`;
      const { multiKey, keyEntries, modelOverrides, ...shared } = source;
      const child = { ...structuredClone(shared), displayName: `${source.displayName || provider} · ${entry.name}`, apiKeyEnv: entry.apiKeyEnv, models: structuredClone(entry.models) };
      if (Object.hasOwn(result, target) && !(allowExistingExact && isDeepStrictEqual(result[target], child))) fail('DOWNGRADE_PROVIDER_COLLISION');
      result[target] = child;
      routes.push({ provider, entryId, target, models: [...ids] });
    }
    // Retain the legacy route and its credential; never silently choose the first key.
    delete result[provider].multiKey;
    delete result[provider].keyEntries;
  }
  const groups = {};
  for (const route of routes) {
    // Container IDs are plugin-only labels; stable child IDs remain native routes.
    const groupId = `group-${crypto.createHash('sha256').update(route.provider).digest('hex').slice(0, 32)}`;
    const source = providers[route.provider];
    groups[groupId] ??= { name: source.displayName || route.provider, entries: {} };
    groups[groupId].entries[route.entryId] = { name: source.keyEntries[route.entryId].name, provider: route.target };
  }
  return { providers: result, routes, metadata: { groups } };
}

/** Convert only an exact selected route. Never rewrite historical messages. */
export function downgradeSelection(selection, plan) {
  if (!plain(selection) || typeof selection.provider !== 'string' || typeof selection.model !== 'string') fail('DOWNGRADE_INVALID_SELECTION');
  if (!selection.model.startsWith('@dsh-key/')) return structuredClone(selection);
  const alias = decodeKeyModelId(selection.model);
  const route = alias && plan.routes.find(item => item.provider === selection.provider && item.entryId === alias.entryId);
  if (!route || !route.models.includes(alias.modelId)) fail('DOWNGRADE_UNKNOWN_ROUTE');
  return { ...structuredClone(selection), provider: route.target, model: alias.modelId };
}
