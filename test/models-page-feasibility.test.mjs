import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Optional contract probe. Use the published ui-slots core matching the host;
// this test never changes a host module or a running plugin registration.
const coreFile = process.env.DSH_SLOT_CORE;
const coreApi = coreFile ? await import(pathToFileURL(coreFile).href) : undefined;
const coreSkip = !coreApi && 'Set DSH_SLOT_CORE to the published ui-slots lib/index.js';
function fixture() {
  const core = new coreApi.SlotCore();
  const Native = () => null, Replacement = () => null, Extension = () => null;
  core.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => null);
  const stopNative = core.register({ name: 'settings.section', id: 'models', order: 10, children: {
    'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
    'settings.models.footer': { kind: 'list', scope: 'root' },
  } }, Native);
  core.register({ name: 'settings.section', id: 'account', order: 20 }, () => null);
  core.register({ name: 'settings.models.provider-card', key: 'other-provider' }, Extension);
  core.register({ name: 'settings.models.footer', id: 'other-extension' }, Extension);
  const native = core.entriesOfSlot('settings.section').find(e => e.options.id === 'models');
  return { core, Native, Replacement, Extension, native, stopNative };
}

test('same Models cell can be shadowed without adding a second tab', { skip: coreSkip }, () => {
  const { core, Replacement } = fixture();
  core.register({ name: 'settings.section', id: 'models', priority: -10, order: 10 }, Replacement);
  const visible = core.entriesOfSlot('settings.section');
  assert.equal(visible.filter(e => e.options.id === 'models').length, 1);
  assert.equal(visible.find(e => e.options.id === 'models').component, Replacement);
  assert.equal(visible.filter(e => e.options.id === 'account').length, 1);
});

test('disposing replacement restores native Models and retains registered extensions', { skip: coreSkip }, () => {
  const { core, Native, Replacement, Extension } = fixture();
  const stop = core.register({ name: 'settings.section', id: 'models', priority: -10 }, Replacement);
  stop();
  assert.equal(core.entriesOfSlot('settings.section').find(e => e.options.id === 'models').component, Native);
  assert.equal(core.entriesOfSlot('settings.models.provider-card')[0].component, Extension);
  assert.equal(core.entriesOfSlot('settings.models.footer')[0].component, Extension);
});

test('replacement cannot redeclare native provider-card or footer ownership', { skip: coreSkip }, () => {
  const { core, Replacement } = fixture();
  for (const key of ['settings.models.provider-card', 'settings.models.footer']) {
    assert.throws(() => core.register({ name: 'settings.section', id: 'models', priority: -10,
      children: { [key]: core.spec(key) } }, Replacement), /already declared/);
  }
  assert.equal(core.entries('settings.section').filter(e => e.options.id === 'models').length, 1);
});

const hostRoot = process.env.DSH_ROOT;
const toolsPackage = process.env.DSH_UI_TEST_TOOLS;
const rendererFile = hostRoot && path.join(hostRoot, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js');
const rendererSkip = coreSkip || (!rendererFile || !toolsPackage) && 'Set DSH_ROOT and DSH_UI_TEST_TOOLS for the actual renderer probe';

test('actual renderer rejects forwarding native child slots from a replacement entry', { skip: rendererSkip }, () => {
  const source = fs.readFileSync(rendererFile, 'utf8');
  // Expose one existing closure in the in-memory test module only. Nothing is
  // written back, and production never imports or invokes private UI code.
  const instrumented = source.replace('exports.SlotRegistry = SlotRegistry;',
    'exports.testOnlyBoundRenderSlot = boundRenderSlot; exports.SlotRegistry = SlotRegistry;');
  assert.notEqual(instrumented, source, 'renderer probe seam must match the inspected build');
  let factory;
  vm.runInNewContext(instrumented, { window: { __ModuleLoader__: { load(r) { factory = r.factory; } } },
    console, queueMicrotask, setTimeout, clearTimeout });
  const tools = createRequire(toolsPackage);
  const hostRequire = createRequire(path.join(hostRoot, 'package.json'));
  const api = factory(name => name === '@deepseek-ai/dsh-client-ui-slots' ? coreApi
    : name === '@deepseek-ai/cordis' ? hostRequire(name) : tools(name));
  const { core, Replacement, native, stopNative } = fixture();
  const stop = core.register({ name: 'settings.section', id: 'models', priority: -10 }, Replacement);
  const replacement = core.entriesOfSlot('settings.section').find(e => e.options.id === 'models');
  const host = { isLive: entry => core.isLive(entry) };
  assert.equal(replacement.children, undefined);
  for (const key of ['settings.models.provider-card', 'settings.models.footer']) {
    assert.ok(api.testOnlyBoundRenderSlot(host, native)(key, {}));
    assert.throws(() => api.testOnlyBoundRenderSlot(host, replacement)(key, {}), coreApi.SlotOwnershipError);
  }
  stop();
  const retained = api.testOnlyBoundRenderSlot(host, native);
  stopNative();
  assert.throws(() => retained('settings.models.provider-card', {}), coreApi.StaleAuthorizationError);
});
