import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyAgentPlanningState,WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {completeWeeklyAutomaticProductionPreparation,type WeeklyAutomaticProductionIntent,WEEKLY_AUTOMATIC_PRODUCTION_INTENTS} from './weeklyAutomaticProductionPlanning.js';
import {buildWeeklyProductionScopeCapacity,persistWeeklyProductionScopeCapacity} from './weeklyProductionScopeCapacity.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {weeklyPlanningAnalysisHash} from './weeklyPlanningTemplateAdoption.js';
import {scheduleHash} from './weeklyScheduleSnapshots.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {INITIAL_CAPACITY_SCHEDULE_REQUIRED} from './weeklyInitialScheduleGate.js';

async function fixture(){
 const tables:Record<string,Record_[]>={};let serial=0;
 const store={
  supportsAtomicOperationLease:()=>true,
  async getById(c:string,id:string){return (tables[c]??[]).find(row=>row.id===id)??null;},
  async list(c:string,q:{where?:Record<string,unknown>;page?:number;perPage?:number}={}){const all=(tables[c]??[]).filter(row=>Object.entries(q.where??{}).every(([key,value])=>row[key]===value));const page=q.page??1,perPage=q.perPage??500;return {items:all.slice((page-1)*perPage,page*perPage),totalItems:all.length,totalPages:Math.max(1,Math.ceil(all.length/perPage)),page,perPage};},
  async create(c:string,value:Record<string,unknown>){const row={id:String(value.id??`record-${++serial}`),...value};(tables[c]??=[]).push(row);return row;},
  async update(c:string,id:string,value:Record<string,unknown>){const row=(tables[c]??[]).find(item=>item.id===id);if(!row)return false;Object.assign(row,value);return true;},
  async delete(c:string,id:string){const count=(tables[c]??[]).length;tables[c]=(tables[c]??[]).filter(row=>row.id!==id);return tables[c].length<count;},
 } as DataStore;
 const scope={tenantId:'t',programId:'p',packageId:'w',packageVersion:2};
 const publications=['adapt','pub'].map(id=>({publicationTaskId:id,motherContentId:'mother',...(id==='adapt'?{adaptationOfPublicationTaskId:'pub'}:{}),businessProposition:'verified product',cta:'verified route',factRefs:[],publishWindow:'2026-10-16T18:00:00+08:00'}));
 const pkg={programId:'p',packageId:'w',version:2,status:'draft',weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{productionIdentityVersion:'shared-original.v1',publicationTasks:publications,weeklyBudgetCny:240,perItemBudgetCny:10}} as unknown as WeeklyOperatingPackage;
 const account={type:'benchmark_account',id:'account',version:1},video={type:'benchmark_video',id:'video',version:1};
 const analysis={analysisId:'analysis',packageId:'w',packageVersion:2,slotId:'slot',benchmarkAccountRefs:[account],benchmarkVideoRefs:[video],benchmarkEvidenceRefs:['evidence'],contentDirection:'Verified'};
 const detail={ref:{type:'weekly_detailed_schedule',id:'detail',version:1},coverage:{selectedSlotIds:['slot'],pendingSlotIds:[],referenceSourcePolicy:null},items:publications.map(publication=>({...publication,slotId:'slot',directorAnalysisRef:{type:'weekly_director_analysis',id:'analysis',version:1},benchmarkAccountRefs:[account],benchmarkVideoRefs:[video]}))};
 const planning={...scope,status:'dispatched',version:4,skeleton:{slots:[{slotId:'slot',publicationTaskIds:['pub','adapt'],referenceSource:'external'}]},directorAnalyses:[analysis],detailedSchedule:detail,userConfirmation:null,dispatch:{scheduleItems:detail.items}} as unknown as WeeklyAgentPlanningState;
 const adoption={source:'automatic_template' as const,templateVersion:'weekly-automation.v3' as const,adoptedAt:'2026-10-16T00:00:00Z',actorUserId:'owner',userApproval:null,selectedSlotIds:['slot'],analysisEvidenceHash:weeklyPlanningAnalysisHash(planning),detailedScheduleHash:scheduleHash(detail),authorizesPublishing:false as const,authorizesContentAcceptance:false as const,authorizesCustomerMessages:false as const};
 planning.automaticTemplateAdoption={...adoption,recordHash:scheduleHash(adoption)};
 const kinds=['business_outline','benchmark_collection','benchmark_scoring','director_analysis','business_schedule','material_preparation','script','storyboard','asset_generation','video_generation','quality_check'];
 const tasks=kinds.map((stepKind,index)=>({...scope,taskId:stepKind,publicationTaskId:index>3?'pub':null,workflowKind:'content',scope:'content',subjectId:stepKind,accountId:'account',idempotencyKey:`weekly:${stepKind}`,inputSnapshot:{rollingDate:'2026-10-16',facts:'v1'},upstreamVersionRefs:[],dependsOnTaskIds:index?[kinds[index-1]]:[],inheritedBlockingTaskIds:[],schedule:{stepKind,responsibleActor:'content_agent',estimatedDurationMinutes:10,actualStartedAt:null,actualFinishedAt:null},attempt:0,status:'blocked',resultRefs:[],lease:null,budget:{category:index>4?'production':'none',limitCny:index>4?10:null},ownBlockingReasons:index>4?[INITIAL_CAPACITY_SCHEDULE_REQUIRED,'business_dispatch_required','real_rights_gap']:[]})) as unknown as WeeklyExecutionTask[];
 for(const task of tasks)await store.create('social_weekly_execution_tasks',{tenant_id:'t',program_id:'p',package_id:'w',package_version:2,task_id:task.taskId,payload:task});
 const limits=['tenant','task_type'].map((limitScope,index)=>({id:`limit-${index}`,tenantId:'t',scope:limitScope,scopeKey:index?'social_content_weekly':'*',maxRunning:3}));
 for(const limit of limits)await store.create('content_execution_limits',{id:limit.id,tenant_id:'t',limit_scope:limit.scope,scope_key:limit.scopeKey,max_running:limit.maxRunning});
 const actual=await listWeeklyExecutionTasks(store,'t','p','w',2),now='2026-10-16T07:00:00Z';
 const proof=buildWeeklyProductionScopeCapacity({pkg,tasks:actual,planning,selectedSlotIds:['slot'],now,limits:limits as any,verifiedCompletedTaskIds:new Set()});
 await persistWeeklyProductionScopeCapacity(store,proof);
 const intent={intentId:socialRequestHash([scope,planning.automaticTemplateAdoption.recordHash]),scope,source:'automatic_template',templateVersion:'weekly-automation.v3',adoptedAt:now,userApproval:null,actorUserId:'owner',planningAdoptionHash:planning.automaticTemplateAdoption.recordHash,productionAuthorityProofId:'separate-production-proof',capacityProofId:proof.proofId,dispatchHash:socialRequestHash(planning.dispatch),selectedPublicationTaskIds:planning.dispatch!.scheduleItems.map(item=>item.publicationTaskId),authorizesPublishing:false,authorizesContentAcceptance:false,authorizesCustomerMessages:false} satisfies WeeklyAutomaticProductionIntent;
 await store.create(WEEKLY_AUTOMATIC_PRODUCTION_INTENTS,{id:intent.intentId,tenant_id:'t',program_id:'p',package_id:'w',package_version:2,payload:intent,content_hash:socialRequestHash(intent)});
 return {store,tables,scope,pkg,planning,intent,now,tasks};
}

