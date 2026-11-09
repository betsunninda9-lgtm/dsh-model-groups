import assert from 'node:assert/strict';
import test from 'node:test';
import { createPickerHarness } from './helpers/picker-harness.mjs';

// Entirely synthetic: no profile, credentials, discovery, Host transport or LLM.
// This fixture deliberately gives two keys on ONE provider the same wire/name.
const alias = (entry, wire) => `@dsh-key/${encodeURIComponent(entry)}/${encodeURIComponent(wire)}`;
const primary = alias('primary', 'same-id');
const backup = alias('backup', 'same-id');
const alpha = alias('primary', 'alpha');
const beta = alias('backup', 'beta');
const primaryKey = '@key/route-a/primary';
const backupKey = '@key/route-a/backup';
const legacyKey = '@key/route-a/%40legacy';
const reasoning = { defaultEffort: 'medium', efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] };
const providers = {
  'route-a': { multiKey: true, keyEntries: {
    primary: { name: 'Primary Key', apiKeyEnv: 'SYNTHETIC_PRIMARY', models: {} },
    backup: { name: 'Backup Key', apiKeyEnv: 'SYNTHETIC_BACKUP', models: {} },
  } },
  'route-b': { multiKey: false }, 'route-c': {},
};
const groups = [
  { id: 'route-a', name: 'Provider A', models: [
    { id: primary, name: 'Shared Model', reasoning }, { id: alpha, name: 'Alpha Unique' },
    { id: backup, name: 'Shared Model' }, { id: beta, name: 'Beta Unique' },
    { id: 'same-id', name: 'Old Raw Model' }, { id: 'legacy-other', name: 'Other Raw Model' },
  ] },
  { id: 'route-b', name: 'Ordinary Provider', models: [{ id: 'same-id', name: 'Shared Model' }, { id: 'ordinary', name: 'Ordinary Model' }] },
  { id: 'route-c', name: 'Creative Provider', models: [{ id: 'art', name: 'Canvas Model' }] },
];
const snapshot = {
  status: 'ready', groups, current: { provider: 'route-a', model: primary, reasoningEffort: 'medium' },
  pending: null, retainedEffort: null, error: null, failures: [],
};
const collapsed = { 'route-a': false, [primaryKey]: false, [backupKey]: false, 'route-b': false, 'route-c': false };
const allOpen = Object.fromEntries(Object.keys(collapsed).map(key => [key, true]));
const heading = (ui, key) => ui.one(`[data-group-toggle="${key}"]`);
const choice = (ui, provider, model) => ui.one(`[data-model-choice][data-provider-id="${provider}"][data-model-id="${model}"]`);
const choices = ui => ui.all('[data-model-choice]').map(node => ({ provider: node.dataset.providerId, model: node.dataset.modelId }));
const route = model => ({ provider: 'route-a', model });
const expanded = (ui, key) => heading(ui, key).getAttribute('aria-expanded') === 'true';
function mount(t, options = {}) {
  const ui = createPickerHarness({ snapshot, providers, ...options });
  t.after(() => ui.dispose());
  return ui;
}
function openModels(ui) {
  ui.click(ui.one('[aria-haspopup="menu"]'));
  const cell = ui.all('[role="menuitem"]').find(node => node.textContent.startsWith('Model'));
  if (cell) ui.click(cell);
  assert.equal(ui.fallback, false, 'normal picker must not silently fall back');
  return ui;
}
function assertHealthy(ui) { assert.equal(ui.fallback, false); assert.deepEqual(ui.errors, []); }

