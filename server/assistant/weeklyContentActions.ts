import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {listWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import {assertWeeklyScheduleActor} from '../socialPrograms/weeklyScheduleActor.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from '../starter198/repository.js';
import {executeSocialContentMutation} from '../starter198/socialContentMutation.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {createWeeklyScheduleRevisionService} from '../socialPrograms/socialWeeklyScheduleRevisions.js';
import {createWeeklyContentTemplateService} from '../socialPrograms/weeklyContentTemplates.js';
import {planWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import type {WeeklyScheduleCapacityInput} from '../../shared/contracts/socialWeeklyScheduleRevision.js';
import {createSocialOperatingOrchestrationService} from '../socialOperating/orchestration.js';
import {enterpriseProductIdentity} from '../lib/enterpriseProductIdentity.js';
import {socialJson,socialObject} from '../starter198/socialContentValidation.js';
import {listContentExecutionLimits} from '../contentExecution/durableQueue.js';
import {weeklyReviewWindowBounds} from '../socialReview/weeklyReviewTiming.js';

export interface WeeklyContentActionInput {
  requestId:string; programId:string; packageId:string; expectedVersion:number;
  accountId:string; productId:string; goal:string; platform:'tiktok'|'instagram'|'facebook'|'youtube'|'linkedin'; dueAt:string;
  /** A persisted, confirmed capacity decision, never an inline quota override. */
  capacityPlanRef?:{type:'capacity_plan';id:string;version:number};
  operatingDecisionSnapshotRef?:{type:'operating_authority_snapshot';id:string;version:number};
  capacityAuthorization?:{operationId:string;proposalHash:string;approvedPublicationQuota:number;approvedMaximumCostCny:number};
}
export interface WeeklyContentActionScope {tenantId:string;userId:string;}
function fail(code:string,message:string,status=409):never{throw new SocialProgramError(code,status,message);}

/** Admission creates canonical weekly nodes, not a chat-only card. Execution
 * remains behind the existing planning, capacity, review and budget gates. */
export function createWeeklyContentActions(store:DataStore,ports:{now?:()=>string}={}){
 const packages=createWeeklyOperatingPackageService(store);
 const orchestration=createSocialOperatingOrchestrationService(store,ports.now);
 async function productMatches(scope:WeeklyContentActionScope,productId:string,primary:string|undefined){
  if(primary===productId)return true;
  const profiles=await store.list<Record<string,unknown>>('tenant_profiles',{where:{tenant_id:scope.tenantId},perPage:2});
  if(profiles.totalItems!==1)return false;
  const profile=socialObject(socialJson(profiles.items[0]?.profile)),products=socialObject(profile?.products)?.items;
  if(!Array.isArray(products))return false;
  const matches=products.map((p,index)=>({p:socialObject(p),index})).filter(({p,index})=>p&&enterpriseProductIdentity(p,index)===productId);
  return matches.length===1&&matches[0]!.p?.name===primary;
 }
 async function assertTargetProduct(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,pkg:WeeklyOperatingPackage){
  const ref=pkg.businessContentGoalRef,goal=ref?await createSocialOperatingRepository(store).getGoal(scope.tenantId,input.programId,ref.id,ref.version):null;
  if(!goal||!await productMatches(scope,input.productId,goal.products[0]))fail('assistant_weekly_product_goal_mismatch','新的容量计划对应的主产品已变化，请重新确认所选产品。');
 }
 function capacityRequest(input:WeeklyContentActionInput){const {capacityPlanRef,operatingDecisionSnapshotRef,capacityAuthorization,...request}=input;return request;}
 async function approvedBudget(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){
  const a=input.capacityAuthorization;
  if(!a||!input.operatingDecisionSnapshotRef)fail('assistant_weekly_capacity_authorization_required','请先明确确认本次新增的数量和预算。');
  const confirmation={snapshotRef:{id:input.operatingDecisionSnapshotRef.id,version:input.operatingDecisionSnapshotRef.version},proposalHash:a.proposalHash,approvedPublicationQuota:a.approvedPublicationQuota,approvedMaximumCostCny:a.approvedMaximumCostCny,confirmed:true};
  const rows=await createStarter198Repository(store).list(STARTER_COLLECTIONS.socialContentOperations,scope.tenantId,{where:{operation_id:a.operationId},perPage:2});
  const row=rows.items[0];
  if(rows.totalItems!==1||row?.created_by!==scope.userId||row.operation!=='assistant_confirm_weekly_capacity'||row.target_id!==input.packageId||row.status!=='succeeded'||row.request_hash!==socialRequestHash({request:capacityRequest(input),confirmation}))fail('assistant_weekly_capacity_authorization_changed','容量确认已变化，请重新确认新增数量和预算。');
  return a.approvedMaximumCostCny;
 }
 async function capacityProposal(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,snapshot:Awaited<ReturnType<typeof orchestration.getSnapshot>>){
  const pkg=await packages.get(scope.tenantId,input.programId,input.packageId),repository=createSocialOperatingRepository(store);
  if(pkg.version!==input.expectedVersion||snapshot.planningWeekStart!==pkg.weekStart)fail('assistant_weekly_version_changed','周计划已更新，请重新核对容量。');
  const goal=await repository.getGoal(scope.tenantId,input.programId,snapshot.businessContentGoalRef.id,snapshot.businessContentGoalRef.version),capacity=await repository.getOperatingDecision<import('../socialOperating/capacityPlanner.js').CapacityPlan>(scope.tenantId,input.programId,snapshot.capacityPlanRef.id);
  if(!goal||!capacity)fail('assistant_weekly_capacity_receipt_missing','容量计算记录不完整，请重新生成。');
  if(!await productMatches(scope,input.productId,goal.products[0]))fail('assistant_weekly_product_goal_mismatch','新的容量计划对应的主产品已变化，请重新确认所选产品。');
  if(goal.weeklyBudgetCny===null)fail('assistant_weekly_budget_required','请先明确经营目标中的周预算。');
  const proposal={programId:input.programId,packageId:input.packageId,sourceVersion:pkg.version,requestHash:socialRequestHash(input),snapshotRef:{type:'operating_authority_snapshot' as const,id:snapshot.snapshotId,version:snapshot.version},capacityPlanRef:snapshot.capacityPlanRef,originalContentQuota:capacity.output.originalContentQuota,publicationQuota:capacity.output.publicationQuota,estimatedCostCny:capacity.output.estimatedCostCny,weeklyBudgetCny:goal.weeklyBudgetCny,status:capacity.output.status,limitingFactors:capacity.output.limitingFactors};
  return {...proposal,proposalHash:socialRequestHash(proposal),canAdd:snapshot.status!=='blocked'&&capacity.output.publicationQuota>=pkg.socialContentPackage.publicationTasks.length+1&&capacity.output.originalContentQuota>=pkg.socialContentPackage.originalContentTarget+1};
 }
 function publicationId(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){return `assistant_${createHash('sha256').update(JSON.stringify([scope.tenantId,scope.userId,input.packageId,input.requestId])).digest('hex').slice(0,28)}`;}
 async function prepare(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,pkg:WeeklyOperatingPackage){
  const ref=pkg.businessContentGoalRef;
  const goal=ref?await createSocialOperatingRepository(store).getGoal(scope.tenantId,input.programId,ref.id,ref.version):null;
  if(!goal||goal.status!=='ready'||!await productMatches(scope,input.productId,goal.products[0]))fail('assistant_weekly_product_goal_mismatch','所选产品与当前周计划确认的主产品不一致，请先更新经营目标。');
  if(!input.goal?.trim()||input.goal.length>1000||!input.productId||!input.requestId||input.requestId.length>160)fail('assistant_weekly_content_input_invalid','请补充明确产品和内容目标。',400);
  const due=Date.parse(input.dueAt);
  if(!Number.isFinite(due)||due<Date.parse(`${pkg.weekStart}T00:00:00+08:00`)||due>=Date.parse(`${pkg.weekEnd}T00:00:00+08:00`)+86400000)fail('assistant_weekly_due_outside_week','交付时间必须位于选中的周计划内。',400);
  const account=pkg.socialContentPackage.publicationTasks.find(p=>p.accountId===input.accountId&&p.platform===input.platform);
  if(!account)fail('assistant_weekly_account_missing','请选择当前周计划中已确认的平台账号。',400);
  const publicationTaskId=publicationId(scope,input);
  const publications=[...pkg.socialContentPackage.publicationTasks];
  for(let index=0;index<publications.length;index++){const p=publications[index]!;if(p.contentTemplateBindingRef){const carryover=await createWeeklyContentTemplateService(store).planRevisionCarryover({tenantId:scope.tenantId,programId:input.programId,packageId:input.packageId,packageVersion:pkg.version,publicationTaskId:p.publicationTaskId},{actorUserId:scope.userId,expectedTargetVersion:pkg.version+1});publications[index]={...p,contentTemplateBindingRef:carryover.targetBindingRef};}}
  publications.push({publicationTaskId,motherContentId:publicationTaskId,adaptationOfPublicationTaskId:null,accountId:input.accountId,platform:input.platform,accountPositioning:account.accountPositioning,businessProposition:input.goal.trim(),cta:account.cta,factRefs:account.factRefs,metricTargets:[...account.metricTargets],publishWindow:new Date(due).toISOString(),status:'planned'});
  const accountPlans=publications.reduce<Array<{accountId:string;publicationCount:number;accountPositioning:string|null}>>((all,p)=>{const plan=all.find(a=>a.accountId===p.accountId);if(plan)plan.publicationCount++;else all.push({accountId:p.accountId,publicationCount:1,accountPositioning:p.accountPositioning});return all;},[]);
  return {expectedVersion:input.expectedVersion,changeReason:'用户通过灵小枢明确创建单条内容任务',publicationTasks:publications,accountPlans,originalContentTarget:pkg.socialContentPackage.originalContentTarget+1,...(input.capacityPlanRef?{capacityPlanRef:input.capacityPlanRef}:{}),...(input.operatingDecisionSnapshotRef?{operatingDecisionSnapshotRef:input.operatingDecisionSnapshotRef}:{})};
 }
 function schedule(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){return createWeeklyScheduleRevisionService(store,{
  now:ports.now,
  previewTarget:async(a,pkg,_tasks,at)=>{const target=await packages.previewRevision(a.tenantId,a.actorUserId,a.programId,a.packageId,await prepare(scope,input,pkg),{createdAt:new Date(at).toISOString()});await assertTargetProduct(scope,input,target);if(!target.socialContentPackage.publicationTasks.some(p=>p.publicationTaskId===publicationId(scope,input)))fail('assistant_weekly_incremental_capacity_required','当前确认的周容量没有新增内容名额，请先确认增量容量计划。');return {pkg:target,tasks:planWeeklyExecutionTasks(a.tenantId,target,target.createdAt)};},
  revise:async(a,ref,createdAt)=>{const pkg=await packages.get(a.tenantId,a.programId,a.packageId);return packages.revise(a.tenantId,a.actorUserId,a.programId,a.packageId,await prepare(scope,input,pkg),{scheduleRevisionRef:ref,createdAt});},
 });}
 function scheduleScope(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){return {tenantId:scope.tenantId,actorUserId:scope.userId,programId:input.programId,packageId:input.packageId,packageVersion:input.expectedVersion};}
 async function receipt(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,publicationTaskId:string){
  const pkg=await packages.get(scope.tenantId,input.programId,input.packageId);
  const publication=pkg.socialContentPackage.publicationTasks.find(p=>p.publicationTaskId===publicationTaskId);
  if(!publication)fail('assistant_weekly_action_receipt_missing','任务尚未完成周排期登记，请重试。',503);
  const tasks=await listWeeklyExecutionTasks(store,scope.tenantId,input.programId,input.packageId,pkg.version);
  const nodes=tasks.filter(t=>t.publicationTaskId===publicationTaskId);
  if(!nodes.length)fail('assistant_weekly_action_nodes_missing','周任务执行节点尚未保存，未报告创建成功。',503);
  return {state:'awaiting_review' as const,programId:input.programId,packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId,executionTaskIds:nodes.map(t=>t.taskId),
   message:'已加入周任务草稿。确认排期及编导审核后，才会进入生产；尚未调用付费生成。',
   nextAction:'review_weekly_plan' as const,navigation:{page:'digitalEmployees',programId:input.programId,packageId:pkg.packageId,packageVersion:pkg.version}};
 }
 return {
  async proposeCapacity(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){
   await assertWeeklyScheduleActor(store,{tenantId:scope.tenantId,actorUserId:scope.userId,packageVersion:input.expectedVersion});
   const pkg=await packages.get(scope.tenantId,input.programId,input.packageId);
   if(pkg.version!==input.expectedVersion)fail('assistant_weekly_version_changed','周计划已更新，请刷新后确认。');
   await prepare(scope,input,pkg);
   const resolution=await orchestration.resolve(scope.tenantId,scope.userId,input.programId,{weekStart:pkg.weekStart,desiredOriginalContents:pkg.socialContentPackage.originalContentTarget+1,desiredAdaptations:pkg.socialContentPackage.adaptationVersionTarget});
   return capacityProposal(scope,input,resolution.snapshot);
  },
  async confirmCapacity(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,confirmation:{snapshotRef:{id:string;version:number};proposalHash:string;approvedPublicationQuota:number;approvedMaximumCostCny:number;confirmed:boolean}){
   await assertWeeklyScheduleActor(store,{tenantId:scope.tenantId,actorUserId:scope.userId,packageVersion:input.expectedVersion});
   const snapshot=await orchestration.getSnapshot(scope.tenantId,input.programId,confirmation.snapshotRef.id,confirmation.snapshotRef.version),proposal=await capacityProposal(scope,input,snapshot);
   if(confirmation.confirmed!==true||proposal.proposalHash!==confirmation.proposalHash||confirmation.approvedPublicationQuota!==proposal.publicationQuota||!Number.isFinite(confirmation.approvedMaximumCostCny)||confirmation.approvedMaximumCostCny<proposal.estimatedCostCny||confirmation.approvedMaximumCostCny>proposal.weeklyBudgetCny)fail('assistant_weekly_capacity_confirmation_changed','请明确确认最新的任务数量与预算。');
   if(!proposal.canAdd)fail('assistant_weekly_incremental_capacity_required','现有资源容量不足以新增此内容，请先调整企业生产容量或预算。');
   const receipt=(operationId:string)=>({state:'capacity_confirmed' as const,capacityPlanRef:proposal.capacityPlanRef,operatingDecisionSnapshotRef:proposal.snapshotRef,capacityAuthorization:{operationId,proposalHash:proposal.proposalHash,approvedPublicationQuota:confirmation.approvedPublicationQuota,approvedMaximumCostCny:confirmation.approvedMaximumCostCny},proposalHash:proposal.proposalHash,message:'已确认新增内容的周容量与预算，下一步核对具体排期。'});
   const normalizedConfirmation={snapshotRef:{id:confirmation.snapshotRef.id,version:confirmation.snapshotRef.version},proposalHash:confirmation.proposalHash,approvedPublicationQuota:confirmation.approvedPublicationQuota,approvedMaximumCostCny:confirmation.approvedMaximumCostCny,confirmed:true};
   const mutation=await executeSocialContentMutation({repository:createStarter198Repository(store),tenantId:scope.tenantId,userId:scope.userId,idempotencyKey:`assistant-weekly-capacity:${scope.userId}:${input.requestId}`,requestHash:socialRequestHash({request:capacityRequest(input),confirmation:normalizedConfirmation}),operation:'assistant_confirm_weekly_capacity',targetId:input.packageId,action:async id=>receipt(id),replay:async id=>receipt(id)});
   return mutation.value;
  },
  async scheduleInput(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){
   const budget=await approvedBudget(scope,input),graph=await schedule(scope,input).preview(scheduleScope(scope,input));
   const limits=await listContentExecutionLimits(store,scope.tenantId),now=ports.now?.()??new Date().toISOString();
   const pkg=await packages.get(scope.tenantId,input.programId,input.packageId),weekClose=weeklyReviewWindowBounds(pkg).endsAt,finishAt=new Date(Date.parse(weekClose)+48*60*60_000).toISOString();
   if(Date.parse(weekClose)<=Date.parse(now))fail('assistant_weekly_schedule_week_expired','该周已经结束，请选择当前周。');
   const resourceKey='confirmed_weekly_work',resources={[resourceKey]:{concurrency:1,workingWindows:[{startAt:now,finishAt}]}};
   let perItemBudget=pkg.socialContentPackage.perItemBudgetCny;
   if(input.operatingDecisionSnapshotRef){const snapshot=await orchestration.getSnapshot(scope.tenantId,input.programId,input.operatingDecisionSnapshotRef.id,input.operatingDecisionSnapshotRef.version);if(snapshot.constraintsRef){const rows=await store.list<Record<string,unknown>>('social_operating_constraints',{where:{tenant_id:scope.tenantId,program_id:input.programId,constraints_id:snapshot.constraintsRef.id,version:snapshot.constraintsRef.version},perPage:2});if(rows.totalItems!==1)fail('assistant_weekly_capacity_constraints_missing','已确认预算所依据的容量记录无法核对，请重新确认。');const frozen=socialObject(socialJson(rows.items[0]?.payload));if(typeof frozen?.costPerOriginalCny==='number')perItemBudget=frozen.costPerOriginalCny;}}
   if(typeof perItemBudget!=='number'||!Number.isFinite(perItemBudget)||perItemBudget<0)fail('assistant_weekly_item_budget_required','当前周计划缺少已确认单条制作预算，请先补充。');
   const constraints=Object.fromEntries(graph.tasks.map(task=>[task.taskId,{resourceKey,remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:task.schedule.stepKind==='video_generation'?perItemBudget:0,bufferMinutes:0,availableAt:now}]));
   const operationalDeadlines=Object.fromEntries(graph.tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,finishAt]));
   const capacity={constraints,resources,remainingBudgetCny:budget,operationalDeadlines};
   return {capacity,summary:[`按系统已保存的 ${graph.tasks.length} 个步骤及预计时长倒排，不代表已经完成。`,'人工与编导步骤预计按单通道顺序安排，无额外缓冲；可用窗口待你确认。',`跨周跟踪及复盘预计在报告窗口关闭后 48 小时内完成（${finishAt}），这是待确认的排期假设，不是已承诺的服务时限；原发布时间不变。`,`本次预算上限 ¥${budget}，按已确认单条成本 ¥${perItemBudget} 预留制作费用，另受 ${limits.length} 项已保存队列并发限制约束。`,'未满足审核、素材或授权的步骤仍会被阻塞；确认后还需查看实际倒排结果。'],evidence:{targetGraphHash:graph.targetGraphHash,capacityAuthorizationOperationId:input.capacityAuthorization!.operationId}};
  },
  async graph(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){return schedule(scope,input).preview(scheduleScope(scope,input));},
  async preview(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,capacity:WeeklyScheduleCapacityInput){
   const current=await packages.get(scope.tenantId,input.programId,input.packageId);
   if(current.status==='active'||input.operatingDecisionSnapshotRef||input.capacityAuthorization){if(capacity.remainingBudgetCny>await approvedBudget(scope,input))fail('assistant_weekly_budget_exceeds_confirmation','排期预算不能超过已确认上限。');}
   const proposal=await schedule(scope,input).propose(scheduleScope(scope,input),capacity);
   return {state:'awaiting_capacity_confirmation' as const,proposal,publicationTaskId:publicationId(scope,input),message:'已核对新增内容与现有任务的容量排期。新增内容的编导审核仍待确认；本次仅确认未来排期，不代表审核通过或已开始生产。'};
  },
  async confirm(scope:WeeklyContentActionScope,input:WeeklyContentActionInput,confirmation:{proposalId:string;expectedVersion:number;inputEvidenceHash:string;confirmedTemplateCarryoverPlanHashes?:string[]}){
   const service=schedule(scope,input),a=scheduleScope(scope,input);
   const current=await packages.get(scope.tenantId,input.programId,input.packageId);
   if(current.status==='active'||input.operatingDecisionSnapshotRef){const max=await approvedBudget(scope,input),proposal=await service.read(a,confirmation.proposalId);if(proposal.capacity.remainingBudgetCny>max)fail('assistant_weekly_budget_exceeds_confirmation','排期预算不能超过已确认上限。');}
   const result=await service.confirm(a,confirmation);
   const saved=await receipt(scope,input,publicationId(scope,input));
   return {...saved,materialConsumerRepairs:result.materialConsumerRepairs};
  },
  async create(scope:WeeklyContentActionScope,input:WeeklyContentActionInput){
  if(!input||!input.requestId||input.requestId.length>160||!input.programId||!input.packageId||!input.accountId||!input.productId||!input.goal?.trim()||input.goal.length>1000||!['tiktok','instagram','facebook','youtube','linkedin'].includes(input.platform)||!Number.isFinite(Date.parse(input.dueAt)))fail('assistant_weekly_content_input_invalid','请选择产品、发布账号，填写内容目标和明确的交付时间。',400);
  await assertWeeklyScheduleActor(store,{tenantId:scope.tenantId,actorUserId:scope.userId,packageVersion:input.expectedVersion});
  const publicationTaskId=`assistant_${createHash('sha256').update(JSON.stringify([scope.tenantId,scope.userId,input.packageId,input.requestId])).digest('hex').slice(0,28)}`;
  const result=await executeSocialContentMutation({repository:createStarter198Repository(store),tenantId:scope.tenantId,userId:scope.userId,idempotencyKey:`assistant-weekly-content:${scope.userId}:${input.requestId}`,requestHash:socialRequestHash(input),operation:'assistant_create_weekly_content',targetId:input.packageId,
   replay:()=>receipt(scope,input,publicationTaskId),action:async()=>{
    const pkg=await packages.get(scope.tenantId,input.programId,input.packageId);
    if(pkg.socialContentPackage.publicationTasks.some(p=>p.publicationTaskId===publicationTaskId))return receipt(scope,input,publicationTaskId);
    if(pkg.version!==input.expectedVersion)fail('assistant_weekly_version_changed','周计划已更新，请刷新后确认。');
    const tasks=await listWeeklyExecutionTasks(store,scope.tenantId,input.programId,input.packageId,pkg.version);
    // Ordinary revisions cannot carry running work. Never silently revoke a
    // live week authorization or duplicate its in-flight provider jobs.
    if(pkg.status!=='draft'||tasks.some(t=>t.attempt>0||t.lease||t.resultRefs.length||t.schedule.actualStartedAt))fail('assistant_weekly_active_replan_required','本周计划已经开始执行。新增内容需要先确认增量容量排期，原任务不会被重置。');
    const revision=await prepare(scope,input,pkg);
    const target=await packages.previewRevision(scope.tenantId,scope.userId,input.programId,input.packageId,revision);
    await assertTargetProduct(scope,input,target);
    if(!target.socialContentPackage.publicationTasks.some(p=>p.publicationTaskId===publicationTaskId))fail('assistant_weekly_incremental_capacity_required','当前确认的周容量没有新增内容名额，请先确认增量容量计划。');
    await packages.revise(scope.tenantId,scope.userId,input.programId,input.packageId,revision);
    return receipt(scope,input,publicationTaskId);
   }});
  return {...result.value,repeated:result.repeated};
 }};
}
