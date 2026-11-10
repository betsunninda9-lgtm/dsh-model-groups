import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/native-index.js', import.meta.url), 'utf8');
const imports = [...source.matchAll(/^import .*? from ['"]([^'"]+)['"];$/gm)].map(match => match[1]);
let schemaUrl;
for (const base of [import.meta.url, 'file:///opt/dsh/package.json']) {
  try {
    schemaUrl = pathToFileURL(createRequire(base).resolve('@deepseek-ai/schemastery')).href;
    break;
  } catch {}
}
// Evaluate the real module entirely in memory; no temporary files, installs or
// writes to the host installation are required. Creation registration is mocked
// so schema tests never load host adapters or register an actual endpoint.
const registrarUrl = `data:text/javascript,${encodeURIComponent('export function registerNativeCreation() {}')}`;
const runtime = schemaUrl ? await import(`data:text/javascript;base64,${Buffer.from(
  source.replace("'@deepseek-ai/schemastery'", JSON.stringify(schemaUrl))
    .replace("'./native-create-runtime.js'", JSON.stringify(registrarUrl)),
).toString('base64')}`) : null;
const schemaTest = (title, callback) => test(title, { skip: !runtime && 'installed Schemastery not available' }, callback);
const metadata = () => ({ groups: { work: { name: 'Work', entries: {
  primary: { name: 'Primary', provider: 'native.provider-1' },
} } } });

// Expose only the documented schema builder and a mocked creation registrar,
// without require/process/fetch/console or host services. Other imports denied.
function isolatedRuntime(registerNativeCreation = () => {}) {
  const node = (type, values = {}) => Object.assign({ type, meta: {},
    max(value) { this.meta.max = value; return this; },
    pattern(value) { this.meta.pattern = value; return this; },
    required() { this.meta.required = true; return this; },
    volatile() { this.meta.volatile = true; return this; },
  }, values);
  const z = { string: () => node('string'), object: dict => node('object', { dict }),
    dict: (inner, sKey) => node('dict', { inner, sKey }) };
  assert.deepEqual(imports, ['@deepseek-ai/schemastery', './native-create-runtime.js']);
  const body = source.replace(/^import .*;\n/gm, '').replace(/export /g, '');
  return vm.runInNewContext(`${body}\n;({ Config, apply, validateNativeMetadata });`, { z, registerNativeCreation }, { timeout: 1000 });
}

test('fresh runtime imports only schema and creation registrar, with volatile metadata dictionary', () => {
  const { Config } = isolatedRuntime();
  assert.deepEqual(Object.keys(Config.dict), ['groups']);
  assert.equal(Config.dict.groups.type, 'dict');
  assert.equal(Config.dict.groups.meta.volatile, true);
  assert.deepEqual(Object.keys(Config.dict.groups.inner.dict), ['name', 'entries']);
  assert.deepEqual(Object.keys(Config.dict.groups.inner.dict.entries.inner.dict), ['name', 'provider']);
  assert.doesNotMatch(source, /\b(?:process|require|fetch|setTimeout|setInterval|globalThis)\b|node:|auto-patch|maintenance|native-stage|native-migration|native-host-resolver/);
});

test('apply configures metadata settings under injection, on owning fiber, with effect cleanup', () => {
  const { apply } = isolatedRuntime();
  let injectCallback;
  const fiber = { entry: { options: { id: 'model-groups' } } };
  const ctx = { fiber, inject(names, callback) {
    assert.deepEqual(Array.from(names), ['settings']);
    injectCallback = callback;
  } };
  assert.equal(apply(ctx), undefined);
  assert.equal(typeof injectCallback, 'function');
  let registered = 0, disposed = 0, cleanup;
  const child = { fiber: { entry: { options: { id: 'injected-child' } } },
    settings: { configure(options, owner) {
      assert.deepEqual(Object.keys(options), ['auto']);
      assert.equal(options.auto, false);
      assert.equal(owner, fiber);
      registered++;
      return () => { disposed++; };
    } }, effect(callback) { cleanup = callback(); } };
  injectCallback(child);
  assert.equal(registered, 1);
  assert.equal(disposed, 0);
  cleanup();
  assert.equal(disposed, 1);
});

test('apply delegates creation registration after metadata setup with original context and pure validator', () => {
  const calls = [];
  let runtime;
  const ctx = { fiber: {}, inject(names, callback) {
    calls.push('metadata');
    assert.deepEqual(Array.from(names), ['settings']);
    callback({ effect: effect => effect(), settings: { configure(options, owner) {
      calls.push('configured');
      assert.equal(owner, ctx.fiber);
      return () => {};
    } } });
  } };
  runtime = isolatedRuntime((owner, validateMetadata) => {
    calls.push('creation');
    assert.equal(owner, ctx);
    assert.equal(validateMetadata, runtime.validateNativeMetadata);
  });
  runtime.apply(ctx);
  assert.deepEqual(calls, ['metadata', 'configured', 'creation']);
});

