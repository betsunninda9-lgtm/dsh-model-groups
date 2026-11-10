export const MAINTENANCE_CONFIRMATION = 'CONFIRM PATCH OPERATION';
export const MAINTENANCE_ENDPOINT = '/dsh-model-groups/maintenance';
const MAINTENANCE_KEYS = ['dsh:model-groups:v1', 'dsh:model-groups:mode'];
const ACTION_CAPABILITIES = { apply: 'canApply', 'restore-only': 'canRestoreOnly', 'restore-and-uninstall': 'canRestore' };

// Never project arbitrary server messages, patch paths, or tokens into the DOM.
export function maintenanceSnapshot(value) {
  const phases = ['idle', 'applied', 'restored', 'removing', 'removed', 'failed'];
  if (!value || !phases.includes(value.phase) || typeof value.restartRequired !== 'boolean'
    || !Object.values(ACTION_CAPABILITIES).every(key => typeof value[key] === 'boolean')
    || !(value.token == null || (typeof value.token === 'string' && value.token.length > 0))
    || (Object.values(ACTION_CAPABILITIES).some(key => value[key]) && !(typeof value.token === 'string' && value.token.length > 0))
    || !Array.isArray(value.patches) || !Array.isArray(value.blockers)
    || !(value.warnings == null || (Array.isArray(value.warnings) && value.warnings.every(warning => warning && typeof warning.code === 'string'
      && (warning.count == null || (Number.isSafeInteger(warning.count) && warning.count > 0)))))
    || !value.patches.every(patch => patch && ['patched', 'pristine', 'conflict'].includes(patch.state)
      && (patch.updateAvailable == null || typeof patch.updateAvailable === 'boolean'))
    || !value.blockers.every(blocker => blocker && typeof blocker.code === 'string' && typeof blocker.message === 'string'
      && (blocker.count == null || (Number.isSafeInteger(blocker.count) && blocker.count > 0)))) {
    throw new Error('Invalid maintenance snapshot');
  }
  return { phase: value.phase, restartRequired: value.restartRequired, canApply: value.canApply,
    canRestoreOnly: value.canRestoreOnly, canRestore: value.canRestore,
    token: value.token ?? null, patches: value.patches.map(patch => ({ state: patch.state, updateAvailable: patch.updateAvailable === true })),
    blockers: value.blockers.map(blocker => ({ code: blocker.code, count: blocker.count ?? null })),
    warnings: (value.warnings ?? []).map(warning => ({ code: warning.code, count: warning.count ?? null })) };
}
export function maintenanceCanAction(snapshot, action) {
  const capability = Object.hasOwn(ACTION_CAPABILITIES, action) ? ACTION_CAPABILITIES[action] : null;
  return !!capability && !!snapshot && ['idle', 'applied', 'restored', 'failed'].includes(snapshot.phase) && snapshot[capability]
    && typeof snapshot.token === 'string' && snapshot.token.length > 0
    && !snapshot.patches.some(patch => patch.state === 'conflict');
}
export function maintenanceCanRestore(snapshot) { return maintenanceCanAction(snapshot, 'restore-and-uninstall'); }
export function maintenanceBlockerText(blocker) {
  const labels = {
    active_sessions: '存在正在运行的会话，请先停止运行中的任务。',
    active_turns: '存在正在运行的回合，请先等待结束或停止。',
    patch_conflict: '补丁状态冲突，请先人工诊断，不会强制覆盖。',
    backup_missing: '缺少可验证的原版备份，无法安全恢复。',
    restart_required: '需要重启原引擎后重新检查。',
    inspection_failed: '状态检查失败，请使用安装诊断排查。',
    config_inspection_failed: '配置检查失败，无法验证模型与密钥依赖；请使用安装诊断排查。',
    session_inspection_failed: '会话检查失败，无法验证活动回合与模型引用；请使用安装诊断排查。',
    session_service_missing: '缺少会话查询或持久化服务，无法验证历史会话的模型依赖；请使用安装诊断排查。',
    process_inspection_failed: '进程检查失败，无法排除其他引擎使用补丁；请使用安装诊断排查。',
    profile_inspection_failed: '配置档检查失败，无法排除跨配置档依赖；请使用安装诊断排查。',
    patch_inspection_failed: '补丁文件检查失败，无法验证磁盘状态；不会修改未知文件。',
    not_removable: '当前插件状态不允许安全卸载。',
    not_applicable: '当前状态不允许安全应用补丁。',
    manager_unavailable: '插件管理服务不可用，请稍后重试。',
    host_unknown: '无法验证宿主版本，不会修改未知文件。',
    state_changed: '状态已发生变化，请刷新检查后重新打开操作并确认。',
    apply_failed: '补丁应用未完成，请刷新检查，不要视为成功。',
    restore_failed: '原版恢复未完成，请刷新检查，不要视为成功。',
    remove_failed: '卸载未完成，请刷新检查并使用安装诊断排查。',
    remove_unverified: '无法验证卸载结果，请刷新检查，不要视为成功。',
    verify_failed: '安全验证失败，不会强制覆盖文件。',
    busy: '维护或其他任务正在运行，请结束后刷新。',
    confirmation_required: '安全确认已失效，请刷新检查后重新打开操作并确认。',
    maintenance_failed: '维护失败，请刷新检查并使用安装诊断排查。',
    inspection_unknown: '无法确认运行状态，请先停止任务并使用安装诊断排查。',
    profile_unknown: '无法确认当前配置档，不会执行维护。',
    cross_profile_bundle: '其他配置档也在使用此插件，请先处理跨配置档依赖。',
    alias_dependency: '仍有会话或配置引用多密钥模型，请先切换为普通模型再检查；本预览不会自动转换。',
    key_config_dependency: '仍有多密钥配置依赖：请先禁用 multiKey 并清理 keyEntries 配置；已保存的密钥会保留。本预览不会自动转换。',
    expression_unknown: '存在无法安全判断的配置表达式，请先人工检查配置。',
    other_process: '其他引擎进程可能正在使用补丁，请先停止相关进程。',
  };
  return (labels[blocker.code.toLowerCase()] || '安全检查未通过，请先处理运行中的任务或使用安装诊断排查。')
    + (blocker.count ? `（${blocker.count} 项）` : '');
}

