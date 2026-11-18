import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'acorn';
import { ARTIFACTS, applyPlan, inspectPatches, planPatches, sha256 } from '../scripts/native-patches.mjs';

const port = process.env.DSH_PORT_ROOT;
function copiedRuntime(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-port-roundtrip-'));
  t.after(() => {
    assert.equal(fs.realpathSync(root), root);
    assert.ok(path.basename(root).startsWith('dsh-port-roundtrip-'));
    fs.rmSync(root, { recursive: true });
  });
  fs.copyFileSync(path.join(port, 'package.json'), path.join(root, 'package.json'));
  const originals = new Map();
  for (const name of ARTIFACTS) {
    const manifest = JSON.parse(fs.readFileSync(new URL('../native/' + name, import.meta.url), 'utf8'));
    const file = path.join(root, manifest.target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(port, 'node_modules', manifest.packageName, 'package.json'), path.join(root, 'node_modules', manifest.packageName, 'package.json'));
    const source = fs.readFileSync(path.join(port, manifest.target), 'utf8');
    fs.writeFileSync(file, source);
    originals.set(name, source);
  }
  return { root, originals };
}
function declaration(source, name) {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) found.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  };
  walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  assert.equal(found.length, 1);
  return source.slice(found[0].start, found[0].end);
}
function discovery(source) {
  const calls = [];
  const mocks = {
    supportedProtocols: () => ['openai-completions', 'anthropic-messages'],
    LISTABLE_PROTOCOLS: new Set(['openai-completions', 'anthropic-messages']),
    catalogModels: () => new Map([['catalog-model', { id: 'catalog-model', input: ['text'] }]]),
    listingUrl: (baseURL, api) => baseURL + '/' + api + '/models',
    usableProbeKey: value => value,
    attributionHeaders: () => ({}), ANTHROPIC_VERSION: '2023-06-01', Headers,
    LlmError: class extends Error { constructor(message, code) { super(message); this.code = code; } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: !url.includes('denied'), status: 401 }; },
    readBounded: async () => JSON.stringify({ data: [{ id: 'endpoint-model' }] }),
    readListing: body => body.data,
  };
  return { calls, run: new Function(...Object.keys(mocks), declaration(source, 'discoverModels') + '\nreturn discoverModels;')(...Object.values(mocks)) };
}

test('real port five-file transaction retains host changes and reverses exactly', t => {
  if (!port) return t.skip('Set DSH_PORT_ROOT; only temporary program copies are changed');
  const f = copiedRuntime(t);
  const plans = planPatches(f.root, 'apply');
  assert.ok(plans.every(plan => plan.state === 'pristine'));
  const pi = plans.find(plan => plan.name === 'pi-ai.patch.json');
  const settings = plans.find(plan => plan.name === 'settings-models.patch.json');
  assert.equal(pi.observedSha256, '63d4f51dbaab6d9a34f400dcfe3a3a17c17934c6c9622a21812a0fca99a06000');
  assert.equal(settings.observedSha256, 'ace087aa37adbf8b5e9211afd28bc967974eea42331aced6250c9a72f2644636');
  assert.ok(pi.result.includes('!entryProtocol && (!endpointGiven && request.provider !== void 0)'));
  for (const marker of ['(0, react.useState)([{ id: "" }])', 'models.filter((model) => textOf(model, "id").trim().length > 0)', 'data-dsh-model-catalog', 'aria-hidden']) {
    assert.ok(settings.source.includes(marker), marker);
    assert.ok(settings.result.includes(marker), marker);
  }
  assert.equal(applyPlan(plans, path.join(f.root, 'backups')), 5);
  assert.ok(inspectPatches(f.root).files.every(file => file.code === 'ready'));
  assert.equal(applyPlan(planPatches(f.root, 'apply'), path.join(f.root, 'backups')), 0);
  assert.equal(applyPlan(planPatches(f.root, 'revert'), path.join(f.root, 'backups')), 5);
  for (const plan of plans) {
    assert.equal(fs.readFileSync(plan.file, 'utf8'), f.originals.get(plan.name));
    assert.equal(sha256(fs.readFileSync(path.join(port, plan.artifact.target))), plan.observedSha256, 'source fixture stays read-only');
  }
});

test('actual composed port discovery preserves endpoint priority and isolates selected credentials', async t => {
  if (!port) return t.skip('Set DSH_PORT_ROOT; network is mocked, no model API calls');
  const f = copiedRuntime(t);
  const source = planPatches(f.root, 'apply').find(plan => plan.name === 'pi-ai.patch.json').result;
  const probe = discovery(source);
  assert.equal((await probe.run({ provider: 'catalog' }))[0].id, 'catalog-model');
  assert.equal(probe.calls.length, 0);
  assert.equal((await probe.run({ provider: 'catalog', baseURL: 'https://custom.invalid', apiKey: 'manual-key' }))[0].id, 'endpoint-model');
  assert.equal(probe.calls[0].url, 'https://custom.invalid/openai-completions/models');
  assert.equal(probe.calls[0].options.headers.get('authorization'), 'Bearer manual-key');
  await probe.run({ provider: 'catalog', keyEntryId: 'second' }, () => ({ api: 'anthropic-messages', baseURL: 'https://second.invalid', resolveApiKey: async () => 'second-key', headers: { 'x-host-header': 'retained' } }));
  assert.equal(probe.calls[1].url, 'https://second.invalid/anthropic-messages/models');
  assert.equal(probe.calls[1].options.headers.get('x-api-key'), 'second-key');
  assert.equal(probe.calls[1].options.headers.get('authorization'), null);
  assert.equal(probe.calls[1].options.headers.get('x-host-header'), 'retained');
  await assert.rejects(probe.run({ provider: 'catalog', keyEntryId: 'absent' }), /existing provider key entry/);
  assert.equal(probe.calls.length, 2);
  await assert.rejects(probe.run({ provider: 'catalog', baseURL: 'https://denied.invalid' }), /answered 401/);
  assert.equal(probe.calls.length, 3, 'failed explicit endpoint never falls back to catalog');
});
