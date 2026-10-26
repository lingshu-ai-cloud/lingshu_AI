import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSocialImageTask } from '../../server/socialImage/socialImageTask';
import type { CreateSocialContentTaskInput, SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { createImageReplicationDraft, imageReplicationDraftIssue, type ImageReplicationDraft } from './imageReplicationDraft';

const draft: ImageReplicationDraft = {
  reference: { url: '/api/overseas/videos/ref-1/image/0', title: '参考图', caption: '参考配文',
    sourceRecordId: 'ref-1', sourceUrl: 'https://www.instagram.com/p/ABC/', collectedAt: '2026-10-25T00:00:00Z' },
  product: { id: 'product-1', name: '企业产品' }, objective: '突出已确认的产品卖点', audience: '品牌采购',
  platform: 'instagram', aspectRatio: '4:5', language: 'en', callToAction: '申请样品',
};

test('replication creates one canonical content task and one image run without treating the reference as an owned product', async () => {
  const calls: string[] = [];
  const input = { draft, operationKey: 'confirmed-draft', entrySource: 'assistant' as const, isCurrent: () => true,
    ports: {
      createTask: async (value: CreateSocialContentTaskInput, key: string) => {
        calls.push(key); assert.deepEqual(value.formats, ['social_image']); assert.equal(value.productId, 'product-1');
        assert.equal(value.creationMode, 'viral_replication'); assert.equal(value.requestedOutputCount, 1);
        assert.equal(value.targetDurationSeconds, undefined); assert.equal(value.callToAction, '申请样品');
        return { taskId: 'content-1', version: 'v1' } as SocialContentTaskDetail;
      },
      createOrResumeRun: async (id: string, value: { idempotencyKey: string; expectedContentTaskVersion: string }) => {
        calls.push(value.idempotencyKey); assert.equal(id, 'content-1'); assert.equal(value.expectedContentTaskVersion, 'v1');
        return { task: { ...defaultSocialImageTask({ productRefs: ['product-1'], creationPath: 'viral_replication' }), id: 'image-1' } };
      },
      updateTask: async (task: ReturnType<typeof defaultSocialImageTask>, patch: Partial<ReturnType<typeof defaultSocialImageTask>>) => {
        calls.push('reference'); assert.equal(patch.materialIds, undefined); assert.equal(patch.enterpriseAssets, undefined);
        assert.deepEqual(patch.referenceSnapshot?.imageUrls, [draft.reference.url]);
        assert.equal(patch.referenceSnapshot?.sourceRecordId, 'ref-1');
        assert.equal(patch.referenceSnapshot?.sourceUrl, draft.reference.sourceUrl);
        assert.equal(patch.referenceSnapshot?.collectedAt, draft.reference.collectedAt);
        assert.equal(patch.referenceSnapshot?.caption, '参考配文'); return { task: { ...task, ...patch } };
      },
    } };
  const result = await createImageReplicationDraft(input);
  assert.equal(result.id, 'image-1'); assert.deepEqual(calls, ['confirmed-draft:content', 'confirmed-draft:run', 'reference']);
});

test('a transport failure retries the same keys and resumes an already configured run without overwriting production', async () => {
  const contentKeys: string[] = [], runKeys: string[] = [];
  let updates = 0;
  let stored = { ...defaultSocialImageTask({ creationPath: 'viral_replication' }), id: 'image-1' };
  const input = { draft, operationKey: 'stable', entrySource: 'workspace' as const, isCurrent: () => true,
    ports: {
      createTask: async (_: unknown, key: string) => { contentKeys.push(key); return { taskId: 'content-1', version: 'v1' } as SocialContentTaskDetail; },
      createOrResumeRun: async (_: string, value: { idempotencyKey: string }) => { runKeys.push(value.idempotencyKey); return { task: stored }; },
      updateTask: async (task: typeof stored, patch: Partial<typeof stored>) => { updates++; stored = { ...task, ...patch }; throw new Error('response lost'); },
    } };
  await assert.rejects(createImageReplicationDraft(input), /response lost/);
  const result = await createImageReplicationDraft(input);
  assert.equal(result.referenceSnapshot?.imageUrls[0], draft.reference.url);
  assert.deepEqual(contentKeys, ['stable:content', 'stable:content']); assert.deepEqual(runKeys, ['stable:run', 'stable:run']);
  assert.equal(updates, 1);
});

test('invalid inputs and session changes stop subsequent writes', async () => {
  assert.match(imageReplicationDraftIssue({ ...draft, reference: { url: '', title: '' } })!, /参考图/);
  assert.match(imageReplicationDraftIssue({ ...draft, objective: '' })!, /核心卖点/);
  let current = true, calls = 0;
  await assert.rejects(createImageReplicationDraft({ draft, operationKey: 'scope', entrySource: 'assistant', isCurrent: () => current,
    ports: {
      createTask: async () => { calls++; current = false; return { taskId: 'saved-before-logout', version: 'v1' } as SocialContentTaskDetail; },
      createOrResumeRun: async () => { throw new Error('must not create another run after logout'); },
      updateTask: async () => { throw new Error('must not update'); },
    } }), /登录状态/);
  assert.equal(calls, 1);
});
