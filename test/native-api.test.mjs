import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { nativeOperationsHandler } from '../src/native-api.js';
const run = async (options = {}) => {
 const calls = [], req = Readable.from([options.text ?? JSON.stringify(options.body ?? { action: 'preview', group: {} })]);
 req.method = options.method ?? 'POST'; req.headers = { 'content-type': options.contentType ?? 'application/json' };
 let status, output;
 const res = { writeHead(s) { status = s; }, end(body) { output = JSON.parse(body); } };
 const handler = nativeOperationsHandler({ preview: async group => { calls.push(group); return { status: 'preview' }; }, save: async (...args) => { calls.push(args); return { status: 'saved' }; } },
 { admit: () => options.denied ? { rejection: 403 } : { peer: { principal: { kind: 'owner' } } } });
 await handler(req, res); return { status, output, calls };
};
test('native creation authenticates owner before reading or writing', async () => {
 const result = await run({ denied: true }); assert.equal(result.status, 403); assert.equal(result.calls.length, 0);
});
test('preview is distinct from explicitly confirmed save', async () => {
 assert.equal((await run()).output.value.status, 'preview');
 const body = { action: 'save', group: {}, revision: 1, fingerprint: 'fp' };
 assert.equal((await run({ body })).status, 409);
 const result = await run({ body: { ...body, confirmation: 'CREATE NATIVE GROUP' } });
 assert.equal(result.output.value.status, 'saved'); assert.deepEqual(result.calls[0], [{}, 1, 'fp']);
});
test('rejects unsupported methods/content and oversized malformed payload without writes', async () => {
 for (const [options, status] of [[{ method: 'GET' },405], [{ contentType: 'text/plain' },415], [{ text: 'x'.repeat(129*1024) },413], [{ text: 'bad' },409]]) {
  const result = await run(options); assert.equal(result.status, status); assert.equal(result.calls.length, 0);
 }
});
