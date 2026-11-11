import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { ARTIFACTS, sha256 } from '../scripts/native-patches.mjs';

const doctor = (...args) => spawnSync(process.execPath, [new URL('../scripts/doctor.mjs', import.meta.url).pathname, ...args, '--json'], { encoding: 'utf8' });

test('diagnostic CLI emits sanitized JSON for conflicts, missing programs and host versions without writes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-doctor-test-'));
  t.after(() => {
    assert.equal(fs.realpathSync(root), root); assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('dsh-doctor-test-')); fs.rmSync(root, { recursive: true });
  });
  const hostPackage = path.join(root, 'package.json');
  fs.writeFileSync(hostPackage, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const files = ARTIFACTS.map(name => {
    const artifact = JSON.parse(fs.readFileSync(new URL('../native/' + name, import.meta.url), 'utf8'));
    const file = path.join(root, artifact.target); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', artifact.packageName, 'package.json'), JSON.stringify({ name: artifact.packageName, version: '0.2.2-rc.1' }));
    const source = 'PRIVATE_PROGRAM_CONTENT_' + name; fs.writeFileSync(file, source);
    return { file, source };
  });
  const first = doctor('--dsh-root', root);
  assert.equal(first.status, 1); assert.equal(first.stderr, '');
  const report = JSON.parse(first.stdout);
  assert.equal(report.diskPatchesReady, false); assert.equal(report.runtimeVerified, false);
  assert.ok(report.files.every(item => item.code === 'unrecognized_content'));
  assert.equal(report.files.at(-1).observedSha256, sha256(files.at(-1).source));
  assert.doesNotMatch(first.stdout, /PRIVATE_PROGRAM|node_modules|dsh-doctor-test-/);
  assert.equal(fs.existsSync(path.join(root, 'backups')), false);
  for (const item of files) assert.equal(fs.readFileSync(item.file, 'utf8'), item.source);
  const missing = files.at(-1).file; assert.equal(fs.realpathSync(missing), missing); fs.unlinkSync(missing);
  const second = doctor('--dsh-root', root); assert.equal(second.status, 1);
  assert.equal(JSON.parse(second.stdout).files.at(-1).code, 'target_unavailable');
  fs.writeFileSync(hostPackage, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.3' }));
  const third = doctor('--dsh-root', root); assert.equal(third.status, 1);
  assert.ok(JSON.parse(third.stdout).files.every(item => item.code === 'host_version'));
});

test('diagnostic CLI argument failure is valid closed JSON rather than a path-bearing exception', () => {
  const result = doctor('--unexpected-private-argument');
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).error, 'diagnostic_unavailable');
  assert.doesNotMatch(result.stdout, /unexpected-private-argument|stack|ENOENT/);
});
