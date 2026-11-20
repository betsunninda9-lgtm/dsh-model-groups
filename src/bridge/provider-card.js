import { materializeCapabilityEntry } from '../capability-defaults.js';
import { createLegacyModelsUI, legacyModelsText } from './legacy-models-ui.js';
import { bridgeEditorDraft, bridgeEditorChanged, editorSharedValue, editorFieldPatch, copyEditorValue, singleKeyReference } from './editor-state.js';

const bridgeRoute = provider => typeof provider === 'string' ? provider : provider?.provider ?? provider?.id;
const ROOT_KEY = '@root';
const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const snapshotFor = (React, bridgeStore) => {
  const empty = React.useMemo(() => ({ status: 'unavailable', providers: {} }), []);
  const subscribe = React.useCallback(listener => bridgeStore?.subscribe?.(listener) ?? (() => {}), [bridgeStore]);
  const get = React.useCallback(() => bridgeStore?.getSnapshot?.() ?? empty, [bridgeStore, empty]);
  return React.useSyncExternalStore(subscribe, get);
};

/** One complete editor, mounted only in the optional native editor seam. */
export function createBridgeProviderCard(React, primitives = {}) {
  const h = React.createElement, css = key => `dsh-mg-native-${key}`, t = legacyModelsText;
  const { MultiKeyEntriesEditor, MultiKeyToggle, ApiKeyInput, ModelListEditor, apiKeyFailure,
    validateDeepSeekModels, validateReasoningEfforts, normalizedMultiKeyEntries, multiKeyFailure, multiKeyRef } = createLegacyModelsUI(React, primitives);
  const loaded = (route, record, snapshot) => ({ route, draft: bridgeEditorDraft(record), baseline: bridgeEditorDraft(record), revision: snapshot.revision, nativeRevision: snapshot.nativeRevision, record });
  return function BridgeProviderEditor({ provider, bridgeStore, readOnly = false, open = true, onClose }) {
    const route = bridgeRoute(provider), snapshot = snapshotFor(React, bridgeStore);
    const record = snapshot.providers?.[route];
    const [editor, setEditor] = React.useState(() => loaded(route, record, snapshot));
    const [keyDrafts, setKeyDrafts] = React.useState({}), [confirmations, setConfirmations] = React.useState({});
    const [saveState, setSaveState] = React.useState(), [busy, setBusy] = React.useState(false);
    const [fetchBusy, setFetchBusy] = React.useState(false), [notice, setNotice] = React.useState(null);
    const [settingsExpanded, setSettingsExpanded] = React.useState(true);
    const mounted = React.useRef(true), operation = React.useRef(null), live = React.useRef();
    const secretNodes = React.useRef(new Map()), inputRefs = React.useRef(new Map());
    live.current = { route, editor, keyDrafts, open, settingsExpanded };
    const onBusyChange = React.useCallback(setFetchBusy, []);
    function clearSecrets() {
      for (const node of secretNodes.current.values()) node.value = '';
      secretNodes.current.clear(); inputRefs.current.clear();
    }
    function credentialRef(id) {
      if (!inputRefs.current.has(id)) inputRefs.current.set(id, node => {
        if (node) secretNodes.current.set(id, node);
        else { const old = secretNodes.current.get(id); if (old) old.value = ''; secretNodes.current.delete(id); }
      });
      return inputRefs.current.get(id);
    }
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current = null; clearSecrets(); }; }, []);
    React.useEffect(() => {
      setEditor(previous => {
        if (previous.route === route && (bridgeEditorChanged(previous.draft, previous.baseline)
          || Object.values(live.current.keyDrafts).some(value => value.trim())
          || previous.revision === snapshot.revision && previous.record === record && previous.nativeRevision === snapshot.nativeRevision)) return previous;
        return loaded(route, record, snapshot);
      });
      if (editor.route !== route) {
        operation.current = null; setBusy(false); setFetchBusy(false); setNotice(null);
        setKeyDrafts({}); setConfirmations({}); setSaveState(undefined); setSettingsExpanded(true); clearSecrets();
      }
    }, [route, snapshot.revision, snapshot.nativeRevision, record]);
    if (!route) return null;
    if (snapshot.status !== 'ready') return h('p', { className: css('advancedHint'), role: ['forbidden', 'error'].includes(snapshot.status) ? 'alert' : 'status' },
      snapshot.status === 'forbidden' ? '当前连接无权编辑供应商配置。' : snapshot.status === 'loading' ? '正在读取供应商配置…' : '供应商编辑服务暂不可用。');
    const draft = editor.route === route ? editor.draft : bridgeEditorDraft(record);
    const disabled = readOnly || !open || snapshot.writable === false || typeof bridgeStore?.save !== 'function' || busy || editor.route !== route;
    const hasUnsavedKeys = Object.values(keyDrafts).some(value => value.trim());
    const changed = bridgeEditorChanged(draft, editor.baseline) || hasUnsavedKeys;
    const update = patch => { if (!disabled) { setNotice(null); setEditor(previous => ({ ...previous, draft: { ...previous.draft, ...patch } })); } };
    const shared = draft.shared, updateShared = patch => update({ shared: { ...shared, ...patch } });
    const root = draft.singleKey, updateRoot = patch => update({ singleKey: { ...root, ...patch } });
    const normalized = normalizedMultiKeyEntries(route, draft.keyEntries);
    const validation = Object.keys(normalized).length || draft.enabled ? multiKeyFailure(route, normalized, draft.enabled ? keyDrafts : {}, confirmations, t) : undefined;
    const field = (label, name, value, onChange, type = 'text') => h('label', { className: css('field') },
      h('span', { className: css('fieldLabel') }, label), h('input', { className: css('input'), 'aria-label': name, value, type, disabled, onChange: event => onChange(event.target.value) }));
    const operations = {
      async discoverModels(_namespace, request) {
        const current = live.current;
        if (current.route !== route || !current.open || !current.settingsExpanded || typeof bridgeStore?.discover !== 'function') return { kind: 'refused', message: '模型发现服务暂不可用。' };
        const id = request.keyEntryId;
        const entry = id === undefined ? { ...(current.editor.draft.singleKey.apiKeyEnv ? { apiKeyEnv: current.editor.draft.singleKey.apiKeyEnv } : {}), models: [] }
          : normalizedMultiKeyEntries(route, current.editor.draft.keyEntries)[id];
        if (!entry) return { kind: 'refused', message: '此密钥配置已变化，请重试。' };
        try {
          const apiKey = request.apiKey || current.keyDrafts[id ?? ROOT_KEY];
          const patch = editorFieldPatch(editorSharedValue(current.editor.draft), editorSharedValue(current.editor.baseline));
          const options = { ...(apiKey ? { apiKey } : {}), ...(Object.keys(patch).length ? { shared: patch } : {}) };
          const result = await bridgeStore.discover(route, id, copyEditorValue(entry), options);
          if (!mounted.current || live.current.route !== route || !live.current.open || !live.current.settingsExpanded) return { kind: 'refused', message: '编辑器已关闭。' };
          return result?.ok === true ? { kind: 'found', models: result.models ?? [] } : { kind: 'refused', message: '获取模型失败，请检查 API 地址、协议和密钥。' };
        } catch { return { kind: 'refused', message: '获取模型失败，请检查连接和填写的配置。' }; }
      },
    };
    async function save() {
      if (disabled || fetchBusy || !changed || operation.current) return;
      let connection, connectionPatch, singlePatch;
      try {
        connection = editorSharedValue(draft);
        connectionPatch = editorFieldPatch(connection, editorSharedValue(editor.baseline));
        singlePatch = editorFieldPatch({ apiKeyEnv: root.apiKeyEnv || null, models: root.models },
          { apiKeyEnv: editor.baseline.singleKey.apiKeyEnv || null, models: editor.baseline.singleKey.models });
      } catch { setNotice({ error: true, text: '请求头必须是 JSON 对象，且每个值都应是文本。' }); return; }
      if (validation) { setNotice({ error: true, text: validation }); setSaveState({ ok: false, entries: copyEditorValue(normalized) }); return; }
      if (!draft.enabled) {
        const keyFailure = apiKeyFailure(keyDrafts[ROOT_KEY] ?? '');
        const modelFailure = validateDeepSeekModels(root.models) ?? validateReasoningEfforts(root.models);
        if (keyFailure || modelFailure) { setNotice({ error: true, text: keyFailure ? t(keyFailure) : `模型 ${modelFailure.index + 1}: ${t(modelFailure.key)}` }); return; }
      }
      const token = {}; operation.current = token; setBusy(true); setNotice(null);
      const isCurrent = () => mounted.current && operation.current === token && live.current.route === route;
      let stage = 'credential';
      try {
        const credentials = draft.enabled ? Object.entries(normalized).map(([id, entry]) => [id, entry.apiKeyEnv ?? multiKeyRef(route, id)])
          : [[ROOT_KEY, root.apiKeyEnv || singleKeyReference(route)]];
        for (const [id, reference] of credentials) {
          const value = (keyDrafts[id] ?? '').trim();
          if (!value) continue;
          if (id === ROOT_KEY) {
            singlePatch.apiKeyEnv = reference;
            setEditor(previous => ({ ...previous, draft: { ...previous.draft, singleKey: { ...previous.draft.singleKey, apiKeyEnv: reference } } }));
          }
          const answer = await bridgeStore.setCredential?.(reference, value);
          if (!isCurrent()) return;
          if (answer?.ok !== true) throw new Error('CREDENTIAL_FAILED');
          const input = secretNodes.current.get(id); if (input) input.value = '';
          setKeyDrafts(previous => ({ ...previous, [id]: '' }));
        }
        stage = 'config';
        const payload = { enabled: draft.enabled, keyEntries: normalized,
          ...(Object.keys(connectionPatch).length ? { shared: connectionPatch } : {}),
          ...(Object.keys(singlePatch).length ? { singleKey: singlePatch } : {}),
          ...(editor.nativeRevision === undefined ? {} : { expectedNativeRevision: editor.nativeRevision }) };
        const answer = await bridgeStore.save(route, payload, editor.revision);
        if (!isCurrent()) return;
        if (answer?.ok !== true) throw new Error('SAVE_FAILED');
        const latest = bridgeStore.getSnapshot(), latestRecord = latest.providers?.[route] ?? { ...record, ...payload };
        setEditor(loaded(route, latestRecord, latest)); setConfirmations({}); setSaveState({ ok: true, entries: copyEditorValue(normalized) });
        setNotice({ error: false, text: '已保存。' });
        if (live.current.open) onClose?.(true);
      } catch {
        if (isCurrent()) { setNotice({ error: true, text: stage === 'credential' ? '密钥保存失败，未完成的输入已保留，请重试。' : '保存未完成，草稿已保留。请取消编辑以重新载入最新配置后合并。' }); setSaveState({ ok: false, entries: copyEditorValue(normalized) }); }
      } finally { if (isCurrent()) { operation.current = null; setBusy(false); } }
    }
    return h('section', { className: `dsh-mg-provider ${css('editor')}`, 'data-bridge-provider': route, 'aria-label': '供应商配置' },
      h('div', { className: css('editorHeader'), 'data-bridge-provider-heading': true },
        h('span', { className: css('editorTitle') }, shared.displayName || provider?.displayName || route),
        (shared.displayName || provider?.displayName || route) !== route ? h('span', { className: css('editorRoute') }, route) : null),
      h('details', { className: css('customized'), 'data-bridge-public-settings': true, open: settingsExpanded,
        onToggle: event => setSettingsExpanded(event.currentTarget.open) },
        h('summary', { className: css('customizedSummary') }, '公共设置'),
        h('div', { className: css('customizedBody') },
          h('div', { className: 'dsh-mg-shared-fields' },
            field('显示名称', '供应商名称', shared.displayName, value => updateShared({ displayName: value })),
            field('API 地址', '共用 API 地址', shared.baseURL, value => updateShared({ baseURL: value }), 'url'),
            h('label', { className: css('field') }, h('span', { className: css('fieldLabel') }, 'API 协议'),
              h('select', { className: `${css('input')} ${css('selectInput')}`, 'aria-label': '共用 API 协议', value: shared.api, disabled,
                onChange: event => updateShared({ api: event.target.value }) },
                ...[['', '使用供应商默认协议'], ['openai-completions', 'OpenAI Chat Completions'], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages']].map(([value, label]) => h('option', { key: value, value }, label))))),
          h('details', { className: 'dsh-mg-shared-headers' }, h('summary', { className: css('advancedHint') }, '请求头'),
            h('textarea', { className: css('input'), style: { minHeight: 86, resize: 'vertical', width: '100%' }, rows: 3,
              'aria-label': '共用请求头 JSON', value: shared.headersText, disabled, onChange: event => updateShared({ headersText: event.target.value }) })),
          h(MultiKeyToggle, { t, checked: draft.enabled, disabled: disabled || fetchBusy || !settingsExpanded, hasUnsavedKeys, onChange: enabled => {
            if (enabled && (keyDrafts[ROOT_KEY] ?? '').trim()) { setNotice({ error: true, text: '请先保存或清空新输入的单密钥，再切换配置模式。' }); return; }
            const entries = { ...draft.keyEntries };
            if (enabled && !Object.keys(entries).length) {
              const id = `k${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
              entries[id] = { name: '', models: [] };
            }
            update({ enabled, keyEntries: entries });
          } }),
          record?.conflict ? h('p', { className: css('error'), role: 'alert' }, '原模型配置已在其他地方修改。关闭多密钥并保存可保留外部修改；继续启用前请重新检查。') : null,
          draft.enabled ? h(MultiKeyEntriesEditor, {
            route, entries: draft.keyEntries, keyDrafts, confirmations, reasoningLevels: REASONING_LEVELS,
            onChange: keyEntries => update({ keyEntries }), onKeyDraftsChange: next => { if (!disabled) setKeyDrafts(next); },
            onConfirmationsChange: setConfirmations, onBusyChange, editorVisible: open && settingsExpanded,
            operations, t, disabled, keyInputRef: credentialRef, probe: { provider: route, settingsNs: 'llm-pi-ai' },
            persistedEntries: editor.record?.keyEntries ?? {}, savedEntries: editor.record?.keyEntries ?? {}, saveState,
          }) : h('div', { className: 'dsh-mg-single-key', 'aria-label': '单密钥设置' },
            h('label', { className: css('field') }, h('span', { className: css('fieldLabel') }, 'API 密钥'),
              h(ApiKeyInput, { t, inputRef: credentialRef(ROOT_KEY), 'aria-label': '单密钥 API 密钥', value: keyDrafts[ROOT_KEY] ?? '', disabled,
                placeholder: root.apiKeyEnv ? t('multiKeyKeepKey') : '输入 API 密钥', onChange: event => setKeyDrafts(previous => ({ ...previous, [ROOT_KEY]: event.target.value })) })),
            h('p', { className: css('advancedHint') }, '输入留空保留原凭据；凭据引用：', h('code', null, root.apiKeyEnv || singleKeyReference(route))),
            h(ModelListEditor, { models: root.models, onChange: models => updateRoot({ models }), reasoningLevels: REASONING_LEVELS,
              operations, probe: { provider: route, settingsNs: 'llm-pi-ai', ...(root.apiKeyEnv ? { apiKeyEnv: root.apiKeyEnv } : {}) }, t,
              disabled, onBusyChange, editorVisible: open && settingsExpanded })))),
      notice ? h('p', { className: css(notice.error ? 'error' : 'advancedHint'), role: notice.error ? 'alert' : 'status' }, notice.text) : null,
      h('div', { className: css('editorActions') },
        h('button', { type: 'button', className: css('secondaryButton'), disabled: busy || fetchBusy, onClick: () => {
          operation.current = null; clearSecrets(); setKeyDrafts({}); setConfirmations({}); setNotice(null);
          setEditor(loaded(route, record, snapshot)); setSaveState({ ok: true, entries: copyEditorValue(record?.keyEntries ?? {}) }); onClose?.(false);
        } }, '取消'),
        h('button', { type: 'button', className: css('primaryButton'), disabled: disabled || fetchBusy || !changed, onClick: save }, busy ? '保存中…' : '保存')));
  };
}

/** Optional capability: no slot declaration means no editable addon form. */
export function registerBridgeProviderCard(ctx, React, bridgeStore, primitives = {}) {
  bridgeStore ??= ctx.bridgeStore;
  if (typeof React === 'function') return ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'llm-pi-ai', inject() { return { bridgeStore }; },
  }, React));
  const Editor = createBridgeProviderCard(React, primitives), listeners = new Set();
  let supported = false, disposed = false;
  const capability = { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => supported };
  const publish = value => { supported = value; for (const listener of listeners) listener(); };
  function Status() {
    const available = React.useSyncExternalStore(capability.subscribe, capability.getSnapshot);
    const snapshot = snapshotFor(React, bridgeStore);
    const managed = Object.entries(snapshot.providers ?? {}).filter(([, record]) => record.enabled);
    if (available) return null;
    const state = snapshot.editorInterface;
    const explanation = state?.state === 'failed'
      ? `统一编辑器自动接入失败（${state.code}）。请保留此错误码反馈；已保存的分组调用不受影响。`
      : state?.state === 'ready'
        ? '统一编辑器已自动接入。请刷新原来的模型页面后，点击供应商“编辑”配置多密钥。'
        : '正在自动接入原模型页面的多密钥编辑器；完成后刷新页面即可使用，无需手动打补丁。';
    return React.createElement('p', { className: 'dsh-mg-native-advancedHint', role: 'status', 'data-bridge-editor-unavailable': true },
      `${explanation}${managed.length ? ` 已保留 ${managed.reduce((sum, [, record]) => sum + Object.keys(record.keyEntries ?? {}).length, 0)} 个密钥组。` : ''}`);
  }
  const removers = [];
  try {
    removers.push(ctx.slots.inject('settings.models.provider-editor', () => {
      if (disposed) return;
      const remove = ctx.slots.register({ name: 'settings.models.provider-editor', key: 'llm-pi-ai', inject() { return { bridgeStore }; } }, Editor);
      publish(true);
      return () => { remove?.(); publish(false); };
    }));
    removers.push(ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
      name: 'settings.models.footer', id: 'model-groups-editor-status', inject() { return { bridgeStore }; },
    }, Status)));
  } catch (error) { for (const remove of removers.reverse()) remove?.(); throw error; }
  return () => { if (disposed) return; disposed = true; for (const remove of removers.reverse()) remove?.(); listeners.clear(); };
}
