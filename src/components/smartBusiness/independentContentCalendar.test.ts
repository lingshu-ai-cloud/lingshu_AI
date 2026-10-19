import test from 'node:test';
import assert from 'node:assert/strict';
import {projectIndependentContentCalendar} from './independentContentCalendar';
test('independent task keeps the same week identity and Shanghai deadline',()=>{
 const row:any={id:'task',run_id:'run',title:'单条内容',description:'产品口播',status:'waiting_external',blocked_reason:'待费用确认',output:{assistantIndependent:{dueAt:'2026-10-17T04:00:00Z'},projectId:'project'}};
 const cards=projectIndependentContentCalendar([row],'run');assert.equal(cards.length,1);
 assert.equal(cards[0]!.date,'2026-10-17');assert.equal(cards[0]!.time,'12:00');assert.equal(cards[0]!.independentProjectId,'project');assert.equal(cards[0]!.independentRunId,'run');assert.equal(cards[0]!.status,'blocked');
 assert.deepEqual(projectIndependentContentCalendar([row],'other'),[]);
 assert.equal(projectIndependentContentCalendar([{...row,status:'succeeded'}],'run')[0]!.status,'completed');
});
