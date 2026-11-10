import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMetadataSave } from '../src/native-metadata-save.js';
const value = { groups: { g: { name: 'Group', entries: { e: { provider: 'p', name: 'Key' } } } } };
const fixture = () => {
 const doc = { ns: 'model-groups', revision: 1, value: { groups: {} } }, calls = [];
 const settings = { describe: () => [structuredClone(doc)], mutate(ns, ops, revision) {
  assert.equal(ns, doc.ns); assert.equal(revision, doc.revision); calls.push(ops);
  for (const op of ops) doc.value.groups[op.path[1]] = structuredClone(op.value);
  doc.revision++;
 } };
 const adapter = createNativeMetadataSave({ settings, namespace: doc.ns, validate: () => true });
 return { doc, settings, calls, adapter };
};
test('metadata adds only missing display groups and reuses exact existing groups', async () => {
 const { adapter, calls } = fixture();
 assert.deepEqual(await adapter.merge(value), { status: 'verified', metadata: value });
 await adapter.merge(value);
 assert.equal(calls.length, 1);
 assert.deepEqual(calls[0][0].path, ['groups', 'g']);
});
test('changed group and mutation failures refuse overwrite without leaking host errors', async () => {
 const { adapter, doc, calls } = fixture();
 doc.value.groups.g = { name: 'Changed', entries: {} };
 await assert.rejects(() => adapter.merge(value), /METADATA_SAVE_FAILED/);
 assert.equal(calls.length, 0);
 const f = fixture(); f.settings.mutate = () => { throw new Error('/private/path'); };
 await assert.rejects(() => f.adapter.merge(value), error => error.stack === 'METADATA_SAVE_FAILED');
});
