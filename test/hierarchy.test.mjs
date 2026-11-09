import assert from 'node:assert/strict';
import test from 'node:test';
import { KEY_MODEL_PREFIX, buildModelHierarchy, decodeKeyModelId, filterModelHierarchy, hierarchyExpansionKeys, keyEntryGroupKey, keyEntryName, visibleHierarchyModels } from '../src/hierarchy.js';

// Synthetic catalog/config only: these tests never read a profile or any secret.
const alias = (entry, wire) => `@dsh-key/${encodeURIComponent(entry)}/${encodeURIComponent(wire)}`;
const primary = alias('primary', 'vendor/shared');
const backup = alias('backup', 'vendor/shared');
const alpha = alias('primary', 'alpha');
const groups = [
  { id: 'provider', name: 'Shared Provider', models: [
    { id: primary, name: 'Shared Model' }, { id: alpha, name: 'Alpha' },
    { id: backup, name: 'Shared Model' },
    { id: 'vendor/shared', name: 'Old raw model' }, { id: 'raw-other', name: 'Other raw model' },
  ] },
  { id: 'ordinary', name: 'Ordinary Provider', models: [{ id: 'vendor/shared', name: 'Shared Model' }] },
];
const providers = {
  provider: { multiKey: true, keyEntries: {
    primary: { name: 'Primary Key', apiKeyEnv: 'SYNTHETIC_PRIMARY', models: {} },
    backup: { name: 'Backup Key', apiKeyEnv: 'SYNTHETIC_BACKUP', models: {} },
  } },
  ordinary: { multiKey: false },
};
const current = { provider: 'provider', model: primary };
const parentKey = 'provider';
const primaryKey = '@key/provider/primary';
const backupKey = '@key/provider/backup';
const legacyKey = '@key/provider/%40legacy';
const rank = (items, query) => items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
const route = model => ({ provider: 'provider', model });

test('every original provider keeps its own fold; only native multi-key providers gain children', () => {
  const tree = buildModelHierarchy(groups, providers, {}, current);
  assert.deepEqual(tree.map(root => [root.kind, root.key, root.name, root.expanded, root.modelCount]), [
    ['multi', 'provider', 'Shared Provider', true, 3], ['provider', 'ordinary', 'Ordinary Provider', false, 1],
  ]);
  assert.deepEqual(tree[0].children.map(child => [child.entryId, child.key, child.name, child.expanded]), [
    ['primary', primaryKey, 'Primary Key', true], ['backup', backupKey, 'Backup Key', false],
  ]);
  assert.equal(tree[1].children, undefined);
  assert.deepEqual(visibleHierarchyModels(tree), [route(primary), route(alpha)]);
  assert.deepEqual(hierarchyExpansionKeys(tree), ['provider', primaryKey, backupKey, 'ordinary']);
  assert.equal(tree[0].group.id, 'provider', 'children are not new provider identities');
});

test('parent and key folds stay independent, ordinary providers never become direct unhideable rows', () => {
  const saved = { [parentKey]: false, [primaryKey]: false, [backupKey]: true, ordinary: true };
  assert.deepEqual(visibleHierarchyModels(buildModelHierarchy(groups, providers, saved, current)), [{ provider: 'ordinary', model: 'vendor/shared' }]);
  const reopened = buildModelHierarchy(groups, providers, { ...saved, [parentKey]: true }, current);
  assert.deepEqual(visibleHierarchyModels(reopened), [route(backup), { provider: 'ordinary', model: 'vendor/shared' }]);
  assert.deepEqual(saved, { [parentKey]: false, [primaryKey]: false, [backupKey]: true, ordinary: true });
  const allClosed = Object.fromEntries(hierarchyExpansionKeys(reopened).map(key => [key, false]));
  assert.deepEqual(visibleHierarchyModels(buildModelHierarchy(groups, providers, allClosed, current)), []);
});

test('same provider and same wire model under equal key labels retain distinct aliases and current state', () => {
  const sameLabels = { ...providers, provider: { ...providers.provider, keyEntries: { primary: { name: 'Shared' }, backup: { name: 'Shared' } } } };
  const tree = buildModelHierarchy(groups, sameLabels, { [primaryKey]: true, [backupKey]: true }, { provider: 'provider', model: backup });
  assert.deepEqual(tree[0].children.map(child => [child.id, child.name, child.current]), [['provider', 'Shared', false], ['provider', 'Shared', true]]);
  assert.deepEqual(visibleHierarchyModels(tree), [route(primary), route(alpha), route(backup)]);
  assert.deepEqual(decodeKeyModelId(primary), { entryId: 'primary', modelId: 'vendor/shared' });
  assert.deepEqual(decodeKeyModelId(backup), { entryId: 'backup', modelId: 'vendor/shared' });
});

