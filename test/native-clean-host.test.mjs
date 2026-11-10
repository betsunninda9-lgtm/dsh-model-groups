import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCleanNativeHost } from '../src/native-clean-host.js';
import { planPatches } from '../scripts/native-patches.mjs';
import { createNativeOperations } from '../src/native-operations.js';

test('fresh loader refuses unsupported entry without exposing host paths', async () => {
  await assert.rejects(() => loadCleanNativeHost('/nonexistent/private-host/entry.js'), error => error.code === 'NATIVE_CLEAN_HOST_REQUIRED' && !error.stack.includes('private-host'));
});
test('fresh loader evaluates only pristine source and wraps actual callable Config for native operations', async t => {
  if (!process.env.DSH_ROOT) { t.skip('Set DSH_ROOT for pristine host fixture'); return; }
  const root = path.resolve(process.env.DSH_ROOT);
  const plan = planPatches(root, 'revert').find(item => item.name === 'pi-ai.patch.json');
  // Resolver dependencies still come from the installed host; source bytes are a
  // temporary pristine fixture. Never replace any installed target.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-clean-test-'));
  const file = path.join(directory, 'index.js');
  fs.writeFileSync(file, plan.result);
  const source = fs.readFileSync(new URL('../src/native-clean-host.js', import.meta.url), 'utf8')
    .replace("const file = require.resolve('@deepseek-ai/dsh-llm-pi-ai');", `const file = ${JSON.stringify(file)};`)
    .replace('pathToFileURL(file).href, JSON.stringify(specifiers)', `${JSON.stringify(pathToFileURL(plan.file).href)}, JSON.stringify(specifiers)`);
  const fixture = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const host = await fixture.loadCleanNativeHost(path.join(root, 'package.json'));
  assert.equal(typeof host.nativeConfig.parse, 'function');
  assert.equal(typeof host.resolveNative, 'function');
  const parsed = host.nativeConfig.parse({ providers: {} });
  assert.deepEqual(parsed.providers, {});
  const docs = [{ ns: 'actual-pi', revision: 1, value: { providers: {} } }, { ns: 'model-groups', revision: 1, value: { groups: {} } }];
  const operations = createNativeOperations({ ...host, metadataNamespace: 'model-groups', validateMetadata: () => true,
    configEditor: { configuration: () => [{ entry: { options: { id: 'actual-pi' }, fiber: { state: 2, runtime: { name: 'llm-pi-ai' } } } }] },
    settings: {
      describe: async () => structuredClone(docs),
      mutate: async (ns, ops, revision) => {
        const doc = docs.find(item => item.ns === ns);
        assert.equal(doc.revision, revision);
        for (const op of ops) doc.value[op.path[0]][op.path[1]] = structuredClone(op.value);
        doc.revision++;
      },
    },
  });
  const group = { id: 'fixture', shared: { displayName: 'Fixture', api: 'openai-completions', baseURL: 'https://example.invalid/v1' }, entries: [{ id: 'one', name: 'One', apiKeyEnv: 'FIXTURE_ONE', models: [{ id: 'chat', name: 'Chat', contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: false }] }] };
  const preview = await operations.preview(group);
  const result = await operations.save(group, preview.revision, preview.fingerprint);
  assert.equal(result.status, 'saved');
  assert.equal(Object.keys(docs[0].value.providers).length, 1);
  assert.equal(Object.keys(docs[1].value.groups).length, 1);
  fs.writeFileSync(file, plan.result + '\n// unrecognized edit\n');
  await assert.rejects(() => fixture.loadCleanNativeHost(path.join(root, 'package.json')), /NATIVE_CLEAN_HOST_REQUIRED/);
});
