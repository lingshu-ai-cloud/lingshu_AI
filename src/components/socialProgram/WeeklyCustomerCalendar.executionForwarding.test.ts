import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
import {forwardCalendarExecution} from './WeeklyCustomerCalendar';
import {readFileSync} from 'node:fs';
const scope={programId:'program',packageId:'week',packageVersion:2};
const base={tenantId:'tenant',...scope,publicationTaskId:'publication'};
function executionFixture(overrides:Partial<WeeklyExecutionTask>={}):WeeklyExecutionTask {
  return {...base,taskId:'customer',workflowKind:'engagement',scope:'publication',subjectId:'publication',accountId:null,
    dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{customerChannel:'messenger'},idempotencyKey:'customer-readiness',
    budget:{category:'none',limitCny:null},schedule:{stepKind:'customer_channel_readiness',responsibleActor:'customer_agent',estimatedDurationMinutes:5,estimatedStartAt:'2026-10-12T08:00:00Z',estimatedFinishAt:'2026-10-12T08:05:00Z',actualStartedAt:null,actualFinishedAt:null},
    status:'pending_activation',ownBlockingReasons:[],inheritedBlockingTaskIds:[],attempt:0,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:null,recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z',...overrides};
}
const customer=executionFixture();
const cardBase={date:'2026-10-12',time:'16:00',title:'真实执行任务',output:'核验交付',context:'周发布任务',minutes:5,status:'planned'} satisfies Omit<AgentCalendarTask,'id'|'agent'>;
const customerCard:AgentCalendarTask={...cardBase,id:'customer',agent:'customer',customerExecutionTarget:{...base,taskId:'customer',stepKind:'customer_channel_readiness',channel:'messenger'}};
const publication=executionFixture({taskId:'publish',accountId:'account',workflowKind:'publishing',idempotencyKey:'publication-publish',schedule:{...customer.schedule,stepKind:'publishing',responsibleActor:'business_agent'}});
const publicationCard:AgentCalendarTask={...cardBase,id:'publish',agent:'business',publicationExecutionTarget:{...base,taskId:'publish',accountId:'account'}};
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