test('provider, key label, key ID, and model search temporarily expand matching paths without mutating saved folds', () => {
  const saved = { provider: false, [primaryKey]: false, [backupKey]: false, ordinary: false };
  const tree = buildModelHierarchy(groups, providers, saved, current);
  for (const [query, expected] of [
    ['Shared Provider', [route(primary), route(alpha), route(backup)]],
    ['Primary Key', [route(primary), route(alpha)]],
    ['backup', [route(backup)]],
    ['Alpha', [route(alpha)]],
    ['Ordinary Provider', [{ provider: 'ordinary', model: 'vendor/shared' }]],
  ]) {
    const result = filterModelHierarchy(tree, query, rank);
    assert.deepEqual(visibleHierarchyModels(result), expected, query);
    assert.ok(result.every(root => root.expanded && (root.kind !== 'multi' || root.children.every(child => child.expanded))), query);
  }
  assert.deepEqual(filterModelHierarchy(tree, 'not-found', rank), []);
  assert.deepEqual(visibleHierarchyModels(filterModelHierarchy(tree, '   ', rank)), []);
  assert.deepEqual(saved, { provider: false, [primaryKey]: false, [backupKey]: false, ordinary: false });
  assert.ok(tree.every(root => root.expanded === false));
});

test('legacy raw model appears only as the current single-key compatibility child', () => {
  const legacyCurrent = { provider: 'provider', model: 'vendor/shared' };
  const tree = buildModelHierarchy(groups, providers, {}, legacyCurrent);
  assert.deepEqual(tree[0].children.map(child => child.entryId), ['primary', 'backup', undefined]);
  const legacy = tree[0].children.at(-1);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.key, legacyKey);
  assert.equal(legacy.current, true);
  assert.deepEqual(visibleHierarchyModels(tree), [route('vendor/shared')]);
  assert.deepEqual(legacy.models.map(model => model.id), ['vendor/shared']);
  assert.deepEqual(hierarchyExpansionKeys(tree), ['provider', primaryKey, backupKey, legacyKey, 'ordinary']);
  assert.equal(buildModelHierarchy(groups, providers, {}, current)[0].children.some(child => child.legacy), false);
  assert.equal(buildModelHierarchy(groups, providers, {}, { provider: 'ordinary', model: 'vendor/shared' })[0].children.some(child => child.legacy), false);
});

test('turning multi-key OFF or deleting an entry cannot revive stale aliases from an old directory snapshot', () => {
  const staleOpen = { provider: true, [primaryKey]: true, [backupKey]: true };
  const off = buildModelHierarchy(groups, { ...providers, provider: { ...providers.provider, multiKey: false } }, staleOpen, current);
  assert.equal(off[0].kind, 'provider');
  assert.deepEqual(visibleHierarchyModels(off), [route('vendor/shared'), route('raw-other')]);
  assert.deepEqual(hierarchyExpansionKeys(off), ['provider', 'ordinary']);
  const removed = buildModelHierarchy(groups, { ...providers, provider: { ...providers.provider, keyEntries: { primary: providers.provider.keyEntries.primary } } }, staleOpen, { provider: 'provider', model: backup });
  assert.deepEqual(removed[0].children.map(child => child.entryId), ['primary']);
  assert.deepEqual(visibleHierarchyModels(removed), [route(primary), route(alpha)]);
  assert.equal(filterModelHierarchy(removed, 'Backup Key', rank).length, 0);
  const goneProvider = buildModelHierarchy(groups, { ordinary: providers.ordinary }, staleOpen, current);
  assert.equal(goneProvider[0].kind, 'provider');
  assert.deepEqual(visibleHierarchyModels(goneProvider), [route('vendor/shared'), route('raw-other')]);
});

test('loading configuration may identify catalog aliases but explicit empty settings never invent entries', () => {
  const loading = buildModelHierarchy(groups, undefined, {}, current);
  assert.equal(loading[0].kind, 'multi');
  assert.deepEqual(loading[0].children.map(child => [child.entryId, child.name]), [['primary', 'primary'], ['backup', 'backup']]);
  const ready = buildModelHierarchy(groups, {}, {}, current);
  assert.equal(ready[0].kind, 'provider');
  assert.deepEqual(ready[0].group.models.map(model => model.id), ['vendor/shared', 'raw-other']);
});

