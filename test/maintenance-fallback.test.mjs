import test from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackSelection, FALLBACK_HOST_APIS } from '../src/maintenance-fallback.js';

const previous = { provider: 'p', model: '@dsh-key/entry/m', reasoningEffort: 'high' };
const next = { provider: 'p', model: 'ordinary' };
function fixture(overrides = {}) {
  let current = { ...previous }, persisted = { ...previous }, defaults = { ...previous };
  const writes = [];
  const agent = { id: 's', status: 'idle', phase: { kind: 'idle' }, session: { seq: 3 },
    model: { current: () => ({ ...current }), select(value) { writes.push(['session', value]); current = { ...value }; agent.session.seq++; } } };
  let live = agent;
  const options = {
    catalog: { groups: [{ id: 'p', models: [{ id: 'ordinary', reasoning: { efforts: [{ id: 'low' }] } }, { id: '@dsh-key/x/y' }] }, { id: 'unknown', models: [{ id: 'other' }] }] },
    ordinaryProviders: ['p'], agents: { get: () => live },
    sessions: { async flush() { writes.push(['flush']); persisted = { ...current }; return true; } },
    defaultModel: { currentSelection: () => ({ ...defaults }), remembersLastSelection: () => true,
      async saveSelection(value, { ifCurrent }) { assert.deepEqual(ifCurrent, defaults); writes.push(['default', value]); defaults = { ...value }; return { status: 'saved' }; } },
    readPersistedSelection: async () => persisted,
    ...overrides,
  };
  const api = createFallbackSelection(options);
  const preview = (target = { kind: 'session', sessionId: 's' }, value = next) => api.preview({ target, next: value });
  const apply = report => api.apply({ token: report.token, confirmation: 'CONFIRM FALLBACK SELECTION' });
  return { api, preview, apply, agent, writes, options, setCurrent: value => { current = value; }, replace: () => { live = { ...agent }; } };
}

test('pure preview only exposes allowlisted ordinary catalog and retains removal blockers', () => {
  const f = fixture();
  assert.deepEqual(f.api.catalog(), [{ provider: 'p', model: 'ordinary', efforts: ['low'] }]);
  const report = f.preview();
  assert.equal(report.canApply, true);
  assert.equal(report.safeToRemovePatches, false);
  assert.equal(report.removalBlockers.length, 3);
  assert.deepEqual(f.writes, []);
  report.next.model = 'tampered';
  assert.equal(f.preview().next.model, 'ordinary');
});

test('explicit selection appends through live AgentModel then flushes and verifies persistence', async () => {
  const f = fixture();
  const result = await f.apply(f.preview());
  assert.equal(result.status, 'applied');
  assert.equal(result.safeToRemovePatches, false);
  assert.deepEqual(f.writes, [['session', next], ['flush']]);
});

test('defaults use ifCurrent CAS without touching live session', async () => {
  const f = fixture();
  const result = await f.apply(f.preview({ kind: 'default' }));
  assert.equal(result.status, 'applied');
  assert.deepEqual(f.writes, [['default', next]]);
});

test('rejects aliases, unknown provider, unsupported effort and extra selection fields', () => {
  const f = fixture();
  for (const value of [{ provider: 'p', model: '@dsh-key/x/y' }, { provider: 'unknown', model: 'other' },
    { ...next, reasoningEffort: 'high' }, { ...next, key: 'never' }]) {
    assert.equal(f.preview(undefined, value).canApply, false);
  }
  assert.deepEqual(f.writes, []);
});

test('catalog alone cannot certify provider ordinary routing', () => {
  const f = fixture({ ordinaryProviders: [] });
  assert.equal(f.preview().canApply, false);
});

test('session CAS rejects model, effort, revision, activity and identity changes', async () => {
  for (const mutate of [f => f.setCurrent(next), f => f.setCurrent({ ...previous, reasoningEffort: 'low' }),
    f => f.agent.session.seq++, f => { f.agent.status = 'running'; }, f => f.replace()]) {
    const f = fixture(); const report = f.preview(); mutate(f);
    assert.equal((await f.apply(report)).status, 'not-applied');
    assert.deepEqual(f.writes, []);
  }
});

