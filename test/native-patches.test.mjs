import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARTIFACTS, applyPlan, planPatches, sha256, transformSource } from '../scripts/native-patches.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-multikey-patch-test-'));
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const files = ARTIFACTS.map((name, index) => {
    const packageName = index === 0 ? '@deepseek-ai/dsh-llm-pi-ai' : index === 1 ? '@deepseek-ai/dsh-client-ui-settings-models' : name === 'api-remotes.patch.json' ? '@deepseek-ai/dsh-api-remotes' : '@deepseek-ai/dsh-llm';
    const target = `node_modules/${packageName}/lib/test-${index}.js`;
    const file = path.join(root, target); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', packageName, 'package.json'), JSON.stringify({ name: packageName, version: '0.2.2-rc.1' }));
    const source = `before-${index}`; fs.writeFileSync(file, source);
    const artifact = { version: '0.2.2-rc.1', packageName, target, baseSha256: sha256(source), resultSha256: sha256(`after-${index}`), replacements: [{ before: source, after: `after-${index}` }] };
    fs.writeFileSync(path.join(artifacts, name), JSON.stringify(artifact));
    return { file, source, artifact, name };
  });
  t.after(() => {
    const resolved = fs.realpathSync(root);
    if (resolved !== root || !path.basename(root).startsWith('dsh-multikey-patch-test-') || path.dirname(root) !== fs.realpathSync(os.tmpdir())) throw new Error('Unsafe temporary directory cleanup');
    fs.rmSync(root, { recursive: true });
  });
  return { root, artifacts, files };
}

test('native patch check never writes and plans are idempotent in both directions', t => {
  const f = fixture(t);
  const checks = planPatches(f.root, 'check', f.artifacts);
  assert.ok(checks.every(plan => plan.state === 'pristine' && plan.source === plan.result));
  assert.ok(f.files.every(file => fs.readFileSync(file.file, 'utf8') === file.source));
  const apply = planPatches(f.root, 'apply', f.artifacts);
  for (const plan of apply) fs.writeFileSync(plan.file, plan.result);
  assert.ok(planPatches(f.root, 'apply', f.artifacts).every(plan => plan.state === 'patched' && plan.source === plan.result));
  const revert = planPatches(f.root, 'revert', f.artifacts);
  for (const plan of revert) fs.writeFileSync(plan.file, plan.result);
  assert.ok(f.files.every(file => fs.readFileSync(file.file, 'utf8') === file.source));
});

test('modified or newer native packages fail closed before any write', t => {
  const f = fixture(t); fs.appendFileSync(f.files.at(-1).file, 'concurrent edit');
  assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /unrecognized content/);
  assert.equal(fs.readFileSync(f.files[0].file, 'utf8'), f.files[0].source);
  fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.3' }));
  assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /only @deepseek-ai\/dsh 0.2.2-rc.1/);
});

test('unsafe targets and malformed literal artifacts are rejected', t => {
  const f = fixture(t), entry = f.files[0];
  fs.writeFileSync(path.join(f.artifacts, entry.name), JSON.stringify({ ...entry.artifact, target: '../outside.js' }));
  assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /Unsafe patch target/);
  assert.throws(() => transformSource(entry.source, { ...entry.artifact, resultSha256: '0'.repeat(64) }), /result hash mismatch/);
  assert.throws(() => transformSource(entry.source, { ...entry.artifact, replacements: [{ before: '', after: 'x' }] }), /Invalid literal/);
});

test('real apply creates private backups, is idempotent and restores every native target', t => {
  const f = fixture(t), backups = path.join(f.root, 'backups');
  const beforeModes = f.files.map(item => fs.statSync(item.file).mode & 0o777);
  assert.equal(applyPlan(planPatches(f.root, 'apply', f.artifacts), backups), ARTIFACTS.length);
  assert.equal(fs.readdirSync(backups).length, ARTIFACTS.length);
  for (const backup of fs.readdirSync(backups)) assert.equal(fs.statSync(path.join(backups, backup)).mode & 0o777, 0o600);
  assert.ok(f.files.every((item, i) => fs.readFileSync(item.file, 'utf8') === `after-${i}`));
  assert.deepEqual(f.files.map(item => fs.statSync(item.file).mode & 0o777), beforeModes);
  assert.equal(applyPlan(planPatches(f.root, 'apply', f.artifacts), backups), 0);
  assert.equal(applyPlan(planPatches(f.root, 'revert', f.artifacts), backups), ARTIFACTS.length);
  assert.ok(f.files.every(item => fs.readFileSync(item.file, 'utf8') === item.source));
});

