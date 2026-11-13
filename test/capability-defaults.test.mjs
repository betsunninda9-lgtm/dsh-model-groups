import test from 'node:test';
import assert from 'node:assert/strict';
import { applyModelCapabilities, validateCapabilityDefaults, validateCapabilityOverrides } from '../src/capability-defaults.js';

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
