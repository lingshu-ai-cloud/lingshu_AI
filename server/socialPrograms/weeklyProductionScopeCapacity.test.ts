import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {ProductionScopeCapacityInput} from './weeklyProductionScopeCapacity.js';
import {buildWeeklyProductionScopeCapacity,persistWeeklyProductionScopeCapacity,readWeeklyProductionScopeCapacity,WEEKLY_PRODUCTION_SCOPE_CAPACITIES} from './weeklyProductionScopeCapacity.js';
import {scheduleHash} from './weeklyScheduleSnapshots.js';
import {weeklyPlanningAnalysisHash} from './weeklyPlanningTemplateAdoption.js';
function fixture():ProductionScopeCapacityInput {
 const publications=['pub','adapt'].map((id,i)=>({publicationTaskId:id,motherContentId:'mother',...(i?{adaptationOfPublicationTaskId:'pub'}:{}),businessProposition:'real product',cta:'template',factRefs:[],publishWindow:'2026-10-12T18:00:00+08:00'}));
 const pkg={programId:'p',packageId:'w',version:2,status:'draft',weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{productionIdentityVersion:'shared-original.v1',publicationTasks:publications,weeklyBudgetCny:240,perItemBudgetCny:10}} as unknown as ProductionScopeCapacityInput['pkg'];
 const ref={type:'benchmark_video',id:'video',version:1},account={type:'benchmark_account',id:'account',version:1};
 const analysis={analysisId:'analysis',packageId:'w',packageVersion:2,slotId:'slot',benchmarkAccountRefs:[account],benchmarkVideoRefs:[ref],benchmarkEvidenceRefs:['evidence'],contentDirection:'Real analysis'};
 const detail={ref:{type:'weekly_detailed_schedule',id:'detail',version:1},coverage:{selectedSlotIds:['slot'],pendingSlotIds:[],referenceSourcePolicy:null},items:publications.map(p=>({...p,slotId:'slot',directorAnalysisRef:{type:'weekly_director_analysis',id:'analysis',version:1},benchmarkAccountRefs:[account],benchmarkVideoRefs:[ref]}))};
 const planning={programId:'p',packageId:'w',packageVersion:2,status:'confirmed',version:3,skeleton:{slots:[{slotId:'slot',publicationTaskIds:['pub','adapt'],referenceSource:'external'}]},directorAnalyses:[analysis],detailedSchedule:detail,userConfirmation:null} as unknown as ProductionScopeCapacityInput['planning'];
 const adoption={source:'automatic_template' as const,templateVersion:'weekly-automation.v3' as const,adoptedAt:'2026-10-16T00:00:00Z',actorUserId:'user',userApproval:null,selectedSlotIds:['slot'],analysisEvidenceHash:weeklyPlanningAnalysisHash(planning),detailedScheduleHash:scheduleHash(detail),authorizesPublishing:false as const,authorizesContentAcceptance:false as const,authorizesCustomerMessages:false as const};
 planning.automaticTemplateAdoption={...adoption,recordHash:scheduleHash(adoption)};
 const kinds=['business_outline','benchmark_collection','benchmark_scoring','director_analysis','business_schedule','material_preparation','script','storyboard','asset_generation','video_generation','quality_check'];
 const tasks=kinds.map((kind,index)=>({tenantId:'t',programId:'p',packageId:'w',packageVersion:2,taskId:kind,publicationTaskId:index>3?'pub':null,workflowKind:'content',scope:'content',subjectId:kind,inputSnapshot:{rollingDate:'2026-10-12',facts:'real-v1'},upstreamVersionRefs:[],dependsOnTaskIds:index?[kinds[index-1]]:[],schedule:{stepKind:kind,responsibleActor:'content_agent',estimatedDurationMinutes:10,actualStartedAt:null,actualFinishedAt:null},attempt:0,status:'blocked',resultRefs:[],lease:null,budget:{category:index>4?'production':'none',limitCny:index>4?10:null},ownBlockingReasons:[]})) as unknown as ProductionScopeCapacityInput['tasks'];
 const limits=['tenant','task_type'].map((scope,i)=>({id:`limit${i}`,tenantId:'t',scope,scopeKey:i?'social_content_weekly':'*',maxRunning:3})) as ProductionScopeCapacityInput['limits'];
 return {pkg,planning,tasks,limits,now:'2026-10-16T07:00:00Z',selectedSlotIds:['slot'],verifiedCompletedTaskIds:new Set()};
}
test('selected shared mother reserves at most 10 once while weekly ceiling remains 240',()=>{
 const a=fixture(),proof=buildWeeklyProductionScopeCapacity(a);
 assert.equal(a.pkg.socialContentPackage.weeklyBudgetCny,240);assert.equal(proof.reservedBudgetCny,10);assert.equal(proof.concurrency,3);assert.deepEqual(proof.selectedPublicationTaskIds,['pub']);
 assert.equal(proof.assignments.length,11);assert.equal(Date.parse(proof.assignments[0].startAt),Date.parse(a.now));assert.equal(proof.userApproval,null);
 assert.equal(proof.authorizesPublishing,false);assert.equal(proof.authorizesAcceptance,false);assert.equal(proof.authorizesCustomerMessages,false);
 for(const item of proof.assignments)for(const dep of item.dependencies)assert(Date.parse(item.startAt)>=Date.parse(proof.assignments.find(t=>t.taskId===dep)!.finishAt));
});
test('five distinct mothers reserve no more than fifty against the unchanged 240 weekly ceiling',()=>{
 const a=fixture(),baseTasks=structuredClone(a.tasks),basePublication=structuredClone(a.pkg.socialContentPackage.publicationTasks[0]!);
 a.pkg.socialContentPackage.publicationTasks=Array.from({length:5},(_,i)=>({...structuredClone(basePublication),publicationTaskId:`pub-${i}`,motherContentId:`mother-${i}`}));
 a.tasks=Array.from({length:5},(_,i)=>baseTasks.map(task=>({...structuredClone(task),taskId:`${task.taskId}-${i}`,publicationTaskId:task.publicationTaskId?`pub-${i}`:null,dependsOnTaskIds:task.dependsOnTaskIds.map(id=>`${id}-${i}`)}))).flat();
 a.planning.skeleton.slots=Array.from({length:5},(_,i)=>({...structuredClone(a.planning.skeleton.slots[0]!),slotId:`slot-${i}`,publicationTaskIds:[`pub-${i}`]}));
 a.planning.directorAnalyses=Array.from({length:5},(_,i)=>({...structuredClone(a.planning.directorAnalyses[0]!),analysisId:`analysis-${i}`,slotId:`slot-${i}`,benchmarkVideoRefs:[{type:'benchmark_video',id:`video-${i}`,version:1}]}));
 a.planning.detailedSchedule!.items=Array.from({length:5},(_,i)=>({...structuredClone(a.planning.detailedSchedule!.items[0]!),slotId:`slot-${i}`,publicationTaskId:`pub-${i}`,benchmarkVideoRefs:[{type:'benchmark_video',id:`video-${i}`,version:1}],directorAnalysisRef:{type:'weekly_director_analysis',id:`analysis-${i}`,version:1}}));
 a.planning.detailedSchedule!.coverage!.selectedSlotIds=Array.from({length:5},(_,i)=>`slot-${i}`);
 const adoption=a.planning.automaticTemplateAdoption!;
 const revised={...adoption,selectedSlotIds:Array.from({length:5},(_,i)=>`slot-${i}`),analysisEvidenceHash:weeklyPlanningAnalysisHash(a.planning),detailedScheduleHash:scheduleHash(a.planning.detailedSchedule)};
 const {recordHash:_old,...adoptionBody}=revised;a.planning.automaticTemplateAdoption={...adoptionBody,recordHash:scheduleHash(adoptionBody)};
 a.selectedSlotIds=Array.from({length:5},(_,i)=>`slot-${i}`);
 const proof=buildWeeklyProductionScopeCapacity(a);
 assert.equal(a.pkg.socialContentPackage.weeklyBudgetCny,240);
 assert.equal(proof.reservedBudgetCny,50);
 assert.equal(proof.assignments.filter(item=>item.reservedCny>0).length,5);
 assert(proof.assignments.every(item=>item.reservedCny<=10));
});
test('requires persisted aggregate queue limits, real analysis and automatic adoption without fabricated manual confirmation',()=>{
 let a=fixture();a.limits[0].maxRunning=4;assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_queue_limits_required'});
 a=fixture();a.planning.automaticTemplateAdoption=undefined;assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_template_adoption_required'});
 a=fixture();a.planning.directorAnalyses=[];assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_planning_template_adoption_invalid'});
});
test('unknown or started production never resets work or fees; verified completed preproduction can carry forward',()=>{
 let a=fixture();a.tasks.find(t=>t.schedule.stepKind==='video_generation')!.attempt=1;
 assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_existing_work_requires_reconciliation'});
 a=fixture();const outline=a.tasks[0];outline.status='succeeded';outline.attempt=1;outline.resultRefs=[{type:'real_outline',id:'result',version:1}];outline.schedule.actualFinishedAt='2026-10-15T00:00:00Z';outline.schedule.actualStartedAt='2026-10-14T23:00:00Z';
 assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_existing_work_requires_reconciliation'});
 a.verifiedCompletedTaskIds=new Set([outline.taskId]);const proof=buildWeeklyProductionScopeCapacity(a);assert.equal(proof.assignments[0].mode,'verified_completed');assert.equal(proof.reservedBudgetCny,10);
});
test('outbound/customer/manual dependencies do not get included as production; insufficient weeks and deadlines fail closed',()=>{
 let a=fixture();a.tasks[0].schedule.stepKind='user_approval';assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_external_dependency_required'});
 a=fixture();a.now='2026-10-19T00:00:00Z';assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_current_natural_week_required'});
 a=fixture();a.now='2026-10-18T15:59:00Z';assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_capacity_infeasible'});
});
test('future eligibility is06 Beijing time; blocked unrelated authorization stays outside selected capacity and remains blocked',()=>{
 const a=fixture();a.now='2026-10-15T17:00:00Z';for(const task of a.tasks)task.inputSnapshot.rollingDate='2026-10-16';
 const other={...structuredClone(a.tasks[0]),taskId:'unrelated-customer',publicationTaskId:'adapt',dependsOnTaskIds:[],ownBlockingReasons:['real_authorization_missing']};other.schedule.stepKind='customer_channel_readiness';a.tasks.push(other);
 const proof=buildWeeklyProductionScopeCapacity(a);assert.equal(proof.assignments[0].startAt,'2026-10-15T22:00:00.000Z');assert(!proof.assignments.some(t=>t.taskId===other.taskId));assert.deepEqual(other.ownBlockingReasons,['real_authorization_missing']);
});
test('old sibling projection activity and full-film ceiling are not discarded by canonical deduplication',()=>{
 let a=fixture();a.tasks.push({...structuredClone(a.tasks.find(t=>t.schedule.stepKind==='video_generation')!),taskId:'legacy-adapt-generation',publicationTaskId:'adapt',attempt:1});
 assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_existing_work_requires_reconciliation'});
 a=fixture();a.pkg.socialContentPackage.weeklyBudgetCny=9;assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_budget_insufficient'});
});
test('a persisted capacity proof cannot ignore later production on an unassigned sibling',async()=>{
 const a=fixture(),proof=buildWeeklyProductionScopeCapacity(a),rows:Record_[]=[];
 const store={async getById(c:string,id:string){return rows.find(r=>r.collection===c&&r.id===id)??null;},async create(c:string,data:Record_){const row={...data,collection:c};rows.push(row);return row;},async list(c:string,q:{where?:Record<string,unknown>}){const items=rows.filter(r=>r.collection===c&&Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return {items,totalItems:items.length,totalPages:1,page:1,perPage:250};}} as unknown as DataStore;
 for(const l of a.limits)rows.push({id:l.id,collection:'content_execution_limits',tenant_id:'t',limit_scope:l.scope,scope_key:l.scopeKey,max_running:l.maxRunning});
 await persistWeeklyProductionScopeCapacity(store,proof);
 const read=()=>readWeeklyProductionScopeCapacity(store,{proofId:proof.proofId,pkg:a.pkg,tasks:a.tasks,planning:a.planning,taskId:'video_generation',now:'2026-10-16T12:00:00Z'});
 assert.equal((await read())?.eligible,true);
 a.tasks.push({...structuredClone(a.tasks.find(t=>t.schedule.stepKind==='video_generation')!),taskId:'legacy-adapt-generation',publicationTaskId:'adapt',attempt:1});
 assert.equal(await read(),null);
});
test('legacy fifteen-yuan task budget and capacity proof cannot authorize production',async()=>{
 const a=fixture();a.tasks.find(task=>task.schedule.stepKind==='video_generation')!.budget.limitCny=15;
 assert.throws(()=>buildWeeklyProductionScopeCapacity(a),{code:'weekly_production_scope_task_budget_exceeds_item_limit'});
 const proof=buildWeeklyProductionScopeCapacity(fixture());
 const legacy={...proof,budgetPolicyVersion:undefined,reservedBudgetCny:15,assignments:proof.assignments.map(item=>item.taskId==='video_generation'?{...item,reservedCny:15}:item)} as unknown as typeof proof;
 const {proofId:_oldId,...oldBody}=legacy;legacy.proofId=scheduleHash(oldBody);
 const store={getById:async()=>({id:legacy.proofId,content_hash:scheduleHash(legacy),payload:legacy}),list:async()=>({items:[],totalItems:0,totalPages:1,page:1,perPage:250})} as unknown as DataStore;
 assert.equal(await readWeeklyProductionScopeCapacity(store,{proofId:legacy.proofId,pkg:a.pkg,tasks:fixture().tasks,planning:a.planning,taskId:'video_generation',now:'2026-10-16T12:00:00Z'}),null);
 await assert.rejects(()=>persistWeeklyProductionScopeCapacity(store,legacy),{code:'weekly_production_scope_proof_invalid'});
});
test('durable proof permits later dispatch version but refuses changed inputs, queue limits, selection, and another tenant',async()=>{
 const a=fixture(),proof=buildWeeklyProductionScopeCapacity(a),rows:Record_[]=[];
 const store={async getById(c:string,id:string){return rows.find(r=>r.collection===c&&r.id===id)??null;},async create(c:string,data:Record_){const row={...data,collection:c};rows.push(row);return row;},async list(c:string,q:{where?:Record<string,unknown>}){const items=rows.filter(r=>r.collection===c&&Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return {items,totalItems:items.length,totalPages:1,page:1,perPage:250};}} as unknown as DataStore;
 for(const l of a.limits)rows.push({id:l.id,collection:'content_execution_limits',tenant_id:'t',limit_scope:l.scope,scope_key:l.scopeKey,max_running:l.maxRunning});
 await persistWeeklyProductionScopeCapacity(store,proof);await persistWeeklyProductionScopeCapacity(store,proof);assert.equal(rows.filter(r=>r.collection===WEEKLY_PRODUCTION_SCOPE_CAPACITIES).length,1);
 const read=()=>readWeeklyProductionScopeCapacity(store,{proofId:proof.proofId,pkg:a.pkg,tasks:a.tasks,planning:a.planning,taskId:'video_generation',now:'2026-10-16T12:00:00Z'});
 a.planning.status='dispatched';a.planning.version++;assert.equal((await read())?.eligible,true);
 a.tasks[5].inputSnapshot.facts='changed';assert.equal(await read(),null);a.tasks[5].inputSnapshot.facts='real-v1';
 a.tasks[5].schedule.estimatedDurationMinutes=999;assert.equal(await read(),null);a.tasks[5].schedule.estimatedDurationMinutes=10;
 rows[0].max_running=2;assert.equal(await read(),null);rows[0].max_running=3;
 a.tasks[5].tenantId='other';assert.equal(await read(),null);
});
