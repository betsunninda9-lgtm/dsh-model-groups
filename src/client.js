const groupPreferences = createGroupPreferences();
const EMPTY_PROVIDERS_SNAPSHOT = Object.freeze({ status: 'unavailable', value: {} });

const inject = ['slots', 'modelDirectories', 'sessions', 'locale', 'remote', 'remote.session', 'remote.llm', 'configForms'];
export function apply(ctx) {
  installModelSelectStyles();
  installModelGroupsStyles();
  const nativeForm = ctx.configForms?.get('llm-pi-ai');
  const ownForm = ctx.configForms?.get('model-groups');
  const bridgeStore = createBridgeStore({ forms: [nativeForm, ownForm] });
  const providersForm = createBridgeProvidersForm(nativeForm, bridgeStore);
  const disposers = [];
  let disposed = false;
  const onStorage = event => {
    if (event.key === STORAGE_KEY || event.key === null) groupPreferences.sync(event.key === null ? null : event.newValue);
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    bridgeStore.dispose();
    providersForm.dispose();
    for (const remove of disposers) remove?.();
    window.removeEventListener('storage', onStorage);
    document.querySelectorAll('style[data-plugin="dsh-model-groups"]').forEach(style => style.remove());
  }
  ctx.on('dispose', dispose);
  window.addEventListener('storage', onStorage);
  try {
    disposers.push(registerBridgeProviderCard(ctx, react, bridgeStore, _deepseek_ai_dsh_client_ui_primitives));
    disposers.push(ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
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
    }, ModelSeatBoundary)));
    bridgeStore.refresh();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
