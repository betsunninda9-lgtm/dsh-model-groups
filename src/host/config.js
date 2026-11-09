import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';

export const namespace = 'model-groups';
export const protocols = ['openai-completions', 'anthropic-messages', 'openai-responses'];
export const newRoute = () => `mg-${randomUUID()}`;
export const newGroupId = () => `group-${randomUUID()}`;
const entry = z.object({ name: z.string().required(), models: z.array(z.string()).required() });
const group = z.object({ name: z.string().required(), baseURL: z.string().required(), api: z.union(protocols).required(), entries: z.dict(entry).default({}) });
export const Config = z.object({ groups: z.dict(group).default({}).volatile(), tombstones: z.dict(z.const(true)).default({}).volatile() });
const dictionary = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
function fields(value, allowed) {
  if (!dictionary(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid configuration fields');
}
export function validateConfig(input, previous) {
  fields(input, ['groups', 'tombstones']);
  const config = { groups: input.groups ?? {}, tombstones: input.tombstones ?? {} };
  if (!dictionary(config.groups) || !dictionary(config.tombstones)) throw new Error('Expected dictionaries');
  const routes = new Set();
  for (const [route, deleted] of Object.entries(config.tombstones)) if (!/^mg-[a-f0-9-]{36}$/.test(route) || deleted !== true) throw new Error('Invalid tombstone');
  for (const [id, group] of Object.entries(config.groups)) {
    if (!/^group-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid group identity');
    fields(group, ['name', 'baseURL', 'api', 'entries']);
    if (!text(group.name) || !protocols.includes(group.api) || !text(group.baseURL)) throw new Error('Invalid supplier');
    let url; try { url = new URL(group.baseURL); } catch { throw new Error('Invalid endpoint'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid endpoint');
    if (!dictionary(group.entries)) throw new Error('Expected entries dictionary');
    for (const [route, entry] of Object.entries(group.entries)) {
      if (!/^mg-[a-f0-9-]{36}$/.test(route) || routes.has(route) || config.tombstones[route]) throw new Error('Duplicate, invalid, or retired route');
      routes.add(route); fields(entry, ['name', 'models']);
      if (!text(entry.name) || !Array.isArray(entry.models) || entry.models.length === 0 || entry.models.length > 1000 || !entry.models.every(text) || new Set(entry.models).size !== entry.models.length) throw new Error('Invalid model catalog');
    }
  }
  if (previous) {
    for (const [oldGroupId, oldGroup] of Object.entries(previous.groups)) for (const route of Object.keys(oldGroup.entries)) {
      if (routes.has(route) && !Object.hasOwn(config.groups[oldGroupId]?.entries ?? {}, route)) throw new Error('A route cannot move between suppliers');
    }
    for (const route of Object.keys(previous.tombstones)) if (!config.tombstones[route]) throw new Error('Tombstones cannot be removed');
    for (const group of Object.values(previous.groups)) for (const route of Object.keys(group.entries)) if (!routes.has(route) && !config.tombstones[route]) throw new Error('Deleted routes require a persistent tombstone');
  }
  return structuredClone(config);
}
export const unwrapConfig = config => ({ groups: config.groups?.get ? config.groups.get() : config.groups ?? {}, tombstones: config.tombstones?.get ? config.tombstones.get() : config.tombstones ?? {} });
