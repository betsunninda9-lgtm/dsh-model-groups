export function ModelGroupsSettingsPage() {
  const h = react.createElement;
  const controller = react.useMemo(() => createMaintenanceController(), []);
  const state = react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [pending, setPending] = react.useState(null);
  const [copyStatus, setCopyStatus] = react.useState('');
  const confirmationId = react.useId();
  react.useEffect(() => { controller.activate(); controller.refresh(); return () => controller.dispose(); }, [controller]);
  const snapshot = state.snapshot;
  const phaseLabels = { idle: '检查完成，可选择操作', applied: '多密钥已应用（磁盘状态）', restored: '多密钥已关闭，插件仍保留（磁盘状态）', removing: '正在卸载，尚未确认完成', removed: '已确认关闭多密钥并卸载插件', failed: '维护失败，未确认完成' };
  const updatesAvailable = snapshot?.patches.some(patch => patch.updateAvailable) ?? false;
  const statusLabel = snapshot?.phase === 'idle'
    ? snapshot.patches.length && snapshot.patches.every(patch => patch.state === 'patched') ? '多密钥已启用（磁盘状态）'
      : snapshot.patches.length && snapshot.patches.every(patch => patch.state === 'pristine') ? '多密钥已关闭（磁盘状态）' : '磁盘状态待处理，请查看操作限制'
    : phaseLabels[snapshot?.phase];
  const patchLabels = { patched: '已应用', pristine: '原版', conflict: '冲突（不会强制覆盖）' };
  const actions = [['apply', updatesAvailable ? '更新多密钥补丁' : '启用多密钥'],  ['restore-only', '关闭多密钥'], ['restore-and-uninstall', '关闭并卸载插件']];
  const anyAllowed = actions.some(([action]) => maintenanceCanAction(snapshot, action));
  const refresh = () => { setPending(null); controller.refresh(); };
  const confirm = () => { const action = pending; setPending(null); if (action) controller.operate(action, true); };
  const copy = async () => {
    try { await globalThis.navigator.clipboard.writeText(maintenanceDiagnostic(state)); setCopyStatus('已复制脱敏诊断'); }
    catch { setCopyStatus('无法复制，请检查浏览器剪贴板权限。'); }
  };
  return h('section', { className: 'mg-maintenance', 'aria-label': '模型分组设置', 'aria-busy': state.busy },
    h('h2', null, '模型分组 · 多密钥管理'),
    h('p', null, '选择操作，再确认一次即可。不会调用 AI，不会显示或删除 API 密钥。'),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '当前状态' },
      h('div', { className: 'mg-maintenance-row' }, h('h3', null, '当前状态'), h('button', { type: 'button', disabled: state.busy, onClick: refresh }, state.busy ? '处理中…' : '刷新检查')),
      h('p', { role: 'status', 'aria-live': 'polite', className: 'mg-maintenance-help' }, state.busy ? '正在检查或执行维护，请勿关闭或重复操作。' : snapshot ? statusLabel : '尚无可验证状态，请刷新检查。'),
      state.error && h('p', { role: 'alert', className: 'mg-maintenance-error' }, state.error),
      state.patchedWarning && h('p', { role: 'alert', className: 'mg-maintenance-error' }, '警告：从普通插件列表卸载只移除插件，仍会留下宿主补丁，可能造成升级、文件冲突及旧多密钥模型依赖问题。请使用这里的“关闭并卸载插件”。'),
      snapshot?.restartRequired && h('p', { role: 'status' }, '本进程已实际修改宿主文件，需要重启原引擎并刷新；页面刷新或插件重载不等于进程重启。'),
      updatesAvailable && h('p', { role: 'status' }, '多密钥补丁有更新可用；确认后将备份、校验并更新已识别的旧补丁。'),
      snapshot?.phase === 'removed' && h('p', { role: 'status' }, '卸载已确认：仅清理本插件的两个浏览器显示偏好，密钥、历史和备份均保留。'),
      snapshot?.warnings.length > 0 && h('p', { className: 'mg-maintenance-warning', role: 'status' }, '部分使用情况未验证，关闭前请阅读提示；检查提醒不会额外禁用操作。'),
      snapshot?.blockers.length > 0 && h('div', { role: 'alert' }, h('strong', null, '操作限制（各按钮以安全权限为准）'), h('ul', null, ...snapshot.blockers.map((blocker, index) => h('li', { key: index }, maintenanceBlockerText(blocker))))),
      state.cleanupWarning && h('p', { role: 'status' }, '卸载已确认，但浏览器阻止清理本插件的显示偏好；其他数据未受影响。')),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '多密钥操作' },
      h('h3', null, '多密钥操作'),
      h('div', { className: 'mg-maintenance-actions' }, ...actions.map(([action, label]) => h('button', { key: action, type: 'button', className: action === 'restore-and-uninstall' ? 'mg-maintenance-secondary mg-maintenance-danger' : 'mg-maintenance-primary', disabled: state.busy || !!pending || !maintenanceCanAction(snapshot, action), onClick: () => setPending(action) }, label))),
      !anyAllowed && h('p', null, '请刷新检查或处理上方操作限制。检查提醒本身不会禁用按钮。'),
      pending && h('div', { role: 'dialog', 'aria-labelledby': confirmationId, 'aria-describedby': `${confirmationId}-help`, className: 'mg-maintenance-dialog' },
        h('h3', { id: confirmationId }, `确认${actions.find(([action]) => action === pending)[1]}？`),
        h('p', { id: `${confirmationId}-help` }, pending === 'apply' ? '将备份、校验并修改宿主文件以启用多密钥。不会自动换服务或模型。请保存草稿、停止任务，完成后重启原引擎。' : '将校验并恢复宿主原版，关闭多密钥。密钥、配置和历史保留，不自动换服务或模型；旧多密钥选择和配置可能影响后续使用或重启。请保存草稿、停止任务，完成后重启原引擎。'),
        h('p', null, '请先停止所有任务。部分使用情况未能检查不等于安全；检查提醒不会替代您的判断。'),
        pending === 'restore-and-uninstall' && h('p', null, '确认原版恢复成功后才卸载插件；只有确认卸载完成才清理本插件的两个浏览器显示偏好。连接中断不代表成功。'),
        h('div', { className: 'mg-maintenance-actions' }, h('button', { type: 'button', onClick: () => setPending(null) }, '取消'), h('button', { type: 'button', disabled: state.busy || !maintenanceCanAction(snapshot, pending), onClick: confirm }, '确认执行')))),
    h('details', { className: 'mg-maintenance-card' },
      h('summary', null, '检查详情与脱敏诊断'),
      h('p', null, '这里只验证磁盘和安全权限，运行时是否已切换未知。每次确认后会重新检查；状态变化需重新确认。未知文件不会强制覆盖，检查不完整仅提醒；操作仍以各自安全权限为准。'),
      snapshot?.warnings.length > 0 && h('ul', null, ...snapshot.warnings.map((warning, index) => h('li', { key: index }, maintenanceWarningText(warning)))),
      snapshot && h('ul', null, ...snapshot.patches.map((patch, index) => h('li', { key: index }, `宿主文件 ${index + 1}：${patchLabels[patch.state]}${patch.updateAvailable ? '（更新可用）' : ''}`))),
      h('button', { type: 'button', onClick: copy }, '复制脱敏诊断'),
      h('p', { role: 'status' }, copyStatus)));
}
