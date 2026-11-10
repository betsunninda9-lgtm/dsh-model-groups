export function ModelGroupsSettingsPage() {
  const h = react.createElement;
  const controller = react.useMemo(() => createMaintenanceController(), []);
  const state = react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [checked, setChecked] = react.useState(false);
  const [confirmation, setConfirmation] = react.useState('');
  const confirmationId = react.useId();
  react.useEffect(() => { controller.activate(); controller.refresh(); return () => controller.dispose(); }, [controller]);
  const snapshot = state.snapshot;
  const phaseLabels = { idle: '待检查 / 可维护', restored: '原版已恢复，卸载尚未确认', removing: '正在卸载，尚未确认完成', removed: '已确认恢复原版并卸载', failed: '维护失败，未确认卸载成功' };
  const patchLabels = { patched: '补丁已应用', pristine: '原版', conflict: '冲突（不会强制覆盖）' };
  const resetConfirmation = () => { setChecked(false); setConfirmation(''); };
  const refresh = () => { resetConfirmation(); controller.refresh(); };
  const restore = () => { const accepted = checked; const text = confirmation; resetConfirmation(); controller.restore(accepted, text); };
  return h('section', { className: 'mg-maintenance', 'aria-label': '模型分组设置', 'aria-busy': state.busy },
    h('h2', null, '模型分组'),
    h('p', null, '基于 0.3.4 补丁版 · 状态检查与安全维护。此页不会调用 AI，也不会显示、返回或修改 API 密钥。'),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '安装状态' },
      h('div', { className: 'mg-maintenance-row' }, h('h3', null, '安装状态'), h('button', { type: 'button', disabled: state.busy, onClick: refresh }, state.busy ? '处理中…' : '刷新检查')),
      h('p', { role: 'status', 'aria-live': 'polite' }, state.busy ? '正在请求安全检查，请勿关闭或重复操作。' : snapshot ? phaseLabels[snapshot.phase] : '尚无可验证状态'),
      state.error && h('p', { role: 'alert', className: 'mg-maintenance-error' }, state.error),
      snapshot?.restartRequired && h('p', { role: 'status' }, snapshot.phase === 'failed'
        ? '补丁可能已还原，但卸载未完成；防止自动重新打补丁的标记已保留。请先保存草稿，重启原引擎后刷新检查，不要强制覆盖。'
        : '需要重启原引擎。请先保存其他页面草稿，再重启并刷新网页。'),
      snapshot?.phase === 'removed' && h('p', { role: 'status' }, '已保留所有供应商配置、密钥、会话历史、安全备份和其他浏览器偏好；仅清理当前浏览器本插件的两个显示偏好。'),
      snapshot && h('ul', null, ...snapshot.patches.map((patch, index) => h('li', { key: index }, `补丁 ${index + 1}：${patchLabels[patch.state]}`))),
      snapshot?.blockers.length > 0 && h('div', { role: 'alert' }, h('strong', null, '暂不可安全恢复：'), h('ul', null, ...snapshot.blockers.map((blocker, index) => h('li', { key: index }, maintenanceBlockerText(blocker))))),
      snapshot && !maintenanceCanRestore(snapshot) && !['removed', 'removing'].includes(snapshot.phase) && h('p', null, '当前状态不允许恢复，请处理阻塞后刷新检查。'),
      state.cleanupWarning && h('p', { role: 'status' }, '卸载已确认，但浏览器阻止清理本插件的显示偏好；其他数据未受影响。')),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '安全恢复原版并卸载' },
      h('h3', null, '安全恢复原版并卸载'),
      h('p', null, '仅在你明确确认后执行：先验证并恢复本插件补丁，再卸载本插件。不会强制覆盖冲突文件。'),
      h('p', null, '保留所有供应商配置、凭据、会话历史和备份。仅在服务器明确确认卸载成功后，清理本插件的两个浏览器显示偏好。连接中断不代表卸载成功。'),
      h('fieldset', { disabled: state.busy || !maintenanceCanRestore(snapshot) },
        h('legend', null, '确认维护操作'),
        h('label', { className: 'mg-maintenance-check' }, h('input', { type: 'checkbox', checked, onChange: event => setChecked(event.target.checked) }), '我已保存草稿并停止运行中的任务，理解此操作会恢复原版并卸载本插件。'),
        h('label', { htmlFor: confirmationId }, '输入 RESTORE AND UNINSTALL（区分大小写）'),
        h('input', { id: confirmationId, type: 'text', value: confirmation, autoComplete: 'off', spellCheck: false, onChange: event => setConfirmation(event.target.value) }),
        h('button', { type: 'button', className: 'mg-maintenance-danger', disabled: state.busy || !maintenanceCanRestore(snapshot) || !checked || confirmation !== MAINTENANCE_CONFIRMATION, onClick: restore }, '恢复原版并卸载'))),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '未来扩展' }, h('h3', null, '未来扩展'), h('p', null, '此区域预留给后续设置能力；当前没有额外开关，不会改变模型、密钥或自动执行维护。')));
}
