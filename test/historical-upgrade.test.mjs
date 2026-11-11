import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARTIFACTS, applyPlan, planPatches, sha256, transformSource } from '../scripts/native-patches.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const readJson = relative => JSON.parse(fs.readFileSync(new URL('../' + relative, import.meta.url), 'utf8'));
const fixture = readJson('test/fixtures/historical-releases.json');
const currentArtifacts = new Map(ARTIFACTS.map(name => [name, readJson('native/' + name)]));
// A revision's current flag must not be inherited from its primary manifest.
const candidates = artifact => [artifact, ...(artifact.variants ?? []).map(variant => ({ ...artifact, ...variant, current: variant.current === true }))];
const historicalRevision = (artifact, base) => {
  const matches = candidates(artifact).filter(revision => revision.baseSha256 === base);
  return matches.find(revision => revision.current === true) ?? matches[0];
};
const latestRevision = (artifact, base) => {
  const matches = candidates(artifact).filter(revision => revision.baseSha256 === base);
  const current = matches.filter(revision => revision.current === true);
  assert.ok(current.length <= 1, 'current revision is unique per pristine build');
  if (artifact.requiresCurrent) assert.equal(current.length, 1, 'a verified latest revision is required');
  const revision = current[0] ?? matches[0];
  assert.ok(revision, 'current manifest recognizes the pristine build');
  return revision;
};
const gitEnvironment = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
const git = args => spawnSync('git', ['--no-pager', ...args], {
  cwd: repository, env: gitEnvironment, maxBuffer: 8 * 1024 * 1024,
});
const historyCache = new Map();
function historicalManifests(release) {
  if (historyCache.has(release.gitCommit)) return historyCache.get(release.gitCommit);
  const commit = git(['cat-file', '-e', release.gitCommit + '^{commit}']);
  if (commit.error?.code === 'ENOENT' || !commit.error && commit.status !== 0) {
    const unavailable = { skip: `Local git history unavailable for ${release.version} (${release.gitCommit}); no fetch attempted` };
    historyCache.set(release.gitCommit, unavailable);
    return unavailable;
  }
  assert.ifError(commit.error);
  assert.equal(commit.status, 0);
  const manifests = new Map();
  for (const name of ARTIFACTS) {
    const object = `${release.gitCommit}:native/${name}`;
    const exists = git(['cat-file', '-e', object]);
    assert.ifError(exists.error);
    if (exists.status !== 0) {
      const unavailable = { skip: `Local git manifest object unavailable: ${object}; no fetch attempted` };
      historyCache.set(release.gitCommit, unavailable);
      return unavailable;
    }
    const result = git(['show', '--no-ext-diff', '--no-textconv', object]);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.equal(sha256(result.stdout), release.manifestSha256[name], `${release.version}: fixed manifest bytes must match the audited archive/git identity`);
    const artifact = JSON.parse(result.stdout.toString('utf8'));
    const latest = currentArtifacts.get(name);
    for (const key of ['target', 'packageName', 'version']) assert.equal(artifact[key], latest[key], `${release.version}: ${name} ${key}`);
    manifests.set(name, artifact);
  }
  const result = { manifests };
  historyCache.set(release.gitCommit, result);
  return result;
}

