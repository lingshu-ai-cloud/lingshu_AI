import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveryScenario } from './WeeklyRecoveryPanel';
test('blank budget or partially filled work cannot silently become zero-cost or zero-time capacity',()=> {
 assert.throws(()=>buildRecoveryScenario('',[],{},[]),/预算/);
 assert.throws(()=>buildRecoveryScenario('100',[],{task:{resourceKey:'content',remainingMinutes:'',remainingCostCny:'0',bufferMinutes:'0',availableAt:'2026-10-09T09:00:00+08:00'}},[{key:'content',concurrency:'1',startAt:'2026-10-09T09:00:00+08:00',finishAt:'2026-10-09T18:00:00+08:00'}]),/剩余分钟/);
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
});
