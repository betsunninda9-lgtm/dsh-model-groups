import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createReact } from './helpers/picker-harness.mjs';
import { createMaintenanceController, maintenanceCanRestore, maintenanceSnapshot, maintenanceBlockerText } from '../src/maintenance-state.js';

const sample = (overrides = {}) => ({ phase: 'idle', restartRequired: false,
  patches: [{ name: '/never/render/server/path', state: 'patched' }], blockers: [], canRestore: true, token: 'secret-token-never-render', ...overrides });
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
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } },
    dispose() { hooks.cleanup(frame); },
  };
}

test('page automatically GETs only, protects confirmation and never renders paths/tokens/server messages', async () => {
  const app = ui([response(sample())]); await app.settle();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0][1].method, 'GET');
  assert.equal(app.button('恢复原版并卸载').props.disabled, true);
  app.change('text', 'RESTORE AND UNINSTALL');
  assert.equal(app.button('恢复原版并卸载').props.disabled, true);
  app.change('checkbox', true); app.change('text', 'restore and uninstall');
  assert.equal(app.button('恢复原版并卸载').props.disabled, true);
  app.change('text', 'RESTORE AND UNINSTALL');
  assert.equal(app.button('恢复原版并卸载').props.disabled, false);
  assert.doesNotMatch(app.text(), /secret-token|server\/path/);
  assert.equal(app.calls.length, 1); app.dispose();
});

test('explicit successful removal POST clears exactly two owned keys', async () => {
  const app = ui([response(sample()), response(sample({ phase: 'removed', canRestore: false, token: null, restartRequired: true }))]);
  await app.settle(); app.change('checkbox', true); app.change('text', 'RESTORE AND UNINSTALL'); app.click('恢复原版并卸载');
  assert.equal(app.button('恢复原版并卸载').props.disabled, true);
  await app.settle();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1][0], '/dsh-model-groups/maintenance');
  assert.equal(app.calls[1][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(app.calls[1][1].body), { action: 'restore-and-uninstall', token: 'secret-token-never-render', confirmation: 'RESTORE AND UNINSTALL' });
  assert.deepEqual(app.removed, ['dsh:model-groups:v1', 'dsh:model-groups:mode']);
  assert.match(app.text(), /已确认恢复原版并卸载/); assert.match(app.text(), /需要重启原引擎/);
  assert.equal(app.inputs().find(node => node.props.type === 'text').props.value, ''); app.dispose();
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
  const app = ui([response(sample()), result]); await app.settle();
  app.change('checkbox', true); app.change('text', 'RESTORE AND UNINSTALL'); app.click('恢复原版并卸载'); await app.settle();
  assert.deepEqual(app.removed, []); assert.doesNotMatch(app.text(), /已确认恢复原版并卸载|api-key|secret\/path/);
  app.dispose();
});

test('blockers and conflicts prevent restore; refresh invalidates confirmation', async () => {
  const app = ui([response(sample({ blockers: [{ code: 'active_turns', message: '/secret/path api-key', count: 2 }] })), response(sample())]);
  await app.settle(); assert.equal(app.fieldset().props.disabled, false); assert.match(app.text(), /2 项/);
  assert.match(app.text(), /填写确认不会绕过检查/);
  app.change('checkbox', true); app.change('text', 'RESTORE AND UNINSTALL');
  assert.equal(app.button('恢复原版并卸载').props.disabled, true);
  assert.equal(app.calls.length, 1);
  assert.doesNotMatch(app.text(), /api-key|secret\/path/);
  app.click('刷新检查'); await app.settle(); assert.equal(app.fieldset().props.disabled, false);
  assert.equal(app.button('恢复原版并卸载').props.disabled, true); app.dispose();
  assert.equal(maintenanceCanRestore(maintenanceSnapshot(sample({ patches: [{ state: 'conflict' }] }))), false);
});

test('controller rejects unconfirmed POSTs and serializes requests', async () => {
  const calls = []; let resolve;
  const controller = createMaintenanceController({ request: (...args) => { calls.push(args); return new Promise(done => { resolve = done; }); } });
  await controller.restore(true, 'RESTORE AND UNINSTALL'); assert.equal(calls.length, 0);
  const pending = controller.refresh(); controller.refresh(); assert.equal(calls.length, 1);
  resolve(response(sample())); await pending;
  await controller.restore(false, 'RESTORE AND UNINSTALL'); await controller.restore(true, ' RESTORE AND UNINSTALL');
  assert.equal(calls.length, 1); controller.dispose();
});

test('fixed notices explain partial restore and preservation; codes support both cases', async () => {
  const app = ui([response(sample({ phase: 'failed', restartRequired: true }))]);
  await app.settle(); assert.match(app.text(), /补丁可能已还原，但卸载未完成/);
  assert.match(app.text(), /防止自动重新打补丁的标记已保留/); app.dispose();
  assert.match(maintenanceBlockerText({ code: 'KEY_CONFIG_DEPENDENCY' }), /禁用 multiKey 并清理 keyEntries 配置；已保存的密钥会保留/);
  assert.match(maintenanceBlockerText({ code: 'ALIAS_DEPENDENCY' }), /切换为普通模型/);
  assert.match(maintenanceBlockerText({ code: 'PATCH_CONFLICT' }), /不会强制覆盖/);
});

test('unmounted page ignores late response and does not clear storage', async () => {
  let resolve;
  const app = ui([response(sample()), () => new Promise(done => { resolve = done; })]); await app.settle();
  app.change('checkbox', true); app.change('text', 'RESTORE AND UNINSTALL'); app.click('恢复原版并卸载');
  app.dispose(); resolve(response(sample({ phase: 'removed' }))); await app.settle(); assert.deepEqual(app.removed, []);
});
