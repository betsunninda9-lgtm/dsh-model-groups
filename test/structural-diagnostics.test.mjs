import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseStructuralRevision, structuralRevision, transformFragments } from '../scripts/structural-patches.mjs';

const code = 'export function request(source) { return source.apiKey; }\n';
const recipe = { current: true, replacements: [{ before: code, after: code.replace('source.apiKey', 'selected.apiKey') }] };
const allowedPhases = new Set(['pristine_guard', 'observe_reverse', 'observe_roundtrip', 'target_forward', 'target_roundtrip', 'resolve']);
const allowedCodes = new Set(['FRAGMENT_TOO_LARGE', 'INSERTION_PRESENT', 'FRAGMENT_MISSING_OR_AMBIGUOUS', 'INVALID_RECIPE', 'INTERNAL_ERROR', 'PARTIAL_POSTIMAGE', 'ROUNDTRIP_MISMATCH', 'NO_CHANGE', 'REVISION_AMBIGUOUS']);
function closed(result) {
  assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'matched']);
  assert.equal(typeof result.matched, 'boolean');
  assert.ok(result.diagnostics.length <= 128);
  for (const detail of result.diagnostics) {
    assert.deepEqual(Object.keys(detail).sort(), ['candidateCount', 'code', 'phase', 'recipeIndex', 'replacementIndex']);
    assert.ok(allowedPhases.has(detail.phase));
    assert.ok(allowedCodes.has(detail.code));
    for (const field of ['recipeIndex', 'replacementIndex', 'candidateCount']) {
      assert.ok(detail[field] === null || Number.isSafeInteger(detail[field]) && detail[field] >= 0);
    }
  }
}

test('diagnostics leave successful default transforms and revisions unchanged', () => {
  const before = structuralRevision(code, [recipe]);
  const expected = transformFragments(code, recipe);
  const result = diagnoseStructuralRevision(code, [recipe]);
  assert.equal(result.matched, true);
  assert.equal(structuralRevision(code, [recipe]).latest, expected);
  assert.deepEqual(structuralRevision(code, [recipe]), before);
  assert.equal(transformFragments(expected, recipe, true), code);
  assert.doesNotMatch(JSON.stringify(result), /source\.apiKey|selected\.apiKey|export function/);
  closed(result);
});

test('missing fragments identify the fixed recipe and original replacement index', () => {
  const first = 'export const firstFeature = false;\n';
  const two = { current: true, replacements: [{ before: first, after: first.replace('false', 'true') }, ...recipe.replacements] };
  const result = diagnoseStructuralRevision(first, [two], { knownOriginal: true });
  assert.equal(result.matched, false);
  assert.ok(result.diagnostics.some(item => item.recipeIndex === 0 && item.replacementIndex === 1 && item.phase === 'target_forward' && item.code === 'FRAGMENT_MISSING_OR_AMBIGUOUS'));
  assert.equal(structuralRevision(first, [two], { knownOriginal: true }), undefined);
  assert.throws(() => transformFragments(first, two), /Patch fragment missing or ambiguous/);
  closed(result);
});

test('reverse diagnostic indices refer to original replacement order', () => {
  const first = 'export const firstFeature = false;\n';
  const two = { current: true, replacements: [{ before: first, after: first.replace('false', 'true') }, ...recipe.replacements] };
  const result = diagnoseStructuralRevision(first, [two]);
  assert.ok(result.diagnostics.some(item => item.phase === 'observe_reverse' && item.replacementIndex === 1));
  closed(result);
});

test('recipe indices retain the input order after current filtering and deduplication', () => {
  const legacy = { replacements: [{ before: 'export const oldFeature = false;', after: 'export const oldFeature = true;' }] };
  const result = diagnoseStructuralRevision('export const unrelated = true;', [legacy, { ...recipe }, { ...recipe }], { knownOriginal: true });
  assert.equal(result.matched, false);
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.every(item => item.recipeIndex === 2));
  closed(result);
});

test('partial postimages report the skipped replacement without exposing its bytes', () => {
  const before = 'const firstLongSchemaAnchor = {\n  apiKey: "original credential value",\n};\nconst secondLongSchemaAnchor = {\n  apiKey: "other credential value",\n};\n';
  const partial = before.replace('original credential value",\n', 'original credential value",\n  keyEntryId: "first inserted entry",\n');
  const after = partial.replace('other credential value",\n', 'other credential value",\n  keyEntryId: "second inserted entry",\n');
  const result = diagnoseStructuralRevision(partial, [{ current: true, replacements: [{ before, after }] }]);
  assert.equal(result.matched, false);
  assert.ok(result.diagnostics.some(item => item.code === 'INSERTION_PRESENT' || item.code === 'PARTIAL_POSTIMAGE'));
  assert.doesNotMatch(JSON.stringify(result), /credential|keyEntryId|inserted entry/);
  closed(result);
});

test('ambiguous structural revisions report only the unique revision candidate count', () => {
  const source = 'export const mode = "old";\n';
  const candidates = ['first', 'second'].map(value => ({ current: true, replacements: [{ before: source, after: source.replace('old', value) }] }));
  const result = diagnoseStructuralRevision(source, candidates, { knownOriginal: true });
  assert.equal(result.matched, false);
  assert.deepEqual(result.diagnostics.at(-1), { recipeIndex: null, replacementIndex: null, phase: 'resolve', code: 'REVISION_AMBIGUOUS', candidateCount: 2 });
  assert.throws(() => structuralRevision(source, candidates, { knownOriginal: true }), /Ambiguous structural patch revision/);
  closed(result);
});

test('unexpected exceptions never read or disclose dynamic error messages', () => {
  let messageReads = 0;
  const untrusted = { get message() { messageReads++; throw new Error('MUST_NOT_READ'); }, path: '/private/config/SECRET', source: 'PRIVATE_SOURCE', token: 'SECRET_TOKEN' };
  const candidate = { current: true, get replacements() { throw untrusted; } };
  const result = diagnoseStructuralRevision('PRIVATE_SOURCE', [candidate]);
  assert.equal(result.matched, false);
  assert.equal(messageReads, 0);
  assert.deepEqual(result.diagnostics, [{ recipeIndex: null, replacementIndex: null, phase: 'resolve', code: 'INTERNAL_ERROR', candidateCount: null }]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|private|token|message|path|source/);
  closed(result);
});

test('diagnostic storage is bounded without changing mismatch behavior', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ current: true, replacements: [{ before: `export const feature${index} = false;`, after: `export const feature${index} = true;` }] }));
  const source = 'export const unrelated = true;';
  const result = diagnoseStructuralRevision(source, candidates, { knownOriginal: true });
  assert.equal(result.matched, false);
  assert.equal(result.diagnostics.length, 128);
  assert.equal(structuralRevision(source, candidates, { knownOriginal: true }), undefined);
  closed(result);
});
