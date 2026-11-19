import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientSource } from '../scripts/build.mjs';
import { createPickerHarness } from './helpers/picker-harness.mjs';

const alias = (entry, wire) => `@dsh-key/${encodeURIComponent(entry)}/${encodeURIComponent(wire)}`;
const key = alias('g_current', 'wire'), root = alias('g_root', 'old-root');
const groups = [
  { id: 'managed', name: 'Managed Provider', models: [
    { id: key, name: 'Current key model' }, { id: root, name: 'Current root model' },
    { id: alias('g_stale', 'wire'), name: 'Stale entry model' },
    { id: alias('g_current', 'removed'), name: 'Stale wire model' },
    { id: '@dsh-key/%67_current/wire', name: 'Noncanonical alias' },
    { id: 'old-root', name: 'Old raw current' }, { id: 'native-catalog-extra', name: 'Native extra' },
  ] },
  { id: 'ordinary', name: 'Ordinary Provider', models: [{ id: 'ordinary-wire', name: 'Ordinary model' }] },
];
const providers = {
  managed: { multiKey: true, bridgeRouting: true, keyEntries: {
    g_current: { name: 'Current key', models: [{ id: 'wire' }] },
    g_root: { name: 'Original root', models: [{ id: 'old-root' }] },
  } },
};
function mountFallback(t, changes = {}) {
  const ui = createPickerHarness({ bundleSource: createClientSource(), providers, throwMenu: true,
    snapshot: { status: 'ready', groups, current: { provider: 'managed', model: 'old-root' }, pending: null, retainedEffort: null, error: null, failures: [], ...changes } });
  t.after(() => ui.dispose());
  ui.click(ui.one('[aria-haspopup="menu"]'));
  assert.equal(ui.fallback, true);
  ui.click(ui.one('[aria-haspopup="menu"]'));
  return ui;
}

test('the actual fallback excludes catalog raw models and stale managed aliases while retaining the old trigger selection', async t => {
  const ui = mountFallback(t);
  assert.equal(ui.one('[aria-haspopup="menu"]').textContent, 'old-root');
  assert.deepEqual(ui.selections, [], 'an unavailable old selection is never automatically changed');
  let rows = ui.all('[role="menuitemradio"]');
  assert.deepEqual(rows.map(row => row.textContent), [
    'Current key modelManaged Provider / Current key',
    'Current root modelManaged Provider / Original root',
    'Ordinary modelOrdinary Provider',
  ]);
  assert.equal(rows.some(row => row.getAttribute('aria-checked') === 'true'), false);
  ui.updateProviders({ ...providers, managed: { ...providers.managed, keyEntries: { g_root: providers.managed.keyEntries.g_root } } });
  rows = ui.all('[role="menuitemradio"]');
  assert.equal(rows.some(row => /Current key model|Stale|Noncanonical|Old raw current|Native extra/.test(row.textContent)), false);
  assert.deepEqual(ui.selections, []);
  ui.click(rows.find(row => row.textContent.startsWith('Current root model')));
  await ui.settle();
  assert.deepEqual(ui.selections, [{ provider: 'managed', model: root }]);
});

test('fallback routing filtering is opt-in and ordinary legacy raw current choices retain their previous behavior', t => {
  const ui = mountFallback(t);
  const unmanaged = structuredClone(providers);
  delete unmanaged.managed.bridgeRouting;
  ui.updateProviders(unmanaged);
  const text = ui.all('[role="menuitemradio"]').map(row => row.textContent);
  assert.equal(text.includes('Old raw currentManaged Provider'), true);
  assert.equal(text.includes('Stale wire modelManaged Provider / Current key'), true, 'unflagged native groups retain their catalog-order semantics');
  assert.equal(text.some(value => /Stale entry model|Noncanonical alias|Native extra/.test(value)), false);
  ui.updateDirectory({ current: { provider: 'managed', model: alias('g_stale', 'wire') } });
  assert.equal(ui.one('[aria-haspopup="menu"]').textContent, alias('g_stale', 'wire'));
  assert.deepEqual(ui.selections, []);
});
