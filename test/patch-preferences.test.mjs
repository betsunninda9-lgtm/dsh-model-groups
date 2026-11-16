import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARTIFACTS, sha256, applyPlan, planPatches } from '../scripts/native-patches.mjs';
import { createMaintenance, MAINTENANCE_PROTOCOL, patchStatus } from '../src/maintenance.js';
import { autoPatch } from '../src/auto-patch.js';
import { readPatchPreferences, writePatchPreferences, patchStorage } from '../src/patch-preferences.js';
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
const protocol = { clientVersion: version, maintenanceProtocol: MAINTENANCE_PROTOCOL };
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-pref-test-')),root=path.join(dir,'runtime'),home=path.join(dir,'home'),artifacts=path.join(dir,'artifacts');
 fs.mkdirSync(root); fs.mkdirSync(artifacts);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.2-rc.1'}));
 for(const [i,name] of ARTIFACTS.entries()) {const pkg=i===0?'dsh-llm-pi-ai':i===1?'dsh-client-ui-settings-models':i===4?'dsh-api-remotes':'dsh-llm',packageName='@deepseek-ai/'+pkg,target=`node_modules/${packageName}/lib/${i}.js`,file=path.join(root,target);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`before${i}`);fs.writeFileSync(path.join(root,'node_modules',packageName,'package.json'),JSON.stringify({name:packageName,version:'0.2.2-rc.1'}));fs.writeFileSync(path.join(artifacts,name),JSON.stringify({packageName,target,version:'0.2.2-rc.1',baseSha256:sha256(`before${i}`),resultSha256:sha256(`after${i}`),replacements:[{before:`before${i}`,after:`after${i}`}]}));}
 const controller=createMaintenance({root,home,artifacts,inspect:async()=>({blockers:[],fingerprint:''}),manager:{listBundles:async()=>[{name:'dsh-model-groups',removable:true}]}});
 t.after(()=>{assert.equal(fs.realpathSync(dir),dir);assert.ok(path.basename(dir).startsWith('dsh-pref-test-'));fs.rmSync(dir,{recursive:true});});
 return {root,home,artifacts,controller};
}
async function operate(f,action){const state=await f.controller.snapshot();return f.controller.restore({...protocol,action,token:state.token,confirmation:'CONFIRM PATCH OPERATION'});}
test('first installation is fold-only, explicit apply opts in, switch preserves patches and manual choice',async t=>{
 const f=fixture(t);assert.deepEqual(readPatchPreferences(f.root,f.home,f.artifacts),{enabled:false,autoMaintenance:false});
 assert.equal(autoPatch(f.root,f.home,{artifacts:f.artifacts}).state,'fold-only');assert.equal(patchStatus(f.root,f.home,f.artifacts).failed,false);assert.equal(fs.existsSync(path.join(patchStorage(f.root,f.home),'backups')),false);
 await assert.rejects(f.controller.restore({...protocol,action:'set-auto-maintenance',autoMaintenance:true}),{code:'PREFERENCES_DISABLED'});
 assert.deepEqual((await operate(f,'apply')).preferences,{enabled:true,autoMaintenance:true});
 const off=await f.controller.restore({...protocol,action:'set-auto-maintenance',autoMaintenance:false});assert.deepEqual(off.preferences,{enabled:true,autoMaintenance:false});assert.ok(planPatches(f.root,'check',f.artifacts).every(p=>p.state==='patched'));
 applyPlan(planPatches(f.root,'revert',f.artifacts),path.join(f.home,'replacement'));assert.equal(autoPatch(f.root,f.home,{artifacts:f.artifacts}).state,'manual-maintenance');
 assert.deepEqual((await operate(f,'apply')).preferences,{enabled:true,autoMaintenance:false});
 assert.deepEqual((await operate(f,'restore-only')).preferences,{enabled:false,autoMaintenance:false});
 assert.equal(autoPatch(f.root,f.home,{artifacts:f.artifacts}).state,'restore-pending');
});
test('migration needs actual patched code or exact owned backup evidence, explicit off wins',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(patchStorage(f.root,f.home),'backups'),{recursive:true});fs.writeFileSync(path.join(patchStorage(f.root,f.home),'backups','notes.txt'),'not evidence');assert.equal(readPatchPreferences(f.root,f.home,f.artifacts).enabled,false);
 applyPlan(planPatches(f.root,'apply',f.artifacts),path.join(f.home,'fixture-backups'));assert.equal(readPatchPreferences(f.root,f.home,f.artifacts).enabled,true);
 applyPlan(planPatches(f.root,'revert',f.artifacts),path.join(patchStorage(f.root,f.home),'backups'));assert.equal(readPatchPreferences(f.root,f.home,f.artifacts).enabled,true,'owned backup survives host replacement');
 writePatchPreferences(f.root,f.home,{enabled:true,autoMaintenance:false});assert.equal(readPatchPreferences(f.root,f.home,f.artifacts).autoMaintenance,false);
});
