import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { LlmError, resolveRetryPolicy, assertUsableApiKey } from '@deepseek-ai/dsh-llm';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { createProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { namespace, validateConfig } from './config.js';

const factories = { 'openai-completions': openAICompletionsApi, 'openai-responses': openAIResponsesApi, 'anthropic-messages': anthropicMessagesApi };
export function profileFor(group, entry, route) {
  const models = entry.models.map(id => ({ id, name: id, api: group.api, provider: route, baseUrl: group.baseURL, reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }));
  const piProvider = createProvider({ id: route, name: `${group.name} / ${entry.name}`, baseUrl: group.baseURL, models, api: factories[group.api](), auth: { apiKey: { name: 'Configuration credential', resolve: async ({ credential }) => ({ auth: credential?.key ? { apiKey: credential.key } : {} }) } } });
  return { provider: route, displayName: `${group.name} / ${entry.name}`, api: group.api, baseURL: group.baseURL, piProvider, modelErrors: new Map(), configuredMaxTokens: new Map(), streamIdleTimeoutMs: 300000, maxRequestImageBytes: 20971520, maxRequestImages: 50, imageOffloadCountQuantum: 10, requestImagePixelBudget: 4194304, requestImageMaxBytes: 1048576, retryPolicy: resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, namespace) };
}

// The SDK receives the combined signal; already-transmitted bytes cannot be recalled.
class OwnedAdapter extends PiAiAdapter {
  active = new Set();
  async *tracked(stream, options) {
    const controller = new AbortController();
    this.active.add(controller);
    try { yield* stream({ ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal }); }
    finally { this.active.delete(controller); }
  }
  async prepareCall(...args) {
    const prepared = await super.prepareCall(...args);
    return { ...prepared, stream: options => this.tracked(prepared.stream, options) };
  }
  stream(options) { return this.tracked(value => super.stream(value), options); }
  revoke() { for (const controller of this.active) controller.abort(); }
}

export function mountRoutes(ctx, initial, settingsNs = namespace) {
  let disposed = false;
  let current = { groups: {}, tombstones: {} };
  let directory;
  const routes = new Map();
  function prepare(input) {
    const config = validateConfig(input, current);
    const candidates = new Map();
    for (const [groupId, group] of Object.entries(config.groups)) for (const [route, entry] of Object.entries(group.entries)) {
      const signature = JSON.stringify([group.name, group.baseURL, group.api, entry]);
      const existing = routes.get(route);
      candidates.set(route, { groupId, signature, profile: existing?.signature === signature ? existing.profile : profileFor(group, entry, route) });
    }
    const foreign = new Set(ctx.llm.listProviders().map(item => item.id).filter(id => !routes.has(id)));
    const foreignDirectory = new Set(ctx.llm.listConfigurableProviders().filter(item => item.settingsNs !== settingsNs).map(item => item.provider));
    for (const route of candidates.keys()) if (foreign.has(route) || foreignDirectory.has(route)) throw new Error('Provider route collision');
    return { config, candidates };
  }
  function add(route, candidate) {
    const row = { ...candidate, profiles: new Map([[route, candidate.profile]]) };
    row.adapter = new OwnedAdapter({
      profiles: () => row.profiles,
      resolveApiKey: async (provider, preparedProfile) => {
        function check() {
          if (disposed || routes.get(provider) !== row) throw new LlmError('Configuration is unavailable', 'MISSING_CREDENTIAL');
          if (row.profile !== preparedProfile) throw new LlmError('Configuration changed; prepare this request again', 'STALE_CONFIGURATION');
        }
        check();
        const record = await ctx.credentials.readRecord(credentialKey(namespace, provider));
        check();
        if (record?.kind !== 'api-key' || typeof record.key !== 'string' || !record.key) throw new LlmError('Configuration has no credential', 'MISSING_CREDENTIAL');
        return assertUsableApiKey(record.key, namespace, 'configuration');
      },
      auth: { credentials: new InMemoryCredentialStore(), authContext: { env: async () => undefined, fileExists: async () => false } },
    });
    routes.set(route, row);
    try { row.registration = ctx.llm.registerAdapter([route], row.adapter); }
    catch (error) { routes.delete(route); throw error; }
    return row;
  }
  function update(input) {
    if (disposed) throw new Error('Disposed plugin');
    const { config, candidates } = prepare(input);
    const entries = [...candidates].map(([provider, candidate]) => ({ provider, displayName: candidate.profile.displayName, settingsNs, settingsPath: ['groups', candidate.groupId, 'entries', provider], declared: true }));
    const added = [];
    try {
      for (const [route, candidate] of candidates) if (!routes.has(route)) { add(route, candidate); added.push(route); }
      // Public directory replacement validates atomically. Existing profiles have not changed yet.
      if (directory) directory.replace(entries);
      else if (entries.length) directory = ctx.llm.registerConfigurableProviders(entries);
    } catch (error) {
      for (const route of added.reverse()) { const row = routes.get(route); routes.delete(route); row.adapter.revoke(); row.registration(); }
      throw error;
    }
    const changed = new Set(added);
    for (const [route, row] of routes) {
      const candidate = candidates.get(route);
      if (!candidate) { routes.delete(route); row.adapter.revoke(); row.registration(); changed.add(route); }
      else if (candidate.profile !== row.profile) { Object.assign(row, candidate); row.profiles = new Map([[route, row.profile]]); row.adapter.revoke(); changed.add(route); }
    }
    current = config;
    for (const route of changed) { try { ctx.emit('llm/models-updated', route); } catch { /* A listener cannot undo a completed registration. */ } }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const row of routes.values()) { row.adapter.revoke(); row.registration(); }
    routes.clear(); directory?.();
  }
  try { update(initial); } catch (error) { dispose(); throw error; }
  ctx.on('dispose', dispose);
  function invalidateCredential(route) {
    const row = routes.get(route);
    if (!row) return;
    row.profile = { ...row.profile };
    row.profiles = new Map([[route, row.profile]]);
    row.adapter.revoke();
  }
  return { update, prepare, dispose, routes, invalidateCredential, snapshot: () => structuredClone(current) };
}
