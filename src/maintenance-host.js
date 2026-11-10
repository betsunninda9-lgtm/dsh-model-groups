import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const messages = {
  inspection_unknown: '宿主依赖未完整验证。',
  config_inspection_failed: '配置依赖未完整验证。',
  default_inspection_failed: '默认模型依赖未完整验证。',
  session_service_missing: '会话查询服务不可用，会话依赖未完整验证。',
  session_inspection_failed: '部分会话依赖未完整验证。',
  agent_inspection_failed: '部分智能体依赖未完整验证。',
  activity_unverified: '部分任务活动状态未验证，请确认任务已结束。',
  process_inspection_failed: '引擎进程活动状态未完整验证。',
  profile_unknown: '部分配置组合依赖未完整验证。',
  cross_profile_bundle: '其他配置仍安装或选择本插件，卸载后可能受影响。',
  alias_dependency: '观察到多密钥模型路由，卸载后相关路由可能不可用。',
  key_config_dependency: '观察到多密钥配置，维护不会自动删除这些配置。',
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
  const seen = new WeakSet();
  const routeCollections = new Set(['providers', 'profiles', 'keyEntries', 'models', 'modelOverrides', 'allowedModels', 'plugins']);
  const walk = (input, safeScalar = false, field, parentField) => {
    if (typeof input === 'string') { if (input.startsWith('@dsh-key/')) result.alias++; return; }
    if (!input || typeof input !== 'object') return;
    if (Object.hasOwn(input, '__jsExpr')) {
      if (!safeScalar) result.expression++;
      return;
    }
    if (seen.has(input)) { result.expression++; return; }
    seen.add(input);
    if (!Array.isArray(input)) {
      if (input.multiKey === true || (input.keyEntries && typeof input.keyEntries === 'object' && Object.keys(input.keyEntries).length)) result.keys++;
      if (Object.hasOwn(input, 'multiKey') && typeof input.multiKey !== 'boolean' && !input.multiKey?.__jsExpr) result.expression++;
      if (Object.hasOwn(input, 'keyEntries') && (!input.keyEntries || typeof input.keyEntries !== 'object' || Array.isArray(input.keyEntries))) result.expression++;
    }
    // Safety applies only to the immediate scalar slot, never a whole subtree.
    const configFields = field === undefined || field === 'config' || ['value', 'base', 'user'].includes(field) || routeCollections.has(parentField);
    for (const [key, child] of Object.entries(input)) walk(child,
      configFields && !Array.isArray(input) && !routeCollections.has(field) && nonRouteScalars.has(key), key, field);
    seen.delete(input);
  };
  walk(value);
  return result;
}

// Fingerprints never serialize arbitrary host objects, credentials or expression text.
// Unknown shapes remain an explicit inspection signal, not an assertion of safety.
function routeProjection(value, ancestors = new WeakSet()) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Invalid route projection');
  if (Object.hasOwn(value, '__jsExpr')) return { __jsExpr: true };
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => routeProjection(item, ancestors));
    const result = {};
    for (const key of ['provider', 'model', 'reasoningEffort', 'agentProvider', 'agentModel', 'allowedModels']) {
      if (!Object.hasOwn(value, key)) continue;
      const child = value[key];
      if (key === 'allowedModels') {
        if (!Array.isArray(child)) throw new Error('Invalid route policy');
      } else if (child != null && typeof child !== 'string' && !(typeof child === 'object' && Object.hasOwn(child, '__jsExpr'))) {
        throw new Error('Invalid route scalar');
      }
      result[key] = routeProjection(child, ancestors);
    }
    return result;
  } finally { ancestors.delete(value); }
}

/** Fold explicit routes only; message bodies and Session objects are never projected. */
export function sessionDependencies(events) {
  if (!Array.isArray(events)) throw new Error('Invalid session observation');
  let lastUsed, pending;
  const sameSelection = (a, b) => a && b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
  const durable = [];
  let openTurns = 0;
  for (const event of events) {
    if (!event || typeof event.type !== 'string') throw new Error('Invalid event observation');
    if (event.type === 'model/selection') {
      if (!event.data || typeof event.data.model !== 'string') throw new Error('Invalid selection observation');
      pending = routeProjection(event.data);
    }
    if (event.type === 'request/header') {
      const header = event.data?.header, route = header?.config;
      if (!route || typeof route.provider !== 'string' || typeof route.model !== 'string') throw new Error('Invalid route observation');
      lastUsed = routeProjection({ provider: route.provider, model: route.model,
        reasoningEffort: header.adapterDefaults?.reasoningEffort === true ? undefined : route.reasoningEffort });
      durable.push(lastUsed);
      if (sameSelection(pending, lastUsed)) pending = undefined;
    }
    if (event.type === 'subagent/descriptor') {
      if (typeof event.data?.agentModel !== 'string') throw new Error('Invalid descriptor observation');
      durable.push(routeProjection({ provider: event.data.agentProvider, model: event.data.agentModel }));
    }
    if (event.type === 'subagent/model-selection-policy') {
      if (!Array.isArray(event.data?.allowedModels)) throw new Error('Invalid policy observation');
      durable.push(routeProjection(event.data.allowedModels));
    }
    if (event.type === 'turn/start') openTurns++;
    if (event.type === 'turn/end') openTurns = Math.max(0, openTurns - 1);
  }
  return { routes: [pending ?? lastUsed, ...durable], openTurns };
}