// Copy only allowlisted codes and enumerated state: unknown codes may contain secrets or paths.
export function maintenanceDiagnostic(state) {
  const snapshot = state.snapshot;
  const knownCodes = new Set(['active_sessions', 'active_turns', 'patch_conflict', 'backup_missing', 'restart_required',
    'inspection_failed', 'config_inspection_failed', 'session_inspection_failed', 'session_service_missing',
    'process_inspection_failed', 'profile_inspection_failed', 'patch_inspection_failed', 'default_inspection_failed',
    'agent_inspection_failed', 'activity_unverified', 'not_removable', 'not_applicable', 'manager_unavailable',
    'host_unknown', 'state_changed', 'apply_failed', 'restore_failed', 'remove_failed', 'remove_unverified',
    'verify_failed', 'busy', 'confirmation_required', 'maintenance_failed', 'inspection_unknown', 'profile_unknown',
    'cross_profile_bundle', 'alias_dependency', 'key_config_dependency', 'expression_unknown', 'other_process']);
  const diagnosticItem = item => {
    const code = item.code.toLowerCase();
    return { code: knownCodes.has(code) ? code : 'unknown', count: item.count };
  };
  return JSON.stringify({
    status: snapshot?.phase ?? 'unknown', busy: !!state.busy, resultUnverified: !!state.error,
    restartRequired: snapshot?.restartRequired ?? null,
    capabilities: snapshot ? { apply: snapshot.canApply, close: snapshot.canRestoreOnly, uninstall: snapshot.canRestore } : null,
    patches: snapshot?.patches.map(patch => patch.state) ?? [],
    blockers: snapshot?.blockers.map(diagnosticItem) ?? [],
    warnings: snapshot?.warnings.map(diagnosticItem) ?? [],
  }, null, 2);
}
export function maintenanceWarningText(warning) {
  const labels = {
    alias_dependency: '旧多密钥模型选择可能影响后续使用或重启；本页不会自动切换服务或模型。',
    key_config_dependency: '旧多密钥配置可能影响后续使用或重启；关闭会保留密钥和历史，不自动转换配置。',
    expression_unknown: '部分配置表达式无法完整检查，请留意关闭后的使用和重启情况。',
  };
  const code = warning.code.toLowerCase();
  const inspection = ['config_inspection_failed', 'session_inspection_failed', 'session_service_missing', 'process_inspection_failed', 'profile_inspection_failed', 'inspection_unknown', 'default_inspection_failed', 'agent_inspection_failed', 'activity_unverified'];
  return (labels[code] || (inspection.includes(code) ? '检查不完整，无法确认全部依赖；这只是提醒，不会额外禁用操作。' : '部分使用情况未能验证，不等于安全；这只是提醒，不会额外禁用操作。'))
    + (warning.count ? `（${warning.count} 项）` : '');
}

