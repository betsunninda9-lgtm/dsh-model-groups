import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNativeGroups, buildNativeHierarchy } from '../src/native-groups.js';
import { filterModelHierarchy, hierarchyExpansionKeys, visibleHierarchyModels } from '../src/hierarchy.js';

// Entirely synthetic fixtures: no runtime, storage, profile, or configuration IO.
const native = (id, name = id, models = [{ id: 'vendor/shared', name: 'Shared' }]) => ({ id, provider: { name }, models });
const metadata = () => ({ groups: { vendor: { name: 'Vendor', entries: {
  primary: { name: 'Same label', provider: 'vendor-main' },
  backup: { name: 'Same label', provider: 'vendor-backup' },
} } } });
const directory = () => [native('normal', 'Ordinary'), native('vendor-main', 'Main'), native('other'), native('vendor-backup', 'Backup')];
const nativeRows = roots => roots.flatMap(root => root.kind === 'group' ? root.children : [root]);
const routes = roots => nativeRows(roots).flatMap(row => row.models.map(model => model.route));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

test('groups actual provider children without changing ordinary providers or route identity', () => {
  const groups = directory();
  const result = buildNativeGroups(groups, metadata(), { provider: 'vendor-backup', model: 'vendor/shared' });
  assert.deepEqual(result.map(root => [root.kind, root.id, root.name]), [
    ['provider', 'normal', 'Ordinary'], ['group', 'vendor', 'Vendor'], ['provider', 'other', 'other'],
  ]);
  const parent = result[1];
  assert.equal(parent.current, true);
  assert.equal(parent.modelCount, 2);
  assert.deepEqual(parent.children.map(child => [child.kind, child.id, child.provider, child.groupId, child.entryId, child.current]), [
    ['entry', 'vendor-main', 'vendor-main', 'vendor', 'primary', false],
    ['entry', 'vendor-backup', 'vendor-backup', 'vendor', 'backup', true],
  ]);
  assert.equal(parent.children[0].group, groups[1]);
  assert.equal(parent.children[1].group, groups[3]);
  for (const row of nativeRows(result)) {
    assert.ok(groups.includes(row.group));
    for (const model of row.models) {
      assert.equal(model.group, row.group);
      assert.equal(model.model, row.group.models[0]);
      assert.equal(model.provider, row.group.id);
      assert.deepEqual(model.route, { provider: row.group.id, model: 'vendor/shared' });
      assert.equal(model.id, model.model.id);
    }
  }
  assert.equal(parent.children[1].models[0].current, true);
  assert.equal(parent.children[0].models[0].current, false);
});

test('identical raw model IDs and display names remain separate under different children', () => {
  const result = buildNativeGroups(directory(), metadata());
  const [a, b] = result[1].children;
  assert.equal(a.name, b.name);
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.models[0].key, b.models[0].key);
  assert.notDeepEqual(a.models[0].route, b.models[0].route);
  assert.equal(a.models[0].id, 'vendor/shared');
  assert.equal(b.models[0].id, 'vendor/shared');
  assert.equal(a.models.length + b.models.length, 2);
  assert.ok(routes(result).every(route => !route.model.startsWith('@dsh-key/')));
});

test('metadata object order never overrides native root, child, or model order', () => {
  const groups = [native('vendor-backup', 'B', [{ id: 'z' }, { id: 'a' }]), native('other'), native('vendor-main')];
  const meta = metadata();
  const reversed = { groups: { vendor: { ...meta.groups.vendor, entries: Object.fromEntries(Object.entries(meta.groups.vendor.entries).reverse()) } } };
  const result = buildNativeGroups(groups, meta);
  assert.deepEqual(result, buildNativeGroups(groups, reversed));
  assert.deepEqual(result.map(root => root.id), ['vendor', 'other']);
  assert.deepEqual(result[0].children.map(row => row.provider), ['vendor-backup', 'vendor-main']);
  assert.deepEqual(result[0].children[0].models.map(model => model.id), ['z', 'a']);
  assert.deepEqual(result, buildNativeGroups(groups, meta));
});

