import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { apply as applyHost, Config, inject as hostInject } from './host/index.js';
import { TYPERT } from './remote.js';
export { Config };
export const name = 'model-groups';
export const inject = [...new Set([...hostInject, 'typert'])];
export function apply(ctx, config) {
  const controller = applyHost(ctx, config);
  controller.typertRemote = bindTypertRemote(controller, 'modelGroups');
  // Explicit registration also supports compositions without automatic typert-loader.
  ctx.effect(() => ctx.typert.register(TYPERT));
}
