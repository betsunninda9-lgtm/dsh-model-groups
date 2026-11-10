import { loadCleanNativeHost } from './native-clean-host.js';
import { createNativeOperations } from './native-operations.js';
import { nativeOperationsHandler } from './native-api.js';

/** Creation is optional and lazy: displaying existing native routes never needs
 * hash-matched host internals. Unsupported/patched hosts cannot create via here.
 */
export function registerNativeCreation(ctx, validateMetadata) {
  ctx.inject(['webServer', 'connection', 'settings', 'configEditor'], child => {
    let pending;
    const operations = async () => {
      if (!pending) pending = loadCleanNativeHost().then(host => createNativeOperations({
        settings: child.settings, configEditor: child.configEditor,
        metadataNamespace: ctx.fiber.entry.options.id, validateMetadata, ...host,
      })).catch(error => { pending = null; throw error; });
      return pending;
    };
    const lazy = {
      preview: async group => (await operations()).preview(group),
      save: async (group, revision, fingerprint) => (await operations()).save(group, revision, fingerprint),
    };
    child.effect(() => child.webServer.register({ kind: 'exact', path: '/dsh-model-groups/native-create', handler: nativeOperationsHandler(lazy, child.connection) }));
  });
}
