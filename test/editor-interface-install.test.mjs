import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { prepareEditorInterface } from '../src/bridge/editor-interface-transform.js';
import { ensureEditorInterface, createEditorInterfaceManager, MODELS_CLIENT_ID } from '../src/bridge/editor-interface.js';

const fixture = `const jsx={jsx(){},jsxs(){}};
function NativeEditor(args) { return args; }
function Loaded({renderSlot,configured,state}) { return configured.map(row=>{
const target=row.entry, namespace={},open=state.open;
if(state.setup) return jsx.jsxs('li',{children:[NativeEditor({row,target,namespace,readOnly:!state.writable,onClose:changed=>state.closeSetup(changed,target)}),renderSlot('settings.models.provider-card',{provider:row.entry,configured:row.configured,keyConfigured:state.key(row)},{entryKey:row.entry.settingsNs})]});
return jsx.jsxs('li',{children:[renderSlot('settings.models.provider-card',{provider:row.entry,configured:row.configured,keyConfigured:state.key(row)},{entryKey:row.entry.settingsNs}),open?NativeEditor({row,target,namespace,readOnly:!state.writable,onClose:changed=>state.close(changed,target)}):null]}); }); }
function apply(ctx){ctx.slots.register({name:'settings.section',id:'models',children:{'settings.models.provider-card':{kind:'keyed',scope:'root'},'settings.models.footer':{kind:'list',scope:'root'}}},Loaded);}`;
function folder(t, source = fixture) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-editor-install-'));
  t.after(() => { assert.equal(fs.realpathSync(directory), directory); assert.ok(path.basename(directory).startsWith('groups-editor-install-')); fs.rmSync(directory, { recursive: true }); });
  const pkg = path.join(directory, 'models'); fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: MODELS_CLIENT_ID, version: '9.7.3-mobile-custom', type: 'module', main: './lib/index.js', exports: { '.': './lib/index.js', './client': './lib/client.js' }, dsh: { client: { platform: 'web' } } }));
  fs.writeFileSync(path.join(pkg, 'lib/index.js'), 'export function apply() {}\n');
  const target = path.join(pkg, 'lib/client.js'); fs.writeFileSync(target, source);
  const home = path.join(directory, 'home');
  let publishes = 0;
  const registry = { clientPath: id => id === MODELS_CLIENT_ID ? target : undefined, rebuilt(id) { assert.equal(id, MODELS_CLIENT_ID); publishes++; return `revision-${publishes}`; } };
  return { directory, pkg, target, home, registry, publishes: () => publishes };
}

test('source composition keeps native fallback, setup callback and third-party slots; identifiers and whitespace are irrelevant', () => {
  for (const source of [fixture, fixture.replaceAll('NativeEditor', 'E').replaceAll('renderSlot', 'R').replaceAll('row', 'r').replaceAll('{r,target', '{row:r,target').replaceAll('open', 'expanded').replace('const jsx=', 'const runtime=').replaceAll('jsx.', 'runtime.').replaceAll('\n', ' ')]) {
    const result = prepareEditorInterface(source); assert.equal(result.changed, true);
    assert.equal(prepareEditorInterface(result.source).changed, false);
    assert.equal((result.source.match(/dsh-model-groups\/editor-interface@1/g) ?? []).length, 2, 'normal edit and first-time setup both receive the editor');
    assert.ok(result.source.includes('closeSetup(changed,target)')); assert.ok(result.source.includes('fallback: defaultEditor'));
    assert.equal((result.source.match(/settings.models.provider-card/g) ?? []).length, 3);
    assert.equal((result.source.match(/settings.models.footer/g) ?? []).length, 1);
    assert.ok(result.source.includes('hidden: !(expanded)') || result.source.includes('hidden: !(open)'));
  }
  assert.throws(() => prepareEditorInterface(fixture + fixture), /EDITOR_SOURCE_INVALID/);
  assert.throws(() => prepareEditorInterface(fixture.replace("id:'models'", "id:'different'")), /EDITOR_STRUCTURE_UNSUPPORTED/);
});

test('ordinary installation backs up exactly one module, publishes once and is idempotent', t => {
  const env = folder(t);
  assert.deepEqual(ensureEditorInterface(env.registry, { home: env.home }), { state: 'ready', code: 'EDITOR_INSTALLED', changed: true });
  const changed = fs.readFileSync(env.target, 'utf8'); assert.notEqual(changed, fixture); assert.equal(env.publishes(), 1);
  const directories = fs.readdirSync(path.join(env.home, 'dsh-model-groups/editor-interface'));
  const files = fs.readdirSync(path.join(env.home, 'dsh-model-groups/editor-interface', directories[0]));
  assert.equal(files.filter(file => file.endsWith('.before.js')).length, 1);
  const backup = path.join(env.home, 'dsh-model-groups/editor-interface', directories[0], files.find(file => file.endsWith('.before.js')));
  assert.equal(fs.readFileSync(backup, 'utf8'), fixture); assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  assert.equal(ensureEditorInterface(env.registry, { home: env.home }).changed, false); assert.equal(fs.readFileSync(env.target, 'utf8'), changed);
});

