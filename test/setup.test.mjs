import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { planPatches } from '../scripts/native-patches.mjs';

const setup = fileURLToPath(new URL('../scripts/setup.mjs', import.meta.url));
test('setup checks before registration, applies all patches and leaves unknown files untouched', t => {
  if (!process.env.DSH_ROOT) return t.skip('Set DSH_ROOT to prepare isolated real-source fixtures');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-setup-test-'));
  t.after(() => {
    assert.equal(fs.realpathSync(root), root);
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('dsh-setup-test-'));
    fs.rmSync(root, { recursive: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const originals = planPatches(process.env.DSH_ROOT, 'revert');
  for (const plan of originals) {
    const target = path.join(root, plan.artifact.target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, plan.result);
    fs.writeFileSync(path.join(root, 'node_modules', plan.artifact.packageName, 'package.json'), JSON.stringify({ name: plan.artifact.packageName, version: '0.2.2-rc.1' }));
  }
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const log = path.join(root, 'registration.log');
  fs.writeFileSync(path.join(bin, 'dsh'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$SETUP_TEST_LOG"\nexit "${SETUP_TEST_EXIT:-0}"\n', { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SETUP_TEST_LOG: log };
  const run = (...args) => spawnSync(process.execPath, [setup, '--dsh-root', root, '--profile', 'web', ...args], { env, encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(fs.existsSync(log), false);
  assert.equal(run('--apply').status, 1);
  assert.equal(fs.existsSync(log), false);
  const first = path.join(root, originals[0].artifact.target);
  fs.appendFileSync(first, '\nunknown change');
  assert.equal(run('--apply', '--service-stopped').status, 1);
  assert.equal(fs.existsSync(log), false);
  fs.writeFileSync(first, originals[0].result);
  env.SETUP_TEST_EXIT = '1';
  assert.equal(run('--apply', '--service-stopped').status, 1);
  assert.ok(planPatches(root, 'check').every(plan => plan.state === 'pristine'));
  env.SETUP_TEST_EXIT = '0';
  assert.equal(run('--apply', '--service-stopped').status, 0);
  assert.ok(planPatches(root, 'check').every(plan => plan.state === 'patched'));
  assert.match(fs.readFileSync(log, 'utf8'), /plugin\n--profile\nweb\nadd/);
  assert.equal(run('--apply', '--service-stopped').status, 0);
});