test('absent metadata leaves every actual provider and raw model visible', () => {
  const groups = directory();
  for (const meta of [undefined, null, {}, { groups: {} }, { groups: [] }]) {
    const result = buildNativeGroups(groups, meta);
    assert.deepEqual(result.map(row => row.group), groups);
    assert.ok(result.every(row => row.kind === 'provider'));
    assert.equal(routes(result).length, 4);
  }
  assert.deepEqual(buildNativeGroups(undefined, metadata()), []);
});

test('missing child provider cannot invent availability, models, or selection', () => {
  const meta = metadata();
  const result = buildNativeGroups([native('vendor-main')], meta, { provider: 'vendor-backup', model: 'vendor/shared' });
  assert.deepEqual(result[0].children.map(row => row.provider), ['vendor-main']);
  assert.equal(result[0].current, false);
  assert.equal(result[0].modelCount, 1);
  assert.deepEqual(buildNativeGroups([native('normal')], meta).map(root => root.kind), ['provider']);
  assert.deepEqual(buildNativeGroups([], meta), []);
});

test('native child with no models stays present but contributes no available routes', () => {
  const groups = [native('vendor-main', 'Empty', [])];
  const result = buildNativeGroups(groups, metadata());
  assert.equal(result[0].children[0].group, groups[0]);
  assert.equal(result[0].modelCount, 0);
  assert.deepEqual(routes(result), []);
});

test('duplicate assignment within one container fails closed for all its native children', () => {
  const meta = metadata();
  meta.groups.vendor.entries.again = { provider: 'vendor-main' };
  const result = buildNativeGroups(directory(), meta);
  assert.ok(result.every(row => row.kind === 'provider'));
  assert.deepEqual(result.map(row => row.provider), directory().map(row => row.id));
  assert.equal(routes(result).length, 4);
});

test('cross-container duplicate assignment invalidates both entire containers, not unaffected groups', () => {
  const meta = metadata();
  meta.groups.conflict = { entries: { conflict: { provider: 'vendor-main' }, other: { provider: 'other' } } };
  meta.groups.unaffected = { entries: { normal: { provider: 'normal' } } };
  const result = buildNativeGroups(directory(), meta);
  assert.deepEqual(result.map(root => [root.kind, root.id]), [
    ['group', 'unaffected'], ['provider', 'vendor-main'], ['provider', 'other'], ['provider', 'vendor-backup'],
  ]);
  assert.equal(routes(result).length, 4);
});

test('duplicate native provider IDs are preserved ungrouped without ambiguous assignment', () => {
  const groups = [native('vendor-main', 'First'), native('vendor-main', 'Second'), native('vendor-backup')];
  const result = buildNativeGroups(groups, metadata());
  assert.ok(result.every(row => row.kind === 'provider'));
  assert.deepEqual(result.map(row => row.group), groups);
  assert.equal(new Set(result.map(row => row.key)).size, 3);
  assert.equal(new Set(result.flatMap(row => row.models.map(model => model.key))).size, 3);
});

test('reserved, malformed, encoded, Unicode, or overlong metadata IDs never regroup native routes', () => {
  for (const id of ['__proto__', 'prototype', 'constructor', 'bad/id', 'bad.id', 'bad id', '%61', '中文', 'a'.repeat(81), '', '-start']) {
    const groupDefinitions = Object.fromEntries([[id, { entries: { good: { provider: 'vendor-main' } } }]]);
    assert.equal(buildNativeGroups([native('vendor-main')], { groups: groupDefinitions })[0].kind, 'provider', id);
    const entries = Object.fromEntries([[id, { provider: 'vendor-main' }]]);
    assert.equal(buildNativeGroups([native('vendor-main')], { groups: { valid: { entries } } })[0].kind, 'provider', id);
  }
  assert.equal({}.polluted, undefined);
});

test('unsafe provider references invalidate their container without hiding any native rows', () => {
  for (const provider of ['__proto__', 'prototype', 'constructor', '@dsh-key/child/raw', '../child', 'a/b', 'a b', '', 'a'.repeat(129), 1, null]) {
    const meta = metadata();
    meta.groups.vendor.entries.unsafe = { provider };
    const groups = directory();
    const result = buildNativeGroups(groups, meta);
    assert.deepEqual(result.map(row => row.group), groups);
    assert.ok(result.every(row => row.kind === 'provider'));
  }
});

