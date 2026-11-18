import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planPatches, applyPlan, ARTIFACTS, sha256 } from '../scripts/native-patches.mjs';
import { structuralRevision, transformFragments } from '../scripts/structural-patches.mjs';

test('fragment edits preserve host additions inside a larger changed function', () => {
  const before = 'function call() {\n  const key = source.apiKey;\n  const url = source.url;\n  return send(key, url);\n}\n';
  const after = before.replace('const key = source.apiKey;', 'const key = selected.apiKey;').replace('send(key, url)', 'send(key, url, selected.id)');
  const host = before.replace('  const url', '  const headers = source.headers;\n  const url');
  const result = transformFragments(host, { replacements: [{ before, after }] });
  assert.ok(result.includes('const headers = source.headers;'));
  assert.ok(result.includes('selected.apiKey'));
  assert.equal(transformFragments(result, { replacements: [{ before, after }] }, true), host);
});

test('missing or ambiguous changed regions refuse instead of guessing', () => {
  const recipe = { replacements: [{ before: 'function read() { return source.apiKey; }', after: 'function read() { return selected.apiKey; }' }] };
  assert.throws(() => transformFragments('function other() { return headers; }', recipe), /missing or ambiguous/);
});

test('partly applied insertions are not treated as a pristine build', () => {
  const before = 'const firstLongSchemaAnchor = {\n  apiKey: "original credential value",\n};\nconst secondLongSchemaAnchor = {\n  apiKey: "other credential value",\n};\n';
  const first = '  keyEntryId: "first inserted entry",\n';
  const second = '  keyEntryId: "second inserted entry",\n';
  const partial = before.replace('original credential value",\n', 'original credential value",\n' + first);
  const after = partial.replace('other credential value",\n', 'other credential value",\n' + second);
  const recipe = { current: true, replacements: [{ before, after }] };
  assert.equal(structuralRevision(partial, [recipe]), undefined);
  assert.throws(() => transformFragments(partial, recipe), /insertion already present/);
  assert.equal(structuralRevision(before, [recipe]).latest, after);
  assert.equal(structuralRevision(after, [recipe]).latest, after);
  assert.equal(structuralRevision(after, [recipe]).original, before);
});

test('an already inserted prefix cannot be duplicated through a complete before anchor', () => {
  const before = 'export function readCredentialFromLongAnchor() {\n  return source.apiKey;\n}\n';
  const insertion = 'export function selectCredentialFromLongAnchor() {\n  return source.keyEntries;\n}\n';
  const after = insertion + before;
  const recipe = { current: true, replacements: [{ before, after }] };
  const rebuilt = after + '// unrelated host edit\n';
  assert.equal(structuralRevision(rebuilt, [recipe]).latest, rebuilt);
  assert.throws(() => transformFragments(rebuilt, recipe), /insertion already present/);
  assert.equal(structuralRevision(insertion + rebuilt, [recipe]), undefined);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fragment-fixture-'));
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.ok(path.basename(root).startsWith('dsh-fragment-fixture-')); fs.rmSync(root, { recursive: true }); });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }));
  const artifacts = path.join(root, 'recipes'); fs.mkdirSync(artifacts);
  const packages = ['dsh-llm-pi-ai', 'dsh-client-ui-settings-models', 'dsh-llm', 'dsh-llm', 'dsh-api-remotes'];
  const files = ['index.js', 'client.js', 'typert.host.js', 'typert.remote-client.js', 'client.js'];
  const before = 'export function request(source) {\n  const key = source.apiKey;\n  const url = source.url;\n  return send(key, url);\n}\n';
  const after = before.replace('source.apiKey', 'selected.apiKey').replace('send(key, url)', 'send(key, url, selected.id)');
  const host = before.replace('  const url', '  const headers = source.headers;\n  const url') + '// rebuilt mobile runtime\n';
  const targets = ARTIFACTS.map((name, i) => {
    const packageName = '@deepseek-ai/' + packages[i];
    const target = `node_modules/${packageName}/lib/${files[i]}`;
    const file = path.join(root, target); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, host);
    fs.writeFileSync(path.join(root, 'node_modules', packageName, 'package.json'), JSON.stringify({ name: packageName, version: '0.2.2-rc.1' }));
    fs.writeFileSync(path.join(artifacts, name), JSON.stringify({ packageName, target, version: '0.2.2-rc.1', baseSha256: sha256(before), resultSha256: sha256(after), replacements: [{ before, after }] }));
    return file;
  });
  return { root, artifacts, targets, host };
}

