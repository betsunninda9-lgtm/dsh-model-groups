// Deliberately dependency-free: evaluate the shipped bundle, not a copied picker.
// This is a React/DOM boundary adapter, not a browser/layout implementation. The
// real picker owns every state update, hierarchy, event handler and selection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const Fragment = Symbol('Fragment');
const STORAGE_KEY = 'dsh:model-groups:v1';
const MODE_STORAGE_KEY = 'dsh:model-groups:mode';
const element = (type, props, key) => ({ type, key, props: props ?? {} });
const sameDeps = (left, right) => left !== undefined && right !== undefined
  && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const dataName = name => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatch(name, event) { for (const callback of listeners.get(name) ?? []) callback(event); },
  };
}

export function createDOM() {
  const document = { ...eventTarget(), documentElement: { lang: 'en' } };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = document;
      this.children = [];
      this.props = {};
      this.dataset = {};
      this.parentElement = null;
      this._text = '';
      this.offsetWidth = 280;
      this.offsetHeight = 300;
    }
    get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get disabled() { return Boolean(this.props.disabled); }
    get hidden() { return Boolean(this.props.hidden); }
    get id() { return this.props.id ?? ''; }
    get value() { return this._value ?? this.props.value ?? ''; }
    set value(value) { this._value = value; }
    get tabIndex() { return this.props.tabIndex ?? (this.tagName === 'BUTTON' || this.tagName === 'INPUT' ? 0 : -1); }
    getAttribute(name) {
      if (name.startsWith('data-')) return Object.hasOwn(this.dataset, dataName(name)) ? String(this.dataset[dataName(name)]) : null;
      const value = name === 'class' ? this.props.className : this.props[name];
      if (value === undefined || value === null || (value === false && !name.startsWith('aria-'))) return null;
      return value === true && !name.startsWith('aria-') ? '' : String(value);
    }
    matches(selector) {
      return selector.split(',').some(part => {
        let expression = part.trim();
        const negative = [...expression.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
        expression = expression.replace(/:not\([^)]+\)/g, '');
        if (negative.some(value => value === ':disabled' ? this.disabled : this.matches(value))) return false;
        if (expression.includes(':disabled')) {
          if (!this.disabled) return false;
          expression = expression.replace(':disabled', '');
        }
        const attributes = [...expression.matchAll(/\[([^=\]\s]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
        for (const [, name, value] of attributes) {
          const actual = this.getAttribute(name);
          if (actual === null || (value !== undefined && actual !== value)) return false;
        }
        expression = expression.replace(/\[[^\]]+\]/g, '').trim();
        if (!expression || expression === '*') return true;
        if (expression.startsWith('.')) return (this.props.className ?? '').split(/\s+/).includes(expression.slice(1));
        return this.tagName.toLowerCase() === expression.toLowerCase();
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => typeof child === 'string' ? [] : [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    contains(node) { return this === node || this.children.some(child => typeof child !== 'string' && child.contains(node)); }
    appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    focus() {
      if (this.disabled || this.closest('[hidden]') || document.activeElement === this) return;
      const previous = document.activeElement;
      document.activeElement = this;
      previous?.props.onBlur?.({ target: previous, relatedTarget: this });
      this.props.onFocus?.({ target: this, relatedTarget: previous });
    }
    click() { if (!this.disabled) this.props.onClick?.({ target: this, currentTarget: this, preventDefault() {} }); }
    getBoundingClientRect() {
      const style = this.props.style;
      if (typeof style?.left === 'number' && style.visibility !== 'hidden') {
        const width = style.width ?? this.offsetWidth;
        const height = style.height ?? this.offsetHeight;
        return { left: style.left, right: style.left + width, top: style.top, bottom: style.top + height, width, height };
      }
      return { left: 100, right: 400, top: 600, bottom: 628, width: 300, height: 28 };
    }
    scrollIntoView() { /* No layout is claimed by this harness. */ }
  }
  class HTMLButtonElement extends Element { constructor() { super('button'); } }
  class HTMLInputElement extends Element { constructor() { super('input'); } }
  document.createElement = tag => tag === 'button' ? new HTMLButtonElement() : tag === 'input' ? new HTMLInputElement() : new Element(tag);
  document.head = document.createElement('head');
  document.body = document.createElement('body');
  document.activeElement = document.body;
  document.querySelectorAll = selector => [...document.head.querySelectorAll(selector), ...document.body.querySelectorAll(selector)];
  document.querySelector = selector => document.querySelectorAll(selector)[0] ?? null;
  return { document, Element, HTMLElement: Element, HTMLButtonElement, HTMLInputElement };
}

// Minimal hooks dispatcher. Hooks are retained between actual component calls;
// setters, effects, subscriptions and native refs all participate in each commit.
export function createReact(schedule) {
  let current;
  let nextId = 0;
  const hook = initialize => {
    assert.ok(current, 'a hook must be called while rendering a function component');
    const index = current.index++;
    return current.cells[index] ??= initialize();
  };
  const effect = (callback, deps, layout) => {
    const cell = hook(() => ({}));
    if (!sameDeps(cell.deps, deps)) {
      cell.deps = deps;
      current.effects.push({ cell, callback, layout });
    }
  };
  const react = {
    Fragment,
    createElement(type, props, ...children) {
      return element(type, { ...props, ...(children.length ? { children } : {}) }, props?.key);
    },
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
      setState(next) { this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }; schedule(); }
    },
    useState(initial) {
      const cell = hook(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      cell.set ??= next => {
        const value = typeof next === 'function' ? next(cell.value) : next;
        if (!Object.is(value, cell.value)) { cell.value = value; schedule(); }
      };
      return [cell.value, cell.set];
    },
    useReducer(reducer, initial, initialize) {
      const [value, setValue] = react.useState(() => initialize ? initialize(initial) : initial);
      return [value, action => setValue(previous => reducer(previous, action))];
    },
    useRef(initial) { return hook(() => ({ current: initial })); },
    useId() { return hook(() => ({ value: `picker-test-${++nextId}` })).value; },
    useMemo(callback, deps) {
      const cell = hook(() => ({}));
      if (!sameDeps(cell.deps, deps)) { cell.deps = deps; cell.value = callback(); }
      return cell.value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) { effect(callback, deps, false); },
    useLayoutEffect(callback, deps) { effect(callback, deps, true); },
    useSyncExternalStore(subscribe, getSnapshot) {
      const cell = hook(() => ({}));
      cell.getSnapshot = getSnapshot;
      if (cell.subscribe !== subscribe) {
        cell.unsubscribe?.();
        cell.subscribe = subscribe;
        cell.unsubscribe = subscribe(() => {
          if (!Object.is(cell.value, cell.getSnapshot())) schedule();
        });
      }
      cell.value = getSnapshot();
      return cell.value;
    },
  };
  return {
    react,
    render(frame, Component, props) {
      frame.index = 0;
      frame.effects = [];
      current = frame;
      try { return Component(props); } finally { current = null; }
    },
    cleanup(frame) { for (const cell of frame?.cells ?? []) { cell.cleanup?.(); cell.unsubscribe?.(); } },
  };
}

export function createStore(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    set(next) { snapshot = next; for (const callback of [...listeners]) callback(); },
    get subscriberCount() { return listeners.size; },
  };
}

const ENGLISH = {
  'menu.model': 'Model', 'menu.effort': 'Thinking effort', 'menu.aria': 'Model selection',
  'provider.account': 'DeepSeek account', 'trigger.loading': 'Loading models…',
  'trigger.fallback': 'Choose model', 'trigger.selectAria': 'Choose model',
  'trigger.aria': 'Choose model: {model}', 'trigger.ariaEffort': 'Choose model: {model}; {effort}',
  'search.placeholder': 'Search models', 'search.clear': 'Clear search', 'search.empty': 'No matching models',
  'status.loading': 'Loading models…', 'retry': 'Retry', 'action.reload': 'Reload',
  'error.action': 'Unable to complete: {message}', 'error.sessionInUse': 'This session is in use',
  'warning.groupLoad': '{name}: {message}', 'empty.models': 'No models configured',
  'empty.efforts': 'No thinking efforts', 'effort.providerDefault': 'Provider default',
};
const translate = (key, params) => (ENGLISH[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''));

// Native ranking is a boundary primitive. This deterministic ordered-subsequence
// adapter lets the real hierarchy filter decide whether models or labels match.
function rankByName(entries, query) {
  const needle = query.toLowerCase().trim();
  return entries.filter(entry => {
    const name = String(entry.name ?? entry.id).toLowerCase();
    let at = 0;
    for (const char of name) if (char === needle[at]) at++;
    return at === needle.length;
  });
}

export function createPickerHarness({ snapshot, providers = {}, providersStatus = 'ready', providersAvailable = true,
  preferences, available = true, locked = false,
  storageUnavailable = false, renderSlot = (_name, _props, options) => options.fallback,
  selectResult = () => Promise.resolve({ ok: true }), throwMenu = false, bundleSource } = {}) {
  assert.ok(snapshot, 'the test must supply a synthetic model-directory snapshot');
  const dom = createDOM();
  const { document } = dom;
  const window = { ...eventTarget(), innerWidth: 1024, innerHeight: 768 };
  const values = new Map([
    ...(preferences === undefined ? [] : [[STORAGE_KEY, JSON.stringify({ version: 1, expanded: preferences })]]),
    ...(storageUnavailable ? [] : [[MODE_STORAGE_KEY, 'inline']]),
  ]);
  const storageWrites = [];
  const localStorage = {
    getItem(key) {
      if (storageUnavailable) {
        if (key === MODE_STORAGE_KEY) return 'inline';
        throw new Error('Storage unavailable');
      }
      return values.get(key) ?? null;
    },
    setItem(key, value) { if (storageUnavailable) throw new Error('Storage unavailable'); values.set(key, value); storageWrites.push({ key, value }); },
  };
  const microtasks = [];
  const errors = [];
  let dirty = true;
  let disposed = false;
  let frame;
  let cache = new Map();
  let refs = [];
  let root = null;
  const hooks = createReact(() => { if (!disposed) dirty = true; });
  const jsx = { jsx: element, jsxs: element, Fragment };
  const primitives = new Proxy({
    rankByName,
    observeStickyMenuGroups: () => () => {},
    Input: props => element('input', props),
    MenuSurface: props => {
      if (throwMenu) throw new Error('Synthetic MenuSurface render failure');
      return element('div', props);
    },
    Toast: props => element('div', { role: 'alert', children: props.text }),
    StateDot: props => element('span', { 'data-state-dot': props.state }),
  }, { get(target, name) { return target[name] ?? (props => element('span', { 'aria-hidden': true, children: props?.children })); } });
  let loaded;
  window.__ModuleLoader__ = { load(value) { loaded = value; } };
  const sandbox = {
    ...dom, window, localStorage, console: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    setTimeout, clearTimeout, queueMicrotask: callback => microtasks.push(callback),
    ResizeObserver: class { observe() {} disconnect() {} },
    fetch() { throw new Error('UI tests must never make network or LLM requests'); },
  };
  vm.runInNewContext(bundleSource ?? readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8'), sandbox, { filename: 'dsh-model-groups/client.js' });
  assert.ok(loaded, 'the bundle must register through the real module-loader contract');
  const plugin = loaded.factory(id => {
    if (id === 'react') return hooks.react;
    if (id === 'react/jsx-runtime') return jsx;
    if (id === 'react-dom') return { createPortal: child => child };
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`Unexpected external module: ${id}`);
  });
  const directory = createStore(snapshot);
  const providersForm = createStore({ status: providersStatus, revision: 'test-1', writable: true, value: { providers } });
  const loads = [];
  const selections = [];
  const slots = [];
  const disposeCallbacks = [];
  const deregister = plugin.apply({
    on(name, callback) { if (name === 'dispose') disposeCallbacks.push(callback); },
    slots: {
      inject: (_name, callback) => callback(),
      register(entry, Component) { slots.push({ entry, Component }); return () => {}; },
    },
    modelDirectories: { directoryFor: () => ({
      store: directory,
      load() { loads.push(true); return Promise.resolve(); },
      select(selection) {
        selections.push(JSON.parse(JSON.stringify(selection)));
        return selectResult(selection);
      },
    }) },
    sessions: { subagentAddress: () => available ? undefined : 'synthetic-subagent' },
    configForms: { get: name => name === 'llm-pi-ai' && providersAvailable ? providersForm : undefined, describe: () => undefined },
    remote: { llm: new Proxy({}, { get() { throw new Error('UI tests must not access live provider APIs'); } }) },
  });
  const slot = slots.find(value => value.entry.name === 'conversation.input.model');
  assert.ok(slot, 'the actual plugin must register its model seat');
  const props = { ...slot.entry.inject('synthetic-session'), locked, t: translate, renderSlot };
  const boundary = new slot.Component(props);
  const assignRef = (ref, node) => { if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; };

  function commit(value) {
    for (const [ref] of refs) assignRef(ref, null);
    const nextRefs = [];
    const nextCache = new Map();
    function materialize(child, path, parent) {
      if (child === undefined || child === null || typeof child === 'boolean') return [];
      if (Array.isArray(child)) return child.flatMap((entry, index) => materialize(entry, `${path}/${entry?.key == null ? `index:${index}` : `key:${entry.key}`}`, parent));
      if (typeof child === 'string' || typeof child === 'number') return [String(child)];
      if (child.type === Fragment) return materialize(child.props.children, `${path}/fragment`, parent);
      if (typeof child.type === 'function') return materialize(child.type(child.props), `${path}/component`, parent);
      assert.equal(typeof child.type, 'string', 'the fixture only mocks native boundary primitives');
      const identity = `${path}:${child.type}`;
      const node = cache.get(identity) ?? document.createElement(child.type);
      node.props = child.props;
      node._text = '';
      node._value = undefined;
      node.dataset = Object.fromEntries(Object.entries(child.props).filter(([name, value]) => name.startsWith('data-') && value !== undefined && value !== null).map(([name, value]) => [dataName(name), value]));
      node.parentElement = parent;
      node.children = materialize(child.props.children, `${path}/children`, node);
      nextCache.set(identity, node);
      if (child.props.ref) nextRefs.push([child.props.ref, node]);
      return [node];
    }
    document.body.children = materialize(value, 'root', document.body);
    root = document.body.children[0] ?? null;
    cache = nextCache;
    refs = nextRefs;
    if (!document.body.contains(document.activeElement)) document.activeElement = document.body;
    for (const [ref, node] of refs) assignRef(ref, node);
  }

  function flush() {
    for (let pass = 0; pass < 60; pass++) {
      if (dirty) {
        dirty = false;
        try {
          const child = boundary.render();
          if (frame?.Component !== child.type) {
            hooks.cleanup(frame);
            frame = { Component: child.type, cells: [] };
          }
          commit(hooks.render(frame, child.type, child.props));
          for (const layout of [true, false]) {
            for (const effect of frame.effects.filter(value => value.layout === layout)) {
              effect.cell.cleanup?.();
              effect.cell.cleanup = effect.callback();
            }
          }
        } catch (error) {
          if (boundary.state.failed) throw error;
          boundary.state = { ...boundary.state, ...slot.Component.getDerivedStateFromError(error) };
          boundary.componentDidCatch(error);
          dirty = true;
        }
      }
      while (microtasks.length) microtasks.shift()();
      if (!dirty) return;
    }
    throw new Error('Picker failed to settle after 60 render/effect passes');
  }
  const visible = node => !node.closest('[hidden]');
  const all = selector => document.body.querySelectorAll(selector).filter(visible);
  const one = selector => {
    const matches = all(selector);
    assert.equal(matches.length, 1, `Expected exactly one ${selector}; found ${matches.length}. Visible UI: ${document.body.textContent}`);
    return matches[0];
  };
  flush();
  return {
    document, window, directory, providersForm, selections, loads, errors, storageWrites, slot, boundary,
    get root() { return root; },
    get fallback() { return boundary.state.failed; },
    all, one,
    button(text) {
      const matches = all('button').filter(node => node.textContent === text || node.getAttribute('aria-label') === text);
      assert.equal(matches.length, 1, `Expected one button named ${JSON.stringify(text)}; found ${matches.length}`);
      return matches[0];
    },
    text: () => document.body.textContent,
    focus(node) { node.focus(); flush(); },
    click(node) { assert.ok(visible(node), 'cannot click a hidden control'); node.click(); flush(); },
    mouse(node, event) { node.props[event]?.({ target: node, currentTarget: node }); flush(); },
    resize(width, height = window.innerHeight) { window.innerWidth = width; window.innerHeight = height; window.dispatch('resize', {}); flush(); },
    search(value) {
      const input = one('[role="searchbox"]');
      assert.equal(input.props.readOnly, false, 'search must not be read-only');
      input.focus();
      input.value = value;
      input.props.onChange({ target: input });
      flush();
    },
    key(node, key, extra = {}) {
      const event = { key, target: node, nativeEvent: { isComposing: false }, shiftKey: false,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (let at = node; at; at = at.parentElement) at.props.onKeyDown?.(event);
      if (!event.defaultPrevented && (key === 'Enter' || key === ' ') && node instanceof dom.HTMLButtonElement) node.click();
      flush();
      return event;
    },
    updateProps(next) { Object.assign(props, next); boundary.props = props; dirty = true; flush(); },
    updateDirectory(next) { directory.set({ ...directory.getSnapshot(), ...next }); flush(); },
    updateProviders(next) { providersForm.set({ ...providersForm.getSnapshot(), value: { providers: next } }); flush(); },
    updateProvidersStatus(status) { providersForm.set({ ...providersForm.getSnapshot(), status }); flush(); },
    storageEvent(expanded) {
      window.dispatch('storage', { key: STORAGE_KEY, newValue: expanded === null ? null : JSON.stringify({ version: 1, expanded }) });
      flush();
    },
    outsidePointer() { document.dispatch('pointerdown', { target: document.body }); flush(); },
    savedExpanded() { return JSON.parse(values.get(STORAGE_KEY) ?? '{"expanded":{}}').expanded; },
    async settle() { for (let pass = 0; pass < 4; pass++) { await Promise.resolve(); flush(); } },
    dispose() {
      disposed = true;
      hooks.cleanup(frame);
      for (const [ref] of refs) assignRef(ref, null);
      deregister?.();
      for (const callback of disposeCallbacks) callback();
      document.body.children = [];
    },
  };
}
