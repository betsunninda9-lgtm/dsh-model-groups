import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { prepareEditorInterface } from './editor-interface-transform.js';

export const MODELS_CLIENT_ID = '@deepseek-ai/dsh-client-ui-settings-models';
const hash = value => createHash('sha256').update(value).digest('hex');
const problem = code => Object.assign(new Error(code), { code });
const CODES = new Set(['EDITOR_SOURCE_INVALID', 'EDITOR_STRUCTURE_UNSUPPORTED', 'EDITOR_INTERFACE_INCOMPLETE', 'EDITOR_TARGET_INVALID', 'EDITOR_BACKUP_CONFLICT', 'EDITOR_CONCURRENT_CHANGE', 'EDITOR_BUSY', 'EDITOR_READ_ONLY', 'EDITOR_PUBLISH_FAILED']);
const failed = error => ({ state: 'failed', code: CODES.has(error?.code) ? error.code : ['EACCES', 'EPERM', 'EROFS'].includes(error?.code) ? 'EDITOR_READ_ONLY' : 'EDITOR_INSTALL_FAILED', changed: false });

function targetOf(registry) {
  const advertised = registry.clientPath(MODELS_CLIENT_ID);
  if (typeof advertised !== 'string' || !path.isAbsolute(advertised)) throw problem('EDITOR_TARGET_INVALID');
  const target = fs.realpathSync(advertised);
  if (!fs.lstatSync(advertised).isFile() || !fs.lstatSync(target).isFile()) throw problem('EDITOR_TARGET_INVALID');
  let directory = path.dirname(target);
  for (let depth = 0; depth < 6; depth++) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      let client = metadata.exports?.['./client'];
      if (client && typeof client === 'object') client = client.default;
      if (metadata.name !== MODELS_CLIENT_ID || typeof client !== 'string' || !client.startsWith('./')
        || fs.realpathSync(path.resolve(directory, client)) !== target) throw problem('EDITOR_TARGET_INVALID');
      return target;
    }
    directory = path.dirname(directory);
  }
  throw problem('EDITOR_TARGET_INVALID');
}
function sourceOf(target) {
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw problem('EDITOR_TARGET_INVALID');
  return { source: fs.readFileSync(target, 'utf8'), mode: stat.mode & 0o777 };
}
function stage(target, source, mode) {
  const filename = path.join(path.dirname(target), `.dsh-model-groups-${randomUUID()}.tmp`);
  const descriptor = fs.openSync(filename, 'wx', mode);
  try { fs.writeFileSync(descriptor, source); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  return filename;
}
function exclusiveBackup(filename, source) {
  try { fs.writeFileSync(filename, source, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST' || !fs.lstatSync(filename).isFile() || fs.readFileSync(filename, 'utf8') !== source) throw problem('EDITOR_BACKUP_CONFLICT'); }
}
function acquire(filename) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const fd = fs.openSync(filename, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd); return; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { throw problem('EDITOR_BUSY'); }
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw problem('EDITOR_BUSY');
      try { process.kill(previous.pid, 0); throw problem('EDITOR_BUSY'); }
      catch (reason) { if (reason.code !== 'ESRCH') throw problem('EDITOR_BUSY'); }
      fs.unlinkSync(filename);
    }
  }
  throw problem('EDITOR_BUSY');
}

/** Install one editor integration and publish it through the public registry.
 * No Settings, credential, loader tree or model transport files are modified. */
export function ensureEditorInterface(registry, { home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh') } = {}) {
  if (typeof registry?.clientPath !== 'function' || typeof registry?.rebuilt !== 'function') return { state: 'pending', code: 'EDITOR_REGISTRY_UNAVAILABLE', changed: false };
  let target, directory, lock, locked = false, staged;
  try {
    if (!registry.clientPath(MODELS_CLIENT_ID)) return { state: 'pending', code: 'EDITOR_MODULE_PENDING', changed: false };
    target = targetOf(registry);
    let current = sourceOf(target), prepared = prepareEditorInterface(current.source);
    if (!prepared.changed) {
      if (!registry.rebuilt(MODELS_CLIENT_ID)) throw problem('EDITOR_PUBLISH_FAILED');
      return { state: 'ready', code: 'EDITOR_AVAILABLE', changed: false };
    }
    if (!(current.mode & 0o222)) throw problem('EDITOR_READ_ONLY');
    directory = path.join(path.resolve(home), 'dsh-model-groups', 'editor-interface', hash(target).slice(0, 20));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    lock = path.join(directory, 'write.lock'); acquire(lock); locked = true;
    current = sourceOf(target); prepared = prepareEditorInterface(current.source);
    if (!prepared.changed) {
      if (!registry.rebuilt(MODELS_CLIENT_ID)) throw problem('EDITOR_PUBLISH_FAILED');
      return { state: 'ready', code: 'EDITOR_AVAILABLE', changed: false };
    }
    const before = hash(current.source), after = hash(prepared.source);
    exclusiveBackup(path.join(directory, `${before}.before.js`), current.source);
    exclusiveBackup(path.join(directory, `${after}.receipt.json`), JSON.stringify({ schema: 1, target, before, after }) + '\n');
    staged = stage(target, prepared.source, current.mode);
    if (fs.realpathSync(registry.clientPath(MODELS_CLIENT_ID)) !== target || hash(sourceOf(target).source) !== before) throw problem('EDITOR_CONCURRENT_CHANGE');
    fs.renameSync(staged, target); staged = undefined;
    try {
      if (hash(sourceOf(target).source) !== after || !registry.rebuilt(MODELS_CLIENT_ID)) throw problem('EDITOR_PUBLISH_FAILED');
    } catch {
      if (hash(sourceOf(target).source) === after) {
        staged = stage(target, current.source, current.mode);
        fs.renameSync(staged, target); staged = undefined;
        try { registry.rebuilt(MODELS_CLIENT_ID); } catch { /* Preserve original bytes even when publication is unavailable. */ }
      }
      throw problem('EDITOR_PUBLISH_FAILED');
    }
    return { state: 'ready', code: 'EDITOR_INSTALLED', changed: true };
  } catch (error) { return failed(error); }
  finally {
    if (staged) { const absolute = path.resolve(staged); if (path.dirname(absolute) === path.dirname(target) && path.basename(absolute).startsWith('.dsh-model-groups-')) fs.unlinkSync(absolute); }
    if (locked) fs.unlinkSync(lock);
  }
}

export function createEditorInterfaceManager(ctx, options) {
  let status = { state: 'pending', code: 'EDITOR_MODULE_PENDING', changed: false }, stopped = false, working = false;
  let registry, injectedRegistry, unsubscribe;
  function ensure() {
    if (stopped || working) return status;
    working = true;
    try {
      const available = injectedRegistry ?? (typeof ctx.get === 'function' ? ctx.get('clientModules') : ctx.clientModules);
      if (registry !== available) {
        unsubscribe?.(); registry = available;
        unsubscribe = registry?.onGraphChanged?.(() => { if (!working && !stopped) ensure(); });
      }
      status = ensureEditorInterface(registry, options);
      return status;
    } finally { working = false; }
  }
  ctx.inject?.(['clientModules'], child => {
    injectedRegistry = child.clientModules;
    ensure();
    return () => { injectedRegistry = undefined; unsubscribe?.(); unsubscribe = undefined; registry = undefined; status = { state: 'pending', code: 'EDITOR_REGISTRY_UNAVAILABLE', changed: false }; };
  });
  ctx.effect?.(() => () => { stopped = true; unsubscribe?.(); });
  return { ensure, snapshot: () => ({ ...status }) };
}
