// Explicit real PluginManager service lifecycle; no real host profile or credentials.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import PluginManager from '@deepseek-ai/dsh-plugin-manager';
import { initProfile, readProfileManifest, mountRootInclude } from '@deepseek-ai/dsh-app-boot';
if(!process.argv[2])throw new Error('Pass the actual tarball');
const archive=await realpath(resolve(process.argv[2]));
const root=fileURLToPath(new URL('../',import.meta.url));
const run=await mkdtemp(join(tmpdir(),'synthetic-model-groups-manager-'));
const home=join(run,'home'),dir=join(run,'profile');await mkdir(home);await mkdir(dir);
const pnpm=process.env.MODEL_GROUPS_TEST_PNPM||'pnpm';
const env={PATH:process.env.PATH,HOME:home,XDG_CONFIG_HOME:join(home,'config'),XDG_CACHE_HOME:join(home,'cache'),CI:'true',npm_config_userconfig:join(home,'.npmrc'),npm_config_globalconfig:join(home,'global.npmrc'),COREPACK_ENABLE_NETWORK:'0'};
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
await writeFile(join(home,'.npmrc'),'registry=https://registry.npmjs.org/\nupdate-notifier=false\naudit=false\nfund=false\n');await writeFile(join(home,'global.npmrc'),'');
await symlink(join(root,'node_modules'),join(run,'node_modules'),'dir');
const anchor=join(run,'package.json');await writeFile(anchor,JSON.stringify({name:'synthetic-runtime-anchor',version:'0.2.2-rc.1',private:true}));initProfile(dir,[]);
const profile={name:'synthetic-manager',dir,patchPath:join(dir,'cordis.patch.yml'),installAnchor:anchor,cwd:run,home,startedBundles:[],overlays:[],telemetryDisabledEnv:undefined,packageManager:{command:pnpm,args:[],env}};
const report={archive,run,evidenceLevel:'Actual official PluginManager service installs disabled actual tarball, lists and removes; separate Loader activation tested by packed lifecycle',checks:[],results:{}};
const ctx=new Context();ctx.provide('profileContext',profile);
try{
 let fiber=ctx.plugin(Loader);await fiber.await();
 const base=join(run,'base.yml');await writeFile(base,'[]\n');await mountRootInclude(ctx,base,[],new URL('../',import.meta.url).href);
 fiber=ctx.plugin(PluginManager,{pnpmCommand:pnpm,registry:'https://registry.npmjs.org/',fallbackRegistries:[],idleTimeoutMs:120000});await fiber.await();assert.equal(fiber.state,2);
 const installed=await ctx.pluginManager.installBundle(archive,{enabled:false});report.results.install=installed;
 assert.ok(readProfileManifest('synthetic',dir).dependencies?.['dsh-model-groups']);
 const bundles=await ctx.pluginManager.listBundles();const bundle=bundles.find(item=>item.name==='dsh-model-groups');assert.ok(bundle);report.results.bundle=bundle;
 assert.deepEqual(readProfileManifest('synthetic',dir).dsh.profile.bundles,[]);report.checks.push('actual PluginManager installs actual tarball disabled and lists it');
 report.results.remove=await ctx.pluginManager.removeBundle('dsh-model-groups');
 const removed=readProfileManifest('synthetic',dir);assert.equal(removed.dependencies?.['dsh-model-groups'],undefined);assert.ok(!removed.dsh.profile.bundles.includes('dsh-model-groups'));assert.equal((await ctx.pluginManager.listBundles()).some(item=>item.name==='dsh-model-groups'),false);
 report.checks.push('actual PluginManager removes dependency and leaves no bundle selection or inventory entry');report.passed=true;
}catch(error){report.passed=false;report.error=String(error?.stack??error);process.exitCode=1;}
finally{await ctx.fiber.dispose();await writeFile(join(run,'result.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,report:join(run,'result.json')},null,2));
