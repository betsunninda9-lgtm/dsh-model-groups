import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm';
import { namespace, newRoute, newGroupId, validateConfig } from './config.js';

/** The remote surface returns metadata only. No method returns a credential record. */
export function createController(ctx, routing, settingsNs = namespace) {
  let tail = Promise.resolve();
  const serial = action => { const result = tail.then(action); tail = result.catch(() => {}); return result; };
  function descriptor() {
    const value = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === settingsNs);
    if (!value) throw new Error('Model groups settings are unavailable');
    return value;
  }
  const find = (config, route) => Object.values(config.groups).some(group => Object.hasOwn(group.entries, route));
  function requireRoute(route) { if (!routing.routes.has(route) || !find(routing.snapshot(), route)) throw new Error('Configuration is unavailable'); }
  async function snapshot() {
    const desc = descriptor();
    const config = routing.snapshot();
    const credentials = {};
    for (const group of Object.values(config.groups)) for (const route of Object.keys(group.entries)) {
      const info = await ctx.credentials.describeRecord(credentialKey(namespace, route));
      credentials[route] = { configured: info.configured && info.kind === 'api-key', writable: info.writable };
    }
    return { namespace: settingsNs, revision: desc.revision, writable: ctx.settings.writable, ...config, credentials };
  }
  function change(revision, mutate) {
    return serial(async () => {
      const desc = descriptor();
      if (!Number.isSafeInteger(revision) || revision !== desc.revision) throw new Error('SETTINGS_CONFLICT: refresh before saving');
      const previous = routing.snapshot();
      const next = structuredClone(previous);
      const result = mutate(next);
      validateConfig(next, previous);
      routing.prepare(next);
      // Settings owns configEditor persistence and Loader reconciliation. Never write profile files.
      await ctx.settings.mutate(settingsNs, [
        { op: 'set', path: ['groups'], value: next.groups },
        { op: 'set', path: ['tombstones'], value: next.tombstones },
      ], revision);
      // Normally the synchronous volatile listener already did this; also supports non-Loader callers.
      if (JSON.stringify(routing.snapshot()) !== JSON.stringify(next)) routing.update(next);
      return { ...await snapshot(), ...result };
    });
  }
  const groupOf = (config, id) => { if (!Object.hasOwn(config.groups, id)) throw new Error('Supplier is unavailable'); return config.groups[id]; };
  const entryOf = (config, id, route) => { const group = groupOf(config, id); if (!Object.hasOwn(group.entries, route)) throw new Error('Configuration is unavailable'); return group.entries[route]; };
  return {
    snapshot,
    createGroup: (input, revision) => change(revision, next => { const groupId = newGroupId(); next.groups[groupId] = { ...input, entries: {} }; return { groupId }; }),
    updateGroup: (groupId, patch, revision) => change(revision, next => { const group = groupOf(next, groupId); if (Object.keys(patch).some(key => !['name', 'baseURL', 'api'].includes(key))) throw new Error('Invalid supplier fields'); Object.assign(group, patch); }),
    deleteGroup: (groupId, revision) => change(revision, next => { for (const route of Object.keys(groupOf(next, groupId).entries)) next.tombstones[route] = true; delete next.groups[groupId]; }),
    createEntry: (groupId, input, revision) => change(revision, next => { const route = newRoute(); groupOf(next, groupId).entries[route] = input; return { route }; }),
    updateEntry: (groupId, route, patch, revision) => change(revision, next => { const entry = entryOf(next, groupId, route); if (Object.keys(patch).some(key => !['name', 'models'].includes(key))) throw new Error('Invalid configuration fields'); Object.assign(entry, patch); }),
    deleteEntry: (groupId, route, revision) => change(revision, next => { entryOf(next, groupId, route); delete next.groups[groupId].entries[route]; next.tombstones[route] = true; }),
    setCredential: (route, key) => serial(async () => {
      requireRoute(route);
      if (typeof key !== 'string' || key.length > 16384) throw new Error('Invalid credential');
      try { assertUsableApiKey(key, namespace, 'configuration'); } catch { throw new Error('Invalid credential'); }
      const address = credentialKey(namespace, route);
      let previous;
      try {
        await ctx.credentials.modifyRecord(address, async current => { requireRoute(route); previous = current; return { kind: 'api-key', key }; });
      } catch { throw new Error('Credential could not be saved'); }
      if (!routing.routes.has(route) || !find(routing.snapshot(), route)) {
        // Preserve a pre-existing record when replacing a key races route retirement.
        if (previous) await ctx.credentials.modifyRecord(address, async current => current?.kind === 'api-key' && current.key === key ? previous : undefined);
        else await ctx.credentials.deleteRecord(address);
        throw new Error('Configuration was deleted while saving');
      }
      ctx.emit('llm/models-updated', route);
      return { configured: true };
    }),
    deleteCredential: route => serial(async () => {
      requireRoute(route);
      await ctx.credentials.deleteRecord(credentialKey(namespace, route));
      // Revoke prepared calls and abort in-flight requests for this route on explicit secret removal.
      routing.invalidateCredential(route);
      ctx.emit('llm/models-updated', route);
      return { configured: false };
    }),
  };
}
