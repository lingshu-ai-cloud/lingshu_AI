import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { fixture } from '../socialPrograms/weeklyContentTemplates.fixture.js';
import { createStarter198Repository } from './repository.js';
import { createSocialContentRouter } from './socialContentRouter.js';
import { issueLocalIdentityTokenForTest } from '../auth/localIdentity.js';
import { socialContentAssistantAction, socialContentAssistantReceipt } from './socialContentAssistantActions.js';
import { readSocialTaskDetail } from './socialContentRecords.js';
import type { SocialContentAccessResolver } from './socialContentAccess.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';

test('selected content quick actions preserve tenant, state, task and run identity', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
  const f = await fixture();
  const repository = createStarter198Repository(f.store);
  const row = f.tables.starter_social_content_tasks![0]!;
  row.status = 'producing'; row.version = '5';
  row.created_at='2026-10-01T00:00:00Z'; row.updated_at=row.created_at;
  row.brief=defaultBrief({title:'实际任务',objective:'制作产品内容'});
  row.package_selection=SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind}));
  for (const key of ['source_count','knowledge_source_count','material_source_count','artifact_count','approved_artifact_count','delivery_package_count','publication_count','metric_submission_count']) row[key]=0;
  f.tables.starter_social_content_artifacts=[];
  let enqueues = 0;
  const app = express(); app.use(express.json());
  app.use('/content', createSocialContentRouter({ repository,
    resolveRole: async () => 'owner',
    accessResolver: { resolve: async () => ({ kind: 'subscription', subscription: {status:'active',plan:'test',expiresAt:null} }) } as SocialContentAccessResolver,
    orchestratorQueue: { enqueue: async () => { enqueues++; throw new Error('must not enqueue again'); } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/content`;
  const request = (path: string, body?: unknown, tenantId = 't', key = 'assistant-test-request') => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      Authorization: `Bearer ${issueLocalIdentityTokenForTest({userId:'owner',tenantId})}`,
      'Content-Type':'application/json', 'Idempotency-Key':key,
    }, ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  try {
    assert.deepEqual(await (await request('/assistant-actions')).json(), {items:[]});
    const exactWorkspace = await request('/?taskId=content');
    assert.equal(exactWorkspace.status, 200);
    assert.equal((await exactWorkspace.json()).currentTask.taskId, 'content');
    assert.equal((await request('/?taskId=missing')).status, 404);
    assert.equal((await request('/?taskId=content', undefined, 'foreign')).status, 404);
    assert.deepEqual(await (await request('/tasks/content/execution-portal')).json(), { item: null }, 'a producing label without queue evidence is insufficient');
    row.orchestrator_item_id = 'actual-queue';
    row.brief = { ...(row.brief as Record<string, unknown>), _executionQueueReceipt: { disposition: 'queued', runId: 'run', queueItemId: 'actual-queue' } };
    const portal = await (await request('/tasks/content/execution-portal')).json();
    assert.equal(portal.item.taskId, 'content');
    assert.equal(portal.item.runId, 'run');
    assert.equal(portal.item.card.contentTaskId, 'content');
    assert.equal((await request('/tasks/content/execution-portal', undefined, 'foreign')).status, 404);
    assert.equal((await request('/assistant-actions/create', { title: 'forged', objective: 'x', _executionQueueReceipt: {} })).status, 400);
    const actions = await (await request('/assistant-actions?taskId=content')).json();
    assert.ok(actions.items, JSON.stringify(actions));
    assert.equal(actions.items[0].operation, 'open');
    assert.equal(actions.items[0].expectedVersion, '5');
    const duplicate = await request('/assistant-actions/content/start', {expectedVersion:'1'});
    assert.equal(duplicate.status, 200);
    const receipt = (await duplicate.json()).receipt;
    assert.equal(receipt.runId, 'run'); assert.equal(receipt.weeklyTaskId, 'social-content:content');
    assert.match(receipt.href, /socialContentTaskId=content/);
    assert.equal(enqueues, 0);
    assert.equal((await request('/assistant-actions?taskId=content', undefined, 'foreign')).status, 404);
    row.status = 'plan_review'; row.run_id = '';
    assert.equal((await request('/assistant-actions/content/start', {expectedVersion:'1'})).status, 409);
    assert.equal(enqueues, 0, 'stale input must fail before production');
    assert.equal((await request('/assistant-actions/create', {title:'新任务',objective:''})).status, 400);
    assert.equal((await request('/assistant-actions/create', {title:'缺截止时间的周任务',objective:'制作一条产品介绍',mode:'weekly'})).status, 400);
    const createInput = {title:'待补资料的单条内容',objective:'制作一条产品介绍',mode:'instant'};
    const createdResponse = await request('/assistant-actions/create', createInput, 't', 'create-blocked-once');
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.task.taskId);
    assert.equal(created.receipt.started, false);
    assert.equal(created.task.executionAdmission.state,'blocked');
    assert.equal(created.task.status,'attention');
    assert.ok(created.receipt.blockedReason, 'saved work must explain why production has not started');
    assert.equal(created.receipt.weeklyTaskId, `social-content:${created.task.taskId}`);
    assert.equal(created.task.mode, 'instant');
    assert.equal(created.task.brief.dueAt, null);
    assert.equal(created.receipt.card.contentTaskId, created.task.taskId);
    assert.equal(created.receipt.card.overallState, 'failed');
    const replay = await (await request('/assistant-actions/create', createInput, 't', 'create-blocked-once')).json();
    assert.equal(replay.task.taskId, created.task.taskId, 'a retried create must recover the original weekly task');
    assert.equal(f.tables.starter_social_content_tasks!.filter(item=>item.task_id===created.task.taskId).length, 1);
    assert.equal(enqueues, 0, 'incomplete new work must not be sent to production');
    const sourcedInput={...createInput,title:'带已选来源的任务',initialSource:{kind:'text_note',sourceRef:'已确认的创作备注',label:'已选输入'}};
    const sourced=await (await request('/assistant-actions/create',sourcedInput,'t','source-before-start')).json();
    assert.equal(sourced.task.sourceCount,1,'source is attached before admission checks');
    const sourcedReplay=await (await request('/assistant-actions/create',sourcedInput,'t','source-before-start')).json();
    assert.equal(sourcedReplay.task.taskId,sourced.task.taskId);assert.equal(sourcedReplay.task.sourceCount,1);
    assert.equal((await request('/assistant-actions/create',{...createInput,initialSource:{kind:'reference_link',sourceRef:'javascript:bad',label:'bad'}})).status,400);
    const task = await readSocialTaskDetail({repository,tenantId:'t',taskId:'content'}); assert.ok(task);
    assert.equal(socialContentAssistantReceipt({...task,status:'paused',runId:'run'}).started, false);
    assert.equal(socialContentAssistantReceipt({...task,status:'paused',runId:'run'}).card.overallState, 'paused');
    assert.equal(socialContentAssistantReceipt({...task,status:'delivered',runId:'run'}).started, false);
    assert.equal(socialContentAssistantReceipt({...task,status:'producing',runId:'run'},'missing_input').started, false);
    assert.equal(socialContentAssistantAction({...task,readiness:{complete:false,missing:['product']}},true).operation,'open');
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve())); await f.cleanup();
  }
});