test('namespace is the composition entry id: model-groups is required, not inferred from package', () => {
  const { apply } = isolatedRuntime();
  for (const entryId of ['model-groups', 'some-other-entry']) {
    const owner = { entry: { options: { id: entryId } } };
    const namespaces = [];
    // Host settings.describe() exposes ns: entry.options.id. configure() only
    // attaches presentation policy, so it cannot rename a wrongly composed entry.
    apply({ fiber: owner, inject(names, callback) {
      callback({ effect: effect => effect(), settings: { configure(policy, fiber) {
        namespaces.push(fiber.entry.options.id);
        return () => {};
      } } });
    } });
    assert.deepEqual(namespaces, [entryId]);
    assert.equal(namespaces.includes('model-groups'), entryId === 'model-groups');
  }
});

schemaTest('actual installed schema returns immutable volatile groups without changing native IDs', () => {
  const input = metadata();
  const before = structuredClone(input);
  const parsed = runtime.Config(input);
  assert.equal(typeof parsed.groups.get, 'function');
  assert.deepEqual(parsed.groups.get(), before.groups);
  assert.deepEqual(input, before);
  assert.deepEqual(runtime.Config({}).groups.get(), {});
  const projected = runtime.Config.toJSON();
  assert.ok(projected.refs);
  assert.doesNotMatch(JSON.stringify(projected), /"(?:callback|builder)"/);
});

schemaTest('actual schema rejects unsafe group, entry and provider IDs and overlong names', () => {
  for (const bad of ['', '../bad', 'has space', 'constructor', 'prototype', '__proto__', 'a'.repeat(81)]) {
    const value = metadata();
    value.groups = { [bad]: value.groups.work };
    assert.throws(() => runtime.Config(value));
    const nested = metadata();
    nested.groups.work.entries = { [bad]: { provider: 'provider' } };
    assert.throws(() => runtime.Config(nested));
  }
  for (const bad of ['', '../bad', 'has space', 'constructor', 'prototype', '__proto__', 'a'.repeat(129), 42, null]) {
    const value = metadata();
    value.groups.work.entries.primary.provider = bad;
    assert.throws(() => runtime.Config(value));
  }
  const absent = metadata();
  delete absent.groups.work.entries.primary.provider;
  assert.throws(() => runtime.Config(absent));
  for (const target of ['group', 'entry']) {
    const value = metadata();
    (target === 'group' ? value.groups.work : value.groups.work.entries.primary).name = 'a'.repeat(121);
    assert.throws(() => runtime.Config(value));
  }
  const boundary = { groups: { ['g'.repeat(80)]: { name: 'n'.repeat(120), entries: {
    ['e'.repeat(80)]: { name: 'n'.repeat(120), provider: 'p'.repeat(128) },
  } } } };
  assert.doesNotThrow(() => runtime.Config(boundary));
});

schemaTest('pure metadata validator rejects duplicate provider claims within and across groups', () => {
  assert.equal(runtime.validateNativeMetadata(metadata()), true);
  assert.equal(runtime.validateNativeMetadata({}), true);
  for (const crossGroup of [false, true]) {
    const value = metadata();
    const duplicate = { provider: 'native.provider-1' };
    if (crossGroup) value.groups.other = { entries: { copy: duplicate } };
    else value.groups.work.entries.copy = duplicate;
    const before = structuredClone(value);
    assert.throws(() => runtime.validateNativeMetadata(value), /duplicate provider claim/);
    assert.deepEqual(value, before);
    // Explicit fallback contract: schema has no portable cross-node refinement.
    assert.doesNotThrow(() => runtime.Config(value));
  }
});

schemaTest('pure validation is metadata-only, own-data-only, non-mutating and strict', () => {
  const value = metadata();
  Object.freeze(value.groups.work.entries.primary);
  Object.freeze(value.groups.work.entries);
  Object.freeze(value.groups.work);
  Object.freeze(value.groups);
  Object.freeze(value);
  assert.equal(runtime.validateNativeMetadata(value), true);
  for (const bad of [null, [], { groups: [] }, { providers: {} }, { groups: null },
    { groups: { work: null } }, { groups: { work: { entries: null } } },
    { groups: { work: { entries: { one: { provider: 'constructor' } } } } },
    { groups: { work: { name: 'n'.repeat(121) } } },
    { groups: { work: { entries: { one: { provider: 'safe', apiKey: 'not-metadata' } } } } },
    { groups: Object.create({ inherited: {} }) },
    JSON.parse('{"groups":{"__proto__":{"entries":{}}}}')]) {
    assert.throws(() => runtime.validateNativeMetadata(bad), TypeError);
  }
  let reads = 0;
  const accessor = { get groups() { reads++; return {}; } };
  assert.throws(() => runtime.validateNativeMetadata(accessor), /non-data/);
  assert.equal(reads, 0);
  const empty = Object.create(null);
  assert.equal(runtime.validateNativeMetadata({ groups: empty }), true);
});
