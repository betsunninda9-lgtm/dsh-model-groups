import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dependencySignals, sessionDependencies, createHostInspection } from '../src/maintenance-host.js';

test('dependency scanner detects nested disabled configurations without exposing content', () => {
  const value = [{ disabled: true, config: { multiKey: true, keyEntries: { privateName: { apiKeyEnv: 'SECRET' } } } }, { config: { model: '@dsh-key/key/model' } }];
  assert.deepEqual(dependencySignals(value), { alias: 1, keys: 1, expression: 0 });
  assert.deepEqual(dependencySignals({ multiKey: false, keyEntries: {} }), { alias: 0, keys: 0, expression: 0 });
  assert.equal(dependencySignals({ model: { __jsExpr: 'secret-expression' } }).expression, 1);
});

test('current selection folds independently while forkable request history and descriptors remain dependencies', () => {
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: '@dsh-key/old/m' } } } },
    { type: 'model/selection', data: { provider: 'p', model: 'normal' } },
    { type: 'subagent/descriptor', data: { provider: 'spawn', agentModel: '@dsh-key/child/m' } },
  ];
  const state = sessionDependencies(events);
  assert.equal(state.routes[0].model, 'normal');
  assert.equal(dependencySignals(state.routes).alias, 2);
  assert.throws(() => sessionDependencies([{ type: 'request/header', data: {} }]));
});

test('95 irrelevant scalar expressions are not blanket blockers; unknown roots and sensitive routes are', () => {
  const expr = { __jsExpr: 'not evaluated' };
  const generic = Array.from({ length: 95 }, (_, i) => ({ id: `generic-${i}`, name: 'unrelated-plugin', config: { timeout: expr } }));
  assert.deepEqual(dependencySignals(generic), { alias: 0, keys: 0, expression: 0 });
  for (const value of [expr, { name: expr }, { plugin: expr }, { config: expr }, { config: { unknown: expr } },
    { config: { models: expr } }, { config: { provider: expr } }, { config: { model: expr } },
    { config: { multiKey: expr } }, { config: { keyEntries: expr } },
    { config: { providers: { timeout: expr } } }, { config: { models: [expr] } },
    { config: { timeout: { model: expr } } }]) assert.ok(dependencySignals(value).expression > 0);
  assert.equal(dependencySignals([...generic, { config: { model: expr } }]).expression, 1);
  assert.equal(dependencySignals({ config: { timeout: { model: '@dsh-key/k/m' } } }).alias, 1);
});

test('pending selection survives mismatching headers including effort; only full matching header retires it', () => {
  const selection = { provider: 'p', model: '@dsh-key/pending/m', reasoningEffort: 'high' };
  const header = config => ({ type: 'request/header', data: { header: { config } } });
  const selected = { type: 'model/selection', data: selection };
  for (const route of [{ provider: 'p', model: 'other' }, { ...selection, reasoningEffort: 'low' }]) {
    assert.deepEqual(sessionDependencies([selected, header(route)]).routes[0], selection);
  }
  const matching = header(selection);
  assert.equal(sessionDependencies([selected, matching, header({ provider: 'p', model: 'normal' })]).routes[0].model, 'normal');
  const defaulted = header({ provider: 'p', model: 'normal', reasoningEffort: 'medium' });
  defaulted.data.header.adapterDefaults = { reasoningEffort: true };
  assert.equal(sessionDependencies([{ type: 'model/selection', data: { provider: 'p', model: 'normal' } }, defaulted,
    header({ provider: 'q', model: 'next' })]).routes[0].model, 'next');
  assert.equal(dependencySignals(sessionDependencies([{ type: 'subagent/model-selection-policy', data: { allowedModels: [{ provider: 'p', model: '@dsh-key/policy/m' }] } }]).routes).alias, 1);
});

