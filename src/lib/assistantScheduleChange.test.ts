import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow';
import type { CreationTaskRow } from './creationTaskWorkspace';
import { assistantSchedulePreview, assistantScheduleTarget, assistantTaskScheduleChanges } from './assistantScheduleChange';

const original={source:'assistant_scene_confirmation',scenario:'campaign',groupId:'group',plannedPublishAt:'2099-01-05T10:00:00.000Z',products:[{id:'product',name:'产品'}]};
const row={key:'task:one',taskId:'one',title:'活动内容',cover:'',category:'creating',statusLabel:'待调度',sourceLabel:'对话创建',product:'产品',publishAt:original.plannedPublishAt,createdAt:'',updatedAt:'',summary:{taskId:'one',version:'v2',status:'draft',runId:null,publicationCount:0,brief:{specialRequirements:JSON.stringify(original),dueAt:'2099-01-04T10:00:00.000Z'}} as SocialContentTaskSummary} satisfies CreationTaskRow;

test('assistant task schedule uses the original versioned task update and keeps scene identity',()=>{
  const target=assistantScheduleTarget(row,'');
  assert.equal(target?.kind,'task');
  if(target?.kind!=='task')return;
  const preview=assistantSchedulePreview(row,'2099-01-06T18:00',[row]);
  assert.equal(preview.instant,'2099-01-06T10:00:00.000Z');
  const update=assistantTaskScheduleChanges(target,preview.instant);
  assert.equal(update.expectedVersion,'v2');
  assert.deepEqual(JSON.parse(update.changes.specialRequirements),{...original,plannedPublishAt:preview.instant});
  assert.equal(assistantScheduleTarget({...row,summary:{...row.summary,runId:'running'}},''),null);
  assert.throws(()=>assistantSchedulePreview(row,'2099-01-03T18:00',[row]),/早于原定成片交付/);
});

test('weekly schedule chooses the existing weekly owner and previews account impact',()=>{
  const weekly={...row,key:'weekly:content',taskId:undefined,contentId:'content',publishAt:'2099-01-05T10:00:00.000Z',weekly:{origin:'weekly_plan',accountId:'account',contentPlan:{deliverBy:'2099-01-04T00:00:00.000Z'}}} as CreationTaskRow;
  const nearby={...weekly,key:'weekly:other',contentId:'other',publishAt:'2099-01-06T11:00:00.000Z'};
  assert.deepEqual(assistantScheduleTarget(weekly,'goal'),{kind:'weekly',goalId:'goal',contentId:'content'});
  const preview=assistantSchedulePreview(weekly,'2099-01-06T18:00',[weekly,nearby],{startsAt:'2099-01-05',endsAt:'2099-01-11'});
  assert.deepEqual(preview.sameAccount.map(item=>item.contentId),['other']);
  assert.throws(()=>assistantSchedulePreview(weekly,'2099-01-12T18:00',[weekly],{startsAt:'2099-01-05',endsAt:'2099-01-11'}),/周任务发布时间/);
});
