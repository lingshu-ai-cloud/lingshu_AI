import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow';
import type { ContentQueueItem } from './digitalEmployees';
import { creationTaskRows, creationTaskState, creationTaskCalendar, creationTaskDetailSource } from './creationTaskWorkspace';

const task={taskId:'t1',status:'draft',runId:null,version:'1',createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',
  brief:{title:'新内容',productRef:null,languages:[],formats:[],platforms:[],specialRequirements:JSON.stringify({source:'assistant_replication_confirmation',referenceId:'ref-1',plannedPublishAt:'2026-10-29T04:00:00.000Z',products:[{id:'p1',name:'产品甲'},{id:'p2',name:'产品乙'}]})},
  readiness:{complete:false,missing:['material']},artifactCount:0,approvedArtifactCount:0,sourceCount:0,
} as unknown as SocialContentTaskSummary;
const weekly={id:'w1',contentId:'c1',socialContentTaskId:'t1',origin:'manual',title:'汇总旧标题',productName:'产品甲',status:'planned',plannedPublishDate:'2026-10-17',updatedAt:'2026-10-25T00:00:00Z'} as ContentQueueItem;
test('deduplicate only canonical task IDs; original intake date wins over derived old-week date',()=>{
  const rows=creationTaskRows([task],[weekly,{...weekly,id:'w2',contentId:'c2',socialContentTaskId:'',origin:'weekly_plan'}]);
  assert.equal(rows.length,2);assert.equal(rows[0].taskId,'t1');
  assert.equal(rows[0].publishAt,'2026-10-29T04:00:00.000Z');assert.equal(rows[0].product,'产品甲、产品乙');
  assert.equal(rows[0].sourceLabel,'对话创建');assert.equal(rows[0].contentId,'c1');
  assert.equal(rows[1].sourceLabel,'周任务包');assert.notEqual(rows[0].key,rows[1].key);
  const unrelated={...task,taskId:'t2',createdAt:'2026-10-27T00:00:00Z'};
  assert.deepEqual(creationTaskRows([task,unrelated],[weekly]).map(row=>row.taskId),['t2','t1']);
});
test('only real execution blockers and reviews need confirmation; saved draft preflight stays private',()=>{
  assert.deepEqual(creationTaskState(task),{category:'creating',statusLabel:'待调度'});
  for(const status of ['needs_input','plan_review','asset_review','paused','attention'] as const)assert.equal(creationTaskState({...task,status,runId:'r1'}).category,'confirmation');
  for(const status of ['delivered','awaiting_publish','awaiting_metrics','reviewed'] as const)assert.equal(creationTaskState({...task,status}).category,'completed');
  assert.equal(creationTaskState({...task,status:'producing',runId:'r1',readiness:{complete:true,missing:[]}}).statusLabel,'创作中');
});
test('completed tasks lead the default queue without changing newest-first order within each group',()=>{
  const newer={...task,taskId:'newer',createdAt:'2026-10-28T00:00:00Z'};
  const completed={...task,taskId:'completed',status:'delivered' as const,createdAt:'2026-10-25T00:00:00Z'};
  assert.deepEqual(creationTaskRows([task,newer,completed],[]).map(row=>row.taskId),['completed','newer','t1']);
});
test('calendar and task table share identity, omit undated tasks and preserve date-only entries',()=>{
  const rows=creationTaskRows([task],[{...weekly,socialContentTaskId:'',origin:'weekly_plan'},{...weekly,id:'w3',contentId:'c3',socialContentTaskId:'',plannedPublishDate:''}]);
  const events=creationTaskCalendar(rows);
  assert.equal(events.length,2);assert.equal(events[0].id,rows[0].key);assert.equal(events[0].start,'2026-10-29T04:00:00.000Z');
  assert.equal(events[1].allDay,true);assert.equal(events[1].start,'2026-10-17');
  assert.ok(events.every(event=>event.editable===false));assert.ok(events.every(event=>!event.statusLabel?.includes('已发布')));
});
test('pending rows use exact product photos; a real output cover replaces the fallback on refresh',()=>{
  const products=[{id:'p1',name:'产品甲',imageUrls:['/product-a.jpg']},{id:'p2',name:'产品乙',imageUrls:['/product-b.jpg']},{id:'unrelated',name:'无关',imageUrls:['/wrong.jpg']}];
  const pending=creationTaskRows([task],[],products)[0];
  assert.equal(pending.cover,'/product-a.jpg');assert.deepEqual(pending.productImages,['/product-a.jpg','/product-b.jpg']);
  const ready=creationTaskRows([{...task,preview:{coverUrl:'/api/real-output-cover',sourceStatus:'available'}}],[],products)[0];
  assert.equal(ready.cover,'/api/real-output-cover');assert.deepEqual(ready.productImages,pending.productImages);
  assert.equal(creationTaskRows([task],[],[{id:'unrelated',name:'产品甲',imageUrls:['/wrong.jpg']}])[0].cover,'','known product ID never falls back to a similarly named product');
});
test('unreadable historic records remain separate pending-confirmation rows',()=>{
  const rows=creationTaskRows([task],[],[],[{taskId:'invalid-task',title:'历史记录',createdAt:'2026-10-20T00:00:00Z',errorCode:'social_content_task_record_invalid'}]);
  assert.equal(rows.length,2);assert.equal(rows[1].category,'confirmation');assert.equal(rows[1].readError,'social_content_task_record_invalid');
  assert.equal(rows[1].summary,undefined);assert.equal(creationTaskCalendar(rows).length,1);
});
test('a failed exact-task read cannot show a weekly quality blocker as the task result',()=>{
  const row=creationTaskRows([task],[weekly])[0];
  assert.equal(creationTaskDetailSource(row,null),'unavailable');
  assert.equal(creationTaskDetailSource(row,{taskId:'another-task'}),'unavailable');
  assert.equal(creationTaskDetailSource(row,{taskId:task.taskId}),'task');
  assert.equal(creationTaskDetailSource({...row,taskId:undefined},null),'weekly');
  assert.equal(creationTaskDetailSource({...row,readError:'invalid'},null),'unavailable');
});