test('inspection reads fixture profiles only and blocks other-profile residuals and live selection', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-maintenance-host-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'install'), home = path.join(temp, 'home');
  const boot = path.join(root, 'node_modules/@deepseek-ai/dsh-app-boot');
  fs.mkdirSync(boot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(boot, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(boot, 'index.js'), `import fs from 'node:fs'; import path from 'node:path';
    export const PROFILES_DIR = 'profiles';
    export function loadProfileDirectory(_, dir, anchor, options) {
      if (options.readOnly !== true) throw Error('write prohibited');
      return {patchPath:path.join(dir,'patch.json'), patches:JSON.parse(fs.readFileSync(path.join(dir,'patch.json'))), layers:[], skippedBundles:[]};
    }
    export function readProfilePatches(_, context, loaded) { return [...loaded.patches,...context.overlays]; }
    export function composeEntries(layers) { return layers.flat(); }
  `);
  for (const name of ['current', 'other']) {
    const dir = path.join(home, 'profiles', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: name === 'other' ? { 'dsh-model-groups': '*' } : {} }));
    fs.writeFileSync(path.join(dir, 'patch.json'), JSON.stringify(name === 'other' ? [{ disabled: true, config: { multiKey: true, keyEntries: { hidden: {} } } }] : []));
  }
  const ctx = {
    profileContext: { dir: path.join(home, 'profiles/current'), home, overlays: [], installAnchor: path.join(root, 'package.json') },
    configEditor: { configuration: () => [] }, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'normal' }) },
    settings: { describe: () => [] }, sessionPersistence: {}, agents: { list: () => [] },
    sessionQuery: { listSessions: async () => [{ header: { id: 's' }, live: true }], readSession: async () => ({ session: { id: 's' }, events: [{ type: 'model/selection', data: { model: '@dsh-key/live/m' } }] }) },
  };
  const inspect = createHostInspection(ctx, root, home);
  const before = fs.readFileSync(path.join(home, 'profiles/other/patch.json'), 'utf8');
  const result = await inspect();
  assert.ok(result.blockers.some(b => b.code === 'cross_profile_bundle'));
  assert.ok(result.blockers.some(b => b.code === 'key_config_dependency'));
  assert.ok(result.blockers.some(b => b.code === 'alias_dependency'));
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(temp));
  assert.ok(!JSON.stringify(result).includes('@dsh-key'));
  assert.equal(fs.readFileSync(path.join(home, 'profiles/other/patch.json'), 'utf8'), before);
  ctx.agents.list = () => [{ id: 'a', options: {}, model: { current: () => undefined }, status: 'idle', phase: { kind: 'maintenance' } }];
  assert.ok((await inspect()).blockers.some(b => b.code === 'active_turns'));
  delete ctx.sessionPersistence;
  assert.ok(!(await inspect()).blockers.some(b => b.code === 'session_service_missing'));
  ctx.sessionPersistence = {};
  ctx.agents.list = () => [{ id: 'unknown', options: {}, model: { current: () => undefined }, status: 'future-status' }];
  const unknownActivity = await inspect();
  assert.ok(unknownActivity.blockers.some(b => b.code === 'activity_unverified'));
  assert.ok(!unknownActivity.blockers.some(b => b.code === 'active_turns'));
  ctx.agents.list = () => [];
  ctx.sessionQuery.listSessions = async () => [];
  fs.writeFileSync(path.join(home, 'profiles/other/package.json'), '{}');
  fs.writeFileSync(path.join(home, 'profiles/other/patch.json'), '[]');
  const clean = await inspect();
  // A fixture installation has no competing DSH processes; the clean path stays usable.
  assert.deepEqual(clean.blockers, []);
  assert.notEqual(clean.fingerprint, result.fingerprint);
  let describeCalls = 0;
  ctx.settings.describe = () => { describeCalls++; throw Error('must never evaluate settings'); };
  assert.deepEqual((await inspect()).blockers, []);
  assert.equal(describeCalls, 0);
  ctx.configEditor.configuration = () => [{ entry: { options: { name: 'route', config: { model: { __jsExpr: 'opaque' } } } } }];
  assert.ok((await inspect()).blockers.some(b => b.code === 'expression_unknown'));
  ctx.configEditor.configuration = () => { throw Error('private config failure'); };
  ctx.agentDefaultModel.currentSelection = () => { throw Error('private default failure'); };
  ctx.sessionQuery.listSessions = async () => { throw Error('private session-list failure'); };
  ctx.agents.list = () => [{ id: 'a', options: {}, model: { current: () => { throw Error('private model failure'); } }, status: 'idle', phase: { kind: 'maintenance' } }];
  let failure = await inspect();
  for (const code of ['config_inspection_failed', 'default_inspection_failed', 'session_inspection_failed', 'agent_inspection_failed', 'active_turns']) {
    assert.ok(failure.blockers.some(b => b.code === code), code);
  }
  assert.ok(!JSON.stringify(failure).includes('private'));
  assert.equal(describeCalls, 0);
  const duplicate = { entry: { options: { name: 'route', config: { model: '@dsh-key/duplicate/m' } } } };
  ctx.configEditor.configuration = () => [duplicate, duplicate];
  assert.equal((await inspect()).blockers.find(b => b.code === 'alias_dependency').count, 1);
  ctx.configEditor.configuration = () => [];
  ctx.agentDefaultModel.currentSelection = () => ({ provider: 'p', model: 'normal' });
  ctx.agents.list = () => [{ id: 'running', options: {}, model: { current: () => undefined }, status: 'running', phase: { kind: 'new-phase' } }];
  assert.ok((await inspect()).blockers.some(b => b.code === 'active_turns'));
  ctx.agents.list = () => [];
  ctx.sessionQuery.listSessions = async () => [{ header: { id: 's' }, live: false, persisted: true }];
  ctx.sessionQuery.readSession = async id => { assert.equal(id, 's'); throw Error('private session failure'); };
  failure = await inspect();
  assert.ok(failure.blockers.some(b => b.code === 'session_inspection_failed'));
  assert.ok(!failure.blockers.some(b => b.code === 'session_service_missing'));
  // One failed snapshot does not suppress later live sessions or their dependencies.
  const reads = [];
  ctx.sessionQuery.listSessions = async () => ['bad', 'good'].map(id => ({ header: { id }, live: true }));
  const session = { id: 'good' }; session.self = session;
  let body = 'private chat text';
  ctx.sessionQuery.readSession = async id => {
    reads.push(id);
    if (id === 'bad') throw Error('private snapshot failure');
    return { session, events: [{ type: 'message', data: { body, session } },
      { type: 'model/selection', data: { provider: 'p', model: '@dsh-key/good/m' } }, { type: 'turn/start' }] };
  };
  failure = await inspect();
  assert.deepEqual(reads, ['bad', 'good']);
  for (const code of ['session_inspection_failed', 'alias_dependency', 'active_turns']) assert.ok(failure.blockers.some(b => b.code === code), code);
  assert.ok(!JSON.stringify(failure).includes('private'));
  body = 'entirely different chat text';
  assert.equal((await inspect()).fingerprint, failure.fingerprint);
  ctx.sessionQuery.listSessions = async () => [{ header: { id: 'good' }, live: false }];
  assert.ok(!(await inspect()).blockers.some(b => b.code === 'active_turns'));
  ctx.sessionQuery.listSessions = async () => [{ header: { id: 'good' }, live: true }];
  ctx.sessionQuery.readSession = async () => ({ session, events: [{ type: 'request/header', data: {} }, { type: 'turn/start' }] });
  failure = await inspect();
  assert.ok(failure.blockers.some(b => b.code === 'session_inspection_failed'));
  assert.ok(failure.blockers.some(b => b.code === 'active_turns'));
  delete ctx.sessionQuery;
  assert.ok((await inspect()).blockers.some(b => b.code === 'session_service_missing'));
  const readdirSync = fs.readdirSync;
  try {
    fs.readdirSync = function (target, ...args) {
      if (target === '/proc') throw Error('private process failure');
      return readdirSync.call(this, target, ...args);
    };
    failure = await inspect();
    assert.ok(failure.blockers.some(b => b.code === 'process_inspection_failed'));
    assert.ok(!JSON.stringify(failure).includes('private'));
  } finally { fs.readdirSync = readdirSync; }
});
