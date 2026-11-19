import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { Config } from '../src/bridge/config.js';
import { createBridgeSettingsStore } from '../src/bridge/settings-store.js';
import { createBridgeController } from '../src/bridge/controller.js';
import { createBridgeRuntime } from '../src/bridge/runtime.js';

const root = process.env.DSH_ROOT ?? '/opt/dsh';
async function modules(t) {
  if (!existsSync(path.join(root, 'package.json'))) { t.skip('Set DSH_ROOT for the actual Settings redactor and service'); return; }
  const require = createRequire(path.join(root, 'package.json'));
  return Promise.all([import(require.resolve('@deepseek-ai/dsh-settings')), import(require.resolve('@deepseek-ai/cordis'))]);
}
const clone = value => structuredClone(value);
const secret = 'synthetic-internal-header-not-a-real-key';
const record = () => ({ enabled: true, active: true, original: { present: true, profile: { headers: { Authorization: `Bearer ${secret}` } } },
  projection: { apiKeyEnv: 'LOCAL_GUARD' }, pending: { before: { profile: { apiKey: secret } }, after: { present: true, profile: {} } },
  keyEntries: { work: { name: 'Work', apiKeyEnv: 'WORK_KEY', models: [{ id: 'wire' }] } } });

test('actual Settings redaction removes the complete internal original and pending trees without mutating them', async t => {
  const loaded = await modules(t); if (!loaded) return;
  const [{ redactSecrets }] = loaded;
  const input = { bridge: { providers: { route: record() } } };
  const before = clone(input);
  const redacted = redactSecrets(Config, input);
  assert.deepEqual(redacted.value, {});
  assert.deepEqual(redacted.secrets, [{ path: ['bridge'], set: true }]);
  assert.equal(JSON.stringify(redacted).includes(secret), false);
  assert.deepEqual(input, before);
  assert.deepEqual(Config(input).bridge.get(), input.bridge, 'the trusted backend still receives the complete volatile data');
});

test('actual Settings describe and CAS mutations keep secret records available to the backend only', async t => {
  const loaded = await modules(t); if (!loaded) return;
  const [{ SettingsForms, SettingsConflictError }, { Context }] = loaded;
  const ctx = new Context();
  const entry = { id: 'synthetic-entry', options: { id: 'model-groups', config: { bridge: { providers: { route: record() } } } } };
  entry.fiber = { uid: 'synthetic-fiber', state: 2, ctx, runtime: { Config }, effectiveConfig: Config(entry.options.config) };
  let edits = 0;
  ctx.provide('configEditor', {
    documentPath: '/synthetic-only/not-written.yml',
    entries: () => [entry],
    configuration: () => [{ entry, inherited: {}, override: clone(entry.options.config) }],
    async edit(target, change) {
      assert.equal(target, entry);
      const next = change(clone(entry.options.config), {});
      entry.fiber.effectiveConfig = Config(next);
      entry.options.config = clone(next);
      edits++;
    },
  });
  // This suite exercises the real public Settings methods, with only the
  // persistence seam kept in memory. No Loader or profile file is started.
  const settings = Object.create(SettingsForms.prototype);
  settings.ownerContext = ctx;
  settings.revisions = new Map();
  settings.presentations = new Map();
  const store = createBridgeSettingsStore(settings);
  const initial = await store.read();
  assert.deepEqual(initial.providers.route, record());
  const remote = settings.describe({ redactSecrets: true })[0];
  assert.deepEqual(remote.value, {});
  assert.deepEqual(remote.user, {});
  assert.equal(JSON.stringify(remote).includes(secret), false);
  assert.equal(settings.describe()[0].value.bridge.providers.route.original.profile.headers.Authorization, `Bearer ${secret}`);
  const updated = { ...record(), enabled: false, active: false };
  const saved = await store.writeProvider('route', updated, initial.revision);
  assert.equal(saved.revision, initial.revision + 1);
  assert.deepEqual(saved.providers.route, updated);
  assert.equal(edits, 1);
  await assert.rejects(() => store.writeProvider('route', record(), initial.revision), SettingsConflictError);
  assert.equal(edits, 1, 'a stale revision may not reach the persistence commit');
  assert.deepEqual((await store.read()).providers.route, updated);
  assert.equal(JSON.stringify(settings.describe({ redactSecrets: true })).includes(secret), false);
});