test('persisted intent resumes the unfinished capacity-unblock tail without erasing unrelated rights blockers',async()=>{
 const f=await fixture();
 assert.equal(f.planning.dispatch!.scheduleItems[0]!.publicationTaskId,'adapt','first dispatch item is not the paid original');
 assert.equal(await completeWeeklyAutomaticProductionPreparation(f.store,{scope:f.scope,pkg:f.pkg,planning:f.planning,intent:f.intent,now:f.now}),true);
 let tasks=await listWeeklyExecutionTasks(f.store,'t','p','w',2);
 const script=tasks.find(task=>task.taskId==='script')!;
 assert.deepEqual(script.ownBlockingReasons,['real_rights_gap']);assert.equal(script.status,'blocked');
 assert.equal(await completeWeeklyAutomaticProductionPreparation(f.store,{scope:f.scope,pkg:f.pkg,planning:f.planning,intent:f.intent,now:f.now}),true);
 tasks=await listWeeklyExecutionTasks(f.store,'t','p','w',2);
 assert.deepEqual(tasks.find(task=>task.taskId==='script')!.ownBlockingReasons,['real_rights_gap']);
 assert.equal(f.tables[WEEKLY_AUTOMATIC_PRODUCTION_INTENTS]?.length,1);
});

test('changed task or capacity proof never unblocks an interrupted automatic prepare',async()=>{
 const f=await fixture(),row=f.tables.social_weekly_execution_tasks!.find(item=>item.task_id==='storyboard')!;
 (row.payload as WeeklyExecutionTask).inputSnapshot.facts='drifted';
 assert.equal(await completeWeeklyAutomaticProductionPreparation(f.store,{scope:f.scope,pkg:f.pkg,planning:f.planning,intent:f.intent,now:f.now}),false);
 assert(f.tables.social_weekly_execution_tasks!.some(item=>(item.payload as WeeklyExecutionTask).ownBlockingReasons.includes(INITIAL_CAPACITY_SCHEDULE_REQUIRED)));
 (row.payload as WeeklyExecutionTask).inputSnapshot.facts='v1';
 assert.equal(await completeWeeklyAutomaticProductionPreparation(f.store,{scope:f.scope,pkg:f.pkg,planning:f.planning,intent:{...f.intent,capacityProofId:'nonexistent'},now:f.now}),false);
 assert(f.tables.social_weekly_execution_tasks!.some(item=>(item.payload as WeeklyExecutionTask).ownBlockingReasons.includes(INITIAL_CAPACITY_SCHEDULE_REQUIRED)));
});
