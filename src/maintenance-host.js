import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const messages = {
  inspection_unknown: '无法完整验证宿主依赖，已停止维护。',
  config_inspection_failed: '无法完整读取宿主配置，已停止维护。',
  session_service_missing: '缺少完整会话查询或持久化服务，已停止维护。',
  session_inspection_failed: '无法完整读取会话依赖，已停止维护。',
  process_inspection_failed: '无法完整检查引擎进程，已停止维护。',
  profile_unknown: '无法完整读取所有本机配置组合，请先修复配置。',
  cross_profile_bundle: '其他配置仍安装或选择本插件，请先从原配置手动清理。',
  alias_dependency: '仍存在多密钥模型选择依赖，请先手动切换为普通模型。',
  key_config_dependency: '仍存在多密钥配置，请先手动清理；不会自动删除。',
  expression_unknown: '配置含动态表达式，无法证明不存在依赖。',
  active_turns: '存在正在运行或维护中的任务，请先等待任务结束。',
  other_process: '发现其他引擎进程，无法验证它们的活动状态。',
};

// These scalar configuration fields cannot supply a plugin, model route or key
// collection. Unknown fields/roots remain conservative. Never infer safety from
// expression text, plugin enablement, or a name/id that might itself be dynamic.
const nonRouteScalars = new Set([
  'apiKey', 'apiKeyEnv', 'baseURL', 'baseUrl', 'endpoint', 'timeout', 'timeoutMs',
  'maxRetries', 'temperature', 'topP', 'maxTokens', 'contextWindow',
  'enabled', 'disabled', 'label', 'description', 'locale', 'language', 'port', 'host',
]);

/** Pure scanner: never evaluates expressions or returns inspected values. */
export function dependencySignals(value) {
  const result = { alias: 0, keys: 0, expression: 0 };
  const routeCollections = new Set(['providers', 'profiles', 'keyEntries', 'models', 'modelOverrides', 'allowedModels', 'plugins']);
  const walk = (input, safeScalar = false, field, parentField) => {
    if (typeof input === 'string') { if (input.startsWith('@dsh-key/')) result.alias++; return; }
    if (!input || typeof input !== 'object') return;
    if (Object.hasOwn(input, '__jsExpr')) {
      if (!safeScalar) result.expression++;
      return;
    }
    if (!Array.isArray(input)) {
      if (input.multiKey === true || (input.keyEntries && typeof input.keyEntries === 'object' && Object.keys(input.keyEntries).length)) result.keys++;
      if (Object.hasOwn(input, 'multiKey') && typeof input.multiKey !== 'boolean' && !input.multiKey?.__jsExpr) result.expression++;
      if (Object.hasOwn(input, 'keyEntries') && (!input.keyEntries || typeof input.keyEntries !== 'object' || Array.isArray(input.keyEntries))) result.expression++;
    }
    // Safety applies only to the immediate scalar slot, never a whole subtree.
    const configFields = field === undefined || field === 'config' || ['value', 'base', 'user'].includes(field) || routeCollections.has(parentField);
    for (const [key, child] of Object.entries(input)) walk(child,
      configFields && !Array.isArray(input) && !routeCollections.has(field) && nonRouteScalars.has(key), key, field);
  };
  walk(value);
  return result;
}

/** Fold the current route while retaining request routes reusable by history forks. */
export function sessionDependencies(events) {
  if (!Array.isArray(events)) throw new Error('Invalid session observation');
  let lastUsed, pending;
  const sameSelection = (a, b) => a && b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
  const durable = [];
  let openTurns = 0;
  for (const event of events) {
    if (event.type === 'model/selection') pending = event.data;
    if (event.type === 'request/header') {
      const header = event.data?.header, route = header?.config;
      if (!route || typeof route.provider !== 'string' || typeof route.model !== 'string') throw new Error('Invalid route observation');
      lastUsed = { provider: route.provider, model: route.model, reasoningEffort: header.adapterDefaults?.reasoningEffort === true ? undefined : route.reasoningEffort };
      durable.push(lastUsed);
      if (sameSelection(pending, lastUsed)) pending = undefined;
    }
    if (event.type === 'subagent/descriptor') durable.push({ provider: event.data?.agentProvider, model: event.data?.agentModel });
    if (event.type === 'subagent/model-selection-policy') durable.push(event.data?.allowedModels);
    if (event.type === 'turn/start') openTurns++;
    if (event.type === 'turn/end') openTurns = Math.max(0, openTurns - 1);
  }
  return { routes: [pending ?? lastUsed, ...durable], openTurns };
}

