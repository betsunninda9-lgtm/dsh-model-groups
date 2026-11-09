import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { styles } from './styles.js';
import { identity, translateTree } from './locale.js';
import { PROTOCOLS, selectionFor, withEffort, groupDirectory, parseModels, newId, copyConfig, removeEntry, removeGroup, configOperations } from './state.js';
const h = React.createElement;
// Component boundary keeps user/catalog text outside phrase translation.
const RawText = ({ children }) => children;
const raw = value => h(RawText, null, value);
const useStore = store => useSyncExternalStore(fn => store.subscribe(fn), () => store.getSnapshot(), () => store.getSnapshot());
const button = (label, props = {}) => h('button', { type: 'button', ...props }, label);
const shell = (...children) => h('div', { className: 'mg-ui' }, h('style', null, styles), ...children);
const field = (label, value, onChange, props = {}) => h('label', null, label, h('input', { value, onChange: e => onChange(e.target.value), ...props }));
function useAlive() { const ref = useRef(true); useEffect(() => { ref.current = true; return () => { ref.current = false; }; }, []); return ref; }

export function ModelPicker({ directory, form, locked = false, available = true, resolveText = x => typeof x === 'string' ? x : '', onClose, t = identity }) {
  const shell = (...children) => translateTree(h('div', { className: 'mg-ui' }, h('style', null, styles), ...children), t);
  const state = useStore(directory.store);
  const config = useStore(form);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('inline');
  const [collapsed, setCollapsed] = useState(new Set());
  const [active, setActive] = useState(null);
  const [error, setError] = useState(null);
  const alive = useAlive();
  const disabled = locked || !available || state.status === 'selecting' || state.pending !== null;
  useEffect(() => { if (available) directory.load().catch(() => {}); }, [directory, available]);
  const suppliers = groupDirectory(state.groups, config.value, query);
  const toggle = id => setCollapsed(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const choose = async selection => {
    if (disabled) return;
    setError(null);
    try { const result = await directory.select(selection); if (result && !result.ok && alive.current) setError('Selection failed. Your previous selection is retained.'); }
    catch { if (alive.current) setError('Selection failed. Retry when the session is available.'); }
  };
  const modelRows = entry => h('div', { className: 'mg-list' }, ...entry.models.map(model => {
    const selected = state.current?.provider === entry.route && state.current?.model === model.id;
    return button(raw(`${selected ? '✓ ' : ''}${resolveText(model.name) || model.id}`), { key: model.id, disabled, 'aria-pressed': selected, title: `${entry.route} / ${model.id}`, onClick: () => choose(selectionFor(state.current, entry.route, model)) });
  }));
  const currentModel = state.groups.find(g => g.id === state.current?.provider)?.models.find(m => m.id === state.current?.model);
  const selectedEntry = suppliers.flatMap(s => s.entries).find(e => e.route === active);
  return shell(h('section', { className: 'mg-panel mg-stack', 'aria-label': 'Grouped model picker', onKeyDown: e => { if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); } } },
    h('div', { className: 'mg-row' }, h('strong', null, 'Models'), onClose && button('Close', { onClick: onClose })),
    h('p', { className: 'mg-current' }, state.current ? `Current: ${state.current.provider} / ${state.current.model}${state.current.reasoningEffort === undefined ? '' : ` · ${state.current.reasoningEffort}`}` : 'No model selected'),
    state.routable === false && h('p', { role: 'status' }, 'The saved selection is unavailable. It has not been replaced.'),
    (locked || !available) && h('p', { role: 'status' }, available ? 'Model changes are locked for this session.' : 'Model selection is unavailable for addressed subagents.'),
    field('Search suppliers, configurations, and models', query, setQuery, { type: 'search' }),
    h('div', { className: 'mg-row' }, button('Inline groups', { 'aria-pressed': mode === 'inline', onClick: () => setMode('inline') }), button('Separate panel', { 'aria-pressed': mode === 'panel', onClick: () => setMode('panel') }), button('Refresh', { disabled: state.status === 'loading' || disabled, onClick: () => directory.load().catch(() => {}) })),
    (state.error || error) && h('p', { role: 'alert', className: 'mg-error' }, error || raw(state.error)),
    state.status === 'loading' && h('p', { role: 'status' }, 'Loading models…'),
    state.pending && h('p', { role: 'status' }, `Selecting ${state.pending.provider} / ${state.pending.model}…`),
    state.failures.length > 0 && h('p', { role: 'status' }, `${state.failures.length} provider catalog(s) failed to load. Loaded models remain available. Refresh to retry.`),
    !suppliers.length && state.status !== 'loading' && h('p', null, query ? 'No matching models.' : 'No models available.'),
    h('div', { className: mode === 'panel' ? 'mg-columns' : 'mg-stack' },
      h('div', { className: 'mg-stack' }, ...suppliers.map(supplier => h('div', { key: supplier.id, className: 'mg-stack' },
        button(raw(`${collapsed.has(supplier.id) && !query ? '▸' : '▾'} ${supplier.name}`), { 'aria-expanded': !!query || !collapsed.has(supplier.id), onClick: () => toggle(supplier.id) }),
        (!collapsed.has(supplier.id) || query) && h('div', { className: 'mg-child mg-stack' }, ...supplier.entries.map(entry => h('div', { key: entry.route, className: 'mg-stack' },
          button(raw(`${mode === 'inline' ? (collapsed.has(entry.route) && !query ? '▸ ' : '▾ ') : ''}${entry.name}`), { 'aria-expanded': mode === 'inline' ? (!!query || !collapsed.has(entry.route)) : active === entry.route, onClick: () => mode === 'inline' ? toggle(entry.route) : setActive(entry.route) }),
          mode === 'inline' && (!collapsed.has(entry.route) || query) && h('div', { className: 'mg-child' }, modelRows(entry))
        )))
      ))),
      mode === 'panel' && h('section', { className: 'mg-panel mg-stack', 'aria-label': 'Configuration models' }, h('strong', null, selectedEntry ? raw(selectedEntry.name) : 'Configuration models'), selectedEntry ? modelRows(selectedEntry) : h('p', null, 'Choose a configuration above or alongside this panel.'))
    ),
    currentModel?.reasoning && h('fieldset', { disabled }, h('legend', null, 'Reasoning effort'), h('div', { className: 'mg-row' },
      button('Provider default', { 'aria-pressed': state.current.reasoningEffort === undefined, onClick: () => choose(withEffort(state.current, undefined)) }),
      ...currentModel.reasoning.efforts.map(effort => button(raw(resolveText(effort.name) || effort.id), { key: effort.id, 'aria-pressed': state.current.reasoningEffort === effort.id, onClick: () => choose(withEffort(state.current, effort.id)) }))
    ))
  ));
}

