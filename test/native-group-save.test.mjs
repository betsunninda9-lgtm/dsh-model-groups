import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeGroupSave } from '../src/native-group-save.js';
const value = { groups: { g: { name: 'Group', entries: { e: { name: 'Key', provider: 'actual-provider' } } } } };
test('providers commit before metadata; ordinary removal cannot delete committed routes', async () => {
  const order = [], providers = new Set();
  const save = createNativeGroupSave({ native: { preview() {}, async save() { order.push('providers'); providers.add('actual-provider'); return { status: 'saved', counts: { providers: 1 }, metadata: value }; } },
    metadata: { async merge(metadata) { order.push('metadata'); assert.ok(providers.has('actual-provider')); return { status: 'verified', metadata }; } } });
  assert.equal((await save.save({}, 1, 'token')).status, 'saved');
  assert.deepEqual(order, ['providers', 'metadata']);
  assert.ok(providers.has('actual-provider'));
});
test('metadata failure reports partial success and never rolls back native routes', async () => {
  for (const merge of [async () => { throw new Error('/private/secret'); }, async () => ({ status: 'verified', metadata: {} })]) {
    const providers = new Set();
    const save = createNativeGroupSave({ native: { preview() {}, async save() { providers.add('actual-provider'); return { status: 'saved', metadata: value }; } }, metadata: { merge } });
    const result = await save.save({}, 1, 'token');
    assert.equal(result.status, 'native-saved-metadata-pending');
    assert.ok(providers.has('actual-provider'));
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});
test('uncertain provider save never writes metadata', async () => {
  let called = false;
  const save = createNativeGroupSave({ native: { preview() {}, async save() { throw new Error('SAVE_UNVERIFIED'); } }, metadata: { async merge() { called = true; } } });
  await assert.rejects(() => save.save({}, 1, 'token'), /SAVE_UNVERIFIED/);
  assert.equal(called, false);
});
