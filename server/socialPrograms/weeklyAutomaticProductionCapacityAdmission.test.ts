import assert from 'node:assert/strict';
import test from 'node:test';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyAgentPlanningState,WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {WeeklyAutomaticProductionIntent} from './weeklyAutomaticProductionPlanning.js';
import {readWeeklyAutomaticProductionCapacity} from './weeklyAutomaticProductionPlanning.js';
import {buildWeeklyProductionScopeCapacity,persistWeeklyProductionScopeCapacity} from './weeklyProductionScopeCapacity.js';
import {weeklyPlanningAnalysisHash} from './weeklyPlanningTemplateAdoption.js';
import {scheduleHash} from './weeklyScheduleSnapshots.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {AUTOMATIC_WEEKLY_SCHEDULES} from './weeklyAutomaticSchedule.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

async function fixture(){
 const rows:Array<Record_ & {collection:string}>=[];
 const store={
  async getById(collection:string,id:string){return rows.find(row=>row.collection===collection&&row.id===id)??null;},
  async create(collection:string,data:Record_){const row={...data,collection};rows.push(row);return row;},
  async list(collection:string,query:{where?:Record<string,unknown>;page?:number;perPage?:number}){const all=rows.filter(row=>row.collection===collection&&Object.entries(query.where??{}).every(([key,value])=>row[key]===value));const page=query.page??1,perPage=query.perPage??250;return {items:all.slice((page-1)*perPage,page*perPage),totalItems:all.length,totalPages:Math.max(1,Math.ceil(all.length/perPage)),page,perPage};},
 } as DataStore;
 const scope={tenantId:'t',programId:'p',packageId:'w',packageVersion:2};
 const publication={publicationTaskId:'pub',motherContentId:'mother',businessProposition:'verified product',cta:'verified contact',factRefs:[],publishWindow:'2026-10-16T18:00:00+08:00'};
 const pkg={programId:'p',packageId:'w',version:2,status:'draft',weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{productionIdentityVersion:'shared-original.v1',publicationTasks:[publication],weeklyBudgetCny:240,perItemBudgetCny:10}} as unknown as WeeklyOperatingPackage;
 const ref={type:'benchmark_video',id:'video',version:1},account={type:'benchmark_account',id:'account',version:1};
 const analysis={analysisId:'analysis',packageId:'w',packageVersion:2,slotId:'slot',benchmarkAccountRefs:[account],benchmarkVideoRefs:[ref],benchmarkEvidenceRefs:['evidence'],contentDirection:'Verified reference'};
 const detailedSchedule={ref:{type:'weekly_detailed_schedule',id:'detail',version:1},coverage:{selectedSlotIds:['slot'],pendingSlotIds:[],referenceSourcePolicy:null},items:[{...publication,slotId:'slot',directorAnalysisRef:{type:'weekly_director_analysis',id:'analysis',version:1},benchmarkAccountRefs:[account],benchmarkVideoRefs:[ref]}]};
 const planning={...scope,status:'dispatched',version:4,skeleton:{slots:[{slotId:'slot',publicationTaskIds:['pub'],referenceSource:'external'}]},directorAnalyses:[analysis],detailedSchedule,userConfirmation:null} as unknown as WeeklyAgentPlanningState;
 const adoption={source:'automatic_template' as const,templateVersion:'weekly-automation.v3' as const,adoptedAt:'2026-10-16T00:00:00Z',actorUserId:'owner',userApproval:null,selectedSlotIds:['slot'],analysisEvidenceHash:weeklyPlanningAnalysisHash(planning),detailedScheduleHash:scheduleHash(detailedSchedule),authorizesPublishing:false as const,authorizesContentAcceptance:false as const,authorizesCustomerMessages:false as const};
 planning.automaticTemplateAdoption={...adoption,recordHash:scheduleHash(adoption)};
 const kinds=['business_outline','benchmark_collection','benchmark_scoring','director_analysis','business_schedule','material_preparation','script','storyboard','asset_generation','video_generation','quality_check'];
 const tasks=kinds.map((stepKind,index)=>({
  ...scope,taskId:stepKind,publicationTaskId:index>3?'pub':null,workflowKind:'content',scope:'content',subjectId:stepKind,accountId:'account',inputSnapshot:{rollingDate:'2026-10-16',facts:'verified-v1'},upstreamVersionRefs:[],dependsOnTaskIds:index?[kinds[index-1]]:[],
  schedule:{stepKind,responsibleActor:'content_agent',estimatedDurationMinutes:10,actualStartedAt:null,actualFinishedAt:null},attempt:0,status:'blocked',resultRefs:[],lease:null,budget:{category:index>4?'production':'none',limitCny:index>4?10:null},ownBlockingReasons:[],
 })) as unknown as WeeklyExecutionTask[];
 for(const task of tasks)rows.push({collection:'social_weekly_execution_tasks',id:task.taskId,tenant_id:'t',program_id:'p',package_id:'w',package_version:2,task_id:task.taskId,payload:task});
 const limits=['tenant','task_type'].map((limitScope,index)=>({id:`limit-${index}`,tenantId:'t',scope:limitScope,scopeKey:index?'social_content_weekly':'*',maxRunning:3}));
 for(const limit of limits)rows.push({collection:'content_execution_limits',id:limit.id,tenant_id:'t',limit_scope:limit.scope,scope_key:limit.scopeKey,max_running:limit.maxRunning});
 const persistedTasks=await listWeeklyExecutionTasks(store,'t','p','w',2);
 const proof=buildWeeklyProductionScopeCapacity({pkg,tasks:persistedTasks,planning,selectedSlotIds:['slot'],now:'2026-10-16T07:00:00Z',limits:limits as any,verifiedCompletedTaskIds:new Set()});
 await persistWeeklyProductionScopeCapacity(store,proof);
 const intent={scope,capacityProofId:proof.proofId} as WeeklyAutomaticProductionIntent;
 const task=persistedTasks.find(item=>item.taskId==='video_generation')!;
 const read=(at:string,currentTask=task)=>readWeeklyAutomaticProductionCapacity(store,{intent,pkg,planning,task:currentTask,now:at});
 return {rows,store,scope,pkg,planning,proof,intent,task,read};
}

