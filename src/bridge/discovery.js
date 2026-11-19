const failure = code => Object.assign(new Error(code), { code });

/** Standard model-list requests, independent of a host's catalog-first policy. */
export async function discoverBridgeModels({ profile, signal, ctx, apiKey }, { fetch: request = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(profile.api)) throw failure('DISCOVERY_PROTOCOL_REQUIRED');
  let url;
  try { url = new URL(profile.baseURL); } catch { throw failure('DISCOVERY_ENDPOINT_REQUIRED'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw failure('INVALID_ENDPOINT');
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 16384 || !/^[\x21-\x7E]+$/.test(apiKey))) throw failure('INVALID_CREDENTIAL_VALUE');
  const key = apiKey === undefined ? await ctx.credentials.resolve(profile.apiKeyEnv) : { value: apiKey };
  if (typeof key?.value !== 'string' || !key.value) throw failure('MISSING_CREDENTIAL');
  const headers = new Headers(profile.headers ?? {});
  for (const name of ['authorization', 'proxy-authorization', 'x-api-key', 'api-key']) if (headers.has(name)) throw failure('AUTH_HEADER_CONFLICT');
  const path = url.pathname.replace(/\/+$/, '');
  if (profile.api === 'anthropic-messages') {
    url.pathname = `${path.endsWith('/v1') ? path.slice(0, -3) : path}/v1/models`;
    headers.set('x-api-key', key.value);
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
  } else {
    url.pathname = `${path}/models`;
    headers.set('authorization', `Bearer ${key.value}`);
  }
  headers.set('accept', 'application/json');
  const cancellation = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const response = await request(url, { method: 'GET', headers, signal: cancellation, redirect: 'error' });
  if (!response.ok) { await response.body?.cancel?.(); throw failure('DISCOVERY_REQUEST_FAILED'); }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > 1024 * 1024) throw failure('DISCOVERY_RESPONSE_TOO_LARGE');
    chunks.push(chunk);
  }
  let document;
  try { document = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('DISCOVERY_RESPONSE_INVALID'); }
  const rows = Array.isArray(document) ? document : document?.data;
  if (!Array.isArray(rows)) throw failure('DISCOVERY_RESPONSE_INVALID');
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const id = typeof row === 'string' ? row : row?.id;
    if (typeof id !== 'string' || !id.trim() || id !== id.trim() || seen.has(id)) continue;
    seen.add(id);
    const model = { id };
    const name = row?.name ?? row?.display_name;
    if (typeof name === 'string' && name.trim()) model.name = name;
    models.push(model);
  }
  return models;
}