export function createMaintenanceController({ request = (...args) => fetch(...args), storage = () => globalThis.localStorage } = {}) {
  let state = { snapshot: null, busy: false, error: '', cleanupWarning: false, patchedWarning: false };
  let disposed = false;
  let generation = 0;
  const listeners = new Set();
  const update = next => { if (disposed) return; state = { ...state, ...next }; for (const listener of listeners) listener(); };
  async function readSnapshot(options) {
    const response = await request(MAINTENANCE_ENDPOINT, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!response.ok) throw new Error('Maintenance HTTP error');
    const envelope = await response.json();
    if (envelope?.ok !== true) throw new Error('Maintenance refused');
    return maintenanceSnapshot(envelope.value);
  }
  function accept(snapshot) {
    let cleanupWarning = false;
    if (snapshot.phase === 'removed') {
      for (const key of MAINTENANCE_KEYS) {
        try { storage()?.removeItem(key); } catch { cleanupWarning = true; }
      }
    }
    update({ snapshot, cleanupWarning, patchedWarning: snapshot.patches.some(patch => patch.state === 'patched'),
      error: snapshot.phase === 'failed' ? '维护操作失败，未确认完成。请刷新检查，不要强制覆盖。' : '' });
  }
  async function run(action = null) {
    if (disposed || state.busy || (action && !maintenanceCanAction(state.snapshot, action))) return;
    const sequence = ++generation;
    const token = state.snapshot?.token;
    const current = () => !disposed && sequence === generation;
    update({ busy: true, error: '' });
    try {
      // Recheck immediately before using the confirmed token; a changed state needs new consent.
      let snapshot = await readSnapshot({ method: 'GET' });
      if (!current()) return;
      if (action) {
        if (snapshot.token !== token || !maintenanceCanAction(snapshot, action)) {
          accept(snapshot);
          update({ error: '状态已发生变化或操作被阻止，未执行操作。请检查当前状态并重新打开操作并确认。' });
          return;
        }
        update({ snapshot: { ...snapshot, canApply: false, canRestoreOnly: false, canRestore: false, token: null } });
        snapshot = await readSnapshot({ method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, token, confirmation: MAINTENANCE_CONFIRMATION }) });
        if (!current()) return;
      }
      accept(snapshot);
    } catch {
      if (current()) update({ snapshot: null,
        error: action ? '未能确认维护结果：连接中断、请求被拒绝或响应无效不代表成功。请刷新检查。' : '状态检查失败，请确认连接后刷新重试。' });
    } finally { if (current()) update({ busy: false }); }
  }
  const operate = (action, checked) => checked === true && Object.hasOwn(ACTION_CAPABILITIES, action) ? run(action) : Promise.resolve();
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    activate: () => { disposed = false; generation++; update({ busy: false }); },
    refresh: () => run(),
    operate,
    apply: checked => operate('apply', checked),
    restoreOnly: checked => operate('restore-only', checked),
    restore: checked => operate('restore-and-uninstall', checked),
    dispose: () => { disposed = true; generation++; listeners.clear(); },
  };
}
