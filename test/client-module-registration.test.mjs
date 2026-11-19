import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));

test('the installed file entry names the versioned backend and remains discoverable by the client registry', () => {
  const patch = fs.readFileSync(path.join(repo, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes(`name: ./lib/bridge-host-${manifest.version}.js\n`));
  assert.match(manifest.exports['.'], new RegExp(`bridge-host-${manifest.version.replaceAll('.', '\\.')}\\.js$`));
  assert.equal(manifest.exports['./client'], './lib/client.js');
});

test('real client registry discovers the shipped entry and serves its matching factory; backend subpaths do not', async t => {
  const root = process.env.DSH_ROOT;
  if (!root) return t.skip('DSH_ROOT is required for the actual public client-module registry');
  const require = createRequire(path.join(root, 'package.json'));
  const load = spec => import(pathToFileURL(require.resolve(spec)).href);
  const [{ Context }, { ClientModuleRegistry }, { parsePatchList }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-client-modules'), load('@deepseek-ai/dsh-app-boot'),
  ]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-client-registration-'));
  t.after(() => {
    assert.equal(fs.realpathSync(directory), directory);
    assert.ok(path.basename(directory).startsWith('groups-client-registration-'));
    fs.rmSync(directory, { recursive: true });
  });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
  fs.mkdirSync(path.join(directory, 'node_modules'));
  fs.symlinkSync(repo, path.join(directory, 'node_modules', manifest.name), 'dir');
  const patchFile = path.join(repo, 'cordis.patch.yml');
  const patch = parsePatchList('dsh', patchFile, fs.readFileSync(patchFile, 'utf8'), 'bundle');
  const entryName = patch.flatMap(op => op.insert ?? []).find(row => row.id === 'model-groups').name;
  const makeRegistry = name => {
    const ctx = new Context().extend({ baseUrl: pathToFileURL(path.join(directory, 'cordis.patch.yml')).href });
    ctx.provide('loader', { entries: () => [{ options: { name }, fiber: {}, disabled: false, parent: { tree: { ctx } } }] });
    return new ClientModuleRegistry(ctx);
  };
  const previous = makeRegistry(`${manifest.name}/bridge/${manifest.version}`);
  assert.equal(previous.graph().entries.some(row => row.id === manifest.name), false, 'a backend subpath silently omits the browser half');
  const registry = makeRegistry(entryName);
  const entry = registry.graph().entries.find(row => row.id === manifest.name);
  assert.ok(entry, 'the actual shipped Loader row must publish the frontend in the boot graph');
  assert.equal(fs.realpathSync(registry.clientPath(manifest.name)), fs.realpathSync(path.join(repo, 'lib/client.js')));
  assert.equal(entryName, pathToFileURL(path.join(repo, `lib/bridge-host-${manifest.version}.js`)).href, 'use the actual anchored patch parser, not a hand-built entry');
  const host = await import(entryName);
  assert.equal(typeof host.setupBridgeHost, 'function', 'the same entry must import the public-service backend');
  assert.ok(entry.inject.includes('@deepseek-ai/dsh-client-ui-settings-models'));
  const response = await registry.fetchBundle(new Request(new URL(entry.url, 'http://127.0.0.1')));
  assert.equal(response.status, 200);
  const registrations = [];
  vm.runInNewContext(await response.text(), {
    window: { __ModuleLoader__: { load: registration => registrations.push(registration) } },
  });
  assert.deepEqual(registrations.map(row => row.id), [manifest.name]);
  assert.equal(typeof registrations[0].factory, 'function');
});
