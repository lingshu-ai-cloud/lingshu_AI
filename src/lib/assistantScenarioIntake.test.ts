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
test('guided scenes cannot enter the ordinary task-creation path',()=>{
  assert.throws(()=>scenarioTaskInputs(assistantScenarioIntake('先选一个开场')!),/已核验/);
  assert.throws(()=>scenarioTaskInputs(assistantScenarioIntake('为活动准备内容')!),/已核验/);
});
test('manual plan entry and home task request use the same single-content contract',()=>{
  const manual=assistantScenarioIntake('帮我创建一条新的创作计划')!,home=assistantScenarioIntake('创建一条新内容任务')!;
  assert.equal(manual.scenario,'content_task');assert.equal(home.scenario,'content_task');
  const fields={selectedProducts:[{id:'p1',name:'产品甲'}],direction:'展示产品的真实使用过程',plannedPublishAt:'2099-01-01T12:00'};
  const a=scenarioTaskInputs({...manual,...fields})[0].input,b=scenarioTaskInputs({...home,id:manual.id,...fields})[0].input;
  assert.deepEqual(a,b);assert.equal(a.objective,fields.direction);assert.equal(a.creationMode,'material_processing');
  assert.throws(()=>scenarioTaskInputs(manual),/产品/);
});
