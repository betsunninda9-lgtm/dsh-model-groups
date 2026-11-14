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
test('all five real artifacts upgrade every supplied build in place, revert and retain configuration sentinels', async t => {
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
  const previousSettings = readArtifact('test/fixtures/settings-models/v0.3.8.json');
  const reorderBetaSettings = readArtifact('test/fixtures/settings-models/v0.3.9-beta.1.json');
  const previousPi = readArtifact('test/fixtures/pi-ai/v0.3.9-beta.1.json');
  const releaseSettings = readArtifact('test/fixtures/settings-models/v0.3.9.json');
  const releasePi = readArtifact('test/fixtures/pi-ai/v0.3.9.json');
  const capabilityBetaSettings = readArtifact('test/fixtures/settings-models/v0.3.10-beta.1.json');
  const capabilityBetaPi = readArtifact('test/fixtures/pi-ai/v0.3.10-beta.1.json');
  const isRecent = mode => ['v0.3.8', 'v0.3.9-beta.1', 'v0.3.9', 'v0.3.10-beta.1'].includes(mode);
  const stablePi = readArtifact('test/fixtures/pi-ai/v0.3.5.json');
  const delta = readArtifact('test/fixtures/pi-ai/credential-cancellation.delta.json');
  const piInput = inputs.find(input => input.name === 'pi-ai.patch.json');
  const bases = new Map([[sha256(piInput.pristine), piInput.pristine]]);
  const suppliedLegacy = new Map();
  for (const file of (process.env.PI_AI_SOURCES ?? '').split(path.delimiter).filter(Boolean)) {
    const source = fs.readFileSync(file, 'utf8'), hash = sha256(source);
    const revision = candidates(piInput.artifact).find(value => value.resultSha256 === hash) ?? candidates(piInput.artifact).find(value => value.baseSha256 === hash);
    assert.ok(revision, 'Explicit integration source must be recognized');
    const pristine = hash === revision.baseSha256 ? source : transformSource(source, revision, true);
    bases.set(revision.baseSha256, pristine);
    if (hash === delta.legacyResultSha256) suppliedLegacy.set(revision.baseSha256, source);
  }
  if (bases.has(delta.baseSha256)) {
    const pristine = transformSource(bases.get(delta.baseSha256), delta);
    if (bases.has(delta.resultSha256)) assert.equal(pristine, bases.get(delta.resultSha256));
    bases.set(delta.resultSha256, pristine);
  }
  // The released 0.3.6-beta.1 manifest had no current revision for the
  // cancellation build, so it refused it. Reconstruct that shape structurally
  // (never by duplicating the large replacement list) to keep proving the
  // refusal path, and assert it really omits that current revision.
  const beta1Pi = { ...piInput.artifact, variants: piInput.artifact.variants.filter(value => !(value.current === true && value.baseSha256 === delta.resultSha256)) };
  assert.equal(candidates(beta1Pi).some(value => value.current === true && value.baseSha256 === delta.resultSha256), false, 'legacy manifest must omit the cancellation build');
  const beta1PiText = JSON.stringify(beta1Pi, null, 2) + '\n';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shipped-upgrade-'));
  t.after(() => {
    if (fs.realpathSync(temp) !== temp || path.dirname(temp) !== fs.realpathSync(os.tmpdir()) || !path.basename(temp).startsWith('dsh-shipped-upgrade-')) throw new Error('Unsafe integration fixture cleanup');
    fs.rmSync(temp, { recursive: true });
  });
  const beta1Artifacts = path.join(temp, 'beta1-artifacts'); fs.mkdirSync(beta1Artifacts);
  for (const input of inputs) fs.writeFileSync(path.join(beta1Artifacts, input.name), input.name === 'pi-ai.patch.json' ? beta1PiText : JSON.stringify(input.artifact));

  for (const [baseHash, pristinePi] of bases) for (const mode of ['pristine', 'v0.3.5', 'beta.5', '0.3.6-beta.1', 'v0.3.8', 'v0.3.9-beta.1', 'v0.3.9', 'v0.3.10-beta.1']) {
    await t.test(`${baseHash.slice(0, 12)} ${mode} → current test build → exact pristine`, () => {
      const buildInputs = inputs.map(input => input.name === 'pi-ai.patch.json' ? { ...input, pristine: pristinePi } : input);
      const copy = path.join(temp, `${baseHash.slice(0, 12)}-${mode}`); fs.mkdirSync(copy);
      fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
      for (const input of buildInputs) {
        const file = path.join(copy, input.artifact.target); fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(path.join(copy, 'node_modules', input.artifact.packageName, 'package.json'), JSON.stringify({ name: input.artifact.packageName, version: '0.2.2-rc.1' }));
        let content = input.pristine;
        if (mode !== 'pristine') {
          const old = isRecent(mode)
            ? input.name === 'settings-models.patch.json' ? mode === 'v0.3.10-beta.1' ? capabilityBetaSettings : mode === 'v0.3.9' ? releaseSettings : mode === 'v0.3.8' ? previousSettings : reorderBetaSettings : input.name === 'pi-ai.patch.json' ? mode === 'v0.3.10-beta.1' ? capabilityBetaPi : mode === 'v0.3.9' ? releasePi : previousPi : input.artifact
            : mode === '0.3.6-beta.1' ? input.name === 'pi-ai.patch.json' ? beta1Pi : input.artifact
            : input.name === 'settings-models.patch.json' ? mode === 'v0.3.5' ? stableSettings : betaSettings : input.name === 'pi-ai.patch.json' ? stablePi : input.artifact;
          const matches = candidates(old).filter(candidate => candidate.baseSha256 === sha256(content));
          const revision = matches.find(candidate => candidate.current === true) ?? matches[0];
          assert.ok(revision, `${mode}: legacy artifact recognizes ${input.name} pristine base`);
          content = transformSource(content, revision);
        }
        if (input.name === 'pi-ai.patch.json' && mode !== 'pristine' && !isRecent(mode) && baseHash === delta.resultSha256) {
          assert.equal(sha256(content), delta.legacyResultSha256);
          if (suppliedLegacy.has(baseHash)) assert.equal(content, suppliedLegacy.get(baseHash), 'fixture is the complete untouched uploaded legacy program');
        }
        fs.writeFileSync(file, content);
      }
      const sentinels = ['config.yaml', '.credentials.yaml', 'sessions/example.jsonl'].map((name, i) => {
        const file = path.join(copy, name), content = `synthetic-config-not-a-real-secret-${i}\n`;
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
        return { file, content };
      });
      const before = planPatches(copy, 'check');
      assert.ok(before.every(plan => plan.result === plan.source && plan.applySupported));
      const needsUpdate = before.some(plan => plan.state === 'pristine' || plan.updateAvailable);
      const doctor = () => spawnSync(process.execPath, [new URL('../scripts/doctor.mjs', import.meta.url).pathname, '--dsh-root', copy, '--json'], { encoding: 'utf8' });
      const pendingReport = doctor();
      assert.equal(pendingReport.status, needsUpdate ? 2 : 0, pendingReport.stderr);
      assert.equal(JSON.parse(pendingReport.stdout).diskPatchesReady, !needsUpdate);
      if (mode === 'v0.3.5' || mode === 'beta.5') {
        assert.equal(before.find(plan => plan.name === 'settings-models.patch.json').updateAvailable, true);
        assert.equal(before.find(plan => plan.name === 'pi-ai.patch.json').updateAvailable, true);
      }
      if (baseHash === delta.resultSha256 && !isRecent(mode)) {
        const unsupported = planPatches(copy, 'check', beta1Artifacts).find(plan => plan.name === 'pi-ai.patch.json');
        assert.equal(unsupported.applySupported, false, 'old beta.1 really did reject this exact build');
        assert.throws(() => planPatches(copy, 'apply', beta1Artifacts), /No verified current patch/);
        for (const plan of before) assert.equal(fs.readFileSync(plan.file, 'utf8'), plan.source, 'blocked old plan must not write any file');
      }
      const apply = planPatches(copy, 'apply');
      assert.equal(apply.some(plan => plan.result !== plan.source), needsUpdate);
      const changed = applyPlan(apply, path.join(copy, 'backups'));
      assert.equal(changed > 0, needsUpdate);
      if (mode === '0.3.6-beta.1' && baseHash === delta.resultSha256) assert.equal(changed, 1, 'already-current settings/other artifacts stay byte-identical');
      if (isRecent(mode)) {
        assert.equal(before.find(plan => plan.name === 'settings-models.patch.json').updateAvailable, true);
        assert.equal(before.find(plan => plan.name === 'pi-ai.patch.json').updateAvailable, true);
        assert.equal(changed, 2, `upgrading ${mode} updates settings and the capability-aware backend schema`);
      }
      const after = planPatches(copy, 'check');
      assert.ok(after.every(plan => plan.state === 'patched' && !plan.updateAvailable && plan.applySupported));
      const readyReport = doctor(); assert.equal(readyReport.status, 0, readyReport.stderr);
      assert.equal(JSON.parse(readyReport.stdout).diskPatchesReady, true);
      assert.equal(JSON.parse(readyReport.stdout).runtimeVerified, false);
      assert.equal(applyPlan(planPatches(copy, 'apply'), path.join(copy, 'backups')), 0);
      for (const plan of after) {
        const input = buildInputs.find(item => item.name === plan.name);
        const latest = candidates(input.artifact).find(candidate => candidate.baseSha256 === sha256(input.pristine) && candidate.current === true) ?? input.artifact;
        assert.equal(sha256(plan.source), latest.resultSha256);
      }
      if (baseHash === delta.resultSha256 && mode !== 'pristine' && !isRecent(mode)) {
        const backup = path.join(copy, 'backups', `dsh-llm-pi-ai-index.js-${delta.legacyResultSha256}.js`);
        assert.equal(sha256(fs.readFileSync(backup)), delta.legacyResultSha256, 'original uploaded legacy program is backed up exactly');
      }
      applyPlan(planPatches(copy, 'revert'), path.join(copy, 'backups'));
      for (const input of buildInputs) assert.equal(fs.readFileSync(path.join(copy, input.artifact.target), 'utf8'), input.pristine);
      for (const sentinel of sentinels) assert.equal(fs.readFileSync(sentinel.file, 'utf8'), sentinel.content);
    });
  }
  for (const plan of observed) assert.equal(fs.readFileSync(plan.file, 'utf8'), plan.source, 'real installed host must remain unchanged');
});