// The route identities and exact expected aliases above are independent of the
// hierarchy implementation; this suite evaluates the actual built component.
test('native multi-key provider and key folds are independent and reopening retains child choices', t => {
  const ui = openModels(mount(t));
  assert.equal(expanded(ui, 'route-a'), true);
  assert.equal(expanded(ui, primaryKey), true);
  assert.equal(expanded(ui, backupKey), false);
  assert.equal(expanded(ui, 'route-b'), false);
  assert.deepEqual(choices(ui), [route(primary), route(alpha)]);
  ui.click(heading(ui, backupKey));
  ui.click(heading(ui, primaryKey));
  assert.equal(expanded(ui, primaryKey), false);
  assert.equal(expanded(ui, backupKey), true);
  assert.deepEqual(choices(ui), [route(backup), route(beta)]);
  ui.click(heading(ui, 'route-a'));
  assert.equal(ui.all('[data-key-entry]').length, 0);
  assert.deepEqual(choices(ui), []);
  ui.click(heading(ui, 'route-a'));
  assert.equal(expanded(ui, primaryKey), false);
  assert.equal(expanded(ui, backupKey), true);
  ui.click(heading(ui, 'route-b'));
  assert.equal(expanded(ui, backupKey), true);
  ui.outsidePointer();
  openModels(ui);
  assert.equal(expanded(ui, primaryKey), false, 'current key must respect an explicit collapsed preference');
  assert.equal(expanded(ui, backupKey), true);
  assert.equal(expanded(ui, 'route-b'), true);
  assertHealthy(ui);
});

test('ordinary providers retain their original collapsible model lists and gain no key subgroups', t => {
  const ui = openModels(mount(t, { preferences: collapsed }));
  assert.equal(ui.all('[data-provider-group]').length, 3);
  assert.deepEqual(choices(ui), []);
  ui.click(heading(ui, 'route-b'));
  assert.deepEqual(choices(ui), [{ provider: 'route-b', model: 'same-id' }, { provider: 'route-b', model: 'ordinary' }]);
  assert.equal(ui.one('[data-provider-group="route-b"]').querySelectorAll('[data-key-entry]').length, 0);
  ui.click(heading(ui, 'route-c'));
  ui.click(heading(ui, 'route-b'));
  assert.deepEqual(choices(ui), [{ provider: 'route-c', model: 'art' }]);
  assert.equal(expanded(ui, 'route-a'), false);
  ui.click(heading(ui, 'route-c'));
  assert.deepEqual(choices(ui), []);
  assertHealthy(ui);
});

test('same provider and wire under two keys select the exact canonical alias, not raw ID or another provider', async t => {
  const ui = openModels(mount(t));
  ui.click(heading(ui, backupKey));
  assert.equal(choice(ui, 'route-a', primary).getAttribute('aria-checked'), 'true');
  assert.equal(choice(ui, 'route-a', backup).getAttribute('aria-checked'), 'false');
  assert.equal(ui.all('[data-model-choice][data-model-id="same-id"]').length, 0);
  ui.click(choice(ui, 'route-a', backup));
  await ui.settle();
  assert.deepEqual(ui.selections, [{ provider: 'route-a', model: '@dsh-key/backup/same-id' }]);
  assert.equal(ui.one('[aria-haspopup="menu"]').getAttribute('aria-expanded'), 'false');
  assert.equal(ui.document.activeElement, ui.one('[aria-haspopup="menu"]'));
  ui.updateDirectory({ current: { provider: 'route-a', model: backup } });
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Shared Model.*Provider A \/ Backup Key/);
  openModels(ui);
  ui.click(heading(ui, 'route-b'));
  ui.click(choice(ui, 'route-b', 'same-id'));
  await ui.settle();
  assert.deepEqual(ui.selections[1], { provider: 'route-b', model: 'same-id' });
  assertHealthy(ui);
});

test('provider, key name and model search temporarily open both levels; clear restores saved folds without writes', t => {
  const ui = openModels(mount(t, { preferences: collapsed }));
  const writesBefore = ui.storageWrites.length;
  ui.search('Beta Unique');
  assert.deepEqual(choices(ui), [route(beta)]);
  assert.equal(expanded(ui, 'route-a'), true);
  assert.equal(expanded(ui, backupKey), true);
  assert.equal(heading(ui, backupKey).disabled, true);
  assert.equal(ui.one('[data-group-bulk="expand"]').disabled, true);
  ui.search('Provider A');
  assert.deepEqual(choices(ui), [route(primary), route(alpha), route(backup), route(beta)]);
  ui.search('Backup Key');
  assert.deepEqual(choices(ui), [route(backup), route(beta)]);
  ui.search('Primary Key');
  assert.deepEqual(choices(ui), [route(primary), route(alpha)]);
  ui.search('cReAtIvE pRoViDeR');
  assert.deepEqual(choices(ui), [{ provider: 'route-c', model: 'art' }]);
  ui.click(ui.button('Clear search'));
  assert.equal(ui.one('[role="searchbox"]').value, '');
  assert.equal(ui.document.activeElement, ui.one('[role="searchbox"]'));
  assert.deepEqual(choices(ui), []);
  assert.equal(expanded(ui, 'route-a'), false);
  assert.equal(expanded(ui, 'route-c'), false);
  assert.equal(ui.storageWrites.length, writesBefore, 'temporary search expansion must not be persisted');
  assert.deepEqual(ui.savedExpanded(), collapsed);
  ui.search('Old Raw Model');
  assert.match(ui.text(), /No matching models/);
  ui.search('definitely-no-model');
  assert.equal(ui.one('[role="searchbox"]').getAttribute('aria-activedescendant'), null);
  ui.click(ui.button('Clear search'));
  assert.deepEqual(choices(ui), []);
  assertHealthy(ui);
});

