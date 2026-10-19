import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {LegacyWeeklyCreateInput} from './legacyWeeklyContentActions.js';
import {withDigitalEmployeeRunLock} from '../digitalEmployees/runControl.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {executeSocialContentMutation} from '../starter198/socialContentMutation.js';
import {socialJson,socialObject,socialRequestHash} from '../starter198/socialContentValidation.js';
import {normalizeDigitalEmployeeConfig,normalizeWeeklyGoal} from '../digitalEmployees/domain.js';
import {enterpriseProfileFromKnowledgeBinding} from '../digitalEmployees/configuration.js';
import {enterpriseProductIdentity} from '../lib/enterpriseProductIdentity.js';
import {normalizeVideoPlan} from '../../shared/contracts/videoCreationPlan.js';
import {buildContentBatchPlan} from '../digitalEmployees/contentBatchPlan.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {assertWeeklyScheduleActor} from '../socialPrograms/weeklyScheduleActor.js';
import {LEGACY_INCREMENTAL_COST_BLOCKER,readLegacyManualCompletion} from '../digitalEmployees/legacyIncrementalCostGuard.js';
import {contentAccepted} from '../digitalEmployees/contentAcceptance.js';
import {isDigitalEmployeeOperatingGoal} from '../digitalEmployees/overviewGoalScope.js';
type Scope={tenantId:string;userId:string};
const obj=(v:unknown)=>socialObject(socialJson(v))??{};
const weekBoundary=(value:unknown,end=false)=>{const text=String(value);return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text)?`${text}T${end?'23:59:59.999':'00:00:00'}+08:00`:text);};
function fail(code:string,message:string,status=409):never{throw new SocialProgramError(code,status,message);}
/** Reuses workflow_tasks and the production workbench, not the batch compiler.
 * Never changes the frozen plan, original task states or publication grants. */
