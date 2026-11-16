import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
function mount({ request, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const events = new Map(), windowEvents = new Map(), styles = [], notices = [];
  const window = { addEventListener: (name, fn) => windowEvents.set(name, fn), removeEventListener: name => windowEvents.delete(name) };
  const document = {
    head: { appendChild: node => styles.push(node) },
    body: { appendChild: node => notices.push(node) },
    createElement: () => ({ dataset: {}, style: {}, children: [], appendChild(node) { this.children.push(node); }, setAttribute(name, value) { this[name] = value; }, remove() {
      for (const list of [styles, notices]) { const at = list.indexOf(this); if (at >= 0) list.splice(at, 1); }
    } }),
    querySelector: selector => styles.find(node => selector.includes(JSON.stringify(node.dataset.pluginCss))) ?? null,
    querySelectorAll: () => [...styles],
  };
  let captured;
  window.__ModuleLoader__ = { load: module => { captured = module; } };
  vm.runInNewContext(source, { window, document, console, setTimeout: schedule, clearTimeout: cancel, ...(request ? { fetch: request } : {}) });
  const plugin = captured.factory(id => id === 'react' ? { Component: class {} } : {});
  const formsRequested = [], providersForm = {}, registrations = [], disposed = [], selections = [], loads = [];
  let available = true;
  const directory = { store: {}, load: () => { loads.push('load'); return Promise.resolve(); }, select: selection => { selections.push(selection); return Promise.resolve({ ok: true }); } };
  const ctx = {
    on: (name, fn) => { const previous = events.get(name); events.set(name, previous ? () => { previous(); fn(); } : fn); },
    configForms: { get: ns => { formsRequested.push(ns); return providersForm; } },
    slots: { inject: (name, callback) => callback(), register: (options, component) => { registrations.push({ ...options, component }); return () => disposed.push(options.name); } },
    modelDirectories: { directoryFor: () => directory },
    sessions: { subagentAddress: () => available ? undefined : { external: true } },
  };
  return { plugin, ctx, notices, registrations, formsRequested, providersForm, disposed, selections, loads, events, windowEvents, setAvailable: value => { available = value; } };
}

function statusHarness(responses) {
  const timers = new Map(), calls = [], cancelled = [];
  let nextTimer = 0;
  const app = mount({
    request: async (...args) => {
      calls.push(args);
      assert.ok(responses.length, 'status requests need a synthetic response');
      const next = responses.shift();
      return typeof next === 'function' ? next() : { ok: true, json: async () => next };
    },
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    cancel: id => { cancelled.push(id); timers.delete(id); },
  });
  app.plugin.apply(app.ctx);
  return { ...app, calls, timers, cancelled,
    async settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
    tick() {
      assert.equal(timers.size, 1, 'one status timer is outstanding');
      const [id, timer] = timers.entries().next().value;
      assert.equal(timer.delay, 15_000);
      timers.delete(id); timer.callback();
    },
    dispose() { app.events.get('dispose')(); },
  };
}

for (const terminal of [{ state: 'ready', restartRequired: true }, { state: 'ready', restartRequired: false }]) {
  test(`deferred status polls after 15s then ${terminal.restartRequired ? 'shows restart notice' : 'removes ready notice'}`, async () => {
    const app = statusHarness([{ state: 'deferred' }, terminal]);
    await app.settle();
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0][0], '/dsh-model-groups/status');
    assert.equal(app.calls[0][1].credentials, 'same-origin');
    assert.equal(app.calls[0][1].cache, 'no-store');
    assert.equal(app.notices.length, 1);
    assert.equal(app.notices[0].role, 'status');
    assert.match(app.notices[0].children[0].textContent, /空闲后自动恢复/);
    assert.match(app.notices[0].style.cssText, /65%,transparent/);
    app.tick(); await app.settle();
    assert.equal(app.calls.length, 2);
    assert.equal(app.timers.size, 0, 'terminal status stops polling');
    assert.equal(app.notices.length, terminal.restartRequired ? 1 : 0);
    if (terminal.restartRequired) assert.match(app.notices[0].children[0].textContent, /重启引擎后生效/);
    app.dispose(); assert.equal(app.notices.length, 0);
  });
}

