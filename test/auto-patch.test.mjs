import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { autoPatch, findDshRoot } from '../src/auto-patch.js';
import { planPatches } from '../scripts/native-patches.mjs';

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
  const bad = path.join(root, plans[0].artifact.target);
  fs.appendFileSync(bad, '\nunknown');
  assert.throws(() => autoPatch(root, home), /unrecognized content/);
  assert.equal(fs.existsSync(home), false);
  fs.writeFileSync(bad, plans[0].result);
  assert.deepEqual(autoPatch(root, home), { state: 'restart-required', changed: 5, runtimeVerified: false });
  assert.ok(planPatches(root, 'check').every(plan => plan.state === 'patched'));
  const storage = path.join(home, 'dsh-model-groups');
  const backupRoot = path.join(storage, fs.readdirSync(storage)[0]);
  assert.equal(fs.readdirSync(path.join(backupRoot, 'backups')).length, 5);
  assert.equal(fs.existsSync(path.join(backupRoot, 'patch.lock')), false);
  const stats = planPatches(root, 'check').map(plan => fs.statSync(plan.file).mtimeMs);
  assert.equal(autoPatch(root, home).changed, 0);
  assert.deepEqual(planPatches(root, 'check').map(plan => fs.statSync(plan.file).mtimeMs), stats);
});


test('host discovery survives unsupported version and missing or unknown program targets without permitting writes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-discovery-test-'));
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith('dsh-discovery-test-')); fs.rmSync(root, { recursive: true }); });
  const packageDir = path.join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai'); fs.mkdirSync(packageDir, { recursive: true });
  const entry = path.join(root, 'package.json');
  fs.writeFileSync(entry, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.3' }));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-pi-ai', version: '0.2.3' }));
  assert.equal(findDshRoot(entry), root);
  assert.throws(() => autoPatch(root, path.join(root, 'untouched-home')), /only @deepseek-ai/);
  assert.equal(fs.existsSync(path.join(root, 'untouched-home')), false);
  fs.writeFileSync(entry, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  assert.equal(findDshRoot(entry), root);
  assert.throws(() => autoPatch(root, path.join(root, 'untouched-home')), /ENOENT/);
  assert.equal(fs.existsSync(path.join(root, 'untouched-home')), false);
});