test('bulk expand/collapse includes provider and every key while preserving unrelated stored preferences', t => {
  const ui = openModels(mount(t, { preferences: { ...collapsed, orphan: true } }));
  ui.click(ui.one('[data-group-bulk="expand"]'));
  assert.equal(choices(ui).length, 7, 'raw compatibility rows must not join bulk-expanded aliases');
  for (const key of Object.keys(collapsed)) assert.equal(expanded(ui, key), true, key);
  assert.deepEqual(ui.savedExpanded(), { ...allOpen, orphan: true });
  ui.click(ui.one('[data-group-bulk="collapse"]'));
  assert.deepEqual(choices(ui), []);
  assert.deepEqual(ui.savedExpanded(), { ...collapsed, orphan: true });
  assertHealthy(ui);
});

test('only the current raw legacy session gets one compatibility child, which vanishes on alias selection', async t => {
  const ui = openModels(mount(t, { snapshot: { ...snapshot, current: { provider: 'route-a', model: 'same-id' } } }));
  assert.match(heading(ui, legacyKey).textContent, /Legacy single key \(existing session\)/);
  assert.deepEqual(choices(ui), [route('same-id')]);
  assert.equal(ui.all('[data-model-choice][data-model-id="legacy-other"]').length, 0);
  ui.click(ui.one('[data-group-bulk="collapse"]'));
  assert.equal(ui.savedExpanded()[legacyKey], false);
  ui.click(ui.one('[data-group-bulk="expand"]'));
  assert.equal(ui.savedExpanded()[legacyKey], true);
  assert.deepEqual(choices(ui).filter(row => !row.model.startsWith('@dsh-key/')), [route('same-id'), { provider: 'route-b', model: 'same-id' }, { provider: 'route-b', model: 'ordinary' }, { provider: 'route-c', model: 'art' }]);
  ui.click(choice(ui, 'route-a', backup));
  await ui.settle();
  assert.deepEqual(ui.selections, [route(backup)]);
  ui.updateDirectory({ current: { provider: 'route-a', model: backup } });
  openModels(ui);
  assert.equal(ui.all('[data-key-entry="@legacy"]').length, 0);
  assert.equal(ui.all('[data-model-choice][data-provider-id="route-a"][data-model-id="same-id"]').length, 0);
  ui.search('Old Raw Model');
  assert.match(ui.text(), /No matching models/);
  assertHealthy(ui);
});

test('switching multi-key OFF immediately hides stale aliases even while directory/current still hold them', async t => {
  const ui = openModels(mount(t, { preferences: allOpen }));
  ui.updateProviders({ ...providers, 'route-a': { ...providers['route-a'], multiKey: false } });
  assert.equal(ui.all('[data-key-entry]').length, 0);
  assert.deepEqual(choices(ui).filter(row => row.provider === 'route-a'), [route('same-id'), route('legacy-other')]);
  assert.ok(choices(ui).every(row => !row.model.startsWith('@dsh-key/')));
  ui.search('Backup Key');
  assert.match(ui.text(), /No matching models/);
  ui.click(ui.button('Clear search'));
  ui.click(choice(ui, 'route-a', 'same-id'));
  await ui.settle();
  assert.deepEqual(ui.selections, [route('same-id')]);
  assertHealthy(ui);
});