/** Read-only inspection bounded to the supplied home and installation. No global-install claim. */
export function createHostInspection(ctx, root, home) {
  return async function inspect() {
    const counts = new Map(), observations = [];
    const block = (code, count = 1) => counts.set(code, (counts.get(code) || 0) + count);
    const observe = value => {
      observations.push(digest(value));
      const signals = dependencySignals(value);
      if (signals.alias) block('alias_dependency', signals.alias);
      if (signals.keys) block('key_config_dependency', signals.keys);
      if (signals.expression) block('expression_unknown', signals.expression);
    };
    try {
      const require = createRequire(path.join(root, 'package.json'));
      const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
      const profile = ctx.profileContext;
      if (!profile || !Array.isArray(profile.overlays) || fs.realpathSync(profile.home) !== fs.realpathSync(home)) throw new Error('Unknown launch scope');
      const profilesRoot = path.join(home, boot.PROFILES_DIR);
      const directories = fs.readdirSync(profilesRoot, { withFileTypes: true });
      let currentFound = false;
      for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) { block('profile_unknown'); continue; }
        const dir = path.join(profilesRoot, entry.name);
        const current = fs.realpathSync(dir) === fs.realpathSync(profile.dir);
        currentFound ||= current;
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
          observations.push(digest(manifest));
          if (!current && (Object.hasOwn(manifest.dependencies || {}, 'dsh-model-groups') || manifest.dsh?.profile?.bundles?.includes('dsh-model-groups'))) block('cross_profile_bundle');
          const loaded = boot.loadProfileDirectory('dsh', dir, profile.installAnchor, { readOnly: true });
          if (loaded.skippedBundles.length) block('profile_unknown', loaded.skippedBundles.length);
          const context = { ...profile, dir, patchPath: loaded.patchPath, home, overlays: current ? profile.overlays : [] };
          const patches = boot.readProfilePatches('dsh', context, loaded);
          // Scan raw layers too: disabled rows and overridden residual config must not disappear.
          observe(patches);
          const warnings = [];
          observe(boot.composeEntries([patches], warning => warnings.push(warning)));
          if (warnings.length) block('profile_unknown', warnings.length);
        } catch { block('profile_unknown'); }
      }
      if (!currentFound) block('profile_unknown');
    } catch { block('profile_unknown'); }
    try {
      for (const { entry, inherited, override } of ctx.configEditor.configuration()) observe({
        plugin: entry.options.name, config: entry.options.config, base: inherited, user: override,
      });
      observe(ctx.agentDefaultModel.currentSelection());
      // describe supplies effective values but is intentionally not the full inventory.
      for (const doc of await ctx.settings.describe({ redactSecrets: true })) observe({ ns: doc.ns, value: doc.value, base: doc.base, user: doc.user });
    } catch { block('config_inspection_failed'); }
    try {
      // sessionQuery can list only live sessions without persistence. That is
      // insufficient evidence for destructive maintenance of durable routes.
      if (!ctx.sessionPersistence || typeof ctx.sessionQuery?.listSessions !== 'function' || typeof ctx.sessionQuery?.readSession !== 'function') {
        block('session_service_missing');
      } else {
        const sessions = await ctx.sessionQuery.listSessions();
        observations.push(digest(sessions));
        for (const record of sessions) {
          const loaded = await ctx.sessionQuery.readSession(record.header.id);
          if (loaded.session?.id !== record.header.id) throw new Error('Invalid session snapshot identity');
          const state = sessionDependencies(loaded.events);
          observe(state.routes);
          observations.push(digest([loaded.session, loaded.events]));
          // Only live tails indicate current activity; abandoned historical tails do not.
          if (record.live && state.openTurns) block('active_turns');
        }
      }
      for (const agent of ctx.agents.list()) {
        observe([agent.options, agent.model.current()]);
        observations.push(digest([agent.id, agent.status, agent.phase?.kind]));
        if (agent.status !== 'idle' || (agent.phase && agent.phase.kind !== 'idle')) block('active_turns');
      }
    } catch { block('session_inspection_failed'); }
    // Bounded process observation: no credentials/configuration files are opened.
    // A second Node DSH process is unknown, not presumed inactive. This is not a cross-home lock.
    try {
      for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
        let command;
        try { command = fs.readFileSync(`/proc/${entry.name}/cmdline`, 'utf8').split('\0'); }
        catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
        if (/(?:^|\/)node(?:js)?$/.test(command[0] || '') && command.slice(1).some(arg => {
          if (!path.isAbsolute(arg)) return /^(?:dsh|@deepseek-ai\/dsh)(?:\/|$)/.test(arg);
          const relative = path.relative(root, arg);
          return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
            && /(?:^|\/)dsh(?:\/|$)|@deepseek-ai\/dsh/.test(arg);
        })) {
          block('other_process'); observations.push(digest(entry.name));
        }
      }
    } catch { block('process_inspection_failed'); }
    const blockers = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, message: messages[code], count }));
    return { blockers, fingerprint: digest([observations, blockers]) };
  };
}
