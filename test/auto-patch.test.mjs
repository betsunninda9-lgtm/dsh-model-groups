import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { autoPatch, findDshRoot, startupActivity } from '../src/auto-patch.js';
import { planPatches } from '../scripts/native-patches.mjs';
import { writePatchPreferences } from '../src/patch-preferences.js';

test('automatic patch validates all inputs, backs up outside package and repeats without writes', t => {
  if (!process.env.DSH_ROOT) return t.skip('Set DSH_ROOT for isolated real-file tests');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-auto-patch-test-'));
  t.after(() => {
    assert.equal(fs.realpathSync(tmp), tmp);
    assert.equal(path.dirname(tmp), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(tmp).startsWith('dsh-auto-patch-test-'));
    fs.rmSync(tmp, { recursive: true });
  });
  const root = path.join(tmp, 'runtime'), home = path.join(tmp, 'home');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const plans = planPatches(process.env.DSH_ROOT, 'revert');
  for (const plan of plans) {
    const target = path.join(root, plan.artifact.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, plan.result);
    fs.writeFileSync(path.join(root, 'node_modules', plan.artifact.packageName, 'package.json'), JSON.stringify({ name: plan.artifact.packageName, version: '0.2.2-rc.1' }));
  }
  assert.equal(findDshRoot(path.join(root, 'package.json')), root);
  writePatchPreferences(root, home, { enabled: true, autoMaintenance: true });
  const bad = path.join(root, plans[0].artifact.target);
  const replacement = plans[0].artifact.replacements[0];
  assert.ok(plans[0].result.includes(replacement.before), 'conflict fixture starts from a real required fragment');
  const partial = plans[0].result.replace(replacement.before, replacement.after);
  for (const source of ['export const incompatibleHostSchema = {};\n', partial]) {
    fs.writeFileSync(bad, source);
    const before = plans.map(plan => fs.readFileSync(path.join(root, plan.artifact.target), 'utf8'));
    assert.throws(() => autoPatch(root, home), /unrecognized content/);
    assert.deepEqual(plans.map(plan => fs.readFileSync(path.join(root, plan.artifact.target), 'utf8')), before, 'incompatible fragment blocks the entire batch without writes');
    assert.equal(fs.existsSync(path.join(home, 'dsh-model-groups', fs.readdirSync(path.join(home, 'dsh-model-groups'))[0], 'backups')), false, 'failed planning creates no backups');
  }
  const unrelated = '\n// synthetic unrelated host change\n';
  fs.writeFileSync(bad, plans[0].result + unrelated);
  assert.equal(planPatches(root, 'check')[0].compatibility, 'fragments', 'unknown whole-file hash with compatible fragments is accepted');
  assert.deepEqual(autoPatch(root, home), { state: 'restart-required', changed: 5, runtimeVerified: false });
  assert.ok(fs.readFileSync(bad, 'utf8').endsWith(unrelated), 'automatic patch preserves unrelated host changes');
  assert.equal(planPatches(root, 'revert')[0].result, plans[0].result + unrelated, 'revert preserves the exact compatible host variant');
  assert.ok(planPatches(root, 'check').every(plan => plan.state === 'patched'));
  const storage = path.join(home, 'dsh-model-groups');
  const backupRoot = path.join(storage, fs.readdirSync(storage)[0]);
  assert.equal(fs.readdirSync(path.join(backupRoot, 'backups')).length, 5);
  assert.equal(fs.existsSync(path.join(backupRoot, 'patch.lock')), false);
  const stats = planPatches(root, 'check').map(plan => fs.statSync(plan.file).mtimeMs);
  assert.equal(autoPatch(root, home).changed, 0);
  assert.deepEqual(planPatches(root, 'check').map(plan => fs.statSync(plan.file).mtimeMs), stats);
  // A runtime update may change versions independently while restoring compatible programs.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.3.0-mobile.1+runtime.2' }));
  for (const plan of plans) {
    fs.writeFileSync(path.join(root, plan.artifact.target), plan.result + unrelated);
    fs.writeFileSync(path.join(root, 'node_modules', plan.artifact.packageName, 'package.json'), JSON.stringify({ name: plan.artifact.packageName, version: '0.4.1-port.2' }));
  }
  assert.deepEqual(autoPatch(root, home), { state: 'restart-required', changed: 5, runtimeVerified: false });
  assert.ok(planPatches(root).every(plan => plan.state === 'patched' && plan.hostVersion === '0.3.0-mobile.1+runtime.2' && plan.installedVersion === '0.4.1-port.2'));
  assert.equal(autoPatch(root, home).changed, 0);
});


test('startup activity checks live tasks and shared host processes without scanning configuration', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-startup-activity-'));
  t.after(() => { assert.equal(fs.realpathSync(directory), directory); assert.ok(path.basename(directory).startsWith('dsh-startup-activity-')); fs.rmSync(directory, { recursive: true }); });
  assert.equal(startupActivity({}, '/runtime', directory), null);
  assert.equal(startupActivity({ agents: { list: () => [{ status: 'running', phase: { kind: 'idle' } }] } }, '/runtime', directory), 'active-tasks');
  assert.equal(startupActivity({ agents: { list: () => [{ status: 'idle', phase: { kind: 'maintenance' } }] } }, '/runtime', directory), 'active-tasks');
  assert.equal(startupActivity({ agents: { list: () => [{ status: 'idle' }] } }, '/runtime', directory), null);
  assert.equal(startupActivity({ agents: { list: () => [{ status: 'running', phase: { kind: 'running' } }] } }, '/runtime', directory, { includeTasks: false }), null, 'staging a patch for the next restart does not stop running conversations');
  const process = path.join(directory, '99123'); fs.mkdirSync(process);
  fs.writeFileSync(path.join(process, 'cmdline'), '/usr/bin/node\0/other/node_modules/@deepseek-ai/dsh/lib/bin.js\0');
  assert.equal(startupActivity({}, '/runtime', directory), null);
  fs.writeFileSync(path.join(process, 'cmdline'), '/usr/bin/node\0/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js\0');
  assert.equal(startupActivity({}, '/runtime', directory), 'other-engine');
  assert.equal(startupActivity({}, '/runtime', path.join(directory, 'missing')), 'activity-unverified');
});

test('host discovery survives unsupported version and missing or unknown program targets without permitting writes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-discovery-test-'));
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith('dsh-discovery-test-')); fs.rmSync(root, { recursive: true }); });
  const packageDir = path.join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai'); fs.mkdirSync(packageDir, { recursive: true });
  const entry = path.join(root, 'package.json');
  fs.writeFileSync(entry, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.3' }));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-pi-ai', version: '0.2.3' }));
  assert.equal(findDshRoot(entry), root);
  assert.equal(autoPatch(root, path.join(root, 'untouched-home')).state, 'fold-only');
  assert.equal(fs.existsSync(path.join(root, 'untouched-home', 'dsh-model-groups')), true);
  fs.writeFileSync(entry, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  assert.equal(findDshRoot(entry), root);
  assert.equal(autoPatch(root, path.join(root, 'untouched-home')).state, 'fold-only');
  assert.equal(fs.existsSync(path.join(root, 'untouched-home', 'dsh-model-groups')), true);
});