test('native dotted provider IDs are accepted while raw model IDs remain unrestricted and unchanged', () => {
  const groups = [native('vendor.child-1', 'Native', [{ id: 'org/model:v1 / 中文', name: 'Model' }])];
  const meta = { groups: { vendor: { entries: { child: { provider: 'vendor.child-1' } } } } };
  assert.deepEqual(routes(buildNativeGroups(groups, meta)), [{ provider: 'vendor.child-1', model: 'org/model:v1 / 中文' }]);
});

test('inherited metadata properties are ignored and null-prototype dictionaries are supported', () => {
  for (const meta of [Object.create({ groups: metadata().groups }), { groups: Object.create(metadata().groups) }]) {
    assert.ok(buildNativeGroups(directory(), meta).every(row => row.kind === 'provider'));
  }
  const meta = JSON.parse('{"groups":{"vendor":{"entries":{"__proto__":{"provider":"vendor-main"},"ok":{"provider":"vendor-backup"}}}}}');
  assert.ok(buildNativeGroups(directory(), meta).every(row => row.kind === 'provider'));
  const nullRecord = fields => Object.assign(Object.create(null), fields);
  const supported = nullRecord({ groups: nullRecord({ vendor: nullRecord({ entries: nullRecord({ main: nullRecord({ provider: 'vendor-main' }) }) }) }) });
  assert.equal(buildNativeGroups([native('vendor-main')], supported)[0].kind, 'group');
});

test('invalid container, entries and entry records leave native groups untouched', () => {
  for (const groups of [{ vendor: null }, { vendor: [] }, { vendor: { entries: null } }, { vendor: { entries: [] } }, { vendor: { entries: { bad: null } } }]) {
    assert.ok(buildNativeGroups(directory(), { groups }).every(row => row.kind === 'provider'));
  }
});

test('renaming labels never changes UI keys, native references, routes, or current state', () => {
  const groups = directory();
  const before = buildNativeGroups(groups, metadata(), { provider: 'vendor-main', model: 'vendor/shared' });
  const meta = metadata();
  meta.groups.vendor.name = 'Renamed provider group';
  meta.groups.vendor.entries.primary.name = 'Renamed credential';
  const after = buildNativeGroups(groups, meta, { provider: 'vendor-main', model: 'vendor/shared' });
  assert.deepEqual(routes(before), routes(after));
  assert.equal(before[1].key, after[1].key);
  assert.equal(before[1].children[0].key, after[1].children[0].key);
  assert.equal(after[1].children[0].group, groups[1]);
  assert.equal(after[1].children[0].models[0].current, true);
  assert.equal(after[1].name, 'Renamed provider group');
});

test('current matching uses both actual provider and raw model, never labels or metadata group ID', () => {
  for (const current of [{ provider: 'vendor', model: 'vendor/shared' }, { provider: 'Same label', model: 'vendor/shared' }]) {
    const result = buildNativeGroups(directory(), metadata(), current);
    assert.ok(result.every(root => !root.current));
    assert.ok(nativeRows(result).flatMap(row => row.models).every(model => !model.current));
  }
  const missing = buildNativeGroups(directory(), metadata(), { provider: 'vendor-main', model: 'missing' });
  assert.equal(missing[1].current, true);
  assert.equal(missing[1].children[0].current, true);
  assert.ok(missing[1].children.flatMap(row => row.models).every(model => !model.current));
});

test('empty labels fall back to IDs, and native provider display name is retained for ordinary rows', () => {
  const meta = { groups: { vendor: { name: '  ', entries: { main: { name: '', provider: 'vendor-main' } } } } };
  const result = buildNativeGroups([native('normal', 'Ordinary'), native('vendor-main')], meta);
  assert.equal(result[0].name, 'Ordinary');
  assert.equal(result[1].name, 'vendor');
  assert.equal(result[1].children[0].name, 'main');
});