test('real Settings and native Config normalization commit migration rather than leaving a false conflict', async t => {
  const loaded = await modules(t); if (!loaded) return;
  const [{ SettingsForms }, { Context }] = loaded;
  const require = createRequire(path.join(root, 'package.json'));
  const loadModule = specifier => import(require.resolve(specifier));
  const { Config: NativeConfig } = await loadModule('@deepseek-ai/dsh-llm-pi-ai');
  const original = { api: 'openai-completions', apiKeyEnv: 'ROOT_KEY', baseURL: 'https://fixture.invalid/v1', models: [{ id: 'root' }] };
  const ctx = new Context();
  const schemas = { 'model-groups': Config, 'llm-pi-ai': NativeConfig };
  const entries = Object.entries({ 'model-groups': { bridge: { providers: {} } }, 'llm-pi-ai': { providers: { route: original } } }).map(([id, config]) => {
    const entry = { id, options: { id, config: clone(config) } };
    entry.fiber = { uid: id + '-fixture', state: 2, ctx, runtime: { Config: schemas[id] }, effectiveConfig: schemas[id](clone(config)) };
    return entry;
  });
  ctx.provide('configEditor', { documentPath: '/memory-only/not-written.yml', entries: () => entries,
    configuration: () => entries.map(entry => ({ entry, inherited: {}, override: clone(entry.options.config) })),
    async edit(entry, change) { const next = change(clone(entry.options.config), {}); entry.options.config = clone(next); entry.fiber.effectiveConfig = schemas[entry.options.id](next); },
  });
  const settings = Object.create(SettingsForms.prototype);
  Object.assign(settings, { ownerContext: ctx, revisions: new Map(), presentations: new Map() });
  const storage = createBridgeSettingsStore(settings), native = createBridgeSettingsStore(settings, { namespace: 'llm-pi-ai', path: ['providers'] });
  const runtime = createBridgeRuntime(ctx, { loadModule });
  const draft = { enabled: true, keyEntries: { work: { name: 'Work', apiKeyEnv: 'WORK_KEY', models: [{ id: 'wire' }] } } };
  const controller = createBridgeController({ storage, native, normalizeNative: (route, profile) => runtime.normalizeProfile(route, profile), prepare: async () => ({ guardCredential: 'LOCAL_GUARD' }) });
  try {
    const saved = await controller.save('route', draft, (await storage.read()).revision);
    assert.equal((await controller.snapshot()).providers.route.confirmed, true);
    assert.equal((await storage.read()).providers.route.pending, undefined);
    assert.ok((await native.read()).providers.route.defaultContextWindow > 0, 'real schema defaults participate in the verified projection');
    await controller.save('route', { ...draft, enabled: false }, saved.revision);
    assert.deepEqual((await native.read()).providers.route, await runtime.normalizeProfile('route', original));
    assert.equal((await storage.read()).providers.route.pending, undefined);
  } finally { await runtime.dispose(); }
});

test('a renamed Loader entry reattaches an ignored Settings user override only against its exact native projection', async t => {
  const loaded = await modules(t); if (!loaded) return;
  const [{ SettingsForms }, { Context }] = loaded;
  const require = createRequire(path.join(root, 'package.json'));
  const { Config: NativeConfig } = await import(require.resolve('@deepseek-ai/dsh-llm-pi-ai'));
  const ctx = new Context();
  const schemas = { 'model-groups': Config, 'llm-pi-ai': NativeConfig };
  const overrides = new Map();
  const writes = [];
  const entries = Object.entries({ 'model-groups': {}, 'llm-pi-ai': { providers: { route: { api: 'openai-completions', apiKeyEnv: 'ROOT_KEY', models: [{ id: 'root' }] } } } }).map(([id, config]) => {
    const entry = { id, options: { id, config: clone(config) } };
    entry.fiber = { uid: id, state: 2, ctx, runtime: { Config: schemas[id] }, effectiveConfig: schemas[id](clone(config)) };
    overrides.set(id, clone(config));
    return entry;
  });
  const updateLive = (entry, config) => { entry.options.config = clone(config); entry.fiber.effectiveConfig = schemas[entry.id](clone(config)); };
  ctx.provide('configEditor', { documentPath: '/memory-only/ignored-override.yml', entries: () => entries,
    configuration: () => entries.map(entry => ({ entry, inherited: {}, override: clone(overrides.get(entry.id)) })),
    async edit(entry, change) {
      const next = change(clone(entry.options.config), {});
      updateLive(entry, next); overrides.set(entry.id, clone(next)); writes.push(entry.id);
    },
  });
  const settings = Object.create(SettingsForms.prototype);
  Object.assign(settings, { ownerContext: ctx, revisions: new Map(), presentations: new Map() });
  const storage = createBridgeSettingsStore(settings);
  const native = createBridgeSettingsStore(settings, { namespace: 'llm-pi-ai', path: ['providers'] });
  const normalizeNative = (_route, profile) => JSON.parse(JSON.stringify(NativeConfig({ providers: { route: profile } }).providers.get().route));
  const controller = createBridgeController({ storage, native, normalizeNative, prepare: async () => ({ guardCredential: 'LOCAL_GUARD' }) });
  await controller.save('route', { enabled: true, keyEntries: { work: { name: 'Work', apiKeyEnv: 'WORK_KEY', models: [{ id: 'wire' }] } } }, (await storage.read()).revision);
  const own = entries.find(entry => entry.id === 'model-groups');
  const captured = clone(own.options.config), nativeBefore = clone(await native.read());
  updateLive(own, {}); // The previous-name profile override is skipped by composition.
  assert.deepEqual((await storage.read()).providers, {});
  assert.ok((await storage.readIgnoredProviders()).route);
  writes.length = 0;
  const recovered = await controller.recover();
  assert.deepEqual(recovered.recoveryConflicts, []);
  assert.deepEqual((await storage.read()).providers, captured.bridge.providers);
  assert.equal((await controller.snapshot()).providers.route.confirmed, true);
  assert.deepEqual(writes, ['model-groups'], 'reattachment uses the real public Settings CAS and never rewrites native data');
  assert.deepEqual(await native.read(), nativeBefore);
  await controller.recover();
  assert.equal(writes.length, 1, 'reattachment is idempotent');
  updateLive(own, {}); overrides.set(own.id, captured);
  const nativeEntry = entries.find(entry => entry.id === 'llm-pi-ai');
  updateLive(nativeEntry, { providers: { route: { ...nativeBefore.providers.route, baseURL: 'https://external-edit.invalid' } } });
  writes.length = 0;
  const refused = await controller.recover();
  assert.deepEqual(refused.recoveryConflicts, ['route']);
  assert.deepEqual(writes, []);
  assert.deepEqual((await storage.read()).providers, {});
});
