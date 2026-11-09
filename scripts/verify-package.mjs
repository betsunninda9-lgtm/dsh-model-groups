import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const file=process.argv[2]||'dsh-model-groups-0.4.0-beta.1.tgz';
const paths=execFileSync('tar',['-tzf',file],{encoding:'utf8'}).trim().split('\n');
assert.ok(paths.includes('package/cordis.patch.yml'));
assert.ok(paths.includes('package/src/host/index.js'));
assert.ok(paths.includes('package/lib/client.js'));
assert.ok(paths.every(p=>!/(^|\/)(native|scripts|node_modules|test)\//.test(p)));
const manifest=JSON.parse(execFileSync('tar',['-xOf',file,'package/package.json'],{encoding:'utf8'}));
assert.equal(manifest.version,'0.4.0-beta.1');
for(const key of ['install','preinstall','postinstall'])assert.equal(manifest.scripts?.[key],undefined);
const client=execFileSync('tar',['-xOf',file,'package/lib/client.js'],{encoding:'utf8',maxBuffer:2097152});
assert.ok(client.includes("dsh-model-groups"));
assert.ok(!client.includes('/opt/dsh'));
for(const p of paths.filter(p=>p.endsWith('.js'))){const text=execFileSync('tar',['-xOf',file,p],{encoding:'utf8',maxBuffer:2097152});assert.ok(!text.includes('/opt/dsh'),p);assert.ok(!text.includes('native-patches.mjs'),p);}
console.log(JSON.stringify({package:file,files:paths.length,version:manifest.version,noHostPatches:true,noInstallScripts:true},null,2));