test('publication failure rolls back exact bytes; incompatible code and wrong identity never write', t => {
  const env = folder(t); env.registry.rebuilt = () => { throw new Error('must-not-leak-private-error'); };
  const result = ensureEditorInterface(env.registry, { home: env.home }); assert.equal(result.code, 'EDITOR_PUBLISH_FAILED');
  assert.equal(fs.readFileSync(env.target, 'utf8'), fixture); assert.equal(JSON.stringify(result).includes('private'), false);
  fs.writeFileSync(env.target, 'var unrelated=1;'); assert.equal(ensureEditorInterface(env.registry, { home: env.home }).code, 'EDITOR_STRUCTURE_UNSUPPORTED');
  assert.equal(fs.readFileSync(env.target, 'utf8'), 'var unrelated=1;');
  const metadata = path.join(env.pkg, 'package.json'); fs.writeFileSync(metadata, JSON.stringify({ name: 'other-plugin', exports: { './client': './lib/client.js' } }));
  assert.equal(ensureEditorInterface(env.registry, { home: env.home }).code, 'EDITOR_TARGET_INVALID');
});

test('manager waits for a late native module, repairs a subsequent overwrite, and unsubscribes on disposal', t => {
  const env = folder(t); let known = false, listener, cleanup;
  const registry = { ...env.registry, clientPath: id => known ? env.registry.clientPath(id) : undefined,
    onGraphChanged(value) { listener = value; return () => { listener = undefined; }; } };
  const manager = createEditorInterfaceManager({ get: () => registry, effect(callback) { cleanup = callback(); } }, { home: env.home });
  assert.equal(manager.ensure().state, 'pending'); known = true; listener(); assert.equal(manager.snapshot().state, 'ready');
  fs.writeFileSync(env.target, fixture + '\n// future mobile build\n'); listener();
  assert.match(fs.readFileSync(env.target, 'utf8'), /future mobile build/); assert.equal(manager.snapshot().state, 'ready');
  cleanup(); assert.equal(listener, undefined);
});

test('real Cordis service admission waits for injection and accepts a late registry', async t => {
  if (!process.env.DSH_ROOT) return t.skip('DSH_ROOT required');
  const env = folder(t);
  const require = createRequire(path.join(process.env.DSH_ROOT, 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const ctx = new Context(); let manager;
  const fiber = ctx.plugin({ name: 'editor-interface-admission-fixture', apply(child) { manager = createEditorInterfaceManager(child, { home: env.home }); } });
  await fiber;
  assert.equal(manager.ensure().state, 'pending', 'no un-injected service property may be accessed');
  ctx.provide('clientModules', env.registry);
  for (let step = 0; step < 5 && manager.snapshot().state !== 'ready'; step++) await new Promise(setImmediate);
  assert.equal(manager.snapshot().state, 'ready'); assert.ok(fs.readFileSync(env.target, 'utf8').includes('editor-interface@1'));
  await fiber.dispose();
});

for (const [label, variable] of [['DSH host', 'DSH_MODELS_CLIENT'], ['DeepCode port', 'DSH_PORT_ROOT']]) test(`${label}: pristine activation publishes the actual registered module generation`, async t => {
  const sourceFile = variable === 'DSH_MODELS_CLIENT' ? process.env.DSH_MODELS_CLIENT : process.env.DSH_PORT_ROOT && path.join(process.env.DSH_PORT_ROOT, 'node_modules', MODELS_CLIENT_ID, 'lib/client.js');
  if (!sourceFile || !process.env.DSH_ROOT) return t.skip(`${variable} and DSH_ROOT are required`);
  const source = fs.readFileSync(sourceFile, 'utf8'); const env = folder(t, source);
  const require = createRequire(path.join(process.env.DSH_ROOT, 'package.json'));
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const [{ Context }, { ClientModuleRegistry }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-client-modules')]);
  const ctx = new Context().extend({ baseUrl: pathToFileURL(path.join(env.directory, 'package.json')).href });
  ctx.provide('loader', { entries: () => [{ options: { name: pathToFileURL(path.join(env.pkg, 'lib/index.js')).href }, fiber: {}, disabled: false, parent: { tree: { ctx } } }] });
  const registry = new ClientModuleRegistry(ctx);
  const first = registry.graph().entries.find(row => row.id === MODELS_CLIENT_ID); assert.ok(first);
  const previous = await registry.fetchBundle(new Request(new URL(first.url, 'http://127.0.0.1'))); assert.equal(previous.status, 200); await previous.text();
  const installed = ensureEditorInterface(registry, { home: env.home }); assert.equal(installed.state, 'ready'); assert.equal(installed.changed, true);
  const next = registry.graph().entries.find(row => row.id === MODELS_CLIENT_ID); assert.notEqual(first.rev, next.rev);
  const served = await registry.fetchBundle(new Request(new URL(next.url, 'http://127.0.0.1'))); assert.equal(served.status, 200);
  assert.ok((await served.text()).includes('dsh-model-groups/editor-interface@1'));
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), source, 'only the independent installation copy changes');
});
