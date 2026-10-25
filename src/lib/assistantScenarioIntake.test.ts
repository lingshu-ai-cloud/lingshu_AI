import assert from 'node:assert/strict';
import test from 'node:test';
import {assistantScenarioIntake,scenarioTaskInputs} from './assistantScenarioIntake';
import {assistantCreationPortalSchema} from '../../shared/contracts/assistantCreationPortal';
import {assistantHomePromptById} from './assistantHomeQuickPrompts';

test('all three approved prompts resolve to distinct persisted scenes without task mutation',()=>{
  for(const [id,scenario] of [['CO-HOOK','hook_first'],['CO-CAMPAIGN','campaign'],['OP-CALENDAR','weekly_calendar']]){
    const portal=assistantScenarioIntake(assistantHomePromptById(id)!.prompt)!;
    assert.equal(portal.scenario,scenario);assert.equal(portal.confirmedTaskId,undefined);
    assert.deepEqual(assistantCreationPortalSchema.parse(portal),portal);
  }
  assert.equal(assistantScenarioIntake('不要为活动准备内容'),null);
  assert.equal(assistantScenarioIntake('如何选定一个开场'),null);
});
test('hook constraints and all selected products survive task preparation; invalid clip cannot be confirmed',()=>{
  const portal={...assistantScenarioIntake('先选一个开场')!,selectedProducts:[{id:'a',name:'产品甲'},{id:'b',name:'产品乙'}],hook:{materialId:'own-1',name:'视频',startSeconds:1,endSeconds:3,duration:10,usage:'reference_only' as const},direction:'用真实使用场景接到产品',plannedPublishAt:'2099-01-01T12:00'};
  const input=scenarioTaskInputs(portal)[0].input;
  assert.equal(input.productId,undefined);
  const saved=JSON.parse(input.specialRequirements!);
  assert.deepEqual(saved.hook,portal.hook);assert.equal(saved.products.length,2);
  assert.equal(saved.plannedPublishAt,'2099-01-01T04:00:00.000Z');
  assert.throws(()=>scenarioTaskInputs({...portal,hook:{...portal.hook,endSeconds:11}}));
});
test('activity rows keep stable independent identities and one group; partial retry retains identical inputs',()=>{
  const portal={...assistantScenarioIntake('为活动准备内容')!,selectedProducts:[{id:'a',name:'产品甲'}],campaign:{name:'新品活动',type:'新品发布',objective:'获取询盘',startsAt:'2099-01-02T09:00',endsAt:'2099-01-03T09:00',items:[{id:'a',phase:'warmup' as const,title:'预热',publishAt:'2099-01-01T12:00'},{id:'b',phase:'launch' as const,title:'主推',publishAt:'2099-01-02T12:00'}]}};
  const rows=scenarioTaskInputs(portal);
  assert.deepEqual(rows.map(row=>row.id),['a','b']);
  assert.deepEqual(rows,scenarioTaskInputs({...portal,submissionLocked:true,createdTasks:[{itemId:'a',taskId:'saved-1',title:'预热'}]}));
  assert.ok(rows.every(row=>JSON.parse(row.input.specialRequirements!).groupId===portal.id));
  assert.throws(()=>scenarioTaskInputs({...portal,campaign:{...portal.campaign,endsAt:'2098-12-31T12:00'}}));
});

test('manual plan entry and home task request use the same single-content contract',()=>{
  const manual=assistantScenarioIntake('帮我创建一条新的创作计划')!,home=assistantScenarioIntake('创建一条新内容任务')!;
  assert.equal(manual.scenario,'content_task');assert.equal(home.scenario,'content_task');
  const fields={selectedProducts:[{id:'p1',name:'产品甲'}],direction:'展示产品的真实使用过程',plannedPublishAt:'2099-01-01T12:00'};
  const a=scenarioTaskInputs({...manual,...fields})[0].input,b=scenarioTaskInputs({...home,id:manual.id,...fields})[0].input;
  assert.deepEqual(a,b);assert.equal(a.objective,fields.direction);assert.equal(a.creationMode,'material_processing');
  assert.throws(()=>scenarioTaskInputs(manual),/产品/);
});
