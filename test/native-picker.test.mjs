import assert from 'node:assert/strict';
import test from 'node:test';
import { createPickerHarness } from './helpers/picker-harness.mjs';

// No config/credentials/network: exercise the actual classic bundle with the
// same raw model ID exposed by independent, real native provider routes.
const groups = [
  { id: 'native-a', name: 'Native Provider A', models: [{ id: 'same/raw-id', name: 'Shared Model' }, { id: 'alpha', name: 'Alpha Model' }] },
  { id: 'native-b', name: 'Native Provider B', models: [{ id: 'same/raw-id', name: 'Shared Model' }, { id: 'beta', name: 'Beta Model' }] },
  { id: 'ordinary', name: 'Ordinary Provider', models: [{ id: 'other', name: 'Other Model' }] },
];
const current = { provider: 'native-a', model: 'same/raw-id' };
const snapshot = { status: 'ready', groups, current, pending: null, retainedEffort: null, error: null, failures: [] };
// Null-prototype records intentionally cross the vm boundary just like serialized
// metadata; plain objects from a different realm are rejected by the helper.
const record = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
  item && typeof item === 'object' && !Array.isArray(item) ? records(item) : item]));
function records(value) { return Object.assign(Object.create(null), record(value)); }
const metadata = records({ groups: { cloud: { name: 'Cloud Service', entries: {
  primary: { name: 'Primary Key', provider: 'native-a' },
  backup: { name: 'Backup Key', provider: 'native-b' },
} } } });
const legacyProviders = { 'native-a': { multiKey: true, keyEntries: {} }, 'native-b': { multiKey: true, keyEntries: {} } };
const route = (provider, model = 'same/raw-id') => ({ provider, model });
const choices = ui => ui.all('[data-model-choice]').map(node => route(node.dataset.providerId, node.dataset.modelId));
const heading = (ui, key) => ui.all('[data-group-toggle]').find(node => node.getAttribute('data-group-toggle') === JSON.stringify(key));
const modelButton = (ui, provider, model = 'same/raw-id') => ui.all('[data-model-choice]').find(node => node.dataset.providerId === provider && node.dataset.modelId === model);
function mount(t, options = {}) {
  const ui = createPickerHarness({ snapshot, providers: legacyProviders, ...options });
  ui.updateProps({ nativeMetadata: metadata });
  t.after(() => ui.dispose());
  return ui;
}
function openModels(ui) {
  ui.click(ui.one('[aria-haspopup="menu"]'));
  const cell = ui.all('[role="menuitem"]').find(node => node.textContent.startsWith('Model'));
  if (cell) ui.click(cell);
  assert.equal(ui.fallback, false);
}

test('native metadata groups only actual directory providers and selects shared raw IDs exactly', async t => {
  const ui = mount(t);
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Shared Model.*Cloud Service \/ Primary Key/);
  openModels(ui);
  assert.equal(ui.all('[data-provider-group]').length, 2);
  assert.match(heading(ui, ['group', 'cloud']).textContent, /Cloud Service/);
  assert.deepEqual(choices(ui), [route('native-a'), route('native-a', 'alpha')]);
  ui.click(heading(ui, ['entry', 'cloud', 'backup']));
  assert.equal(modelButton(ui, 'native-a').getAttribute('aria-checked'), 'true');
  assert.equal(modelButton(ui, 'native-b').getAttribute('aria-checked'), 'false');
  ui.click(modelButton(ui, 'native-b'));
  await ui.settle();
  assert.deepEqual(ui.selections, [route('native-b')]);
  ui.updateDirectory({ current: route('native-b') });
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Cloud Service \/ Backup Key/);
  assert.ok(ui.selections.every(entry => !entry.model.startsWith('@dsh-key/')));
  assert.deepEqual(ui.errors, []);
});

test('native search and bulk folds expose all routes without alias synthesis or legacy filtering', async t => {
  const ui = mount(t);
  openModels(ui);
  const writes = ui.storageWrites.length;
  ui.search('Backup Key');
  assert.deepEqual(choices(ui), [route('native-b'), route('native-b', 'beta')]);
  assert.equal(ui.storageWrites.length, writes);
  ui.key(ui.one('[role="searchbox"]'), 'Enter');
  await ui.settle();
  assert.deepEqual(ui.selections, [route('native-b')]);
  openModels(ui);
  ui.click(ui.one('[data-group-bulk="expand"]'));
  assert.deepEqual(choices(ui), [route('native-a'), route('native-a', 'alpha'), route('native-b'), route('native-b', 'beta'), route('ordinary', 'other')]);
  ui.click(ui.one('[data-group-bulk="collapse"]'));
  assert.deepEqual(choices(ui), []);
  ui.search('Cloud Service');
  assert.equal(choices(ui).length, 4);
  ui.click(ui.button('Clear search'));
  assert.deepEqual(choices(ui), []);
  assert.deepEqual(ui.errors, []);
});

