import assert from 'node:assert/strict';
import { createBridgeProviderCard } from '../../src/bridge/provider-card.js';
import { createReact, createStore } from './picker-harness.mjs';

export const cardSnapshot = () => ({ status: 'ready', revision: 7, writable: true, providers: { sample: {
  enabled: true, active: true, confirmed: true, keyEntries: {
    work: { name: '工作', api: 'openai-completions', apiKeyEnv: 'SAMPLE_MULTKEY_WORK_API_KEY', headers: { 'X-Tenant': 'retained' }, models: [{ id: 'alpha', name: 'Alpha', input: ['text'], contextWindow: 12000 }] },
    home: { name: '个人', api: 'anthropic-messages', apiKeyEnv: 'SAMPLE_MULTKEY_HOME_API_KEY', models: [{ id: 'beta', name: 'Beta' }] },
  },
} } });
export function mountLegacyCard({ snapshot = cardSnapshot(), save, discover, setCredential, onClose, open = true, readOnly = false } = {}) {
  const clone = value => structuredClone(value);
  const store = createStore(snapshot), calls = { save: [], discover: [], credentials: [] };
  store.save = async (route, draft, revision) => {
    calls.save.push({ route, draft: clone(draft), revision });
    if (save) return save(route, draft, revision, store);
    if (revision !== store.getSnapshot().revision) return { ok: false, code: 'STATE_CHANGED' };
    store.set({ ...store.getSnapshot(), revision: revision + 1, providers: { ...store.getSnapshot().providers, [route]: { ...clone(store.getSnapshot().providers[route]), ...clone(draft),
      shared: { ...clone(store.getSnapshot().providers[route]?.shared), ...clone(draft.shared) },
      singleKey: { ...clone(store.getSnapshot().providers[route]?.singleKey), ...clone(draft.singleKey) },
      active: draft.enabled, confirmed: draft.enabled } } });
    return { ok: true };
  };
  store.discover = async (route, id, draft, options) => {
    calls.discover.push({ route, id, draft: clone(draft), options: options && clone(options) });
    return discover ? discover(route, id, draft, options) : { ok: true, models: [{ id: 'alpha' }, { id: 'gamma', name: 'Gamma' }] };
  };
  store.setCredential = async (reference, value) => { calls.credentials.push({ reference, value }); return setCredential ? setCredential(reference, value) : { ok: true }; };
  let dirty = true, disposed = false, tree;
  const hooks = createReact(() => { if (!disposed) dirty = true; });
  const Card = createBridgeProviderCard(hooks.react);
  const props = { provider: { provider: 'sample', id: 'wrong-route', settingsNs: 'llm-pi-ai' }, bridgeStore: store, onClose, open, readOnly };
  const frames = new Map(), typeIds = new WeakMap(), refs = new Map(); let nextType = 0;
  function render(node, path, used) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, index) => render(child, `${path}/${child?.key ?? index}`, used));
    if (typeof node.type === 'function') {
      if (!typeIds.has(node.type)) typeIds.set(node.type, ++nextType);
      const key = `${path}:${typeIds.get(node.type)}`; used.add(key);
      const frame = frames.get(key) ?? { cells: [] }; frames.set(key, frame);
      return render(hooks.render(frame, node.type, node.props), key, used);
    }
    return { ...node, props: { ...node.props, children: render(node.props?.children, path + '/c', used) } };
  }
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child ?? null)) : [node, ...nodes(node.props?.children ?? null)];
  const text = (node = tree) => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(child => text(child ?? null)).join('') : text(node.props?.children ?? null);
  function flush() {
    if (disposed) return;
    for (let pass = 0; dirty; pass++) {
      assert.ok(pass < 45, 'nested component effects must settle'); dirty = false;
      const used = new Set(); tree = render({ type: Card, props }, 'root', used);
      for (const [key, frame] of frames) if (!used.has(key)) { hooks.cleanup(frame); frames.delete(key); }
      const currentRefs = new Set(nodes().map(node => node.props?.ref).filter(Boolean));
      const assign = (ref, value) => typeof ref === 'function' ? ref(value) : ref.current = value;
      for (const [ref] of refs) if (!currentRefs.has(ref)) { assign(ref, null); refs.delete(ref); }
      for (const node of nodes()) if (node.props?.ref) {
        const ref = node.props.ref;
        const dom = refs.get(ref) ?? { open: false, focus() {}, showModal() { this.open = true; }, close() { this.open = false; } };
        if (Object.hasOwn(node.props, 'value')) dom.value = node.props.value;
        refs.set(ref, dom); assign(ref, dom);
      }
      for (const frame of frames.values()) for (const effect of frame.effects ?? []) { effect.cell.cleanup?.(); effect.cell.cleanup = effect.callback(); }
    }
  }
  const matching = (node, name) => (node.props?.['aria-label'] ?? text(node)).startsWith(name);
  const button = (name, index = 0) => nodes().filter(node => node.type === 'button' && matching(node, name)).at(index);
  const input = (name, index = 0) => {
    const direct = nodes().filter(node => ['input', 'select', 'textarea'].includes(node.type) && matching(node, name));
    if (direct.length) return direct[index];
    const label = nodes().filter(node => node.type === 'label' && text(node).startsWith(name))[index];
    return label && nodes(label).find(node => ['input', 'select', 'textarea'].includes(node.type));
  };
  flush();
  return { store, calls, props, nodes, text, button, input, flush,
    inputNode: name => refs.get(input(name).props.ref),
    click(name, index = 0) { const node = button(name, index); assert.ok(node, `button ${name}: ${text()}`); assert.notEqual(node.props.disabled, true); node.props.onClick?.({ currentTarget: { focus() {} }, preventDefault() {}, stopPropagation() {} }); flush(); },
    change(name, value, index = 0) { const node = input(name, index); assert.ok(node, `input ${name}: ${text()}`); assert.notEqual(node.props.disabled, true); node.props.onChange?.({ target: { value, checked: value } }); flush(); },
    key(name, key, index = 0) { const node = button(name, index); assert.ok(node); node.props.onKeyDown?.({ key, preventDefault() {}, stopPropagation() {} }); flush(); },
    update(next) { store.set(next); flush(); },
    route(next) { props.provider = { provider: next }; dirty = true; flush(); },
    setOpen(next) { props.open = next; dirty = true; flush(); },
    setReadOnly(next) { props.readOnly = next; dirty = true; flush(); },
    async settle() { for (let index = 0; index < 24; index++) { await Promise.resolve(); flush(); } },
    dispose() { disposed = true; for (const frame of frames.values()) hooks.cleanup(frame); },
  };
}
