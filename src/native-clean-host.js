import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const hashes = new Set(['070c839e2c00e2d5f7c5d82307ca3d84dbb2323e46979daf265908751bbe8ae8', '0a99a2fc903a4285044b09114b3bd20ee1e612f39aa381e4a71b10d48ee9e9f7', '1a3ae58f9b4493e15459cc5000ec80f21b5d3f4a9dea6ffb6bc28e5b8817ae8a']);
/** Fresh creation requires an unmodified supported host. No patch source/data,
 * no writes, no credential resolution. Refuse old patched installs explicitly.
 */
export async function loadCleanNativeHost(entry = process.argv[1]) {
  try {
    const require = createRequire(path.resolve(entry));
    const file = require.resolve('@deepseek-ai/dsh-llm-pi-ai');
    const source = fs.readFileSync(file);
    if (!hashes.has(crypto.createHash('sha256').update(source).digest('hex'))) throw new Error();
    const text = source.toString('utf8');
    const specifiers = [...new Set([...text.matchAll(/from "([^"\n]+)"/g)].map(match => match[1]).filter(value => !value.startsWith('node:')))];
    const resolution = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e',
      'const [parent,specifiers]=process.argv.slice(1); console.log(JSON.stringify(JSON.parse(specifiers).map(s=>[s,import.meta.resolve(s,parent)])))',
      pathToFileURL(file).href, JSON.stringify(specifiers)], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (resolution.error || resolution.status !== 0) throw new Error();
    const imports = new Map(JSON.parse(resolution.stdout));
    const rewritten = text.replace(/from "([^"\n]+)"/g, (match, specifier) => {
      if (specifier.startsWith('node:')) return match;
      const url = imports.get(specifier);
      if (typeof url !== 'string' || !url.startsWith('file:')) throw new Error();
      return `from ${JSON.stringify(url)}`;
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(rewritten + '\nexport { resolveProfiles as nativeResolveProfiles };').toString('base64')}`);
    if (typeof module.Config !== 'function' || typeof module.nativeResolveProfiles !== 'function') throw new Error();
    return { nativeConfig: { parse: value => {
      const parsed = module.Config(value);
      // Host Config uses a volatile providers cell; pure validation needs the
      // detached underlying dictionary, not the live service wrapper.
      if (typeof parsed.providers?.get !== 'function') throw new Error('NATIVE_CLEAN_HOST_REQUIRED');
      return { ...parsed, providers: parsed.providers.get() };
    } }, resolveNative: module.nativeResolveProfiles };
  } catch { throw Object.assign(new Error('NATIVE_CLEAN_HOST_REQUIRED'), { code: 'NATIVE_CLEAN_HOST_REQUIRED', stack: 'NATIVE_CLEAN_HOST_REQUIRED' }); }
}
