import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { proposeProviderEditorSeam } from './prototypes/provider-editor-seam.mjs';

const root = process.env.DSH_ROOT;
const file = process.env.DSH_MODELS_CLIENT ?? (root && path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'));
const skipHost = !file && 'Set DSH_ROOT or DSH_MODELS_CLIENT to test a pristine native module copy';

test('isolated proposal changes the editor seam without replacing Models or its other extension seats', { skip: skipHost }, () => {
  const source = fs.readFileSync(file, 'utf8');
  const proposed = proposeProviderEditorSeam(source);
  const count = (text, word) => text.split(word).length - 1;
  for (const key of ['settings.models.provider-card', 'settings.models.footer', 'settings.onboarding.notice', 'settings.onboarding.deepseek-sign-in']) {
    assert.equal(count(proposed, key), count(source, key));
  }
  const editorStart = source.indexOf('function ProviderEditor(props)');
  const editorEnd = source.indexOf('//#endregion', editorStart);
  assert.ok(proposed.includes(source.slice(editorStart, editorEnd)), 'the original single-key editor stays byte-for-byte unchanged');
  assert.match(proposed, /hidden: !open/);
  assert.match(proposed, /entryKey: row\.entry\.settingsNs, fallback: defaultEditor/);
  assert.match(proposed, /onClose: \(changed\) => closeEditor\(changed, target\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.throws(() => proposeProviderEditorSeam(proposed), /requires one inspected native Edit branch|Expected values to be strictly equal/);
  assert.throws(() => proposeProviderEditorSeam('window.unrelated = true;'), /one inspected native Edit branch/);
});

const coreFile = process.env.DSH_SLOT_CORE;
const toolsPackage = process.env.DSH_UI_TEST_TOOLS;
const coreApi = coreFile ? await import(pathToFileURL(coreFile).href) : undefined;
const skipRenderer = skipHost || (!coreApi || !toolsPackage) && 'Set DSH_SLOT_CORE and DSH_UI_TEST_TOOLS for the public-core/actual-renderer probe';

test('native owner can render proposed editor and keeps card/footer authorization; unloading editor retains page', { skip: skipRenderer }, () => {
  const core = new coreApi.SlotCore();
  const Native = () => null, Editor = () => null, Extension = () => null;
  core.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => null);
  core.register({ name: 'settings.section', id: 'models', children: {
    'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
    'settings.models.provider-editor': { kind: 'keyed', scope: 'root' },
    'settings.models.footer': { kind: 'list', scope: 'root' },
  } }, Native);
  core.register({ name: 'settings.models.provider-card', key: 'other-provider' }, Extension);
  core.register({ name: 'settings.models.footer', id: 'other-plugin' }, Extension);
  const stop = core.register({ name: 'settings.models.provider-editor', key: 'llm-pi-ai' }, Editor);
  const native = core.entriesOfSlot('settings.section')[0];
  const editor = core.entriesOfSlot('settings.models.provider-editor')[0];
  const renderer = path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js');
  const source = fs.readFileSync(renderer, 'utf8');
  const instrumented = source.replace('exports.SlotRegistry = SlotRegistry;',
    'exports.testOnlyBoundRenderSlot = boundRenderSlot; exports.SlotRegistry = SlotRegistry;');
  assert.notEqual(instrumented, source);
  let factory;
  vm.runInNewContext(instrumented, { window: { __ModuleLoader__: { load(r) { factory = r.factory; } } },
    console, queueMicrotask, setTimeout, clearTimeout });
  const tools = createRequire(toolsPackage), hostRequire = createRequire(path.join(root, 'package.json'));
  const api = factory(name => name === '@deepseek-ai/dsh-client-ui-slots' ? coreApi
    : name === '@deepseek-ai/cordis' ? hostRequire(name) : tools(name));
  const host = { isLive: entry => core.isLive(entry) };
  const render = api.testOnlyBoundRenderSlot(host, native);
  for (const key of ['settings.models.provider-editor', 'settings.models.provider-card', 'settings.models.footer']) assert.ok(render(key, {}));
  assert.throws(() => api.testOnlyBoundRenderSlot(host, editor)('settings.models.provider-card', {}), coreApi.SlotOwnershipError);
  stop();
  assert.equal(core.entriesOfSlot('settings.section').length, 1);
  assert.equal(core.entriesOfSlot('settings.section')[0].component, Native);
  assert.equal(core.entriesOfSlot('settings.models.provider-editor').length, 0);
  assert.equal(core.entriesOfSlot('settings.models.provider-card')[0].component, Extension);
  assert.equal(core.entriesOfSlot('settings.models.footer')[0].component, Extension);
  assert.equal(fs.readFileSync(renderer, 'utf8'), source);
});