test('malformed native metadata leaves every directory route available as ordinary providers', t => {
  const ui = mount(t);
  ui.updateProps({ nativeMetadata: records({ groups: { broken: { entries: { bad: { provider: 'native-a' }, duplicate: { provider: 'native-a' } } } } }) });
  openModels(ui);
  ui.click(ui.one('[data-group-bulk="expand"]'));
  assert.equal(ui.all('[data-key-entry]').length, 0);
  assert.equal(choices(ui).length, 5);
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Native Provider A/);
  assert.deepEqual(ui.errors, []);
});

test('fallback native mode retains every raw route with readable root, key and provider labels', async t => {
  const ui = mount(t, { throwMenu: true });
  ui.click(ui.one('[aria-haspopup="menu"]'));
  assert.equal(ui.fallback, true);
  assert.match(ui.text(), /Cloud Service \/ Primary Key/);
  ui.click(ui.one('[aria-haspopup="menu"]'));
  const rows = ui.all('[role="menuitemradio"]');
  assert.equal(rows.length, 5, 'legacy multiKey config must not hide any native raw routes');
  assert.match(rows[0].textContent, /Cloud Service \/ Primary Key.*Native Provider A.*native-a/);
  assert.match(rows[2].textContent, /Cloud Service \/ Backup Key.*Native Provider B.*native-b/);
  assert.match(rows[4].textContent, /Ordinary Provider/);
  ui.click(rows[2]);
  await ui.settle();
  assert.deepEqual(ui.selections, [route('native-b')]);
  ui.updateDirectory({ current: route('native-b') });
  assert.match(ui.text(), /Cloud Service \/ Backup Key/);
});

test('native mode treats alias-shaped directory IDs as opaque raw IDs in picker and fallback', async t => {
  const raw = '@dsh-key/not-configured/raw%2Fmodel';
  const nativeGroups = groups.map(group => group.id === 'native-b'
    ? { ...group, models: [...group.models, { id: raw, name: 'Opaque Native Model' }] } : group);
  for (const throwMenu of [false, true]) {
    const ui = mount(t, { snapshot: { ...snapshot, groups: nativeGroups }, throwMenu });
    ui.click(ui.one('[aria-haspopup="menu"]'));
    if (throwMenu) {
      ui.click(ui.one('[aria-haspopup="menu"]'));
      const rows = ui.all('[role="menuitemradio"]');
      assert.equal(rows.length, 6);
      ui.click(rows.find(node => node.textContent.startsWith('Opaque Native Model')));
    } else {
      ui.click(ui.all('[role="menuitem"]').find(node => node.textContent.startsWith('Model')));
      ui.search('Opaque Native Model');
      assert.deepEqual(choices(ui), [route('native-b', raw)]);
      ui.click(modelButton(ui, 'native-b', raw));
    }
    await ui.settle();
    assert.deepEqual(ui.selections, [route('native-b', raw)]);
  }
});

test('omitted and null metadata preserve legacy picker and fallback route filtering', t => {
  for (const throwMenu of [false, true]) {
    const ui = createPickerHarness({ snapshot, providers: legacyProviders, throwMenu });
    t.after(() => ui.dispose());
    ui.updateProps({ nativeMetadata: null });
    ui.click(ui.one('[aria-haspopup="menu"]'));
    if (throwMenu) {
      ui.click(ui.one('[aria-haspopup="menu"]'));
      assert.equal(ui.all('[role="menuitemradio"]').length, 2, 'only current legacy raw + ordinary route');
    } else {
      const cell = ui.all('[role="menuitem"]').find(node => node.textContent.startsWith('Model'));
      ui.click(cell);
      ui.click(ui.one('[data-group-bulk="expand"]'));
      assert.deepEqual(choices(ui), [route('native-a'), route('ordinary', 'other')]);
      assert.match(ui.text(), /Legacy single key/);
      assert.deepEqual(ui.errors, []);
    }
  }
});
