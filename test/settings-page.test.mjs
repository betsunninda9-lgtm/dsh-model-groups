import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createReact } from './helpers/picker-harness.mjs';
import { createMaintenanceController, maintenanceCanAction, maintenanceCanRestore, maintenanceSnapshot, maintenanceBlockerText } from '../src/maintenance-state.js';

const sample = (overrides = {}) => ({ phase: 'idle', restartRequired: false,
  patches: [{ name: '/never/render/server/path', state: 'patched' }], blockers: [], canApply: false, canRestoreOnly: true, canRestore: true, token: 'secret-token-never-render', ...overrides });
const response = value => ({ ok: true, json: async () => ({ ok: true, value }) });
function ui(responses) {
  let dirty = true;
  const hooks = createReact(() => { dirty = true; });
  const frame = { cells: [] };
  const calls = [], removed = [];
  const source = ['src/maintenance-state.js', 'src/settings-page.js'].map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/^export /gm, '')).join('\n');
  const sandbox = { react: hooks.react, fetch: async (...args) => {
    calls.push(args);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    assert.ok(next, 'all network access must have a synthetic response');
    return next;
  }, localStorage: { removeItem: key => removed.push(key) } };
  vm.runInNewContext(`${source}\nthis.Page = ModelGroupsSettingsPage;`, sandbox);
  let tree;
  function flush() {
    while (dirty) {
      dirty = false;
      tree = hooks.render(frame, sandbox.Page, {});
      for (const effect of frame.effects) { effect.cell.cleanup?.(); effect.cell.cleanup = effect.callback(); }
    }
  }
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child ?? null)) : [node, ...nodes(node.props?.children ?? null)];
  const text = (node = tree) => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(child => text(child ?? null)).join('') : text(node.props?.children ?? null);
  const button = label => nodes().find(node => node.type === 'button' && text(node) === label);
  flush();
  return { calls, removed, text, button, flush,
    inputs: () => nodes().filter(node => node.type === 'input'),
    fieldset: () => nodes().find(node => node.type === 'fieldset'),
    change(type, value) { const input = this.inputs().find(node => node.props.type === type); input.props.onChange({ target: { value, checked: value } }); flush(); },
    click(label) { const node = button(label); assert.ok(node && !node.props.disabled); node.props.onClick(); flush(); },
    async settle() { for (let i = 0; i < 32; i++) { await Promise.resolve(); flush(); } },
    dispose() { hooks.cleanup(frame); },
  };
}

test('page GETs only and uses checkbox confirmation without typing or exposing server data', async () => {
  const app = ui([response(sample())]); await app.settle();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0][1].method, 'GET');
  assert.equal(app.button('移除补丁并卸载插件').props.disabled, true);
  assert.equal(app.inputs().length, 1); assert.equal(app.inputs()[0].props.type, 'checkbox');
  app.change('checkbox', true);
  assert.equal(app.button('移除补丁并卸载插件').props.disabled, false);
  assert.equal(app.button('移除补丁，保留插件').props.disabled, false);
  assert.equal(app.button('安装多密钥补丁').props.disabled, true);
  assert.match(app.text(), /普通卸载只移除插件.*升级、文件冲突及模型别名/);
  assert.match(app.text(), /运行时.*未知/);
  assert.match(app.text(), /备用模型切换与配置归档尚未接入本页.*不是完整退出向导/);
  assert.match(app.text(), /无需为试用本页手工改配置.*仍有依赖时请保留补丁/);
  assert.doesNotMatch(app.text(), /secret-token|server\/path/);
  assert.equal(app.calls.length, 1); app.dispose();
});

