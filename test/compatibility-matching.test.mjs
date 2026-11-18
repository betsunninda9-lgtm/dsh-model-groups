import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibilitySnapshot } from '../src/compatibility.js';

test('matching diagnostics project only fixed codes and bounded recipe indices', () => {
  const secret = 'credential-or-private-source-never-published';
  const snapshot = compatibilitySnapshot({ schema: 1, compatibilityPolicy: 'code', files: [{
    id: 'pi-ai.patch.json', state: 'conflict', code: 'unrecognized_content', matching: [
      { phase: 'target_forward', code: 'FRAGMENT_MISSING_OR_AMBIGUOUS', recipeIndex: 2, replacementIndex: 22, candidateCount: null, source: secret, message: secret, path: secret },
      { phase: secret, code: 'INTERNAL_ERROR' },
      { phase: 'resolve', code: secret },
      { phase: 'resolve', code: 'REVISION_AMBIGUOUS', recipeIndex: -1, replacementIndex: secret, candidateCount: 2 },
    ],
  }] });
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.deepEqual(snapshot.files[0].matching, [
    { phase: 'target_forward', code: 'FRAGMENT_MISSING_OR_AMBIGUOUS', recipeIndex: 2, replacementIndex: 22, candidateCount: null },
    { phase: 'resolve', code: 'REVISION_AMBIGUOUS', recipeIndex: null, replacementIndex: null, candidateCount: 2 },
  ]);
  assert.deepEqual(compatibilitySnapshot(snapshot), snapshot);
  const repeated = { ...snapshot, files: [{ ...snapshot.files[0], matching: Array(200).fill(snapshot.files[0].matching[0]) }] };
  assert.equal(compatibilitySnapshot(repeated).files[0].matching.length, 16);
});
