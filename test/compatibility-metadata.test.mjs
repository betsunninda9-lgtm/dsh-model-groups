import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARTIFACTS, applyPlan, planPatches, sha256 } from '../scripts/native-patches.mjs';
import { compatibilitySnapshot, compatibilityGuidance, publicVersion } from '../src/compatibility.js';
import { createMaintenance, createUnavailableMaintenance, MAINTENANCE_PROTOCOL } from '../src/maintenance.js';

const pluginPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata leaves DSH versions unrestricted, including prereleases', () => {
  assert.equal(pluginPackage.engines.node, '>=22');
  assert.equal(Object.hasOwn(pluginPackage.engines, 'dsh'), false);
  for (const name of Object.keys(pluginPackage.peerDependencies ?? {})) assert.ok(!name.startsWith('@deepseek-ai/dsh'), name);
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.version, pluginPackage.version);
  assert.equal(lock.packages[''].version, pluginPackage.version);
  assert.equal(Object.hasOwn(lock.packages[''].engines, 'dsh'), false);
});

test('compatibility metadata preserves actual prerelease and build versions without inventing an allowlist', () => {
  const hostVersion = '0.3.0-rc.7+mobile.19';
  const installedVersion = '0.4.1-beta.2+android.3';
  const snapshot = compatibilitySnapshot({ schema: 1, pluginVersion: pluginPackage.version, hostVersion, supportedDsh: null, compatibilityPolicy: 'code',
    files: [{ id: ARTIFACTS[0], state: 'pristine', code: 'not_applied', installedVersion, observedSha256: 'a'.repeat(64), extra: 'PRIVATE_SOURCE' }], extra: '/PRIVATE_PATH' });
  assert.equal(snapshot.hostVersion, hostVersion);
  assert.equal(snapshot.files[0].installedVersion, installedVersion);
  assert.equal(snapshot.supportedDsh, null);
  assert.equal(snapshot.compatibilityPolicy, 'code');
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  const legacy = compatibilitySnapshot({ schema: 1, supportedDsh: '0.2.2-rc.1', files: [] });
  assert.equal(legacy.supportedDsh, '0.2.2-rc.1');
  assert.equal(legacy.compatibilityPolicy, null, 'old reports must not be relabeled as the new policy');
  assert.equal(publicVersion('0.3.0+mobile.19'), '0.3.0+mobile.19');
  assert.equal(publicVersion('0.3.0\nPRIVATE_SOURCE'), null);
  assert.equal(publicVersion('0.3.0+' + 'a'.repeat(128)), null);
  for (const code of ['host_identity', 'package_identity']) {
    assert.equal(compatibilitySnapshot({ schema: 1, files: [{ id: ARTIFACTS[0], code }] }).files[0].code, code);
    assert.match(compatibilityGuidance({ files: [{ code }] }), /身份不匹配/);
  }
  assert.match(compatibilityGuidance({ files: [{ code: 'host_version' }] }), /旧版插件/);
  assert.match(compatibilityGuidance({ files: [{ code: 'unrecognized_content' }] }), /版本号不同本身不会/);
});

test('unavailable-host metadata uses the code policy with unknown versions', async () => {
  const value = await createUnavailableMaintenance().snapshot();
  assert.equal(value.compatibility.hostVersion, null);
  assert.equal(value.compatibility.supportedDsh, null);
  assert.equal(value.compatibility.compatibilityPolicy, 'code');
});

test('maintenance cached and fresh views report installed versions rather than recipe versions', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-version-metadata-'));
  t.after(() => { assert.equal(fs.realpathSync(temp), temp); assert.ok(path.basename(temp).startsWith('dsh-version-metadata-')); fs.rmSync(temp, { recursive: true }); });
  const root = path.join(temp, 'runtime'), home = path.join(temp, 'home'), artifacts = path.join(temp, 'artifacts');
  fs.mkdirSync(root); fs.mkdirSync(artifacts);
  const hostVersion = '0.3.2-rc.4+android.19';
  const installedVersion = '0.4.0-beta.8+relay.2';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: hostVersion }));
  for (const [i, id] of ARTIFACTS.entries()) {
    const packageName = i === 0 ? '@deepseek-ai/dsh-llm-pi-ai' : i === 1 ? '@deepseek-ai/dsh-client-ui-settings-models' : i === 4 ? '@deepseek-ai/dsh-api-remotes' : '@deepseek-ai/dsh-llm';
    const target = `node_modules/${packageName}/lib/meta-${i}.js`;
    fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', packageName, 'package.json'), JSON.stringify({ name: packageName, version: installedVersion }));
    const before = `before-${i}`, after = `after-${i}`;
    fs.writeFileSync(path.join(root, target), before);
    fs.writeFileSync(path.join(artifacts, id), JSON.stringify({ version: '0.2.2-rc.1', packageName, target, baseSha256: sha256(before), resultSha256: sha256(after), replacements: [{ before, after }] }));
  }
  const controller = createMaintenance({ root, home, artifacts, inspect: async () => ({ blockers: [], fingerprint: 'same' }), manager: { listBundles: async () => [{ name: 'dsh-model-groups', removable: true }] } });
  const check = value => {
    assert.equal(value.compatibility.hostVersion, hostVersion);
    assert.equal(value.compatibility.supportedDsh, null);
    assert.equal(value.compatibility.compatibilityPolicy, 'code');
    assert.ok(value.compatibility.files.every(file => file.installedVersion === installedVersion));
  };
  const before = await controller.snapshot();
  check(before); assert.equal(before.canApply, true);
  const applied = await controller.restore({ maintenanceProtocol: MAINTENANCE_PROTOCOL, clientVersion: '0.3.10', action: 'apply', confirmation: 'CONFIRM PATCH OPERATION', token: before.token });
  check(applied); assert.equal(applied.phase, 'applied');
  assert.ok(planPatches(root, 'check', artifacts).every(plan => plan.state === 'patched'));
  await assert.rejects(controller.restore({ maintenanceProtocol: MAINTENANCE_PROTOCOL + 1, clientVersion: pluginPackage.version, action: 'apply', confirmation: 'CONFIRM PATCH OPERATION', token: applied.token }), { code: 'CLIENT_VERSION_MISMATCH' });
  applyPlan(planPatches(root, 'revert', artifacts), path.join(temp, 'test-backups'));
  check(await controller.snapshot());
});
