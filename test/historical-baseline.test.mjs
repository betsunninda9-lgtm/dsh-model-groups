import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { ARTIFACTS, sha256 } from '../scripts/native-patches.mjs';

// App updates can replace every live baseline. Keep exercising historical
// recipes against complete, hash-verified code backups when they are available.
test('retained complete baseline programs still run historical and shipped upgrade suites', t => {
  const backupRoot = new URL('../native/backups/', import.meta.url);
  if (!fs.existsSync(backupRoot)) return t.skip('No complete retained program backups; normal historical suites still run supplied inputs');
  const inputs = ARTIFACTS.map(name => {
    const artifact = JSON.parse(fs.readFileSync(new URL('../native/' + name, import.meta.url), 'utf8'));
    const revisions = [artifact, ...(artifact.variants ?? []).map(value => ({ ...artifact, ...value }))];
    for (const revision of revisions) {
      const filename = `${artifact.packageName.slice('@deepseek-ai/'.length)}-${path.basename(artifact.target)}-${revision.baseSha256}.js`;
      const file = new URL(filename, backupRoot);
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(sha256(source), revision.baseSha256, 'retained baseline must be full original program bytes');
      return { artifact, source };
    }
  });
  if (inputs.some(input => !input)) return t.skip('Five complete retained original programs are not available');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-historical-baseline-'));
  t.after(() => { assert.equal(fs.realpathSync(directory), directory); assert.ok(path.basename(directory).startsWith('groups-historical-baseline-')); fs.rmSync(directory, { recursive: true }); });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  for (const { artifact, source } of inputs) {
    const target = path.join(directory, artifact.target);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
    fs.writeFileSync(path.join(directory, 'node_modules', artifact.packageName, 'package.json'), JSON.stringify({ name: artifact.packageName, version: artifact.version }));
  }
  const environment = { ...process.env, DSH_ROOT: directory, PI_AI_SOURCES: '' };
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', 'test/historical-upgrade.test.mjs', 'test/shipped-upgrade.test.mjs'], {
    cwd: new URL('../', import.meta.url), env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Complete five-program direct-upgrade cases passed=[1-9]/, 'retained historical cases actually execute, rather than an empty nested runner');
  t.diagnostic(result.stdout.split('\n').filter(line => /Complete five-program|tests |pass |fail |skipped /.test(line)).join('\n'));
});
