import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveryScenario, buildBackwardScenario } from './WeeklyRecoveryPanel';
import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
test('blank budget or partially filled work cannot silently become zero-cost or zero-time capacity',()=> {
 assert.throws(()=>buildRecoveryScenario('',[],{},[]),/预算/);
 assert.throws(()=>buildRecoveryScenario('100',[],{task:{resourceKey:'content',remainingMinutes:'',remainingCostCny:'0',bufferMinutes:'0',availableAt:'2026-10-09T09:00:00+08:00'}},[{key:'content',concurrency:'1',startAt:'2026-10-09T09:00:00+08:00',finishAt:'2026-10-09T18:00:00+08:00'}]),/剩余分钟/);
});
test('backward scenario uses the same explicit capacity but strips changed IDs and rejects stale task scope',()=> {
 const scenario=buildRecoveryScenario('100',['valid'],{valid:{resourceKey:'content',remainingMinutes:'60',remainingCostCny:'10',bufferMinutes:'15',availableAt:'2026-10-09T09:00:00+08:00'}},[{key:'content',concurrency:'1',startAt:'2026-10-08T09:00:00+08:00',finishAt:'2026-10-09T18:00:00+08:00'}]);
 const task={taskId:'valid',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:3} as WeeklyExecutionTask;
 const result=buildBackwardScenario(scenario,[task],3);
 assert.equal('changedTaskIds' in result,false);assert.equal('tasks' in result,false);assert.equal('now' in result,false);assert.deepEqual(result.constraints,scenario.constraints);
 assert.throws(()=>buildBackwardScenario(scenario,[{...task,packageVersion:2}],3),/当前项目/);
 assert.throws(()=>buildBackwardScenario(scenario,[task,{...task,taskId:'other',tenantId:'other'}],3),/当前项目/);
 assert.throws(()=>buildBackwardScenario({...scenario,constraints:{stale:scenario.constraints.valid!}},[task],3),/其它项目或版本/);
});
test('explicit work assumptions preserve shared capacity and contain neither client tasks nor approval state',()=> {
 const window={key:'content',concurrency:'2',startAt:'2026-10-09T09:00:00+08:00',finishAt:'2026-10-09T18:00:00+08:00'};
 const result=buildRecoveryScenario('100',['task'],{task:{resourceKey:'content',remainingMinutes:'60',remainingCostCny:'0',bufferMinutes:'15',availableAt:window.startAt}},[window]);
 assert.equal(result.resources.content!.concurrency,2);
 assert.equal(result.constraints.task!.remainingCostCny,0);
 assert.equal(result.constraints.task!.bufferMinutes,15);
 assert.deepEqual(result.changedTaskIds,['task']);
 assert.equal('tasks' in result,false);
 assert.equal('now' in result,false);
 assert.equal('status' in result.constraints.task!,false);
});
test('human work windows need explicit timezone and consistent concurrency',()=> {
 assert.throws(()=>buildRecoveryScenario('0',[],{},[{key:'human',concurrency:'1',startAt:'2026-10-09T09:00',finishAt:'2026-10-09T18:00'}]),/时区/);
 const row={key:'human',concurrency:'1',startAt:'2026-10-09T09:00:00+08:00',finishAt:'2026-10-09T18:00:00+08:00'};
 assert.throws(()=>buildRecoveryScenario('0',[],{},[row,{...row,concurrency:'2'}]),/相同并发/);
 assert.throws(()=>buildRecoveryScenario('0',[],{},[{...row,concurrency:'1.5'}]),/正整数/);
 assert.throws(()=>buildRecoveryScenario('0',[],{},[{...row,startAt:'2026-02-30T09:00:00+08:00'}]),/真实存在/);
 assert.throws(()=>buildRecoveryScenario('0',[],{},[{...row,startAt:'2026-10-09T24:00:00+08:00'}]),/真实存在/);
});
test('explicit operating deadlines are restricted to actual monitoring and review tasks and preserve timezone',()=> {
 const scenario=buildRecoveryScenario('0',[],{},[]);
 const base={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:3};
 const observe={...base,taskId:'observe',schedule:{stepKind:'performance_monitoring'}} as WeeklyExecutionTask;
 const video={...base,taskId:'video',schedule:{stepKind:'video_generation'}} as WeeklyExecutionTask;
 const result=buildBackwardScenario(scenario,[observe,video],3,{observe:'2026-10-11T23:30:00-07:00'});
 assert.deepEqual({...result.operationalDeadlines},{observe:'2026-10-11T23:30:00-07:00'});
 assert.equal('frozenOperationalWeek' in result,false);
 assert.throws(()=>buildBackwardScenario(scenario,[observe,video],3,{video:'2026-10-11T23:30:00-07:00'}),/其它任务/);
 assert.throws(()=>buildBackwardScenario(scenario,[observe],3,{observe:'2026-02-30T23:30:00-07:00'}),/真实存在/);
});
import {assertTargetGraphCapacity} from './WeeklyRecoveryPanel';
import {parseScheduleTargetGraph} from '../../lib/socialProgramApi';
import type {WeeklyScheduleTargetGraph} from '../../../shared/contracts/socialWeeklyScheduleRevision';
test('new target graph requires explicit prep cost/work/resource without duplicating existing generation capacity',()=>{const scope={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:3};const original={...scope,taskId:'render'}as WeeklyExecutionTask,prep={...scope,taskId:'new-prep'}as WeeklyExecutionTask;const graph:WeeklyScheduleTargetGraph={tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,sourceVersion:3,targetVersion:4,executionGraphVersion:2,targetGraphHash:'a'.repeat(64),tasks:[original,prep],bindings:[{planningTaskId:'render',targetTaskId:'render-v4',sourceTaskId:'render',signature:'render',origin:'existing_source'},{planningTaskId:'new-prep',targetTaskId:'new-prep',sourceTaskId:null,signature:'prep',origin:'new_planned'}]};assert.equal(parseScheduleTargetGraph(graph,scope),graph);assert.throws(()=>parseScheduleTargetGraph({...graph,tenantId:'foreign'},scope));assert.throws(()=>parseScheduleTargetGraph({...graph,programId:'foreign'},scope));assert.throws(()=>parseScheduleTargetGraph({...graph,tasks:[original,{...prep,tenantId:'foreign'}]},scope));assert.throws(()=>assertTargetGraphCapacity(graph,{constraints:{},resources:{},remainingBudgetCny:10}),/新增素材/);const input=buildRecoveryScenario('10',[],{'new-prep':{resourceKey:'human',remainingMinutes:'25',remainingCostCny:'0',bufferMinutes:'5',availableAt:'2026-10-09T09:00:00+08:00'}},[{key:'human',concurrency:'1',startAt:'2026-10-09T09:00:00+08:00',finishAt:'2026-10-09T18:00:00+08:00'}]);assertTargetGraphCapacity(graph,input);assert.deepEqual(Object.keys(input.constraints),['new-prep']);assert.equal(input.constraints['new-prep']!.remainingCostCny,0);assert.equal(input.constraints.render,undefined);});
