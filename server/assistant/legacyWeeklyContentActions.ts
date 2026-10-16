import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {withDigitalEmployeeRunLock} from '../digitalEmployees/runControl.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {executeSocialContentMutation} from '../starter198/socialContentMutation.js';
import {socialJson,socialObject,socialRequestHash} from '../starter198/socialContentValidation.js';
import {normalizeDigitalEmployeeConfig,normalizeWeeklyGoal} from '../digitalEmployees/domain.js';
import {enterpriseProfileFromKnowledgeBinding} from '../digitalEmployees/configuration.js';
import {enterpriseProductIdentity} from '../lib/enterpriseProductIdentity.js';
import {normalizeVideoPlan} from '../../shared/contracts/videoCreationPlan.js';
import {buildContentBatchPlan,type ContentOrder} from '../digitalEmployees/contentBatchPlan.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {assertWeeklyScheduleActor} from '../socialPrograms/weeklyScheduleActor.js';
import {LEGACY_INCREMENTAL_COST_BLOCKER,readLegacyManualCompletion} from '../digitalEmployees/legacyIncrementalCostGuard.js';
import {isDigitalEmployeeOperatingGoal} from '../digitalEmployees/overviewGoalScope.js';
export interface LegacyWeeklyCreateInput {requestId:string;goalId:string;planId:string;runId:string;expectedPlanHash:string;productId:string;goal:string;platform:'tiktok'|'facebook'|'instagram'|'youtube';dueAt:string;maximumAdditionalCostCny:number;confirmAdditionalBudget:boolean;acknowledgePublishingRevocation:boolean;publishMode:'draft_only';}
type Scope={tenantId:string;userId:string};
const obj=(v:unknown)=>socialObject(socialJson(v))??{};
const arr=(v:unknown):any[]=>{const p=socialJson(v);return Array.isArray(p)?p:[];};
function fail(code:string,message:string,status=409):never{throw new SocialProgramError(code,status,message);}
export const legacyWeeklyPlanHash=(value:unknown)=>socialRequestHash(obj(value));
/** Incremental admission uses the visible legacy week and its existing batch,
 * never a parallel task system. Original orders/projects/receipts are untouched. */
