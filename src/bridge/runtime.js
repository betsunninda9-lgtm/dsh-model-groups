import { randomUUID } from 'node:crypto';
import { remapBridgeHistory } from './dispatch.js';
import { materializeCapabilityEntry } from '../capability-defaults.js';

const copy = value => structuredClone(value);
const owns = (value, key) => Object.hasOwn(value ?? {}, key);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cf-aig-authorization']);
const originalProfile = value => value && owns(value, 'present') ? value.profile : value;

/** An entry never borrows the root key or a credential-bearing request header. */
export function bridgeExecutionProfile(original, entry) {
  const root = copy(originalProfile(original) ?? {});
  delete root.multiKey;
  delete root.keyEntries;
  if (entry === undefined) return root;
  entry = materializeCapabilityEntry(copy(entry));
  if (typeof entry.apiKeyEnv !== 'string' || !entry.apiKeyEnv.trim()) fail('MISSING_CREDENTIAL');
  const profile = { ...root, ...copy(entry), apiKeyEnv: entry.apiKeyEnv, models: copy(entry.models ?? []) };
  if (!entry.baseURL) {
    if (root.baseURL) profile.baseURL = root.baseURL;
    else delete profile.baseURL;
  }
  if (profile.api === 'anthropic-messages' && typeof profile.baseURL === 'string') {
    // Anthropic's SDK appends /v1/messages itself. Normalize only the selected
    // entry's effective URL, preserving prefixes, query parameters and root config.
    try {
      const url = new URL(profile.baseURL);
      if (/\/v1\/?$/.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/v1\/?$/, '') || '/';
        profile.baseURL = url.toString();
      }
    } catch { /* Keep malformed URLs for the official profile validator. */ }
  }
  profile.headers = { ...root.headers, ...entry.headers };
  delete profile.modelOverrides;
  for (const headers of [root.headers, entry.headers, ...profile.models.map(model => model.headers)]) {
    for (const name of Object.keys(headers ?? {})) if (AUTH_HEADERS.has(name.toLowerCase())) fail('AUTH_HEADER_CONFLICT');
  }
  for (const field of ['name', 'sortOrder', 'capabilityDefaults', 'capabilityBatch', 'multiKey', 'keyEntries']) delete profile[field];
  if (entry.name) profile.displayName = entry.name;
  return profile;
}

/** Only native, protocol-neutral directory fields are projected onto the outer adapter. */
export function bridgeDirectoryModel(info, declared = {}, profile = {}) {
  const model = { id: info.id, name: info.name ?? declared.name ?? info.id };
  const contextWindow = info.context?.contextWindow ?? declared.contextWindow ?? profile.defaultContextWindow;
  if (Number.isSafeInteger(contextWindow) && contextWindow > 0) model.contextWindow = contextWindow;
  const maxTokens = info.defaultMaxTokens ?? declared.maxTokens;
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) model.maxTokens = maxTokens;
  if (Array.isArray(info.inputModalities)) model.input = [...info.inputModalities];
  else if (Array.isArray(declared.input)) model.input = [...declared.input];
  const efforts = info.reasoning?.efforts;
  model.reasoningEfforts = Array.isArray(efforts) && efforts.length
    ? Object.fromEntries(efforts.map(effort => [effort.id, effort.id === 'off' ? null : effort.id]))
    : false;
  return model;
}

/**
 * Public Cordis isolation hosts the installed official pi-ai plugin unchanged.
 * Each immutable profile owns a separate LLM/settings/authorization scope, while
 * credentials, attachments, fs and request-header extensions stay inherited.
 * No adapter maps, prototypes, source files or loader entries are rewritten.
 */
