import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticWeeklyCapacity,readWeeklyAutomaticPreproductionAdmission,AUTOMATIC_WEEKLY_SCHEDULES} from './weeklyAutomaticSchedule.js';
import {SCHEDULE_PROPOSALS,scheduleHash} from './weeklyScheduleSnapshots.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage,WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
function fixture(){
 const pkg={weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{productionIdentityVersion:'shared-original.v1',weeklyBudgetCny:75,publicationTasks:[{publicationTaskId:'a',motherContentId:'root'},{publicationTaskId:'b',motherContentId:'root'}]}} as unknown as WeeklyOperatingPackage;
 const tasks=['a','b'].map((id)=>({taskId:id,publicationTaskId:id,inputSnapshot:{},status:'blocked',attempt:0,resultRefs:[],schedule:{responsibleActor:'content_agent',stepKind:'video_generation',estimatedDurationMinutes:20},ownBlockingReasons:[]} as unknown as WeeklyExecutionTask));
 return {pkg,tasks};
}
test('automatic capacity reserves film ceiling once across platform projections, starts overdue work now and never approves',()=>{
 const {pkg,tasks}=fixture(),now='2026-10-16T07:00:00Z';
 const capacity=automaticWeeklyCapacity(pkg,tasks,now);
 assert.equal(capacity.remainingBudgetCny,75);
 assert.equal(Object.values(capacity.constraints).reduce((n,c)=>n+c.remainingCostCny,0),15);
 assert(Object.values(capacity.constraints).every(c=>Date.parse(c.availableAt)===Date.parse(now)));
 assert.equal(capacity.resources['template:content_agent'].concurrency,3);
 assert.equal(capacity.resources['template:content_agent'].workingWindows.length,3);
 assert.equal(Date.parse(capacity.resources['template:content_agent'].workingWindows[0].startAt),Date.parse(now));
 assert.equal(capacity.resources['template:content_agent'].workingWindows[1].startAt,'2026-10-16T22:00:00.000Z');
 assert.equal('allowRealPublishing' in capacity,false);
});
test('unknown existing work cannot be treated as unused budget and historical weeks require carryover',()=>{
 const {pkg,tasks}=fixture();tasks[0].attempt=1;
 assert.throws(()=>automaticWeeklyCapacity(pkg,tasks,'2026-10-16T07:00:00Z'),{code:'weekly_template_existing_work_requires_reconciliation'});
 tasks[0].attempt=0;
 assert.throws(()=>automaticWeeklyCapacity(pkg,tasks,'2026-10-19T07:00:00Z'),{code:'weekly_template_week_expired_requires_explicit_carryover'});
});
test('verified zero-cost outline may carry forward, production history cannot be zeroed; overdue daily planning gets explicit current-day deadline',()=>{
 const {pkg,tasks}=fixture();
 Object.assign(tasks[0],{status:'succeeded',attempt:1,budget:{category:'none',limitCny:null}});
 tasks[0].schedule.stepKind='business_outline';
 const now='2026-10-16T07:00:00Z';
 assert.throws(()=>automaticWeeklyCapacity(pkg,tasks,now),{code:'weekly_template_existing_work_requires_reconciliation'});
 const capacity=automaticWeeklyCapacity(pkg,tasks,now,new Set(['a']));assert.equal(capacity.constraints.a.remainingCostCny,0);
 tasks[1].schedule.stepKind='business_schedule';tasks[1].inputSnapshot.rollingDate='2026-10-12';
 assert.equal(automaticWeeklyCapacity(pkg,tasks,now,new Set(['a'])).operationalDeadlines?.b,'2026-10-16T23:59:59+08:00');
 tasks[0].schedule.stepKind='video_generation';
 assert.throws(()=>automaticWeeklyCapacity(pkg,tasks,now,new Set(['a'])),{code:'weekly_template_existing_work_requires_reconciliation'});
});
test('resident consumer window begins midnight independently of production',()=>{
 const {pkg,tasks}=fixture();tasks[0].schedule.responsibleActor='customer_agent';tasks[0].schedule.stepKind='customer_channel_readiness';
 const capacity=automaticWeeklyCapacity(pkg,tasks,'2026-10-11T15:00:00Z');
 assert.equal(capacity.resources['template:customer_agent'].workingWindows[0].startAt,'2026-10-11T16:00:00.000Z');
});
test('accepted next-week template starts independent preproduction now but keeps production on its calendar',()=>{
 const {pkg,tasks}=fixture(),now='2026-10-11T07:00:00Z';
 tasks[0].schedule.stepKind='benchmark_collection';
 tasks[0].inputSnapshot.rollingDate='2026-10-15';
 tasks[1].inputSnapshot.rollingDate='2026-10-15';
 const capacity=automaticWeeklyCapacity(pkg,tasks,now);
 assert.equal(capacity.constraints.a.availableAt,new Date(now).toISOString());
 assert.equal(capacity.constraints.b.availableAt,'2026-10-14T22:00:00.000Z');
});
test('future-week automatic capacity treats an empty rolling date as absent instead of producing an invalid instant',()=>{
 const {pkg,tasks}=fixture(),now='2026-10-11T07:00:00Z';
 tasks[0].schedule.stepKind='benchmark_collection';
 tasks[0].inputSnapshot.rollingDate='';
 tasks[1].inputSnapshot.rollingDate='not-a-date';
 const capacity=automaticWeeklyCapacity(pkg,tasks,now);
 assert.equal(capacity.constraints.a.availableAt,new Date(now).toISOString());
 assert.equal(capacity.constraints.b.availableAt,'2026-10-11T22:00:00.000Z');
});
test('blocked whole-graph proposal admits only matching independent preproduction window, never publication or changed facts',async()=>{
 const {tasks}=fixture(),task={...tasks[0],tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,upstreamVersionRefs:[],inputSnapshot:{fact:'verified-v1'},schedule:{...tasks[0].schedule,stepKind:'business_outline'}} as WeeklyExecutionTask;
 const scope={tenant_id:'tenant',program_id:'program',package_id:'package',package_version:1};
 const receipt={proposalId:'proposal',source:'automatic_template',templateVersion:'weekly-automation.v3',userApproval:null,status:'blocked'};
 const proposal={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,inputAuthority:'target_graph_with_automatic_template_capacity',automaticAdoption:{source:'automatic_template',templateVersion:'weekly-automation.v3',userApproval:null},proposalId:'proposal',targetGraph:{tasks:[task]},capacity:{constraints:{a:{availableAt:'2026-10-16T06:00:00+08:00'}}}};
 const rows:Record_[]=[{id:'receipt',collection:AUTOMATIC_WEEKLY_SCHEDULES,...scope,payload:receipt,content_hash:socialRequestHash(receipt)},{id:'proposal',collection:SCHEDULE_PROPOSALS,...scope,proposal_id:'proposal',payload:proposal,content_hash:scheduleHash(proposal)},...['tenant','task_type'].map((dimension,i)=>({id:`limit-${i}`,collection:'content_execution_limits',tenant_id:'tenant',limit_scope:dimension,scope_key:i?'social_content_weekly':'*',max_running:3,updated_by:'automatic_template',updated_at:'2026-10-16T00:00:00Z',created_at:'2026-10-16T00:00:00Z'}))];
 const store={async list(collection:string,query:{where?:Record<string,unknown>}={}){const items=rows.filter(r=>r.collection===collection&&Object.entries(query.where??{}).every(([k,v])=>r[k]===v));return {items,totalItems:items.length,totalPages:1,page:1,perPage:250};}} as unknown as DataStore;
 assert.equal((await readWeeklyAutomaticPreproductionAdmission(store,task,'2026-10-15T21:00:00Z'))?.eligible,false);
 (proposal.capacity.constraints.a as any).resourceKey='template:content_agent';
 (proposal.capacity as any).resources={'template:content_agent':{workingWindows:[{startAt:'2026-10-15T20:00:00Z',finishAt:'2026-10-16T00:00:00Z'}]}};
 rows[1]!.content_hash=scheduleHash(proposal);
 assert.equal((await readWeeklyAutomaticPreproductionAdmission(store,task,'2026-10-15T21:00:00Z'))?.eligible,true,'an immutable legacy proposal reuses its signed prelaunch resource window');
 const admission=await readWeeklyAutomaticPreproductionAdmission(store,task,'2026-10-16T00:00:00Z');
 assert.equal(admission?.eligible,true);assert.equal(admission?.outboundAuthorization,false);assert.equal(admission?.userApproval,null);
 assert.equal(await readWeeklyAutomaticPreproductionAdmission(store,{...task,inputSnapshot:{fact:'changed'}},'2026-10-16T00:00:00Z'),null);
 assert.equal(await readWeeklyAutomaticPreproductionAdmission(store,{...task,schedule:{...task.schedule,stepKind:'publishing'}},'2026-10-16T00:00:00Z'),null);
});
