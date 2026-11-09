import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';

// Public, explicitly registered schemas: no generated host files are patched.
const route = z.string().regex(/^mg-[a-f0-9-]{36}$/);
const revision = z.number().int().nonnegative();
const groupId = z.string().regex(/^group-[a-f0-9-]{36}$/);
const group = z.strictObject({ name:z.string().min(1).max(160), baseURL:z.string().url(), api:z.enum(['openai-completions','openai-responses','anthropic-messages']) });
const entry = z.strictObject({ name:z.string().min(1).max(160), models:z.array(z.string().min(1).max(512)).min(1).max(500) });
const snapshot = z.object({namespace:z.string(),revision,writable:z.boolean(),groups:z.record(z.string(),z.unknown()),tombstones:z.record(z.string(),z.boolean()),credentials:z.record(z.string(),z.object({configured:z.boolean(),writable:z.boolean()})),groupId:z.string().optional(),route:z.string().optional()});
const definitions = {
 snapshot: {args:[],result:snapshot},
 createGroup:{args:[['draft',group],['revision',revision]],result:snapshot},
 updateGroup:{args:[['groupId',groupId],['patch',group.partial()],['revision',revision]],result:snapshot},
 deleteGroup:{args:[['groupId',groupId],['revision',revision]],result:snapshot},
 createEntry:{args:[['groupId',groupId],['draft',entry],['revision',revision]],result:snapshot},
 updateEntry:{args:[['groupId',groupId],['route',route],['patch',entry.partial()],['revision',revision]],result:snapshot},
 deleteEntry:{args:[['groupId',groupId],['route',route],['revision',revision]],result:snapshot},
 setCredential:{args:[['route',route],['key',z.string().min(1).max(16384)]],result:z.object({configured:z.boolean()})},
 deleteCredential:{args:[['route',route]],result:z.object({configured:z.boolean()})},
};
const codec=(schema,id)=>({mode:'strict',typeSymbol:`dsh-model-groups#${id}`,create:()=>schema});
export const REMOTE = createTypertRemoteInfo({package:'dsh-model-groups',methods:Object.fromEntries(Object.entries(definitions).map(([method,{args,result}])=>[
 `modelGroups/${method}`,{service:'modelGroups',implementation:method,description:`Model groups ${method}`,invocation:{kind:'direct'},parameters:args.map(([name,schema])=>({name,source:'json',codec:codec(schema,method+':'+name),strictCodec:codec(schema,method+':'+name)})),result:codec(result,method+':result')}
]))},z);
export const TYPERT={package:'dsh-model-groups',face:'host',schemas:[],model:{services:[],events:[],objects:[]},get invocations(){return REMOTE.descriptors;}};
