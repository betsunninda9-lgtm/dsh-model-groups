import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenContextEdit } from '../scripts/token-context.mjs';
import { structuralRevision } from '../scripts/structural-patches.mjs';
const before = 'export const schema = z.object({ apiKey: z.string(), baseURL: z.string(), model: z.string() });';
const at = before.indexOf('apiKey:');
const edit = { start: at, end: at, text: 'keyEntryId: z.string(), ' };
test('token context preserves tabs and comments with exact reversible insertion', () => {
  const source = before.replaceAll(' ', '\t').replace('z.object', 'z /* host */ .object');
  const changed = tokenContextEdit(source, before, edit);
  assert.ok(changed?.includes(edit.text));
  assert.equal(changed.replace(edit.text, ''), source);
  const revision = structuralRevision(source, [{ replacements: [{ before, after: before.slice(0, at) + edit.text + before.slice(at) }] }]);
  assert.equal(revision.original, source);
  assert.equal(revision.latest, changed);
});
test('formatted already patched source is not patched twice', () => {
  const recipe = { replacements: [{ before, after: before.slice(0, at) + edit.text + before.slice(at) }] };
  const patched = recipe.replacements[0].after.replaceAll(' ', '\t');
  const revision = structuralRevision(patched, [recipe]);
  assert.ok(!revision || revision.state === 'patched');
  if (revision) assert.equal(revision.latest, patched);
});

test('token context rejects ambiguous scopes and changed identifiers inside the minimum anchor', () => {
  assert.equal(tokenContextEdit(before + '\n' + before, before, edit), undefined);
  assert.equal(tokenContextEdit(before.replace('apiKey:', 'credential:'), before, edit), undefined);
});
test('adaptive contexts retain unrelated host token changes on either side', () => {
  for (const source of [
    before.replace('schema =', 'hostSchema ='), // 8-token left fails; 6-token left survives.
    before.replace('z.object', 'runtime.object'), // Only 4-token left survives.
    before.replace('apiKey: z.string()', 'apiKey: z.secret()'), // Only 4-token right survives.
    before.replace('z.object', 'runtime.object').replace('apiKey: z.string()', 'apiKey: z.secret()'),
  ]) {
    const changed = tokenContextEdit(source, before, edit);
    assert.ok(changed, source);
    assert.equal(changed.replace(edit.text, ''), source);
    assert.equal(changed.split(edit.text).length, 2);
  }
});
test('a unique broad match cannot hide another position admitted by a smaller window', () => {
  const second = before.replace('z.object', 'runtime.object');
  assert.equal(tokenContextEdit(before + '\n' + second, before, edit), undefined);
  assert.equal(tokenContextEdit(second + '\n' + before, before, edit), undefined);
});
test('adaptive replacement still requires exact changed bytes and safe token boundaries', () => {
  const raw = 'const result = remote.send(model, exactValue, options);';
  const start = raw.indexOf('exactValue');
  const replacement = { start, end: start + 'exactValue'.length, text: 'chosenValue' };
  const host = raw.replace('result', 'hostResult');
  const changed = tokenContextEdit(host, raw, replacement);
  assert.equal(changed, host.replace('exactValue', 'chosenValue'));
  assert.equal(tokenContextEdit(host.replace('exactValue', 'otherValue'), raw, replacement), undefined);
  assert.equal(tokenContextEdit(host, raw, { start: start + 1, end: replacement.end, text: 'value' }), undefined);
});
test('string/comment decoys are not executable anchors and line breaks retain semantics', () => {
  assert.equal(tokenContextEdit(JSON.stringify(before), before, edit), undefined);
  assert.equal(tokenContextEdit('/* ' + before + ' */', before, edit), undefined);
  const source = before.replace('schema =', 'schema\n=');
  assert.equal(tokenContextEdit(source, before, edit), undefined);
});
