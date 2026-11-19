import { bridgeModelProjection, validateBridgeDraft } from './profile.js';

const own = (object, key) => Object.hasOwn(object ?? {}, key);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const fields = ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts'];

/** The editor observes only public single-key fields, never the admission profile. */
export function publicBridgeSingleKey(profile) {
  return { apiKeyEnv: typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv !== 'DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD' ? profile.apiKeyEnv : '',
    models: Array.isArray(profile?.models) ? profile.models.map(model => bridgeModelProjection(model.id, model)) : [] };
}

export function validateBridgeSingleKey(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['apiKeyEnv', 'models'].includes(key))) fail('INVALID_SINGLE_KEY_CONFIG');
  const result = structuredClone(patch);
  if (own(result, 'apiKeyEnv') && result.apiKeyEnv !== null && (typeof result.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(result.apiKeyEnv))) fail('INVALID_CREDENTIAL_REFERENCE');
  if (own(result, 'models')) {
    if (!Array.isArray(result.models) || result.models.some(model => !model || typeof model !== 'object' || Object.keys(model).some(key => !fields.includes(key)))) fail('INVALID_MODELS');
    result.models = validateBridgeDraft({ enabled: false, keyEntries: { root: { models: result.models } } }).keyEntries.root.models;
  }
  return result;
}

export function applyBridgeSingleKey(original, patch) {
  const result = structuredClone(original ?? {});
  if (patch === undefined) return result;
  const value = validateBridgeSingleKey(patch);
  if (own(value, 'apiKeyEnv')) {
    if (value.apiKeyEnv === null) delete result.apiKeyEnv;
    else result.apiKeyEnv = value.apiKeyEnv;
  }
  if (own(value, 'models')) {
    const previous = new Map((result.models ?? []).map(model => [model.id, model]));
    result.models = value.models.map(model => {
      const merged = structuredClone(previous.get(model.id) ?? {});
      // Honor clearing an observed field, while keeping unobserved host options.
      for (const field of fields) {
        if (own(model, field)) merged[field] = structuredClone(model[field]);
        else delete merged[field];
      }
      return merged;
    });
  }
  return result;
}
