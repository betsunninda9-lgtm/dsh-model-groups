import { createBridgeController } from './controller.js';
import { createBridgeSettingsStore } from './settings-store.js';
import { createBridgeRuntime } from './runtime.js';
import { createBridgeDispatch } from './dispatch.js';
import { bridgeHttpHandler } from './http.js';
import { discoverBridgeModels } from './discovery.js';
import { bridgeAlias, createBridgeProjection } from './profile.js';
import { createBridgeRouting } from './routing.js';
import { startBridgeWhenSettingsReady } from './startup.js';
import { applyBridgeShared } from './shared.js';
import { applyBridgeSingleKey } from './single-key.js';
import { readBridgeImport } from './import.js';
import { reportBridgeImport } from './migration-report.js';

export { Config } from './config.js';

const GUARD_REF = 'DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD';
const GUARD_VALUE = 'dsh-model-groups-local-routing-only';

/** Public-service composition; this entry never imports a host patch planner. */
export function setupBridgeHost(ctx, { namespace = 'model-groups', runtime = createBridgeRuntime(ctx, { discoverEndpoint: discoverBridgeModels }), storage, native } = {}) {
  storage ??= createBridgeSettingsStore(ctx.settings, { namespace });
  native ??= createBridgeSettingsStore(ctx.settings, { namespace: 'llm-pi-ai', path: ['providers'] });
  const controller = createBridgeController({
    storage, native,
    normalizeNative: (provider, profile) => runtime.normalizeProfile ? runtime.normalizeProfile(provider, profile) : profile,
    credentials: ctx.credentials,
    async prepare(provider, draft, original) {
      const prepared = await runtime.prepare(provider, draft, original);
      // The native directory checks this reference before exposing ordinary
      // alias models. It contains only a local sentinel, never an upstream key.
      if (!(await ctx.credentials.describe(GUARD_REF))?.configured) await ctx.credentials.set(GUARD_REF, GUARD_VALUE);
      const admission = { ...prepared, guardCredential: GUARD_REF };
      const probe = { enabled: true, keyEntries: { probe: { api: 'openai-completions', models: [{ id: 'dsh-model-groups-capability-probe', input: ['text'], contextWindow: 4096, maxTokens: 256 }] } } };
      let projectionMode;
      for (const mode of ['ordinary', 'legacy']) {
        try {
          const candidate = createBridgeProjection({}, probe, { guardCredential: GUARD_REF, projectionMode: mode });
          await runtime.probeProjection(provider, candidate, bridgeAlias('probe', 'dsh-model-groups-capability-probe'));
          projectionMode = mode;
          break;
        } catch { /* Probe the next supported public configuration shape. */ }
      }
      if (!projectionMode) throw Object.assign(new Error('BRIDGE_PROJECTION_UNSUPPORTED'), { code: 'BRIDGE_PROJECTION_UNSUPPORTED' });
      return { ...admission, projectionMode, routing: createBridgeRouting(provider, draft, original, prepared.models) };
    },
    async discover(provider, entryId, entry, { apiKey, shared } = {}) {
      const document = await storage.read();
      const saved = document.providers?.[provider];
      const original = saved?.active ? saved.original?.profile : (await native.read()).providers?.[provider];
      const root = applyBridgeShared(original, shared);
      return entryId === undefined
        ? runtime.discover(provider, undefined, undefined, applyBridgeSingleKey(root, entry), undefined, { apiKey })
        : runtime.discover(provider, entryId, entry, root, undefined, { apiKey });
    },
  });
  createBridgeDispatch(ctx, {
    readSnapshot: provider => controller.executionSnapshot(provider),
    // executionSnapshot verifies the native projection at the same read.
    projectionMatches: () => true,
    execute: request => runtime.execute(request),
  });
  let initialized = false, initializing;
  async function initialize() {
    if (initialized) return true;
    if (initializing) return initializing;
    initializing = runInitialization().finally(() => { initializing = undefined; });
    return initializing;
  }
  const api = { ...controller, needsInitialization: () => !initialized, async initialize() {
    await initialize();
    if (!initialized) throw Object.assign(new Error('MIGRATION_NOT_READY'), { code: 'MIGRATION_NOT_READY' });
  } };
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-model-groups/bridge', handler: bridgeHttpHandler(api, ctx.connection) }));
  ctx.effect(() => () => runtime.dispose());
  // An owner POST can retry outside the HMR transaction that activated us.
  // GET remains read-only; the client explicitly submits initialize when needed.
  async function runInitialization() {
  let migrationStep = 'recover';
  reportBridgeImport(ctx.settings?.documentPath, { stage: 'recover' });
  return controller.recover().then(async recovered => {
    if (recovered.recoveryConflicts?.length) throw Object.assign(new Error('NATIVE_CONFIG_CONFLICT'), { code: 'NATIVE_CONFIG_CONFLICT' });
    const profiles = readBridgeImport(ctx.settings.documentPath);
    migrationStep = 'import';
    reportBridgeImport(ctx.settings.documentPath, { stage: 'import' });
    const imported = profiles ? await controller.importLegacy(profiles) : undefined;
    migrationStep = 'synchronize';
    reportBridgeImport(ctx.settings.documentPath, { stage: 'synchronize', imported: imported?.imported.length, conflicts: imported?.conflicts.length });
    return controller.synchronize();
  }).then(async result => {
    initialized = result.ok;
    const snapshot = await controller.snapshot();
    let clientRegistered;
    try {
      const graph = ctx.get?.('clientModules')?.graph?.();
      if (Array.isArray(graph?.entries)) clientRegistered = graph.entries.some(entry => entry.id === 'dsh-model-groups');
    } catch { /* Optional diagnostics do not affect initialization. */ }
    reportBridgeImport(ctx.settings.documentPath, { stage: 'complete', activated: Object.values(snapshot.providers).filter(profile => profile.active && profile.confirmed).length, conflicts: result.failures.length, clientRegistered });
    if (!result.ok) ctx.logger?.warn('部分多密钥配置需要在原模型卡片中检查后保存。');
  }).catch(error => {
    const origin = String(error?.stack ?? '').match(/\/(dsh-config-editor|dsh-settings|schemastery)\/lib\/[^\s:]+:(\d+):\d+/);
    reportBridgeImport(ctx.settings.documentPath, { stage: 'failed', code: error?.code, step: migrationStep, errorType: error?.name,
      origin: origin?.[1], originLine: origin ? Number(origin[2]) : undefined,
      frames: String(error?.stack ?? '').split('\n').filter(line => /bridge-host-[^/]*\.js:\d+:\d+/.test(line)).slice(0, 4).map(line => Number(line.match(/\.js:(\d+):\d+/)?.[1])) });
    ctx.logger?.warn('模型分组配置切换尚未完成，请检查原模型卡片中的保存状态。');
  });
  }
  const ready = initialize();
  return { controller, runtime, ready, initialize };
}

export function apply(ctx) {
  const namespace = ctx.fiber?.entry?.options?.id ?? 'model-groups';
  const ownerFiber = ctx.fiber;
  ctx.inject(['llm', 'settings', 'webServer', 'connection', 'credentials'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ownerFiber));
    reportBridgeImport(child.settings.documentPath, { stage: 'waiting' });
    startBridgeWhenSettingsReady(child, namespace, () => setupBridgeHost(child, { namespace }).ready);
  });
}