export function createIndependentWeeklyContent(store:DataStore,ports:{materialize?:(input:Parameters<typeof import('../digitalEmployees/contentProduction.js').advanceAutomatedContentProduction>[0])=>Promise<unknown>}={}){
 async function owned(c:string,id:string,s:Scope){const r=await store.getById<Record_>(c,id);if(!r||r.tenant_id!==s.tenantId)fail('assistant_weekly_scope_missing','周任务不存在或没有访问权限。',404);return r;}
 async function findTask(s:Scope,runId:string,orderId:string){const rows=await store.list<Record_>('workflow_tasks',{where:{tenant_id:s.tenantId,run_id:runId},perPage:500});if(rows.totalItems!==rows.items.length)fail('assistant_weekly_context_incomplete','任务读取不完整。');return rows.items.find(t=>obj(obj(t.output).assistantIndependent).orderId===orderId);}
 async function receipt(s:Scope,i:LegacyWeeklyCreateInput,orderId:string){
  const plan=await owned('weekly_plans',i.planId,s),task=await findTask(s,i.runId,orderId);if(!task)fail('assistant_weekly_order_receipt_missing','独立任务暂未登记，请重试。',503);
  const rows=await store.list<Record_>('studio_projects',{where:{tenant_id:s.tenantId},perPage:1000});
  if(rows.totalItems!==rows.items.length)fail('assistant_weekly_context_incomplete','生产项目读取不完整，请稍后重试。',503);
  const project=rows.items.find(p=>{const v=obj(p.spec);return v.workflowRunId===i.runId&&v.workflowTaskId===task.id&&String(v.contentOrderId||'').split('::')[0]===orderId;});
  const proof=project?await readLegacyManualCompletion(store,s.tenantId,project):null;
  if(project)await recoverIndependentContentTask(store,s.tenantId,task,project,proof);
  return{model:'legacy' as const,state:proof?'ready_for_review':'awaiting_cost_review',goalId:i.goalId,planId:i.planId,runId:i.runId,orderId,batchPlanId:'',taskId:task.id,projectId:project?.id||'',planVersion:Number(obj(obj(plan.plan).businessPackage).revision||0),planHash:socialRequestHash(obj(plan.plan)),blockerCode:proof?'':'needs_cost_approval',message:proof?'真实交付物已回收到独立周任务卡，等待验收。':'已创建独立周任务和生产项目，未启动付费生成；原周计划及发布授权不受影响。',navigation:project?{page:'smartAssets',href:`/?page=smartAssets&project=${encodeURIComponent(project.id)}`}:{page:'digitalEmployees',href:`/?page=digitalEmployees&goalId=${encodeURIComponent(i.goalId)}&planId=${encodeURIComponent(i.planId)}`}};
 }
 return{async create(s:Scope,i:LegacyWeeklyCreateInput){
  if(!i.requestId||i.requestId.length>160||!/^[a-f0-9]{64}$/.test(i.expectedPlanHash)||!i.goal?.trim()||i.goal.length>1000||!['tiktok','facebook','instagram','youtube'].includes(i.platform)||!Number.isFinite(Date.parse(i.dueAt))||i.publishMode!=='draft_only'||i.confirmAdditionalBudget!==true||!Number.isFinite(i.maximumAdditionalCostCny)||i.maximumAdditionalCostCny<0||i.maximumAdditionalCostCny>10000)fail('assistant_weekly_create_input_invalid','请明确产品、目标、交付时间和费用上限；创建不会启动付费生成。',400);
  await assertWeeklyScheduleActor(store,{tenantId:s.tenantId,actorUserId:s.userId,packageVersion:1});
  const orderId=`assistant_order_${createHash('sha256').update(JSON.stringify([s.tenantId,i.runId,i.requestId])).digest('hex').slice(0,24)}`,hash=socialRequestHash(i);
  const mutation=await executeSocialContentMutation({repository:createStarter198Repository(store),tenantId:s.tenantId,userId:s.userId,idempotencyKey:`assistant-independent:${s.userId}:${i.requestId}`,requestHash:hash,operation:'assistant_independent_weekly_content',targetId:i.runId,replay:()=>receipt(s,i,orderId),action:()=>withDigitalEmployeeRunLock(s.tenantId,i.runId,async()=>{
   const[run,plan,goal]=await Promise.all([owned('workflow_runs',i.runId,s),owned('weekly_plans',i.planId,s),owned('weekly_goals',i.goalId,s)]);
   if(!isDigitalEmployeeOperatingGoal({metric:goal.metric,scope:goal.scope})||run.goal_id!==goal.id||run.plan_id!==plan.id||plan.goal_id!==goal.id||!['running','waiting_external','waiting_approval','waiting_human'].includes(String(run.status))||goal.status!=='active')fail('assistant_weekly_run_not_active','请选择当前仍在执行的周任务。');
   const prior=await findTask(s,i.runId,orderId);if(prior){if(obj(obj(prior.output).assistantIndependent).requestHash!==hash)fail('assistant_weekly_request_changed','同一次请求内容已变化。');return{taskId:prior.id};}
   const body=obj(plan.plan);if(socialRequestHash(body)!==i.expectedPlanHash)fail('assistant_weekly_plan_changed','周计划已更新，请刷新确认。');
   if(!Number.isFinite(weekBoundary(goal.starts_at))||!Number.isFinite(weekBoundary(goal.ends_at,true))||Date.parse(i.dueAt)<=Date.now()||Date.parse(i.dueAt)<weekBoundary(goal.starts_at)||Date.parse(i.dueAt)>weekBoundary(goal.ends_at,true))fail('assistant_weekly_due_outside_week','请选择本周内的未来交付时间。');
   const profile=enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding,{allowLegacy:false});if(!profile)fail('assistant_weekly_frozen_facts_missing','请补齐企业产品资料。');
   const products=(profile.products?.items??[]).map((p,index)=>({p,id:enterpriseProductIdentity(p,index)})).filter(p=>p.id===i.productId);if(products.length!==1)fail('assistant_weekly_product_not_frozen','请选择已确认的企业产品。');
   const config=normalizeDigitalEmployeeConfig(obj(body.configSnapshot)),video=normalizeVideoPlan({...config.videoDefaults,contentId:orderId,contentFamilyId:orderId,productionRole:'master',route:'product',productId:i.productId,productName:String(products[0]!.p.name),theme:'产品介绍',buyerProblem:i.goal.trim(),platform:i.platform,presenter:'material',plannedPublishDate:i.dueAt,estimatedCost:i.maximumAdditionalCostCny,directorStatus:'candidate'});
   const draft=buildContentBatchPlan({goalId:goal.id,goal:normalizeWeeklyGoal({title:String(goal.title),objective:i.goal,metric:String(goal.metric),startsAt:String(goal.starts_at),endsAt:String(goal.ends_at),contentPlatforms:[i.platform],videoPlans:[video]},config),config:{...config,publishingTargets:[],enabledWorkflows:['product_content']},evidence:{products:[{id:i.productId,name:String(products[0]!.p.name),materialIds:[]}],exactAnalysisIds:[],materialIds:[]},versions:{configVersion:1,policyVersion:'independent',factsVersion:'frozen_week'}});
   if(draft.orders.length!==1)fail('assistant_weekly_order_not_admitted','内容订单暂时无法建立。');
   const order={...draft.orders[0]!,id:orderId,deliveryVariants:[],accountId:'',accountLabel:'仅制作，不发布',languages:[video.language],publishMode:'draft_only',maximumAdditionalCostCny:i.maximumAdditionalCostCny,assistantAdmission:true,costApprovalStatus:'needs_cost_approval',readinessBlockers:[LEGACY_INCREMENTAL_COST_BLOCKER]},now=new Date().toISOString();
   const row=await store.create('workflow_tasks',{tenant_id:s.tenantId,goal_id:goal.id,plan_id:plan.id,run_id:run.id,task_key:'content_production',title:`单条内容 · ${products[0]!.p.name}`,description:i.goal.trim(),agent_role:'content',kind:'executor',status:'waiting_external',sequence:1000,priority:'normal',requires_approval:false,depends_on:[],owner_id:s.userId,business_domain:'content',capability_key:'content.production',destination:'smartAssets',destination_view:'production',execution_mode:'draft_executor',external_effect:'draft',automatic_execution_allowed:false,policy_source:'assistant_independent_content',blocked_reason:LEGACY_INCREMENTAL_COST_BLOCKER,output:{assistantIndependent:{orderId,order,requestHash:hash,dueAt:i.dueAt,createdBy:s.userId,createdAt:now}},business_refs:[],created_at:now,updated_at:now});
   if(!row)fail('assistant_weekly_task_write_failed','独立任务无法保存，请重试。',503);return{taskId:row.id};
  })});
  const registered=await receipt(s,i,orderId);if(mutation.repeated&&registered.projectId)return{...registered,repeated:true};
  const[plan,goal,task]=await Promise.all([owned('weekly_plans',i.planId,s),owned('weekly_goals',i.goalId,s),owned('workflow_tasks',registered.taskId,s)]),body=obj(plan.plan),profile=enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding,{allowLegacy:false}),config=normalizeDigitalEmployeeConfig(obj(body.configSnapshot));
  if(!profile)fail('assistant_weekly_frozen_facts_missing','企业资料暂时无法读取。');
  const materialize=ports.materialize??(async input=>(await import('../digitalEmployees/contentProduction.js')).advanceAutomatedContentProduction(input));
  await materialize({tenantId:s.tenantId,runId:i.runId,taskId:task.id,config:{...config,enabledWorkflows:['product_content']},goal:normalizeWeeklyGoal({title:String(goal.title),objective:i.goal,metric:String(goal.metric),startsAt:String(goal.starts_at),endsAt:String(goal.ends_at)},config),enterpriseProfile:profile as any,contentOrders:[obj(obj(task.output).assistantIndependent).order as any],materializeOnly:true});
  const result=await receipt(s,i,orderId);if(!result.projectId)fail('assistant_weekly_project_not_materialized','独立任务已保存，生产项目暂未建立，请重试；未启动付费生成。',503);return{...result,repeated:mutation.repeated};
 }};
}

