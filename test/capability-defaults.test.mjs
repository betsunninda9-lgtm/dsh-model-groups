import test from 'node:test';
import assert from 'node:assert/strict';
import { applyModelCapabilities, validateCapabilityDefaults, validateCapabilityOverrides, validateCapabilityBatch, applyModelBatchCapabilities, materializeCapabilityEntry, applyCapabilityBatch, mergeCapabilityModels } from '../src/capability-defaults.js';

test('batch actions rewrite only the clicked capability and individual raw edits persist', () => {
  const entry = { name: 'Group', models: [{ id: 'm', input: ['text'], reasoningEfforts: { minimal: 'vendor-tiny', xhigh: 'vendor-extra' } }] };
  const original = structuredClone(entry);
  const visionOn = applyCapabilityBatch(entry, 'vision', true);
  assert.deepEqual(visionOn.capabilityBatch, { vision: true });
  assert.deepEqual(visionOn.models[0].input, ['text', 'image']);
  assert.deepEqual(visionOn.models[0].reasoningEfforts, entry.models[0].reasoningEfforts);
  const edited = mergeCapabilityModels(visionOn, [{ ...visionOn.models[0], input: ['text'] }]);
  assert.deepEqual(edited.models[0].input, ['text'], 'native model edit beats remembered batch value');
  const reasoningOn = applyCapabilityBatch(edited, 'reasoning', true);
  assert.deepEqual(reasoningOn.models[0].input, ['text'], 'later reasoning batch does not reapply vision');
  assert.deepEqual(reasoningOn.models[0].reasoningEfforts, entry.models[0].reasoningEfforts);
  const offEntry = applyCapabilityBatch(reasoningOn, 'reasoning', false);
  assert.equal(offEntry.models[0].reasoningEfforts, false, 'off explicitly defeats catalog reasoning');
  assert.deepEqual(offEntry.capabilityBatch, { vision: true, reasoning: false });
  assert.deepEqual(entry, original);
});

test('new IDs inherit remembered batch keys while existing incoming rows retain native edits', () => {
  const entry = { models: [{ id: 'old', input: ['text'], reasoningEfforts: { high: 'custom-high' } }], capabilityBatch: { vision: true } };
  const refreshed = mergeCapabilityModels(entry, [{ id: 'old', input: ['text'], reasoningEfforts: false }, { id: 'new', reasoningEfforts: { high: 'new-custom' } }]);
  assert.deepEqual(refreshed.models[0], { id: 'old', input: ['text'], reasoningEfforts: false });
  assert.deepEqual(refreshed.models[1], { id: 'new', input: ['text', 'image'], reasoningEfforts: { high: 'new-custom' } });
  assert.deepEqual(applyModelBatchCapabilities({ id: 'm', input: ['image'] }, { reasoning: false }), { id: 'm', input: ['image'], reasoningEfforts: false });
  for (const invalid of [null, [], { vision: undefined }, { reasoning: 'true' }, { extra: true }]) assert.throws(() => validateCapabilityBatch(invalid), /capabilityBatch/);
});

test('renaming IDs and blank-row edits preserve raw fields while appending a second blank applies defaults', () => {
  const entry = { models: [{ id: 'before', input: ['text'] }], capabilityBatch: { vision: true } };
  assert.deepEqual(mergeCapabilityModels(entry, [{ id: 'renamed', input: ['text'] }]).models, [{ id: 'renamed', input: ['text'] }]);
  const blank = { models: [{ id: '', input: ['text'] }], capabilityBatch: { vision: true } };
  assert.deepEqual(mergeCapabilityModels(blank, [{ id: '', input: ['text'] }]).models, blank.models);
  assert.deepEqual(mergeCapabilityModels(blank, [{ id: '', input: ['text'] }, { id: '' }]).models.map(model => model.input), [['text'], ['text', 'image']]);
});

test('original native reasoning OFF becomes explicit false only in a participating batch group', () => {
  const entry = { models: [{ id: 'm', reasoningEfforts: { high: 'custom' } }], capabilityBatch: { reasoning: true } };
  assert.equal(mergeCapabilityModels(entry, [{ id: 'm' }]).models[0].reasoningEfforts, false);
  assert.equal(mergeCapabilityModels({ ...entry, capabilityBatch: { vision: true } }, [{ id: 'm' }]).models[0].reasoningEfforts, undefined);
  assert.equal(mergeCapabilityModels({ models: entry.models }, [{ id: 'm' }]).models[0].reasoningEfforts, undefined);
});

test('blank group models normalize safely and migrated incoming native edits are never overridden again', () => {
  assert.deepEqual(materializeCapabilityEntry({ name: 'Empty' }), { name: 'Empty', models: [] });
  assert.deepEqual(mergeCapabilityModels({ capabilityBatch: { vision: true } }, [{ id: '' }]).models[0].input, ['text', 'image']);
  const legacy = { capabilityDefaults: on, models: [{ id: 'old' }] };
  assert.deepEqual(mergeCapabilityModels(legacy, [{ id: 'old', input: ['text'], reasoningEfforts: false }]).models, [{ id: 'old', input: ['text'], reasoningEfforts: false }]);
});

