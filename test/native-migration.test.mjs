import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createNativeMigration } from '../src/native-migration.js';
import { createNativeStage } from '../src/native-stage.js';
import { planNativeDowngrade, downgradeSelection } from '../src/native-downgrade.js';

const unsafe = 'credential-value /private/settings.json';
const source = () => ({ vendor: {
  api: 'openai-completions', baseURL: 'https://unused.invalid', multiKey: true,
  keyEntries: { one: { name: 'one', apiKeyEnv: 'ONE_KEY', models: [{ id: 'chat/model',
    contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false }] } },
} });
const alias = () => ({ provider: 'vendor', model: '@dsh-key/one/chat%2Fmodel', reasoningEffort: 'low' });
const code = expected => error => {
  assert.equal(error.code, expected);
  assert.equal(error.message, expected);
  assert.equal(error.stack, expected);
  assert.ok(!JSON.stringify(error).includes(unsafe));
  return true;
};
function fixture() {
  const plan = planNativeDowngrade(source());
  const state = { revision: 1, complete: true, quiescent: true, items: [
    { id: 'default', selection: alias() }, { id: 'session:one', selection: alias() },
    { id: 'session:raw', selection: { provider: 'vendor', model: 'raw/model' } },
  ] };
  const calls = [], writes = [];
  let stored = null;
  const stage = {
    async preview() { calls.push('preview'); return { revision: 5, fingerprint: 'config-token',
      planFingerprint: crypto.createHash('sha256').update(JSON.stringify(plan.routes)).digest('hex') }; },
    async stage(revision, fingerprint) {
      assert.equal(revision, 5); assert.equal(fingerprint, 'config-token');
      calls.push('stage');
      if (stage.fail) throw new Error(unsafe);
      return { status: 'staged' };
    },
  };
  const routes = {
    async inspect() { if (routes.onInspect) await routes.onInspect(); return structuredClone(state); },
    async compareAndSelect(id, expected, next) {
      calls.push(id);
      assert.ok(writes.some(record => record.items.some(item => item.id === id && item.state === 'intent')));
      if (routes.beforeSelect) await routes.beforeSelect(id);
      if (routes.fail === id) throw new Error(unsafe);
      const item = state.items.find(item => item.id === id);
      if (!item || !isDeepStrictEqual(item.selection, expected)) return false;
      item.selection = structuredClone(next); state.revision++;
      if (routes.afterSelect) await routes.afterSelect(id);
      return true;
    },
  };
  const journal = {
    async read() { return structuredClone(stored); },
    async write(record) {
      if (journal.failWrite?.(record)) throw new Error(unsafe);
      stored = structuredClone(record); writes.push(structuredClone(record));
    },
  };
  const create = overrides => createNativeMigration({ stage, routes, journal, plan, ...overrides });
  return { plan, state, stage, routes, journal, calls, writes, create, get stored() { return stored; } };
}

test('mandatory explicit plan and adapter contract; preview is read-only and mapping bound', async () => {
  const f = fixture();
  assert.throws(() => f.create({ plan: undefined }), code('MIGRATION_INVALID_PLAN'));
  assert.throws(() => f.create({ journal: {} }), code('MIGRATION_INVALID_ADAPTER'));
  const before = structuredClone(f.state);
  assert.deepEqual(await f.create().preview(), { status: 'preview', counts: { total: 3, mapped: 2, migrated: 0 } });
  assert.deepEqual(f.state, before); assert.equal(f.writes.length, 0);
  f.plan.routes[0].target = 'wrong-mapping';
  // Stage now hashes the mutated plan too, so freeze its advertised original digest.
  f.stage.preview = async () => ({ revision: 5, fingerprint: 'config-token', planFingerprint: 'unrelated' });
  await assert.rejects(f.create().migrate(), code('MIGRATION_PLAN_MISMATCH'));
  assert.equal(f.writes.length, 0); assert.ok(!f.calls.includes('stage'));
});

test('stage first, journal each step, default is a CAS item; raw and historical state untouched', async () => {
  const f = fixture();
  const raw = structuredClone(f.state.items[2]);
  const history = [{ model: alias().model }];
  const result = await f.create().migrate();
  assert.deepEqual(result, { status: 'routes-migrated', counts: { total: 3, mapped: 2, migrated: 2 } });
  assert.deepEqual(f.calls, ['preview', 'stage', 'default', 'session:one']);
  assert.deepEqual(f.state.items[0].selection, downgradeSelection(alias(), f.plan));
  assert.deepEqual(f.state.items[2], raw);
  assert.deepEqual(history, [{ model: alias().model }]);
  assert.equal(f.stored.phase, 'routes-migrated');
  await f.create().migrate();
  assert.equal(f.calls.filter(id => id === 'default').length, 1);
  assert.equal(f.calls.filter(id => id === 'session:one').length, 1);
  assert.equal(f.calls.filter(id => id === 'stage').length, 2);
});

test('real stage adapter integration only adds child configs before selections; retains legacy', async () => {
  const f = fixture();
  const state = { ns: 'host', revision: 1, value: { providers: source() } };
  const original = structuredClone(state.value.providers.vendor);
  const stage = createNativeStage({ namespace: 'host', validate: async () => true, settings: {
    async describe() { return [structuredClone(state)]; },
    async mutate(ns, ops, expectedRevision) {
      assert.equal(ns, 'host'); assert.equal(expectedRevision, state.revision);
      for (const op of ops) {
        assert.equal(op.op, 'set'); assert.equal(op.path[0], 'providers');
        assert.equal(Object.hasOwn(state.value.providers, op.path[1]), false);
        state.value.providers[op.path[1]] = structuredClone(op.value);
      }
      state.revision++;
    },
  } });
  f.routes.beforeSelect = () => {
    for (const route of f.plan.routes) assert.deepEqual(state.value.providers[route.target], f.plan.providers[route.target]);
  };
  assert.equal((await f.create({ stage }).migrate()).status, 'routes-migrated');
  assert.deepEqual(state.value.providers.vendor, original);
  assert.equal((await f.create({ stage }).migrate()).status, 'routes-migrated');
  assert.equal(state.revision, 2);
});

