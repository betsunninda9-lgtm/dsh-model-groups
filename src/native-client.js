// Native-only entry: never reads provider configuration or runs legacy maintenance.
const groupPreferences = createGroupPreferences();
const EMPTY_PROVIDERS_SNAPSHOT = Object.freeze({ status: 'unavailable', value: {} });
const EMPTY_NATIVE_METADATA = Object.freeze({ groups: Object.freeze({}) });
const EMPTY_NATIVE_FORM = Object.freeze({ status: 'unavailable', writable: false });
const inject = ['slots', 'modelDirectories', 'sessions', 'locale', 'remote.session', 'configForms'];

export function NativeModelSeat(props) {
  const snapshot = react.useSyncExternalStore(
    listener => props.metadataForm?.subscribe(listener) ?? (() => {}),
    () => props.metadataForm?.getSnapshot() ?? EMPTY_NATIVE_FORM,
    () => EMPTY_NATIVE_FORM,
  );
  // Never let loading/error/unavailable metadata enter the legacy alias branch.
  const nativeMetadata = snapshot.status === 'ready' && snapshot.value != null
    ? snapshot.value : EMPTY_NATIVE_METADATA;
  return react.createElement(ModelSeatBoundary, { ...props, nativeMetadata });
}

// One module-stable operation identity keeps an accepted preview valid across
// host settings rerenders. Never use legacy RPC/maintenance as a fallback.
const nativeCreateOperations = Object.freeze({
  preview: group => nativeCreateRequest({ action: 'preview', group }),
  save: (group, revision, fingerprint) => nativeCreateRequest({
    action: 'save', group, revision, fingerprint, confirmation: 'CREATE NATIVE GROUP',
  }),
});

async function nativeCreateRequest(body) {
  try {
    const response = await fetch('/dsh-model-groups/native-create', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response?.ok !== true) throw new Error();
    const envelope = await response.json();
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      envelope.ok !== true || Object.keys(envelope).some(key => !['ok', 'value'].includes(key))) throw new Error();
    const value = envelope.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    if (body.action === 'preview') {
      if (value.status !== 'preview' || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        typeof value.fingerprint !== 'string' || !value.fingerprint) throw new Error();
    } else if (!['saved', 'native-saved-metadata-pending'].includes(value.status) ||
      !['saved', 'unchanged'].includes(value.nativeStatus)) throw new Error();
    return value;
  } catch {
    // Network/JSON/host errors may contain credential material. Never expose it.
    throw new Error('Native group operation failed.');
  }
}

export function NativeModelGroupsSettings(props) {
  return react.createElement('div', null,
    react.createElement(NativeModelGroupCreatePage, { operations: nativeCreateOperations }),
    react.createElement(NativeModelGroupsSettingsPage, props));
}

export function apply(ctx) {
  installModelSelectStyles();
  installModelGroupsStyles();
  installSettingsPageStyles();
  const metadataForm = ctx.configForms?.get('model-groups');
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-model-groups', order: 35, label: '模型分组',
    inject: () => ({ metadataForm, loadNativeCatalog: () => ctx.remote.session.modelCatalog() }),
  }, NativeModelGroupsSettings));
  const onStorage = event => {
    if (event.key === STORAGE_KEY || event.key === null) groupPreferences.sync(event.key === null ? null : event.newValue);
  };
  window.addEventListener('storage', onStorage);
  ctx.on('dispose', () => {
    window.removeEventListener('storage', onStorage);
    document.querySelectorAll('style[data-plugin="dsh-model-groups"]').forEach(style => style.remove());
  });
  return ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model', priority: -10, locale: 'model',
    inject(sessionId) {
      const directory = ctx.modelDirectories.directoryFor(sessionId);
      const available = ctx.sessions.subagentAddress(sessionId) === undefined;
      return {
        available, directory: directory.store, metadataForm,
        load() { if (available) directory.load().catch(() => {}); },
        select: selection => available ? directory.select(selection) : Promise.resolve(undefined),
      };
    },
  }, NativeModelSeat));
}
