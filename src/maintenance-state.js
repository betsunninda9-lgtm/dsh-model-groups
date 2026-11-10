export const MAINTENANCE_CONFIRMATION = 'RESTORE AND UNINSTALL';
export const MAINTENANCE_ENDPOINT = '/dsh-model-groups/maintenance';
const MAINTENANCE_KEYS = ['dsh:model-groups:v1', 'dsh:model-groups:mode'];

// Never project arbitrary server messages, patch paths, or tokens into the DOM.
export function maintenanceSnapshot(value) {
  const phases = ['idle', 'restored', 'removing', 'removed', 'failed'];
  if (!value || !phases.includes(value.phase) || typeof value.restartRequired !== 'boolean'
    || typeof value.canRestore !== 'boolean' || !(value.token == null || typeof value.token === 'string')
    || !Array.isArray(value.patches) || !Array.isArray(value.blockers)
    || !value.patches.every(patch => patch && ['patched', 'pristine', 'conflict'].includes(patch.state))
    || !value.blockers.every(blocker => blocker && typeof blocker.code === 'string' && typeof blocker.message === 'string')) {
    throw new Error('Invalid maintenance snapshot');
  }
  return { phase: value.phase, restartRequired: value.restartRequired, canRestore: value.canRestore,
    token: value.token ?? null, patches: value.patches.map(patch => ({ state: patch.state })),
    blockers: value.blockers.map(blocker => ({ code: blocker.code, count: Number.isSafeInteger(blocker.count) && blocker.count > 0 ? blocker.count : null })) };
}
export function maintenanceCanRestore(snapshot) {
  return !!snapshot && ['idle', 'restored', 'failed'].includes(snapshot.phase) && snapshot.canRestore
    && typeof snapshot.token === 'string' && snapshot.token.length > 0
    && snapshot.blockers.length === 0 && !snapshot.patches.some(patch => patch.state === 'conflict');
}
export function maintenanceBlockerText(blocker) {
  const labels = {
    active_sessions: '存在正在运行的会话，请先停止运行中的任务。',
    active_turns: '存在正在运行的回合，请先等待结束或停止。',
    patch_conflict: '补丁状态冲突，请先人工诊断，不会强制覆盖。',
    backup_missing: '缺少可验证的原版备份，无法安全恢复。',
    restart_required: '需要重启原引擎后重新检查。',
    inspection_failed: '状态检查不可用，请使用安装诊断排查。',
    not_removable: '当前插件状态不允许安全卸载。',
    manager_unavailable: '插件管理服务不可用，请稍后重试。',
    host_unknown: '无法验证宿主版本，不会修改未知文件。',
    state_changed: '状态已发生变化，请刷新检查后重新确认。',
    remove_failed: '卸载未完成，请刷新检查并使用安装诊断排查。',
    remove_unverified: '无法验证卸载结果，请刷新检查，不要视为成功。',
    verify_failed: '安全验证失败，不会强制覆盖文件。',
    busy: '维护或其他任务正在运行，请结束后刷新。',
    confirmation_required: '安全确认已失效，请刷新检查后重新确认。',
    maintenance_failed: '维护失败，请刷新检查并使用安装诊断排查。',
    inspection_unknown: '无法确认运行状态，请先停止任务并使用安装诊断排查。',
    profile_unknown: '无法确认当前配置档，不会执行卸载。',
    cross_profile_bundle: '其他配置档也在使用此插件，请先处理跨配置档依赖。',
    alias_dependency: '仍有会话或配置引用多密钥模型，请先切换为普通模型再检查。',
    key_config_dependency: '仍有多密钥配置依赖：请先禁用 multiKey 并清理 keyEntries 配置；已保存的密钥会保留。',
    expression_unknown: '存在无法安全判断的配置表达式，请先人工检查配置。',
    other_process: '其他引擎进程可能正在使用补丁，请先停止相关进程。',
  };
  return (labels[blocker.code.toLowerCase()] || '安全检查未通过，请先处理运行中的任务或使用安装诊断排查。')
    + (blocker.count ? `（${blocker.count} 项）` : '');
}

export function createMaintenanceController({ request = (...args) => fetch(...args), storage = () => globalThis.localStorage } = {}) {
  let state = { snapshot: null, busy: false, error: '', cleanupWarning: false };
  let disposed = false;
  let generation = 0;
  const listeners = new Set();
  const update = next => { if (disposed) return; state = { ...state, ...next }; for (const listener of listeners) listener(); };
  async function run(restore) {
    if (disposed || state.busy || (restore && !maintenanceCanRestore(state.snapshot))) return;
    const sequence = ++generation;
    const token = state.snapshot?.token;
    update({ busy: true, error: '', ...(restore ? { snapshot: { ...state.snapshot, canRestore: false, token: null } } : {}) });
    try {
      const response = await request(MAINTENANCE_ENDPOINT, {
        credentials: 'same-origin', cache: 'no-store',
        ...(restore ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore-and-uninstall', token, confirmation: MAINTENANCE_CONFIRMATION }) } : { method: 'GET' }),
      });
      if (disposed || sequence !== generation) return;
      if (!response.ok) throw new Error('Maintenance HTTP error');
      const envelope = await response.json();
      if (envelope?.ok !== true) throw new Error('Maintenance refused');
      const snapshot = maintenanceSnapshot(envelope.value);
      if (disposed || sequence !== generation) return;
      let cleanupWarning = false;
      if (snapshot.phase === 'removed') {
        for (const key of MAINTENANCE_KEYS) {
          try { storage()?.removeItem(key); } catch { cleanupWarning = true; }
        }
      }
      update({ snapshot, cleanupWarning, error: snapshot.phase === 'failed' ? '操作失败，未确认卸载成功。请刷新检查，不要强制覆盖。' : '' });
    } catch {
      if (!disposed && sequence === generation) update({ snapshot: null,
        error: restore ? '未能确认卸载结果：连接中断、请求被拒绝或响应无效不代表成功。请刷新检查。' : '状态检查失败，请确认连接后刷新重试。' });
    } finally { if (!disposed && sequence === generation) update({ busy: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    activate: () => { disposed = false; generation++; update({ busy: false }); },
    refresh: () => run(false),
    restore: (checked, confirmation) => checked === true && confirmation === MAINTENANCE_CONFIRMATION ? run(true) : Promise.resolve(),
    dispose: () => { disposed = true; generation++; listeners.clear(); },
  };
}
