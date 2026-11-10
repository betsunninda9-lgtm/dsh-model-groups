import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeManifest } from './native-manifest.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination) || !fs.statSync(destination).isDirectory()) throw new Error('Explicit existing absolute output directory required');
const original = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = nativeManifest(original);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-pack-'));
// Deliberately retain isolated staging on failure for inspection, never recursively
// remove a computed tree or mutate the source/installed profile.
for (const file of manifest.files.filter(file => file !== 'README.md')) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
}
fs.copyFileSync(path.join(root, 'NATIVE-PREVIEW.md'), path.join(directory, 'README.md'), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: directory, encoding: 'utf8' });
if (result.status !== 0) throw new Error('Native preview pack failed');
const packed = JSON.parse(result.stdout)[0];
const allowed = new Set(['package.json', ...manifest.files]);
if (packed.files.some(file => !allowed.has(file.path)) || [...allowed].some(file => !packed.files.some(item => item.path === file))) throw new Error('Unexpected or missing native preview package content');
// Check every relative server import is actually present in the isolated tree.
for (const file of manifest.files.filter(file => file.endsWith('.js') && file.startsWith('src/'))) {
  const text = fs.readFileSync(path.join(directory, file), 'utf8');
  for (const match of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('.') && !fs.existsSync(path.resolve(directory, path.dirname(file), match[1]))) throw new Error('Missing native server import');
  }
}
console.log(JSON.stringify({ archive: path.join(destination, packed.filename), files: packed.files.map(file => file.path), staging: directory }, null, 2));
