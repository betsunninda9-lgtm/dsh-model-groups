const groupPreferences = createGroupPreferences();
const EMPTY_PROVIDERS_SNAPSHOT = Object.freeze({ status: 'unavailable', value: {} });

const inject = ['slots', 'modelDirectories', 'sessions', 'locale', 'remote', 'remote.session', 'remote.llm', 'configForms'];
export function apply(ctx) {
  installModelSelectStyles();
  installModelGroupsStyles();
  const providersForm = ctx.configForms?.get('llm-pi-ai');
  let statusDisposed = false;
  let statusNotice;
  if (typeof fetch === 'function') Promise.resolve().then(() => fetch('/dsh-model-groups/status', { credentials: 'same-origin', cache: 'no-store' }))
    .then(response => { if (!response.ok) throw new Error('status unavailable'); return response.json(); })
    .then(status => {
      if (statusDisposed || (!status.restartRequired && !status.failed)) return;
      statusNotice = document.createElement('div');
      statusNotice.dataset.plugin = 'dsh-model-groups';
      statusNotice.setAttribute('role', 'alertdialog');
      statusNotice.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);display:grid;place-items:center;padding:24px;box-sizing:border-box;';
      statusNotice.textContent = status.failed
        ? '多密钥自动补丁未完成。请回到 App 对话查看引擎日志或运行安装诊断，勿强制覆盖。当前网页暂不可用于编辑模型配置。'
        : '多密钥补丁已自动安装。请先保存其他页面的草稿，再到 App 重启原引擎并刷新此网页。当前网页暂停操作，避免新旧模块混用。';
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
