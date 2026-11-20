import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createClientSource } from '../scripts/build.mjs';
import { createDOM, createReact, createStore } from './helpers/picker-harness.mjs';

const source = createClientSource();
const clone = value => JSON.parse(JSON.stringify(value));
const bridgeSnapshot = () => ({ status: 'ready', revision: 5, writable: true, providers: {
  sample: { enabled: true, active: true, confirmed: true, keyEntries: {
    work: { name: '工作', api: 'openai-completions', apiKeyEnv: 'WORK_KEY', models: [{ id: 'alpha', name: 'Alpha' }] },
  } },
} });
const nativeSnapshot = () => ({ status: 'ready', revision: 2, value: { providers: {
  sample: { baseURL: 'http://127.0.0.1:1234/v1', nativeOnly: 'retained' },
  untouched: { models: [{ id: 'native' }] },
} } });
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => status >= 200 && status < 300 ? { ok: true, value } : { ok: false, code: 'PRIVATE_FAILURE', error: 'synthetic-private-detail' } });
async function settle() { for (let pass = 0; pass < 20; pass++) await Promise.resolve(); }

function mount({ request = () => response(bridgeSnapshot()), native = createStore(nativeSnapshot()), own = createStore({ status: 'ready', value: {} }), missingForms = false, editorAvailable = true } = {}) {
  const dom = createDOM(), listeners = new Map(), events = new Map(), dependencies = [], registrations = [], removed = [], calls = [], formGets = [], directoryCalls = [], selections = [];
  let captured;
  const hooks = createReact(() => {});
  const window = {
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    __ModuleLoader__: { load(value) { captured = value; } },
  };
  const sandbox = { ...dom, window, console, URL, setTimeout, clearTimeout,
    fetch: (url, init) => { calls.push({ url, init }); return request(url, init); },
    setInterval() { throw new Error('the bridge must not poll the retired patch-status endpoint'); },
    clearInterval() {}, ResizeObserver: class { observe() {} disconnect() {} },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'dsh-model-groups/client.js' });
  const plugin = captured.factory(name => {
    if (name === 'react') return hooks.react;
    if (name === 'react-dom') return { createPortal: child => child };
    if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    return {};
  });
  const ctx = {
    on(name, listener) { events.set(name, listener); },
    slots: {
      inject(name, callback) { dependencies.push(name); return name === 'settings.models.provider-editor' && !editorAvailable ? () => {} : callback(); },
      register(options, component) { const entry = { ...options, component }; registrations.push(entry); return () => { removed.push(entry.name); }; },
    },
    configForms: missingForms ? undefined : { get(name) { formGets.push(name); return name === 'llm-pi-ai' ? native : own; } },
    modelDirectories: { directoryFor(id) { directoryCalls.push(id); return { store: { id },
      load: () => Promise.resolve(), select: value => { selections.push(value); return Promise.resolve(value); } }; } },
    sessions: { subagentAddress: id => id === 'child' ? 'nested' : undefined },
  };
  const dispose = plugin.apply(ctx);
  const card = registrations.find(entry => entry.name === 'settings.models.footer');
  const picker = registrations.find(entry => entry.name === 'conversation.input.model');
  return { ...dom, hooks, plugin, ctx, listeners, events, dependencies, registrations, removed, calls, formGets, directoryCalls, selections, native, own, card, picker, dispose };
}

test('the production bundle registers optional editor, nonexclusive status footer and grouped picker', async () => {
  const app = mount();
  assert.equal(app.registrations.length, 3);
  assert.deepEqual(app.dependencies, ['settings.models.provider-editor', 'settings.models.footer', 'conversation.input.model']);
  assert.equal(app.card.id, 'model-groups-editor-status');
  assert.equal(app.picker.priority, -10);
  assert.equal(app.picker.locale, 'model');
  assert.deepEqual(app.formGets, ['llm-pi-ai', 'model-groups']);
  await settle();
  assert.deepEqual(app.calls.map(call => call.url), ['/dsh-model-groups/bridge']);
  assert.equal(app.card.inject().bridgeStore.getSnapshot().status, 'ready');
  assert.equal(app.registrations.some(entry => entry.name === 'settings.section'), false);
  assert.equal(app.document.body.children.length, 0, 'no detached compatibility banner is added');
  assert.ok(!source.includes('/dsh-model-groups/status'));
  assert.ok(!source.includes('/dsh-model-groups/maintenance'));
  app.dispose();
});

test('the same confirmed providers form reaches grouped and fallback rendering and preserves native fields', async () => {
  const app = mount(); await settle();
  const injected = app.picker.inject('main');
  const current = injected.providersForm.getSnapshot();
  assert.equal(current.value.providers.sample.multiKey, true);
  assert.equal(current.value.providers.sample.keyEntries.work.name, '工作');
  assert.equal(current.value.providers.sample.nativeOnly, 'retained');
  assert.equal(current.value.providers.untouched.models[0].id, 'native');
  const boundary = new app.picker.component(injected);
  const grouped = boundary.render();
  assert.equal(grouped.props.providersForm, injected.providersForm);
  boundary.state = { failed: true };
  const fallback = boundary.render();
  assert.notEqual(fallback.type, grouped.type);
  assert.equal(fallback.props.providersForm, injected.providersForm);
  await injected.select({ provider: 'sample', model: '@dsh-key/work/alpha' });
  assert.deepEqual(app.selections, [{ provider: 'sample', model: '@dsh-key/work/alpha' }]);
  app.dispose();
});

