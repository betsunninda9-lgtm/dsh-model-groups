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
  let statusNotice;
  if (typeof fetch === 'function') Promise.resolve().then(() => fetch('/dsh-model-groups/status', { credentials: 'same-origin', cache: 'no-store' }))
    .then(response => { if (!response.ok) throw new Error('status unavailable'); return response.json(); })
    .then(status => {
      if (statusDisposed || (!status.restartRequired && !status.failed)) return;
      statusNotice = document.createElement('div');
      statusNotice.dataset.plugin = 'dsh-model-groups';
      statusNotice.setAttribute('role', 'status');
      statusNotice.style.cssText = 'position:fixed;bottom:16px;right:16px;max-width:min(360px,80vw);z-index:1000;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);padding:12px;border:1px solid currentColor;border-radius:8px;box-sizing:border-box;pointer-events:none;';
      statusNotice.textContent = status.failed
        ? '无法检查多密钥功能所需的 DSH 文件。请打开「设置 → 模型分组」查看详情，不要手动覆盖文件。'
        : 'DSH 程序文件已更新。请先保存草稿，再重启 DSH 引擎并刷新网页。重启前请暂缓修改模型设置。';
      document.body.appendChild(statusNotice);
    }).catch(() => {});
  ctx.on('dispose', () => { statusDisposed = true; statusNotice?.remove(); });
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