// This evidence test runs without DSH_ROOT. Shallow/exported checkouts explicitly
// skip missing immutable git objects rather than guessing historical literals.
test('pinned historical manifests retain every audited archive tuple', async t => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.releases.length, 15);
  assert.equal(new Set(fixture.releases.map(release => release.version)).size, 15);
  const archived = fixture.releases.filter(release => release.sourceKind !== 'git-tag-only');
  assert.equal(archived.length, fixture.archiveAudit.releaseCount);
  let archiveCount = 0, manifestCount = 0, tupleCount = 0;
  const identities = new Set();
  for (const release of fixture.releases) {
    await t.test(release.version, child => {
      assert.match(release.gitCommit, /^[0-9a-f]{40}$/);
      assert.equal(typeof release.autoPatchOnLoad, 'boolean');
      assert.deepEqual(Object.keys(release.manifestSha256).sort(), [...ARTIFACTS].sort());
      for (const hash of Object.values(release.manifestSha256)) assert.match(hash, /^[0-9a-f]{64}$/);
      if (release.sourceKind === 'git-tag-only') {
        assert.equal(release.archiveSha256, null, 'git-only evidence must not imply a downloaded archive');
        assert.equal(release.sourceUrl, `https://github.com/betsunninda9-lgtm/dsh-model-groups/tree/${release.gitCommit}/native`);
      } else {
        assert.match(release.archiveSha256, /^[0-9a-f]{64}$/);
        const url = release.sourceKind === 'public-npm-tarball'
          ? `https://registry.npmjs.org/dsh-model-groups/-/dsh-model-groups-${release.version}.tgz`
          : `https://github.com/betsunninda9-lgtm/dsh-model-groups/releases/download/v${release.version}/dsh-model-groups-${release.version}.tgz`;
        assert.equal(release.sourceUrl, url);
      }
      const history = historicalManifests(release);
      if (history.skip) { child.skip(history.skip); return; }
      for (const [name, artifact] of history.manifests) {
        for (const revision of candidates(artifact)) {
          const retained = candidates(currentArtifacts.get(name)).find(value => value.baseSha256 === revision.baseSha256 && value.resultSha256 === revision.resultSha256);
          assert.ok(retained, `${release.version}: ${name} legacy whole-file identity retained`);
          assert.deepEqual(retained.replacements, revision.replacements, `${release.version}: ${name} retains ORIGINAL ordered literals, not latest literals with old hashes`);
          if (release.sourceKind !== 'git-tag-only') {
            tupleCount++;
            identities.add([name, revision.baseSha256, revision.resultSha256, sha256(JSON.stringify(revision.replacements))].join(':'));
          }
        }
      }
      if (release.sourceKind !== 'git-tag-only') { archiveCount++; manifestCount += history.manifests.size; }
    });
  }
  if (archiveCount === archived.length) {
    assert.equal(manifestCount, fixture.archiveAudit.manifestCount);
    assert.equal(tupleCount, fixture.archiveAudit.tupleOccurrences);
    assert.equal(identities.size, fixture.archiveAudit.distinctTuples);
  }
  t.diagnostic(`Verified ${archiveCount}/${archived.length} archived releases, ${manifestCount} manifest files, ${tupleCount} retained tuple occurrences; no archives downloaded during tests`);
});

function pristineProgram(source, artifact) {
  const hash = sha256(source), revisions = candidates(artifact);
  const patched = revisions.filter(revision => revision.resultSha256 === hash);
  assert.ok(patched.length <= 1, 'explicit program must have an unambiguous patched identity');
  const revision = patched[0] ?? revisions.find(value => value.baseSha256 === hash);
  assert.ok(revision, 'explicit program must match a complete verified pristine/patched SHA256');
  const pristine = patched.length ? transformSource(source, revision, true) : source;
  assert.equal(sha256(pristine), revision.baseSha256);
  const forward = transformSource(pristine, revision);
  if (patched.length) assert.equal(forward, source, 'complete explicit patched input roundtrips exactly');
  return pristine;
}
function snapshotTree(root) {
  const files = new Map();
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      assert.equal(fs.realpathSync(file), file, 'fixture tree cannot contain symlinks');
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else { assert.ok(stat.isFile()); files.set(path.relative(root, file), fs.readFileSync(file)); }
    }
  };
  walk(root);
  return files;
}

