export function ModelGroupsSettingsPage() {
  const h = react.createElement;
  const controller = react.useMemo(() => createMaintenanceController(), []);
  const state = react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [checked, setChecked] = react.useState(false);
  const confirmationId = react.useId();
  react.useEffect(() => { controller.activate(); controller.refresh(); return () => controller.dispose(); }, [controller]);
  const snapshot = state.snapshot;
  const phaseLabels = { idle: '待检查 / 可维护', applied: '磁盘补丁已应用', restored: '磁盘原版已恢复（不代表已卸载）', removing: '正在卸载，尚未确认完成', removed: '已确认恢复原版并卸载', failed: '维护失败，未确认完成' };
  const patchLabels = { patched: '磁盘补丁已应用', pristine: '磁盘原版', conflict: '冲突（不会强制覆盖）' };
  const refresh = () => { setChecked(false); controller.refresh(); };
  const operate = action => { const accepted = checked; setChecked(false); controller.operate(action, accepted); };
  const actions = [
    ['apply', '安装多密钥补丁'], ['restore-only', '移除补丁，保留插件'], ['restore-and-uninstall', '移除补丁并卸载插件'],
  ];
  const anyAllowed = actions.some(([action]) => maintenanceCanAction(snapshot, action));
  return h('section', { className: 'mg-maintenance', 'aria-label': '模型分组设置', 'aria-busy': state.busy },
    h('h2', null, '模型分组 · 手动补丁管理（首个预览）'),
    h('p', null, '仅在明确确认后应用或恢复宿主补丁。此页不会调用 AI，也不会显示、返回或修改 API 密钥。'),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '安装状态' },
      h('div', { className: 'mg-maintenance-row' }, h('h3', null, '安装状态'), h('button', { type: 'button', disabled: state.busy, onClick: refresh }, state.busy ? '处理中…' : '刷新检查')),
      h('p', { role: 'status', 'aria-live': 'polite' }, state.busy ? '正在请求安全检查或执行维护，请勿关闭或重复操作。' : snapshot ? phaseLabels[snapshot.phase] : '尚无可验证状态'),
      state.error && h('p', { role: 'alert', className: 'mg-maintenance-error' }, state.error),
      state.patchedWarning && h('p', { role: 'alert', className: 'mg-maintenance-error' }, '警告：仍有宿主文件处于补丁状态。普通卸载只移除插件，会留下宿主修改，带来升级、文件冲突及模型别名依赖风险；请使用此页的恢复操作处理。'),
      snapshot && h('p', { role: 'status' }, snapshot.restartRequired
        ? '磁盘状态不代表当前运行时已切换。需要重启原引擎；请先保存草稿，重启后刷新检查。重启前已加载的代码可能仍在运行。'
        : '这里只验证磁盘与安全检查状态；当前运行时是否已加载对应代码、是否已完成重启均未知，不应据此认定立即生效。'),
      snapshot?.phase === 'removed' && h('p', { role: 'status' }, '已保留所有供应商配置、密钥、会话历史、安全备份和其他浏览器偏好；仅清理当前浏览器本插件的两个显示偏好。'),
      snapshot && h('ul', null, ...snapshot.patches.map((patch, index) => h('li', { key: index }, `补丁 ${index + 1}：${patchLabels[patch.state]}`))),
      snapshot?.blockers.length > 0 && h('div', { role: 'alert' }, h('strong', null, '安全诊断 / 操作限制（按钮按各自能力启用）：'), h('ul', null, ...snapshot.blockers.map((blocker, index) => h('li', { key: index }, maintenanceBlockerText(blocker))))),
      snapshot && !anyAllowed && !['removed', 'removing'].includes(snapshot.phase) && h('p', null, '当前状态不允许维护，请处理阻塞后刷新检查。'),
      state.cleanupWarning && h('p', { role: 'status' }, '卸载已确认，但浏览器阻止清理本插件的显示偏好；其他数据未受影响。')),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '手动补丁操作' },
      h('h3', null, '手动补丁操作'),
      h('p', null, '安装多密钥补丁：备份、校验并修改五个宿主文件。移除补丁，保留插件：撤销宿主修改，但不删除插件。移除补丁并卸载插件：先验证宿主还原成功，再卸载插件。未知文件不强制覆盖。'),
      h('p', null, '保留供应商配置、凭据、会话历史和备份；仅在明确确认卸载成功后清理本插件的两个浏览器显示偏好。连接中断不代表操作成功。每次操作前重新检查，状态变化需重新确认。'),
      h('fieldset', { disabled: state.busy, 'aria-describedby': `${confirmationId}-help` },
        h('legend', null, '确认维护操作'),
        h('p', { id: `${confirmationId}-help`, role: 'status', className: 'mg-maintenance-help' }, state.busy ? '正在检查或执行维护，请稍候。' : !snapshot ? '请先刷新检查。状态验证通过前不会执行维护。' : anyAllowed ? '勾选确认后选择操作；按钮仅在该操作的安全检查通过时启用，无需输入文字。' : '请先处理上方安全诊断，再刷新检查。勾选确认不会绕过检查。'),
        h('label', { className: 'mg-maintenance-check' }, h('input', { id: confirmationId, type: 'checkbox', checked, onChange: event => setChecked(event.target.checked) }), '我已保存草稿并停止运行中的任务，理解所选操作会修改宿主文件，并可能卸载插件；磁盘修改后需按提示重启原引擎。'),
        ...actions.map(([action, label]) => h('button', { key: action, type: 'button', ...(action === 'restore-and-uninstall' ? { className: 'mg-maintenance-danger' } : {}), disabled: state.busy || !maintenanceCanAction(snapshot, action) || !checked, onClick: () => operate(action) }, label)))),
    h('section', { className: 'mg-maintenance-card', 'aria-label': '预览限制' }, h('h3', null, '首个预览的限制'), h('p', null, '发现多密钥配置或旧模型依赖时，暂不允许移除补丁。备用模型切换与配置归档尚未接入本页；本版用于体验手动补丁管理，不是完整退出向导。无需为试用本页手工改配置；仍有依赖时请保留补丁。')));
}