test('deleting a key entry never revives its stale aliases, including search and active old sessions', t => {
  const ui = openModels(mount(t, { preferences: allOpen, snapshot: { ...snapshot, current: { provider: 'route-a', model: backup } } }));
  const removed = { ...providers, 'route-a': { ...providers['route-a'], keyEntries: { primary: providers['route-a'].keyEntries.primary } } };
  ui.updateProviders(removed);
  assert.equal(ui.all('[data-key-entry="backup"]').length, 0);
  assert.equal(ui.all('[data-key-entry="@legacy"]').length, 0);
  assert.deepEqual(choices(ui).filter(row => row.provider === 'route-a'), [route(primary), route(alpha)]);
  ui.updateDirectory({ groups: [...groups] });
  assert.equal(ui.all('[data-model-choice][data-model-id="@dsh-key/backup/same-id"]').length, 0);
  ui.search('Backup Key');
  assert.match(ui.text(), /No matching models/);
  ui.search('Beta Unique');
  assert.match(ui.text(), /No matching models/);
  ui.click(ui.button('Clear search'));
  assert.equal(ui.savedExpanded()[backupKey], true, 'stale fold state is harmless and must not recreate an entry');
  assertHealthy(ui);
});

test('configuration loading can identify aliases, then ready settings remove unconfigured stale keys', t => {
  const ui = openModels(mount(t, { providersStatus: 'loading' }));
  assert.match(heading(ui, primaryKey).textContent, /primary/);
  assert.deepEqual(choices(ui), [route(primary), route(alpha)]);
  ui.updateProviders({ ...providers, 'route-a': { multiKey: true, keyEntries: { primary: providers['route-a'].keyEntries.primary } } });
  ui.updateProvidersStatus('ready');
  assert.match(heading(ui, primaryKey).textContent, /Primary Key/);
  assert.equal(ui.all('[data-key-entry="backup"]').length, 0);
  assertHealthy(ui);
});

test('many manual key entries remain individually selectable without a fixed entry limit', async t => {
  const entries = Object.fromEntries(Array.from({ length: 75 }, (_, index) => [`manual-${index}`, { name: `Manual Key ${index}`, apiKeyEnv: `SYNTHETIC_${index}` }]));
  const models = Object.keys(entries).map(entry => ({ id: alias(entry, 'same-wire'), name: 'Same Model' }));
  const ui = openModels(mount(t, {
    providers: { many: { multiKey: true, keyEntries: entries } },
    snapshot: { ...snapshot, groups: [{ id: 'many', name: 'Many Provider', models }], current: { provider: 'many', model: alias('manual-0', 'same-wire') } },
  }));
  assert.equal(ui.all('[data-key-entry]').length, 75);
  ui.search('Manual Key 74');
  assert.deepEqual(choices(ui), [{ provider: 'many', model: '@dsh-key/manual-74/same-wire' }]);
  ui.click(choice(ui, 'many', '@dsh-key/manual-74/same-wire'));
  await ui.settle();
  assert.deepEqual(ui.selections, [{ provider: 'many', model: '@dsh-key/manual-74/same-wire' }]);
  assertHealthy(ui);
});

test('keyboard arrows traverse provider, key and model controls; left/right only changes headings', t => {
  const ui = openModels(mount(t));
  const expandAll = ui.one('[data-group-bulk="expand"]');
  ui.focus(expandAll);
  assert.equal(ui.key(expandAll, 'ArrowDown').defaultPrevented, true);
  assert.equal(ui.document.activeElement, ui.one('[data-group-bulk="collapse"]'));
  ui.key(ui.document.activeElement, 'ArrowDown');
  assert.equal(ui.document.activeElement, heading(ui, 'route-a'));
  ui.key(ui.document.activeElement, 'ArrowLeft');
  assert.equal(expanded(ui, 'route-a'), false);
  ui.key(ui.document.activeElement, 'ArrowRight');
  assert.equal(expanded(ui, 'route-a'), true);
  ui.key(ui.document.activeElement, 'ArrowDown');
  assert.equal(ui.document.activeElement, heading(ui, primaryKey));
  ui.key(ui.document.activeElement, 'ArrowLeft');
  assert.equal(expanded(ui, primaryKey), false);
  ui.key(ui.document.activeElement, 'ArrowRight');
  ui.key(ui.document.activeElement, 'ArrowDown');
  assert.equal(ui.document.activeElement, choice(ui, 'route-a', primary));
  const before = ui.savedExpanded();
  ui.key(ui.document.activeElement, 'ArrowLeft');
  ui.key(ui.document.activeElement, 'ArrowRight');
  assert.deepEqual(ui.savedExpanded(), before);
  ui.key(ui.document.activeElement, 'ArrowUp');
  assert.equal(ui.document.activeElement, heading(ui, primaryKey));
  assertHealthy(ui);
});

