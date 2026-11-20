import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { setupBridgeHost } from '../src/bridge/host.js';
import { MODELS_CLIENT_ID } from '../src/bridge/editor-interface.js';

// Exercise the shipped activation, not a manually prepared interface.
for (const [name, env] of [['host', 'DSH_MODELS_CLIENT'], ['port', 'DSH_PORT_ROOT']]) test(`fresh ${name}: startup installs editor, then an owner enables a first key group`, async t => {
  const sourceFile = env === 'DSH_MODELS_CLIENT' ? process.env[env] : process.env[env] && path.join(process.env[env], 'node_modules', MODELS_CLIENT_ID, 'lib/client.js');
  if (!sourceFile) return t.skip(`${env} required`);
  const originalSource = fs.readFileSync(sourceFile, 'utf8');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-fresh-host-'));
  t.after(() => { assert.equal(fs.realpathSync(directory), directory); assert.ok(path.basename(directory).startsWith('groups-fresh-host-')); fs.rmSync(directory, { recursive: true }); });
  const pkg = path.join(directory, 'models'); fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: MODELS_CLIENT_ID, exports: { './client': './lib/client.js' } }));
  const target = path.join(pkg, 'lib/client.js'); fs.writeFileSync(target, originalSource);
  const beforeHome = process.env.DSH_HOME; process.env.DSH_HOME = path.join(directory, 'home');
  t.after(() => { if (beforeHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = beforeHome; });
  const copy = value => structuredClone(value);
  const memory = profiles => { let value = { revision: 0, providers: copy(profiles) }; return { read: async () => copy(value), async writeProvider(id, profile, revision) { assert.equal(revision, value.revision); value = { revision: revision + 1, providers: { ...value.providers, [id]: copy(profile) } }; return copy(value); } }; };
  const storage = memory({}), native = memory({ brandnew: { api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'ROOT', models: [{ id: 'root' }] } });
  let handler, publishes = 0, credentialWrites = 0;
  const registry = { clientPath: () => target, rebuilt: () => `published-${++publishes}`, onGraphChanged: () => () => {} };
  const ctx = { get: key => key === 'clientModules' ? registry : undefined, settings: { documentPath: '/memory/fixture-not-written.yml' }, logger: { warn() {} }, on: () => () => {}, effect: callback => callback(),
    webServer: { register(route) { handler = route.handler; return () => {}; } }, connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) }, credentials: { describe: async () => ({ configured: true }), set: async () => { credentialWrites++; } } };
  const runtime = { prepare: async (_provider, draft, original) => ({ models: { legacy: original.models, keyEntries: Object.fromEntries(Object.entries(draft.keyEntries).map(([id, key]) => [id, key.models])) } }), probeProjection: async () => true, dispose: async () => {} };
  const host = setupBridgeHost(ctx, { storage, native, runtime }); await host.ready;
  assert.equal(publishes, 1); assert.ok(fs.readFileSync(target, 'utf8').includes('editor-interface@1'));
  const request = async (method, body) => { const req = Readable.from(body ? [JSON.stringify(body)] : []); Object.assign(req, { method, headers: { 'content-type': 'application/json' } }); let code, result; await handler(req, { writeHead(value) { code = value; }, end(value) { result = JSON.parse(value); } }); assert.equal(code, 200); return result.value; };
  const first = await request('GET'); assert.equal(first.editorInterface.state, 'ready'); assert.equal(first.providers.brandnew.enabled, false); assert.equal(credentialWrites, 0);
  const after = await request('POST', { action: 'save', provider: 'brandnew', expectedRevision: first.revision, draft: { enabled: true, keyEntries: { first: { name: 'First key', apiKeyEnv: 'FIRST_KEY', models: [{ id: 'wire-model' }] } } } });
  assert.equal(after.providers.brandnew.confirmed, true); assert.equal(after.providers.brandnew.keyEntries.first.apiKeyEnv, 'FIRST_KEY');
  assert.equal((await storage.read()).providers.brandnew.active, true); assert.equal(credentialWrites, 0);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), originalSource);
});
