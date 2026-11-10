const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
/** Owner-authenticated creation API. Host admission checks Host/Origin and cookie.
 * Rejects unknown actions/oversize payloads, emits fixed errors only. No logs.
 */
export function nativeOperationsHandler(operations, connection) {
  return async (req, res) => {
    const admission = connection.admit(req);
    if (!admission?.peer || admission.peer.principal?.kind !== 'owner') return reply(res, admission?.rejection || 403, { ok: false, error: { code: 'NATIVE_FORBIDDEN' } });
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: { code: 'NATIVE_METHOD' } });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return reply(res, 415, { ok: false, error: { code: 'NATIVE_CONTENT_TYPE' } });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 128 * 1024) return reply(res, 413, { ok: false, error: { code: 'NATIVE_TOO_LARGE' } });
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !['action', 'group', 'revision', 'fingerprint', 'confirmation'].includes(key))) throw new Error();
      if (body.action === 'preview') return reply(res, 200, { ok: true, value: await operations.preview(body.group) });
      if (body.action !== 'save' || body.confirmation !== 'CREATE NATIVE GROUP' || !Number.isSafeInteger(body.revision) || typeof body.fingerprint !== 'string') throw new Error();
      return reply(res, 200, { ok: true, value: await operations.save(body.group, body.revision, body.fingerprint) });
    } catch { return reply(res, 409, { ok: false, error: { code: 'NATIVE_SAVE_REFUSED' } }); }
  };
}