for (const acceptKey of ['Enter', 'Tab']) {
  test(`search keyboard ${acceptKey} accepts exact key alias and Escape restores root focus`, async t => {
    const ui = openModels(mount(t, { preferences: collapsed }));
    ui.search('Shared Model');
    const input = ui.one('[role="searchbox"]');
    assert.equal(ui.one(`[id="${input.getAttribute('aria-activedescendant')}"]`).dataset.modelId, primary);
    ui.key(input, 'ArrowDown');
    const active = ui.one(`[id="${ui.one('[role="searchbox"]').getAttribute('aria-activedescendant')}"]`);
    assert.equal(active.dataset.providerId, 'route-a');
    assert.equal(active.dataset.modelId, backup);
    assert.equal(ui.document.activeElement, ui.one('[role="searchbox"]'));
    assert.equal(ui.key(ui.document.activeElement, acceptKey).defaultPrevented, true);
    await ui.settle();
    assert.deepEqual(ui.selections, [route(backup)]);
    openModels(ui);
    ui.search('Beta');
    ui.key(ui.document.activeElement, 'Escape');
    assert.equal(ui.all('[role="searchbox"]').length, 0);
    assert.equal(ui.document.activeElement.getAttribute('role'), 'menuitem');
    ui.key(ui.document.activeElement, 'Escape');
    assert.equal(ui.one('[aria-haspopup="menu"]').getAttribute('aria-expanded'), 'false');
    assert.equal(ui.document.activeElement, ui.one('[aria-haspopup="menu"]'));
    assertHealthy(ui);
  });
}

test('load failure, partial provider failure, loading and retry retain original directory/RPC contracts', t => {
  const ui = openModels(mount(t, { snapshot: { ...snapshot, current: null, status: 'loading', error: 'Catalog offline', failures: [{ id: 'route-c', name: 'Creative Provider', message: 'Provider timeout' }] } }));
  assert.equal(ui.loads.length, 1);
  assert.match(ui.text(), /Loading models/);
  assert.match(ui.text(), /Catalog offline/);
  assert.match(ui.text(), /Creative Provider: Provider timeout/);
  const retries = ui.all('button').filter(node => node.textContent === 'Retry');
  assert.equal(retries.length, 2);
  ui.click(retries[0]);
  ui.click(retries[1]);
  assert.equal(ui.loads.length, 3);
  ui.updateDirectory({ status: 'ready', error: null, failures: [] });
  assert.doesNotMatch(ui.text(), /Catalog offline|Provider timeout|Loading models/);
  ui.click(heading(ui, 'route-b'));
  assert.ok(choice(ui, 'route-b', 'ordinary'));
  assertHealthy(ui);
});

test('thinking effort stays Host-owned and retains the exact alias and retained-effort display', async t => {
  const ui = mount(t);
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Shared Model.*Provider A \/ Primary Key.*Medium/);
  ui.click(ui.one('[aria-haspopup="menu"]'));
  ui.click(ui.button('Thinking effortMedium'));
  assert.equal(ui.button('Medium').getAttribute('aria-checked'), 'true');
  ui.click(ui.button('High'));
  await ui.settle();
  assert.deepEqual(ui.selections, [{ provider: 'route-a', model: primary, reasoningEffort: 'high' }]);
  ui.updateDirectory({ current: { provider: 'route-a', model: primary, reasoningEffort: 'high' } });
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /High/);
  ui.updateDirectory({ current: { provider: 'route-b', model: 'ordinary' }, retainedEffort: 'High' });
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Ordinary Model.*Ordinary Provider.*High/);
  ui.click(ui.one('[aria-haspopup="menu"]'));
  assert.equal(ui.all('[role="menuitem"]').length, 1, 'do not invent efforts for a model with no reasoning metadata');
  assertHealthy(ui);
});

