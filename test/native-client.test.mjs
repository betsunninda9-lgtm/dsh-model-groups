import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { validateNativeEditorMetadata, saveNativeMetadata } from '../src/native-settings-page.js';
import { createReact } from './helpers/picker-harness.mjs';

const source = readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8');
function mount(fetch = async () => { throw new Error('Unexpected network request'); }, reactOverride) {
  const styles = [], events = [], registrations = [], requested = [], selections = [];
  let entry, snapshot = { status: 'loading' }, listener;
  const form = { getSnapshot: () => snapshot, subscribe: fn => { listener = fn; return () => {}; } };
  const window = { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load: value => { entry = value; } } };
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild: node => styles.push(node) },
    querySelector: selector => styles.find(node => selector.includes(JSON.stringify(node.dataset.pluginCss))) ?? null,
    querySelectorAll: () => styles,
  };
  const react = {
    Component: class {},
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useSyncExternalStore: (subscribe, getSnapshot) => { subscribe(() => {}); return getSnapshot(); },
  };
  vm.runInNewContext(source, { window, document, console, fetch, URL, structuredClone });
  const plugin = entry.factory(id => id === 'react' ? reactOverride ?? react : {});
  const directory = { store: {}, load: async () => {}, select: async route => { selections.push(route); return route; } };
  let available = true;
  const ctx = {
    on: (_, fn) => events.push(fn),
    configForms: { get: ns => { requested.push(ns); return form; } },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    slots: { inject: (_, callback) => callback(), register: (options, component) => { registrations.push({ ...options, component }); return () => {}; } },
    modelDirectories: { directoryFor: () => directory },
    sessions: { subagentAddress: () => available ? undefined : {} },
  };
  plugin.apply(ctx);
  return { plugin, ctx, registrations, requested, selections, form, directory,
    update: next => { snapshot = next; listener?.(); }, setAvailable: next => { available = next; } };
}

test('fresh native entry uses metadata namespace only, shared host exports, no legacy maintenance', () => {
  assert.doesNotMatch(source, /createMaintenanceController|autoPatch|\/dsh-model-groups\/status|RESTORE AND UNINSTALL/);
  assert.match(source, /require\('react'\)/);
  const app = mount();
  assert.deepEqual(app.requested, ['model-groups']);
  assert.equal(typeof app.plugin.apply, 'function');
  const settings = app.registrations.find(item => item.name === 'settings.section');
  assert.equal(settings.id, 'dsh-model-groups');
  assert.equal(settings.inject().metadataForm, app.form);
  const seat = app.registrations.find(item => item.name === 'conversation.input.model');
  assert.equal(seat.locale, 'model');
  assert.equal(seat.priority, -10);
});

test('native settings wrapper mounts creation first with stable operations and preserves metadata props', () => {
  const app = mount(), settings = app.registrations.find(item => item.name === 'settings.section');
  const props = { ...settings.inject(), marker: {} };
  const first = settings.component(props).props.children;
  const second = settings.component({ ...props }).props.children;
  assert.equal(first[0].type.name, 'NativeModelGroupCreatePage');
  assert.equal(first[1].type.name, 'NativeModelGroupsSettingsPage');
  assert.equal(first[1].props.metadataForm, app.form);
  assert.equal(first[1].props.loadNativeCatalog, props.loadNativeCatalog);
  assert.equal(first[1].props.marker, props.marker);
  assert.equal(first[0].props.operations, second[0].props.operations);
  assert.ok(Object.isFrozen(first[0].props.operations));
  const legacy = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(legacy, /NativeModelGroupCreatePage|\/dsh-model-groups\/native-create|CREATE NATIVE GROUP/);
});

function creationOperations(app) {
  const settings = app.registrations.find(item => item.name === 'settings.section');
  return settings.component(settings.inject()).props.children[0].props.operations;
}

test('creation adapter POSTs preview then explicit confirmation to native-only endpoint', async () => {
  const requests = [], results = [
    { status: 'preview', revision: 7, fingerprint: 'fp-7', counts: { providers: 1 } },
    { status: 'saved', nativeStatus: 'saved' },
    { status: 'native-saved-metadata-pending', nativeStatus: 'unchanged' },
  ];
  const app = mount(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, value: results[requests.length - 1] }) };
  });
  const operations = creationOperations(app), group = { id: 'test-group' };
  assert.equal(requests.length, 0, 'mounting must not preview or save');
  assert.equal((await operations.preview(group)).status, 'preview');
  assert.equal(requests.length, 1, 'preview must not auto-save');
  assert.deepEqual(JSON.parse(requests[0].options.body), { action: 'preview', group });
  assert.equal((await operations.save(group, 7, 'fp-7')).status, 'saved');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    action: 'save', group, revision: 7, fingerprint: 'fp-7', confirmation: 'CREATE NATIVE GROUP',
  });
  assert.equal((await operations.save(group, 7, 'fp-7')).status, 'native-saved-metadata-pending');
  for (const { url, options } of requests) {
    assert.equal(url, '/dsh-model-groups/native-create');
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store'); assert.equal(options.headers['Content-Type'], 'application/json');
  }
});