test('partial CAS failure resumes with same journal, re-inspects and never repeats completed routes', async () => {
  const f = fixture();
  f.routes.fail = 'session:one';
  await assert.rejects(f.create().migrate(), code('MIGRATION_SELECT_UNVERIFIED'));
  assert.equal(f.stored.items[0].state, 'done');
  assert.equal(f.stored.items[1].state, 'intent');
  f.routes.fail = null;
  assert.equal((await f.create().migrate()).status, 'routes-migrated');
  assert.equal(f.calls.filter(id => id === 'default').length, 1);
});

test('CAS persistence followed by throw or journal failure resumes from durable intent', async () => {
  for (const mode of ['cas-throw', 'journal-failure']) {
    const f = fixture();
    if (mode === 'cas-throw') f.routes.afterSelect = () => { throw new Error(unsafe); };
    else f.journal.failWrite = record => record.items[0].state === 'done';
    await assert.rejects(f.create().migrate(), code(mode === 'cas-throw' ? 'MIGRATION_SELECT_UNVERIFIED' : 'MIGRATION_JOURNAL_FAILED'));
    assert.equal(f.stored.items[0].state, 'intent');
    f.routes.afterSelect = null; f.journal.failWrite = null;
    assert.equal((await f.create().migrate()).status, 'routes-migrated');
    assert.equal(f.calls.filter(id => id === 'default').length, 1);
  }
});

test('concurrent route change fails CAS and preserves unrelated choice on resume', async () => {
  const f = fixture();
  const changed = { provider: 'other', model: 'user-choice' };
  f.routes.beforeSelect = id => { if (id === 'session:one') f.state.items[1].selection = changed; };
  await assert.rejects(f.create().migrate(), code('MIGRATION_ROUTE_CHANGED'));
  const writes = f.writes.length;
  await assert.rejects(f.create().migrate(), code('MIGRATION_ROUTE_CHANGED'));
  assert.deepEqual(f.state.items[1].selection, changed);
  assert.equal(f.writes.length, writes);
  assert.equal(f.calls.filter(id => id === 'session:one').length, 1);
});

test('new, removed, raw-changed and previously done-changed routes refuse resume', async () => {
  for (const change of [
    f => f.state.items.push({ id: 'new', selection: alias() }),
    f => f.state.items.pop(),
    f => { f.state.items[2].selection.model = 'another-raw'; },
    f => { f.state.items[0].selection = alias(); },
  ]) {
    const f = fixture();
    f.routes.fail = 'session:one';
    await assert.rejects(f.create().migrate());
    change(f);
    const before = structuredClone(f.state);
    await assert.rejects(f.create().migrate(), code('MIGRATION_ROUTE_CHANGED'));
    assert.deepEqual(f.state, before);
  }
});

test('resume accepts an exact migrated route only after a durable intent, not a pending step', async () => {
  const f = fixture();
  f.journal.failWrite = record => record.items[0].state === 'intent';
  await assert.rejects(f.create().migrate(), code('MIGRATION_JOURNAL_FAILED'));
  assert.equal(f.stored.items[0].state, 'pending');
  f.state.items[0].selection = downgradeSelection(alias(), f.plan);
  f.journal.failWrite = null;
  await assert.rejects(f.create().migrate(), code('MIGRATION_ROUTE_CHANGED'));
  assert.ok(!f.calls.includes('default'));
});

test('partial, unknown, busy or malformed inventory refuses all side effects', async () => {
  for (const [change, expected] of [
    [f => { f.state.complete = false; }, 'MIGRATION_INCOMPLETE'],
    [f => { f.state.quiescent = false; }, 'MIGRATION_NOT_QUIESCENT'],
    [f => { f.state.items[0].selection.model = '@dsh-key/missing/chat'; }, 'MIGRATION_UNKNOWN_SELECTION'],
    [f => { f.state.items[1].id = 'default'; }, 'MIGRATION_INVALID_INVENTORY'],
    [f => { delete f.state.revision; }, 'MIGRATION_INVALID_INVENTORY'],
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.create().migrate(), code(expected));
    assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
  }
});

test('stage and journal errors are sanitized; stage uncertainty never selects or rolls back', async () => {
  const f = fixture(); f.stage.fail = true;
  await assert.rejects(f.create().migrate(), code('MIGRATION_STAGE_FAILED'));
  assert.equal(f.stored.phase, 'stage-intent');
  assert.ok(!f.calls.includes('default'));
  f.stage.fail = false;
  assert.equal((await f.create().migrate()).status, 'routes-migrated');
  const broken = fixture(); broken.journal.read = async () => { throw new Error(unsafe); };
  await assert.rejects(broken.create().migrate(), code('MIGRATION_JOURNAL_FAILED'));
});

test('shared journal busy guard and idle recheck after staging fail closed', async () => {
  const f = fixture();
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  f.stage.stage = async () => { entered(); await gate; f.state.quiescent = false; return { status: 'staged' }; };
  const pending = f.create().migrate();
  await waiting;
  await assert.rejects(f.create().preview(), code('MIGRATION_BUSY'));
  release();
  await assert.rejects(pending, code('MIGRATION_NOT_QUIESCENT'));
  assert.ok(!f.calls.includes('default'));
});
