import { compatibilityGuidance } from './compatibility.js';
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
  const statusLabel = snapshot?.versionMismatch ? '网页与维护后端版本不一致，请先重启并刷新' : snapshot?.phase === 'idle'
    ? snapshot.patches.some(patch => patch.state === 'conflict') ? '磁盘文件校验冲突，已停止整批维护'
      : snapshot.patches.some(patch => patch.applySupported === false) ? '旧补丁已识别，但此构建不支持新版协议补丁'
      : updatesAvailable ? '旧多密钥补丁已应用，新版更新待确认'
      : snapshot.patches.length && snapshot.patches.every(patch => patch.state === 'patched') ? '多密钥已启用（磁盘状态）'
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
    h('h2', null, '多密钥管理'),
    h('p', null, '在这里启用、更新或关闭多密钥。如果只想按供应商浏览模型，无需启用多密钥。'),
    snapshot?.pluginVersion && h('p', { className: 'mg-maintenance-help' }, `插件 ${snapshot.pluginVersion} · DSH ${snapshot.compatibility?.hostVersion ?? '版本未确认'}`),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '当前状态' },
      h('div', { className: 'mg-maintenance-row' }, h('h3', null, '当前状态'), h('button', { type: 'button', disabled: state.busy, onClick: refresh }, state.busy ? '处理中…' : '刷新检查')),
      h('p', { role: 'status', 'aria-live': 'polite', className: 'mg-maintenance-help' }, state.busy ? '正在检查或执行维护，请勿关闭或重复操作。' : snapshot ? statusLabel : '尚无可验证状态，请刷新检查。'),
      state.error && h('p', { role: 'alert', className: 'mg-maintenance-error' }, state.error),
      state.patchedWarning && h('p', { role: 'alert', className: 'mg-maintenance-error' }, '从普通插件列表卸载只移除插件，不会还原 DSH 文件。需要卸载时，请使用此页的「关闭并卸载插件」。'),
      snapshot?.restartRequired && h('p', { role: 'status' }, 'DSH 程序文件已更新，需要重启 DSH 引擎，再刷新网页。只刷新网页不会生效。'),
      compatibilityGuidance(snapshot?.compatibility) && h('p', { role: 'status', className: 'mg-maintenance-help' }, compatibilityGuidance(snapshot.compatibility)),
      updatesAvailable && h('p', { role: 'status' }, '多密钥补丁有更新可用；确认后将备份、校验并更新已识别的旧补丁。'),
      snapshot?.phase === 'removed' && !snapshot.versionMismatch && h('p', { role: 'status' }, '卸载已确认：仅清理本插件的两个浏览器显示偏好，密钥、历史和备份均保留。'),
      snapshot?.warnings.length > 0 && h('p', { className: 'mg-maintenance-warning', role: 'status' }, '部分使用情况未验证，关闭前请阅读提示；检查提醒不会额外禁用操作。'),
      snapshot?.blockers.length > 0 && h('div', { role: 'alert' }, h('strong', null, '操作限制（各按钮以安全权限为准）'), h('ul', null, ...snapshot.blockers.map((blocker, index) => h('li', { key: index }, maintenanceBlockerText(blocker))))),
      state.cleanupWarning && h('p', { role: 'status' }, '卸载已确认，但浏览器阻止清理本插件的显示偏好；其他数据未受影响。')),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '多密钥操作' },
      h('h3', null, '多密钥操作'),
      h('div', { className: 'mg-maintenance-actions' }, ...actions.map(([action, label]) => h('button', { key: action, type: 'button', className: action === 'restore-and-uninstall' ? 'mg-maintenance-secondary mg-maintenance-danger' : 'mg-maintenance-primary', disabled: state.busy || !!pending || !maintenanceCanAction(snapshot, action), onClick: () => setPending(action) }, label))),
      !anyAllowed && h('p', null, '请刷新检查或处理上方操作限制。检查提醒本身不会禁用按钮。'),
      pending && h('div', { role: 'dialog', 'aria-labelledby': confirmationId, 'aria-describedby': `${confirmationId}-help`, className: 'mg-maintenance-dialog' },
        h('h3', { id: confirmationId }, `确认${actions.find(([action]) => action === pending)[1]}？`),
        h('p', { id: `${confirmationId}-help` }, pending === 'apply'
          ? `插件会检查并备份 DSH 程序文件，再${updatesAvailable ? '更新多密钥补丁' : '启用多密钥'}。不会自动切换模型。`
          : '插件会还原 DSH 程序文件，保留密钥、配置和聊天记录。请先将仍使用多密钥的会话和默认模型改为普通模型；残留的多密钥配置可能影响 DSH 启动。'),
        h('p', null, '请先保存草稿并停止所有任务。完成后按提示重启 DSH 引擎，再刷新网页。'),
        snapshot?.warnings.length > 0 && h('p', null, '部分使用情况无法检查，请先阅读页面中的检查详情。'),
        pending === 'restore-and-uninstall' && h('p', null, '还原成功后才会卸载插件。确认卸载后会清除本浏览器中的模型菜单显示偏好；连接中断不代表卸载成功。'),
        h('div', { className: 'mg-maintenance-actions' }, h('button', { type: 'button', onClick: () => setPending(null) }, '取消'), h('button', { type: 'button', disabled: state.busy || !maintenanceCanAction(snapshot, pending), onClick: confirm }, '确认执行')))),
    h('details', { className: 'mg-maintenance-card' },
      h('summary', null, '检查详情与脱敏诊断'),
      h('p', null, '这里能检查 DSH 文件，但无法确认正在运行的引擎是否已加载更新。确认操作后会再次检查；如果状态变化，需要重新确认。无法识别的文件不会被覆盖。'),
      snapshot?.warnings.length > 0 && h('ul', null, ...snapshot.warnings.map((warning, index) => h('li', { key: index }, maintenanceWarningText(warning)))),
      snapshot && h('ul', null, ...snapshot.patches.map((patch, index) => h('li', { key: index }, `宿主文件 ${index + 1}：${patchLabels[patch.state]}${patch.applySupported === false ? '（此构建不支持新版补丁）' : patch.updateAvailable ? '（更新可用）' : ''}`))),
      snapshot?.compatibility && h('ul', null, ...snapshot.compatibility.files.map(item => h('li', { key: item.id }, `${item.id} · ${item.installedVersion ?? '版本未知'} · ${item.code} · SHA-256 ${item.observedSha256 ?? '不可读取'}`))),
      h('p', null, '诊断仅含程序版本、固定文件标识与程序 SHA-256，不含文件路径、配置正文、密钥或聊天。升级失败请先保留现场，不要用另一构建的文件覆盖。'),
      h('button', { type: 'button', onClick: copy }, '复制脱敏诊断'),
      h('p', { role: 'status' }, copyStatus)));
}