test('dismissed notice stays hidden during deferred polling but a changed status appears', async () => {
  const app = statusHarness([{ state: 'deferred' }, { state: 'deferred' }, { state: 'ready', restartRequired: true }]);
  await app.settle();
  app.notices[0].children[1].onclick();
  assert.equal(app.notices.length, 0);
  app.tick(); await app.settle();
  assert.equal(app.notices.length, 0);
  app.tick(); await app.settle();
  assert.equal(app.notices.length, 1);
  app.dispose();
});

test('dispose removes the deferred banner and cancels its pending status timer', async () => {
  const app = statusHarness([{ state: 'deferred' }]); await app.settle();
  assert.equal(app.timers.size, 1);
  const [id, timer] = app.timers.entries().next().value;
  app.dispose();
  assert.ok(app.cancelled.includes(id));
  assert.equal(app.timers.size, 0); assert.equal(app.notices.length, 0);
  timer.callback(); await app.settle();
  assert.equal(app.calls.length, 1, 'even an already queued callback cannot fetch after disposal');
});

for (const late of [{ state: 'deferred' }, { state: 'ready', restartRequired: true }]) {
  test(`late ${late.state} response after disposal cannot recreate a banner or timer`, async () => {
    let resolve;
    const app = statusHarness([{ state: 'deferred' }, () => new Promise(done => { resolve = done; })]);
    await app.settle(); app.tick(); await app.settle();
    assert.equal(app.calls.length, 2);
    app.dispose();
    resolve({ ok: true, json: async () => late }); await app.settle();
    assert.equal(app.notices.length, 0); assert.equal(app.timers.size, 0);
  });
}

test('picker shares native provider config and directory with no separate grouping UI', async () => {
  const app = mount();
  const dispose = app.plugin.apply(app.ctx);
  assert.deepEqual(app.formsRequested, ['llm-pi-ai']);
  assert.equal(app.registrations.length, 2);
  const picker = app.registrations.find(entry => entry.name === 'conversation.input.model');
  assert.equal(picker.name, 'conversation.input.model');
  assert.equal(picker.priority, -10);
  assert.equal(picker.locale, 'model');
  const settings = app.registrations.find(entry => entry.name === 'settings.section');
  assert.equal(settings.id, 'dsh-model-groups');
  assert.equal(settings.label, '模型分组');
  assert.equal(typeof settings.component, 'function');
  const props = picker.inject('session-a');
  assert.equal(props.directory, app.ctx.modelDirectories.directoryFor().store);
  assert.equal(props.providersForm, app.providersForm);
  assert.equal('groupingForm' in props, false);
  props.load();
  const selection = { provider: 'route-a', model: '@dsh-key/entry-a/same-id', reasoningEffort: 'high' };
  await props.select(selection);
  assert.equal(app.selections[0], selection, 'preserve provider, key/model alias and effort exactly');
  assert.equal(app.loads.length, 1);
  dispose();
  assert.deepEqual(app.disposed, ['conversation.input.model']);
  app.events.get('dispose')();
  assert.equal(app.windowEvents.has('storage'), false);
});

test('unavailable subagents never load or change their owner’s model', async () => {
  const app = mount(); app.plugin.apply(app.ctx); app.setAvailable(false);
  const props = app.registrations.find(entry => entry.name === 'conversation.input.model').inject('subagent-a');
  assert.equal(props.available, false); props.load();
  assert.equal(await props.select({ provider: 'route-a', model: 'same-id' }), undefined);
  assert.equal(app.selections.length, 0); assert.equal(app.loads.length, 0);
});

test('missing optional forms still leave a model seat available', () => {
  const app = mount(); delete app.ctx.configForms;
  app.plugin.apply(app.ctx);
  assert.equal(app.registrations.length, 2);
  assert.equal(app.registrations.find(entry => entry.name === 'conversation.input.model').inject('session-a').providersForm, undefined);
});