test('bundled create form needs explicit confirmation after preview before posting save', async () => {
  const hooks = createReact(() => {}), frame = { cells: [] }, requests = [];
  const app = mount(async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body });
    return { ok: true, json: async () => ({ ok: true, value: body.action === 'preview'
      ? { status: 'preview', revision: 2, fingerprint: 'fp-2' }
      : { status: 'saved', nativeStatus: 'saved' } }) };
  }, hooks.react);
  const settings = app.registrations.find(item => item.name === 'settings.section');
  const child = settings.component(settings.inject()).props.children[0];
  let nodes;
  const render = () => {
    nodes = [];
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') { nodes.push(node); walk(node.props?.children); }
    };
    walk(hooks.render(frame, child.type, child.props));
  };
  const button = text => nodes.find(node => node.type === 'button' && node.props.children[0] === text);
  const input = text => nodes.find(node => node.type === 'label' && node.props.children[0] === text).props.children[1];
  render();
  assert.equal(button('确认保存原生供应商与显示分组').props.disabled, true);
  await button('确认保存原生供应商与显示分组').props.onClick();
  assert.equal(requests.length, 0);
  for (const [label, value] of [['分组名称', 'Team'], ['Base URL', 'https://example.test/v1'],
    ['条目名称', 'Primary'], ['apiKeyEnv（现有凭据引用，不是密钥）', 'EXISTING_KEY'], ['模型 ID', 'model-1'], ['模型名称', 'Model 1']]) {
    input(label).props.onChange({ target: { value } }); render();
  }
  await button('预览创建').props.onClick(); render();
  assert.equal(requests.length, 1); assert.equal(requests[0].body.action, 'preview');
  assert.equal(button('确认保存原生供应商与显示分组').props.disabled, false);
  await button('确认保存原生供应商与显示分组').props.onClick(); render();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.action, 'save');
  assert.equal(requests[1].body.confirmation, 'CREATE NATIVE GROUP');
  assert.deepEqual(requests[1].body.group, requests[0].body.group);
  assert.equal(requests[1].body.revision, 2); assert.equal(requests[1].body.fingerprint, 'fp-2');
});

test('creation adapter rejects HTTP, envelope, receipt, JSON and transport failures without raw errors or fallback', async () => {
  const preview = { status: 'preview', revision: 0, fingerprint: 'fp' };
  const bad = [
    { ok: false, json: async () => ({ ok: true, value: preview }) },
    { ok: 'true', json: async () => ({ ok: true, value: preview }) },
    ...[null, [], { ok: false, error: { code: 'secret-host-error' } }, { ok: 1, value: preview },
      { ok: true }, { ok: true, value: preview, error: 'secret-host-error' },
      { ok: true, value: [] }, { ok: true, value: { ...preview, revision: -1 } },
      { ok: true, value: { ...preview, revision: '0' } },
      { ok: true, value: { ...preview, fingerprint: '' } }].map(body => ({ ok: true, json: async () => body })),
    { ok: true, json: async () => { throw new Error('secret-json-error'); } },
    new Error('secret-network-error'),
  ];
  for (const response of bad) {
    let calls = 0;
    const app = mount(async () => { calls++; if (response instanceof Error) throw response; return response; });
    await assert.rejects(creationOperations(app).preview({}), error => {
      assert.equal(error.name, 'Error'); assert.equal(error.message, 'Native group operation failed.'); return true;
    });
    assert.equal(calls, 1, 'no retry or legacy fallback');
  }
  for (const value of [{ status: 'saved' }, { status: 'unchanged', metadata: { groups: {} } },
    { status: 'saved', nativeStatus: 'error' }, preview]) {
    const app = mount(async () => ({ ok: true, json: async () => ({ ok: true, value }) }));
    await assert.rejects(creationOperations(app).save({}, 0, 'fp'), { message: 'Native group operation failed.' });
  }
});

test('metadata bridge always selects native path and preserves injected host props', () => {
  const app = mount(), seat = app.registrations.find(item => item.name === 'conversation.input.model');
  const t = () => 'Model', renderSlot = () => null;
  const props = { ...seat.inject('session'), t, renderSlot, locked: true };
  const loading = seat.component(props);
  assert.equal(loading.props.nativeMetadata.groups != null, true);
  assert.equal(loading.props.t, t); assert.equal(loading.props.renderSlot, renderSlot);
  app.update({ status: 'error' });
  assert.equal(seat.component(props).props.nativeMetadata, loading.props.nativeMetadata, 'stable empty metadata');
  const metadata = { groups: { team: { entries: { primary: { provider: 'provider-a' } } } } };
  app.update({ status: 'ready', value: metadata });
  assert.equal(seat.component(props).props.nativeMetadata, metadata);
  app.update({ status: 'ready', value: null });
  assert.equal(seat.component(props).props.nativeMetadata, loading.props.nativeMetadata);
});