test('pending selections disable model/key/provider/search controls; rejection still displays the original error', async t => {
  let finish;
  const ui = openModels(mount(t, { selectResult: () => new Promise(resolve => { finish = resolve; }) }));
  ui.click(heading(ui, backupKey));
  ui.click(choice(ui, 'route-a', backup));
  ui.updateDirectory({ pending: route(backup) });
  assert.equal(choice(ui, 'route-a', backup).disabled, true);
  assert.equal(heading(ui, 'route-a').disabled, true);
  assert.equal(heading(ui, backupKey).disabled, true);
  assert.equal(ui.one('[data-group-bulk="expand"]').disabled, true);
  assert.equal(ui.one('[role="searchbox"]').props.readOnly, true);
  assert.equal(ui.one('[aria-haspopup="menu"]').getAttribute('aria-busy'), 'true');
  ui.click(choice(ui, 'route-a', backup));
  assert.deepEqual(ui.selections, [route(backup)]);
  finish({ ok: false, error: { code: 'session/writer-held', message: 'synthetic contention' } });
  await ui.settle();
  assert.match(ui.one('[role="alert"]').textContent, /This session is in use/);
  ui.updateDirectory({ pending: null });
  assert.equal(choice(ui, 'route-a', backup).disabled, false);
  assertHealthy(ui);
});

test('locked and unavailable seats keep their original interaction contracts', async t => {
  const locked = mount(t, { locked: true });
  const trigger = locked.one('[aria-haspopup="menu"]');
  assert.equal(trigger.disabled, true);
  locked.click(trigger);
  assert.equal(locked.loads.length, 0);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  const unavailable = mount(t, { available: false });
  assert.equal(unavailable.all('button').length, 0);
  assert.equal(unavailable.text(), '');
  const injected = unavailable.slot.entry.inject('synthetic-session');
  injected.load();
  assert.equal(await injected.select(route(primary)), undefined);
  assert.equal(unavailable.loads.length, 0);
  assert.deepEqual(unavailable.selections, []);
  assertHealthy(locked);
  assertHealthy(unavailable);
});

test('native key labels and cross-tab fold preferences update the mounted picker without changing alias identity', t => {
  const ui = openModels(mount(t));
  ui.storageEvent(collapsed);
  assert.deepEqual(choices(ui), []);
  ui.updateProviders({ ...providers, 'route-a': { ...providers['route-a'], keyEntries: { ...providers['route-a'].keyEntries, primary: { ...providers['route-a'].keyEntries.primary, name: 'Renamed Key' } } } });
  assert.match(ui.one('[aria-haspopup="menu"]').getAttribute('title'), /Provider A \/ Renamed Key/);
  ui.storageEvent(null);
  assert.equal(expanded(ui, 'route-a'), true);
  assert.equal(expanded(ui, primaryKey), true);
  assert.match(heading(ui, primaryKey).textContent, /Renamed Key/);
  assert.deepEqual(choices(ui), [route(primary), route(alpha)]);
  assertHealthy(ui);
});

test('blocked storage and unavailable optional model-label slot cannot break native grouping', t => {
  const ui = openModels(mount(t, { storageUnavailable: true, renderSlot() { throw new Error('Label slot is unavailable'); } }));
  assert.match(choice(ui, 'route-a', primary).textContent, /Shared Model/);
  ui.click(heading(ui, 'route-a'));
  assert.equal(expanded(ui, 'route-a'), false);
  ui.click(heading(ui, 'route-a'));
  assert.equal(expanded(ui, primaryKey), true);
  assertHealthy(ui);
});

test('real render failure activates boundary; flat fallback distinguishes keys and selects exact aliases', async t => {
  const ui = mount(t, { throwMenu: true });
  ui.click(ui.one('[aria-haspopup="menu"]'));
  assert.equal(ui.fallback, true);
  assert.equal(ui.errors.length, 1);
  assert.match(String(ui.errors[0][0]), /grouped picker failed, falling back/);
  assert.match(String(ui.errors[0][1]), /Synthetic MenuSurface render failure/);
  ui.click(ui.one('[aria-haspopup="menu"]'));
  const rows = ui.all('[role="menuitemradio"]');
  assert.equal(rows.length, 7);
  const target = rows.find(row => row.textContent === 'Shared ModelProvider A / Backup Key');
  assert.ok(target, 'fallback must distinguish keys on one provider even with identical model names');
  assert.equal(rows.some(row => /Old Raw Model|Other Raw Model/.test(row.textContent)), false);
  ui.click(target);
  await ui.settle();
  assert.deepEqual(ui.selections, [route(backup)]);
  assert.equal(ui.all('[role="menuitemradio"]').length, 0);
  ui.updateProps({ available: false });
  assert.equal(ui.text(), '');
});

