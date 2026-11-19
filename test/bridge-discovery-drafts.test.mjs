import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeController } from '../src/bridge/controller.js';
import { discoverBridgeModels } from '../src/bridge/discovery.js';

test('an unfinished UI model row and transient discovery key never enter Settings or credentials', async () => {
  const document = { revision: 3, providers: {} };
  let writes = 0, credentialWrites = 0, calls = 0;
  const adapter = { read: async () => structuredClone(document), writeProvider: async () => { writes++; } };
  const controller = createBridgeController({ storage: adapter, native: adapter, credentials: { set: async () => { credentialWrites++; } },
    discover: async (provider, id, draft, options) => {
      calls++; assert.equal(provider, 'sample'); assert.equal(id, 'work');
      assert.deepEqual(draft.models, []); assert.equal(Object.hasOwn(draft, 'apiKey'), false);
      assert.equal(options.apiKey, 'synthetic-draft-key'); return [{ id: 'found' }];
    } });
  const result = await controller.discover('sample', 'work', { name: '', models: [{ id: '' }], api: 'openai-completions', apiKeyEnv: 'UNSAVED_REF' }, { apiKey: 'synthetic-draft-key' });
  assert.deepEqual(result, { ok: true, models: [{ id: 'found' }] });
  assert.equal(calls, 1); assert.equal(writes, 0); assert.equal(credentialWrites, 0);
  assert.doesNotMatch(JSON.stringify(await controller.snapshot()), /synthetic-draft-key/);
  assert.deepEqual(document, { revision: 3, providers: {} });
  for (const apiKey of ['', 'line\nbreak', {}, 'x'.repeat(16385)]) await assert.rejects(
    controller.discover('sample', 'work', { models: [] }, { apiKey }), { code: 'INVALID_CREDENTIAL_VALUE' });
  assert.equal(calls, 1); assert.equal(writes, 0); assert.equal(credentialWrites, 0);
});

for (const api of ['openai-completions', 'anthropic-messages']) test(`${api} discovery can use a typed key without credential reads or writes`, async () => {
  let reads = 0, writes = 0;
  const ctx = { credentials: { async resolve() { reads++; throw new Error('must not read'); }, async set() { writes++; } } };
  const models = await discoverBridgeModels({ profile: { api, baseURL: 'https://example.invalid/v1', apiKeyEnv: 'DRAFT_ONLY' }, ctx, apiKey: 'synthetic-transient' }, {
    fetch: async (_url, request) => {
      assert.equal(request.headers.get(api === 'anthropic-messages' ? 'x-api-key' : 'authorization'), api === 'anthropic-messages' ? 'synthetic-transient' : 'Bearer synthetic-transient');
      return new Response(JSON.stringify({ data: [{ id: 'found' }] }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(models.map(model => model.id), ['found']);
  assert.equal(reads, 0); assert.equal(writes, 0);
  assert.doesNotMatch(JSON.stringify(models), /synthetic-transient/);
});
