import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { mountRoutes } from '../src/host/routes.js';
import { namespace, newRoute, newGroupId } from '../src/host/config.js';
const model = 'synthetic-model', thinking = 'SYNTHETIC_PRIVATE_REASONING', visible = 'Synthetic visible answer';
const collect = async stream => { const result=[]; for await (const item of stream) result.push(item); return result; };
function assistant(provider, id = model) { return { role:'assistant',content:[{type:'reasoning',text:thinking},{type:'text',text:visible}],source:{kind:'model',provider,model:id,replayState:{response:{kind:'pi-ai',version:2,api:'openai-completions',provider,model:id,stopReason:'stop',responseId:'SYNTHETIC_RESPONSE_ID'},blocks:[{type:'reasoning',thinkingSignature:'reasoning_content'},{type:'text',textSignature:'SYNTHETIC_TEXT_SIGNATURE'}]}}}; }
test('production per-route adapters isolate replay and preserve ordinary text',async t=>{
  const seen=[]; const server=createServer(async(req,res)=>{
    let raw=''; for await(const chunk of req) raw+=chunk; seen.push({auth:req.headers.authorization,body:JSON.parse(raw)});
    const event=(delta,finish_reason)=>`data: ${JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model,choices:[{index:0,delta,finish_reason}]})}\n\n`;
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(event({role:'assistant',content:'Synthetic reply'},null)+event({},'stop')+'data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const ctx=new Context(),fiber=ctx.plugin(LlmRuntime);await fiber.await();t.after(()=>fiber.dispose());
  const a=newRoute(),b=newRoute();
  ctx.provide('credentials',{readRecord:async key=>({kind:'api-key',key:key===credentialKey(namespace,a)?'synthetic-a':'synthetic-b'})});
  const mounted=mountRoutes(ctx,{groups:{[newGroupId()]:{name:'Synthetic Supplier',baseURL:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',entries:{[a]:{name:'Synthetic A',models:[model]},[b]:{name:'Synthetic B',models:[model]}}}},tombstones:{}});t.after(mounted.dispose);
  async function dispatch(route,history){
    const messages=[{role:'user',content:[{type:'text',text:'Synthetic prompt'}]},history,{role:'user',content:[{type:'text',text:'Synthetic follow-up'}]}]; const original=structuredClone(messages);
    const chunks=await collect(ctx.llm.stream({provider:route,model,messages}));assert.equal(chunks.at(-1).reason.kind,'stop');assert.deepEqual(messages,original);
    const wire=seen.at(-1);assert.equal(wire.auth,route===a?'Bearer synthetic-a':'Bearer synthetic-b');assert.equal(wire.body.model,model);
    const row=wire.body.messages.find(item=>item.role==='assistant');assert.equal(row.content,visible);return {row,body:wire.body};
  }
  const same=await dispatch(a,assistant(a));assert.equal(same.row.reasoning_content,thinking);
  const absent=assistant(a);delete absent.source.replayState;
  const invalid=assistant(a);invalid.source.replayState.response.version=999;
  for(const [route,history] of [[b,assistant(a)],[a,assistant(b)],[a,assistant('synthetic-old-shared','@dsh-key/synthetic/synthetic-model')],[a,assistant(a,'@dsh-key/synthetic/synthetic-model')],[a,absent],[a,invalid]]){
    const {row,body}=await dispatch(route,history);assert.equal(row.reasoning_content,undefined);
    for(const marker of [thinking,'SYNTHETIC_TEXT_SIGNATURE','SYNTHETIC_RESPONSE_ID','replayState'])assert.equal(JSON.stringify(body).includes(marker),false);
  }
});