test('beta1 migration materializes effective raw values, removes metadata and retains last defaults for new IDs', () => {
  const entry = { capabilityDefaults: on, models: [{ id: 'follow' }, { id: 'original', input: ['text'], capabilityOverrides: { vision: 'original', reasoning: false } }] };
  const migrated = materializeCapabilityEntry(entry);
  assert.deepEqual(migrated.capabilityBatch, on);
  assert.equal(Object.hasOwn(migrated, 'capabilityDefaults'), false);
  assert.equal(Object.hasOwn(migrated.models[1], 'capabilityOverrides'), false);
  assert.deepEqual(migrated.models[0].input, ['text', 'image']);
  assert.deepEqual(migrated.models[1], { id: 'original', input: ['text'], reasoningEfforts: false });
  assert.deepEqual(materializeCapabilityEntry(migrated), migrated, 'migration is idempotent');
  const dormant = materializeCapabilityEntry({ models: [{ id: 'm', capabilityOverrides: { vision: true } }] });
  assert.deepEqual(dormant, { models: [{ id: 'm' }] });
  const batch = applyCapabilityBatch(entry, 'vision', false);
  assert.deepEqual(batch.models.map(model => model.input), [['text'], ['text']]);
  assert.equal(batch.models[1].reasoningEfforts, false);
});

const on = { vision: true, reasoning: true };
const off = { vision: false, reasoning: false };

test('group defaults affect effective descriptors immutably and keep raw custom effort mappings', () => {
  const raw = { id: 'm', input: ['text', 'image', 'audio'], reasoningEfforts: { off: 'none', minimal: 'tiny', xhigh: 'vendor-extra' }, other: { stable: true } };
  const snapshot = structuredClone(raw);
  const disabled = applyModelCapabilities(raw, off);
  assert.deepEqual(disabled.input, ['text', 'audio']);
  assert.equal(disabled.reasoningEfforts, false);
  const enabled = applyModelCapabilities(raw, on);
  assert.deepEqual(enabled.input, raw.input);
  assert.deepEqual(enabled.reasoningEfforts, raw.reasoningEfforts);
  assert.notEqual(enabled.reasoningEfforts, raw.reasoningEfforts);
  assert.deepEqual(raw, snapshot);
  assert.equal(enabled.other, raw.other);
});

test('image defaults preserve explicit image-only input and only add text when disabling would empty modalities', () => {
  assert.deepEqual(applyModelCapabilities({ id: 'image-only', input: ['image'] }, on).input, ['image']);
  assert.deepEqual(applyModelCapabilities({ id: 'image-only', input: ['image'] }, off).input, ['text']);
  assert.deepEqual(applyModelCapabilities({ id: 'text-only', input: ['text'] }, on).input, ['text', 'image']);
  assert.deepEqual(applyModelCapabilities({ id: 'new' }, on).input, ['text', 'image']);
});

test('new models follow defaults; explicit overrides and original preservation are independent per field', () => {
  assert.deepEqual(applyModelCapabilities({ id: 'new' }, on), { id: 'new', input: ['text', 'image'], reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } });
  const original = { id: 'catalog', capabilityOverrides: { vision: 'original', reasoning: 'original' } };
  assert.deepEqual(applyModelCapabilities(original, on), { id: 'catalog' });
  assert.deepEqual(applyModelCapabilities({ id: 'm', input: ['image'], capabilityOverrides: { vision: false, reasoning: true } }, off), { id: 'm', input: ['text'], reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } });
  assert.deepEqual(applyModelCapabilities({ id: 'm', capabilityOverrides: { reasoning: 'original' } }, on), { id: 'm', input: ['text', 'image'] });
});

test('legacy group absence preserves all original effective fields even with dormant valid overrides', () => {
  for (const override of [undefined, { vision: true, reasoning: false }, { vision: 'original' }]) {
    const raw = { id: 'm', input: ['image'], reasoningEfforts: { high: 'special' }, capabilityOverrides: override };
    assert.deepEqual(applyModelCapabilities(raw), { id: 'm', input: ['image'], reasoningEfforts: { high: 'special' } });
  }
});

test('metadata rejects malformed values even when group capability policy is dormant', () => {
  for (const defaults of [null, [], true, {}, { vision: true }, { vision: true, reasoning: 'true' }, { ...on, extra: false }]) assert.throws(() => validateCapabilityDefaults(defaults), /capabilityDefaults/);
  for (const overrides of [null, [], true, { vision: null }, { vision: 1 }, { vision: 'inherit' }, { extra: true }]) assert.throws(() => validateCapabilityOverrides(overrides), /capabilityOverrides/);
  assert.equal(validateCapabilityDefaults(undefined), undefined);
  assert.deepEqual(validateCapabilityOverrides({}), {});
});

test('only valid declared thinking levels survive forced enable and helpers serialize without imports', () => {
  for (const reasoningEfforts of [false, undefined, {}, { off: null }, { high: null }, { low: '' }, { custom: 'wire' }]) {
    assert.deepEqual(applyModelCapabilities({ id: 'm', reasoningEfforts }, on).reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high' });
  }
  const serialized = new Function(`return (${applyModelCapabilities.toString()})`)();
  assert.deepEqual(serialized({ id: 'm' }, on), applyModelCapabilities({ id: 'm' }, on));
});