test('cold, busy, ordinary current and missing persistence observations are unsupported', () => {
  for (const change of [f => { f.options.agents.get = () => undefined; }, f => { f.agent.status = 'running'; },
    f => f.setCurrent(next)]) {
    const f = fixture(); change(f); assert.equal(f.preview().canApply, false);
  }
  assert.equal(fixture({ readPersistedSelection: undefined }).preview().canApply, false);
});

test('fixed defaults never use unsafe config writes', () => {
  const f = fixture({ defaultModel: { currentSelection: () => previous, remembersLastSelection: () => false, saveSelection() { throw new Error('must not call'); } } });
  assert.equal(f.preview({ kind: 'default' }).blockers[0].code, 'FIXED_DEFAULT_UNSUPPORTED');
});

test('default CAS refusal is not success and propagates no host details', async () => {
  const f = fixture({ defaultModel: { currentSelection: () => previous, remembersLastSelection: () => true,
    async saveSelection() { return { status: 'skipped', code: 'settings/default-changed' }; } } });
  const result = await f.apply(f.preview({ kind: 'default' }));
  assert.equal(result.status, 'not-applied');
  assert.equal(result.code, 'DEFAULT_CAS_REJECTED');
  assert.equal(result.mayHaveChanged, true);
});

test('missing flush listener, flush failure and persisted mismatch never claim success', async () => {
  for (const overrides of [{ sessions: { flush: async () => false } },
    { sessions: { flush: async () => { throw new Error('SECRET'); } } },
    { readPersistedSelection: async () => previous }]) {
    const f = fixture(overrides);
    const result = await f.apply(f.preview());
    assert.equal(result.status, 'changed-unverified');
    assert.equal(result.mayHaveChanged, true);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});

test('post-flush live model changes are detected; no rollback overrides newer choice', async () => {
  const f = fixture();
  f.options.sessions.flush = async () => { f.setCurrent(previous); return true; };
  const result = await f.apply(f.preview());
  assert.equal(result.status, 'changed-unverified');
  assert.equal(result.code, 'POSTCHECK_FAILED');
  assert.equal(f.writes.length, 1);
});

test('confirmation is explicit, one-use, bounded by TTL and does not accept target replacement', async () => {
  let now = 0;
  const f = fixture({ now: () => now });
  const report = f.preview();
  await assert.rejects(f.api.apply({ token: report.token }), { code: 'CONFIRMATION_REQUIRED' });
  await assert.rejects(f.api.apply({ token: report.token, confirmation: 'CONFIRM FALLBACK SELECTION', next }), { code: 'CONFIRMATION_REQUIRED' });
  await f.apply(report);
  await assert.rejects(f.apply(report), { code: 'CONFIRMATION_REQUIRED' });
  const g = fixture({ now: () => now }); const expired = g.preview(); now = 120001;
  await assert.rejects(g.apply(expired), { code: 'CONFIRMATION_REQUIRED' });
});

test('concurrent adapter operations are rejected rather than silently reordered', async () => {
  let release;
  const f = fixture({ sessions: { flush: () => new Promise(resolve => { release = resolve; }) } });
  const a = f.preview(); const b = f.preview();
  const first = f.apply(a);
  await assert.rejects(f.apply(b), { code: 'BUSY' });
  release(false);
  assert.equal((await first).status, 'changed-unverified');
});

test('host API report accurately warns about missing session CAS and catalog network', () => {
  assert.match(FALLBACK_HOST_APIS.defaults, /ifCurrent/);
  assert.match(FALLBACK_HOST_APIS.durability, /sessions.flush/);
  assert.match(FALLBACK_HOST_APIS.catalog, /network/);
  assert.match(FALLBACK_HOST_APIS.limitation, /No host session-selection CAS/);
});
