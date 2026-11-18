import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compatibilitySnapshot } from '../src/compatibility.js';
import { structuralRevision, diagnoseStructuralRevision } from './structural-patches.mjs';
import { discoveryRecipes } from './discovery-recipes.mjs';
import { settingsRecipes, SettingsRecipeAmbiguity } from './settings-recipes.mjs';
import { spawnSync } from 'node:child_process';

export const ARTIFACTS = ['pi-ai.patch.json', 'settings-models.patch.json', 'llm-typert.host.patch.json', 'llm-typert.remote-client.patch.json', 'api-remotes.patch.json'];
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = source => crypto.createHash('sha256').update(source).digest('hex');
const inside = (root, target) => target.startsWith(root + path.sep);
const structuralTargets = new Set([
  'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
  'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
  'node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js',
  'node_modules/@deepseek-ai/dsh-llm/lib/typert.remote-client.js',
  'node_modules/@deepseek-ai/dsh-api-remotes/lib/client.js',
]);
// Generated request declarations may gain fields after apiKey. Match the named
// interface string rather than requiring apiKey to be the last interface member.
function declarationRecipes(source, candidates) {
  if (candidates[0]?.target !== 'node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js') return candidates;
  const replacements = [];
  for (const match of source.matchAll(/"declaration"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    const declaration = JSON.parse(match[1]);
    if (!declaration.startsWith('export interface LlmModelDiscoveryRequest {\n')) continue;
    const anchor = '    apiKey?: string;\n';
    const field = '    keyEntryId?: string;\n';
    if (declaration.split(anchor).length !== 2 || declaration.split('keyEntryId').length > 2) return candidates;
    if (declaration.includes('keyEntryId') && !declaration.includes(field)) return candidates;
    const original = declaration.replace(field, '');
    replacements.push({ before: JSON.stringify(original), after: JSON.stringify(declaration.includes(field) ? declaration : original.replace(anchor, anchor + field)) });
  }
  if (!replacements.length) return candidates;
  return candidates.map(candidate => ({ ...candidate, replacements: candidate.replacements.flatMap(replacement =>
    replacement.before === '    apiKey?: string;\\n}' && replacement.after === '    apiKey?: string;\\n    keyEntryId?: string;\\n}'
      ? [...new Map(replacements.map(item => [item.before, { ...replacement, ...item }])).values()] : [replacement]) }));
}
const structuralCache = new Map();
const structuralFailures = new WeakMap();
function preparedRecipes(source, candidates) {
  const indexed = candidates.map(candidate => ({ ...candidate, replacements: candidate.replacements.map((replacement, recipeReplacementIndex) => ({ ...replacement, recipeReplacementIndex })) }));
  return settingsRecipes(source, discoveryRecipes(source, declarationRecipes(source, indexed)));
}
function matchingFailure(error, source, prepared, knownOriginal) {
  const report = diagnoseStructuralRevision(source, prepared, { knownOriginal });
  const mapped = report.diagnostics.map(item => ({ ...item, replacementIndex: item.replacementIndex === null ? null
    : prepared[item.recipeIndex]?.replacements[item.replacementIndex]?.recipeReplacementIndex ?? null }));
  const priority = phase => ['target_forward', 'target_roundtrip', 'resolve'].includes(phase) ? 0 : 1;
  structuralFailures.set(error, [...new Map(mapped.map(item => [JSON.stringify(item), item])).values()]
    .sort((a, b) => priority(a.phase) - priority(b.phase)).slice(0, 16));
  return error;
}
function compatibleRevision(source, candidates, knownOriginal = false) {
  const key = sha256(JSON.stringify([source, candidates, knownOriginal]));
  if (structuralCache.has(key)) return structuralCache.get(key);
  let prepared;
  try { prepared = preparedRecipes(source, candidates); }
  catch (cause) {
    if (!(cause instanceof SettingsRecipeAmbiguity)) throw cause;
    const error = new Error('Ambiguous structural patch revision');
    structuralFailures.set(error, [{ recipeIndex: null, replacementIndex: null, phase: 'resolve', code: 'REVISION_AMBIGUOUS', candidateCount: null }]);
    throw error;
  }
  let revision;
  try { revision = structuralRevision(source, prepared, { knownOriginal }); }
  catch (error) { throw matchingFailure(error, source, prepared, knownOriginal); }
  if (!revision) throw matchingFailure(new Error(`Refusing unrecognized content: ${candidates[0].target}`), source, prepared, knownOriginal);
  for (const content of new Set([revision.original, revision.latest])) {
    const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: content, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
    if (check.status !== 0) {
      const error = new Error('Structural patch syntax check failed');
      structuralFailures.set(error, [{ recipeIndex: null, replacementIndex: null, phase: 'syntax', code: 'SYNTAX_CHECK_FAILED', candidateCount: null }]);
      throw error;
    }
  }
  if (structuralCache.size >= 32) structuralCache.delete(structuralCache.keys().next().value);
  structuralCache.set(key, revision);
  return revision;
}

export function transformSource(source, artifact, reverse = false) {
  let result = source;
  const replacements = reverse ? [...artifact.replacements].reverse() : artifact.replacements;
  for (const replacement of replacements) {
    const before = reverse ? replacement.after : replacement.before;
    const after = reverse ? replacement.before : replacement.after;
    if (typeof before !== 'string' || before.length === 0 || typeof after !== 'string') throw new Error('Invalid literal replacement');
    if (!result.includes(before)) throw new Error('Patch source did not match; no files written');
    result = result.split(before).join(after);
  }
  const expected = reverse ? artifact.baseSha256 : artifact.resultSha256;
  if (sha256(result) !== expected) throw new Error('Patch result hash mismatch; no files written');
  return result;
}

/** Validate ALL files before any modification. Check mode is read-only. */
export function planPatches(dshRoot, mode = 'check', artifactDirectory = path.join(pluginRoot, 'native')) {
  return planPatchFiles(dshRoot, mode, artifactDirectory, ARTIFACTS);
}
function planPatchFiles(dshRoot, mode, artifactDirectory, names) {
  if (!['check', 'apply', 'revert'].includes(mode)) throw new Error('Unknown patch mode');
  const root = fs.realpathSync(dshRoot);
  const inner = path.join(root, 'node_modules/@deepseek-ai/dsh/package.json');
  const dsh = JSON.parse(fs.readFileSync(fs.existsSync(inner) ? inner : path.join(root, 'package.json'), 'utf8'));
  if (dsh.name !== '@deepseek-ai/dsh') throw new Error('Unexpected DSH host package');
  const seen = new Set();
  return names.map(name => {
    let artifact = JSON.parse(fs.readFileSync(path.join(artifactDirectory, name), 'utf8'));
    // Recipe versions identify their historical source, not supported host versions.
    if (typeof artifact.version !== 'string' || !artifact.version.trim() || !/^@deepseek-ai\/dsh-[a-z-]+$/.test(artifact.packageName)) throw new Error('Unsupported patch package/version');
    if (!Array.isArray(artifact.replacements) || artifact.replacements.length === 0 || !/^[0-9a-f]{64}$/.test(artifact.baseSha256) || !/^[0-9a-f]{64}$/.test(artifact.resultSha256)) throw new Error('Invalid patch manifest');
    const prefix = `node_modules/${artifact.packageName}/`;
    if (typeof artifact.target !== 'string' || !artifact.target.startsWith(prefix) || artifact.target.includes('..') || artifact.target.includes('\\')) throw new Error('Unsafe patch target');
    const file = path.resolve(root, artifact.target);
    if (!inside(root, file) || fs.realpathSync(file) !== file || !fs.statSync(file).isFile() || seen.has(file)) throw new Error('Unexpected target path or duplicate patch');
    seen.add(file);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', artifact.packageName, 'package.json'), 'utf8'));
    if (pkg.name !== artifact.packageName) throw new Error('Installed native package identity mismatch');
    const source = fs.readFileSync(file, 'utf8');
    const hash = sha256(source);
    const primary = artifact;
    if (artifact.variants !== undefined && (!Array.isArray(artifact.variants) || artifact.variants.some(variant => !/^[0-9a-f]{64}$/.test(variant.baseSha256) || !/^[0-9a-f]{64}$/.test(variant.resultSha256) || (variant.replacements !== undefined && !Array.isArray(variant.replacements))))) throw new Error('Invalid patch variants');
    if (primary.current !== undefined && typeof primary.current !== 'boolean' || primary.variants?.some(variant => variant.current !== undefined && typeof variant.current !== 'boolean')) throw new Error('Invalid current patch marker');
    if (primary.requiresCurrent !== undefined && typeof primary.requiresCurrent !== 'boolean') throw new Error('Invalid required-current patch marker');
    // current belongs to a revision, not the shared package metadata. Do not
    // inherit primary.current onto legacy revisions when merging their fields.
    const candidates = [primary, ...(primary.variants || []).map(variant => ({ ...primary, ...variant, current: variant.current === true }))];
    const currentByBase = new Map();
    for (const candidate of candidates) {
      if (candidate.current !== true) continue;
      if (currentByBase.has(candidate.baseSha256)) throw new Error('Ambiguous current patch variant');
      currentByBase.set(candidate.baseSha256, candidate);
    }
    // A shared pristine base is intentional for legacy revisions. Prefer current
    // output, but never guess between two different recognized patched sources.
    const patchedMatches = candidates.filter(candidate => hash === candidate.resultSha256);
    if (patchedMatches.length > 1) throw new Error('Ambiguous patch variant');
    artifact = patchedMatches[0] || candidates.find(candidate => hash === candidate.baseSha256) || primary;
    const state = hash === artifact.baseSha256 ? 'pristine' : hash === artifact.resultSha256 ? 'patched' : 'modified';
    const exactSupported = primary.requiresCurrent !== true || currentByBase.has(artifact.baseSha256);
    if (state === 'modified' || !exactSupported) {
      let compatible;
      try {
        if (structuralTargets.has(primary.target)) {
          if (state === 'modified') compatible = compatibleRevision(source, candidates);
          else {
            const original = state === 'patched' ? transformSource(source, artifact, true) : source;
            const observedPatched = transformSource(original, artifact);
            if (state === 'patched' && observedPatched !== source) throw new Error('Patch roundtrip mismatch');
            const upgraded = compatibleRevision(original, candidates, true);
            if (upgraded) compatible = { ...upgraded, state };
          }
        }
      }
      catch (error) {
        // A historical exact recipe remains restorable even when no current
        // structural recipe fits. Unknown builds have no such exact fallback.
        if (state === 'modified') throw error;
      }
      if (compatible) {
        const { original, latest } = compatible;
        return { name, artifact: { ...primary, baseSha256: sha256(original), resultSha256: sha256(latest) }, file, source,
          result: mode === 'apply' ? latest : mode === 'revert' ? original : source,
          state: compatible.state, updateAvailable: compatible.state === 'patched' && source !== latest,
          applySupported: true, compatibility: 'fragments', hostVersion: dsh.version, installedVersion: pkg.version,
          observedSha256: hash, baseSha256: sha256(original), targetSha256: sha256(latest), mode: fs.statSync(file).mode & 0o777 };
      }
      if (state === 'modified') throw new Error(`Refusing unrecognized content: ${artifact.target}`);
    }
    const original = state === 'patched' ? transformSource(source, artifact, true) : source;
    // Verify the observed revision bidirectionally, including check/no-op plans.
    const observedPatched = transformSource(original, artifact);
    if (state === 'patched' && observedPatched !== source) throw new Error('Patch roundtrip mismatch');
    const applySupported = exactSupported;
    // A recognized old revision can still be checked/restored. It cannot be
    // silently left behind while dependent UI/schema files upgrade around it.
    if (mode === 'apply' && !applySupported) throw new Error('No verified current patch for this native build; no files written');
    const targetArtifact = currentByBase.get(artifact.baseSha256) ?? (artifact.baseSha256 === primary.baseSha256 ? primary : artifact);
    const latest = transformSource(original, targetArtifact);
    const updateAvailable = state === 'patched' && sha256(latest) !== hash;
    const result = mode === 'apply' ? latest : mode === 'revert' ? original : source;
    return { name, artifact, file, source, result, state, updateAvailable, applySupported, hostVersion: dsh.version, installedVersion: pkg.version,
      observedSha256: hash, baseSha256: artifact.baseSha256, targetSha256: targetArtifact.resultSha256, mode: fs.statSync(file).mode & 0o777 };
  });
}


// Only public, read-only snapshots are cached. Never reuse source/result plans:
// apply/revert and applyPlan retain their full validation and concurrent-edit checks.
const inspectionCache = new Map();
function inspectionDependencies(root, artifacts) {
  const dependencies = new Set([root, artifacts, path.join(pluginRoot, 'package.json'),
    path.join(root, 'package.json'), path.join(root, 'node_modules/@deepseek-ai/dsh/package.json')]);
  for (const id of ARTIFACTS) {
    const manifestPath = path.join(artifacts, id);
    dependencies.add(manifestPath);
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const prefix = `node_modules/${manifest.packageName}/`;
      if (!/^@deepseek-ai\/dsh-[a-z-]+$/.test(manifest.packageName) || typeof manifest.target !== 'string'
        || !manifest.target.startsWith(prefix) || manifest.target.includes('..') || manifest.target.includes('\\')) continue;
      dependencies.add(path.resolve(root, manifest.target));
      dependencies.add(path.join(root, 'node_modules', manifest.packageName, 'package.json'));
    } catch { /* Missing/invalid manifests are tracked by their own stat. */ }
  }
  return [...dependencies];
}
function inspectionFingerprint(dependencies) {
  return JSON.stringify(dependencies.map(file => {
    try {
      // ctime detects same-size rewrites even when a caller restores mtime;
      // realpath and inode detect replacement and symlink changes. Nanoseconds
      // avoid hiding multiple writes in the same millisecond.
      const stat = fs.lstatSync(file, { bigint: true });
      const resolved = stat.isSymbolicLink() ? fs.statSync(file, { bigint: true }) : stat;
      const signature = value => ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(value[key]));
      return [file, fs.realpathSync(file), ...signature(stat), ...signature(resolved)];
    } catch (error) { return [file, error.code ?? 'unavailable']; }
  }));
}

