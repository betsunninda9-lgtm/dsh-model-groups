import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createReact } from './helpers/picker-harness.mjs';
import { createMaintenanceController, maintenanceCanAction, maintenanceCanRestore, maintenanceSnapshot, maintenanceBlockerText, maintenanceDiagnostic } from '../src/maintenance-state.js';

const sample = (overrides = {}) => ({ phase: 'idle', restartRequired: false,
  patches: [{ name: '/never/render/server/path', state: 'patched' }], blockers: [], canApply: false, canRestoreOnly: true, canRestore: true, token: 'secret-token-never-render', ...overrides });
const response = value => ({ ok: true, json: async () => ({ ok: true, value }) });
function ui(responses) {
  let dirty = true;
  const hooks = createReact(() => { dirty = true; });
  const frame = { cells: [] };
  const calls = [], removed = [], copied = [];
  const source = ['src/maintenance-state.js', 'src/settings-page.js'].map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/^export /gm, '')).join('\n');
  const sandbox = { react: hooks.react, fetch: async (...args) => {
    calls.push(args);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    assert.ok(next, 'all network access must have a synthetic response');
    return next;
  }, navigator: { clipboard: { writeText: async text => copied.push(text) } }, localStorage: { removeItem: key => removed.push(key) } };
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
  return { calls, removed, copied, text, button, flush,
    inputs: () => nodes().filter(node => node.type === 'input'),
    details: () => nodes().find(node => node.type === 'details'),
    click(label) { const node = button(label); assert.ok(node && !node.props.disabled); node.props.onClick(); flush(); },
    async settle() { for (let i = 0; i < 32; i++) { await Promise.resolve(); flush(); } },
    dispose() { hooks.cleanup(frame); },
  };
}

test('page GETs only; opening and cancelling dialog never POSTs or exposes server data', async () => {
  const app = ui([response(sample())]); await app.settle();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0][1].method, 'GET');
  assert.equal(app.inputs().length, 0);
  assert.equal(app.button('关闭多密钥').props.disabled, false);
  assert.equal(app.button('启用多密钥').props.disabled, true);
  app.click('关闭并卸载插件');
  assert.equal(app.calls.length, 1); assert.ok(app.button('确认执行'));
  app.click('取消'); assert.equal(app.calls.length, 1);
  assert.equal(app.button('确认执行'), undefined);
  assert.match(app.text(), /从普通插件列表卸载只移除插件.*宿主补丁/);
  assert.match(app.text(), /多密钥已启用（磁盘状态）/);
  app.click('关闭多密钥');
  assert.match(app.text(), /旧多密钥选择和配置可能影响后续使用或重启/);
  assert.match(app.text(), /请先停止所有任务。部分使用情况未能检查不等于安全/);
  app.click('取消');
  assert.match(app.text(), /运行时.*未知/);
  assert.doesNotMatch(app.text(), /secret-token|server\/path/);
  app.dispose();
});