export function createBridgeRuntime(ctx, { loadModule, discoverEndpoint, maxIdle = 24 } = {}) {
  const load = loadModule ?? (specifier => {
    const loader = ctx.get?.('loader');
    return typeof loader?.import === 'function' ? loader.import(specifier) : import(specifier);
  });
  const lifetime = new AbortController();
  const slots = new Map();
  let modules;
  let disposed = false;
  let disposing;
  async function dependencies() {
    if (!modules) modules = Promise.all([load('@deepseek-ai/dsh-llm'), load('@deepseek-ai/dsh-llm-pi-ai')]).then(([llm, pi]) => {
      if (typeof ctx.isolate !== 'function' || typeof llm.LlmRuntime !== 'function' || typeof pi.apply !== 'function' || typeof pi.Config !== 'function') fail('BRIDGE_RUNTIME_UNAVAILABLE');
      return { LlmRuntime: llm.LlmRuntime, pi };
    });
    return modules;
  }
  async function open(provider, profile) {
    const { LlmRuntime, pi } = await dependencies();
    if (disposed) fail('BRIDGE_RUNTIME_UNAVAILABLE');
    const scope = ctx.isolate('llm').isolate('settings').isolate('authorization');
    let llm;
    const fiber = scope.plugin({ name: 'model-groups-private-runtime', apply(child) {
      llm = new LlmRuntime(child);
      pi.apply(child, pi.Config({ providers: { [provider]: profile } }));
    } });
    try {
      await fiber;
      if (!llm || disposed) fail('BRIDGE_RUNTIME_UNAVAILABLE');
      return { llm, fiber };
    } catch (error) {
      await fiber.dispose();
      throw error;
    }
  }
  async function trim() {
    let idle = [...slots.values()].filter(slot => slot.refs === 0);
    while (idle.length > maxIdle) {
      const slot = idle.shift();
      slots.delete(slot.key);
      try { await (await slot.promise).fiber.dispose(); } catch { /* A failed creation is already cleaned up. */ }
    }
  }
  async function acquire(provider, profile) {
    if (disposed) fail('BRIDGE_RUNTIME_UNAVAILABLE');
    // This key is process-private and is never included in diagnostics or paths.
    const key = JSON.stringify([provider, profile]);
    let slot = slots.get(key);
    if (!slot) {
      slot = { key, refs: 0, promise: open(provider, copy(profile)) };
      slots.set(key, slot);
    } else {
      slots.delete(key);
      slots.set(key, slot);
    }
    slot.refs += 1;
    try {
      const runtime = await slot.promise;
      return { ...runtime, release: async () => { slot.refs -= 1; await trim(); } };
    } catch (error) {
      slot.refs -= 1;
      if (slots.get(key) === slot) slots.delete(key);
      throw error;
    }
  }
  async function models(provider, profile) {
    const held = await acquire(provider, profile);
    try {
      const listed = profile.models?.length ? profile.models : await held.llm.listModels(provider);
      const result = [];
      for (const listedModel of listed) {
        const info = await held.llm.resolveModelInfo(provider, listedModel.id);
        result.push(bridgeDirectoryModel(info, listedModel, profile));
      }
      return result;
    } finally { await held.release(); }
  }
  async function prepare(provider, draft, original) {
    let legacy = [];
    if (original !== undefined) {
      try { legacy = await models(provider, bridgeExecutionProfile(original)); }
      catch (error) {
        // Entry-only providers can deliberately have no root model or key,
        // including a migrated configuration whose native multi-key flag was
        // cleared when it was closed. Every selected entry is validated below.
        const root = originalProfile(original);
        const entryOnly = Array.isArray(root?.models) && root.models.length === 0
          && Object.values(draft.keyEntries ?? {}).some(entry => Array.isArray(entry?.models) && entry.models.length > 0);
        if (!entryOnly) throw error;
      }
    }
    const keyEntries = {};
    for (const [entryId, entry] of Object.entries(draft.keyEntries ?? {})) {
      // An empty list means no alias is exposed, never the provider's catalog.
      keyEntries[entryId] = entry.models?.length ? await models(provider, bridgeExecutionProfile(original, entry)) : [];
    }
    return { models: { legacy, keyEntries } };
  }
  async function normalizeProfile(provider, profile) {
    const { pi } = await dependencies();
    const configured = pi.Config({ providers: { [provider]: copy(profile) } });
    const providers = typeof configured.providers?.get === 'function' ? configured.providers.get() : configured.providers;
    return JSON.parse(JSON.stringify(providers[provider]));
  }
  async function probeProjection(provider, profile, modelId) {
    let held;
    try {
      held = await acquire(provider, profile);
      const info = await held.llm.resolveModelInfo(provider, modelId);
      if (info?.id !== modelId || info?.provider !== provider) fail('BRIDGE_PROJECTION_UNSUPPORTED');
      return true;
    } catch {
      fail('BRIDGE_PROJECTION_UNSUPPORTED');
    } finally { await held?.release(); }
  }
  async function* execute({ snapshot, provider, entryId, model, publicModel, options }) {
    if (entryId !== undefined && !owns(snapshot.keyEntries, entryId)) fail('UNKNOWN_KEY_ENTRY');
    const entry = entryId === undefined ? undefined : snapshot.keyEntries[entryId];
    if (entry && !entry.models?.some(item => item.id === model)) fail('UNKNOWN_MODEL');
    const profile = bridgeExecutionProfile(snapshot.original, entry);
    const held = await acquire(provider, profile);
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
    try {
      signal.throwIfAborted();
      const config = { provider, model };
      for (const field of ['reasoningEffort', 'temperature', 'maxTokens', 'stop']) if (options[field] !== undefined) config[field] = options[field];
      const prepared = await held.llm.prepareCall(config, signal);
      const messages = remapBridgeHistory(options.messages, { provider, publicModel, executionProvider: provider, model });
      const request = Object.create(Object.getPrototypeOf(options), {
        ...Object.getOwnPropertyDescriptors(options),
        ...Object.getOwnPropertyDescriptors({ ...prepared.config, messages, signal }),
      });
      yield* prepared.stream(request);
    } finally { await held.release(); }
  }
  async function discover(provider, entryId, entry, original, signal, { apiKey } = {}) {
    if (disposed) fail('BRIDGE_RUNTIME_UNAVAILABLE');
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    const profile = bridgeExecutionProfile(original, entry);
    if (!profile.api) fail('DISCOVERY_PROTOCOL_REQUIRED');
    if (!profile.baseURL) {
      profile.baseURL = ctx.get?.('llm')?.listConfigurableProviders?.().find(row => row.provider === provider)?.defaultBaseURL;
    }
    if (!profile.baseURL) fail('DISCOVERY_ENDPOINT_REQUIRED');
    if (typeof discoverEndpoint === 'function') return discoverEndpoint({ provider, entryId, profile, signal, ctx, ...(apiKey === undefined ? {} : { apiKey }) });
    if (apiKey !== undefined) fail('DISCOVERY_UNSUPPORTED');
    // Legacy public discovery implementations may send only Bearer authentication.
    // Anthropic must use the protocol-aware endpoint hook, never silently use that path.
    if (profile.api === 'anthropic-messages') fail('DISCOVERY_UNSUPPORTED');
    // A private noncatalog route makes explicit-endpoint discovery deterministic
    // even on hosts whose public discovery gives known catalog routes priority.
    const route = `@dsh-model-groups/discovery/${randomUUID()}`;
    const held = await acquire(route, { ...profile, models: [{ id: '__discovery_only__' }] });
    try {
      const settingsNs = held.llm.listConfigurableProviders().find(row => row.provider === route)?.settingsNs;
      if (!settingsNs || typeof held.llm.discoverModels !== 'function') fail('BRIDGE_RUNTIME_UNAVAILABLE');
      return await held.llm.discoverModels(settingsNs, { provider: route, api: profile.api, baseURL: profile.baseURL }, signal);
    } finally { await held.release(); }
  }
  async function dispose() {
    if (disposing) return disposing;
    disposed = true;
    lifetime.abort();
    const pending = [...slots.values()];
    slots.clear();
    disposing = Promise.allSettled(pending.map(async slot => (await slot.promise).fiber.dispose())).then(() => undefined);
    return disposing;
  }
  ctx.effect?.(() => () => dispose());
  return { prepare, normalizeProfile, probeProjection, execute, discover, dispose };
}
