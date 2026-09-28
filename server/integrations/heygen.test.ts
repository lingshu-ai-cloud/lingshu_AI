import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeHeygenOutputUrl, submitHeygenVideo, listHeygenAvatars, downloadHeygenOutput } from './heygen.js';
const fetchBefore = globalThis.fetch;
const keyBefore = process.env.HEYGEN_API_KEY;
const privateAvatarsBefore = process.env.HEYGEN_PRIVATE_AVATARS_ENABLED;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-test-'));
const audioPath = path.join(dir, 'voice.wav'); fs.writeFileSync(audioPath, Buffer.alloc(1024));
const calls: Array<{ url: string; options?: RequestInit }> = [];
try {
 process.env.HEYGEN_API_KEY = 'test-only';
 process.env.HEYGEN_PRIVATE_AVATARS_ENABLED = 'true';
 globalThis.fetch = (async (url: any, options?: RequestInit) => {
   calls.push({ url: String(url), options });
   if (String(url).includes('/avatars/looks?ownership=private')) return Response.json({ data: [{ id: 'private-avatar', name: 'Account presenter', status: 'completed', avatar_type: 'digital_twin', default_voice_id: 'voice-private' }], has_more: false });
   if (String(url).includes('/avatars/looks?ownership=public')) return Response.json({ data: [{ id: 'public-avatar', name: 'Preset presenter' }], has_more: false });
   if (String(url).endsWith('/assets')) return Response.json({ data: { asset_id: 'audio-asset' } });
   if (String(url).endsWith('/videos')) return Response.json({ data: { video_id: 'video-id', status: 'waiting' } });
   return new Response(Buffer.alloc(11000));
 }) as typeof fetch;
 const avatars = await listHeygenAvatars();
 assert.deepEqual(avatars.map(item => ({ id: item.id, ownership: item.ownership })), [
   { id: 'private-avatar', ownership: 'private' },
   { id: 'public-avatar', ownership: 'public' },
 ]);
 assert.equal(avatars[0].defaultVoiceId, 'voice-private');
 assert.ok(calls.some(call => call.url.includes('ownership=private')), 'account-owned avatars are requested');
 process.env.HEYGEN_PRIVATE_AVATARS_ENABLED = 'false';
 assert.deepEqual((await listHeygenAvatars()).map(item => item.id), ['public-avatar'], 'private inventory stays hidden unless explicitly enabled');
 assert.equal(await submitHeygenVideo({ id: 'job-1', avatarId: 'avatar', audioPath, title: 'Test' }), 'video-id');
 const submit = calls.find(call => call.url.endsWith('/videos'))!;
 assert.deepEqual(JSON.parse(String(submit.options?.body)), { type: 'avatar', avatar_id: 'avatar', audio_asset_id: 'audio-asset', title: 'Test', aspect_ratio: '9:16', fit: 'cover', output_format: 'mp4', caption: { file_format: 'srt' } });
 assert.equal(new Headers(submit.options?.headers).get('Idempotency-Key'), 'video:job-1');
 await downloadHeygenOutput('https://files.heygen.ai/video/test.mp4');
 assert.equal(new Headers(calls.at(-1)?.options?.headers).get('x-api-key'), null, 'media downloads never carry API credentials');
 assert.equal(safeHeygenOutputUrl('https://heygen.ai.evil.test/a'), '');
 assert.equal(safeHeygenOutputUrl('http://127.0.0.1/a'), '');
 await assert.rejects(downloadHeygenOutput('https://evil.test/a'));
 console.log('HeyGen v3 upload, request, idempotency and output isolation tests passed');
} finally {
 globalThis.fetch = fetchBefore;
 if (keyBefore === undefined) delete process.env.HEYGEN_API_KEY; else process.env.HEYGEN_API_KEY = keyBefore;
 if (privateAvatarsBefore === undefined) delete process.env.HEYGEN_PRIVATE_AVATARS_ENABLED; else process.env.HEYGEN_PRIVATE_AVATARS_ENABLED = privateAvatarsBefore;
 fs.rmSync(dir, { recursive: true, force: true });
}

const { parseHeygenSubtitles } = await import('./heygen.js');
assert.deepEqual(parseHeygenSubtitles('1\n00:00:00,200 --> 00:00:01,400\nHello world.\n', 2, 'Hello world.'), [{ start: 0.2, end: 1.4, text: 'Hello world.' }]);
assert.throws(() => parseHeygenSubtitles('1\n00:00:00,200 --> 00:00:01,400\nDifferent claim.\n', 2, 'Hello world.'));
assert.throws(() => parseHeygenSubtitles('1\n00:00:00,200 --> 00:00:10,400\nHello world.\n', 2, 'Hello world.'));

assert.equal(parseHeygenSubtitles("1\n00:00:00,200 --> 00:00:01,400\nyou're considering.\n", 2, 'you are considering.')[0].text, 'you are considering.');
