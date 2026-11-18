import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARTIFACTS, applyPlan, inspectPatches, planPatches, sha256 } from '../scripts/native-patches.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inspection-cache-'));
  const artifacts = path.join(root, 'recipes'); fs.mkdirSync(artifacts);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const files = ARTIFACTS.map((name, i) => {
    const packageName = i === 0 ? '@deepseek-ai/dsh-llm-pi-ai' : i === 1 ? '@deepseek-ai/dsh-client-ui-settings-models' : i === 4 ? '@deepseek-ai/dsh-api-remotes' : '@deepseek-ai/dsh-llm';
    const target = `node_modules/${packageName}/lib/test-${i}.js`;
    const file = path.join(root, target); fs.mkdirSync(path.dirname(file), { recursive: true });
    const pkg = path.join(root, 'node_modules', packageName, 'package.json');
    fs.writeFileSync(pkg, JSON.stringify({ name: packageName, version: '0.2.2-rc.1' }));
    const source = `before-${i}`; fs.writeFileSync(file, source);
    const manifest = path.join(artifacts, name);
    fs.writeFileSync(manifest, JSON.stringify({ version: '0.2.2-rc.1', packageName, target, baseSha256: sha256(source), resultSha256: sha256(`after-${i}`), replacements: [{ before: source, after: `after-${i}` }] }));
    return { file, pkg, source, manifest };
  });
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.ok(path.basename(root).startsWith('dsh-inspection-cache-')); fs.rmSync(root, { recursive: true }); });
  return { root, artifacts, files, inspect: () => inspectPatches(root, artifacts) };
}

test('unchanged read-only inspection returns a defensive snapshot without reading content again', t => {
  const f = fixture(t), first = f.inspect();
  assert.equal(first.files[0].state, 'pristine');
  first.files[0].state = 'patched'; first.files.length = 1;
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (...args) { reads++; return read.apply(this, args); };
  let second;
  try { second = f.inspect(); } finally { fs.readFileSync = read; }
  assert.equal(reads, 0, 'warm status performs metadata checks only');
  assert.equal(second.files.length, 5); assert.equal(second.files[0].state, 'pristine');
});

test('same-size external write with restored mtime invalidates cached inspection', t => {
  const f = fixture(t), item = f.files[0]; f.inspect();
  const stat = fs.statSync(item.file);
  fs.writeFileSync(item.file, 'broken-0'); fs.utimesSync(item.file, stat.atime, stat.mtime);
  assert.equal(f.inspect().files[0].code, 'unrecognized_content');
  fs.writeFileSync(item.file, item.source);
  assert.equal(f.inspect().files[0].state, 'pristine');
});

test('manifest, native package, host package, and missing target invalidate cached observations', t => {
  const f = fixture(t), item = f.files[0]; f.inspect();
  const manifest = JSON.parse(fs.readFileSync(item.manifest, 'utf8'));
  fs.writeFileSync(item.manifest, JSON.stringify({ ...manifest, baseSha256: 'a'.repeat(64) }));
  assert.equal(f.inspect().files[0].code, 'unrecognized_content');
  fs.writeFileSync(item.manifest, JSON.stringify(manifest)); assert.equal(f.inspect().files[0].state, 'pristine');
  const pkg = JSON.parse(fs.readFileSync(item.pkg, 'utf8'));
  fs.writeFileSync(item.pkg, JSON.stringify({ ...pkg, version: '0.2.3' }));
  assert.equal(f.inspect().files[0].code, 'not_applied');
  assert.equal(f.inspect().files[0].installedVersion, '0.2.3');
  fs.writeFileSync(item.pkg, JSON.stringify(pkg));
  fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.3' }));
  assert.equal(f.inspect().hostVersion, '0.2.3');
  assert.equal(f.inspect().files[0].code, 'not_applied');
  fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  assert.equal(f.inspect().files[0].state, 'pristine');
  assert.equal(fs.realpathSync(item.file), item.file); fs.unlinkSync(item.file);
  assert.equal(f.inspect().files[0].code, 'target_unavailable');
  fs.writeFileSync(item.file, item.source); assert.equal(f.inspect().files[0].state, 'pristine');
});

test('manifest target changes replace the cached dependency set', t => {
  const f = fixture(t), item = f.files[0]; f.inspect();
  const manifest = JSON.parse(fs.readFileSync(item.manifest, 'utf8'));
  const target = manifest.target.replace('test-0.js', 'moved-0.js');
  const moved = path.join(f.root, target); fs.writeFileSync(moved, item.source);
  fs.writeFileSync(item.manifest, JSON.stringify({ ...manifest, target }));
  assert.equal(f.inspect().files[0].state, 'pristine');
  fs.writeFileSync(moved, 'broken-0');
  assert.equal(f.inspect().files[0].code, 'unrecognized_content');
});

test('replaced symlink targets cannot reuse a regular-file ready status', t => {
  const f = fixture(t), item = f.files[0]; f.inspect();
  const alternate = path.join(f.root, 'alternate.js'); fs.writeFileSync(alternate, item.source);
  assert.equal(fs.realpathSync(item.file), item.file); fs.unlinkSync(item.file); fs.symlinkSync(alternate, item.file);
  assert.equal(f.inspect().files[0].code, 'target_unavailable');
});

test('inspection cache cannot authorize writes or conceal a concurrent program edit', t => {
  const f = fixture(t); f.inspect(); f.inspect();
  const plans = planPatches(f.root, 'apply', f.artifacts);
  fs.writeFileSync(f.files[0].file, 'broken-0');
  assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /unrecognized content/);
  assert.throws(() => applyPlan(plans, path.join(f.root, 'backups')), /Concurrent native edit/);
  assert.equal(fs.existsSync(path.join(f.root, 'backups')), false);
  assert.equal(f.inspect().files[0].code, 'unrecognized_content');
});
