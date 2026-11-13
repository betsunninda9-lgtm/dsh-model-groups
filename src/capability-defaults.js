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
