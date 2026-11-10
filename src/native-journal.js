import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const MAX_BYTES = 1024 * 1024;
const codes = new Set(['JOURNAL_INVALID_ARGUMENT', 'JOURNAL_UNSAFE_DIRECTORY',
  'JOURNAL_CLOSED', 'JOURNAL_LOCK_CHANGED', 'JOURNAL_UNSAFE_FILE',
  'JOURNAL_CONFLICT', 'JOURNAL_TOO_LARGE', 'JOURNAL_INVALID_DATA',
  'JOURNAL_IO_FAILED', 'JOURNAL_BUSY', 'JOURNAL_TASK_FAILED']);
const error = code => Object.assign(new Error(code), { code, stack: code });
const fail = code => { throw error(code); };
const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value === null || (typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const privateNode = (stat, directory) => stat.uid === process.getuid() &&
  (directory ? stat.isDirectory() && (stat.mode & 0o7777) === 0o700 :
    stat.isFile() && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1);
const optionalStat = async target => {
  try { return await fs.lstat(target); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
};

// Reject symlinks in *every* component, not merely the selected leaf. Parents
// need not be private (e.g. /tmp); the explicitly selected directory must be.
async function ancestors(directory) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('JOURNAL_UNSAFE_DIRECTORY');
  }
}

/** Private, bounded durable journal adapter for createNativeMigration.
 * The caller explicitly selects an exclusively controlled directory; this does
 * not discover DSH_HOME, migrate files, remove records, or filter credentials.
 * Store only the migration's route/current-ID records, never credentials.
 * Lock contention fails immediately; abandoned locks require manual inspection.
 * Node has no compare-and-rename primitive: checks detect observed external
 * edits, not malicious same-UID races between the final check and rename.
 * A failed sync means an uncertain commit: stop and inspect/retry in a new task.
 */