for (const [action, label, phase] of [
  ['apply', '启用多密钥', 'applied'],
  ['restore-only', '关闭多密钥', 'restored'],
  ['restore-and-uninstall', '关闭并卸载插件', 'removed'],
]) test(`${action} refreshes before confirmed POST with common literal`, async () => {
  const initial = sample({ canApply: true });
  const app = ui([response(initial), response(initial), response(sample({ phase, canApply: false, canRestoreOnly: false, canRestore: false, token: null, restartRequired: true,
    patches: [{ state: phase === 'applied' ? 'patched' : 'pristine' }] }))]);
  await app.settle(); app.click(label); assert.equal(app.calls.length, 1); app.click('确认执行');
  assert.equal(app.button(label).props.disabled, true);
  await app.settle();
  assert.deepEqual(app.calls.map(call => call[1].method), ['GET', 'GET', 'POST']);
  assert.equal(app.calls[2][0], '/dsh-model-groups/maintenance');
  assert.equal(app.calls[2][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(app.calls[2][1].body), { action, token: 'secret-token-never-render', confirmation: 'CONFIRM PATCH OPERATION' });
  assert.deepEqual(app.removed, phase === 'removed' ? ['dsh:model-groups:v1', 'dsh:model-groups:mode'] : []);
  assert.match(app.text(), /需要重启原引擎/);
  assert.equal(app.button('确认执行'), undefined);
  if (phase !== 'applied') assert.doesNotMatch(app.text(), /从普通插件列表卸载只移除插件/);
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
  app.click('关闭并卸载插件'); app.click('确认执行'); await app.settle();
  assert.deepEqual(app.removed, []); assert.doesNotMatch(app.text(), /已确认关闭多密钥并卸载插件|api-key|secret\/path/);
  app.dispose();
});

test('capability flags are per-action; dependency blockers need not prevent apply', async () => {
  const blocked = sample({ canApply: true, canRestoreOnly: false, canRestore: false, blockers: [{ code: 'key_config_dependency', message: '/secret/path api-key', count: 2 }] });
  const app = ui([response(blocked), response(sample())]);
  await app.settle(); assert.match(app.text(), /2 项/);
  assert.equal(app.button('关闭并卸载插件').props.disabled, true);
  assert.equal(app.button('关闭多密钥').props.disabled, true);
  assert.equal(app.button('启用多密钥').props.disabled, false);
  assert.doesNotMatch(app.text(), /api-key|secret\/path/);
  app.click('刷新检查'); await app.settle();
  assert.equal(app.button('确认执行'), undefined); app.dispose();
  for (const action of ['apply', 'restore-only', 'restore-and-uninstall']) {
    assert.equal(maintenanceCanAction(maintenanceSnapshot(sample({ canApply: true, patches: [{ state: 'conflict' }] })), action), false);
  }
  assert.equal(maintenanceCanRestore(maintenanceSnapshot(sample())), true);
});

for (const changed of [sample({ token: 'new-token' }), sample({ canRestore: false })]) {
  test('preflight token/capability changes abort without POST and close confirmation dialog', async () => {
    const app = ui([response(sample()), response(changed)]); await app.settle();
    app.click('关闭并卸载插件'); app.click('确认执行'); await app.settle();
    assert.equal(app.calls.length, 2); assert.ok(app.calls.every(call => call[1].method === 'GET'));
    assert.match(app.text(), /未执行操作/); assert.equal(app.button('确认执行'), undefined); app.dispose();
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

test('warnings remain actionable, details start collapsed, and copied diagnostics exclude arbitrary server data', async () => {
  const initial = sample({ warnings: [
    { code: 'config_inspection_failed', message: '/secret/server-path api-key' },
    { code: '/unknown-secret/path', message: 'server arbitrary message', count: 2 },
    { code: 'alias_dependency', message: 'secret' },
  ] });
  const app = ui([response(initial), response(initial), response(sample({ phase: 'restored' }))]);
  await app.settle();
  assert.equal(app.details().props.open, undefined);
  assert.match(app.text(), /检查不完整.*不会额外禁用操作/);
  assert.equal(app.button('关闭多密钥').props.disabled, false);
  assert.equal(app.button('关闭并卸载插件').props.disabled, false);
  assert.doesNotMatch(app.text(), /server-path|unknown-secret|arbitrary message|api-key/);
  app.click('复制脱敏诊断'); await app.settle();
  assert.equal(app.copied.length, 1);
  assert.deepEqual(JSON.parse(app.copied[0]).warnings, [
    { code: 'config_inspection_failed', count: null }, { code: 'unknown', count: 2 }, { code: 'alias_dependency', count: null },
  ]);
  assert.match(app.text(), /已复制脱敏诊断/);
  assert.doesNotMatch(app.copied[0], /secret|server-path|arbitrary message|token|never\/render/);
  app.click('关闭多密钥'); app.click('确认执行'); await app.settle();
  assert.deepEqual(app.calls.map(call => call[1].method), ['GET', 'GET', 'POST']);
  assert.deepEqual(app.removed, []); app.dispose();
});

test('idle status distinguishes pristine disk and failed phase takes precedence', async () => {
  const app = ui([response(sample({ patches: [{ state: 'pristine' }] })), response(sample({ phase: 'failed' }))]);
  await app.settle(); assert.match(app.text(), /多密钥已关闭（磁盘状态）/);
  app.click('刷新检查'); await app.settle(); assert.match(app.text(), /维护失败，未确认完成/);
  assert.doesNotMatch(app.text(), /多密钥已启用（磁盘状态）/); app.dispose();
});

for (const phase of ['idle', 'applied', 'restored', 'removed']) {
  test(`${phase} does not imply restart without actual process-local file changes`, async () => {
    const app = ui([response(sample({ phase, restartRequired: false, patches: [{ state: 'pristine' }] }))]);
    await app.settle();
    assert.doesNotMatch(app.text(), /需要重启原引擎|需重启原引擎|完成操作后需要/);
    assert.match(app.text(), /运行时.*未知/);
    app.dispose();
  });
}
test('patched updates survive sanitization and show an actionable update button', async () => {
  const initial = sample({ canApply: true, patches: [{ state: 'patched', updateAvailable: true }] });
  const app = ui([response(initial), response(initial), response(sample({ phase: 'applied', restartRequired: true }))]);
  await app.settle();
  assert.equal(app.button('更新多密钥补丁').props.disabled, false);
  assert.match(app.text(), /更新可用/);
  assert.equal(app.button('启用多密钥'), undefined);
  app.click('更新多密钥补丁'); app.click('确认执行'); await app.settle();
  assert.equal(JSON.parse(app.calls[2][1].body).action, 'apply');
  assert.match(app.text(), /需要重启原引擎/); app.dispose();
  assert.throws(() => maintenanceSnapshot(sample({ patches: [{ state: 'patched', updateAvailable: 'yes' }] })));
});
test('snapshot warnings are optional and invalid warnings fail closed', () => {
  assert.deepEqual(maintenanceSnapshot(sample()).warnings, []);
  assert.throws(() => maintenanceSnapshot(sample({ warnings: 'invalid' })));
  assert.throws(() => maintenanceSnapshot(sample({ warnings: [{ code: 'x', count: -1 }] })));
  const diagnostic = maintenanceDiagnostic({ snapshot: maintenanceSnapshot(sample({ blockers: [{ code: '/secret/path', message: 'secret message' }] })), error: '/secret/error' });
  assert.doesNotMatch(diagnostic, /secret|token|never\/render/);
});

test('known patched-file warning persists when refresh fails', async () => {
  const app = ui([response(sample()), new Error('offline')]); await app.settle();
  app.click('刷新检查'); await app.settle(); assert.match(app.text(), /从普通插件列表卸载只移除插件/); app.dispose();
});

test('unmounted page ignores preflight response without sending POST', async () => {
  let resolve;
  const app = ui([response(sample()), () => new Promise(done => { resolve = done; })]); await app.settle();
  app.click('关闭并卸载插件'); app.click('确认执行');
  app.dispose(); resolve(response(sample())); await app.settle();
  assert.equal(app.calls.length, 2); assert.deepEqual(app.removed, []);
});

test('unmounted page ignores POST response and does not clear storage', async () => {
  let resolve;
  const app = ui([response(sample()), response(sample()), () => new Promise(done => { resolve = done; })]); await app.settle();
  app.click('关闭并卸载插件'); app.click('确认执行'); await app.settle();
  assert.equal(app.calls.length, 3); app.dispose();
  resolve(response(sample({ phase: 'removed' }))); await app.settle(); assert.deepEqual(app.removed, []);
});
