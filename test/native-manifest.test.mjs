import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nativeManifest } from '../scripts/native-manifest.mjs';
test('fresh artifact manifest cannot load legacy host-patching entry', () => {
  const original = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const result = nativeManifest(original);
  assert.equal(result.main, './src/native-index.js');
  assert.equal(result.exports['.'], result.main);
  assert.equal(result.exports['./client'], './lib/native-client.js');
  assert.ok(result.files.every(file => !file.includes('patch.json') && !file.includes('auto-patch') && file !== 'src'));
  assert.equal(result.files.includes('src/index.js'), false);
  assert.equal(original.main, './src/index.js');
  assert.equal(Object.hasOwn(result.scripts, 'prepack'), false);
});
test('fresh artifact includes transitive server imports and excludes migration or restoration execution', () => {
  const original = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = nativeManifest(original);
  const allowed = new Set(manifest.files);
  for (const file of manifest.files.filter(file => file.startsWith('src/') && file.endsWith('.js'))) {
    const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const match of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) assert.ok(allowed.has(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))), `${file}: ${match[1]}`);
    }
  }
  for (const forbidden of ['src/native-migration.js', 'src/native-stage.js', 'src/native-journal.js', 'src/maintenance.js', 'scripts/native-patches.mjs', 'src/auto-patch.js']) assert.equal(allowed.has(forbidden), false);
});
