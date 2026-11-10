import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
function mount() {
  const events = new Map(), windowEvents = new Map(), styles = [];
  const window = { addEventListener: (name, fn) => windowEvents.set(name, fn), removeEventListener: name => windowEvents.delete(name) };
  const document = {
    head: { appendChild: node => styles.push(node) },
    createElement: () => ({ dataset: {}, remove() { styles.splice(styles.indexOf(this), 1); } }),
    querySelector: selector => styles.find(node => selector.includes(JSON.stringify(node.dataset.pluginCss))) ?? null,
    querySelectorAll: () => [...styles],
  };
  let captured;
  window.__ModuleLoader__ = { load: module => { captured = module; } };
  vm.runInNewContext(source, { window, document, console, setTimeout, clearTimeout });
  const plugin = captured.factory(id => id === 'react' ? { Component: class {} } : {});
  const formsRequested = [], providersForm = {}, registrations = [], disposed = [], selections = [], loads = [];
  let available = true;
  const directory = { store: {}, load: () => { loads.push('load'); return Promise.resolve(); }, select: selection => { selections.push(selection); return Promise.resolve({ ok: true }); } };
  const ctx = {
    on: (name, fn) => events.set(name, fn),
    configForms: { get: ns => { formsRequested.push(ns); return providersForm; } },
    slots: { inject: (name, callback) => callback(), register: (options, component) => { registrations.push({ ...options, component }); return () => disposed.push(options.name); } },
    modelDirectories: { directoryFor: () => directory },
    sessions: { subagentAddress: () => available ? undefined : { external: true } },
  };
  return { plugin, ctx, registrations, formsRequested, providersForm, disposed, selections, loads, events, windowEvents, setAvailable: value => { available = value; } };
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