export function createLegacyWeeklyContentActions(store:DataStore,ports:{reconcile?:(tenantId:string,runId:string)=>Promise<void>;invalidatePublishing?:(tenantId:string,runId:string)=>Promise<unknown>;materialize?:(input:Parameters<typeof import('../digitalEmployees/contentProduction.js').advanceAutomatedContentProduction>[0])=>Promise<unknown>}={}){
 async function owned(collection:string,id:string,scope:Scope){const row=await store.getById<Record_>(collection,id);if(!row||row.tenant_id!==scope.tenantId)fail('assistant_weekly_scope_missing','当前周任务不存在或没有访问权限。',404);return row;}
 async function receipt(scope:Scope,input:LegacyWeeklyCreateInput,orderId:string){
  const plan=await owned('weekly_plans',input.planId,scope),batches=await store.list<Record_>('content_batch_plans',{where:{tenant_id:scope.tenantId,run_id:input.runId},sort:'-created_at',perPage:100});
  const batch=batches.items.find(b=>arr(b.orders).some(o=>o.id===orderId));if(!batch)fail('assistant_weekly_order_receipt_missing','内容订单尚未完成登记，请重试。',503);
  const tasks=await store.list<Record_>('workflow_tasks',{where:{tenant_id:scope.tenantId,run_id:input.runId},perPage:100}),task=tasks.items.find(t=>t.task_key==='content_production');if(!task)fail('assistant_weekly_production_task_missing','当前周没有内容制作执行节点。');
  const projects=await store.list<Record_>('studio_projects',{where:{tenant_id:scope.tenantId},sort:'-created_at',perPage:1000}),project=projects.items.find(p=>{const spec=obj(p.spec);return spec.workflowRunId===input.runId&&spec.workflowTaskId===task.id&&String(spec.contentOrderId||'').split('::')[0]===orderId;});
  const recovered=project?await readLegacyManualCompletion(store,scope.tenantId,project):null;
  return {model:'legacy' as const,state:recovered?'ready_for_review':'awaiting_cost_review',goalId:input.goalId,planId:input.planId,runId:input.runId,orderId,batchPlanId:batch.id,taskId:task.id,projectId:project?.id||'',planVersion:Number(obj(obj(plan.plan).businessPackage).revision||0),planHash:legacyWeeklyPlanHash(plan.plan),blockerCode:recovered?'':'needs_cost_approval',message:recovered?'生产工作台的真实成片与质检结果已回收，等待周任务验收；发布保持关闭。':project?'已加入本周任务并创建生产项目。请在生产工作台核对费用后继续；尚未调用付费生成，发布保持关闭。':LEGACY_INCREMENTAL_COST_BLOCKER,navigation:project?{page:'smartAssets',href:`/?page=smartAssets&project=${encodeURIComponent(project.id)}`}:{page:'digitalEmployees',href:`/?page=digitalEmployees&goalId=${encodeURIComponent(input.goalId)}&planId=${encodeURIComponent(input.planId)}`}};
 }
 return {async create(scope:Scope,input:LegacyWeeklyCreateInput){
  if(input.acknowledgePublishingRevocation!==true)fail('assistant_weekly_publishing_revocation_acknowledgment_required','新增内容会暂停原周包尚未执行的发布授权，需重新确认后恢复；请先明确同意。',400);
  if(!input.requestId||input.requestId.length>160||!/^[a-f0-9]{64}$/.test(input.expectedPlanHash)||!input.goal?.trim()||input.goal.length>1000||!['tiktok','facebook','instagram','youtube'].includes(input.platform)||!Number.isFinite(Date.parse(input.dueAt))||input.publishMode!=='draft_only'||input.confirmAdditionalBudget!==true||!Number.isFinite(input.maximumAdditionalCostCny)||input.maximumAdditionalCostCny<=0||input.maximumAdditionalCostCny>10000)fail('assistant_weekly_create_input_invalid','请明确产品、内容目标、交付时间，并确认新增制作预算；本次仅制作不发布。',400);
  await assertWeeklyScheduleActor(store,{tenantId:scope.tenantId,actorUserId:scope.userId,packageVersion:1});
  const orderId=`assistant_order_${createHash('sha256').update(JSON.stringify([scope.tenantId,input.runId,input.requestId])).digest('hex').slice(0,24)}`,requestHash=socialRequestHash(input);
  const mutation=await executeSocialContentMutation({repository:createStarter198Repository(store),tenantId:scope.tenantId,userId:scope.userId,idempotencyKey:`assistant-legacy-content:${scope.userId}:${input.requestId}`,requestHash,operation:'assistant_legacy_weekly_content',targetId:input.runId,replay:()=>receipt(scope,input,orderId),action:()=>withDigitalEmployeeRunLock(scope.tenantId,input.runId,async()=>{
   const [run,plan,goal]=await Promise.all([owned('workflow_runs',input.runId,scope),owned('weekly_plans',input.planId,scope),owned('weekly_goals',input.goalId,scope)]);
   if(!isDigitalEmployeeOperatingGoal({metric:goal.metric,scope:goal.scope}))fail('assistant_operating_week_required','请选择智能经营中的真实周任务，不是内容桥接记录。');
   if(run.goal_id!==input.goalId||run.plan_id!==input.planId||plan.goal_id!==input.goalId||!['running','waiting_external','waiting_approval','waiting_human'].includes(String(run.status)))fail('assistant_weekly_run_not_active','请从当前仍在执行的周任务中新增内容。');
   if(goal.status!=='active')fail('assistant_weekly_goal_not_active','当前周目标已暂停或结束，请先恢复当前周任务。');
   if(plan.status!=='approved')fail('assistant_weekly_plan_not_approved','请先确认当前周计划，再新增内容任务。');
   const body=obj(plan.plan),pack=obj(body.businessPackage),admissions=obj(body.assistantContentAdmissions),previous=obj(admissions[input.requestId]);
   if(previous.requestHash&&previous.requestHash!==requestHash)fail('assistant_weekly_request_changed','同一次新增任务的内容已变化，请重新确认。');
   if(!previous.requestHash&&legacyWeeklyPlanHash(body)!==input.expectedPlanHash)fail('assistant_weekly_plan_changed','周任务计划已更新，请刷新后重新确认。');
   const batches=await store.list<Record_>('content_batch_plans',{where:{tenant_id:scope.tenantId,run_id:input.runId},sort:'-created_at',perPage:100});if(batches.items.length!==batches.totalItems)fail('assistant_weekly_batch_ambiguous','内容订单读取不完整，未修改周任务。');
   const batch=batches.items[0];if(!batch||batch.status!=='planned')fail('assistant_weekly_batch_not_ready','当前周最新内容订单尚未确认，请先完成编导计划。');
   const tasks=await store.list<Record_>('workflow_tasks',{where:{tenant_id:scope.tenantId,run_id:input.runId},perPage:100}),production=tasks.items.find(t=>t.task_key==='content_production');if(!production)fail('assistant_weekly_production_task_missing','当前周没有内容制作执行节点。');
   if(['cancelled','handed_off','failed'].includes(String(production.status)))fail('assistant_weekly_production_controlled','原内容任务已停止或转交，请先在周任务中确认恢复方式。');
   const profile=enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding,{allowLegacy:false});if(!profile)fail('assistant_weekly_frozen_facts_missing','当前周缺少冻结的企业产品资料，请先补齐原周任务资料。');
   const products=profile.products?.items??[],matches=products.map((p,index)=>({p,id:enterpriseProductIdentity(p,index)})).filter(p=>p.id===input.productId);if(matches.length!==1)fail('assistant_weekly_product_not_frozen','请选择当前周任务已确认的企业产品。');
   const product=matches[0]!,config=normalizeDigitalEmployeeConfig(obj(body.configSnapshot));if(!config.enabledWorkflows.includes('product_content'))fail('assistant_weekly_product_pipeline_disabled','当前周尚未启用产品内容制作管线。');
   if(Date.parse(input.dueAt)<Date.parse(String(goal.starts_at))||Date.parse(input.dueAt)>Date.parse(String(goal.ends_at)))fail('assistant_weekly_due_outside_week','交付时间须处于当前周任务的时间范围内。');
   const videoPlan=normalizeVideoPlan({...config.videoDefaults,contentId:orderId,contentFamilyId:orderId,productionRole:'master',route:'product',productId:input.productId,productName:String(product.p.name),theme:'产品介绍',buyerProblem:input.goal.trim(),platform:input.platform,presenter:'material',plannedPublishDate:input.dueAt,estimatedCost:input.maximumAdditionalCostCny,directorStatus:'candidate'});
   const draft=buildContentBatchPlan({goalId:input.goalId,goal:normalizeWeeklyGoal({title:String(goal.title),objective:String(goal.objective),metric:String(goal.metric),startsAt:String(goal.starts_at),endsAt:String(goal.ends_at),contentPlatforms:[input.platform],videoPlans:[videoPlan]},config),config:{...config,publishingTargets:[],enabledWorkflows:config.enabledWorkflows.filter(w=>w!=='content_publish')},evidence:{products:[{id:input.productId,name:String(product.p.name),materialIds:[]}],exactAnalysisIds:[],materialIds:[]},versions:{configVersion:Number(batch.config_version||1),policyVersion:String(batch.policy_version||'unknown'),factsVersion:String(batch.facts_version||'unknown')}});
   if(draft.status!=='planned'||draft.orders.length!==1)fail('assistant_weekly_order_not_admitted',draft.blocker||'新增内容条件不完整，未启动制作。');
   const order:ContentOrder&{publishMode:'draft_only';maximumAdditionalCostCny:number;assistantAdmission:true;costApprovalStatus:'needs_cost_approval'}={...draft.orders[0]!,id:orderId,deliveryVariants:[],accountId:'',accountLabel:'仅制作，不发布',languages:[videoPlan.language],publishMode:'draft_only',maximumAdditionalCostCny:input.maximumAdditionalCostCny,assistantAdmission:true,costApprovalStatus:'needs_cost_approval',readinessBlockers:[...draft.orders[0]!.readinessBlockers??[],LEGACY_INCREMENTAL_COST_BLOCKER]};
   // Write the frozen plan receipt first. A partial retry recognises it and
   // repairs batch/task admission without adding another item or budget.
   if(!previous.requestHash){const packTasks=arr(pack.tasks),slot=packTasks.find(t=>t.templateId==='production');if(!slot)fail('assistant_weekly_production_plan_missing','本周缺少已确认内容排期。');const nextPack={...pack,revision:Number(pack.revision||0)+1,tasks:packTasks.map(t=>t===slot?{...t,videoPlans:[...arr(t.videoPlans),videoPlan]}:t),authorization:{...obj(pack.authorization),allowRealPublishing:false},...(pack.directorPlan?{directorPlan:{...obj(pack.directorPlan),productionBudget:Number(obj(pack.directorPlan).productionBudget||0)+input.maximumAdditionalCostCny,productionReserved:Number(obj(pack.directorPlan).productionReserved||0)+input.maximumAdditionalCostCny,originalTarget:Number(obj(pack.directorPlan).originalTarget||0)+1}}:{})};const next={...body,businessPackage:nextPack,packageApprovedBy:'',packageGrantInvalidatedAt:new Date().toISOString(),assistantContentAdmissions:{...admissions,[input.requestId]:{requestHash,orderId,maximumAdditionalCostCny:input.maximumAdditionalCostCny,createdBy:scope.userId,createdAt:new Date().toISOString()}}};if(!await store.update('weekly_plans',plan.id,{plan:next}))fail('assistant_weekly_plan_write_failed','周排期暂时无法保存，请重试。',503);}
   const orders=arr(batch.orders);if(!orders.some(o=>o.id===orderId)&&!await store.update('content_batch_plans',batch.id,{orders:[...orders,order],updated_at:new Date().toISOString()}))fail('assistant_weekly_batch_write_failed','内容订单暂时无法保存，请重试。',503);
   // The run lock is AsyncLocalStorage-reentrant. Keep revocation and the
   // reopen writes in one atomic run boundary; the revoker safely re-enters it.
   const invalidate=ports.invalidatePublishing??(async(t:string,r:string)=>(await import('../digitalEmployees/publishingExecution.js')).invalidatePublishingAuthorizationForRun(t,r));await invalidate(scope.tenantId,input.runId);
   for(const task of tasks.items.filter(t=>['content_production','content_quality_gate','content_release_approval','publishing_calendar','platform_publish'].includes(String(t.task_key)))){if(!await store.update('workflow_tasks',task.id,{status:'pending',blocked_reason:'',...(task.task_key==='content_release_approval'?{requires_approval:true}:{}),updated_at:new Date().toISOString()}))fail('assistant_weekly_task_write_failed','执行节点暂时无法登记，请重试。',503);}
   return receipt(scope,input,orderId);
  })});
  const registered=await receipt(scope,input,orderId);
  if(mutation.repeated&&registered.projectId)return {...registered,repeated:true};
  const savedPlan=await owned('weekly_plans',input.planId,scope),savedGoal=await owned('weekly_goals',input.goalId,scope),body=obj(savedPlan.plan),profile=enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding,{allowLegacy:false});
  if(!profile)fail('assistant_weekly_frozen_facts_missing','已登记订单的企业资料暂时无法核对。');
  const batches=await store.list<Record_>('content_batch_plans',{where:{tenant_id:scope.tenantId,run_id:input.runId},sort:'-created_at',perPage:100}),batch=batches.items.find(b=>b.id===registered.batchPlanId),config=normalizeDigitalEmployeeConfig(obj(body.configSnapshot));
  if(!batch)fail('assistant_weekly_order_receipt_missing','已登记的内容订单暂时无法读取。',503);
  const materialize=ports.materialize??(async input=>(await import('../digitalEmployees/contentProduction.js')).advanceAutomatedContentProduction(input));
  await materialize({tenantId:scope.tenantId,runId:input.runId,taskId:registered.taskId,config,goal:normalizeWeeklyGoal({title:String(savedGoal.title),objective:String(savedGoal.objective),metric:String(savedGoal.metric),startsAt:String(savedGoal.starts_at),endsAt:String(savedGoal.ends_at)},config),enterpriseProfile:profile as any,batchPlanId:batch.id,contentOrders:arr(batch.orders),materializeOnly:true});
  if(!(await receipt(scope,input,orderId)).projectId)fail('assistant_weekly_project_not_materialized','任务已登记，但真实生产项目尚未创建，请重试；没有启动付费生成。',503);
  // Only after durable admission; worker keeps per-order identities and
  // creates missing projects, preserving existing render/publish receipts.
  const reconcile=ports.reconcile??(async(t:string,r:string)=>(await import('../routes/digitalEmployees.js')).reconcileDigitalEmployeeRun(t,r));
  await reconcile(scope.tenantId,input.runId);
  return {...await receipt(scope,input,orderId),repeated:mutation.repeated};
 }};
}