export async function withNativeJournal(directory, task) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
    directory.split(/[\\/]/).includes('..') || typeof task !== 'function' ||
    typeof process.getuid !== 'function') fail('JOURNAL_INVALID_ARGUMENT');
  directory = path.resolve(directory);
  const journalPath = path.join(directory, 'journal.json');
  const lockPath = path.join(directory, 'journal.lock');
  let directoryHandle, directoryStat, lockStat, lockHandle;
  let active = true, poisoned = false, baseline;
  let queue = Promise.resolve();
  const temps = new Map();
  const verifyDirectory = async () => {
    await ancestors(directory);
    const current = await fs.lstat(directory);
    if (!same(current, directoryStat) || !privateNode(current, true)) fail('JOURNAL_UNSAFE_DIRECTORY');
  };
  const verify = async () => {
    if (!active || poisoned) fail('JOURNAL_CLOSED');
    await verifyDirectory();
    const current = await fs.lstat(lockPath);
    if (!same(current, lockStat) || !privateNode(current, true)) fail('JOURNAL_LOCK_CHANGED');
  };
  const snapshot = async () => {
    const stat = await optionalStat(journalPath);
    if (!stat) return { exists: false, value: null };
    if (!privateNode(stat, false) || stat.size > MAX_BYTES) fail('JOURNAL_UNSAFE_FILE');
    const handle = await fs.open(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (!same(stat, opened) || !privateNode(opened, false)) fail('JOURNAL_CONFLICT');
      // Read at most MAX_BYTES + 1 even if another writer grows the file.
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await handle.read(bytes, size, bytes.length - size, size);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size > MAX_BYTES) fail('JOURNAL_TOO_LARGE');
      const after = await handle.stat();
      const current = await optionalStat(journalPath);
      if (!same(current, opened) || !privateNode(after, false) ||
        after.size !== size || after.mtimeNs !== opened.mtimeNs ||
        after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) fail('JOURNAL_CONFLICT');
      const body = bytes.subarray(0, size);
      let value;
      try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        if (!object(value)) fail('JOURNAL_INVALID_DATA');
      } catch { fail('JOURNAL_INVALID_DATA'); }
      return { exists: true, stat: after, hash: hash(body), value };
    } finally { await handle.close(); }
  };
  const equal = (a, b) => a.exists === b.exists && (!a.exists ||
    (same(a.stat, b.stat) && a.hash === b.hash));
  const serialized = operation => {
    const result = queue.then(async () => {
      try { await verify(); return await operation(); }
      catch (cause) {
        poisoned = true;
        if (codes.has(cause?.code)) throw error(cause.code);
        throw error('JOURNAL_IO_FAILED');
      }
    });
    queue = result.catch(() => {});
    return result;
  };
  try {
    await ancestors(path.dirname(directory));
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
    directoryStat = await fs.lstat(directory);
    if (!privateNode(directoryStat, true)) fail('JOURNAL_UNSAFE_DIRECTORY');
    directoryHandle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!same(await directoryHandle.stat(), directoryStat)) fail('JOURNAL_UNSAFE_DIRECTORY');
    await verifyDirectory();
    try { await fs.mkdir(lockPath, { mode: 0o700 }); }
    catch (cause) { if (cause.code === 'EEXIST') fail('JOURNAL_BUSY'); throw cause; }
    lockStat = await fs.lstat(lockPath);
    if (!privateNode(lockStat, true)) fail('JOURNAL_LOCK_CHANGED');
    lockHandle = await fs.open(lockPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!same(await lockHandle.stat(), lockStat)) fail('JOURNAL_LOCK_CHANGED');
    await verify();
    const journal = {
      read: () => serialized(async () => {
        const observed = await snapshot();
        if (baseline && !equal(baseline, observed)) fail('JOURNAL_CONFLICT');
        baseline = observed;
        return structuredClone(observed.value);
      }),
      write: value => serialized(async () => {
        let bytes;
        try {
          if (!object(value)) fail('JOURNAL_INVALID_DATA');
          bytes = Buffer.from(JSON.stringify(value));
          if (!object(JSON.parse(bytes.toString('utf8')))) fail('JOURNAL_INVALID_DATA');
        } catch { fail('JOURNAL_INVALID_DATA'); }
        if (bytes.length > MAX_BYTES) fail('JOURNAL_TOO_LARGE');
        const before = await snapshot();
        if (!baseline) baseline = before;
        if (!equal(baseline, before)) fail('JOURNAL_CONFLICT');
        const temporary = path.join(directory, `.journal-${randomUUID()}.tmp`);
        let handle;
        try {
          handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          const identity = await handle.stat();
          temps.set(temporary, identity);
          if (!privateNode(identity, false)) fail('JOURNAL_UNSAFE_FILE');
          await handle.writeFile(bytes);
          await handle.sync();
          const staged = await handle.stat();
          if (!privateNode(staged, false) || staged.size !== bytes.length) fail('JOURNAL_CONFLICT');
          await handle.close(); handle = null;
          await verify();
          if (!same(await fs.lstat(temporary), identity)) fail('JOURNAL_CONFLICT');
          if (!equal(baseline, await snapshot())) fail('JOURNAL_CONFLICT');
          await fs.rename(temporary, journalPath);
          temps.delete(temporary);
          await directoryHandle.sync();
          const committed = await snapshot();
          if (!same(committed.stat, identity) || committed.hash !== hash(bytes)) fail('JOURNAL_CONFLICT');
          baseline = committed;
        } finally { if (handle) await handle.close(); }
      }),
    };
    let result;
    try { result = await task(journal); }
    catch (cause) {
      if (codes.has(cause?.code)) throw error(cause.code);
      throw error('JOURNAL_TASK_FAILED');
    }
    await queue;
    if (poisoned) fail('JOURNAL_IO_FAILED');
    await verify();
    return result;
  } catch (cause) {
    if (codes.has(cause?.code)) throw error(cause.code);
    throw error('JOURNAL_IO_FAILED');
  } finally {
    active = false;
    await queue;
    let cleanupFailed = false;
    try {
      if (directoryStat) await verifyDirectory();
      for (const [temporary, identity] of temps) {
        if (same(await optionalStat(temporary), identity)) await fs.unlink(temporary);
      }
      // Never recursively delete: unexpected contents or a replaced lock stay.
      if (lockStat && same(await optionalStat(lockPath), lockStat)) await fs.rmdir(lockPath);
    } catch { cleanupFailed = true; }
    try { await lockHandle?.close(); } catch { cleanupFailed = true; }
    try { await directoryHandle?.close(); } catch { cleanupFailed = true; }
    if (cleanupFailed) {
      // Do not expose filesystem errors, paths, payloads or task exception text.
      // A cleanup failure also must not be reported as successful completion.
      fail('JOURNAL_IO_FAILED');
    }
  }
}
