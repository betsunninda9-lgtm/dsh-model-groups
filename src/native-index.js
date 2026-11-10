import z from '@deepseek-ai/schemastery';
import { registerNativeCreation } from './native-create-runtime.js';

// Metadata only: these IDs label containers, never synthesize provider routes.
const SAFE_ID = /^(?!(?:__proto__|prototype|constructor)$)[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SAFE_PROVIDER = /^(?!(?:__proto__|prototype|constructor)$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const name = () => z.string().max(120);
const id = () => z.string().pattern(SAFE_ID).required();
const entry = z.object({ name: name(), provider: z.string().pattern(SAFE_PROVIDER).required() }).required();
const group = z.object({ name: name(), entries: z.dict(entry, id()) }).required();

// Installed Schemastery has no per-node refinement API. Keep the portable form
// schema built-in only; cross-group uniqueness is checked by the pure validator
// below, not by a transform with closures or a global custom resolver.
export const Config = z.object({ groups: z.dict(group, id()).volatile() });

const record = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const fields = (value, allowed, path) => {
  if (!record(value)) fail(path, 'expected metadata object');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptor, 'value')) {
      fail(path, 'unknown or non-data metadata field');
    }
  }
};
const optionalName = (value, path) => {
  if (Object.hasOwn(value, 'name') && (typeof value.name !== 'string' || value.name.length > 120)) {
    fail(path, 'name must be a string of at most 120 characters');
  }
};
const dictionary = (value, path) => {
  if (!record(value)) fail(path, 'expected dictionary');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !SAFE_ID.test(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      fail(path, 'unsafe metadata ID or non-data entry');
    }
  }
};

/** Validate detached, unwrapped metadata before saving it. Returns true without
 * mutation; throws TypeError on invalid metadata. Provider existence remains the
 * native directory's responsibility. Config alone cannot check claim uniqueness.
 */
export function validateNativeMetadata(metadata) {
  fields(metadata, ['groups'], 'metadata');
  if (!Object.hasOwn(metadata, 'groups')) return true;
  dictionary(metadata.groups, 'groups');
  const claims = new Set();
  for (const [groupId, definition] of Object.entries(metadata.groups)) {
    const path = `groups.${groupId}`;
    fields(definition, ['name', 'entries'], path);
    optionalName(definition, path);
    if (!Object.hasOwn(definition, 'entries')) continue;
    dictionary(definition.entries, `${path}.entries`);
    for (const [entryId, value] of Object.entries(definition.entries)) {
      const entryPath = `${path}.entries.${entryId}`;
      fields(value, ['name', 'provider'], entryPath);
      optionalName(value, entryPath);
      if (!Object.hasOwn(value, 'provider') || typeof value.provider !== 'string' || !SAFE_PROVIDER.test(value.provider)) {
        fail(entryPath, 'unsafe or missing provider ID');
      }
      if (claims.has(value.provider)) fail(entryPath, 'duplicate provider claim');
      claims.add(value.provider);
    }
  }
  return true;
}

// The composition must give this plugin entry id `model-groups`: settings uses
// entry.options.id as namespace, not an exported name or the package name.
export function apply(ctx) {
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  registerNativeCreation(ctx, validateNativeMetadata);
}
