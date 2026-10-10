import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
import {forwardCalendarExecution} from './WeeklyCustomerCalendar';
import {readFileSync} from 'node:fs';
const scope={programId:'program',packageId:'week',packageVersion:2};
const base={tenantId:'tenant',...scope,publicationTaskId:'publication'};
const customer={...base,taskId:'customer',schedule:{stepKind:'customer_channel_readiness',responsibleActor:'customer_agent'},inputSnapshot:{customerChannel:'messenger'}} as WeeklyExecutionTask;
const customerCard={id:'customer',customerExecutionTarget:{...base,taskId:'customer',stepKind:'customer_channel_readiness',channel:'messenger'}} as AgentCalendarTask;
const publication={...base,taskId:'publish',accountId:'account',workflowKind:'publishing',schedule:{stepKind:'publishing'}} as WeeklyExecutionTask;
const publicationCard={id:'publish',publicationExecutionTarget:{...base,taskId:'publish',accountId:'account'}} as AgentCalendarTask;
test('durable customer card forwards the exact task to its execution handler',()=>{
  const calls:WeeklyExecutionTask[]=[];
  assert.equal(forwardCalendarExecution(customerCard,scope,[customer],{customer:task=>calls.push(task)}),true);
  assert.deepEqual(calls,[customer]);
});
test('publication card forwards without requiring a content productionTaskId',()=>{
  const calls:AgentCalendarTask[]=[];
  assert.equal(publicationCard.productionTaskId,undefined);
  assert.equal(forwardCalendarExecution(publicationCard,scope,[publication],{publication:card=>calls.push(card)}),true);
  assert.deepEqual(calls,[publicationCard]);
});
test('missing handlers and stale targets fail explicitly without opening another task',()=>{
  for(const [card,task] of [[customerCard,customer],[publicationCard,publication]] as const){
    assert.throws(()=>forwardCalendarExecution(card,scope,[task],{}),/入口尚未加载/);
    let opened=false;
    assert.throws(()=>forwardCalendarExecution(card,{...scope,packageVersion:3},[task],{customer:()=>{opened=true;},publication:()=>{opened=true;}}),/不一致/);
    assert.equal(opened,false);
  }
});
test('connected calendar wires the customer execution handler and real details',()=>{
  const source=readFileSync(new URL('../smartBusiness/ConnectedAgentCalendar.tsx',import.meta.url),'utf8');
  assert.match(source,/<WeeklyCustomerCalendar onOpenExecutionTask=\{openCustomerExecution\}/);
  assert.match(source,/aria-label="真实客服承接任务"/);
});
