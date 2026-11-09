import { apply as mountUI, inject as uiInject } from './ui/index.js';
import { REMOTE } from './remote.js';
export const inject = [...uiInject, 'remote'];
export async function apply(ctx) {
  const unmountRemote = await ctx.remote.$mount(REMOTE);
  ctx.on('dispose', unmountRemote);
  const call = async (method, ...args) => {
    const result = await ctx.remote.modelGroups[method](...args);
    if (result?.ok === false) throw new Error(result.error?.message || 'Model groups operation failed');
    return result?.ok === true ? result.value : result;
  };
  mountUI(ctx, {operations:{
    writeSecret:({entryId,secret})=>call('setCredential',entryId,secret),
    deleteSecret:({entryId})=>call('deleteCredential',entryId),
    credentialStatus:async({entryId})=>Boolean((await call('snapshot')).credentials[entryId]?.configured),
  }});
}
