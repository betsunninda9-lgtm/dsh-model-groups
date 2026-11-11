import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compatibilitySnapshot } from '../src/compatibility.js';

export const ARTIFACTS = ['pi-ai.patch.json', 'settings-models.patch.json', 'llm-typert.host.patch.json', 'llm-typert.remote-client.patch.json', 'api-remotes.patch.json'];
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = source => crypto.createHash('sha256').update(source).digest('hex');
const inside = (root, target) => target.startsWith(root + path.sep);

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
  if (dsh.name !== '@deepseek-ai/dsh' || dsh.version !== '0.2.2-rc.1') throw new Error('This patch supports only @deepseek-ai/dsh 0.2.2-rc.1');
  const seen = new Set();
  return names.map(name => {
    let artifact = JSON.parse(fs.readFileSync(path.join(artifactDirectory, name), 'utf8'));
    if (artifact.version !== '0.2.2-rc.1' || !/^@deepseek-ai\/dsh-[a-z-]+$/.test(artifact.packageName)) throw new Error('Unsupported patch package/version');
    if (!Array.isArray(artifact.replacements) || artifact.replacements.length === 0 || !/^[0-9a-f]{64}$/.test(artifact.baseSha256) || !/^[0-9a-f]{64}$/.test(artifact.resultSha256)) throw new Error('Invalid patch manifest');
    const prefix = `node_modules/${artifact.packageName}/`;
    if (typeof artifact.target !== 'string' || !artifact.target.startsWith(prefix) || artifact.target.includes('..') || artifact.target.includes('\\')) throw new Error('Unsafe patch target');
    const file = path.resolve(root, artifact.target);
    if (!inside(root, file) || fs.realpathSync(file) !== file || !fs.statSync(file).isFile() || seen.has(file)) throw new Error('Unexpected target path or duplicate patch');
    seen.add(file);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', artifact.packageName, 'package.json'), 'utf8'));
    if (pkg.name !== artifact.packageName || pkg.version !== artifact.version) throw new Error('Installed native package version mismatch');
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
    if (state === 'modified') throw new Error(`Refusing unrecognized content: ${artifact.target}`);
    const original = state === 'patched' ? transformSource(source, artifact, true) : source;
    // Verify the observed revision bidirectionally, including check/no-op plans.
    const observedPatched = transformSource(original, artifact);
    if (state === 'patched' && observedPatched !== source) throw new Error('Patch roundtrip mismatch');
    const applySupported = primary.requiresCurrent !== true || currentByBase.has(artifact.baseSha256);
    // A recognized old revision can still be checked/restored. It cannot be
    // silently left behind while dependent UI/schema files upgrade around it.
    if (mode === 'apply' && !applySupported) throw new Error('No verified current patch for this native build; no files written');
    const targetArtifact = currentByBase.get(artifact.baseSha256) ?? (artifact.baseSha256 === primary.baseSha256 ? primary : artifact);
    const latest = transformSource(original, targetArtifact);
    const updateAvailable = state === 'patched' && sha256(latest) !== hash;
    const result = mode === 'apply' ? latest : mode === 'revert' ? original : source;
    return { name, artifact, file, source, result, state, updateAvailable, applySupported, observedSha256: hash, baseSha256: artifact.baseSha256, targetSha256: targetArtifact.resultSha256, mode: fs.statSync(file).mode & 0o777 };
  });
}


/** Diagnose each program independently, without weakening the all-or-nothing planner.
 * Output is a closed schema: program hashes/versions only, never paths or errors. */
export function inspectPatches(dshRoot, artifactDirectory = path.join(pluginRoot, 'native')) {
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
      const message = error?.message ?? '';
      item.code = message === 'This patch supports only @deepseek-ai/dsh 0.2.2-rc.1' ? 'host_version'
        : message === 'Installed native package version mismatch' ? 'package_version'
        : message.startsWith('Refusing unrecognized content: ') ? 'unrecognized_content'
        : error?.code === 'ENOENT' || error?.code === 'EACCES' || message === 'Unexpected target path or duplicate patch' ? 'target_unavailable' : 'patch_manifest';
    }
    return item;
  });
  return compatibilitySnapshot({ schema: 1, pluginVersion: pkg.version, hostVersion, supportedDsh: pkg.engines.dsh, files });
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
