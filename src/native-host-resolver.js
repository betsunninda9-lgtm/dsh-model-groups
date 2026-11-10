import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { planPatches } from '../scripts/native-patches.mjs';

const fail = code => { throw Object.assign(new Error(code), { code, stack: code }); };
/** Resolve supported host configuration locally, never adapter/listModels or
 * credentials. Hash-verified source is evaluated only in memory. No host writes.
 * Unknown/edited host content or unrecognized import syntax fails closed.
 */
export async function loadNativeHostResolvers(root) {
  try {
    const reverted = planPatches(root, 'revert').find(item => item.name === 'pi-ai.patch.json');
    const patched = planPatches(root, 'apply').find(item => item.name === 'pi-ai.patch.json');
    if (!reverted || !patched || reverted.file !== patched.file || reverted.source !== patched.source) fail('NATIVE_HOST_CHANGED');
    const specifiers = [...new Set([...reverted.result.matchAll(/from "([^"\n]+)"/g)].map(match => match[1]).filter(value => !value.startsWith('node:')))];
    const resolution = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e',
      'const [parent,specifiers]=process.argv.slice(1); console.log(JSON.stringify(JSON.parse(specifiers).map(s=>[s,import.meta.resolve(s,parent)])))',
      pathToFileURL(path.resolve(reverted.file)).href, JSON.stringify(specifiers)], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (resolution.error || resolution.status !== 0) fail('NATIVE_HOST_RESOLUTION_FAILED');
    const imports = new Map(JSON.parse(resolution.stdout));
    const load = async source => {
      const rewritten = source.replace(/from "([^"\n]+)"/g, (match, specifier) => {
        if (specifier.startsWith('node:')) return match;
        const resolved = imports.get(specifier);
        if (typeof resolved !== 'string' || !resolved.startsWith('file:')) fail('NATIVE_HOST_RESOLUTION_FAILED');
        return `from ${JSON.stringify(resolved)}`;
      });
      const module = await import(`data:text/javascript;base64,${Buffer.from(`${rewritten}\nexport { resolveProfiles as nativeResolveProfiles, Config as nativeConfig };`).toString('base64')}`);
      if (typeof module.nativeResolveProfiles !== 'function') fail('NATIVE_HOST_RESOLUTION_FAILED');
      return module;
    };
    const [native, legacy] = await Promise.all([load(reverted.result), load(patched.result)]);
    return Object.freeze({ resolveNative: native.nativeResolveProfiles, resolveLegacy: legacy.nativeResolveProfiles, nativeConfig: native.nativeConfig });
  } catch { fail('NATIVE_HOST_UNSUPPORTED'); }
}
