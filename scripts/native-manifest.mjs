import { pathToFileURL } from 'node:url';

/** Separate fresh-install preview artifact. Never replaces legacy entry in place.
 * The pack caller must ensure native-client build and clean-host tests pass.
 */
export function nativeManifest(original) {
  const result = structuredClone(original);
  result.version = '0.4.0-native.1';
  result.description = 'Native provider grouping preview for fresh DSH profiles; no host patches.';
  result.main = './src/native-index.js';
  result.exports = { '.': './src/native-index.js', './client': './lib/native-client.js', './package.json': './package.json' };
  // Do not offer a legacy entry in the fresh artifact: accidental selection could
  // re-enable host mutation. Legacy releases remain separate packages/assets.
  result.files = ['src/native-index.js', 'src/native-create-runtime.js', 'src/native-clean-host.js',
    'src/native-api.js', 'src/native-operations.js', 'src/native-save.js', 'src/native-downgrade.js',
    'src/native-group-save.js', 'src/native-metadata-save.js', 'src/hierarchy.js', 'src/group-state.js',
    'lib/native-client.js', 'cordis.patch.yml', 'README.md', 'LICENSE'];
  result.scripts = {};
  result.dsh.client.inject = result.dsh.client.inject.filter(name => name !== '@deepseek-ai/dsh-client-ui-settings-models');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  throw new Error('Use nativeManifest from an explicit isolated packaging task; no automatic install or publish.');
}
