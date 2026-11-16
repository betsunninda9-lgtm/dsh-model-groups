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

test('token context rejects ambiguous scopes and genuine identifier changes', () => {
  assert.equal(tokenContextEdit(before + '\n' + before, before, edit), undefined);
  assert.equal(tokenContextEdit(before.replace('schema', 'changed'), before, edit), undefined);
});
test('string/comment decoys are not executable anchors and line breaks retain semantics', () => {
  assert.equal(tokenContextEdit(JSON.stringify(before), before, edit), undefined);
  assert.equal(tokenContextEdit('/* ' + before + ' */', before, edit), undefined);
  const source = before.replace('schema =', 'schema\n=');
  assert.equal(tokenContextEdit(source, before, edit), undefined);
});
