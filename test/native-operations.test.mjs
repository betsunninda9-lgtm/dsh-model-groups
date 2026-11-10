import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeOperations } from '../src/native-operations.js';
import { planNativeSave } from '../src/native-save.js';

const group = () => ({ id: 'vendor', shared: { displayName: 'Vendor',
  api: 'openai-completions', baseURL: 'https://example.invalid/v1' }, entries: [
  { id: 'one', name: 'One', apiKeyEnv: 'FIXTURE_ONE', models: [{ id: 'chat', name: 'Chat',
    contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false }] },
] });
const live = (id = 'actual-native') => ({ entry: { options: { id },
  fiber: { state: 2, runtime: { name: 'llm-pi-ai' } } } });
const safeError = expected => error => {
  assert.equal(error.code, expected);
  assert.equal(error.message, expected);
  assert.equal(error.stack, expected);
  assert.deepEqual(Object.keys(error).sort(), ['code']);
  return true;
};
function fixture() {
  const docs = [
    { ns: 'actual-native', revision: 3, value: { providers: { unrelated: { models: [] } } } },
    { ns: 'metadata', revision: 5, value: { groups: {} } },
  ];
  const writes = [], parses = [], resolves = [], metadataChecks = [];
  const configEditor = { configuration: () => [live()] };
  const settings = {
    async describe(options) {
      assert.deepEqual(options, { redactSecrets: true });
      return structuredClone(docs);
    },
    async mutate(ns, operations, revision) {
      writes.push(structuredClone({ ns, operations, revision }));
      const doc = docs.find(item => item.ns === ns);
      assert.equal(doc.revision, revision);
      for (const { op, path, value } of operations) {
        assert.equal(op, 'set');
        assert.equal(path.length, 2);
        assert.ok(!Object.hasOwn(doc.value[path[0]], path[1]));
        doc.value[path[0]][path[1]] = structuredClone(value);
      }
      doc.revision++;
    },
  };
  const dependencies = { settings, configEditor, metadataNamespace: 'metadata',
    validateMetadata(value) { metadataChecks.push(structuredClone(value)); return true; },
    nativeConfig: { parse(value) { parses.push(structuredClone(value)); return structuredClone(value); } },
    resolveNative(providers) {
      resolves.push(structuredClone(providers));
      return new Map(Object.keys(providers).map(id => [id, id === 'unrelated'
        ? { catalogError: 'Unrelated built-in is unavailable', modelErrors: new Map([['old', 'bad']]) }
        : { modelErrors: new Map(), piProvider: {} }]));
    },
  };
  return { docs, writes, parses, resolves, metadataChecks, dependencies, configEditor,
    operations: createNativeOperations(dependencies) };
}
async function save(operations, input = group()) {
  const preview = await operations.preview(input);
  return operations.save(input, preview.revision, preview.fingerprint);
}

test('uses exactly the live runtime entry namespace; preview is read-only and metadata follows providers', async () => {
  const f = fixture();
  f.configEditor.configuration = () => [live(), { ...live('disabled'), entry: {
    ...live('disabled').entry, fiber: { state: 0, runtime: { name: 'llm-pi-ai' } } } },
    { entry: { options: { id: 'pi-ai' }, fiber: { state: 2, runtime: { name: 'other' } } } }];
  const preview = await f.operations.preview(group());
  assert.equal(preview.status, 'preview');
  assert.equal(preview.revision, 3);
  assert.deepEqual(preview.counts, { providers: 1, models: 1 });
  assert.equal(f.writes.length, 0);
  assert.equal(f.parses.length, 0);
  assert.equal(f.resolves.length, 0);
  assert.deepEqual(await f.operations.save(group(), preview.revision, preview.fingerprint), {
    status: 'saved', nativeStatus: 'saved', counts: { providers: 1, models: 1 },
  });
  assert.deepEqual(f.writes.map(item => item.ns), ['actual-native', 'metadata']);
  assert.equal(f.parses.length, 1);
  assert.deepEqual(f.parses[0], { providers: f.resolves[0] });
  assert.ok(f.metadataChecks.length >= 2);
  assert.equal((await save(f.operations)).nativeStatus, 'unchanged');
  assert.equal(f.writes.length, 2);
  assert.equal(f.parses.length, 2, 'no-op saves still validate');
});

