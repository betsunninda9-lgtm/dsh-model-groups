import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The real boot installs PluginPackages before mounting profile plugins. A bare
// Loader alone deliberately does not reproduce that package-resolution chain.
// Use a normal child .mjs: Cordis's resolver worker inherits process.execArgv,
// so --input-type=module would prevent its worker from starting.
test('default bridge loader resolves installation APIs from an isolated profile through the public boot resolver', t => {
  const root = process.env.DSH_ROOT;
  if (!root) return t.skip('DSH_ROOT is required for the real public Loader integration');
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profileRoot = process.env.DSH_PROFILE_ROOT || path.join(home, 'profiles', 'web');
  const manifestPath = path.join(profileRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) return t.skip('A profile package-metadata fixture is required (DSH_PROFILE_ROOT)');
  const originalManifest = fs.readFileSync(manifestPath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-bridge-loader-'));
  t.after(() => {
    assert.equal(fs.realpathSync(directory), directory);
    assert.ok(path.basename(directory).startsWith('groups-bridge-loader-'));
    fs.rmSync(directory, { recursive: true });
  });
  const fixtureProfile = path.join(directory, 'profile');
  fs.mkdirSync(fixtureProfile);
  // Copy metadata only. Never read the real user configuration or credentials;
  // any resolver helper file, should a runtime require one, stays in this temp.
  fs.writeFileSync(path.join(fixtureProfile, 'package.json'), originalManifest);
  const modules = path.join(profileRoot, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(fixtureProfile, 'node_modules'), 'dir');
  const script = path.join(directory, 'probe.mjs');
  fs.writeFileSync(script, String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { root, profileRoot, home, runtimeUrl } = JSON.parse(process.env.GROUPS_LOADER_FIXTURE);
const { createBridgeRuntime } = await import(runtimeUrl);
const require = createRequire(root + '/package.json');
const load = specifier => import(pathToFileURL(require.resolve(specifier)).href);
const [{ Context }, { LlmRuntime }, { Loader }, boot] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'),
  load('@deepseek-ai/cordis-plugin-loader'), load('@deepseek-ai/dsh-app-boot'),
]);
const { createRuntimeResolution, loadProfileDirectory, PluginPackages } = boot;
assert.equal(typeof createRuntimeResolution, 'function');
assert.equal(typeof PluginPackages, 'function');
const installAnchor = require.resolve('@deepseek-ai/dsh/package.json');
const profile = loadProfileDirectory('groups-readonly-loader-test', profileRoot, installAnchor, { readOnly: true, userLayer: false });
const resolution = await createRuntimeResolution({ installAnchor, profile, home });
let commits = 0, httpRequests = 0, credentialWrites = 0;
class EphemeralLoader extends Loader { commit() { commits += 1; } }
const ctx = new Context().extend({ baseUrl: pathToFileURL(profileRoot + '/cordis.patch.yml').href });
const loader = new EphemeralLoader(ctx);
assert.equal(typeof ctx.get('loader').import, 'function');
const main = new LlmRuntime(ctx);
ctx.provide('credentials', {
  async resolve(ref) { return { value: 'local-dummy-' + ref }; },
  async readRecord() {}, async listRecords() { return []; },
  async store() { credentialWrites += 1; throw new Error('Unexpected credential write'); },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { httpRequests += 1; throw new Error('Metadata preparation must not perform HTTP'); };
const packagesFiber = ctx.plugin(PluginPackages, { resolution });
await packagesFiber;
const runtime = createBridgeRuntime(ctx); // Exercise the production default: no loadModule override.
try {
  const original = { api: 'openai-completions', apiKeyEnv: 'ROOT', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'native-root', contextWindow: 8192, maxTokens: 1000 }] };
  const draft = { keyEntries: { a: { api: 'openai-completions', apiKeyEnv: 'ENTRY_A', models: [{ id: 'wire-a', contextWindow: 4096, maxTokens: 500 }] } } };
  const prepared = await runtime.prepare('groups-default-loader-proof', draft, original);
  assert.deepEqual(prepared.models.legacy.map(row => row.id), ['native-root']);
  assert.deepEqual(prepared.models.keyEntries.a.map(row => row.id), ['wire-a']);
  assert.equal(await runtime.probeProjection('groups-default-loader-proof', original, 'native-root'), true);
  assert.equal(httpRequests, 0); assert.equal(commits, 0); assert.equal(credentialWrites, 0);
  assert.equal(main.listProviders().length, 0); assert.equal(Object.keys(loader.store).length, 0);
  assert.equal(typeof ctx.get('pluginPackages').packageOf('@deepseek-ai/dsh-llm', ctx.baseUrl)?.dir, 'string');
  console.log(JSON.stringify({ defaultLoader: true, publicBootResolution: true, profileScoped: true, probeProjection: true, httpRequests, loaderCommits: commits, credentialWrites, mainRegistryUnchanged: true }));
} finally {
  await runtime.dispose();
  await packagesFiber.dispose();
  globalThis.fetch = originalFetch;
}
`);
  const environment = {
    ...process.env,
    GROUPS_LOADER_FIXTURE: JSON.stringify({ root, profileRoot: fixtureProfile, home, runtimeUrl: new URL('../src/bridge/runtime.js', import.meta.url).href }),
  };
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [script], { env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.deepEqual(report, {
    defaultLoader: true, publicBootResolution: true, profileScoped: true, probeProjection: true,
    httpRequests: 0, loaderCommits: 0, credentialWrites: 0, mainRegistryUnchanged: true,
  });
  assert.deepEqual(fs.readFileSync(manifestPath), originalManifest, 'the real profile manifest must remain byte-identical');
});