test('real apply refuses stale plans before creating backups or changing targets', t => {
  const f = fixture(t), backups = path.join(f.root, 'backups');
  const plans = planPatches(f.root, 'apply', f.artifacts);
  fs.appendFileSync(f.files.at(-1).file, '-external');
  assert.throws(() => applyPlan(plans, backups), /Concurrent native edit/);
  assert.equal(fs.existsSync(backups), false);
  assert.equal(fs.readFileSync(f.files[0].file, 'utf8'), f.files[0].source);
});

test('staging failure leaves all original targets intact and removes temporary files', t => {
  const f = fixture(t), backups = path.join(f.root, 'backups');
  const plans = planPatches(f.root, 'apply', f.artifacts);
  const originalWrite = fs.writeFileSync;
  let stagedWrites = 0;
  const stub = t.mock.method(fs, 'writeFileSync', function(file, ...args) {
    if (typeof file === 'number' && ++stagedWrites === 2) throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' });
    return originalWrite.call(this, file, ...args);
  });
  assert.throws(() => applyPlan(plans, backups), /Synthetic disk full/);
  stub.mock.restore();
  assert.ok(f.files.every(item => fs.readFileSync(item.file, 'utf8') === item.source));
  for (const item of f.files) assert.ok(!fs.readdirSync(path.dirname(item.file)).some(name => name.endsWith('.tmp')));
});

test('a later atomic rename failure rolls back prior replacements without leaving staging files', t => {
  const f = fixture(t), backups = path.join(f.root, 'backups');
  const plans = planPatches(f.root, 'apply', f.artifacts);
  const originalRename = fs.renameSync;
  let renames = 0;
  const stub = t.mock.method(fs, 'renameSync', function(...args) {
    if (++renames === 2) throw new Error('Synthetic rename failure');
    return originalRename.apply(this, args);
  });
  assert.throws(() => applyPlan(plans, backups), /Synthetic rename failure/);
  stub.mock.restore();
  assert.ok(f.files.every(item => fs.readFileSync(item.file, 'utf8') === item.source));
  for (const item of f.files) assert.ok(!fs.readdirSync(path.dirname(item.file)).some(name => name.endsWith('.tmp')));
});

test('a concurrent later edit survives while earlier replacements are rolled back', t => {
  const f = fixture(t), backups = path.join(f.root, 'backups');
  const plans = planPatches(f.root, 'apply', f.artifacts);
  const originalRename = fs.renameSync;
  let renames = 0;
  const stub = t.mock.method(fs, 'renameSync', function(...args) {
    const result = originalRename.apply(this, args);
    if (++renames === 1) fs.writeFileSync(f.files[1].file, 'external edit during apply');
    return result;
  });
  assert.throws(() => applyPlan(plans, backups), /Concurrent native edit/);
  stub.mock.restore();
  assert.equal(fs.readFileSync(f.files[0].file, 'utf8'), f.files[0].source);
  assert.equal(fs.readFileSync(f.files[1].file, 'utf8'), 'external edit during apply');
  assert.ok(f.files.slice(2).every(item => fs.readFileSync(item.file, 'utf8') === item.source));
});

test('shipped artifacts are reversible against installed targets or skip when no DSH_ROOT', (t) => {
  const dshRoot = process.env.DSH_ROOT;
  if (!dshRoot) {
    t.skip('Set DSH_ROOT (e.g. /opt/dsh) to test shipped artifacts against real targets');
    return;
  }
  for (const name of ARTIFACTS) {
    const artifact = JSON.parse(fs.readFileSync(new URL(`../native/${name}`, import.meta.url), 'utf8'));
    const targetFile = path.resolve(dshRoot, artifact.target);
    assert.ok(fs.existsSync(targetFile), `Target file does not exist: ${targetFile}`);
    const source = fs.readFileSync(targetFile, 'utf8');
    const hash = sha256(source);
    if (hash === artifact.resultSha256) {
      // Installed target is already patched; test reverting it back to base
      const pristine = transformSource(source, artifact, true);
      assert.equal(sha256(pristine), artifact.baseSha256, `${name}: reverse transform did not match baseSha256`);
      const rePatched = transformSource(pristine, artifact, false);
      assert.equal(sha256(rePatched), artifact.resultSha256, `${name}: forward transform did not match resultSha256`);
    } else if (hash === artifact.baseSha256) {
      // Installed target is pristine; test patching and reverting
      const patched = transformSource(source, artifact, false);
      assert.equal(sha256(patched), artifact.resultSha256, `${name}: forward transform did not match resultSha256`);
      const reverted = transformSource(patched, artifact, true);
      assert.equal(sha256(reverted), artifact.baseSha256, `${name}: reverse transform did not match baseSha256`);
    } else {
      assert.fail(`Installed target ${artifact.target} has unrecognized content hash ${hash}`);
    }
  }
});