test('hierarchy compatibility emits only native provider and raw model routes with independent folds', () => {
  const groups = freeze(directory());
  const current = { provider: 'vendor-backup', model: 'vendor/shared' };
  const tree = buildNativeHierarchy(groups, freeze(metadata()), {}, current);
  assert.deepEqual(tree.map(root => root.kind), ['provider', 'multi', 'provider']);
  assert.equal(tree[0].group, groups[0]);
  assert.equal(tree[1].children[1].group, groups[3]);
  assert.equal(tree[1].children[1].models, groups[3].models);
  assert.deepEqual(visibleHierarchyModels(tree), [{ provider: 'vendor-backup', model: 'vendor/shared' }]);
  const keys = hierarchyExpansionKeys(tree);
  assert.equal(new Set(keys).size, 5);
  const preferences = Object.fromEntries(keys.map(key => [key, true]));
  assert.equal(visibleHierarchyModels(buildNativeHierarchy(groups, metadata(), preferences, current)).length, 4);
  preferences[tree[1].key] = false;
  assert.deepEqual(visibleHierarchyModels(buildNativeHierarchy(groups, metadata(), preferences, current)), [
    { provider: 'normal', model: 'vendor/shared' }, { provider: 'other', model: 'vendor/shared' },
  ]);
  preferences[tree[1].key] = true;
  preferences[tree[1].children[1].key] = false;
  assert.ok(!visibleHierarchyModels(buildNativeHierarchy(groups, metadata(), preferences, current)).some(route => route.provider === 'vendor-backup'));
});

test('existing hierarchy search preserves actual native child routing and original model references', () => {
  const groups = directory();
  groups[1].models.push({ id: 'raw-alpha', name: 'Alpha' });
  const tree = buildNativeHierarchy(groups, metadata());
  const rank = (items, query) => items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
  assert.deepEqual(visibleHierarchyModels(tree), []);
  const result = filterModelHierarchy(tree, 'Alpha', rank);
  assert.deepEqual(visibleHierarchyModels(result), [{ provider: 'vendor-main', model: 'raw-alpha' }]);
  assert.equal(result[0].children[0].models[0], groups[1].models[1]);
  assert.equal(result[0].children[0].id, 'vendor-main');
  assert.deepEqual(visibleHierarchyModels(filterModelHierarchy(tree, 'Same label', rank)), [
    { provider: 'vendor-main', model: 'vendor/shared' }, { provider: 'vendor-main', model: 'raw-alpha' },
    { provider: 'vendor-backup', model: 'vendor/shared' },
  ]);
  assert.deepEqual(visibleHierarchyModels(filterModelHierarchy(tree, 'Ordinary', rank)), [{ provider: 'normal', model: 'vendor/shared' }]);
  assert.deepEqual(visibleHierarchyModels(tree), []);
});

test('malformed-ID claims still cause duplicate assignment to fail closed for otherwise valid containers', () => {
  const meta = metadata();
  meta.groups['bad/id'] = { entries: { bad: { provider: 'vendor-main' } } };
  assert.ok(buildNativeGroups(directory(), meta).every(row => row.kind === 'provider'));
  const badEntry = metadata();
  badEntry.groups.other = { entries: { 'bad/id': { provider: 'vendor-main' } } };
  assert.ok(buildNativeGroups(directory(), badEntry).every(row => row.kind === 'provider'));
});

test('provider UI identity stays stable when unrelated native providers are inserted', () => {
  const groups = directory();
  const before = nativeRows(buildNativeGroups(groups, {}));
  const after = nativeRows(buildNativeGroups([native('inserted'), ...groups], {})).slice(1);
  assert.deepEqual(before.map(row => row.key), after.map(row => row.key));
  assert.deepEqual(before.map(row => row.models[0].key), after.map(row => row.models[0].key));
});

test('projection is pure with deeply frozen native directory, metadata and current route', () => {
  const groups = freeze(directory());
  const meta = freeze(metadata());
  const current = freeze({ provider: 'vendor-main', model: 'vendor/shared' });
  const snapshot = JSON.stringify({ groups, meta, current });
  const result = buildNativeGroups(groups, meta, current);
  assert.equal(JSON.stringify({ groups, meta, current }), snapshot);
  assert.equal(result[1].children[0].group, groups[1]);
  assert.equal(result[1].children[0].models[0].model, groups[1].models[0]);
});