/** Read-only inspection bounded to the supplied home and installation. No global-install claim. */
export function createHostInspection(ctx, root, home) {
  return async function inspect() {
    const counts = new Map(), observations = new Set(), dependencies = new Set();
    const block = (code, count = 1) => counts.set(code, (counts.get(code) || 0) + count);
    const observe = value => {
      const signals = dependencySignals(value), routes = [], seen = new WeakSet();
      const collect = input => {
        if (!input || typeof input !== 'object' || seen.has(input)) return;
        seen.add(input);
        if (Object.hasOwn(input, '__jsExpr')) return;
        if (['provider', 'model', 'agentProvider', 'agentModel', 'allowedModels'].some(key => Object.hasOwn(input, key))) routes.push(routeProjection(input));
        for (const child of Object.values(input)) collect(child);
      };
      collect(value);
      const observation = digest([signals.alias > 0, signals.keys > 0, signals.expression > 0, routes]);
      if (dependencies.has(observation)) return;
      dependencies.add(observation);
      observations.add(observation);
      if (signals.alias) block('alias_dependency');
      if (signals.keys) block('key_config_dependency');
      if (signals.expression) block('expression_unknown');
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
          observations.add(digest([entry.name, Object.hasOwn(manifest.dependencies || {}, 'dsh-model-groups'), manifest.dsh?.profile?.bundles?.includes('dsh-model-groups') === true]));
          if (!current && (Object.hasOwn(manifest.dependencies || {}, 'dsh-model-groups') || manifest.dsh?.profile?.bundles?.includes('dsh-model-groups'))) block('cross_profile_bundle');
          const loaded = boot.loadProfileDirectory('dsh', dir, profile.installAnchor, { readOnly: true });
          if (loaded.skippedBundles.length) block('profile_unknown', loaded.skippedBundles.length);
          const context = { ...profile, dir, patchPath: loaded.patchPath, home, overlays: current ? profile.overlays : [] };
          const patches = boot.readProfilePatches('dsh', context, loaded);
          // Scan raw layers too: disabled rows and overridden residual config must not disappear.
          observe(patches);
          // Raw layers retain disabled/overridden residues without composing or evaluating them.
        } catch { block('profile_unknown'); }
      }
      if (!currentFound) block('profile_unknown');
    } catch { block('profile_unknown'); }
    try {
      for (const { entry, inherited, override } of ctx.configEditor.configuration()) observe({
        plugin: entry.options.name, config: entry.options.config, base: inherited, user: override,
      });
    } catch { block('config_inspection_failed'); }
    try { observe(routeProjection(ctx.agentDefaultModel.currentSelection())); }
    catch { block('default_inspection_failed'); }
    // Do not call settings.describe: it evaluates expressions a second time.
    try {
      if (typeof ctx.sessionQuery?.listSessions !== 'function' || typeof ctx.sessionQuery?.readSession !== 'function') {
        block('session_service_missing'); block('activity_unverified');
      } else {
        const sessions = await ctx.sessionQuery.listSessions();
        if (!Array.isArray(sessions)) throw new Error('Invalid session list');
        for (const record of sessions) {
          try {
            const id = record?.header?.id;
            if (typeof id !== 'string' || !id) throw new Error('Invalid session identity');
            observations.add(digest(['session', id, record.live === true]));
            const loaded = await ctx.sessionQuery.readSession(id);
            if (loaded.session?.id !== id) throw new Error('Invalid session snapshot identity');
            if (!Array.isArray(loaded.events)) throw new Error('Invalid session events');
            // Activity survives malformed route observations in this same snapshot.
            let openTurns = 0;
            for (const event of loaded.events) {
              if (event?.type === 'turn/start') openTurns++;
              if (event?.type === 'turn/end') openTurns = Math.max(0, openTurns - 1);
            }
            observations.add(digest(['activity', id, openTurns]));
            if (record.live === true && openTurns) block('active_turns');
            const state = sessionDependencies(loaded.events);
            observe(state.routes);
            observations.add(digest(['session', id, state.routes]));
            // Historical unfinished turns are dependency observations, never activity locks.
            if (typeof record.live !== 'boolean') block('activity_unverified');
          } catch { block('session_inspection_failed'); block('activity_unverified'); }
        }
      }
    } catch { block('session_inspection_failed'); block('activity_unverified'); }
    try {
      for (const agent of ctx.agents.list()) {
        // Inspect activity independently: a broken model service must not hide a live agent.
        try {
          const status = agent.status, phase = agent.phase?.kind;
          observations.add(digest(['agent', typeof agent.id === 'string' ? agent.id : null,
            typeof status === 'string' ? status : null, typeof phase === 'string' ? phase : null]));
          // Host status is idle/running; maintenance is an idle-status exclusive phase.
          if (status === 'running' || phase === 'maintenance') block('active_turns');
          else if (status !== 'idle' || (agent.phase && phase !== 'idle')) block('activity_unverified');
        } catch { block('activity_unverified'); }
        try { observe(routeProjection(agent.options)); observe(routeProjection(agent.model.current())); }
        catch { block('agent_inspection_failed'); }
      }
    } catch { block('agent_inspection_failed'); block('activity_unverified'); }
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
          block('other_process'); observations.add(digest(entry.name));
        }
      }
    } catch { block('process_inspection_failed'); }
    const blockers = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, message: messages[code], count }));
    return { blockers, fingerprint: digest([[...observations].sort(), blockers]) };
  };
}
