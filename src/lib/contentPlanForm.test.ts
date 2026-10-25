import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow';
import { contentPlanFormInput } from './contentPlanForm';
import { creationTaskRows, creationTaskCalendar } from './creationTaskWorkspace';
const products=[{id:'a',name:'产品甲'},{id:'b',name:'产品乙'}];
const values={title:' 新计划 ',productIds:['a','b'],direction:'展示产品使用场景',publishAt:'2099-01-02T12:30'};
test('manual form preserves multiple products and shares the task/calendar contract',()=>{
  const input=contentPlanFormInput(values,products,'plan-1');
  assert.equal(input.title,'新计划');assert.equal(input.productId,undefined);assert.equal(input.requestedOutputCount,1);
  const saved=JSON.parse(input.specialRequirements!);
  assert.equal(saved.channel,'workspace_form');assert.deepEqual(saved.products,products);
  assert.equal(saved.plannedPublishAt,'2099-01-02T04:30:00.000Z');
  const task={taskId:'created',version:'1',status:'draft',runId:null,createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',brief:input,readiness:{complete:false,missing:[]},artifactCount:0,approvedArtifactCount:0,sourceCount:0} as unknown as SocialContentTaskSummary;
  const rows=creationTaskRows([task],[]);
  assert.equal(rows[0].sourceLabel,'手动创建');assert.equal(creationTaskCalendar(rows)[0].start,saved.plannedPublishAt);
  assert.equal(contentPlanFormInput({...values,productIds:['b']},products,'plan-1').productId,'b');
});
test('manual form rejects stale products, missing direction and expired publication time',()=>{
  assert.throws(()=>contentPlanFormInput({...values,productIds:['missing']},products,'plan-1'),/已变更/);
  assert.throws(()=>contentPlanFormInput({...values,direction:' '},products,'plan-1'),/创作方向/);
  assert.throws(()=>contentPlanFormInput({...values,publishAt:'2000-01-01T12:30'},products,'plan-1'),/未来时间/);
});