test('unknown builds use changed fragments without registering whole-file hashes', t => {
  const f = fixture(t);
  assert.ok(planPatches(f.root, 'check', f.artifacts).every(p => p.state === 'pristine' && p.compatibility === 'fragments'));
  assert.equal(applyPlan(planPatches(f.root, 'apply', f.artifacts), path.join(f.root, 'backups')), 5);
  assert.ok(f.targets.every(file => fs.readFileSync(file, 'utf8').includes('const headers = source.headers;')));
  assert.equal(applyPlan(planPatches(f.root, 'apply', f.artifacts), path.join(f.root, 'backups')), 0);
  applyPlan(planPatches(f.root, 'revert', f.artifacts), path.join(f.root, 'backups'));
  assert.ok(f.targets.every(file => fs.readFileSync(file, 'utf8') === f.host));
});

test('known legacy bases without a current hash mapping upgrade through compatible code', t => {
  const f = fixture(t), name = ARTIFACTS[0];
  const manifestFile = path.join(f.artifacts, name);
  const current = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const legacyOutput = f.host.replace('source.apiKey', 'oldSelection.apiKey');
  const manifest = { ...current, current: true, requiresCurrent: true, variants: [{
    baseSha256: sha256(f.host), resultSha256: sha256(legacyOutput),
    replacements: [{ before: f.host, after: legacyOutput }],
  }] };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  for (const observed of [f.host, legacyOutput]) {
    fs.writeFileSync(f.targets[0], observed);
    const plan = planPatches(f.root, 'apply', f.artifacts)[0];
    assert.equal(plan.applySupported, true);
    assert.equal(plan.compatibility, 'fragments');
    assert.ok(plan.result.includes('selected.apiKey'));
    assert.ok(plan.result.includes('send(key, url, selected.id)'));
    assert.ok(plan.result.includes('const headers = source.headers;'));
    applyPlan(planPatches(f.root, 'apply', f.artifacts), path.join(f.root, 'backups'));
    assert.equal(applyPlan(planPatches(f.root, 'apply', f.artifacts), path.join(f.root, 'backups')), 0);
    applyPlan(planPatches(f.root, 'revert', f.artifacts), path.join(f.root, 'backups'));
    assert.equal(fs.readFileSync(f.targets[0], 'utf8'), f.host);
  }
});

test('an exact legacy recipe preserves native current-looking code and restores only its own change', t => {
  const f = fixture(t);
  const manifestFile = path.join(f.artifacts, ARTIFACTS[0]);
  const original = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const oldFn = 'export function route() { return "old"; }';
  const newFn = 'export function route() { return "new"; }';
  const primaryBase = oldFn + '\nexport const legacyFeature = false;\n// old host build\n';
  const primaryOutput = primaryBase.replace(oldFn, newFn);
  const legacyBase = newFn + '\nexport const legacyFeature = false;\n// newer host has route natively\n';
  const legacyOutput = legacyBase.replace('legacyFeature = false', 'legacyFeature = true');
  fs.writeFileSync(manifestFile, JSON.stringify({ ...original, current: true, requiresCurrent: true,
    baseSha256: sha256(primaryBase), resultSha256: sha256(primaryOutput), replacements: [{ before: oldFn, after: newFn }],
    variants: [{ baseSha256: sha256(legacyBase), resultSha256: sha256(legacyOutput),
      replacements: [{ before: 'legacyFeature = false', after: 'legacyFeature = true' }] }] }));
  for (const observed of [legacyBase, legacyOutput]) {
    fs.writeFileSync(f.targets[0], observed);
    assert.equal(planPatches(f.root, 'check', f.artifacts)[0].applySupported, false);
    assert.equal(planPatches(f.root, 'revert', f.artifacts)[0].result, legacyBase);
    assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /No verified current patch/);
    assert.equal(fs.readFileSync(f.targets[0], 'utf8'), observed);
    applyPlan(planPatches(f.root, 'revert', f.artifacts), path.join(f.root, 'backups'));
    assert.equal(fs.readFileSync(f.targets[0], 'utf8'), legacyBase);
  }
});

test('one missing changed region blocks all five targets before backups or writes', t => {
  const f = fixture(t);
  fs.writeFileSync(f.targets[4], 'export const unrelated = true;');
  const before = f.targets.map(file => fs.readFileSync(file, 'utf8'));
  assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /unrecognized content/);
  assert.deepEqual(f.targets.map(file => fs.readFileSync(file, 'utf8')), before);
  assert.equal(fs.existsSync(path.join(f.root, 'backups')), false);
});

