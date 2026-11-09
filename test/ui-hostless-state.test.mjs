import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDirectory, selectionFor, withEffort, removeEntry, removeGroup, configOperations, parseModels, newId } from '../src/ui/state.js';
const config = { groups: { 'group-1': { name: 'Supplier', baseURL: 'https://example.test/v1', api: 'openai-responses', entries: { 'mg-a': { name: 'First key', models: ['model/a'] }, 'mg-b': { name: 'Second key', models: ['model/a'] } } } }, tombstones: {} };
const model = { id: 'model/a', name: 'Long model name', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] } };
test('ordinary HTTP browser creates valid UUID routes without secure-context randomUUID', () => {
 const crypto = { getRandomValues: bytes => bytes.fill(255) };
 assert.equal(newId('mg', crypto), 'mg-ffffffff-ffff-4fff-bfff-ffffffffffff');
 assert.match(newId('group', crypto), /^group-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.throws(() => newId('mg', {}), /Cryptographic/);
});
test('same model keeps exact optional effort; routes never derive from duplicate labels', () => {
 const selection = {provider:'mg-b',model:'model/a',reasoningEffort:'adapter-owned:custom'};
 assert.deepEqual(selectionFor(selection,'mg-b',model),selection);
 assert.deepEqual(selectionFor(selection,'mg-a',model),{provider:'mg-a',model:'model/a',reasoningEffort:'high'});
 assert.deepEqual(withEffort(selection,undefined),{provider:'mg-b',model:'model/a'});
 assert.deepEqual(selectionFor({provider:'mg-a',model:'model/a'},'mg-a',model),{provider:'mg-a',model:'model/a'});
});
test('supplier/configuration grouping joins only exact stable routes and retains other providers', () => {
 const groups = groupDirectory([{id:'mg-a',name:'Route A',models:[model]},{id:'other',name:'Other',models:[model]},{id:'mg-b',name:'Route B',models:[model]}],config);
 assert.deepEqual(groups[0].entries.map(e=>e.route),['mg-a','mg-b']);
 assert.equal(groups[1].entries[0].route,'other');
 assert.equal(groupDirectory([{id:'mg-b',name:'Route B',models:[model]}],config,'second key')[0].entries[0].models[0].id,'model/a');
});
test('deletion retires routes atomically without changing original config', () => {
 const next=removeEntry(config,'group-1','mg-a');
 assert.equal(next.tombstones['mg-a'],true); assert.equal(next.groups['group-1'].entries['mg-a'],undefined);
 assert.ok(config.groups['group-1'].entries['mg-a']);
 const removed=removeGroup(config,'group-1');
 assert.deepEqual(removed.tombstones,{'mg-a':true,'mg-b':true});
 assert.deepEqual(configOperations(removed).map(x=>x.path),[['groups'],['tombstones']]);
});
test('model lines preserve exact provider model ids and remove only empty/duplicate rows',()=> assert.deepEqual(parseModels('model/a\n x:y \nmodel/a\n\n'),['model/a','x:y']));
