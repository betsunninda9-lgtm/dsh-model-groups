import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { withNativeJournal } from '../src/native-journal.js';
import { createNativeMigration } from '../src/native-migration.js';
import { createHash } from 'node:crypto';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-journal-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, directory: path.join(root, 'selected') };
}
const rejected = (promise, code) => assert.rejects(promise, cause => {
  assert.match(cause.code, code);
  assert.equal(cause.message, cause.code);
  assert.equal(cause.stack, cause.code);
  return true;
});

test('creates a private durable journal, reads after writes and releases lock', async t => {
  const { directory } = await fixture(t);
  let retained;
  assert.equal(await withNativeJournal(directory, async journal => {
    retained = journal;
    assert.equal(await journal.read(), null);
    await journal.write({ phase: 'prepared', items: [{ id: 'route-1' }] });
    const first = await journal.read();
    first.items[0].id = 'changed';
    assert.equal((await journal.read()).items[0].id, 'route-1');
    await journal.write(null);
    assert.equal(await journal.read(), null);
    await journal.write({ phase: 'routes-migrated' });
    return 42;
  }), 42);
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(directory, 'journal.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(directory), ['journal.json']);
  await withNativeJournal(directory, async journal => assert.deepEqual(await journal.read(), { phase: 'routes-migrated' }));
  await rejected(retained.read(), /^JOURNAL_CLOSED$/);
});

test('same path is exclusively locked across instances and child processes', async t => {
  const { directory } = await fixture(t);
  await withNativeJournal(directory, async () => {
    await rejected(withNativeJournal(directory, () => assert.fail('must not run')), /^JOURNAL_BUSY$/);
    const moduleUrl = new URL('../src/native-journal.js', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { withNativeJournal } from ${JSON.stringify(moduleUrl)};
      try { await withNativeJournal(${JSON.stringify(directory)}, () => {}); process.exitCode = 2; }
      catch (e) { if (e.code !== 'JOURNAL_BUSY') process.exitCode = 3; }
    `], { stdio: 'pipe' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0);
  });
});

test('task errors are sanitized and owned lock is released', async t => {
  const { directory } = await fixture(t);
  await rejected(withNativeJournal(directory, () => { throw new Error('secret /private/path'); }), /^JOURNAL_TASK_FAILED$/);
  assert.deepEqual(await fs.readdir(directory), []);
  await withNativeJournal(directory, () => {});
});

test('abandoned lock is never automatically removed, including its contents', async t => {
  const { directory } = await fixture(t);
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.mkdir(path.join(directory, 'journal.lock'), { mode: 0o700 });
  await fs.writeFile(path.join(directory, 'journal.lock', 'foreign'), 'keep');
  await rejected(withNativeJournal(directory, () => {}), /^JOURNAL_BUSY$/);
  assert.equal(await fs.readFile(path.join(directory, 'journal.lock', 'foreign'), 'utf8'), 'keep');
});

test('rejects nonprivate directories, symlink ancestors, escapes and symlink files', async t => {
  const { root, directory } = await fixture(t);
  await fs.mkdir(directory, { mode: 0o755 });
  await fs.chmod(directory, 0o755);
  await rejected(withNativeJournal(directory, () => {}), /^JOURNAL_/);
  await fs.chmod(directory, 0o700);
  const link = path.join(root, 'alias');
  await fs.symlink(directory, link);
  await rejected(withNativeJournal(link, () => {}), /^JOURNAL_/);
  await rejected(withNativeJournal(path.join(link, 'nested'), () => {}), /^JOURNAL_/);
  await rejected(withNativeJournal(`${directory}/../selected`, () => {}), /^JOURNAL_INVALID_ARGUMENT$/);
  const victim = path.join(root, 'victim');
  await fs.writeFile(victim, 'untouched', { mode: 0o600 });
  await fs.symlink(victim, path.join(directory, 'journal.json'));
  await rejected(withNativeJournal(directory, journal => journal.write({ ok: true })), /^JOURNAL_UNSAFE_FILE$/);
  assert.equal(await fs.readFile(victim, 'utf8'), 'untouched');
});

test('rejects foreign-owned directory when privileged fixture can create one', async t => {
  if (process.getuid() !== 0) return t.skip('requires fixture chown capability');
  const { directory } = await fixture(t);
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.chown(directory, 65534, 65534);
  if ((await fs.stat(directory)).uid === process.getuid()) return t.skip('runtime emulates chown without changing ownership');
  await rejected(withNativeJournal(directory, () => {}), /^JOURNAL_/);
});

test('rejects changed hash since read, even on same inode and same length', async t => {
  const { directory } = await fixture(t);
  await withNativeJournal(directory, journal => journal.write({ id: 'one' }));
  await rejected(withNativeJournal(directory, async journal => {
    await journal.read();
    await fs.writeFile(path.join(directory, 'journal.json'), '{"id":"two"}');
    await journal.write({ id: 'new' });
  }), /^JOURNAL_CONFLICT$/);
  assert.equal(await fs.readFile(path.join(directory, 'journal.json'), 'utf8'), '{"id":"two"}');
  assert.deepEqual(await fs.readdir(directory), ['journal.json']);
});

test('detects conflict or symlink tamper immediately before atomic replace', async t => {
  const { root, directory } = await fixture(t);
  await withNativeJournal(directory, journal => journal.write({ id: 'one' }));
  const victim = path.join(root, 'victim');
  await fs.writeFile(victim, '{"id":"safe"}', { mode: 0o600 });
  const originalOpen = fs.open;
  let intercepted = false;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.tmp')) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        await originalSync();
        await fs.unlink(path.join(directory, 'journal.json'));
        await fs.symlink(victim, path.join(directory, 'journal.json'));
        intercepted = true;
      };
    }
    return handle;
  };
  try {
    await rejected(withNativeJournal(directory, async journal => {
      await journal.read();
      await journal.write({ id: 'new' });
    }), /^JOURNAL_UNSAFE_FILE$/);
  } finally { fs.open = originalOpen; }
  assert.equal(intercepted, true);
  assert.equal(await fs.readFile(victim, 'utf8'), '{"id":"safe"}');
  assert.deepEqual(await fs.readdir(directory), ['journal.json']);
});

test('does not delete a foreign file replacing an owned staging name', async t => {
  const { directory } = await fixture(t);
  const originalOpen = fs.open;
  let foreign;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.tmp')) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        await originalSync();
        foreign = args[0];
        await fs.rename(foreign, `${foreign}.retained`);
        await fs.writeFile(foreign, 'foreign contents', { mode: 0o600 });
      };
    }
    return handle;
  };
  try { await rejected(withNativeJournal(directory, journal => journal.write({ id: 'new' })), /^JOURNAL_CONFLICT$/); }
  finally { fs.open = originalOpen; }
  assert.equal(await fs.readFile(foreign, 'utf8'), 'foreign contents');
  assert.equal(await fs.stat(path.join(directory, 'journal.lock')).then(() => true, () => false), false);
});

test('file and parent sync failure cannot report success', async t => {
  const { directory } = await fixture(t);
  for (const target of ['file', 'directory']) {
    const originalOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if ((target === 'file' && String(args[0]).endsWith('.tmp')) ||
          (target === 'directory' && args[0] === directory)) {
        handle.sync = async () => { throw new Error('secret sync path'); };
      }
      return handle;
    };
    try { await rejected(withNativeJournal(directory, journal => journal.write({ target })), /^JOURNAL_IO_FAILED$/); }
    finally { fs.open = originalOpen; }
    assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp') || name === 'journal.lock'), false);
  }
});

test('bounded JSON objects/null only; invalid or oversized data fails closed', async t => {
  const { directory } = await fixture(t);
  for (const value of [[], 'text', 1, undefined, { big: 'x'.repeat(1024 * 1024) }]) {
    await rejected(withNativeJournal(directory, journal => journal.write(value)), /^JOURNAL_(INVALID_DATA|TOO_LARGE)$/);
  }
  await fs.writeFile(path.join(directory, 'journal.json'), '[]', { mode: 0o600 });
  await rejected(withNativeJournal(directory, journal => journal.read()), /^JOURNAL_INVALID_DATA$/);
  await fs.writeFile(path.join(directory, 'journal.json'), 'x'.repeat(1024 * 1024 + 1));
  await rejected(withNativeJournal(directory, journal => journal.read()), /^JOURNAL_UNSAFE_FILE$/);
});

test('conforms to createNativeMigration journal and resumes completed routes', async t => {
  const { directory } = await fixture(t);
  const routesPlan = [{ provider: 'legacy', entryId: 'key-1', target: 'native', models: ['m1'] }];
  const planFingerprint = createHash('sha256').update(JSON.stringify(routesPlan)).digest('hex');
  let selection = { provider: 'legacy', model: '@dsh-key/key-1/m1' };
  const routes = {
    inspect: async () => ({ complete: true, quiescent: true, revision: 1, items: [{ id: 'default', selection }] }),
    compareAndSelect: async (_id, expected, next) => { assert.deepEqual(selection, expected); selection = next; return true; },
  };
  const stage = {
    preview: async () => ({ revision: 1, fingerprint: 'stable', planFingerprint }),
    stage: async () => ({ status: 'staged' }),
  };
  const run = () => withNativeJournal(directory, journal => createNativeMigration({
    stage, routes, journal, plan: { routes: routesPlan },
  }).migrate());
  assert.equal((await run()).status, 'routes-migrated');
  assert.equal((await run()).status, 'routes-migrated');
});

test('cleanup never removes replaced lock or arbitrary contents', async t => {
  const { directory } = await fixture(t);
  await rejected(withNativeJournal(directory, async () => {
    await fs.rename(path.join(directory, 'journal.lock'), path.join(directory, 'retained-lock'));
    await fs.mkdir(path.join(directory, 'journal.lock'), { mode: 0o700 });
    await fs.writeFile(path.join(directory, 'journal.lock', 'foreign'), 'keep');
  }), /^JOURNAL_LOCK_CHANGED$/);
  assert.equal(await fs.readFile(path.join(directory, 'journal.lock', 'foreign'), 'utf8'), 'keep');
  assert.ok((await fs.stat(path.join(directory, 'retained-lock'))).isDirectory());
});
