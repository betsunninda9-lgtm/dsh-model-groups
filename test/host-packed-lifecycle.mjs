// Explicit opt-in evidence script. Never included by the *.test.mjs suite.
// Usage: node test/host-packed-lifecycle.mjs /absolute/path/to/actual-package.tgz
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, symlink, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runPluginCommand, bundleManifest } from '@deepseek-ai/dsh-plugin-manager/operations';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import Settings from '@deepseek-ai/dsh-settings';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import Typert from '@deepseek-ai/dsh-typert-registry';
import { initProfile, readProfileManifest, loadProfileDirectory, mountRootInclude, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot';
const root=fileURLToPath(new URL('../',import.meta.url));
if (!process.argv[2]) throw new Error('Pass the completed actual package tarball explicitly');
const archive=await realpath(resolve(process.argv[2]));
const executablePath=process.env.PATH;
const pnpmCommand=process.env.MODEL_GROUPS_TEST_PNPM || 'pnpm';
const run=await mkdtemp(join(tmpdir(),'synthetic-model-groups-packed-'));
const home=join(run,'home'),dir=join(run,'profile'),tmp=join(run,'tmp');
await Promise.all([home,dir,tmp].map(path=>mkdir(path,{recursive:true})));
const env={PATH:executablePath,HOME:home,XDG_CONFIG_HOME:join(home,'config'),XDG_CACHE_HOME:join(home,'cache'),TMPDIR:tmp,CI:'true',npm_config_userconfig:join(home,'.npmrc'),npm_config_globalconfig:join(home,'global.npmrc'),COREPACK_ENABLE_NETWORK:'0',PNPM_HOME:join(home,'pnpm')};
for(const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env,env);
await writeFile(join(home,'.npmrc'),'registry=https://registry.npmjs.org/\nupdate-notifier=false\naudit=false\nfund=false\nauto-install-peers=false\n');
await writeFile(join(home,'global.npmrc'),'');
const anchor=join(run,'package.json');await writeFile(anchor,JSON.stringify({name:'synthetic-runtime-anchor',version:'0.2.2-rc.1',private:true}));
// Share only the clean dependency installation, never an active host/profile.
await symlink(join(root,'node_modules'),join(run,'node_modules'),'dir');
initProfile(dir,[]);
const context={profile:'synthetic-packed',dir,installAnchor:anchor,cwd:run,home};
const options={execution:'service',command:pnpmCommand,env,outputBytes:32000,activateNewBundles:false,lockWaitMs:5000,idleTimeoutMs:120000,lookupTimeoutMs:20000};
const flags=['--ignore-scripts','--config.node-linker=hoisted','--config.bin-links=false','--config.auto-install-peers=false',`--store-dir=${join(run,'store')}`];
const report={archive,run,evidenceLevel:'Actual tarball installed/removed through official public package operations; official Loader live activation with synthetic credential service; not full PluginManager service or browser acceptance',operations:[],checks:[]};
const save=()=>writeFile(join(run,'result.json'),JSON.stringify(report,null,2)+'\n');
async function operation(label,args){const result=await runPluginCommand(context,args,options);report.operations.push({label,result});await save();assert.equal(result.exitCode,0,`${label}: ${result.output}`);assert.notEqual(result.timedOut,true);}
let ctx;
try{
 await operation('install actual tarball',['add',archive,...flags]);
 const name='dsh-model-groups';const installed=readProfileManifest('synthetic',dir);assert.ok(installed.dependencies?.[name]);assert.deepEqual(installed.dsh.profile.bundles,[]);
 const metadata=bundleManifest(name,dir,anchor);assert.equal(metadata.name,name);report.checks.push('actual tarball installed disabled and manifest recognized');
 installed.dsh.profile.bundles=[name];await writeFile(join(dir,'package.json'),JSON.stringify(installed,null,2));
 const loaded=loadProfileDirectory('synthetic',dir,anchor);assert.equal(loaded.skippedBundles.length,0);assert.equal(loaded.layers.length,1);
 const profile={name:'synthetic-packed',dir,patchPath:join(dir,'cordis.patch.yml'),installAnchor:anchor,cwd:run,home,startedBundles:[name],overlays:[],telemetryDisabledEnv:undefined};
 const base=join(run,'base.yml');await writeFile(base,'[]\n');
 ctx=new Context();ctx.provide('profileContext',profile);
 const records=new Map();ctx.provide('credentials',{readRecord:async key=>records.get(key),describeRecord:async key=>({configured:records.has(key),kind:records.get(key)?.kind,writable:true}),modifyRecord:async(key,mutate)=>{const record=await mutate(records.get(key));if(record)records.set(key,record);return record;},deleteRecord:async key=>{records.delete(key);}});
 for(const plugin of [Loader,LlmRuntime,Typert,ConfigEditor,Settings]){const fiber=ctx.plugin(plugin);await fiber.await();assert.equal(fiber.state,2);}
 // Resolve the actual installed bare package from the profile, not source checkout.
 await mountRootInclude(ctx,base,readProfilePatches('synthetic',profile),pathToFileURL(join(dir,'package.json')).href);
 await ctx.loader.await();const entry=[...ctx.loader.entries()].find(item=>item.options.id==='model-groups');assert.ok(entry);await entry.fiber.await();assert.equal(entry.fiber.state,2);
 assert.equal(entry.options.name,name,'Loader retains the ordinary bare package specifier');
 const installedEntry=createRequire(join(dir,'package.json')).resolve(name);
 assert.ok(installedEntry.startsWith(dir),'resolved package must originate in isolated installation');
 const actualModule=await import(pathToFileURL(installedEntry).href);
 assert.equal(entry.fiber.runtime.Config,actualModule.Config,'Loader must mount the actual installed package module');
 let state=await ctx.modelGroups.snapshot();assert.deepEqual(state.groups,{});
 state=await ctx.modelGroups.createGroup({name:'Synthetic Supplier',baseURL:'https://synthetic.invalid/v1',api:'openai-completions'},state.revision);
 const groupId=state.groupId;state=await ctx.modelGroups.createEntry(groupId,{name:'Synthetic Entry',models:['synthetic-model']},state.revision);const route=state.route;
 await ctx.modelGroups.setCredential(route,'synthetic-packed-secret');assert.equal((await ctx.llm.listModels(route)).length,1);
 assert.ok(!(await readFile(profile.patchPath,'utf8')).includes('synthetic-packed-secret'));report.checks.push('installed actual bundle activates empty, persists settings, and uses synthetic credential records');
 const patches=readProfilePatches('synthetic',profile);await reconcileProfilePatches(ctx,[...patches,{id:'model-groups',disabled:true}],'synthetic');assert.deepEqual(ctx.llm.listProviders(),[]);assert.equal(records.size,1);report.checks.push('ordinary disable unloads routes and retains credential records');
 await ctx.fiber.dispose();ctx=undefined;
 await operation('remove actual package',['remove',name,...flags.filter(flag=>flag!=='--ignore-scripts'),'--config.ignore-scripts=true']);
 const removed=readProfileManifest('synthetic',dir);assert.equal(removed.dependencies?.[name],undefined);assert.deepEqual(removed.dsh.profile.bundles,[name]);report.checks.push('official operation removes actual dependency; package operation alone retains bundle selection');report.limitations=['Package-operation removal does not reconcile the selected bundle list; full PluginManager lifecycle is not tested.'];report.passed=true;
}catch(error){report.passed=false;report.error=String(error?.stack??error);process.exitCode=1;}
finally{await ctx?.fiber.dispose();await save();}
console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,report:join(run,'result.json')},null,2));