/** Diagnose each program independently, without weakening the all-or-nothing planner.
 * Output is a closed schema: program hashes/versions only, never paths or errors. */
export function inspectPatches(dshRoot, artifactDirectory = path.join(pluginRoot, 'native')) {
  const root = path.resolve(dshRoot), artifacts = path.resolve(artifactDirectory);
  const key = JSON.stringify([root, artifacts]);
  const cached = inspectionCache.get(key);
  if (cached && inspectionFingerprint(cached.dependencies) === cached.fingerprint) return structuredClone(cached.snapshot);
  const manifestPaths = ARTIFACTS.map(id => path.join(artifacts, id));
  const manifestsBefore = inspectionFingerprint(manifestPaths);
  const dependencies = inspectionDependencies(root, artifacts);
  const before = inspectionFingerprint(dependencies);
  const snapshot = inspectPatchesFresh(root, artifacts);
  // Do not retain an observation collected while the host was being replaced.
  if (manifestsBefore === inspectionFingerprint(manifestPaths) && before === inspectionFingerprint(dependencies)) {
    if (inspectionCache.size >= 16) inspectionCache.delete(inspectionCache.keys().next().value);
    inspectionCache.set(key, { dependencies, fingerprint: before, snapshot: structuredClone(snapshot) });
  } else inspectionCache.delete(key);
  return snapshot;
}
function inspectPatchesFresh(dshRoot, artifactDirectory) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
  let root, hostVersion = null;
  try {
    root = fs.realpathSync(dshRoot);
    const inner = path.join(root, 'node_modules/@deepseek-ai/dsh/package.json');
    const host = JSON.parse(fs.readFileSync(fs.existsSync(inner) ? inner : path.join(root, 'package.json'), 'utf8'));
    if (host.name === '@deepseek-ai/dsh') hostVersion = host.version;
  } catch { /* Do not expose filesystem or parser error messages. */ }
  const files = ARTIFACTS.map(id => {
    const item = { id, state: 'conflict', code: 'target_unavailable', installedVersion: null, observedSha256: null, baseSha256: null, targetSha256: null };
    if (!root) return item;
    // Collect only metadata from the exact manifest-owned, regular program path.
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, id), 'utf8'));
      const prefix = `node_modules/${manifest.packageName}/`;
      if (!/^@deepseek-ai\/dsh-[a-z-]+$/.test(manifest.packageName) || typeof manifest.target !== 'string' || !manifest.target.startsWith(prefix) || manifest.target.includes('..') || manifest.target.includes('\\')) throw new Error();
      const file = path.resolve(root, manifest.target);
      if (!inside(root, file) || fs.realpathSync(file) !== file || !fs.statSync(file).isFile()) throw new Error();
      const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', manifest.packageName, 'package.json'), 'utf8'));
      if (installed.name === manifest.packageName) item.installedVersion = installed.version;
      item.observedSha256 = sha256(fs.readFileSync(file));
    } catch { /* Safe incomplete metadata; planner still refuses unknown targets. */ }
    try {
      const [plan] = planPatchFiles(root, 'check', artifactDirectory, [id]);
      Object.assign(item, { state: plan.state, code: !plan.applySupported ? 'unsupported_patch_build' : plan.updateAvailable ? 'update_available' : plan.state === 'pristine' ? 'not_applied' : 'ready',
        baseSha256: plan.baseSha256, targetSha256: plan.targetSha256 });
    } catch (error) {
      const matching = structuralFailures.get(error);
      if (matching?.length) item.matching = matching;
      const message = error?.message ?? '';
      item.code = message === 'Unexpected DSH host package' ? 'host_identity'
        : message === 'Installed native package identity mismatch' ? 'package_identity'
        : message.startsWith('Refusing unrecognized content: ') || message === 'Structural patch syntax check failed' || message === 'Ambiguous structural patch revision' ? 'unrecognized_content'
        : error?.code === 'ENOENT' || error?.code === 'EACCES' || message === 'Unexpected target path or duplicate patch' ? 'target_unavailable' : 'patch_manifest';
    }
    return item;
  });
  return compatibilitySnapshot({ schema: 1, pluginVersion: pkg.version, hostVersion, supportedDsh: null, compatibilityPolicy: 'code', files });
}

