import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dictionaries } from '../src/ui/locale.js';
const require = createRequire(import.meta.url);
test('built browser factory loads, mounts remote, renders official slots, and disposes', async () => {
 let exported; let loadedId;
 const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load:({id,factory})=>{loadedId=id;exported=factory(name=>{assert.equal(name,'react');return require(name);});}}},console,TextEncoder,TextDecoder,URL,structuredClone,crypto:globalThis.crypto});
 assert.equal(loadedId,'dsh-model-groups'); assert.equal(typeof exported.apply,'function');
 assert.deepEqual([...exported.inject].sort(),['configForms','locale','modelDirectories','remote','sessions','slots']);
 const registrations=[];const disposers=[];let mounted=false;let unmounted=false;
 const form={getSnapshot:()=>({status:'ready',writable:true,revision:1,value:{groups:{},tombstones:{}}}),subscribe:()=>()=>{}};
 const directory={store:{getSnapshot:()=>({current:{provider:'mg-example',model:'model/exact',reasoningEffort:'custom-effort'},groups:[],failures:[],status:'ready',pending:null,error:null,routable:false}),subscribe:()=>()=>{}}};
 const ctx={
  remote:{$mount:async contribution=>{assert.equal(contribution.package,'dsh-model-groups');mounted=true;return()=>{unmounted=true;};},modelGroups:{snapshot:async()=>({ok:true,value:{credentials:{route:{configured:true}}}})}},
  on:(event,fn)=>{assert.equal(event,'dispose');disposers.push(fn);},effect:fn=>disposers.push(fn()),
  locale:{register:()=>()=>{},bind:()=>key=>key,resolveText:text=>text},
  configForms:{get:name=>{assert.equal(name,'model-groups');return form;}},
  modelDirectories:{directoryFor:()=>directory},sessions:{subagentAddress:()=>undefined,scope:()=>({effect:fn=>disposers.push(fn())})},
  slots:{inject:(_slot,fn)=>fn(),register:(spec,component)=>{assert.ok(mounted);registrations.push({spec,component});return()=>{};}}
 };
 await exported.apply(ctx);
 const settings=registrations.find(x=>x.spec.name==='settings.section');
 const props=settings.spec.inject(); assert.equal(await props.operations.credentialStatus({entryId:'route'}),true);
 assert.match(renderToStaticMarkup(React.createElement(settings.component,{...props,t:key=>dictionaries.en[key]||key})),/Model groups/);
 const seat=registrations.find(x=>x.spec.name==='conversation.input.model');
 assert.match(renderToStaticMarkup(React.createElement(seat.component,{...seat.spec.inject('session-fixture'),locked:true})),/model\/exact · custom-effort/);
 for(const dispose of disposers.reverse()) dispose(); assert.ok(unmounted);
});
