import { decodeKeyModelId, KEY_MODEL_PREFIX, orderedKeyEntries } from '../hierarchy.js';
import { materializeCapabilityEntry } from '../capability-defaults.js';

const PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const RAW_SECRET_FIELDS = new Set(['apiKey', 'apiKeyValue', 'password', 'api_key', 'accessToken', 'secret']);
const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cf-aig-authorization']);
const hasRawSecret = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => RAW_SECRET_FIELDS.has(key) || hasRawSecret(child));

/** Project reviewable card data, including malformed or unactivated legacy data.
 * The complete internal Settings tree is separately marked secret.
 */
export function publicBridgeEntries(entries) {
  const project = (value, headers = false) => Array.isArray(value) ? value.map(item => project(item))
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([key]) => !RAW_SECRET_FIELDS.has(key) && (!headers || !AUTH_HEADERS.has(key.toLowerCase())))
      .map(([key, child]) => [key, project(child, key === 'headers')])) : value;
  return project(entries ?? {});
}

const unsafe = value => ['__proto__', 'prototype', 'constructor'].includes(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => structuredClone(value);
const fail = code => { const error = new Error(code); error.code = code; throw error; };

export function bridgeAlias(entryId, modelId) {
  const alias = `${KEY_MODEL_PREFIX}${encodeURIComponent(entryId)}/${encodeURIComponent(modelId)}`;
  if (!decodeKeyModelId(alias)) fail('INVALID_MODEL_IDENTITY');
  return alias;
}

/** Validate plugin-owned data without interpreting credentials or contacting a provider. */
export function validateBridgeDraft(draft) {
  if (!plain(draft) || typeof draft.enabled !== 'boolean' || !plain(draft.keyEntries)) fail('INVALID_BRIDGE_CONFIG');
  const result = { enabled: draft.enabled, keyEntries: {} };
  for (const [entryId, entry] of orderedKeyEntries(draft.keyEntries)) {
    if (unsafe(entryId) || !plain(entry)) fail('INVALID_KEY_ENTRY');
    bridgeAlias(entryId, 'identity-check');
    if (entry.api !== undefined && !PROTOCOLS.has(entry.api)) fail('INVALID_PROTOCOL');
    if (hasRawSecret(entry)) fail('USE_CREDENTIAL_REFERENCE');
    if (entry.apiKeyEnv !== undefined && (typeof entry.apiKeyEnv !== 'string' || !entry.apiKeyEnv.trim() || entry.apiKeyEnv.length > 256 || /[\r\n\0]/.test(entry.apiKeyEnv))) fail('INVALID_CREDENTIAL_REFERENCE');
    if (entry.baseURL !== undefined && entry.baseURL !== '') {
      let url;
      try { url = new URL(entry.baseURL); } catch { fail('INVALID_ENDPOINT'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) fail('INVALID_ENDPOINT');
    }
    if (!Array.isArray(entry.models)) fail('INVALID_MODELS');
    const seen = new Set();
    for (const model of entry.models) {
      if (!plain(model) || typeof model.id !== 'string' || !model.id.trim() || model.id !== model.id.trim() || model.id.length > 1024 || model.id.startsWith(KEY_MODEL_PREFIX) || seen.has(model.id)) fail('INVALID_MODELS');
      bridgeAlias(entryId, model.id);
      seen.add(model.id);
      for (const field of ['contextWindow', 'maxTokens']) if (model[field] !== undefined && (!Number.isSafeInteger(model[field]) || model[field] < 1)) fail('INVALID_MODEL_CAPABILITY');
      if (model.input !== undefined && (!Array.isArray(model.input) || !model.input.length || model.input.some(value => !['text', 'image'].includes(value)))) fail('INVALID_MODEL_CAPABILITY');
    }
    for (const headers of [entry.headers, ...entry.models.map(model => model.headers)]) {
      if (headers !== undefined && !plain(headers)) fail('INVALID_HEADERS');
      try { new Headers(headers ?? {}); } catch { fail('INVALID_HEADERS'); }
      if (Object.keys(headers ?? {}).some(name => AUTH_HEADERS.has(name.toLowerCase()))) fail('USE_CREDENTIAL_REFERENCE');
    }
    try { result.keyEntries[entryId] = materializeCapabilityEntry(copy(entry)); }
    catch { fail('INVALID_MODEL_CAPABILITY'); }
  }
  if (draft.enabled && !Object.keys(result.keyEntries).length) fail('EMPTY_KEY_ENTRIES');
  return result;
}

/** Only fields the original, unmodified provider schema already supports. */
export function bridgeModelProjection(id, model) {
  const result = { id };
  for (const field of ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']) {
    if (model[field] !== undefined) result[field] = copy(model[field]);
  }
  return result;
}

/**
 * Use ordinary native models as directory/admission identities. Execution is
 * intercepted by the public LLM stream extension; no HTTP gateway is required.
 * The closed endpoint prevents a removed interceptor from sending aliases and
 * the selected key to an upstream service.
 */
export function createBridgeProjection(original, draft, { guardCredential, models, projectionMode = 'ordinary', routing } = {}) {
  const config = validateBridgeDraft(draft);
  if (!config.enabled) fail('BRIDGE_DISABLED');
  if (typeof guardCredential !== 'string' || !guardCredential) fail('GUARD_CREDENTIAL_REQUIRED');
  if (!['ordinary', 'legacy'].includes(projectionMode)) fail('BRIDGE_RUNTIME_UNAVAILABLE');
  const projected = copy(original ?? {});
  delete projected.multiKey;
  delete projected.keyEntries;
  projected.api = 'openai-completions';
  projected.baseURL = 'http://127.0.0.1:1/dsh-model-groups-disabled';
  projected.apiKeyEnv = guardCredential;
  projected.headers = {};
  delete projected.compat;
  delete projected.modelOverrides;
  delete projected.reasoning;
  delete projected.thinkingBudgets;
  projected.models = [];
  const identities = new Set();
  const push = (id, metadata) => {
    if (identities.has(id)) fail('DUPLICATE_MODEL_IDENTITY');
    identities.add(id);
    projected.models.push(bridgeModelProjection(id, metadata));
  };
  // Production routes are immutable aliases, including the original root.
  // Unversioned support remains only for historical fixture/probe composition.
  if (routing === undefined) for (const model of models?.legacy ?? original?.models ?? []) push(model.id, model);
  if (projectionMode === 'legacy') {
    projected.multiKey = true;
    projected.keyEntries = {};
  }
  const routes = routing === undefined ? Object.keys(config.keyEntries).map(id => [id, id]) : Object.entries(routing);
  for (const [token, entryId] of routes) {
    const entry = entryId === null ? { name: '原单密钥（兼容旧会话）' } : config.keyEntries[entryId];
    if (!entry) fail('INVALID_KEY_ENTRY');
    const resolved = entryId === null ? models?.legacy : models?.keyEntries?.[entryId];
    if (models !== undefined && !Array.isArray(resolved)) fail('MODEL_CAPABILITIES_REQUIRED');
    if (projectionMode === 'legacy') {
      projected.keyEntries[token] = {
        name: entry.name ?? entryId, sortOrder: entry.sortOrder ?? 0,
        api: 'openai-completions', apiKeyEnv: guardCredential,
        models: (resolved ?? entry.models).map(model => bridgeModelProjection(model.id, model)),
      };
    } else {
      for (const model of resolved ?? entry.models) push(bridgeAlias(token, model.id), model);
    }
  }
  return projected;
}

/** Compare JSON values independently of dictionary insertion order. */
export function sameBridgeValue(left, right) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
