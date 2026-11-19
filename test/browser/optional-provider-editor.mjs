import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { proposeProviderEditorSeam } from '../prototypes/provider-editor-seam.mjs';

// Full native Models-page composition probe with fixture Settings/credentials
// and a real published SlotCore. It does not launch or contact the running GUI.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const tools = process.env.DSH_UI_TOOLS ?? '/tmp/dsh-groups-ui-tools';
const require = createRequire(path.join(tools, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright');
const hostClient = process.env.DSH_MODELS_CLIENT ?? '/opt/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js';
const coreFile = process.env.DSH_SLOT_CORE ?? '/tmp/dsh-groups-slot-core/package/lib/index.js';
const output = process.env.DSH_UI_OUTPUT ?? '/sdcard/Download/DSH-Go';
const before = fs.readFileSync(hostClient, 'utf8');
const capable = process.env.DSH_EDITOR_CAPABILITY !== '0';
const theme = process.env.DSH_UI_THEME === 'dark' ? 'dark' : 'light';
const proposed = capable ? proposeProviderEditorSeam(before) : before;
const reference = proposed.replace('return module.exports;', 'return { Loaded, zh };');
assert.notEqual(reference, proposed);
const entry = `
import React from ${JSON.stringify(path.join(tools, 'node_modules/react/index.js'))};
import { createRoot } from ${JSON.stringify(path.join(tools, 'node_modules/react-dom/client.js'))};
import * as jsxRuntime from ${JSON.stringify(path.join(tools, 'node_modules/react/jsx-runtime.js'))};
import { SlotCore } from ${JSON.stringify(coreFile)};
import { registerBridgeProviderCard } from ${JSON.stringify(path.join(repo, 'src/bridge/provider-card.js'))};
import { createLegacyPrimitives } from ${JSON.stringify(path.join(repo, 'src/bridge/legacy-primitives.js'))};
const h=React.createElement, primitives={...createLegacyPrimitives(React),
  // The primitive drag-image hook is a fixture: this probe exercises editor
  // composition and does not claim native pointer-drag acceptance.
  useRowDragPreview:()=>React.useMemo(()=>({start(){throw Error('Pointer dragging is outside this fixture');},clear:()=>false}),[])};
window.__ModuleLoader__={load({factory}){window.nativeUI=factory(name=>name==='react'?React:name==='react/jsx-runtime'?jsxRuntime:name.includes('primitives')?primitives:{});}};
${reference}
const counters={settings:0,credentials:0,discovery:0};window.counters=counters;const subscriptions=new Set();window.savedPayloads=[];
const profiles={primary:{displayName:'工作供应商',api:'openai-completions',baseURL:'http://127.0.0.1:1/dsh-model-groups-disabled',models:[{id:'@dsh-key/g_fixture/model-a'}]},secondary:{displayName:'单密钥供应商',api:'openai-completions',baseURL:'https://ordinary.example/v1',models:[{id:'ordinary-model'}]}};
const ns={ns:'llm-pi-ai',schema:{},user:{providers:profiles},value:{providers:profiles},base:{providers:{}},revision:'fixture-7'};
const account={ns:'llm-account',schema:{},user:{},value:{},base:{},revision:'fixture-8'};
const makeRow=(provider,displayName,settingsNs='llm-pi-ai')=>({entry:{provider,displayName,settingsNs,settingsPath:settingsNs==='llm-pi-ai'?['providers',provider]:[],active:true,declared:settingsNs==='llm-pi-ai'},configured:true,removable:settingsNs==='llm-pi-ai',credential:{configured:true,writable:true,source:'file'},apiKeyEnv:'FIXTURE_CREDENTIAL',accountAvailable:provider==='deepseek-account'});
const state={status:'ready',writable:true,rows:[makeRow('deepseek-account','Account','llm-account'),makeRow('primary','工作供应商'),makeRow('secondary','单密钥供应商')],namespaces:new Map([['llm-pi-ai',ns],['llm-account',account]])};
const getPath=(value,keys)=>keys.reduce((v,k)=>v?.[k],value);
const setPath=(value,keys,next)=>{const clone=structuredClone(value??{});let cur=clone;keys.slice(0,-1).forEach(k=>cur=cur[k]??=(typeof k==='number'?[]:{}));cur[keys.at(-1)]=next;return clone;};
const schema={rehydrate:s=>s,getPath,hasPath:(v,p)=>getPath(v,p)!==undefined,setPath,deletePath:(value,keys)=>{const clone=structuredClone(value??{});const parent=getPath(clone,keys.slice(0,-1));if(parent)delete parent[keys.at(-1)];return clone;},validate:()=>undefined,nodeAtPath:(_s,keys)=>keys.at(-1)==='api'?{type:'union',list:['openai-completions','openai-responses','anthropic-messages'].map(value=>({value}))}:keys.at(-1)==='reasoningEfforts'?{type:'union',list:[]}:{type:'object',meta:{default:[]}}};
const injected={t:k=>window.nativeUI.zh[k]??k,useSnapshot:()=>state,schema,controller:{store:{getSnapshot:()=>state},load:async()=>{}},operations:{writeSettings:async()=>{counters.settings++;return{kind:'refused',message:'Fixture is read-only'};},storeCredential:async()=>{counters.credentials++;},discoverModels:async()=>{counters.discovery++;return{kind:'found',models:[]};}}};
let snapshot={status:'ready',writable:true,revision:7,nativeRevision:3,providers:{primary:{enabled:true,active:true,confirmed:true,shared:{displayName:'工作供应商',api:'openai-completions',baseURL:'https://upstream.example/v1',headers:{}},singleKey:{apiKeyEnv:'ROOT_KEY',models:[{id:'root-model'}]},keyEntries:{work:{name:'工作密钥',apiKeyEnv:'FIXTURE_WORK_KEY',models:[{id:'model-a',name:'模型 A',input:['text']}]}}},secondary:{enabled:false,active:false,confirmed:false,shared:{displayName:'单密钥供应商',api:'openai-completions',baseURL:'https://ordinary.example/v1',headers:{}},singleKey:{apiKeyEnv:'ORDINARY_KEY',models:[{id:'ordinary-model'}]},keyEntries:{}}}};
const store={getSnapshot:()=>snapshot,subscribe:listener=>{subscriptions.add(listener);return()=>subscriptions.delete(listener);},
 save:async(route,draft,revision)=>{if(revision!==snapshot.revision)return{ok:false,code:'STATE_CHANGED'};counters.settings++;window.savedPayloads.push(structuredClone(draft));
 const old=snapshot.providers[route];const record={...old,...draft,shared:{...old.shared,...draft.shared},singleKey:{...old.singleKey,...draft.singleKey},active:draft.enabled,confirmed:draft.enabled};
 snapshot={...snapshot,revision:revision+1,nativeRevision:snapshot.nativeRevision+1,providers:{...snapshot.providers,[route]:record}};
 if(record.shared.displayName)state.rows=state.rows.map(row=>row.entry.provider===route?{...row,entry:{...row.entry,displayName:record.shared.displayName}}:row);
 for(const listener of subscriptions)listener();return{ok:true};},
 setCredential:async()=>{counters.credentials++;return{ok:true};},discover:async()=>{counters.discovery++;return{ok:true,models:[{id:'model-a'},{id:'new-model'}]};}};
const core=new SlotCore();
core.register({name:'root',children:{'settings.section':{kind:'list',scope:'root'}}},()=>null);
core.register({name:'settings.section',id:'models',children:{'settings.models.provider-card':{kind:'keyed',scope:'root'},${capable ? "'settings.models.provider-editor':{kind:'keyed',scope:'root'}," : ''}'settings.models.footer':{kind:'list',scope:'root'}}},window.nativeUI.Loaded);
const native=core.entriesOfSlot('settings.section')[0];
core.register({name:'settings.models.provider-card',key:'llm-pi-ai'},props=>h('aside',{'data-other-provider-extension':props.provider.provider},'第三方卡片扩展'));
core.register({name:'settings.models.footer',id:'third-party-footer'},()=>h('aside',{'data-other-footer':true},'第三方页尾扩展'));
const stopEditor=registerBridgeProviderCard({slots:{inject(name,callback){return name==='settings.models.provider-editor'&&!${capable}?()=>{}:callback();},register(options,component){return core.register(options,component);}}},React,store,primitives);
const renderSlot=(key,props,options={})=>{if(!core.isLive(native)||!native.children?.[key])throw Error('Unauthorized fixture child');const entries=core.entriesOfSlot(key);if(native.children[key].kind==='keyed'){const entry=entries.find(e=>e.options.key===options.entryKey);return entry?h(entry.component,{...props,...entry.inject?.()}):options.fallback??null;}return h(React.Fragment,null,...entries.map(e=>h(e.component,{...props,key:e.options.id})));};
function App(){const[revision,setRevision]=React.useState(0);window.makeReadonly=()=>{state.writable=false;setRevision(x=>x+1);};window.removeEditor=()=>{stopEditor();setRevision(x=>x+1);};return h(window.nativeUI.Loaded,{injected,renderSlot,revision});}
createRoot(document.getElementById('root')).render(h(App));
`;
const bundled = await build({ stdin: { contents: entry, resolveDir: tools, loader: 'js' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const css = fs.readFileSync(path.join(repo, 'src/bridge/provider-card.css'), 'utf8');
const base='*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/22px system-ui,sans-serif}p{margin:0}button,input,select{font:inherit}#root{max-width:820px;margin:auto}:root{--dsw-radius-md:8px;--dsw-radius-xl:16px;--dsw-alias-label-primary:#252525;--dsw-alias-label-secondary:#666;--dsw-alias-label-tertiary:#888;--dsw-alias-bg-layer-1:white;--dsw-alias-bg-module-platform:#f5f6f8;--dsw-alias-settings-card-fill:white;--dsw-alias-settings-card-stroke:#ddd;--dsw-alias-border-l3:#ddd;--dsw-alias-border-l4:#ddd;--dsw-alias-button-primary-fill:#111;--dsw-alias-label-primary-foreground:white}';
const palette = theme === 'dark' ? ':root{color-scheme:dark;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#c3c3c7;--dsw-alias-label-tertiary:#a4a4aa;--dsw-alias-bg-layer-1:#242424;--dsw-alias-bg-module-platform:#333;--dsw-alias-settings-card-fill:#292929;--dsw-alias-settings-card-stroke:#444;--dsw-alias-border-l2:#414141;--dsw-alias-border-l3:#49494c;--dsw-alias-border-l4:#464649;--dsw-alias-button-primary-fill:#f4f4f6;--dsw-alias-label-primary-foreground:#111}body{background:#29292b;color:#eee}' : '';
fs.mkdirSync(output,{recursive:true});
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

const report=[];
try {
 for(const width of [390,860]){
  const page=await browser.newPage({viewport:{width,height:1100}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Fixture error:',error.message);});
  await page.setContent('<html><head><meta charset="utf-8"><style>'+base+palette+css+'</style></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.locator('[data-other-provider-extension="primary"]').waitFor();
  assert.equal(await page.locator('[data-other-provider-extension]').count(),2);
  assert.equal(await page.locator('[data-other-footer]').count(),1);
  assert.equal(await page.getByText(await page.evaluate(()=>window.nativeUI.zh.deepSeekAccount),{exact:true}).count(),1);
  if(capable){
   const editor=page.locator('[data-models-provider-editor="primary"]');
   const row=page.locator('li').filter({has:editor});const edit=row.locator('button[aria-label]').filter({hasText:/^编辑$/});
   assert.equal(await editor.isVisible(),false);await edit.click();
   assert.equal(await editor.getByRole('button',{name:'保存',exact:true}).count(),1);
   assert.equal(await editor.getByRole('button',{name:'取消',exact:true}).count(),1);
   assert.equal(await editor.getByText('自定义设置',{exact:true}).count(),0);
   assert.equal(await page.locator('[data-bridge-editor-unavailable]').count(),0);
   const publicSettings=editor.locator('[data-bridge-public-settings]');
   const summary=publicSettings.locator(':scope > summary');
   assert.equal(await summary.textContent(),'公共设置');
   assert.match(await editor.locator('[data-bridge-provider-heading]').textContent(),/工作供应商.*primary/);
   assert.equal(await publicSettings.locator('[data-key-entry-id]').count(),1,'key cards belong to public settings, not a sibling section');
   assert.equal(await publicSettings.locator('.dsh-mg-native-rowCard').count(),1,'shared fields do not get a peer card');
   const fields=await publicSettings.locator('.dsh-mg-shared-fields > label').evaluateAll(labels=>labels.map(label=>{const r=label.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
   assert.equal(fields.length,3);assert.ok(fields[0].y<fields[1].y&&fields[1].y<fields[2].y,'shared fields are stacked in the reference order');
   assert.ok(fields.every(field=>Math.abs(field.x-fields[0].x)<1));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'narrow layouts must not overflow');
   await page.screenshot({path:path.join(output,`model-groups-hierarchy-${width}-${theme}.png`),fullPage:true});
   await editor.locator('[data-bridge-provider]').screenshot({path:path.join(output,`model-groups-hierarchy-editor-${width}-${theme}.png`)});
   const group=publicSettings.locator('[data-key-entry-id="work"]');await group.getByRole('button',{name:'展开详情',exact:true}).click();
   const keyName=group.getByRole('textbox',{name:'配置名称 1',exact:true});await keyName.fill('折叠保留的草稿');
   const keyInput=group.getByLabel('API 密钥 1',{exact:true});await keyInput.fill('synthetic-collapsed-draft');
   await summary.click();await group.waitFor({state:'hidden'});
   assert.equal(await editor.getByRole('button',{name:'保存',exact:true}).count(),1);
   await summary.click();await group.waitFor({state:'visible'});
   assert.equal(await keyName.inputValue(),'折叠保留的草稿');assert.equal(await keyInput.inputValue(),'synthetic-collapsed-draft');
   assert.deepEqual(await page.evaluate(()=>window.counters),{settings:0,credentials:0,discovery:0});await keyInput.fill('');
   await edit.click();assert.equal(await editor.isVisible(),false);await edit.click();assert.equal(await keyName.inputValue(),'折叠保留的草稿');
   await editor.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await editor.isVisible(),false);
   await edit.click();await group.getByRole('button',{name:'展开详情',exact:true}).click();assert.equal(await keyName.inputValue(),'工作密钥');assert.equal(await editor.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
   const displayName=editor.getByRole('textbox',{name:'供应商名称',exact:true});await displayName.fill('工作供应商新名称');await keyName.fill('工作密钥新名称');
   await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'hidden'});
   await edit.click();assert.equal(await displayName.inputValue(),'工作供应商新名称');assert.equal(await editor.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
   const payload=await page.evaluate(()=>window.savedPayloads[0]);assert.deepEqual(payload.shared,{displayName:'工作供应商新名称'});assert.equal(payload.singleKey,undefined);assert.equal(payload.keyEntries.work.name,'工作密钥新名称');
   const secondary=page.locator('[data-models-provider-editor="secondary"]');const secondaryRow=page.locator('li').filter({has:secondary});
   await secondaryRow.locator('button[aria-label]').filter({hasText:/^编辑$/}).click();
   assert.equal(await editor.isVisible(),false);assert.equal(await secondary.getByText('共用配置',{exact:true}).count(),0);
   assert.equal(await secondary.locator('[data-key-entry-id]').count(),0);assert.equal(await secondary.getByRole('button',{name:'保存',exact:true}).count(),1);
   assert.equal(await secondary.getByLabel('单密钥 API 密钥',{exact:true}).count(),1);
   assert.equal(await secondary.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
   await secondary.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await secondary.isVisible(),false);
   await edit.click();await page.evaluate(()=>window.makeReadonly());
   await page.waitForFunction(()=>document.querySelector('[data-models-provider-editor="primary"] input')?.disabled===true);
   assert.equal(await displayName.isDisabled(),true);assert.equal(await editor.getByRole('button',{name:'取消',exact:true}).isDisabled(),false);
   await page.screenshot({path:path.join(output,`model-groups-unified-editor-${width}.png`),fullPage:true});
   await page.evaluate(()=>window.removeEditor());await editor.getByText('自定义设置',{exact:true}).waitFor();
   assert.equal(await page.locator('[data-other-provider-extension]').count(),2);assert.equal(await page.locator('[data-other-footer]').count(),1);
   assert.deepEqual(await page.evaluate(()=>window.counters),{settings:1,credentials:0,discovery:0});
  }else{
   assert.equal(await page.locator('[data-bridge-provider]').count(),0,'missing interface must never mount a second editable form');
   await page.locator('[data-bridge-editor-unavailable]').waitFor();
   assert.equal(await page.getByText('共用配置',{exact:true}).count(),0);
   const row=page.locator('li').filter({has:page.locator('[data-other-provider-extension="secondary"]')});
   await row.locator('button[aria-label]').filter({hasText:/^编辑$/}).click();await row.getByText('自定义设置',{exact:true}).waitFor();
   assert.equal(await row.getByRole('button',{name:'保存',exact:true}).count(),1,'ordinary native editing remains available');
   await page.screenshot({path:path.join(output,`model-groups-no-editor-interface-${width}.png`),fullPage:true});
   assert.deepEqual(await page.evaluate(()=>window.counters),{settings:0,credentials:0,discovery:0});
  }
  assert.deepEqual(errors,[]);report.push({width,editorInterface:capable,oneEditorPerProvider:true,foreignExtensionsRemain:true,nativeFallback:true,actualHostUntouched:true});
  await page.close();
 }
}finally{await browser.close();}
assert.equal(fs.readFileSync(hostClient,'utf8'),before);
fs.writeFileSync(path.join(output,`model-groups-${capable?'unified-editor':'no-editor-interface'}-verification.json`),JSON.stringify({kind:'isolated-native-page-fixture',installed:false,report},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
