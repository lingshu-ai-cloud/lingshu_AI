import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { collectVerifiedVideo, MAX_META_VIDEO_BYTES, MetaVideoUploadAdapter } from './metaVideoUpload.js';
const bytes = new Uint8Array([1, 2, 3]);
const sha = createHash('sha256').update(bytes).digest('hex');
async function* source() { yield bytes; }
test('bounded input rejects oversized, truncated and changed media', async () => {
  assert.deepEqual(await collectVerifiedVideo(source(), 3, sha), bytes);
  await assert.rejects(collectVerifiedVideo(source(), MAX_META_VIDEO_BYTES + 1, sha));
  await assert.rejects(collectVerifiedVideo(source(), 2, sha));
  await assert.rejects(collectVerifiedVideo(source(), 4, sha));
  await assert.rejects(collectVerifiedVideo(source(), 3, '0'.repeat(64)));
});
test('multipart upload fences write and returns only validated video id', async () => {
  process.env.META_ADS_API_VERSION = 'v23.0';
  let fenced = false;
  const adapter = new MetaVideoUploadAdapter('secret', (async (url, options) => {
    assert.ok(fenced); assert.equal(String(url), 'https://graph.facebook.com/v23.0/act_123/advideos');
    assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    const form = options?.body as FormData;
    assert.equal((form.get('source') as Blob).size, 3);
    assert.equal(form.get('file_url'), null);
    return Response.json({ id: '999' });
  }) as typeof fetch, async () => { fenced = true; });
  assert.equal(await adapter.upload('123', bytes), '999');
});
test('network and malformed successful responses remain uncertain', async () => {
  for (const transport of [async () => { throw new Error('secret'); }, async () => Response.json({ success: true })]) {
    await assert.rejects(new MetaVideoUploadAdapter('secret', transport as typeof fetch).upload('123', bytes), (e: any) => e.uncertain === true && !e.message.includes('secret'));
  }
});
test('processing and unknown status must never be considered ready', async () => {
  for (const [raw, expected] of [['processing', 'processing'], ['ready', 'ready'], ['error', 'failed'], ['finished', 'unknown']]) {
    const adapter = new MetaVideoUploadAdapter('secret', (async () => Response.json({ id: '999', status: { video_status: raw } })) as typeof fetch);
    assert.equal(await adapter.status('999'), expected);
  }
});
