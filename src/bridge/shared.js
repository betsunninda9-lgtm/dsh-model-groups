const APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const PRIVATE_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cf-aig-authorization']);
const fields = ['displayName', 'api', 'baseURL', 'headers'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Only connection defaults may be edited; original credentials and unknown options stay internal. */
export function validateBridgeShared(patch) {
  if (!plain(patch) || Object.keys(patch).some(key => !fields.includes(key))) fail('INVALID_SHARED_CONFIG');
  const result = structuredClone(patch);
  if (result.displayName !== undefined && result.displayName !== null) {
    if (typeof result.displayName !== 'string' || result.displayName.trim().length > 160 || /[\r\n\0]/.test(result.displayName)) fail('INVALID_SHARED_CONFIG');
    result.displayName = result.displayName.trim();
  }
  if (result.api !== undefined && result.api !== null && !APIS.has(result.api)) fail('INVALID_PROTOCOL');
  if (result.baseURL !== undefined && result.baseURL !== null) {
    if (typeof result.baseURL !== 'string' || result.baseURL.length > 8192) fail('INVALID_ENDPOINT');
    result.baseURL = result.baseURL.trim();
    if (result.baseURL) {
      let url; try { url = new URL(result.baseURL); } catch { fail('INVALID_ENDPOINT'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) fail('INVALID_ENDPOINT');
    }
  }
  if (result.headers !== undefined && result.headers !== null) {
    if (!plain(result.headers) || Object.values(result.headers).some(value => typeof value !== 'string')) fail('INVALID_HEADERS');
    if (Object.keys(result.headers).some(name => PRIVATE_HEADERS.has(name.toLowerCase()))) fail('USE_CREDENTIAL_REFERENCE');
    try { new Headers(result.headers); } catch { fail('INVALID_HEADERS'); }
  }
  return result;
}

export function applyBridgeShared(original, patch) {
  const profile = structuredClone(original ?? {});
  if (patch === undefined) return profile;
  for (const [key, value] of Object.entries(validateBridgeShared(patch))) {
    if (value === null || ['baseURL', 'displayName'].includes(key) && value === '') delete profile[key];
    else profile[key] = structuredClone(value);
  }
  return profile;
}

export function publicBridgeShared(profile) {
  return { displayName: typeof profile?.displayName === 'string' ? profile.displayName : '',
    api: APIS.has(profile?.api) ? profile.api : '',
    baseURL: typeof profile?.baseURL === 'string' && profile.baseURL !== 'http://127.0.0.1:1/dsh-model-groups-disabled' ? profile.baseURL : '',
    headers: Object.fromEntries(Object.entries(profile?.headers ?? {}).filter(([name, value]) => !PRIVATE_HEADERS.has(name.toLowerCase()) && typeof value === 'string')) };
}