test('fallback also excludes deleted keys and switched-off aliases while preserving the current legacy raw route', t => {
  const ui = mount(t, { throwMenu: true, snapshot: { ...snapshot, current: { provider: 'route-a', model: 'same-id' } } });
  ui.click(ui.one('[aria-haspopup="menu"]'));
  ui.click(ui.one('[aria-haspopup="menu"]'));
  assert.equal(ui.fallback, true);
  assert.ok(ui.all('[role="menuitemradio"]').some(row => row.textContent === 'Old Raw ModelProvider A'));
  assert.equal(ui.all('[role="menuitemradio"]').some(row => /Other Raw Model/.test(row.textContent)), false);
  ui.updateProviders({ ...providers, 'route-a': { multiKey: true, keyEntries: { primary: providers['route-a'].keyEntries.primary } } });
  assert.equal(ui.all('[role="menuitemradio"]').some(row => /Backup Key|Beta Unique/.test(row.textContent)), false);
  ui.updateProviders({ ...providers, 'route-a': { ...providers['route-a'], multiKey: false } });
  const rows = ui.all('[role="menuitemradio"]');
  assert.equal(rows.some(row => /Primary Key|Backup Key|Alpha Unique|Beta Unique/.test(row.textContent)), false);
  assert.ok(rows.some(row => row.textContent === 'Other Raw ModelProvider A'));
});


test('flyout mode keeps parent, key and model panels adjacent on narrow screens and selects exact key', async t => {
  const ui = openModels(mount(t));
  ui.resize(390, 700);
  ui.click(ui.button('Flyout'));
  ui.click(heading(ui, 'route-a'));
  assert.equal(ui.all('[data-flyout-level]').length, 2);
  ui.click(ui.one('[data-flyout-level="1"]').querySelectorAll('button').find(node => node.textContent.startsWith('Primary Key')));
  assert.equal(ui.all('[data-flyout-level]').length, 3);
  for (const width of [320, 390, 1280]) {
    ui.resize(width, 700);
    const panels = ui.all('[data-flyout-level]').map(node => node.props.style).sort((a, b) => a.left - b.left);
    assert.equal(panels.length, 3);
    for (let index = 1; index < panels.length; index++) assert.ok(panels[index - 1].left + panels[index - 1].width <= panels[index].left + 1e-8);
    assert.ok(panels.every(panel => panel.width > 0 && panel.left >= 12 && panel.left + panel.width <= width - 12 + 1e-8));
  }
  ui.click(choice(ui, 'route-a', alpha));
  await ui.settle();
  assert.deepEqual(ui.selections, [route(alpha)]);
  assert.equal(ui.all('[data-flyout-level]').length, 0);
  assertHealthy(ui);
});

test('closing a provider also removes its model descendant panel', t => {
  const ui = openModels(mount(t));
  ui.click(ui.button('Flyout'));
  ui.click(heading(ui, 'route-a'));
  ui.click(ui.one('[data-flyout-level="1"]').querySelectorAll('button').find(node => node.textContent.startsWith('Primary Key')));
  ui.click(heading(ui, 'route-a'));
  assert.equal(ui.all('[data-flyout-level]').length, 0);
  assert.equal(ui.all('[data-model-choice]').length, 0);
});

test('returning to the key panel cancels parent leave before a child closes', async t => {
  const ui = openModels(mount(t));
  ui.click(ui.button('Flyout'));
  ui.click(heading(ui, 'route-a'));
  ui.click(ui.one('[data-flyout-level="1"]').querySelectorAll('button').find(node => node.textContent.startsWith('Primary Key')));
  ui.mouse(ui.one('[data-flyout-level="1"]'), 'onMouseLeave');
  ui.mouse(ui.one('[data-flyout-level="2"]'), 'onMouseLeave');
  await new Promise(resolve => setTimeout(resolve, 230));
  await ui.settle();
  assert.equal(ui.all('[data-flyout-level]').length, 2, 'key panel must survive the cancelled parent timer');
  assert.equal(ui.all('[data-flyout-level="2"]').length, 0);
  assertHealthy(ui);
});
