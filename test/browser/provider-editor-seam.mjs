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
const proposed = proposeProviderEditorSeam(before);
const reference = proposed.replace('return module.exports;', 'return { Loaded, zh };');
assert.notEqual(reference, proposed);
const entry = `
import React from ${JSON.stringify(path.join(tools, 'node_modules/react/index.js'))};
import { createRoot } from ${JSON.stringify(path.join(tools, 'node_modules/react-dom/client.js'))};
import * as jsxRuntime from ${JSON.stringify(path.join(tools, 'node_modules/react/jsx-runtime.js'))};
import { SlotCore } from ${JSON.stringify(coreFile)};
import { createBridgeProviderCard } from ${JSON.stringify(path.join(repo, 'src/bridge/provider-card.js'))};
import { createLegacyPrimitives } from ${JSON.stringify(path.join(repo, 'src/bridge/legacy-primitives.js'))};
const h=React.createElement, primitives={...createLegacyPrimitives(React),
  // The primitive drag-image hook is a fixture: this probe exercises editor
  // composition and does not claim native pointer-drag acceptance.
  useRowDragPreview:()=>React.useMemo(()=>({start(){throw Error('Pointer dragging is outside this fixture');},clear:()=>false}),[])};
window.__ModuleLoader__={load({factory}){window.nativeUI=factory(name=>name==='react'?React:name==='react/jsx-runtime'?jsxRuntime:name.includes('primitives')?primitives:{});}};
${reference}
const counters={settings:0,credentials:0,discovery:0};window.counters=counters;
const profiles={primary:{displayName:'工作供应商',api:'openai-completions',baseURL:'http://127.0.0.1:1/dsh-model-groups-disabled',models:[{id:'@dsh-key/g_fixture/model-a'}]},secondary:{displayName:'单密钥供应商',api:'openai-completions',baseURL:'https://ordinary.example/v1',models:[{id:'ordinary-model'}]}};
const ns={ns:'llm-pi-ai',schema:{},user:{providers:profiles},value:{providers:profiles},base:{providers:{}},revision:'fixture-7'};
const account={ns:'llm-account',schema:{},user:{},value:{},base:{},revision:'fixture-8'};
const makeRow=(provider,displayName,settingsNs='llm-pi-ai')=>({entry:{provider,displayName,settingsNs,settingsPath:settingsNs==='llm-pi-ai'?['providers',provider]:[],active:true,declared:settingsNs==='llm-pi-ai'},configured:true,removable:settingsNs==='llm-pi-ai',credential:{configured:true,writable:true,source:'file'},apiKeyEnv:'FIXTURE_CREDENTIAL',accountAvailable:provider==='deepseek-account'});
const state={status:'ready',writable:true,rows:[makeRow('deepseek-account','Account','llm-account'),makeRow('primary','工作供应商'),makeRow('secondary','单密钥供应商')],namespaces:new Map([['llm-pi-ai',ns],['llm-account',account]])};
const getPath=(value,keys)=>keys.reduce((v,k)=>v?.[k],value);
const setPath=(value,keys,next)=>{const clone=structuredClone(value??{});let cur=clone;keys.slice(0,-1).forEach(k=>cur=cur[k]??=(typeof k==='number'?[]:{}));cur[keys.at(-1)]=next;return clone;};
const schema={rehydrate:s=>s,getPath,hasPath:(v,p)=>getPath(v,p)!==undefined,setPath,deletePath:(value,keys)=>{const clone=structuredClone(value??{});const parent=getPath(clone,keys.slice(0,-1));if(parent)delete parent[keys.at(-1)];return clone;},validate:()=>undefined,nodeAtPath:(_s,keys)=>keys.at(-1)==='api'?{type:'union',list:['openai-completions','openai-responses','anthropic-messages'].map(value=>({value}))}:keys.at(-1)==='reasoningEfforts'?{type:'union',list:[]}:{type:'object',meta:{default:[]}}};
const injected={t:k=>window.nativeUI.zh[k]??k,useSnapshot:()=>state,schema,controller:{store:{getSnapshot:()=>state},load:async()=>{}},operations:{writeSettings:async()=>{counters.settings++;return{kind:'refused',message:'Fixture is read-only'};},storeCredential:async()=>{counters.credentials++;},discoverModels:async()=>{counters.discovery++;return{kind:'found',models:[]};}}};
let snapshot={status:'ready',writable:true,revision:7,providers:{primary:{enabled:true,active:true,confirmed:true,shared:{api:'openai-completions',baseURL:'https://upstream.example/v1',headers:[]},keyEntries:{work:{name:'工作密钥',apiKeyEnv:'FIXTURE_WORK_KEY',models:[{id:'model-a',name:'模型 A',input:['text']}]}}},secondary:{enabled:false,active:false,confirmed:false,shared:{api:'openai-completions',baseURL:'https://ordinary.example/v1',headers:[]},keyEntries:{}}}};
const store={getSnapshot:()=>snapshot,subscribe:()=>()=>{},save:async()=>{counters.settings++;return{ok:false,code:'READ_ONLY'};},setCredential:async()=>{counters.credentials++;return{ok:false,code:'READ_ONLY'};},discover:async()=>{counters.discovery++;return{ok:true,models:[]};}};
const lockedSnapshot={...snapshot,writable:false};
const lockedStore={...store,getSnapshot:()=>lockedSnapshot};
const Card=createBridgeProviderCard(React,primitives);
function Editor(props){const record=snapshot.providers[props.provider.provider];return record?.enabled?h(Card,{provider:props.provider,bridgeStore:props.readOnly?lockedStore:store}):props.defaultEditor;}
const core=new SlotCore();
core.register({name:'root',children:{'settings.section':{kind:'list',scope:'root'}}},()=>null);
core.register({name:'settings.section',id:'models',children:{'settings.models.provider-card':{kind:'keyed',scope:'root'},'settings.models.provider-editor':{kind:'keyed',scope:'root'},'settings.models.footer':{kind:'list',scope:'root'}}},window.nativeUI.Loaded);
const native=core.entriesOfSlot('settings.section')[0];
core.register({name:'settings.models.provider-card',key:'llm-pi-ai'},props=>h('aside',{'data-other-provider-extension':props.provider.provider},'第三方卡片扩展'));
core.register({name:'settings.models.footer',id:'third-party-footer'},()=>h('aside',{'data-other-footer':true},'第三方页尾扩展'));
const stopEditor=core.register({name:'settings.models.provider-editor',key:'llm-pi-ai'},Editor);
const renderSlot=(key,props,options={})=>{if(!core.isLive(native)||!native.children?.[key])throw Error('Unauthorized fixture child');const entries=core.entriesOfSlot(key);if(native.children[key].kind==='keyed'){const entry=entries.find(e=>e.options.key===options.entryKey);return entry?h(entry.component,props):options.fallback??null;}return h(React.Fragment,null,...entries.map(e=>h(e.component,{...props,key:e.options.id})));};
function App(){const[revision,setRevision]=React.useState(0);window.makeReadonly=()=>{state.writable=false;setRevision(x=>x+1);};window.removeEditor=()=>{stopEditor();setRevision(x=>x+1);};return h(window.nativeUI.Loaded,{injected,renderSlot,revision});}
createRoot(document.getElementById('root')).render(h(App));
`;
const bundled = await build({ stdin: { contents: entry, resolveDir: tools, loader: 'js' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const css = fs.readFileSync(path.join(repo, 'src/bridge/provider-card.css'), 'utf8');
const base='*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/22px system-ui,sans-serif}p{margin:0}button,input,select{font:inherit}#root{max-width:820px;margin:auto}:root{--dsw-radius-md:8px;--dsw-radius-xl:16px;--dsw-alias-label-primary:#252525;--dsw-alias-label-secondary:#666;--dsw-alias-label-tertiary:#888;--dsw-alias-bg-layer-1:white;--dsw-alias-bg-module-platform:#f5f6f8;--dsw-alias-settings-card-fill:white;--dsw-alias-settings-card-stroke:#ddd;--dsw-alias-border-l3:#ddd;--dsw-alias-border-l4:#ddd;--dsw-alias-button-primary-fill:#111;--dsw-alias-label-primary-foreground:white}';
fs.mkdirSync(output,{recursive:true});
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report=[];
try {
  for(const width of [390,860]){
    const page=await browser.newPage({viewport:{width,height:1100}});
    page.setDefaultTimeout(7000);
    const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Fixture page error:',e.message);});
    await page.setContent('<html><head><meta charset="utf-8"><style>'+base+css+'</style></head><body><div id="root"></div></body></html>');
    await page.addScriptTag({content:bundled.outputFiles[0].text});
    const primary=page.locator('[data-models-provider-editor="primary"]');
    await primary.waitFor({state:'attached'});
    assert.equal(await primary.isVisible(),false,'initial state collapses the entire multi-key editor');
    const primaryRow=page.locator('li').filter({has:primary});
    const actualEdit=primaryRow.locator('button[aria-label]').filter({hasText:/^编辑$/});
    await actualEdit.click();
    await primary.getByText('工作密钥',{exact:true}).waitFor();
    assert.equal(await primary.getByRole('button',{name:'保存',exact:true}).count(),1);
    assert.equal(await primary.getByText('自定义设置',{exact:true}).count(),0,'managed provider must not also mount the native single-key form');
    const key=primary.locator('[data-key-entry-id="work"]');
    await key.getByRole('button',{name:'展开详情',exact:true}).click();
    const name=key.getByRole('textbox',{name:'配置名称 1',exact:true});
    await name.fill('保留的未保存草稿');
    await actualEdit.click();
    assert.equal(await primary.isVisible(),false,'the native Edit button collapses keys, shared fields and actions together');
    await actualEdit.click();
    assert.equal(await name.inputValue(),'保留的未保存草稿');
    const secondary=page.locator('[data-models-provider-editor="secondary"]');
    const secondaryRow=page.locator('li').filter({has:secondary});
    await secondaryRow.locator('button[aria-label]').filter({hasText:/^编辑$/}).click();
    assert.equal(await primary.isVisible(),false,'switching native editor focus hides the previous whole editor');
    await secondary.getByText('自定义设置',{exact:true}).waitFor();
    assert.equal(await secondary.getByText('共用配置',{exact:true}).count(),0,'inactive provider has no phantom shared-config card');
    assert.equal(await secondary.getByRole('button',{name:'保存',exact:true}).count(),1);
    assert.equal(await page.locator('[data-other-provider-extension]').count(),2);
    assert.equal(await page.locator('[data-other-footer]').count(),1);
    assert.equal(await page.getByText(await page.evaluate(()=>window.nativeUI.zh.deepSeekAccount),{exact:true}).count(),1);
    const screenshot=path.join(output,'model-groups-editor-prototype-'+width+'.png');
    await page.screenshot({path:screenshot,fullPage:true});
    await actualEdit.click();
    await page.evaluate(()=>window.makeReadonly());
    await page.waitForFunction(()=>document.querySelector('[data-models-provider-editor="primary"] input')?.disabled===true);
    assert.equal(await name.isDisabled(),true,'native read-only state also locks the delegated editor');
    await page.evaluate(()=>window.removeEditor());
    await primary.getByText('自定义设置',{exact:true}).waitFor();
    assert.equal(await primary.getByText('共用配置',{exact:true}).count(),0,'unregistering editor restores native fallback without replacing the page');
    assert.deepEqual(await page.evaluate(()=>window.counters),{settings:0,credentials:0,discovery:0});
    assert.deepEqual(errors,[]);
    report.push({width,nativeEditControlsWholeEditor:true,draftSurvivesCollapse:true,oneFormPerProvider:true,inactiveProviderUsesNativeEditor:true,accountAndForeignExtensionsRemain:true,unregisterRestoresNativeEditor:true,writes:0,screenshot});
    await page.close();
  }
} finally {await browser.close();}
assert.equal(fs.readFileSync(hostClient,'utf8'),before,'actual host source must stay untouched');
fs.writeFileSync('/tmp/dsh-groups-provider-editor-prototype.js',proposed);
fs.writeFileSync(path.join(output,'model-groups-editor-prototype-verification.json'),JSON.stringify({kind:'isolated-prototype',installed:false,hostUntouched:true,report},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
