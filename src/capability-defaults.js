/** Resolve group capability policy without mutating the saved upstream descriptor.
 * Self-contained so the verified host generators can serialize this function.
 */
export function applyModelCapabilities(model, defaults) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const overrides = model.capabilityOverrides;
  if (defaults !== undefined && (!object(defaults) || Object.keys(defaults).some(key => key !== 'vision' && key !== 'reasoning') || typeof defaults.vision !== 'boolean' || typeof defaults.reasoning !== 'boolean')) {
    throw new TypeError('capabilityDefaults must contain only boolean vision and reasoning');
  }
  if (overrides !== undefined && (!object(overrides) || Object.keys(overrides).some(key => key !== 'vision' && key !== 'reasoning') || Object.values(overrides).some(value => typeof value !== 'boolean' && value !== 'original'))) {
    throw new TypeError('capabilityOverrides must contain only boolean or original vision and reasoning');
  }
  const { capabilityOverrides: ignored, ...effective } = model;
  if (defaults === undefined) return effective;
  const choice = key => overrides?.[key] === 'original' ? undefined : overrides?.[key] ?? defaults[key];
  const vision = choice('vision');
  if (vision !== undefined) {
    const input = Array.isArray(model.input) ? [...model.input] : ['text'];
    effective.input = [...new Set(input.filter(value => vision || value !== 'image'))];
    if (effective.input.length === 0) effective.input.push('text');
    if (vision && !effective.input.includes('image')) effective.input.push('image');
  }
  const reasoning = choice('reasoning');
  if (reasoning === false) effective.reasoningEfforts = false;
  if (reasoning === true) {
    const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const efforts = model.reasoningEfforts;
    const valid = object(efforts) && Object.keys(efforts).every(key => levels.includes(key)) && Object.entries(efforts).every(([key, value]) => key === 'off' && value === null || typeof value === 'string' && value.length > 0) && Object.keys(efforts).some(key => key !== 'off');
    effective.reasoningEfforts = valid ? { ...efforts } : { off: null, low: 'low', medium: 'medium', high: 'high' };
  }
  return effective;
}

export function validateCapabilityDefaults(defaults) {
  applyModelCapabilities({}, defaults);
  return defaults;
}

export function validateCapabilityOverrides(overrides) {
  applyModelCapabilities({ capabilityOverrides: overrides });
  return overrides;
}

/** Last batch selections affect newly introduced models, never runtime overrides. */
export function validateCapabilityBatch(batch) {
  if (batch !== undefined && (batch === null || typeof batch !== 'object' || Array.isArray(batch) || Object.keys(batch).some(key => key !== 'vision' && key !== 'reasoning') || Object.values(batch).some(value => typeof value !== 'boolean'))) {
    throw new TypeError('capabilityBatch must contain only boolean vision and reasoning');
  }
  return batch;
}

export function applyModelBatchCapabilities(model, batch) {
  validateCapabilityBatch(batch);
  const original = applyModelCapabilities(model);
  if (batch === undefined || Object.keys(batch).length === 0) return original;
  return applyModelCapabilities({ ...original, capabilityOverrides: {
    ...(batch.vision === undefined ? { vision: 'original' } : {}),
    ...(batch.reasoning === undefined ? { reasoning: 'original' } : {}),
  } }, { vision: batch.vision ?? false, reasoning: batch.reasoning ?? false });
}

/** Upgrade a beta.1 entry in the draft, preserving its actual capabilities. */
export function materializeCapabilityEntry(entry) {
  validateCapabilityBatch(entry.capabilityBatch);
  const { capabilityDefaults, ...rest } = entry;
  applyModelCapabilities({}, capabilityDefaults);
  const models = (Array.isArray(entry.models) ? entry.models : []).map(model => applyModelCapabilities(model, capabilityDefaults));
  const capabilityBatch = capabilityDefaults === undefined ? entry.capabilityBatch : { ...capabilityDefaults, ...entry.capabilityBatch };
  return { ...rest, models, ...(capabilityBatch === undefined ? {} : { capabilityBatch }) };
}

export function applyCapabilityBatch(entry, key, enabled) {
  if (!['vision', 'reasoning'].includes(key) || typeof enabled !== 'boolean') throw new TypeError('capability batch needs vision/reasoning and a boolean');
  const migrated = materializeCapabilityEntry(entry);
  return { ...migrated, capabilityBatch: { ...migrated.capabilityBatch, [key]: enabled }, models: migrated.models.map(model => applyModelBatchCapabilities(model, { [key]: enabled })) };
}

/** Existing incoming rows are edits; only genuinely new IDs inherit batch values. */
export function mergeCapabilityModels(entry, incoming) {
  const migrated = materializeCapabilityEntry(entry);
  const rows = new Map();
  for (const model of migrated.models) {
    if (!rows.has(model.id)) rows.set(model.id, []);
    rows.get(model.id).push(model);
  }
  const grows = incoming.length > migrated.models.length;
  return { ...migrated, models: incoming.map(model => {
    const previous = rows.get(model.id)?.shift();
    const nativeOff = migrated.capabilityBatch?.reasoning !== undefined && previous?.reasoningEfforts !== null && typeof previous?.reasoningEfforts === 'object' && !Array.isArray(previous.reasoningEfforts) && model.reasoningEfforts === undefined;
    const edited = nativeOff ? { ...model, reasoningEfforts: false } : model;
    return !grows || previous !== undefined ? applyModelCapabilities(edited) : applyModelBatchCapabilities(edited, migrated.capabilityBatch);
  }) };
}
