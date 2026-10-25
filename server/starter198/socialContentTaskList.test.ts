import assert from 'node:assert/strict';
import test from 'node:test';
import type { Starter198Repository, StarterRecord } from './repository.js';
import { STARTER_COLLECTIONS } from './repository.js';
import { listSocialContentTasks } from './socialContentTaskQueries.js';
import { socialTaskPage } from '../../src/lib/socialContentResponse.js';
const valid:StarterRecord={id:'row-good',tenant_id:'tenant',task_id:'good',status:'draft',version:'1',created_at:'2026-10-26T00:00:00Z',updated_at:'2026-10-26T00:00:00Z',source_count:0,knowledge_source_count:0,material_source_count:0,artifact_count:0,approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,brief:{title:'正常任务',objective:'内容创作',markets:[],languages:[],platforms:[],formats:[],restrictions:[]},package_selection:['industry_launch','content_rocket','task_express'].map(kind=>({kind,packageKey:kind,version:'1',name:kind}))};
test('one incomplete historical task cannot hide valid tasks or disappear as an empty success',async()=>{
  const bad={...valid,id:'row-bad',task_id:'bad',brief:{title:'旧记录',objective:'内容创作'}};
  const repository={list:async(collection:string)=>({items:collection===STARTER_COLLECTIONS.socialContentTasks?[valid,bad]:[],page:1,perPage:100,totalItems:2,totalPages:1})} as unknown as Starter198Repository;
  const result=await listSocialContentTasks({repository,tenantId:'tenant',perPage:100});
  assert.deepEqual(result.items.map(task=>task.taskId),['good']);
  assert.deepEqual(result.unavailableItems?.map(task=>task.taskId),['bad']);
  assert.equal(result.unavailableItems?.[0].errorCode,'social_content_task_record_invalid');
  assert.equal(socialTaskPage(result).totalItems,2);
});
test('storage failures still fail the read; they are not converted into an empty task list',async()=>{
  const repository={list:async()=>{throw Error('storage_unavailable');}} as unknown as Starter198Repository;
  await assert.rejects(listSocialContentTasks({repository,tenantId:'tenant'}),/storage_unavailable/);
});
