import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const tools = process.env.DSH_UI_TOOLS ?? '/tmp/dsh-groups-ui-tools';
const require = createRequire(path.join(tools, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright');
const output = process.env.DSH_UI_OUTPUT ?? '/sdcard/Download/DSH-Go';
fs.mkdirSync(output, { recursive: true });
const baseline = process.env.DSH_OLD_MODELS_CLIENT ?? '/opt/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js';
const reference = fs.readFileSync(baseline, 'utf8').replace('return module.exports;', 'return { MultiKeyEntriesEditor, MultiKeyToggle, zh };');
const entry = `
import React from ${JSON.stringify(path.join(tools, 'node_modules/react/index.js'))};
import { createRoot } from ${JSON.stringify(path.join(tools, 'node_modules/react-dom/client.js'))};
import * as jsxRuntime from ${JSON.stringify(path.join(tools, 'node_modules/react/jsx-runtime.js'))};
import { createBridgeProviderCard } from ${JSON.stringify(path.join(root, 'src/bridge/provider-card.js'))};
import { createLegacyPrimitives } from ${JSON.stringify(path.join(root, 'src/bridge/legacy-primitives.js'))};
const primitives = createLegacyPrimitives(React);
window.__ModuleLoader__={load({factory}){window.oldUI=factory(name=>name==='react'?React:name==='react/jsx-runtime'?jsxRuntime:name.includes('primitives')?primitives:{});}};
${reference}
const entries={work:{name:'工作配置',api:'openai-completions',apiKeyEnv:'SAMPLE_MULTKEY_WORK_API_KEY',models:[{id:'gpt-4.1',name:'GPT-4.1',input:['text','image'],contextWindow:1048576,maxTokens:32768},{id:'claude-sonnet-4',name:'Claude Sonnet 4',input:['text'],contextWindow:200000,maxTokens:8192}]},home:{name:'个人配置',api:'anthropic-messages',apiKeyEnv:'SAMPLE_MULTKEY_HOME_API_KEY',models:[{id:'claude-haiku-4',name:'Claude Haiku 4'}]}};
const calls={credentials:[],save:[],discover:[]};window.calls=calls;
let snapshot={status:'ready',revision:7,writable:true,providers:{sample:{enabled:true,active:true,confirmed:true,keyEntries:structuredClone(entries)}}};
const listeners=new Set();const store={getSnapshot:()=>snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},async save(route,draft,rev){calls.save.push({route,draft,rev});snapshot={...snapshot,revision:rev+1,providers:{sample:{...draft,active:draft.enabled,confirmed:draft.enabled}}};listeners.forEach(f=>f());return{ok:true};},async setCredential(ref,value){calls.credentials.push({ref,value});return{ok:true};},async discover(route,id,draft,options){calls.discover.push({route,id,draft,options});return{ok:true,models:[{id:'gpt-4.1',name:'GPT-4.1'},{id:'new-model',name:'New Model'}]};}};
const h=React.createElement,Card=createBridgeProviderCard(React,primitives),noop=()=>{};
function Old(){const[e,setE]=React.useState(entries),[keys,setKeys]=React.useState({}),[conf,setConf]=React.useState({});return h('section',{className:'zGbnIq_editor',style:{marginTop:12}},h(window.oldUI.MultiKeyToggle,{t:k=>window.oldUI.zh[k]??k,checked:true,disabled:false,onChange:noop}),h(window.oldUI.MultiKeyEntriesEditor,{reasoningLevels:['off','minimal','low','medium','high','xhigh','max'],route:'sample',entries:e,persistedEntries:entries,savedEntries:entries,keyDrafts:keys,confirmations:conf,onChange:setE,onKeyDraftsChange:setKeys,onConfirmationsChange:setConf,onBusyChange:noop,operations:{discoverModels:async()=>({kind:'found',models:[]})},probe:{provider:'sample',settingsNs:'llm-pi-ai'},disabled:false,t:k=>window.oldUI.zh[k]??k}));}
const mode=window.MODE;createRoot(document.getElementById('root')).render(mode==='old'?h(Old):h(Card,{provider:{provider:'sample',settingsNs:'llm-pi-ai'},bridgeStore:store}));
`;
const bundled = await build({ stdin: { contents: entry, resolveDir: tools, loader: 'js' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const css = fs.readFileSync(path.join(root, 'src/bridge/provider-card.css'), 'utf8');
const base = `*{box-sizing:border-box}body{margin:0;padding:20px;font:14px/22px system-ui,'Noto Sans CJK SC',sans-serif;color:var(--dsw-alias-label-primary)}p{margin:0}button,input,select{font:inherit}button{color:inherit}#root{max-width:820px;margin:auto} :root{--dsw-radius-sm:6px;--dsw-radius-md:8px;--dsw-radius-lg:12px;--dsw-radius-xl:16px;--dsw-alias-label-primary:#262626;--dsw-alias-label-secondary:#686b70;--dsw-alias-label-tertiary:#8b8e94;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-module-platform:#f5f6f8;--dsw-alias-settings-card-fill:#fff;--dsw-alias-settings-card-stroke:#d9dde2;--dsw-alias-border-l3:#d9dde2;--dsw-alias-border-l4:#e2e5e9;--dsw-alias-button-primary-fill:#3987ff;--dsw-alias-button-primary-hover:#2877ed;--dsw-alias-state-business-primary:#3987ff;--dsw-alias-label-danger:#d33;--dsw-alias-state-error-primary:#d33;--dsw-alias-interactive-bg-hover:#edf0f3;--dsw-alias-interactive-bg-hover-solid:#edf0f3}
html.dark{color-scheme:dark;background:#1f2023;--dsw-alias-label-primary:#efeff1;--dsw-alias-label-secondary:#acaeb4;--dsw-alias-label-tertiary:#92959d;--dsw-alias-bg-layer-1:#25272b;--dsw-alias-bg-module-platform:#292b30;--dsw-alias-settings-card-fill:#24262a;--dsw-alias-settings-card-stroke:#484b52;--dsw-alias-border-l3:#484b52;--dsw-alias-border-l4:#42454b;--dsw-alias-interactive-bg-hover-solid:#383b42}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = [];
try {
  for (const width of [860, 390]) for (const theme of ['light', 'dark']) {
    const pages = [];
    for (const mode of ['old', 'current']) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, deviceScaleFactor: 1 });
      const errors=[];page.on('pageerror', error=>errors.push(error.message));
      await page.setContent(`<html class="${theme}"><head><meta charset="utf-8"><style>${base}\n${css}</style></head><body><div id="root"></div></body></html>`);
      await page.evaluate(mode => window.MODE=mode, mode);
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      await page.locator('[data-key-entry-id="work"]').waitFor();
      const card = page.locator('[data-key-entry-id="work"]');
      await card.getByRole('button',{name:'展开详情',exact:true}).click();
      await card.getByRole('button',{name:'模型选项 1',exact:true}).click();
      await card.getByRole('switch',{name:'推理等级 1',exact:true}).check();
      await page.evaluate(()=>document.fonts.ready);
      const geometry = await card.evaluate(node => {
        const root=node.getBoundingClientRect();
        return [...node.querySelectorAll('input,select,[data-key-entry-heading],[data-group-capabilities],[data-row-key]')].filter(item=>item.getBoundingClientRect().height).map(item=>{const r=item.getBoundingClientRect(),s=getComputedStyle(item);return{tag:item.tagName,aria:item.getAttribute('aria-label'),type:item.getAttribute('type'),x:r.x-root.x,y:r.y-root.y,width:r.width,height:r.height,font:s.fontSize,padding:s.padding,borderRadius:s.borderRadius};});
      });
      pages.push({page,card,geometry,errors});
    }
    const [old,current]=pages;
    if (JSON.stringify(old.geometry)!==JSON.stringify(current.geometry)) throw new Error(`Original geometry differs at ${width}/${theme}: `+JSON.stringify({old:old.geometry,current:current.geometry}));
    if (current.errors.length||old.errors.length) throw new Error(JSON.stringify({old:old.errors,current:current.errors}));
    const png = path.join(output,`model-groups-restored-${width}-${theme}.png`);
    await current.page.screenshot({path:png,fullPage:true});
    const comparison=path.join(output,`model-groups-original-${width}-${theme}.png`);
    await old.page.screenshot({path:comparison,fullPage:true});
    await current.card.getByRole('button',{name:'获取可用模型',exact:true}).click();
    await current.page.getByRole('dialog').waitFor();
    if (await current.page.locator('[data-row-key]').count()!==3) throw new Error('Discovery mutated draft before confirmation');
    await current.page.getByRole('dialog').getByRole('checkbox',{name:'new-model',exact:true}).check();
    await current.page.getByRole('button',{name:'更新列表',exact:true}).click();
    if (await current.page.locator('[data-row-key]').count()!==4) throw new Error('Model adoption failed');
    await current.card.locator('button').first().focus();
    await current.card.locator('button').first().press('ArrowDown');
    await current.page.waitForFunction(()=>document.querySelector('[data-key-entry-id]')?.getAttribute('data-key-entry-id')==='home');
    const overflow=await current.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw new Error(`Horizontal overflow ${width}/${theme}`);
    report.push({width,theme,originalGeometryEqual:true,interactiveDiscovery:true,screenshot:png});
    for (const item of pages) await item.page.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(output,'model-groups-ui-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
