import { createHash } from 'node:crypto';
import { bridgeExecutionProfile } from './runtime.js';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** Immutable, public selection identities bind directory admission to one config.
 * The digest contains credential references, never credential values. Old tokens
 * are not redirected to a new configuration when a prepared request is sent.
 */
const semanticModels = models => models.map(({ name: _name, sortOrder: _order, ...model }) => model)
  .sort((left, right) => left.id.localeCompare(right.id));

export function createBridgeRouting(provider, draft, original, models) {
  const routing = {};
  const add = (entryId, resolved) => {
    if (!resolved?.length) return;
    const profile = bridgeExecutionProfile(original, entryId === null ? undefined : draft.keyEntries[entryId]);
    delete profile.displayName;
    if (Array.isArray(profile.models)) profile.models = semanticModels(profile.models);
    const digest = createHash('sha256').update(JSON.stringify(canonical([provider, entryId, profile, semanticModels(resolved)]))).digest('hex');
    routing[`g_${digest}`] = entryId;
  };
  for (const entryId of Object.keys(draft.keyEntries)) add(entryId, models.keyEntries[entryId]);
  add(null, models.legacy);
  return routing;
}
