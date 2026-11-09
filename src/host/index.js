import { Config, namespace, unwrapConfig } from './config.js';
import { mountRoutes } from './routes.js';
import { createController } from './controller.js';
export { Config, namespace } from './config.js';
export { createController } from './controller.js';
export { mountRoutes } from './routes.js';
export const name = namespace;
export const inject = ['llm', 'credentials', 'settings', 'configEditor'];

export function apply(ctx, config) {
  const settingsNs = ctx.fiber.entry?.options.id ?? namespace;
  if (settingsNs !== namespace) throw new Error('Model groups requires the model-groups settings namespace');
  const routing = mountRoutes(ctx, unwrapConfig(config), settingsNs);
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
  ctx.on('internal/config', (fiber, next) => {
    const raw = next();
    if (fiber === ctx.fiber) routing.prepare(unwrapConfig(raw));
    return raw;
  });
  ctx.on('loader/volatile-update', () => routing.update(unwrapConfig(config)));
  const controller = createController(ctx, routing, settingsNs);
  ctx.provide('modelGroups', controller);
  return controller;
}