function stageReplacement(file, content, mode) {
  // Only replace an observed regular target, with a same-directory atomic rename.
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('Unexpected native target before write');
  const temporary = `${file}.dsh-multikey-${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    discardStaged(temporary, file);
    throw error;
  }
  fs.closeSync(fd);
  return temporary;
}
function discardStaged(temporary, file) {
  if (!path.isAbsolute(temporary) || !temporary.startsWith(`${file}.dsh-multikey-`) || path.dirname(temporary) !== path.dirname(file) || !temporary.endsWith('.tmp')) throw new Error('Unsafe staged native path');
  if (fs.existsSync(temporary)) {
    if (fs.realpathSync(temporary) !== temporary || !fs.lstatSync(temporary).isFile()) throw new Error('Unexpected staged native file');
    fs.unlinkSync(temporary);
  }
}
export function applyPlan(plans, backupDirectory = path.join(pluginRoot, 'native', 'backups')) {
  const changed = plans.filter(plan => plan.source !== plan.result);
  // Re-check all inputs just before writing. Never overwrite concurrent edits.
  for (const plan of plans) if (fs.readFileSync(plan.file, 'utf8') !== plan.source) throw new Error('Concurrent native edit; no files written');
  if (changed.length === 0) return 0;
  fs.mkdirSync(backupDirectory, { recursive: true });
  for (const plan of changed) {
    const backup = path.join(backupDirectory, `${plan.artifact.packageName.slice('@deepseek-ai/'.length)}-${path.basename(plan.file)}-${sha256(plan.source)}.js`);
    if (fs.existsSync(backup)) {
      if (sha256(fs.readFileSync(backup)) !== sha256(plan.source)) throw new Error('Backup hash mismatch; no files written');
    } else fs.writeFileSync(backup, plan.source, { mode: 0o600, flag: 'wx' });
  }
  const staged = [];
  const written = [];
  try {
    // Finish every write before replacing any target; a disk error cannot truncate it.
    for (const plan of changed) staged.push({ plan, temporary: stageReplacement(plan.file, plan.result, plan.mode) });
    for (const { plan, temporary } of staged) {
      if (fs.realpathSync(plan.file) !== plan.file || fs.readFileSync(plan.file, 'utf8') !== plan.source) throw new Error('Concurrent native edit');
      fs.renameSync(temporary, plan.file);
      written.push(plan);
    }
  } catch (error) {
    for (const plan of written.reverse()) {
      if (fs.realpathSync(plan.file) === plan.file && fs.readFileSync(plan.file, 'utf8') === plan.result) {
        const temporary = stageReplacement(plan.file, plan.source, plan.mode);
        try { fs.renameSync(temporary, plan.file); } finally { discardStaged(temporary, plan.file); }
      }
    }
    throw error;
  } finally {
    for (const { plan, temporary } of staged) discardStaged(temporary, plan.file);
  }
  return changed.length;
}

function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/native-patches.mjs --dsh-root <installed-DSH-root> [--check|--apply|--revert]\nDefault: read-only --check. Stop DSH before apply/revert, then restart the same service and refresh its existing page. Never revert while saved sessions still select @dsh-key/ aliases.');
    return;
  }
  const modes = args.filter(arg => ['--check', '--apply', '--revert'].includes(arg));
  if (modes.length > 1) throw new Error('Choose one mode');
  const i = args.indexOf('--dsh-root');
  if (i === -1 || !args[i + 1]) throw new Error('Supply an explicit --dsh-root; see --help');
  const allowed = new Set(['--check', '--apply', '--revert', '--dsh-root', args[i + 1]]);
  if (args.some(arg => !allowed.has(arg))) throw new Error('Unknown argument');
  const mode = (modes[0] ?? '--check').slice(2);
  const plans = planPatches(args[i + 1], mode);
  for (const plan of plans) console.log(`${plan.artifact.target}: ${plan.state}${plan.applySupported ? plan.updateAvailable ? ' (update available)' : '' : ' (recognized legacy build; no verified upgrade, apply disabled)'}`);
  if (mode !== 'check') console.log(`${applyPlan(plans)} native files changed. Restart the existing DSH service and refresh its page; the live process is not reloaded by this script.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