test('generated discovery variants all receive keyEntryId while trailing headers and other declarations survive', t => {
  const f = fixture(t);
  const recipe = JSON.parse(fs.readFileSync(new URL('../native/llm-typert.host.patch.json', import.meta.url), 'utf8'));
  const declaration = 'export interface LlmModelDiscoveryRequest {\n    provider?: string;\n    apiKey?: string;\n    headers?: Array<{ name: string; value: string; }>;\n}';
  const schemas = Array.from({ length: 4 }, (_, i) => `const discovery${i} = z.object({\n${recipe.replacements[0].before}\n});\nconst json${i} = {${recipe.replacements[1].before}};\n`).join('');
  const other = 'export interface OtherRequest {\n    apiKey?: string;\n}';
  const original = schemas + `export const tools = [{"declaration":${JSON.stringify(declaration)}},{"declaration":${JSON.stringify(other)}}];\n`;
  fs.writeFileSync(f.targets[2], original);
  fs.writeFileSync(path.join(f.artifacts, ARTIFACTS[2]), JSON.stringify(recipe));
  const plans = planPatches(f.root, 'apply', f.artifacts);
  const result = plans[2].result;
  assert.equal(result.split(recipe.replacements[0].after).length - 1, 4);
  assert.equal(result.split(recipe.replacements[1].after).length - 1, 4);
  assert.ok(result.includes(JSON.stringify(declaration.replace('    apiKey?: string;\n', '    apiKey?: string;\n    keyEntryId?: string;\n'))));
  assert.ok(result.includes(JSON.stringify(other)), 'unrelated declarations are unchanged');
  applyPlan(plans, path.join(f.root, 'backups'));
  assert.equal(applyPlan(planPatches(f.root, 'apply', f.artifacts), path.join(f.root, 'backups')), 0);
  applyPlan(planPatches(f.root, 'revert', f.artifacts), path.join(f.root, 'backups'));
  assert.equal(fs.readFileSync(f.targets[2], 'utf8'), original);
  fs.writeFileSync(f.targets[2], original.replace(recipe.replacements[0].before, recipe.replacements[0].after));
  assert.throws(() => planPatches(f.root, 'apply', f.artifacts), /unrecognized content/, 'partial schema patch must not be duplicated');
});

for (const [hostVersion, childVersion] of [['0.2.2-rc.1', '0.2.2-rc.1'], ['0.3.0-android.7+port.1', '0.4.0-mobile.2']])
for (const patched of [false, true]) test(`real host with custom headers and unrelated changes (${hostVersion}): ${patched ? 'already patched' : 'pristine'} roundtrip`, t => {
  if (!process.env.DSH_ROOT) return t.skip('Set DSH_ROOT; only temporary copies are modified');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fragments-'));
  t.after(() => { assert.equal(fs.realpathSync(tmp), tmp); assert.ok(path.basename(tmp).startsWith('dsh-fragments-')); fs.rmSync(tmp, { recursive: true }); });
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: hostVersion }));
  const known = planPatches(process.env.DSH_ROOT, patched ? 'apply' : 'revert');
  const originals = [];
  for (const plan of known) {
    const file = path.join(tmp, plan.artifact.target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules', plan.artifact.packageName, 'package.json'), JSON.stringify({ name: plan.artifact.packageName, version: childVersion }));
    let content = plan.result + '\n// custom mobile runtime build\n';
    // Mirrors an additive field next to the generated interrogation schema.
    if (plan.name === 'llm-typert.host.patch.json') content = content.replace('    apiKey?: string;', '    apiKey?: string;\\n    headers?: Array<{ name: string; value: string; }>;');
    fs.writeFileSync(file, content);
    originals.push(content);
  }
  const plans = planPatches(tmp, 'apply');
  assert.ok(plans.every(item => item.compatibility === 'fragments'));
  assert.ok(plans.every(item => item.hostVersion === hostVersion && item.installedVersion === childVersion));
  assert.ok(plans.every(item => item.state === (patched ? 'patched' : 'pristine')));
  applyPlan(plans, path.join(tmp, 'backups'));
  assert.ok(planPatches(tmp).every(item => item.state === 'patched'));
  assert.equal(applyPlan(planPatches(tmp, 'apply'), path.join(tmp, 'backups')), 0);
  if (!patched) {
    applyPlan(planPatches(tmp, 'revert'), path.join(tmp, 'backups'));
    assert.deepEqual(known.map(plan => fs.readFileSync(path.join(tmp, plan.artifact.target), 'utf8')), originals);
  } else {
    assert.deepEqual(known.map(plan => fs.readFileSync(path.join(tmp, plan.artifact.target), 'utf8')), originals);
  }
});
