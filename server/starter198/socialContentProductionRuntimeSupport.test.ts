import {SOCIAL_WORK_PACKAGE_KINDS} from '../../shared/contracts/socialContentWorkflow.js';
import {defaultBrief} from './socialContentTaskSupport.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_TASK_KEY } from './socialContentAutoProduction.js';
import { failExecution } from './socialContentProductionRuntimeSupport.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';

function repositoryFixture() {
  const rows = new Map<string, StarterRecord>([
    [`${STARTER_COLLECTIONS.socialContentTasks}:social`, {
      id: 'social',
      tenant_id: 'tenant',
      task_id: 'task',
      status: 'producing',
      version: '1',
    }],
    [`${STARTER_COLLECTIONS.tasks}:execution`, {
      id: 'execution',
      tenant_id: 'tenant',
      run_id: 'run',
      task_key: AUTO_TASK_KEY,
      status: 'running',
      output: {},
    }],
    [`${STARTER_COLLECTIONS.runs}:run`, {
      id: 'run',
      tenant_id: 'tenant',
      status: 'running',
    }],
  ]);
  const repository = {
    async list(collection: string, tenantId: string, query: { where?: Record<string, unknown> } = {}) {
      const items = [...rows.entries()]
        .filter(([key]) => key.startsWith(`${collection}:`))
        .map(([, row]) => row)
        .filter(row => row.tenant_id === tenantId)
        .filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value))
        .map(row => structuredClone(row));
      return { items, totalItems: items.length };
    },
    async get(collection: string, tenantId: string, id: string) {
      const row = rows.get(`${collection}:${id}`);
      return row?.tenant_id === tenantId ? structuredClone(row) : null;
    },
    async create() { throw new Error('unexpected_create'); },
    async update(collection: string, tenantId: string, id: string, patch: Record<string, unknown>) {
      const key = `${collection}:${id}`;
      const row = rows.get(key);
      if (!row || row.tenant_id !== tenantId) throw new Error('record_not_found');
      rows.set(key, { ...row, ...structuredClone(patch) });
    },
    async access() { throw new Error('unexpected_access'); },
  } as unknown as Starter198Repository;
  return { repository, rows };
}

test('production input exhaustion surfaces durable attention instead of a false resumable pause', async () => {
  const { repository, rows } = repositoryFixture();

  await failExecution({
    repository,
    tenantId: 'tenant',
    taskId: 'task',
    runId: 'run',
    userId: 'user',
    error: new Error('production_input_required:请补充一张产品正面图'),
  });

  const socialTask = rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!;
  const executionTask = rows.get(`${STARTER_COLLECTIONS.tasks}:execution`)!;
  const production = (executionTask.output as Record<string, unknown>).production as Record<string, unknown>;

  assert.equal(socialTask.status, 'attention');
  assert.equal(production.stage, 'waiting_for_user_input');
  assert.equal(production.message, '请补充一张产品正面图');
  assert.equal(executionTask.status, 'waiting_external');
});

test('durable worker block prefix preserves the action-required state and specific cause', async () => {
  const { repository, rows } = repositoryFixture();

  await failExecution({
    repository,
    tenantId: 'tenant',
    taskId: 'task',
    runId: 'run',
    userId: 'user',
    error: new Error('input_required:需要补充素材或人工修改:production_input_required:请补充产品标签稿'),
  });

  const socialTask = rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!;
  const executionTask = rows.get(`${STARTER_COLLECTIONS.tasks}:execution`)!;
  const production = (executionTask.output as Record<string, unknown>).production as Record<string, unknown>;

  assert.equal(socialTask.status, 'attention');
  assert.equal(production.stage, 'waiting_for_user_input');
  assert.equal(production.message, '需要补充素材或人工修改：请补充产品标签稿');
  assert.equal(production.failureClass, 'input_required');
});


test('a retained candidate cannot hide a required cache-finalization blocker',async()=>{
 for (const cacheError of [true,false]) {
  const {repository:baseRepository,rows}=repositoryFixture();
  const repository={...baseRepository,materialLibrary:async()=>({items:[]})} as unknown as Starter198Repository;
  Object.assign(rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!, {
    package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind})),
    brief:defaultBrief({title:'保留候选',objective:'恢复逐镜缓存',mode:'instant'} as any),
    created_at:'2026-10-23T00:00:00Z',updated_at:'2026-10-23T00:00:00Z',
    source_count:0,knowledge_source_count:0,material_source_count:0,artifact_count:1,
    approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,
  });
  rows.set(`${STARTER_COLLECTIONS.socialContentArtifacts}:artifact`,{id:'artifact',tenant_id:'tenant',task_id:'task',
    artifact_id:'candidate',artifact_kind:'short_video',origin:'agent',status:'review_required',version:'1',content:{}});
  assert.equal((await readSocialTaskDetail({repository,tenantId:'tenant',taskId:'task'}))!.artifacts.length,1);
  await failExecution({repository,tenantId:'tenant',taskId:'task',runId:'run',userId:'user',
    error:new Error(cacheError?'input_required:请处理:user_input_required:weekly_scene_cache_recovery_media_missing':'unrelated_late_worker_failure')});
  assert.equal(rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!.status,cacheError?'attention':'producing');
  assert.equal(rows.get(`${STARTER_COLLECTIONS.socialContentArtifacts}:artifact`)!.status,'review_required');
 }
});

test('budget overrun exposes a durable user decision and does not become an automatic retry',async()=>{
 for(const error of ['user_input_required:whole_film_budget_routing:mandatory_plan_exceeds_budget:16:15','input_required:需要决策:user_input_required:production_budget_decision_required:retry_total_exceeded']){
 const {repository,rows}=repositoryFixture();
 await failExecution({repository,tenantId:'tenant',taskId:'task',runId:'run',userId:'user',error:Error(error)});
 assert.equal(rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!.status,'attention');
 const task=rows.get(`${STARTER_COLLECTIONS.tasks}:execution`)!;
 const production=(task.output as any).production;
 assert.equal(production.stage,'budget_decision_required');assert.equal(task.status,'waiting_external');
 assert.match(production.message,/重试和修订，不含采集/);assert.match(production.message,/确认前不会继续付费/);
 }
});
