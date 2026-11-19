import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reportBridgeImport } from '../src/bridge/migration-report.js';

test('explicit import reports only bounded progress and never serialize input data or error text', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-import-'));
  t.after(() => { assert.equal(path.resolve(home), home); assert.ok(path.basename(home).startsWith('dsh-bridge-import-')); fs.rmSync(home, { recursive: true }); });
  const dir = path.join(home, 'dsh-model-groups'); fs.mkdirSync(dir);
  const file = path.join(dir, 'bridge-import-result.json');
  reportBridgeImport('/private/profile.yml', { stage: 'waiting' }, home);
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(path.join(dir, 'pending-bridge-import.json'), JSON.stringify({ schema: 1, documentPath: '/private/profile.yml', providers: { private: { secret: 'never-publish-secret' } } }));
  reportBridgeImport('/other/profile.yml', { stage: 'waiting' }, home);
  assert.equal(fs.existsSync(file), false);
  reportBridgeImport('/private/profile.yml', { stage: 'failed', code: 'never-publish-secret', message: 'never-publish-secret', activated: -1 }, home);
  const failed = JSON.parse(fs.readFileSync(file));
  assert.equal(failed.code, 'INITIALIZATION_FAILED'); assert.equal(failed.activated, undefined);
  assert.doesNotMatch(JSON.stringify(failed), /never-publish-secret|providers|private/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  reportBridgeImport('/private/profile.yml', { stage: 'complete', activated: 1, conflicts: 0, clientRegistered: true }, home);
  const complete = JSON.parse(fs.readFileSync(file));
  assert.equal(complete.activated, 1); assert.equal(complete.conflicts, 0); assert.equal(complete.code, undefined);
  assert.equal(complete.clientRegistered, true);
  reportBridgeImport('/private/profile.yml', { stage: 'complete', clientRegistered: 'never-publish-secret' }, home);
  assert.equal(JSON.parse(fs.readFileSync(file)).clientRegistered, undefined);
});