test('native and own namespace notifications coalesce in-flight refreshes and update the shared projection', async () => {
  let state = bridgeSnapshot();
  const app = mount({ request: () => response(clone(state)) });
  await settle();
  const form = app.picker.inject('main').providersForm;
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, true);
  state = { ...state, revision: 6, providers: {} };
  app.native.set({ ...nativeSnapshot(), revision: 3 });
  app.own.set({ status: 'ready', value: { providers: {} }, revision: 2 });
  await settle();
  assert.equal(app.calls.length, 3, 'one refresh plus one trailing check retains notifications arriving in flight');
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  app.dispose();
});

test('save uses one bridge operation with expectedRevision instead of frontend namespace mutations', async () => {
  const app = mount({ request: (_url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.action, 'save');
      assert.equal(body.provider, 'sample');
      assert.equal(body.expectedRevision, 5);
      const next = bridgeSnapshot(); next.revision = 6; next.providers.sample.enabled = false;
      return response(next);
    }
    return response(bridgeSnapshot());
  } });
  await settle();
  const store = app.card.inject().bridgeStore;
  const result = await store.save('sample', { enabled: false, keyEntries: {} }, 5);
  assert.equal(result.ok, true);
  assert.equal(store.getSnapshot().revision, 6);
  assert.equal(app.calls.length, 2);
  assert.deepEqual(app.calls.map(call => call.init.method ?? 'GET'), ['GET', 'POST']);
  assert.equal(app.native.getSnapshot().revision, 2);
  assert.equal(app.own.getSnapshot().revision, undefined);
  app.dispose();
});

test('credential and selected-entry discovery use isolated bridge actions without exposing the key in snapshots', async () => {
  const app = mount({ request: (_url, init) => {
    if (!init?.method) return response(bridgeSnapshot());
    const input = JSON.parse(init.body);
    if (input.action === 'credential') return response({ ok: true });
    if (input.action === 'discover') return response({ ok: true, models: [{ id: 'selected-model' }] });
    throw new Error('unexpected operation');
  } });
  await settle();
  const store = app.card.inject().bridgeStore;
  assert.equal((await store.setCredential('WORK_KEY', 'synthetic-ui-key')).ok, true);
  const result = await store.discover('sample', 'work', { apiKeyEnv: 'WORK_KEY', api: 'openai-responses', baseURL: 'https://selected.example/v1' });
  assert.equal(result.ok, true);
  assert.equal(result.models[0].id, 'selected-model');
  const inputs = app.calls.filter(call => call.init?.method === 'POST').map(call => JSON.parse(call.init.body));
  assert.deepEqual(inputs[0], { action: 'credential', ref: 'WORK_KEY', value: 'synthetic-ui-key' });
  assert.equal(inputs[1].action, 'discover');
  assert.equal(inputs[1].provider, 'sample');
  assert.equal(inputs[1].entryId, 'work');
  assert.doesNotMatch(JSON.stringify(inputs[1]), /synthetic-ui-key/);
  assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /synthetic-ui-key/);
  app.dispose();
});

test('memoized client exports can be applied again after complete lifecycle cleanup', async () => {
  const app = mount(); await settle();
  app.dispose();
  const secondDispose = app.plugin.apply(app.ctx);
  assert.equal(app.document.head.children.length, 2);
  assert.equal(app.listeners.get('storage').size, 1);
  assert.ok(app.native.subscriberCount > 0);
  secondDispose();
  assert.equal(app.document.head.children.length, 0);
  assert.equal(app.listeners.get('storage').size, 0);
  assert.equal(app.native.subscriberCount, 0);
  assert.equal(app.own.subscriberCount, 0);
  await settle();
});

test('a failed slot registration removes newly created bridge subscriptions and styles', async () => {
  const app = mount(); await settle(); app.dispose();
  app.ctx.slots.register = () => { throw new Error('slot registration failed'); };
  assert.throws(() => app.plugin.apply(app.ctx), /slot registration failed/);
  assert.equal(app.native.subscriberCount, 0);
  assert.equal(app.own.subscriberCount, 0);
  assert.equal(app.listeners.get('storage').size, 0);
  assert.equal(app.document.head.children.length, 0);
});

test('subagent picker selection stays unavailable without changing the original model-directory behavior', async () => {
  const app = mount();
  const props = app.picker.inject('child');
  assert.equal(props.available, false);
  props.load();
  assert.equal(await props.select({ provider: 'sample', model: 'alpha' }), undefined);
  assert.equal(app.selections.length, 0);
  assert.deepEqual(app.directoryCalls, ['child']);
  app.dispose(); await settle();
});

