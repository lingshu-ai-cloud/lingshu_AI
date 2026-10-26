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

test('each batch draft confirms selected materials before its receipt; retry resumes incomplete source association', async () => {
  const { syncPlanningTaskMaterials } = await import('./socialContentPlanningTask');
  const keys = new Map<string, string>(), completed = new Map<string, string>();
  const saved = new Map<string, SocialContentTaskDetail>(), acknowledged: string[] = [];
  let failLink = true;
  const api = {
    updateTask: async (taskId: string, input: import('../../shared/contracts/socialContentWorkflow').UpdateSocialContentTaskInput) => {
      const task = saved.get(taskId)!;
      const updated = { ...task, brief: { ...task.brief, ...input.changes } } as SocialContentTaskDetail;
      saved.set(taskId, updated); return updated;
    },
    removeSource: async () => assert.fail('new batch has no sources to remove'),
    addSource: async (taskId: string, source: Parameters<typeof import('./socialContentApi').socialContentApi.addSource>[1]) => {
      if (taskId.endsWith('2:create') && failLink) throw Error('source result unknown');
      const task = saved.get(taskId)!;
      const linked = { ...task, sources: [...task.sources, { ...source, status: 'active', sourceId: `${taskId}:material` }] } as SocialContentTaskDetail;
      saved.set(taskId, linked); return { source: linked.sources[0], task: linked };
    },
  };
  const run = () => createPlanningDraftBatch({ seed: { requestId: 3, title: '组合产品', productId: 'a', productIds: ['a', 'b'], creationPath: 'material_processing', uploadedMaterialCount: 1 }, count: 3,
    keys, completed, isCurrent: () => true,
    create: async (value, key) => {
      assert.deepEqual(value.productIds, ['a', 'b']);
      if (!saved.has(key)) saved.set(key, { taskId: key, version: '1', sources: [], brief: { ...value, assetAvailability: 'none' } } as unknown as SocialContentTaskDetail);
      return syncPlanningTaskMaterials({ task: saved.get(key)!, materials: [{ id: 'material-b', type: 'image' }], operationKey: key, isCurrent: () => true, api });
    }, read: async id => saved.get(id)!, onResult: task => { assert.equal(task.sources.length, 1); assert.equal(task.brief.assetAvailability, 'ready'); acknowledged.push(task.taskId); } });
  await assert.rejects(run(), /1\/3条内容草稿/);
  assert.equal(saved.size, 2); assert.equal(completed.size, 1, 'unlinked draft is not acknowledged as prepared');
  assert.equal([...saved.values()][1].brief.assetAvailability, 'none', 'failed source association remains unprepared');
  failLink = false; await run();
  assert.equal(saved.size, 3); assert.equal(completed.size, 3); assert.equal(acknowledged.length, 3);
  assert.ok([...saved.values()].every(task => task.sources.length === 1));
});


test('batch retries reject changed selection even when some drafts already completed', async () => {
  const keys = new Map<string, string>(), completed = new Map<string, string>();
  let creates = 0;
  const seed = { requestId: 9, title: '保留原请求', creationPath: 'material_processing' as const, uploadedMaterialCount: 1 };
  const base = { seed, count: 2, keys, completed, isCurrent: () => true,
    create: async (_value: unknown, key: string) => { creates++; if (creates === 2) throw Error('unknown'); return { taskId: key } as SocialContentTaskDetail; },
    read: async (id: string) => ({ taskId: id } as SocialContentTaskDetail), onResult: () => {} };
  await assert.rejects(createPlanningDraftBatch({ ...base, selectionKey: '["material-a"]' }), /1\/2条/);
  await assert.rejects(createPlanningDraftBatch({ ...base, selectionKey: '["material-b"]' }), /产品或素材选择已变化/);
  assert.equal(creates, 2, 'changed batch cannot silently skip completed choices or create remaining drafts with another selection');
});
