import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanningDraftBatch } from './socialContentPlanningBatch';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';

test('multi-video intent creates distinct existing single-content drafts; partial retry keeps each operation identity', async () => {
  const keys = new Map<string, string>(), completed = new Map<string, string>(), receipts: SocialContentTaskDetail[] = [];
  const calls: Array<{ key: string; count: number | null | undefined }> = [];
  let failSecond = true;
  const run = () => createPlanningDraftBatch({ seed: { requestId: 1, draftProjectId: 'project-qa', title: '验收视频', creationPath: 'material_processing', uploadedMaterialCount: 0 }, count: 3,
    keys, completed, isCurrent: () => true,
    create: async (value, key) => {
      calls.push({ key, count: value.requestedOutputCount });
      if (calls.length === 2 && failSecond) throw Error('unknown network result');
      return { taskId: key, status: 'draft', brief: { requestedOutputCount: 1, title: value.title } } as SocialContentTaskDetail;
    }, read: async taskId => receipts.find(row => row.taskId === taskId)!, onResult: result => receipts.push(result) });
  await assert.rejects(run(), /1\/3条内容草稿/);
  failSecond = false;
  const first = await run();
  assert.equal(completed.size, 3); assert.equal(receipts.length, 3); assert.equal(first?.taskId, receipts[0].taskId);
  assert.equal(calls[1].key, calls[2].key); assert.equal(calls.filter(call => call.key === calls[0].key).length, 1);
  assert.ok(calls.every(call => call.count === 1));
});

test('scope change stops draft batch before creating another tenant/user task', async () => {
  let current = true, creates = 0;
  const result = await createPlanningDraftBatch({ seed: { requestId: 1, title: '验收', creationPath: 'material_processing', uploadedMaterialCount: 0 }, count: 3,
    keys: new Map(), completed: new Map(), isCurrent: () => current,
    create: async () => { creates++; current = false; return { taskId: 'one' } as SocialContentTaskDetail; },
    read: async () => assert.fail('must not read after scope changes'), onResult: () => assert.fail('must not display stale receipt') });
  assert.equal(result, null); assert.equal(creates, 1);
});
