import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSeedanceBoundaryFrames } from './storyboardSeedanceBoundaryFrames.js';
import { submitStoryboardSeedance } from './storyboardSeedanceSubmission.js';
const first = Buffer.from([255, 216, 255, 1]), last = Buffer.from([255, 216, 255, 2]), sha = (x: Buffer) => createHash('sha256').update(x).digest('hex');
const input = { tenantId: 'tenant', taskId: 'task', version: 65, runId: 'run', projectId: 'project', shotId: 'S04', projectShotFingerprint: 'a'.repeat(64), firstFrame: first, lastFrame: last, prompt: 'Forward only, sealed product, no added text.', transform: { kind: 'center_crop_scale' as const, scale: 1.02 as const, sourceSha256: sha(first), outputSha256: sha(last), width: 720 as const, height: 1280 as const }, model: 'doubao-seedance-2-0-fast-260128', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' };
test('exact boundary roles/bytes and all paid identity are captured without unsupported camera/seed controls', async () => {
    const built = buildSeedanceBoundaryFrames(input);
    let posts = 0;
    const order: string[] = [];
    const ports = { assertCurrent: async () => { order.push('current'); }, prepare: async () => { order.push('prepared'); }, accepted: async (id: string) => { assert.equal(id, 'accepted-original'); order.push('accepted'); }, request: async (_u: string, _k: string, init: RequestInit) => { posts++; const b = JSON.parse(String(init.body)); assert.deepEqual(b.content.map((x: any) => x.role).filter(Boolean), ['first_frame', 'last_frame']); assert.equal(b.content[1].image_url.url, `data:image/jpeg;base64,${first.toString('base64')}`); assert.equal(b.content[2].image_url.url, `data:image/jpeg;base64,${last.toString('base64')}`); assert.equal(b.generate_audio, false); assert.equal(b.duration, 4); assert.equal(b.resolution, '720p'); assert.equal(b.ratio, '9:16'); assert.equal('camera_fixed' in b, false); assert.equal('seed' in b, false); return { id: 'accepted-original' }; } };
    await submitStoryboardSeedance({ ...built.request, apiKey: 'controlled-test' }, ports);
    await submitStoryboardSeedance({ ...built.request, apiKey: 'controlled-test', existingTaskId: 'accepted-original' }, ports);
    assert.equal(posts, 1);
    assert.deepEqual(order, ['current', 'prepared', 'current', 'accepted', 'current']);
    await assert.rejects(submitStoryboardSeedance({ ...built.request, apiKey: 'controlled-test' }, { ...ports, prepare: async () => { throw Error('durable unknown original'); } }), /durable unknown/);
    assert.equal(posts, 1);
});
test('drifted last-frame/source/version/prompt cannot share quote identity', () => { const base = buildSeedanceBoundaryFrames(input); assert.notEqual(buildSeedanceBoundaryFrames({ ...input, version: 66 }).fingerprint, base.fingerprint); assert.notEqual(buildSeedanceBoundaryFrames({ ...input, prompt: 'Changed' }).fingerprint, base.fingerprint); assert.throws(() => buildSeedanceBoundaryFrames({ ...input, lastFrame: first }), /transform_evidence/); assert.throws(() => buildSeedanceBoundaryFrames({ ...input, transform: { ...input.transform, sourceSha256: 'b'.repeat(64) } }), /transform_evidence/); assert.throws(() => buildSeedanceBoundaryFrames({ ...input, model: 'unverified-new-model' }), /not_verified/); });
test('scope drift during durable preparation prevents supplier POST', async () => { const b = buildSeedanceBoundaryFrames(input); let assertions = 0, posts = 0; await assert.rejects(submitStoryboardSeedance({ ...b.request, apiKey: 'controlled-test' }, { assertCurrent: async () => { if (++assertions === 2)
        throw Error('scope changed after prepare'); }, prepare: async () => { }, accepted: async () => { throw Error('must not accept'); }, request: async () => { posts++; return { id: 'wrong' }; } }), /scope changed after prepare/); assert.equal(posts, 0); });
