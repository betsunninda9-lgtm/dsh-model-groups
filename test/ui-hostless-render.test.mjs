import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPicker, SettingsEditor } from '../src/ui/components.js';
import { apply } from '../src/ui/index.js';
import { styles } from '../src/ui/styles.js';
import { zh } from '../src/ui/locale.js';
const store = value => ({getSnapshot:()=>value, subscribe:()=>()=>{}});
const form = store({status:'ready',writable:true,revision:2,value:{groups:{},tombstones:{}}});
const state={current:{provider:'mg-route',model:'model/a',reasoningEffort:'high'},groups:[{id:'mg-route',name:'A very long supplier name that must wrap',models:[{id:'model/a',name:'Model A',reasoning:{efforts:[{id:'high',name:'High'}]}}]}],status:'ready',pending:null,error:null,failures:[],routable:true};
test('locked picker retains identity, disables model mutation, renders accessible independent controls',()=>{
 const html=renderToStaticMarkup(React.createElement(ModelPicker,{directory:{store:store(state)},form,locked:true}));
 assert.match(html,/mg-route \/ model\/a · high/);
 assert.match(html,/aria-pressed="true"/); assert.match(html,/disabled=""/);
 assert.match(html,/Model changes are locked/); assert.match(html,/Separate panel/);
});
test('pending, error, missing saved model, and subagent restriction are surfaced',()=>{
 const html=renderToStaticMarkup(React.createElement(ModelPicker,{directory:{store:store({...state,status:'selecting',pending:state.current,error:'Synthetic failure',routable:false,failures:[{}]})},form,available:false}));
 for (const text of ['addressed subagents','Synthetic failure','Selecting mg-route','saved selection is unavailable','provider catalog(s) failed']) assert.ok(html.includes(text));
});
test('settings unavailable and read-only states do not allow editing',()=>{
 const html=renderToStaticMarkup(React.createElement(SettingsEditor,{form:store({status:'unavailable',writable:false})}));
 assert.match(html,/namespace is unavailable/); assert.match(html,/disabled=""/);
});
test('public registration elects primary seat and owns only model-groups settings',()=>{
 const registrations=[]; const effects=[]; const formNames=[];
 const ctx={locale:{register:()=>()=>{},bind:()=>x=>x},configForms:{get:name=>{formNames.push(name);return form;}},effect:fn=>effects.push(fn()),slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{registrations.push({spec,component});return ()=>{};}},sessions:{},modelDirectories:{}};
 apply(ctx);
 assert.deepEqual(formNames,['model-groups']);
 assert.equal(registrations.find(x=>x.spec.name==='conversation.input.model').spec.priority,-10);
 assert.ok(registrations.some(x=>x.spec.name==='conversation.input.dock'));
 effects.forEach(dispose=>dispose());
});
test('official locale translator renders Chinese settings and picker controls',()=>{
 const t = key => zh[key] || key;
 const picker = renderToStaticMarkup(React.createElement(ModelPicker,{directory:{store:store(state)},form,t}));
 const settings = renderToStaticMarkup(React.createElement(SettingsEditor,{form,t}));
 assert.match(picker,/内联折叠/); assert.match(picker,/独立面板/); assert.match(settings,/添加供应商/);
});
test('Chinese localization never rewrites supplier configuration model or effort labels',()=>{
 const t=key=>zh[key]||key;
 const namedForm=store({status:'ready',writable:true,revision:1,value:{groups:{g:{name:'Models',baseURL:'https://example.test',api:'openai-responses',entries:{route:{name:'Close',models:['exact']}}}},tombstones:{}}});
 const namedState={...state,current:{provider:'route',model:'exact'},groups:[{id:'route',name:'Models',models:[{id:'exact',name:'Close',reasoning:{efforts:[{id:'effort',name:'Refresh'}]}}]}]};
 const picker=renderToStaticMarkup(React.createElement(ModelPicker,{directory:{store:store(namedState)},form:namedForm,t}));
 const settings=renderToStaticMarkup(React.createElement(SettingsEditor,{form:namedForm,t}));
 assert.match(picker,/▾ Models/);assert.match(picker,/▾ Close/);assert.match(picker,/✓ Close/);assert.match(picker,/>Refresh</);
 assert.match(settings,/<legend>Models<\/legend>/);assert.match(settings,/<legend>Close<\/legend>/);
});
test('styles require touch targets, wrapping, and non-overlay narrow child panels',()=>{
 assert.match(styles,/min-height:44px/);assert.match(styles,/overflow-wrap:anywhere/);
 assert.match(styles,/@container \(max-width:600px\)/);
 assert.match(styles,/grid-template-columns:minmax\(0,1fr\);/);
 assert.doesNotMatch(styles,/position:\s*(fixed|absolute)/);
});
