import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { ARTIFACTS, applyPlan, planPatches, sha256 } from '../scripts/native-patches.mjs';
import { createMaintenance, maintenanceHandler, restorationPending, maintenanceStorage } from '../src/maintenance.js';
import { autoPatch } from '../src/auto-patch.js';

function fixture(t, overrides = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-maintenance-test-'));
  const root = path.join(temp, 'runtime'), home = path.join(temp, 'home'), artifacts = path.join(temp, 'artifacts');
  fs.mkdirSync(root); fs.mkdirSync(artifacts);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const files = ARTIFACTS.map((name, index) => {
    const packageName = index === 0 ? '@deepseek-ai/dsh-llm-pi-ai' : index === 1 ? '@deepseek-ai/dsh-client-ui-settings-models' : name === 'api-remotes.patch.json' ? '@deepseek-ai/dsh-api-remotes' : '@deepseek-ai/dsh-llm';
    const target = `node_modules/${packageName}/lib/test-${index}.js`, file = path.join(root, target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', packageName, 'package.json'), JSON.stringify({ name: packageName, version: '0.2.2-rc.1' }));
    fs.writeFileSync(file, `before-${index}`);
    fs.writeFileSync(path.join(artifacts, name), JSON.stringify({ version: '0.2.2-rc.1', packageName, target, baseSha256: sha256(`before-${index}`), resultSha256: sha256(`after-${index}`), replacements: [{ before: `before-${index}`, after: `after-${index}` }] }));
    return file;
  });
  applyPlan(planPatches(root, 'apply', artifacts), path.join(temp, 'backups'));
  let removed = false, calls = 0;
  const manager = { listBundles: async () => removed ? [] : [{ name: 'dsh-model-groups', removable: true, installed: true, enabled: true }], removeBundle: async name => { assert.equal(name, 'dsh-model-groups'); calls++; removed = true; return { application: 'applied' }; } };
  const controller = createMaintenance({ root, home, artifacts, manager, inspect: async () => ({ blockers: [], fingerprint: 'unchanged' }), ...overrides });
  t.after(() => { assert.equal(fs.realpathSync(temp), temp); assert.equal(path.dirname(temp), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(temp).startsWith('dsh-maintenance-test-')); fs.rmSync(temp, { recursive: true }); });
  return { controller, root, home, artifacts, files, manager, calls: () => calls };
}
const confirmation = token => ({ action: 'restore-and-uninstall', confirmation: 'CONFIRM PATCH OPERATION', token });

test('confirmed restoration checks all hashes, removes only own bundle and retains suppression marker', async t => {
  const f = fixture(t), before = await f.controller.snapshot();
  assert.equal(before.canRestore, true);
  const result = await f.controller.restore(confirmation(before.token));
  assert.equal(result.phase, 'removed'); assert.equal(result.restartRequired, true); assert.equal(f.calls(), 1);
  assert.ok(planPatches(f.root, 'check', f.artifacts).every(p => p.state === 'pristine'));
  assert.equal(restorationPending(f.root, f.home), true);
  assert.equal(autoPatch(f.root, f.home).state, 'restore-pending');
  const reloaded = createMaintenance({ root: f.root, home: f.home, artifacts: f.artifacts, manager: f.manager, inspect: async () => ({ blockers: [], fingerprint: '' }) });
  assert.equal((await reloaded.snapshot()).restartRequired, true);
  await assert.rejects(f.controller.restore(confirmation(before.token)), { code: 'CONFIRMATION_REQUIRED' });
});
test('blockers and changed dependency fingerprint stop before any disk restore', async t => {
  let fingerprint = 'one';
  const f = fixture(t, { inspect: async () => ({ blockers: [], fingerprint }) });
  const before = await f.controller.snapshot(); fingerprint = 'two';
  await assert.rejects(f.controller.restore(confirmation(before.token)), { code: 'STATE_CHANGED' });
  assert.ok(planPatches(f.root, 'check', f.artifacts).every(p => p.state === 'patched'));
  assert.equal(f.calls(), 0); assert.equal(restorationPending(f.root, f.home), false);
});
test('foreign edits block before writes and do not overwrite another lock', async t => {
  const f = fixture(t), before = await f.controller.snapshot();
  fs.appendFileSync(f.files[4], 'foreign');
  await assert.rejects(f.controller.restore(confirmation(before.token)), { code: 'STATE_CHANGED' });
  assert.ok(fs.readFileSync(f.files[4], 'utf8').endsWith('foreign')); assert.equal(f.calls(), 0);
  const f2 = fixture(t), ticket = await f2.controller.snapshot(), storage = maintenanceStorage(f2.root, f2.home);
  fs.mkdirSync(path.join(storage, 'patch.lock'), { recursive: true });
  await assert.rejects(f2.controller.restore(confirmation(ticket.token)), { code: 'MAINTENANCE_FAILED' });
  assert.equal(fs.existsSync(path.join(storage, 'patch.lock')), true);
});
test('failed or restart-only manager result never reports removed; marker prevents reapply', async t => {
  for (const application of ['failed', 'cancelled', 'restart-required', 'overridden']) {
    const f = fixture(t, { manager: { listBundles: async () => [{ name: 'dsh-model-groups', removable: true }], removeBundle: async () => ({ application }) } });
    const before = await f.controller.snapshot();
    await assert.rejects(f.controller.restore(confirmation(before.token)), { code: 'REMOVE_FAILED' });
    assert.equal(restorationPending(f.root, f.home), true);
    assert.ok(planPatches(f.root, 'check', f.artifacts).every(p => p.state === 'pristine'));
  }
});
test('missing inspection and expired confirmation fail closed', async t => {
  const bad = fixture(t, { inspect: async () => { throw new Error('private secret path'); } });
  const report = await bad.controller.snapshot(); assert.equal(report.canRestore, false); assert.ok(!JSON.stringify(report).includes('private secret'));
  let clock = 1;
  const f = fixture(t, { now: () => clock }), before = await f.controller.snapshot(); clock = 130000;
  await assert.rejects(f.controller.restore(confirmation(before.token)), { code: 'CONFIRMATION_REQUIRED' });
});
async function request(handler, method, body, admission = { peer: { principal: { kind: 'owner' } } }, headers = {}) {
  const req = Readable.from(body ? [body] : []); req.method = method; req.headers = { 'content-type': 'application/json', ...headers };
  let status, text; const res = { writeHead(s) { status = s; }, end(s) { text = s; } };
  await maintenanceHandler(handler, { admit: () => admission })(req, res);
  return { status, body: JSON.parse(text) };
}
test('HTTP owner admission, JSON-only, bounded body and safe errors', async () => {
  let calls = 0;
  const controller = { snapshot: async () => ({ phase: 'idle' }), restore: async () => { calls++; return { phase: 'removed' }; } };
  assert.equal((await request(controller, 'GET')).status, 200);
  assert.equal((await request(controller, 'POST', '{}', { rejection: 401 })).status, 401);
  assert.equal((await request(controller, 'POST', '{}', { peer: { principal: { kind: 'guest' } } })).status, 403);
  assert.equal((await request(controller, 'POST', '{}', undefined, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await request(controller, 'POST', 'x'.repeat(4097))).status, 413);
  assert.equal((await request(controller, 'POST', '{')).status, 400);
  assert.equal(calls, 0);
  assert.equal((await request(controller, 'POST', '{}')).body.value.phase, 'removed');
});

 test('manual apply, restore-only, and reapply retain bundle and use stable tickets', async t => {
  const f = fixture(t);
  let state = await f.controller.snapshot();
  assert.equal(state.canApply, false);
  assert.equal((await f.controller.snapshot()).token, state.token);
  await f.controller.restore({action:'restore-only',token:state.token,confirmation:'CONFIRM PATCH OPERATION'});
  assert.equal(f.calls(), 0);
  state = await f.controller.snapshot();
  assert.equal(state.canApply, true);
  const applied = await f.controller.restore({action:'apply',token:state.token,confirmation:'CONFIRM PATCH OPERATION'});
  assert.equal(applied.phase, 'applied');
  assert.equal(restorationPending(f.root,f.home), false);
  assert.equal(f.calls(),0);
  assert.ok(planPatches(f.root,'check',f.artifacts).every(p=>p.state==='patched'));
 });
 test('restore-only works without removable bundle, manager removal remains blocked', async t => {
  const f = fixture(t,{manager:{listBundles:async()=>[]}});
  const state=await f.controller.snapshot();
  assert.equal(state.canRestore,false); assert.equal(state.canRestoreOnly,true);
  await f.controller.restore({action:'restore-only',token:state.token,confirmation:'CONFIRM PATCH OPERATION'});
  assert.ok(planPatches(f.root,'check',f.artifacts).every(p=>p.state==='pristine'));
 });
 test('apply rejects active inspection blockers and unknown file states', async t => {
  const f = fixture(t,{inspect:async()=>({blockers:[{code:'active_turns',message:'stop'}],fingerprint:'x'})});
  applyPlan(planPatches(f.root,'revert',f.artifacts),path.join(f.home,'isolated-backup'));
  assert.equal((await f.controller.snapshot()).canApply,false);
 });
 test('activation does not invoke automatic patching', async () => {
  const {apply}=await import('../src/index.js');
  let injections=0;
  apply({logger:{info(){},warn(){},error(){}},inject(){injections++;}});
  assert.equal(injections,1);
 });

test('real backend snapshots validate frontend after all manual actions', async t => {
  const {maintenanceSnapshot}=await import('../src/maintenance-state.js');
  const f=fixture(t);
  for(const action of ['restore-only','apply','restore-and-uninstall']) {
    const before=maintenanceSnapshot(await f.controller.snapshot());
    const result=await f.controller.restore({action,token:before.token,confirmation:'CONFIRM PATCH OPERATION'});
    assert.doesNotThrow(()=>maintenanceSnapshot(result));
  }
});