test('disposal clears both slot entries, namespace subscriptions, styles and the exact storage handler', async () => {
  const app = mount(); await settle();
  const form = app.picker.inject('main').providersForm;
  const store = app.card.inject().bridgeStore;
  assert.ok(app.native.subscriberCount > 0);
  assert.ok(app.own.subscriberCount > 0);
  assert.equal(app.listeners.get('storage').size, 1);
  assert.equal(app.document.head.children.length, 2);
  app.dispose(); app.events.get('dispose')(); app.dispose();
  assert.deepEqual(app.removed, ['settings.models.footer', 'settings.models.provider-editor', 'conversation.input.model']);
  assert.equal(app.native.subscriberCount, 0);
  assert.equal(app.own.subscriberCount, 0);
  assert.equal(app.listeners.get('storage').size, 0);
  assert.equal(app.document.head.children.length, 0);
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  const count = app.calls.length;
  await store.refresh();
  app.native.set(nativeSnapshot()); app.own.set({ status: 'ready', value: {} });
  await settle(); assert.equal(app.calls.length, count);
});

test('a GET started before save cannot replace the committed bridge revision', async () => {
  let finish;
  const app = mount({ request: (_url, init) => {
    if (init?.method === 'POST') {
      const current = bridgeSnapshot(); current.revision = 6; current.providers = {};
      return response(current);
    }
    return new Promise(resolve => { finish = resolve; });
  } });
  await settle();
  const store = app.card.inject().bridgeStore;
  const form = app.picker.inject('main').providersForm;
  assert.equal((await store.save('sample', { enabled: false, keyEntries: {} }, 5)).ok, true);
  finish(response(bridgeSnapshot())); await settle();
  assert.equal(store.getSnapshot().revision, 6);
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  app.dispose();
});

test('a response arriving after disposal cannot reactivate a held provider form', async () => {
  let finish;
  const app = mount({ request: () => new Promise(resolve => { finish = resolve; }) });
  await settle();
  const store = app.card.inject().bridgeStore;
  const form = app.picker.inject('main').providersForm;
  const before = store.getSnapshot();
  app.dispose();
  finish(response(bridgeSnapshot())); await settle();
  assert.equal(store.getSnapshot(), before);
  assert.equal(form.getSnapshot().value.providers.sample.multiKey, undefined);
  assert.equal(app.document.head.children.length, 0);
  assert.equal(app.calls.length, 1);
});

for (const status of [403, 500]) test(`bridge HTTP ${status} disables the original card and cannot invent a projection`, async () => {
  const app = mount({ request: () => response(null, status) }); await settle();
  const snapshot = app.card.inject().bridgeStore.getSnapshot();
  assert.equal(snapshot.status, status === 403 ? 'forbidden' : 'error');
  assert.equal(snapshot.writable, false);
  assert.equal(app.picker.inject('main').providersForm.getSnapshot().value.providers.sample.multiKey, undefined);
  assert.equal(app.calls.length, 1, 'there is no retired status polling loop');
  app.dispose();
});

test('missing optional ConfigForms still leaves the grouped picker mounted', async () => {
  const app = mount({ missingForms: true }); await settle();
  assert.equal(app.registrations.length, 3);
  assert.equal(app.picker.inject('main').available, true);
  assert.equal(app.card.inject().bridgeStore.getSnapshot().status, 'ready');
  app.dispose();
});


test('a host without the optional editor keeps grouping and never mounts an independent editable card', async () => {
  const app = mount({ editorAvailable: false }); await settle();
  assert.deepEqual(app.registrations.map(entry => entry.name), ['settings.models.footer', 'conversation.input.model']);
  assert.equal(app.registrations.some(entry => entry.name === 'settings.models.provider-card'), false, 'other plugins keep their keyed provider-card cells');
  const injected = app.picker.inject('main');
  assert.equal(injected.providersForm.getSnapshot().value.providers.sample.multiKey, true);
  const frame = { cells: [] };
  const status = app.hooks.render(frame, app.card.component, {});
  assert.equal(status.type, 'p'); assert.equal(status.props['data-bridge-editor-unavailable'], true);
  assert.match(String(status.props.children), /自动接入原模型页面/);
  assert.doesNotMatch(String(status.props.children), /保存|取消|共用配置/);
  app.dispose();
});

test('a host with the optional editor has no duplicate provider-card form or compatibility footer', async () => {
  const app = mount(); await settle();
  const editor = app.registrations.find(entry => entry.name === 'settings.models.provider-editor');
  assert.equal(editor.key, 'llm-pi-ai');
  assert.equal(editor.inject().bridgeStore, app.card.inject().bridgeStore);
  assert.equal(app.registrations.some(entry => entry.name === 'settings.models.provider-card'), false);
  const status = app.hooks.render({ cells: [] }, app.card.component, {});
  assert.equal(status, null); app.dispose();
});
