import test from 'node:test';
import assert from 'node:assert/strict';
// Regression cases use the controller fixture suite in maintenance.test.mjs;
// this source contract guards against accidentally reintroducing audit gating.
import fs from 'node:fs';
test('advisories are separate from hard file and activity restrictions', () => {
  const source = fs.readFileSync(new URL('../src/maintenance.js', import.meta.url), 'utf8');
  assert.ok(source.includes('warnings: report.warnings'));
  assert.ok(source.includes("['patch_conflict', 'active_turns', 'other_process', 'not_removable', 'manager_unavailable']"));
});