function SecretEditor({ groupId, entryId, operations, disabled, t = identity }) {
  const translate = node => translateTree(node, t);
  const [secret, setSecret] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState('Key status unavailable');
  useEffect(() => {
    let active = true;
    if (operations?.credentialStatus) Promise.resolve(operations.credentialStatus({ entryId })).then(status => { if (active) setCredentialStatus(status ? 'Key configured' : 'No key configured'); }).catch(() => {});
    return () => { active = false; };
  }, [entryId, operations]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useAlive();
  async function write() {
    if (!secret || busy || disabled || !operations?.writeSecret) return;
    const value = secret;
    setSecret(''); setBusy(true); setMessage('');
    try { const result = await operations.writeSecret({ groupId, entryId, secret: value }); if (alive.current) { setMessage(result?.ok === false ? 'Key was not accepted. Enter it again to retry.' : 'Key saved. Existing keys cannot be displayed.'); if (result?.ok !== false) setCredentialStatus('Key configured'); } }
    catch { if (alive.current) setMessage('Key write failed. Enter it again to retry.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function clear() {
    if (busy || disabled || !operations?.deleteSecret) return;
    setBusy(true); setSecret(''); setMessage('');
    try { const result = await operations.deleteSecret({ groupId, entryId }); if (alive.current) { setMessage(result?.ok === false ? 'Key could not be removed.' : 'Key removed.'); if (result?.ok !== false) setCredentialStatus('No key configured'); } }
    catch { if (alive.current) setMessage('Key removal failed. Retry when connected.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return translate(h('div', { className: 'mg-stack' }, field('Replace API key (write-only)', secret, setSecret, { type: 'password', autoComplete: 'new-password', spellCheck: false, disabled: disabled || busy || !operations?.writeSecret }),
    h('small', { role: 'status' }, credentialStatus),
    button(busy ? 'Saving key…' : 'Save key', { disabled: disabled || busy || !secret || !operations?.writeSecret, onClick: write }),
    operations?.deleteSecret && button('Remove saved key', { disabled: disabled || busy, onClick: () => setRemoveConfirm(true) }),
    removeConfirm && h('div', { className: 'mg-row' }, h('span', null, 'Remove this configuration’s saved key?'), button('Confirm key removal', { disabled: disabled || busy, onClick: () => { setRemoveConfirm(false); clear(); } }), button('Cancel', { onClick: () => setRemoveConfirm(false) })),
    !operations?.writeSecret && h('small', null, 'Key writes are unavailable until the host provides the secure operation.'),
    message && h('p', { role: 'status' }, message)));
}

export function SettingsEditor({ form, operations, t = identity }) {
  const shell = (...children) => translateTree(h('div', { className: 'mg-ui' }, h('style', null, styles), ...children), t);
  const snapshot = useStore(form);
  const [draft, setDraft] = useState(null);
  const [revision, setRevision] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const alive = useAlive();
  const config = draft || copyConfig(snapshot.value);
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || busy;
  function change(fn) { if (disabled) return; if (!draft) setRevision(snapshot.revision); setDraft(fn(copyConfig(config))); setMessage(''); }
  function groupField(groupId, key, value) { change(next => { next.groups[groupId][key] = value; return next; }); }
  function entryField(groupId, route, key, value) { change(next => { next.groups[groupId].entries[route][key] = value; return next; }); }
  async function save() {
    if (!draft || disabled) return;
    setBusy(true); setMessage('');
    try { const ok = await form.mutate(configOperations(draft), revision); if (alive.current) { if (ok) { setDraft(null); setRevision(undefined); setMessage('Changes saved.'); } else setMessage('Changes were refused or the configuration changed elsewhere. Your draft is retained. Reload the latest configuration before editing again.'); } }
    catch { if (alive.current) setMessage('Save failed. Your draft is retained. Retry or reload the latest configuration.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const changedElsewhere = draft && revision !== snapshot.revision;
  return shell(h('section', { className: 'mg-stack', 'aria-label': 'Model groups settings' }, h('h2', null, 'Model groups'),
    h('p', null, 'Suppliers share an endpoint and protocol. Each configuration has its own stable route, model list, and write-only API key.'),
    snapshot.status !== 'ready' && h('p', { role: 'status' }, snapshot.status === 'loading' ? 'Loading configuration…' : 'The model-groups host namespace is unavailable.'),
    snapshot.status === 'ready' && !snapshot.writable && h('p', { role: 'status' }, 'This configuration is read-only.'),
    changedElsewhere && h('p', { role: 'alert' }, 'The host configuration changed while you were editing. Your draft remains here; reload to discard it and read the latest revision.'),
    h('div', { className: 'mg-row' }, button('Add supplier', { disabled, onClick: () => change(next => { next.groups[newId('group')] = { name: 'New supplier', baseURL: '', api: PROTOCOLS[0], entries: {} }; return next; }) }), button(busy ? 'Saving…' : 'Save changes', { disabled: disabled || !draft || !!changedElsewhere, onClick: save }), button('Reload / discard draft', { disabled: busy || !draft, onClick: () => { setDraft(null); setRevision(undefined); setConfirmDelete(null); setMessage('Draft discarded.'); } })),
    message && h('p', { role: 'status' }, message),
    ...Object.entries(config.groups).map(([groupId, group]) => h('fieldset', { key: groupId, disabled, className: 'mg-stack' }, h('legend', null, group.name ? raw(group.name) : 'Supplier'),
      field('Supplier name', group.name, value => groupField(groupId, 'name', value)),
      field('Shared endpoint', group.baseURL, value => groupField(groupId, 'baseURL', value), { type: 'url', placeholder: group.api === 'anthropic-messages' ? 'https://api.example.test' : 'https://api.example.test/v1' }),
      h('small', null, group.api === 'anthropic-messages' ? 'Anthropic: use the API origin; the SDK appends /v1/messages.' : 'OpenAI: usually include /v1; the SDK appends /chat/completions or /responses.'),
      h('label', null, 'Shared protocol', h('select', { value: group.api, onChange: e => groupField(groupId, 'api', e.target.value) }, ...PROTOCOLS.map(api => h('option', { key: api, value: api }, api)))),
      ...Object.entries(group.entries || {}).map(([route, entry]) => h('fieldset', { key: route, className: 'mg-stack' }, h('legend', null, entry.name ? raw(entry.name) : 'Configuration'),
        field('Configuration name', entry.name, value => entryField(groupId, route, 'name', value)),
        h('small', { className: 'mg-muted' }, `Stable route: ${route}`),
        h(ModelListField, { t, models: entry.models, onChange: value => entryField(groupId, route, 'models', value) }),
        h(SecretEditor, { groupId, entryId: route, operations, t, disabled: disabled || !!draft || !snapshot.value?.groups?.[groupId]?.entries?.[route] }),
        draft && h('small', null, 'Save configuration changes before changing keys.'),
        button('Delete configuration', { onClick: () => setConfirmDelete({ groupId, route }) })
      )),
      h('div', { className: 'mg-row' }, button('Add configuration', { onClick: () => change(next => { next.groups[groupId].entries[newId('mg')] = { name: 'New configuration', models: [] }; return next; }) }), button('Delete supplier', { onClick: () => setConfirmDelete({ groupId }) }))
    )),
    confirmDelete && h('section', { role: 'alert', className: 'mg-panel mg-stack' }, h('p', null, 'Delete this configuration or supplier? Its stable routes will be retired when you save. Saved session selections will not be silently changed.'), h('div', { className: 'mg-row' }, button('Confirm deletion', { disabled, onClick: () => { change(next => confirmDelete.route ? removeEntry(next, confirmDelete.groupId, confirmDelete.route) : removeGroup(next, confirmDelete.groupId)); setConfirmDelete(null); } }), button('Cancel', { onClick: () => setConfirmDelete(null) })))
  ));
}
function ModelListField({ models, onChange, t = identity }) {
  const [text, setText] = useState(() => models.join('\n'));
  const id = useId();
  // Preserve the trailing newline while editing; reconcile on an external reset.
  useEffect(() => { if (JSON.stringify(parseModels(text)) !== JSON.stringify(models)) setText(models.join('\n')); }, [models]);
  return h('label', { htmlFor: id }, t('Model IDs (one per line)'), h('textarea', { id, value: text, spellCheck: false, onChange: e => { setText(e.target.value); onChange(parseModels(e.target.value)); } }));
}
export function PickerLauncher({ toggle, panelStore, locked = false, label = 'Model groups' }) {
  const open = useStore(panelStore);
  return shell(button(h(React.Fragment, null, h('span', { className: 'mg-model-text' }, label), h('span', { className: 'mg-model-icon', 'aria-hidden': true }, '▦')), { disabled: locked, 'aria-label': 'Model groups', 'aria-expanded': open, onClick: toggle }));
}
export function PickerDock(props) {
  const open = useStore(props.panelStore);
  return open ? h(ModelPicker, props) : null;
}