test('automatic paid admission requires a real, current and eligible frozen capacity proof',async()=>{
 const a=await fixture();
 assert.equal((await a.read('2026-10-16T12:00:00Z'))?.eligible,true);
 assert.equal((await a.read('2026-10-16T06:00:00Z'))?.eligible,false);
 const missing={...a.intent,capacityProofId:'fabricated-proof'};
 assert.equal(await readWeeklyAutomaticProductionCapacity(a.store,{intent:missing,pkg:a.pkg,planning:a.planning,task:a.task,now:'2026-10-16T12:00:00Z'}),null);
 assert.equal(await a.read('2026-10-19T00:00:00Z'),null,'next natural week cannot consume the old production proof');
});

test('automatic paid admission rejects queue and task lineage drift before creation or provider work',async()=>{
 const a=await fixture();
 const limit=a.rows.find(row=>row.collection==='content_execution_limits'&&row.limit_scope==='tenant')!;
 limit.max_running=2;assert.equal(await a.read('2026-10-16T12:00:00Z'),null);limit.max_running=3;
 const row=a.rows.find(row=>row.collection==='social_weekly_execution_tasks'&&row.task_id==='material_preparation')!;
 const original=structuredClone(row.payload);row.payload={...(row.payload as WeeklyExecutionTask),inputSnapshot:{...(row.payload as WeeklyExecutionTask).inputSnapshot,facts:'changed'}};
 assert.equal(await a.read('2026-10-16T12:00:00Z'),null);row.payload=original;
 assert.equal((await a.read('2026-10-16T12:00:00Z'))?.eligible,true);
});

test('blocked full-week publication forecast does not turn final human review into a production prerequisite',async()=>{
 const a=await fixture(),quality=a.rows.find(row=>row.collection==='social_weekly_execution_tasks'&&row.task_id==='quality_check')!.payload as WeeklyExecutionTask;
 const downstream=[
  {taskId:'user_approval',stepKind:'user_approval',responsibleActor:'user',dependsOnTaskIds:['quality_check'],ownBlockingReasons:['human_completion_not_verified']},
  {taskId:'publishing',stepKind:'publishing',responsibleActor:'publishing_agent',dependsOnTaskIds:['user_approval'],ownBlockingReasons:[]},
  {taskId:'performance_monitoring',stepKind:'performance_monitoring',responsibleActor:'business_agent',dependsOnTaskIds:['publishing'],ownBlockingReasons:['work_window_or_capacity_insufficient']},
 ] as const;
 for(const item of downstream){
  const task={...quality,taskId:item.taskId,subjectId:item.taskId,dependsOnTaskIds:[...item.dependsOnTaskIds],ownBlockingReasons:[...item.ownBlockingReasons],budget:{category:'none',limitCny:null},schedule:{...quality.schedule,stepKind:item.stepKind,responsibleActor:item.responsibleActor}} as WeeklyExecutionTask;
  a.rows.push({collection:'social_weekly_execution_tasks',id:item.taskId,tenant_id:'t',program_id:'p',package_id:'w',package_version:2,task_id:item.taskId,payload:task});
 }
 const blockedSchedule={scope:a.scope,source:'automatic_template',templateVersion:'weekly-automation.v3',userApproval:null,proposalId:'complete-graph-proposal',status:'blocked',targetVersion:null,blockers:[{taskId:'performance_monitoring',reasons:['work_window_or_capacity_insufficient']}],activated:false,outboundAuthorization:false};
 a.rows.push({collection:AUTOMATIC_WEEKLY_SCHEDULES,id:'blocked-complete-graph',tenant_id:'t',program_id:'p',package_id:'w',package_version:2,payload:blockedSchedule,content_hash:socialRequestHash(blockedSchedule)});
 const current=await listWeeklyExecutionTasks(a.store,'t','p','w',2);
 const proof=buildWeeklyProductionScopeCapacity({pkg:a.pkg,tasks:current,planning:a.planning,selectedSlotIds:['slot'],now:'2026-10-16T07:00:00Z',limits:[{id:'limit-0',tenantId:'t',scope:'tenant',scopeKey:'*',maxRunning:3},{id:'limit-1',tenantId:'t',scope:'task_type',scopeKey:'social_content_weekly',maxRunning:3}] as any,verifiedCompletedTaskIds:new Set()});
 await persistWeeklyProductionScopeCapacity(a.store,proof);
 assert.equal(proof.assignments.some(row=>downstream.some(item=>item.taskId===row.taskId)),false);
 assert.equal(proof.reservedBudgetCny,10);
 assert.equal(proof.authorizesAcceptance,false);
 assert.equal(proof.authorizesPublishing,false);
 const intent={...a.intent,capacityProofId:proof.proofId};
 assert.equal((await readWeeklyAutomaticProductionCapacity(a.store,{intent,pkg:a.pkg,planning:a.planning,task:a.task,now:'2026-10-16T12:00:00Z'}))?.eligible,true);
 const unchanged=(await a.store.getById<Record_>(AUTOMATIC_WEEKLY_SCHEDULES,'blocked-complete-graph'))!.payload as typeof blockedSchedule;
 assert.equal(unchanged.status,'blocked');
 assert.equal(unchanged.targetVersion,null,'production capacity must not forge a complete-graph schedule or final acceptance');
});
