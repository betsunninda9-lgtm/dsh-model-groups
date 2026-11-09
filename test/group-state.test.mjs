import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroupPreferences, isGroupExpanded, parsePreferences, visibleModelGroups, STORAGE_KEY } from '../src/group-state.js';

const groups = [
  { id: 'provider-a', name: '示例供应商 A', models: [{ id: 'same-id' }, { id: 'deepseek-v3' }] },
  { id: 'provider-b', name: '示例供应商 B', models: [{ id: 'same-id' }] },
];

test('first use opens only current provider; a saved collapse takes precedence', () => {
  assert.equal(isGroupExpanded({}, 'provider-a', 'provider-a'), true);
  assert.equal(isGroupExpanded({}, 'provider-b', 'provider-a'), false);
  assert.equal(isGroupExpanded({ 'provider-a': false }, 'provider-a', 'provider-a'), false);
});

test('collapsed groups remain listed and search temporarily reveals them without overwriting preferences', () => {
  const preferences = { 'provider-a': false, 'provider-b': false };
  assert.deepEqual(visibleModelGroups(groups, preferences, 'provider-a', false).map(group => group.expanded), [false, false]);
  const searching = visibleModelGroups(groups, preferences, 'provider-a', true);
  assert.deepEqual(searching.map(group => group.expanded), [true, true]);
  assert.equal(searching[0].models, groups[0].models);
  assert.deepEqual(visibleModelGroups(groups, preferences, 'provider-a', false).map(group => group.expanded), [false, false]);
  assert.deepEqual(preferences, { 'provider-a': false, 'provider-b': false });
});

test('preferences survive reopening and are keyed by provider, not duplicate model IDs', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = createGroupPreferences(() => storage);
  first.setExpanded(['provider-a'], true);
  first.setExpanded(['provider-b'], false);
  const reopened = createGroupPreferences(() => storage);
  assert.deepEqual(reopened.getSnapshot(), { 'provider-a': true, 'provider-b': false });
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)), { version: 1, expanded: { 'provider-a': true, 'provider-b': false } });
});

test('expand all and collapse all preserve unrelated providers', () => {
  const store = createGroupPreferences(() => undefined);
  store.setExpanded(['other'], true);
  store.setExpanded(groups.map(group => group.id), true);
  assert.deepEqual(visibleModelGroups(groups, store.getSnapshot(), null, false).map(group => group.expanded), [true, true]);
  store.setExpanded(groups.map(group => group.id), false);
  assert.deepEqual(store.getSnapshot(), { other: true, 'provider-a': false, 'provider-b': false });
});

test('malformed and old preferences fail open to defaults without crashing', () => {
  for (const text of [null, '', 'oops', '{}', 'null', '{"version":2,"expanded":{}}', '{"version":1,"expanded":[]}']) assert.deepEqual(parsePreferences(text), {});
  assert.deepEqual(parsePreferences('{"version":1,"expanded":{"x":true,"bad":"false","no":null}}'), { x: true });
  assert.equal(isGroupExpanded(parsePreferences('{"version":1,"expanded":{"__proto__":false}}'), '__proto__', null), false);
});

test('blocked storage still allows in-memory folding and notifies subscribers', () => {
  const store = createGroupPreferences(() => { throw new Error('SecurityError'); });
  let notices = 0;
  const unsubscribe = store.subscribe(() => notices++);
  store.setExpanded(['provider-a'], false);
  assert.equal(store.getSnapshot()['provider-a'], false);
  assert.equal(notices, 1);
  unsubscribe();
  store.setExpanded(['provider-a'], true);
  assert.equal(notices, 1);
});

test('cross-tab updates and clear reset live preferences', () => {
  const store = createGroupPreferences(() => undefined);
  store.sync('{"version":1,"expanded":{"provider-a":false}}');
  assert.equal(store.getSnapshot()['provider-a'], false);
  store.sync(null);
  assert.deepEqual(store.getSnapshot(), {});
});