test('missing, multiple, inactive and unsafe live namespace entries fail closed', async () => {
  for (const descriptors of [[], [live(), live('another')], [live('__proto__')], [live('metadata')],
    [{ entry: { ...live().entry, fiber: { state: 1, runtime: { name: 'llm-pi-ai' } } } }],
    [{ entry: { ...live().entry, fiber: { state: 2, runtime: null } } }], [live(undefined), live()],
    [{ entry: { fiber: { state: 2, runtime: { name: 'llm-pi-ai' } } } }]]) {
    const f = fixture(); f.configEditor.configuration = () => descriptors;
    await assert.rejects(f.operations.preview(group()), safeError('OPERATIONS_NAMESPACE_UNAVAILABLE'));
    assert.equal(f.writes.length, 0);
  }
});

test('schema rejection and every generated-target resolution failure stop writes and sanitize errors', async () => {
  const secret = 'private-key /private/config.json';
  const cases = [
    f => { f.dependencies.nativeConfig.parse = () => { throw new Error(secret); }; },
    f => { f.dependencies.nativeConfig.parse = () => undefined; },
    f => { f.dependencies.nativeConfig.parse = value => { value.providers.changed = {}; return value; }; },
    f => { f.dependencies.resolveNative = () => { throw new Error(secret); }; },
    f => { f.dependencies.resolveNative = () => new Map(); },
    f => { f.dependencies.resolveNative = () => ({}); },
    ...[{ catalogError: secret, modelErrors: new Map(), piProvider: {} },
      { modelErrors: new Map([['chat', secret]]), piProvider: {} },
      { modelErrors: new Map() }, { piProvider: {} }].map(profile => f => {
      f.dependencies.resolveNative = () => new Map([[planNativeSave(group()).routes[0].target, profile]]);
    }),
    f => { f.dependencies.resolveNative = providers => { delete providers.unrelated; return new Map(); }; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    const operations = createNativeOperations(f.dependencies);
    await assert.rejects(save(operations), safeError('SAVE_VALIDATION_FAILED'));
    assert.equal(f.writes.length, 0);
  }
});

test('existing legacy flags fail closed before schema/resolve, including false or empty values', async () => {
  for (const legacy of [{ multiKey: true }, { multiKey: false }, { keyEntries: {} }]) {
    const f = fixture(); Object.assign(f.docs[0].value.providers.unrelated, legacy);
    await assert.rejects(save(f.operations), safeError('SAVE_VALIDATION_FAILED'));
    assert.equal(f.parses.length, 0);
    assert.equal(f.resolves.length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test('stale preview and client namespace injection cannot write', async () => {
  const f = fixture(), input = group();
  const preview = await f.operations.preview(input);
  f.docs[0].revision++;
  await assert.rejects(f.operations.save(input, preview.revision, preview.fingerprint), safeError('SAVE_STALE'));
  input.namespace = 'pi-ai';
  await assert.rejects(f.operations.preview(input), safeError('SAVE_INVALID_GROUP'));
  assert.equal(f.writes.length, 0);
});

test('metadata failure preserves native writes and reports pending without leaking host details', async () => {
  const f = fixture();
  f.dependencies.validateMetadata = () => { throw new Error('private-key /private/config.json'); };
  const result = await save(createNativeOperations(f.dependencies));
  assert.equal(result.status, 'native-saved-metadata-pending');
  assert.equal(result.code, 'GROUP_SAVE_METADATA_PENDING');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].ns, 'actual-native');
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('stable per-namespace adapters keep the group busy through metadata merge', async () => {
  const f = fixture();
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const mutate = f.dependencies.settings.mutate;
  f.dependencies.settings.mutate = async (...args) => {
    if (args[0] === 'metadata') { entered(); await hold; }
    return mutate(...args);
  };
  const preview = await f.operations.preview(group());
  const pending = f.operations.save(group(), preview.revision, preview.fingerprint);
  await waiting;
  await assert.rejects(f.operations.save(group(), preview.revision, preview.fingerprint), safeError('GROUP_SAVE_BUSY'));
  release();
  assert.equal((await pending).status, 'saved');
});

test('invalid injected adapters and hostile editor exceptions are sanitized', async () => {
  const f = fixture();
  for (const key of ['settings', 'configEditor', 'validateMetadata', 'resolveNative', 'nativeConfig']) {
    assert.throws(() => createNativeOperations({ ...f.dependencies, [key]: null }), safeError('OPERATIONS_INVALID_ADAPTER'));
  }
  f.configEditor.configuration = () => { throw Object.assign(new Error('private-key'), { code: 'SAVE_STALE' }); };
  await assert.rejects(f.operations.preview(group()), safeError('OPERATIONS_NAMESPACE_UNAVAILABLE'));
});