for (const [action, label, phase] of [
  ['apply', '安装多密钥补丁', 'applied'],
  ['restore-only', '移除补丁，保留插件', 'restored'],
  ['restore-and-uninstall', '移除补丁并卸载插件', 'removed'],
]) test(`${action} refreshes before confirmed POST with common literal`, async () => {
  const initial = sample({ canApply: true });
  const app = ui([response(initial), response(initial), response(sample({ phase, canApply: false, canRestoreOnly: false, canRestore: false, token: null, restartRequired: true,
    patches: [{ state: phase === 'applied' ? 'patched' : 'pristine' }] }))]);
  await app.settle(); app.change('checkbox', true); app.click(label);
  assert.equal(app.fieldset().props.disabled, true);
  await app.settle();
  assert.deepEqual(app.calls.map(call => call[1].method), ['GET', 'GET', 'POST']);
  assert.equal(app.calls[2][0], '/dsh-model-groups/maintenance');
  assert.equal(app.calls[2][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(app.calls[2][1].body), { action, token: 'secret-token-never-render', confirmation: 'CONFIRM PATCH OPERATION' });
  assert.deepEqual(app.removed, phase === 'removed' ? ['dsh:model-groups:v1', 'dsh:model-groups:mode'] : []);
  assert.match(app.text(), /需要重启原引擎/);
  assert.equal(app.inputs()[0].props.checked, false);
  if (phase !== 'applied') assert.doesNotMatch(app.text(), /普通卸载只移除插件/);
  app.dispose();
});

for (const [name, result] of [
  ['failed phase', response(sample({ phase: 'failed' }))],
  ['restored only', response(sample({ phase: 'restored' }))],
  ['removing only', response(sample({ phase: 'removing' }))],
  ['disconnect', new Error('/secret/path api-key')],
  ['refused envelope', { ok: true, json: async () => ({ ok: false, error: { code: 'blocked', message: '/secret/path api-key' } }) }],
  ['HTTP failure', { ok: false }],
  ['malformed envelope', response({ phase: 'removed' })],
]) test(`${name} never counts as successful uninstall`, async () => {
  const app = ui([response(sample()), response(sample()), result]); await app.settle();
  app.change('checkbox', true); app.click('移除补丁并卸载插件'); await app.settle();
  assert.deepEqual(app.removed, []); assert.doesNotMatch(app.text(), /已确认恢复原版并卸载|api-key|secret\/path/);
  app.dispose();
});

test('capability flags are per-action; dependency blockers need not prevent apply', async () => {
  const blocked = sample({ canApply: true, canRestoreOnly: false, canRestore: false, blockers: [{ code: 'key_config_dependency', message: '/secret/path api-key', count: 2 }] });
  const app = ui([response(blocked), response(sample())]);
  await app.settle(); assert.match(app.text(), /2 项/);
  app.change('checkbox', true);
  assert.equal(app.button('移除补丁并卸载插件').props.disabled, true);
  assert.equal(app.button('移除补丁，保留插件').props.disabled, true);
  assert.equal(app.button('安装多密钥补丁').props.disabled, false);
  assert.doesNotMatch(app.text(), /api-key|secret\/path/);
  app.click('刷新检查'); await app.settle();
  assert.equal(app.inputs()[0].props.checked, false); app.dispose();
  for (const action of ['apply', 'restore-only', 'restore-and-uninstall']) {
    assert.equal(maintenanceCanAction(maintenanceSnapshot(sample({ canApply: true, patches: [{ state: 'conflict' }] })), action), false);
  }
  assert.equal(maintenanceCanRestore(maintenanceSnapshot(sample())), true);
});

for (const changed of [sample({ token: 'new-token' }), sample({ canRestore: false })]) {
  test('preflight token/capability changes abort without POST and reset checkbox', async () => {
    const app = ui([response(sample()), response(changed)]); await app.settle();
    app.change('checkbox', true); app.click('移除补丁并卸载插件'); await app.settle();
    assert.equal(app.calls.length, 2); assert.ok(app.calls.every(call => call[1].method === 'GET'));
    assert.match(app.text(), /未执行操作/); assert.equal(app.inputs()[0].props.checked, false); app.dispose();
  });
}

test('controller rejects unconfirmed/unknown operations and serializes requests', async () => {
  const calls = []; let resolve;
  const controller = createMaintenanceController({ request: (...args) => { calls.push(args); return new Promise(done => { resolve = done; }); } });
  await controller.restore(true); assert.equal(calls.length, 0);
  const pending = controller.refresh(); controller.refresh(); assert.equal(calls.length, 1);
  resolve(response(sample())); await pending;
  await controller.restore(false); await controller.operate('unknown', true); await controller.apply(false);
  assert.equal(calls.length, 1); controller.dispose();
});

test('specific diagnostics are fixed and dependency conversion remains deferred', () => {
  for (const [code, text] of [['CONFIG_INSPECTION_FAILED', /配置检查失败/], ['session_inspection_failed', /会话检查失败/], ['session_service_missing', /缺少会话查询或持久化服务/], ['process_inspection_failed', /进程检查失败/], ['profile_inspection_failed', /配置档检查失败/], ['patch_inspection_failed', /补丁文件检查失败/]]) {
    assert.match(maintenanceBlockerText({ code }), text);
  }
  assert.match(maintenanceBlockerText({ code: 'KEY_CONFIG_DEPENDENCY' }), /已保存的密钥会保留.*不会自动转换/);
  assert.match(maintenanceBlockerText({ code: 'ALIAS_DEPENDENCY' }), /切换为普通模型.*不会自动转换/);
});

test('known patched-file warning persists when refresh fails', async () => {
  const app = ui([response(sample()), new Error('offline')]); await app.settle();
  app.click('刷新检查'); await app.settle(); assert.match(app.text(), /普通卸载只移除插件/); app.dispose();
});

test('unmounted page ignores preflight response without sending POST', async () => {
  let resolve;
  const app = ui([response(sample()), () => new Promise(done => { resolve = done; })]); await app.settle();
  app.change('checkbox', true); app.click('移除补丁并卸载插件');
  app.dispose(); resolve(response(sample())); await app.settle();
  assert.equal(app.calls.length, 2); assert.deepEqual(app.removed, []);
});

test('unmounted page ignores POST response and does not clear storage', async () => {
  let resolve;
  const app = ui([response(sample()), response(sample()), () => new Promise(done => { resolve = done; })]); await app.settle();
  app.change('checkbox', true); app.click('移除补丁并卸载插件'); await app.settle();
  assert.equal(app.calls.length, 3); app.dispose();
  resolve(response(sample({ phase: 'removed' }))); await app.settle(); assert.deepEqual(app.removed, []);
});
