import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Registry from '@deepseek-ai/dsh-typert-registry';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { REMOTE, TYPERT } from '../src/remote.js';

test('official Gateway validates and invokes plugin-only write-only credential endpoint',async t=>{
 const ctx=new Context();ctx.provide('remoteAccess',{decide:()=>({kind:'deny',reason:'synthetic-test'})});
 const registry=ctx.plugin(Registry);await registry.await();t.after(()=>registry.dispose());
 const gateway=ctx.plugin(TypertGatewayService,{});await gateway.await();t.after(()=>gateway.dispose());
 const unregister=ctx.typert.register(TYPERT);t.after(unregister);
 let stored;
 const controller={async setCredential(route,key){stored={route,key};return {configured:true};}};
 controller.typertRemote=bindTypertRemote(controller,'modelGroups');ctx.provide('modelGroups',controller);
 const peer={id:'synthetic-peer',ctx,principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none',dispose:async()=>{}};
 const route='mg-11111111-1111-4111-8111-111111111111';
 const result=await ctx.typertGateway.invoke({namespace:'modelGroups',method:'setCredential',args:{route,key:'synthetic-secret'},peer});
 assert.deepEqual(result,{configured:true});assert.deepEqual(stored,{route,key:'synthetic-secret'});
 await assert.rejects(ctx.typertGateway.invoke({namespace:'modelGroups',method:'setCredential',args:{route,key:'synthetic-secret',unexpected:true},peer}));
 await assert.rejects(ctx.typertGateway.invoke({namespace:'modelGroups',method:'setCredential',args:{route:'foreign',key:'synthetic-secret'},peer}));
 assert.equal(REMOTE.descriptors.length,9);
 assert.equal(REMOTE.descriptors.some(x=>/getCredential|readRecord/.test(x.method)),false);
 unregister();await assert.rejects(ctx.typertGateway.invoke({namespace:'modelGroups',method:'setCredential',args:{route,key:'synthetic-secret'},peer}));
});
