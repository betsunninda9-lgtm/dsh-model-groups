const groupPreferences = createGroupPreferences();
const EMPTY_PROVIDERS_SNAPSHOT = Object.freeze({ status: 'unavailable', value: {} });

const inject = ['slots', 'modelDirectories', 'sessions', 'locale', 'remote', 'remote.session', 'remote.llm', 'configForms'];
export function apply(ctx) {
  installModelSelectStyles();
  installModelGroupsStyles();
  installSettingsPageStyles();
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-model-groups', order: 35, label: '模型分组',
  }, ModelGroupsSettingsPage));
  const providersForm = ctx.configForms?.get('llm-pi-ai');
  let statusDisposed = false;
  let statusNotice, statusTimer;
  let dismissedStatus;
  function showPatchStatus(status) {
    if (statusDisposed) return;
    const message = patchStatusMessage(status);
    statusNotice?.remove();
    statusNotice = undefined;
    if (message && dismissedStatus !== message) {
      statusNotice = document.createElement('div');
      statusNotice.dataset.plugin = 'dsh-model-groups';
      statusNotice.setAttribute('role', 'status');
      statusNotice.style.cssText = 'position:fixed;bottom:max(4px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);z-index:100;display:flex;align-items:center;gap:8px;padding:3px 8px 3px 10px;border:0;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 65%,transparent);color:var(--dsw-alias-label-secondary,#777);font:11px/18px system-ui,sans-serif;box-sizing:border-box;pointer-events:none;';
      const label = document.createElement('span');
      label.textContent = status.restartRequired ? '模型分组 · 重启引擎后生效'
        : status.state === 'deferred' ? '模型分组 · 空闲后自动恢复'
        : '模型分组 · 兼容详情见设置';
      label.title = message;
      label.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;';
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', '收起模型分组提示');
      close.title = '收起提示，详情仍可在设置 → 模型分组查看';
      close.style.cssText = 'border:0;background:transparent;color:inherit;padding:0 4px;min-width:24px;min-height:24px;font:16px/24px system-ui,sans-serif;cursor:pointer;pointer-events:auto;';
      close.onclick = () => { dismissedStatus = message; statusNotice?.remove(); statusNotice = undefined; };
      statusNotice.appendChild(label);
      statusNotice.appendChild(close);
      document.body.appendChild(statusNotice);
    }
    if (status.state === 'deferred') statusTimer = setTimeout(refreshPatchStatus, 15_000);
  }
  function refreshPatchStatus() {
    if (statusDisposed) return;
    Promise.resolve().then(() => fetch('/dsh-model-groups/status', { credentials: 'same-origin', cache: 'no-store' }))
      .then(response => { if (!response.ok) throw new Error('status unavailable'); return response.json(); })
      .then(showPatchStatus).catch(() => {});
  }
  if (typeof fetch === 'function') refreshPatchStatus();
  ctx.on('dispose', () => { statusDisposed = true; clearTimeout(statusTimer); statusNotice?.remove(); });
  const onStorage = event => {
    if (event.key === STORAGE_KEY || event.key === null) groupPreferences.sync(event.key === null ? null : event.newValue);
  };
  window.addEventListener('storage', onStorage);
  ctx.on('dispose', () => {
    window.removeEventListener('storage', event => onStorage(event));
    document.querySelectorAll('style[data-plugin="dsh-model-groups"]').forEach(style => style.remove());
  });
  return ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model',
    priority: -10,
    locale: 'model',
    inject(sessionId) {
      const directory = ctx.modelDirectories.directoryFor(sessionId);
      const available = ctx.sessions.subagentAddress(sessionId) === undefined;
      return {
        available,
        directory: directory.store,
        providersForm,
        load() { if (available) directory.load().catch(() => {}); },
        select: selection => available ? directory.select(selection) : Promise.resolve(undefined),
      };
    },
  }, ModelSeatBoundary));
}
