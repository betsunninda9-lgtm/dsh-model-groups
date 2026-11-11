import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { ARTIFACTS, applyPlan, planPatches, sha256, transformSource } from '../scripts/native-patches.mjs';

const root = new URL('../', import.meta.url);
const readArtifact = name => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const candidates = artifact => [artifact, ...(artifact.variants ?? []).map(variant => ({ ...artifact, ...variant, current: variant.current === true }))];

// These integration tests may READ an explicitly named installation, but ALL
// writes/apply/revert run on disposable copies with synthetic config sentinels.
// No installed config/credentials/sessions are read or written; no model calls.
test('all five real artifacts upgrade pristine, v0.3.5 and beta.5 in place, revert and retain configuration sentinels', t => {
  const installed = process.env.DSH_ROOT;
  if (!installed) { t.skip('Set DSH_ROOT to validate real bundles in isolated copies'); return; }
  const observed = planPatches(installed, 'check');
  const inputs = ARTIFACTS.map((name, i) => {
    const artifact = readArtifact('native/' + name), plan = observed[i];
    const pristine = plan.state === 'patched' ? transformSource(plan.source, plan.artifact, true) : plan.source;
    return { name, artifact, pristine };
  });
  const stableSettings = readArtifact('test/fixtures/settings-models/v0.3.5.json');
  const betaSettings = readArtifact('test/fixtures/settings-models/beta5.json');
  const stablePi = readArtifact('test/fixtures/pi-ai/v0.3.5.json');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shipped-upgrade-'));
  t.after(() => {
    if (fs.realpathSync(temp) !== temp || path.dirname(temp) !== fs.realpathSync(os.tmpdir()) || !path.basename(temp).startsWith('dsh-shipped-upgrade-')) throw new Error('Unsafe integration fixture cleanup');
    fs.rmSync(temp, { recursive: true });
  });
  for (const mode of ['pristine', 'v0.3.5', 'beta.5']) {
    const copy = path.join(temp, mode); fs.mkdirSync(copy);
    fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
    for (const input of inputs) {
      const file = path.join(copy, input.artifact.target); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(path.join(copy, 'node_modules', input.artifact.packageName, 'package.json'), JSON.stringify({ name: input.artifact.packageName, version: '0.2.2-rc.1' }));
      let content = input.pristine;
      if (mode !== 'pristine') {
        const old = input.name === 'settings-models.patch.json' ? mode === 'v0.3.5' ? stableSettings : betaSettings : input.name === 'pi-ai.patch.json' ? stablePi : input.artifact;
        const revision = candidates(old).find(candidate => candidate.baseSha256 === sha256(content));
        assert.ok(revision, `${mode}: legacy artifact recognizes ${input.name} pristine base`);
        content = transformSource(content, revision);
      }
      fs.writeFileSync(file, content);
    }
    const sentinels = ['config.yaml', '.credentials.yaml', 'sessions/example.jsonl'].map((name, i) => {
      const file = path.join(copy, name), content = `synthetic-config-not-a-real-secret-${i}\n`;
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
      return { file, content };
    });
    const before = planPatches(copy, 'check');
    assert.ok(before.every(plan => plan.result === plan.source));
    const doctor = () => spawnSync(process.execPath, [new URL('../scripts/doctor.mjs', import.meta.url).pathname, '--dsh-root', copy, '--json'], { encoding: 'utf8' });
    const pendingReport = doctor();
    assert.equal(pendingReport.status, 2, pendingReport.stderr);
    assert.equal(JSON.parse(pendingReport.stdout).diskPatchesReady, false);
    if (mode !== 'pristine') {
      assert.equal(before.find(plan => plan.name === 'settings-models.patch.json').updateAvailable, true);
      assert.equal(before.find(plan => plan.name === 'pi-ai.patch.json').updateAvailable, true);
    }
    const apply = planPatches(copy, 'apply');
    assert.ok(apply.some(plan => plan.result !== plan.source));
    applyPlan(apply, path.join(copy, 'backups'));
    const after = planPatches(copy, 'check');
    assert.ok(after.every(plan => plan.state === 'patched' && !plan.updateAvailable && plan.applySupported));
    const readyReport = doctor(); assert.equal(readyReport.status, 0, readyReport.stderr);
    assert.equal(JSON.parse(readyReport.stdout).diskPatchesReady, true);
    assert.equal(JSON.parse(readyReport.stdout).runtimeVerified, false);
    assert.equal(applyPlan(planPatches(copy, 'apply'), path.join(copy, 'backups')), 0);
    for (const plan of after) {
      const input = inputs.find(item => item.name === plan.name);
      const latest = candidates(input.artifact).find(candidate => candidate.baseSha256 === sha256(input.pristine) && candidate.current === true) ?? input.artifact;
      assert.equal(sha256(plan.source), latest.resultSha256);
    }
    applyPlan(planPatches(copy, 'revert'), path.join(copy, 'backups'));
    for (const input of inputs) assert.equal(fs.readFileSync(path.join(copy, input.artifact.target), 'utf8'), input.pristine);
    for (const sentinel of sentinels) assert.equal(fs.readFileSync(sentinel.file, 'utf8'), sentinel.content);
  }
});