// Only explicit, manifest-owned PROGRAM inputs are read. Never read installed
// configuration, credentials, sessions or backups. Every write is under temp.
test('every historical release directly upgrades five real program copies, preserves data and exactly reverts', async t => {
  if (!process.env.DSH_ROOT) { t.skip('Set explicit DSH_ROOT; optional PI_AI_SOURCES supplies additional code-only builds. No default live installation is read'); return; }
  const livePrograms = new Map();
  t.after(() => {
    for (const [file, before] of livePrograms) assert.deepEqual(fs.readFileSync(file), before, 'explicit live program input must remain byte-identical');
  });
  const readProgram = file => {
    const resolved = fs.realpathSync(file);
    assert.ok(fs.statSync(resolved).isFile(), 'explicit program input is a regular file');
    const bytes = fs.readFileSync(resolved), source = bytes.toString('utf8');
    assert.deepEqual(Buffer.from(source), bytes, 'program input is lossless UTF-8');
    if (livePrograms.has(resolved)) assert.deepEqual(bytes, livePrograms.get(resolved));
    else livePrograms.set(resolved, bytes);
    return source;
  };
  const installed = fs.realpathSync(process.env.DSH_ROOT);
  const inputs = ARTIFACTS.map(name => {
    const artifact = currentArtifacts.get(name), file = path.resolve(installed, artifact.target);
    assert.ok(file.startsWith(installed + path.sep));
    assert.equal(fs.realpathSync(file), file, 'live manifest-owned program path is canonical');
    return { name, artifact, pristine: pristineProgram(readProgram(file), artifact) };
  });
  const pi = inputs.find(input => input.name === 'pi-ai.patch.json');
  const delta = readJson('test/fixtures/pi-ai/credential-cancellation.delta.json');
  const bases = new Map();
  const addBase = source => {
    const hash = sha256(source);
    assert.ok(candidates(pi.artifact).some(revision => revision.baseSha256 === hash));
    if (bases.has(hash)) assert.equal(bases.get(hash), source);
    bases.set(hash, source);
  };
  addBase(pi.pristine);
  for (const file of (process.env.PI_AI_SOURCES ?? '').split(path.delimiter).filter(Boolean)) addBase(pristineProgram(readProgram(file), pi.artifact));
  // The cancellation delta is reversible code-only evidence. Recovering 070c
  // from an explicitly supplied complete c87f/0a99 program also checks its FULL
  // hash, then regenerate 0a99 with the normal forward delta and check both.
  if (bases.has(delta.resultSha256)) addBase(transformSource(bases.get(delta.resultSha256), delta, true));
  if (bases.has(delta.baseSha256)) addBase(transformSource(bases.get(delta.baseSha256), delta));
  const expectedBases = [...new Set(candidates(pi.artifact).map(revision => revision.baseSha256))].sort();
  const tempParent = fs.realpathSync(os.tmpdir());
  const prefix = 'dsh-historical-upgrade-';
  const temp = fs.mkdtempSync(path.join(tempParent, prefix));
  t.after(() => {
    const resolved = fs.realpathSync(temp);
    if (resolved !== temp || path.dirname(resolved) !== tempParent || !path.basename(resolved).startsWith(prefix)) throw new Error('Unsafe historical fixture cleanup');
    fs.rmSync(resolved, { recursive: true });
  });
  const writeFixture = (file, content) => {
    const absolute = path.resolve(file);
    assert.ok(absolute.startsWith(temp + path.sep), 'all generated files must stay under the owned temp root');
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    assert.equal(fs.realpathSync(path.dirname(absolute)), path.dirname(absolute));
    fs.writeFileSync(absolute, content, { flag: 'wx' });
  };
  let passed = 0, missing = 0, unsupported = 0, historyMissing = 0;
  for (const release of fixture.releases) for (const base of expectedBases) {
    await t.test(`${release.version} / ${base} → current → exact pristine`, child => {
      const history = historicalManifests(release);
      if (history.skip) { historyMissing++; child.skip(history.skip); return; }
      if (!bases.has(base)) { missing++; child.skip(`Complete pi-ai source for ${base} not explicitly supplied; no guessed fixture`); return; }
      const buildInputs = inputs.map(input => input.name === pi.name ? { ...input, pristine: bases.get(base) } : input);
      const oldRevisions = buildInputs.map(input => historicalRevision(history.manifests.get(input.name), sha256(input.pristine)));
      if (oldRevisions.some(revision => !revision)) {
        unsupported++;
        child.skip(`${release.version} did not support this exact pristine build; no historical install fabricated`);
        return;
      }
      const copy = path.join(temp, `${release.version}-${base}`);
      fs.mkdirSync(copy);
      writeFixture(path.join(copy, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
      const metadataWritten = new Set();
      for (const [i, input] of buildInputs.entries()) {
        if (!metadataWritten.has(input.artifact.packageName)) {
          metadataWritten.add(input.artifact.packageName);
          writeFixture(path.join(copy, 'node_modules', input.artifact.packageName, 'package.json'), JSON.stringify({ name: input.artifact.packageName, version: input.artifact.version }));
        }
        const old = oldRevisions[i];
        assert.equal(old.baseSha256, sha256(input.pristine));
        const source = transformSource(input.pristine, old);
        assert.equal(sha256(source), old.resultSha256, 'fixture matches the ACTUAL historical release output');
        writeFixture(path.join(copy, input.artifact.target), source);
      }
      const keyIds = ['key-alpha', 'key-bravo'];
      const sentinels = new Map([
        ['config.yaml', JSON.stringify({ profile: 'synthetic-profile', multiKey: true, keyEntries: keyIds.map(id => ({ id, label: id, models: ['model-a'] })), unknownField: { keep: true } }) + '\n'],
        ['.credentials.yaml', JSON.stringify({ records: keyIds.map(id => ({ id, value: 'synthetic-not-a-real-secret-' + id })) }) + '\n'],
        ['sessions/example.jsonl', JSON.stringify({ provider: 'synthetic-provider', model: '@dsh-key/key-alpha/model-a', keyEntryId: keyIds[0], history: 'synthetic-history-preserved' }) + '\n'],
      ]);
      for (const [relative, source] of sentinels) writeFixture(path.join(copy, relative), source);
      const assertSentinels = () => {
        for (const [relative, source] of sentinels) assert.equal(fs.readFileSync(path.join(copy, relative), 'utf8'), source, 'configuration/credential/key-ID/session sentinel is byte-identical');
      };
      const beforeTree = snapshotTree(copy);
      const before = planPatches(copy, 'check');
      assert.equal(before.length, 5);
      assert.ok(before.every(plan => plan.source === plan.result && plan.state === 'patched' && plan.applySupported));
      assert.deepEqual(snapshotTree(copy), beforeTree, 'check never writes');
      const apply = planPatches(copy, 'apply');
      assert.equal(apply.length, 5);
      assert.deepEqual(snapshotTree(copy), beforeTree, 'planning never writes');
      const changed = apply.filter(plan => plan.source !== plan.result);
      assert.ok(changed.length > 0, 'historical release has an actual direct update');
      const backups = path.join(copy, 'backups');
      assert.equal(applyPlan(apply, backups), changed.length, 'one current five-file plan performs the entire direct upgrade');
      for (const plan of changed) {
        const backup = path.join(backups, `${plan.artifact.packageName.slice('@deepseek-ai/'.length)}-${path.basename(plan.file)}-${sha256(plan.source)}.js`);
        assert.equal(fs.readFileSync(backup, 'utf8'), plan.source, 'backup preserves the complete observed old program');
        assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
      }
      const after = planPatches(copy, 'check');
      assert.ok(after.every(plan => plan.state === 'patched' && !plan.updateAvailable && plan.applySupported));
      for (const [i, input] of buildInputs.entries()) {
        const latest = latestRevision(input.artifact, sha256(input.pristine));
        assert.equal(sha256(after[i].source), latest.resultSha256, 'every program reaches its verified current output');
      }
      assertSentinels();
      const upgradedTree = snapshotTree(copy);
      assert.equal(applyPlan(planPatches(copy, 'apply'), backups), 0, 'second apply is idempotent');
      assert.deepEqual(snapshotTree(copy), upgradedTree, 'idempotent apply creates no additional files');
      assert.equal(applyPlan(planPatches(copy, 'revert'), backups), 5);
      for (const input of buildInputs) assert.equal(fs.readFileSync(path.join(copy, input.artifact.target), 'utf8'), input.pristine, 'revert restores this build\'s exact original program');
      assertSentinels();
      // A late fifth-file conflict must prevent even earlier valid targets from
      // being patched; original data AND existing backups remain untouched.
      const last = path.join(copy, buildInputs.at(-1).artifact.target);
      fs.appendFileSync(last, '\n// synthetic unknown content; must fail closed\n');
      const conflictedTree = snapshotTree(copy);
      assert.throws(() => applyPlan(planPatches(copy, 'apply'), backups), /Refusing unrecognized content/);
      assert.deepEqual(snapshotTree(copy), conflictedTree, 'unknown content blocks the entire batch without writes');
      assertSentinels();
      passed++;
    });
  }
  t.diagnostic(`Complete five-program direct-upgrade cases passed=${passed}; skipped missing-source=${missing}, historical-unsupported=${unsupported}, missing-history=${historyMissing}; explicit input programs=${livePrograms.size}`);
});