test('native selection retains exact provider/model/effort and unavailable subagents cannot select', async () => {
  const app = mount(), seat = app.registrations.find(item => item.name === 'conversation.input.model');
  const route = { provider: 'native-a', model: '@dsh-key/still-a-raw-native-model', reasoningEffort: 'high' };
  await seat.inject('session').select(route);
  assert.equal(app.selections[0], route);
  app.setAvailable(false);
  const props = seat.inject('child'); assert.equal(props.available, false);
  assert.equal(await props.select(route), undefined); assert.equal(app.selections.length, 1);
});

test('structured controls create groups and link existing providers without JSON editing', async () => {
  const hooks = createReact(() => {}), frame = { cells: [] };
  const calls = [], snapshot = { status: 'ready', writable: true, revision: 'r1', value: { groups: {} } };
  const form = { subscribe: () => () => {}, getSnapshot: () => snapshot, mutate: async (...args) => { calls.push(args); return true; } };
  const context = { react: hooks.react, EMPTY_NATIVE_FORM: {}, EMPTY_NATIVE_METADATA: { groups: {} } };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../src/native-settings-page.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\nthis.Page = NativeModelGroupsSettingsPage;', context);
  const props = { metadataForm: form, loadNativeCatalog: async () => ({ ok: true, value: { groups: [{ id: 'native-a', name: 'Native A' }] } }) };
  const render = () => {
    const tree = hooks.render(frame, context.Page, props);
    for (const effect of frame.effects) { effect.cell.cleanup?.(); effect.cell.cleanup = effect.callback(); }
    const all = [];
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') { all.push(node); walk(node.props?.children); }
    };
    walk(tree); return all;
  };
  render(); await new Promise(resolve => setImmediate(resolve));
  let nodes = render();
  const labelInput = label => nodes.find(node => node.type === 'label' && node.props.children[0] === label).props.children[1];
  labelInput('新分组名称').props.onChange({ target: { value: 'Team' } });
  nodes = render();
  nodes.find(node => node.type === 'button' && node.props.children[0] === '添加显示分组').props.onClick();
  nodes = render();
  const select = nodes.find(node => node.type === 'select');
  assert.ok(select, 'existing providers use a structured select');
  select.props.onChange({ target: { value: 'native-a' } });
  nodes = render();
  nodes.find(node => node.type === 'button' && node.props.children[0] === '保存显示元数据').props.onClick();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 1);
  const groups = calls[0][0][0].value;
  const group = Object.values(groups)[0];
  assert.equal(group.name, 'Team');
  assert.equal(Object.values(group.entries)[0].provider, 'native-a');
  assert.equal(calls[0][1], 'r1');
  assert.ok(nodes.some(node => node.type === 'details'), 'JSON is optional advanced UI only');
});

const catalog = [{ id: 'native-a', models: [] }, { id: 'native-b', models: [] }];
const valid = () => ({ groups: { team: { name: 'Team', entries: { first: { name: 'Primary', provider: 'native-a' } } } } });
test('strict editor rejects unsafe, duplicate, missing, secret-bearing and malformed claims', () => {
  assert.equal(validateNativeEditorMetadata(valid(), catalog).groups.team.name, 'Team');
  const bad = [
    { groups: { team: { entries: { a: { provider: '__proto__' } } } } },
    { groups: { team: { entries: { a: { provider: 'native-a' }, b: { provider: 'native-a' } } } } },
    { groups: { a: { entries: { x: { provider: 'native-a' } } }, b: { entries: { y: { provider: 'native-a' } } } } },
    { groups: { team: { entries: { a: { provider: 'missing' } } } } },
    { groups: { team: { entries: { a: { provider: 'native-a', apiKey: 'not-a-real-secret' } } } } },
    { groups: { team: { entries: [] } } },
    { groups: {}, providers: {} },
    { groups: { team: { name: 'x'.repeat(121), entries: {} } } },
    { groups: { team: { entries: { a: { name: 'x'.repeat(121), provider: 'native-a' } } } } },
    JSON.parse('{"groups":{"__proto__":{"entries":{}}}}'),
  ];
  for (const value of bad) assert.throws(() => validateNativeEditorMetadata(value, catalog));
  assert.throws(() => validateNativeEditorMetadata(valid(), [...catalog, catalog[0]]));
  assert.throws(() => validateNativeEditorMetadata(valid(), null));
});

test('save writes groups only with fixed expected revision and never retries a conflict', async () => {
  const calls = [], state = { status: 'ready', writable: true, revision: 'rev-7' };
  const form = { getSnapshot: () => state, mutate: async (...args) => { calls.push(args); return true; } };
  await saveNativeMetadata(form, JSON.stringify(valid()), 'rev-7', catalog);
  assert.deepEqual(calls, [[[{ op: 'set', path: ['groups'], value: valid().groups }], 'rev-7']]);
  await assert.rejects(saveNativeMetadata(form, JSON.stringify(valid()), 'old', catalog));
  assert.equal(calls.length, 1);
  form.mutate = async () => false;
  await assert.rejects(saveNativeMetadata(form, JSON.stringify(valid()), 'rev-7', catalog));
  state.writable = false;
  await assert.rejects(saveNativeMetadata(form, JSON.stringify(valid()), 'rev-7', catalog));
});