test('manual key entries are not capped or merged, preserve order, and leave input data untouched', () => {
  const entries = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`entry-${index}`, { name: `Key ${index}` }]));
  const catalog = [{ id: 'large-provider', name: 'Large Provider', models: Object.keys(entries).map(entry => ({ id: alias(entry, 'same-wire'), name: 'Same Model' })) }];
  const config = { 'large-provider': { multiKey: true, keyEntries: entries } };
  const before = JSON.stringify({ catalog, config });
  const tree = buildModelHierarchy(catalog, config, {}, { provider: 'large-provider', model: alias('entry-199', 'same-wire') });
  assert.equal(tree[0].children.length, 200);
  assert.deepEqual(tree[0].children.map(child => child.entryId), Object.keys(entries));
  assert.equal(tree[0].modelCount, 200);
  assert.equal(hierarchyExpansionKeys(tree).length, 201);
  assert.deepEqual(visibleHierarchyModels(tree), [{ provider: 'large-provider', model: alias('entry-199', 'same-wire') }]);
  assert.equal(JSON.stringify({ catalog, config }), before);
});

test('canonical alias decoding accepts encoded wire IDs but rejects alternate spellings, malformed and reserved entry IDs', () => {
  assert.equal(KEY_MODEL_PREFIX, '@dsh-key/');
  assert.deepEqual(decodeKeyModelId(alias('entry-1', 'vendor/model β?version=1')), { entryId: 'entry-1', modelId: 'vendor/model β?version=1' });
  for (const invalid of [
    undefined, null, '', 1, 'raw-model', '@dsh-key/', '@dsh-key/a', '@dsh-key/a/', '@dsh-key//model',
    '@dsh-key/a/model/extra', '@dsh-key/a/%ZZ', '@dsh-key/a/%E0%A4%A', '@dsh-key/%61/model',
    '@dsh-key/a/vendor%2fmodel', '@dsh-key/a/%6Dodel', '@dsh-key/__proto__/model', '@dsh-key/constructor/model',
    '@dsh-key/prototype/model', '@dsh-key/%40legacy/model', '@dsh-key/.dot/model', alias('a'.repeat(81), 'model'),
    alias('a', '@dsh-key/nested/model'),
  ]) assert.equal(decodeKeyModelId(invalid), undefined, String(invalid));
  assert.equal(keyEntryGroupKey('provider/one', 'entry-1'), '@key/provider%2Fone/entry-1');
  assert.notEqual(keyEntryGroupKey('a/b', 'c'), keyEntryGroupKey('a', 'b/c'));
});

test('malformed reserved aliases and unsafe config entries are not offered as raw or multi-key models', () => {
  const invalid = ['@dsh-key/a/%ZZ', '@dsh-key/a/vendor%2fmodel', '@dsh-key/constructor/model'];
  const catalog = [{ id: 'provider', name: 'Provider', models: [...invalid.map(id => ({ id, name: 'Invalid' })), { id: 'raw', name: 'Raw' }, { id: alias('safe', 'wire'), name: 'Safe' }] }];
  const unsafe = JSON.parse('{"__proto__":{"name":"Bad"},"constructor":{"name":"Bad"},"prototype":{"name":"Bad"},"safe":{"name":" Safe "},"empty":{"name":"No catalog"}}');
  const multi = buildModelHierarchy(catalog, { provider: { multiKey: true, keyEntries: unsafe } }, {}, { provider: 'provider', model: alias('safe', 'wire') });
  assert.deepEqual(multi[0].children.map(child => child.entryId), ['safe']);
  assert.equal(multi[0].children[0].name, 'Safe');
  assert.deepEqual(visibleHierarchyModels(multi), [route(alias('safe', 'wire'))]);
  const off = buildModelHierarchy(catalog, { provider: { multiKey: false } }, { provider: true }, { provider: 'provider', model: 'raw' });
  assert.deepEqual(visibleHierarchyModels(off), [route('raw')]);
  const invalidCurrent = buildModelHierarchy(catalog, { provider: { multiKey: true, keyEntries: unsafe } }, {}, { provider: 'provider', model: invalid[0] });
  assert.equal(invalidCurrent[0].children.some(child => child.legacy), false);
  const inherited = Object.create({ inherited: { name: 'Not own' } });
  inherited.own = { name: '  ' };
  assert.equal(keyEntryName({ provider: { keyEntries: inherited } }, 'provider', 'inherited'), 'inherited');
  assert.equal(keyEntryName({ provider: { keyEntries: inherited } }, 'provider', 'own'), 'own');
});