/** Read-only proof recovery: no model, paid provider or batch execution. */
export async function recoverIndependentContentTask(store:DataStore,tenantId:string,task:Record_,project:Record_,proof?:Awaited<ReturnType<typeof readLegacyManualCompletion>>){
 if(task.tenant_id!==tenantId||project.tenant_id!==tenantId||obj(project.spec).workflowTaskId!==task.id||obj(project.spec).workflowRunId!==task.run_id||!obj(task.output).assistantIndependent)throw Error('independent_content_scope_mismatch');
 if(['cancelled','handed_off'].includes(String(task.status)))return;
 if(String(obj(project.spec).contentOrderId||'').split('::')[0]!==obj(obj(task.output).assistantIndependent).orderId)throw Error('independent_content_order_mismatch');
 const delivery=proof===undefined?await readLegacyManualCompletion(store,tenantId,project):proof;
 const spec=obj(project.spec),automation=obj(spec.automation),oldProof=obj(automation.manualStudioCompletion);
 if(delivery&&(automation.stage!=='completed'||oldProof.sha256!==delivery.sha256||oldProof.inputFingerprint!==delivery.inputFingerprint)){
  const next={...spec,renderOutputPath:delivery.outputPath,automation:{...automation,stage:'completed',status:'ready_for_approval',blocker:'',renderOutputPath:delivery.outputPath,manualStudioCompletion:delivery,quality:{passed:true,source:'verified_manual_studio',ruleVersion:'studio-project-quality-v1',qualityRecordId:delivery.qualityRecordId},completedAt:delivery.verifiedAt}};
  if(!await store.update('studio_projects',project.id,{spec:next,status:'ready_for_approval'}))throw Error('independent_project_recovery_write_failed');
  project.spec=next;project.status='ready_for_approval';
 }else if(!delivery&&automation.manualStudioCompletion&&automation.stage==='completed'){
  const next={...spec,automation:{...automation,stage:'blocked',status:'blocked',blocker:LEGACY_INCREMENTAL_COST_BLOCKER,quality:{...obj(automation.quality),passed:false}}};
  if(!await store.update('studio_projects',project.id,{spec:next,status:'draft'}))throw Error('independent_project_recovery_write_failed');
  project.spec=next;project.status='draft';
 }
 const accepted=Boolean(delivery&&contentAccepted(obj(project.spec))),message=delivery?(accepted?'交付物已验收':'交付物已回收，等待验收'):LEGACY_INCREMENTAL_COST_BLOCKER;
 const patch={status:accepted?'succeeded':'waiting_external',blocked_reason:accepted?'':message,business_refs:[{type:'studio_project',id:project.id}],output:{...obj(task.output),projectId:project.id,delivery:delivery??null,waitState:accepted?null:{kind:'manual',message,requiresAttention:true}},updated_at:new Date().toISOString()};
 if(!await store.update('workflow_tasks',task.id,patch))throw Error('independent_content_recovery_write_failed');
 Object.assign(task,patch);
}
