import type {DataStore} from '../storage/datastore.js';
import type {WeeklyPipelineStartInput,WeeklyPipelineStatus,WeeklyPipelineBlocker} from '../../shared/contracts/weeklyExecutionPipeline.js';
import {weeklyExecutionObservation} from '../runtime/weeklyExecutionObservation.js';
import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';
import {createSocialProgramService,SocialProgramError} from './service.js';
import {listWeeklyExecutionTasks,recomputePackageExecution} from './executionTasks.js';
import {WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId,readIndependentAdmission,type IndependentAdmission} from './weeklyIndependentAdmission.js';
import {auditWeeklyTasks} from './weeklyTaskAudit.js';
import {adoptWeeklyAutomationTemplate,readWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {latestPackageRow,PACKAGES} from './weeklyOperatingPackageSupport.js';
import {readWeeklyCustomerSettings,updateWeeklyCustomerSettings} from './weeklyCustomerSettings.js';
import {readTenantEnterpriseProfile} from '../routes/enterprise.js';
import {executionPackageFrozen,withExecutionPackageGate} from './weeklyExecutionGate.js';
import {readWeeklyReviewActor} from './weeklyReviewEvidence.js';
import {currentDataAuthority} from '../storage/dataAuthority.js';
import {localWeeklyExecutionRuntime} from '../runtime/localWeeklyExecutionRuntime.js';
import {createSocialOperatingOrchestrationService,weeklyAuthorityFromResolution} from '../socialOperating/orchestration.js';
import {readWeeklyExistingFactSource} from './weeklyExistingFactSource.js';
import {runWeeklyWhatsAppMock} from './weeklyWhatsAppMock.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

type Scope={tenantId:string;actorUserId:string;programId:string;packageId:string;packageVersion:number};
type WorkerState=WeeklyPipelineStatus['worker'];
export function createWeeklyExecutionPipelineService(store:DataStore,ports:{worker?:()=>WorkerState}={}){
 const packages=createWeeklyOperatingPackageService(store),programs=createSocialProgramService(store);
 const worker=(a:Scope)=>ports.worker?ports.worker():currentDataAuthority()==='local'?localWeeklyExecutionRuntime.read(a):weeklyExecutionObservation.read();
 async function context(a:Scope){
  const actor=await readWeeklyReviewActor(store,a.tenantId,a.actorUserId);
  if(!actor||actor.tenantId!==a.tenantId||actor.disabled===true||actor.active===false||['disabled','suspended'].includes(String(actor.status))||!['admin','super_admin','social_operator'].includes(String(actor.role)))throw new SocialProgramError('weekly_pipeline_actor_forbidden',403,'当前成员无周任务执行权限。');
  const [pkg,program]=await Promise.all([packages.get(a.tenantId,a.programId,a.packageId),programs.getProgram(a.tenantId,a.programId)]);
  if(pkg.version!==a.packageVersion)throw new SocialProgramError('weekly_pipeline_version_conflict',409,'周包已更新，请刷新后使用当前版本。');
  const tasks=await listWeeklyExecutionTasks(store,a.tenantId,a.programId,a.packageId,a.packageVersion);
  if(!tasks.length||new Set(tasks.map(t=>t.tenantId)).size!==1||tasks.some(t=>t.tenantId!==a.tenantId))throw new SocialProgramError('weekly_pipeline_graph_invalid',409,'缺少完整真实执行任务图。');
  return {pkg,program,tasks};
 }
 async function inspect(a:Scope):Promise<WeeklyPipelineStatus>{
  const {pkg,program,tasks}=await context(a),runtime=worker(a),plan=pkg.agentPlanning,admission=await readIndependentAdmission(store,a),blockers:WeeklyPipelineBlocker[]=[];
  const add=(code:string,message:string,action:WeeklyPipelineBlocker['action'])=>{if(!blockers.some(b=>b.code===code))blockers.push({code,message,action});};
  if(!['draft','active'].includes(pkg.status)||await executionPackageFrozen(store,a))add('weekly_pipeline_not_executable','该周版本已被替代、撤回或冻结，不能重复启动。','scope');
  for(const [field,label] of [['businessContentGoalRef','经营目标'],['capacityPlanRef','容量决策'],['automationPolicyRef','自动化策略']] as const)if(!pkg[field])add(field,`尚未绑定后端核验的${label}；需要从真实经营编排生成并以新修订承接，不能手写通过状态。`,'authority');
  for(const code of pkg.planningBlockers)add(code,`当前权威规划缺项：${code}`,'authority');
  if(tasks.some(t=>t.ownBlockingReasons.includes('weekly_initial_capacity_schedule_required')))add('weekly_initial_capacity_schedule_required','首次容量排期尚未确认；需明确工作窗口、资源并发、剩余成本及逾期计划处理。','capacity');
  if(!plan||!['confirmed','dispatched'].includes(plan.status)||!plan.userConfirmation||!plan.detailedSchedule)add('weekly_schedule_confirmation_required','真实编导分析、详细排期和所选范围尚未由用户确认。','confirmation');
  const selected=plan?.userConfirmation?.selectedSlotIds;
  const gaps=(plan?.directorGaps??[]).filter(g=>!selected||selected.includes(g.slotId));
  for(const gap of gaps)add(`analysis:${gap.code}`,`${gap.message}（${gaps.filter(g=>g.code===gap.code).length} 个槽位）`,'analysis');
  if(!runtime.started||!runtime.configuredEnabled)add('weekly_execution_worker_not_started','真实周任务执行器未启动；不能把派单或入队显示为已自动执行。','runtime');
  if(currentDataAuthority()==='local'&&!runtime.started)add('weekly_local_consumer_scope_required','当前周版本尚未接入本地独立消费者；不会借用正式数据域执行器。','runtime');
  if(runtime.state==='failed')add('weekly_execution_worker_failed','真实周任务执行器最近一次扫描失败，请先修复执行器。','runtime');
  const taskCounts:Record<string,number>={};for(const task of tasks)taskCounts[task.status]=(taskCounts[task.status]??0)+1;
  const started=pkg.status==='active'&&plan?.status==='dispatched'&&runtime.started&&runtime.configuredEnabled&&runtime.state!=='failed'&&!blockers.length;
  return {scope:{programId:a.programId,packageId:a.packageId,packageVersion:a.packageVersion},programVersion:program.version,planningVersion:plan?.version??0,packageStatus:pkg.status,planningStatus:plan?.status??null,worker:{...runtime},taskCounts,blockers,canStart:!blockers.length,started,executionPhase:started?'full':admission?'independent_branches':'not_started',independentAdmission:admission?{admittedAt:admission.admittedAt,authorizePublishing:false,authorizeMessaging:false}:null};
 }
 return {
  read:inspect,
  async runWhatsAppMock(a:Scope,input:{taskId:string}){
   if(currentDataAuthority()!=='local')throw new SocialProgramError('weekly_whatsapp_mock_local_only',403,'Mock 仅用于本地联调，不代表真实授权或业务交付。');
   return withExecutionPackageGate(store,a,async assert=>{
    const {pkg,tasks}=await context(a),task=tasks.find(t=>t.taskId===input.taskId);
    if(!task||!['draft','active'].includes(pkg.status)||await executionPackageFrozen(store,a))throw new SocialProgramError('weekly_whatsapp_mock_scope_invalid',409,'Mock 只能关联当前可操作任务。');
    await assert();return runWeeklyWhatsAppMock(store,task,a.actorUserId);
   });
  },
  async readCustomerSettings(a:Scope){await context(a);return (await readWeeklyCustomerSettings(store,a.tenantId)).public;},
  async updateCustomerSettings(a:Scope,input:{expectedConfigVersion:number;enabled:boolean;allowRealCustomerMessages:boolean}){return withExecutionPackageGate(store,a,async assert=>{const {pkg}=await context(a);if(!['draft','active'].includes(pkg.status)||await executionPackageFrozen(store,a))throw new SocialProgramError('weekly_pipeline_not_executable',409,'原周版本已冻结或停用。');const profile=await readTenantEnterpriseProfile(a.tenantId);await assert();return updateWeeklyCustomerSettings(store,a.tenantId,a.actorUserId,input,profile);});},
  async authorizePublishing(a:Scope){
   return withExecutionPackageGate(store,a,async assert=>{
    const {pkg}=await context(a);
    if(pkg.status!=='active'||await executionPackageFrozen(store,a)||pkg.agentPlanning?.status!=='dispatched')throw new SocialProgramError('weekly_publishing_scope_not_active',409,'请先完成本周真实排期与派单；草稿不能取得发布许可。');
    const row=await latestPackageRow(store,a.tenantId,a.programId,a.packageId);
    if(!row||row.payload.version!==a.packageVersion)throw new SocialProgramError('weekly_pipeline_version_conflict',409,'周包已变化，请重新读取发布范围。');
    const existing=pkg.socialContentPackage.authorization;
    const items=pkg.socialContentPackage.publicationTasks;
    if(!items.length||!Number.isSafeInteger(pkg.socialContentPackage.publicationTaskTarget)||pkg.socialContentPackage.publicationTaskTarget<1||items.some(item=>!existing.accountIds.includes(item.accountId)))throw new SocialProgramError('weekly_publishing_scope_invalid',409,'当前发布任务超出周包账号范围。');
    if(existing.allowRealPublishing&&existing.authorizedBy&&existing.authorizedAt&&!existing.revokedAt)return existing;
    const authorization={...existing,mode:'bounded' as const,maxPublishItems:pkg.socialContentPackage.publicationTaskTarget,allowRealPublishing:true,authorizedBy:a.actorUserId,authorizedAt:new Date().toISOString(),revokedBy:null,revokedAt:null};
    await assert();
    const saved=await store.update(PACKAGES,row.id,{payload:{...row.payload,socialContentPackage:{...row.payload.socialContentPackage,authorization},updatedAt:authorization.authorizedAt},updated_at:authorization.authorizedAt});
    if(!saved)throw new SocialProgramError('weekly_publishing_authorization_write_failed',503,'发布许可未能保存。');
    return authorization;
   });
  },
  async readTemplate(a:Scope){await context(a);return readWeeklyAutomationTemplate(store,a);},
  async bindExistingFacts(a:Scope){
   return withExecutionPackageGate(store,a,async assert=>{
    const {pkg,tasks}=await context(a),source=await readWeeklyExistingFactSource(store,a.tenantId);
    if(pkg.status!=='draft'||await executionPackageFrozen(store,a))throw new SocialProgramError('weekly_existing_facts_revision_forbidden',409,'只允许在当前未冻结草稿绑定已有事实。');
    const missing=pkg.socialContentPackage.publicationTasks.filter(p=>!p.factRefs.length||!p.metricTargets.length);
    if(!missing.length)return {item:pkg,source,changed:false};
    // Source edits after production/unknown receipts require the full continuation
    // protocol. Do not duplicate paid work through this convenience operation.
    if(tasks.some(t=>t.schedule.stepKind!=='customer_channel_readiness'&&(t.attempt>0||t.lease||t.resultRefs.length)))throw new SocialProgramError('weekly_existing_facts_continuation_required',409,'已有生产或未知回执，需通过保留历史的修订流程绑定事实。');
    await assert();
    await adoptWeeklyAutomationTemplate(store,a,a.actorUserId);
    const publicationTasks=pkg.socialContentPackage.publicationTasks.map(p=>({...p,factRefs:p.factRefs.length?p.factRefs:[source.ref],metricTargets:p.metricTargets.length?p.metricTargets:['真实成片交付','真实发布回执（须在生产页验收并授权）','真实数据回收；缺失保持未知，不补造表现']}));
    const scope={tenantId:a.tenantId,programId:a.programId,packageId:a.packageId,packageVersion:a.packageVersion};
    const intent={kind:'weekly_existing_facts_binding.v1',scope,targetPackageVersion:a.packageVersion+1,source,sourcePublicationHash:socialRequestHash(pkg.socialContentPackage.publicationTasks),targetPublicationHash:socialRequestHash(publicationTasks),templateSource:'automatic_template',userApproval:null,authorizesProduction:false,authorizesPublishing:false,authorizesCustomerMessages:false,actorUserId:a.actorUserId};
    const intentId=socialRequestHash(intent).slice(0,15),old=await store.getById<any>('social_weekly_fact_binding_adoptions',intentId);
    if(old&&socialRequestHash(old.payload)!==socialRequestHash(intent))throw new SocialProgramError('weekly_existing_facts_audit_conflict',409,'事实绑定来源留痕不一致。');
    if(!old&&!await store.create('social_weekly_fact_binding_adoptions',{id:intentId,tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId,package_version:a.packageVersion,payload:intent,created_at:new Date().toISOString()}))throw new SocialProgramError('weekly_existing_facts_audit_write_failed',503,'事实绑定来源尚未留痕，未修订周包。');
    const item=await packages.revise(a.tenantId,a.actorUserId,a.programId,a.packageId,{expectedVersion:a.packageVersion,changeReason:`自动采用已有企业及产品事实 ${source.ref.id}@${source.ref.version}；来源哈希 ${source.sourceHash}；序列化核验 ${source.contentVerification.mode}；绑定审计 ${intentId}；验收指标采用已确认模板；不新增事实确认或发布许可`,publicationTasks});
    await adoptWeeklyAutomationTemplate(store,{...a,packageVersion:item.version},a.actorUserId);
    return {item,source,changed:true};
   });
  },
  async adoptTemplate(a:Scope){return withExecutionPackageGate(store,a,async assert=>{const {pkg}=await context(a);if(!['draft','active'].includes(pkg.status)||await executionPackageFrozen(store,a))throw new SocialProgramError('weekly_pipeline_not_executable',409,'该周版本已冻结或停用。');await assert();return adoptWeeklyAutomationTemplate(store,a,a.actorUserId);});},
  async audit(a:Scope){const {tasks}=await context(a);return auditWeeklyTasks(store,tasks);},
  async startIndependent(a:Scope){
   // Local opt-in only. Business confirmation and outbound authorization are
   // deliberately NOT granted by this technical recovery endpoint.
   if(currentDataAuthority()!=='local')throw new SocialProgramError('weekly_independent_local_only',403,'独立分支恢复仅适用于本地数据域。');
   return withExecutionPackageGate(store,a,async assert=>{
    const {pkg}=await context(a),runtime=worker(a);
    if(!['draft','active'].includes(pkg.status)||await executionPackageFrozen(store,a))throw new SocialProgramError('weekly_pipeline_not_executable',409,'该周版本已停用或冻结。');
    if(!runtime.started||!runtime.configuredEnabled||runtime.state==='failed')throw new SocialProgramError('weekly_execution_worker_not_started',409,'请先接入当前周版本的真实本地消费者。');
    const previous=await readIndependentAdmission(store,a);
    await adoptWeeklyAutomationTemplate(store,a,a.actorUserId);
    if(!previous){
     const payload:IndependentAdmission={...a,admittedAt:new Date().toISOString(),mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false};
     await assert();
     if(!await store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(a),tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId,package_version:a.packageVersion,payload}))throw new SocialProgramError('weekly_independent_admission_write_failed',503,'未保存独立分支启用记录。');
    }
    // Existing own reasons and every DAG dependency remain intact. A retry
    // resumes a partially committed recomputation instead of approving work.
    await assert();await recomputePackageExecution(store,a.tenantId,a.programId,a.packageId,a.packageVersion);
    return {pipeline:await inspect(a),audit:await auditWeeklyTasks(store,(await context(a)).tasks)};
   });
  },
  async connectLocalConsumer(a:Scope){await context(a);return localWeeklyExecutionRuntime.connect(a);},
  async prepareAuthority(a:Scope){
   return withExecutionPackageGate(store,a,async assert=>{
    const {pkg}=await context(a);
    if(pkg.status!=='draft'||await executionPackageFrozen(store,a))throw new SocialProgramError('weekly_pipeline_authority_revision_forbidden',409,'只允许准备当前未冻结草稿的权威规划。');
    if(pkg.businessContentGoalRef&&pkg.capacityPlanRef&&pkg.automationPolicyRef)return {item:pkg,resolution:null};
    const resolution=await createSocialOperatingOrchestrationService(store).resolve(a.tenantId,a.actorUserId,a.programId,{weekStart:pkg.weekStart,desiredOriginalContents:pkg.socialContentPackage.originalContentTarget,desiredAdaptations:pkg.socialContentPackage.adaptationVersionTarget});
    // Save diagnostics, never attach a blocked resolution or forge approvals.
    if(resolution.goal.status!=='ready'||resolution.capacityPlan.status!=='ready'||!resolution.automationPolicy.automaticExecutionAllowed)return {item:null,resolution};
    await assert();
    const item=await packages.revise(a.tenantId,a.actorUserId,a.programId,a.packageId,{expectedVersion:a.packageVersion,...weeklyAuthorityFromResolution(resolution)});
    return {item,resolution};
   });
  },
  async start(a:Scope,input:WeeklyPipelineStartInput){
   if(input.authorizePublishing!==false||input.expectedPackageVersion!==a.packageVersion||!Array.isArray(input.selectedSlotIds)||!input.selectedSlotIds.length||new Set(input.selectedSlotIds).size!==input.selectedSlotIds.length)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请明确当前确认范围；启动生产不包含发布或客服发送授权。');
   return withExecutionPackageGate(store,a,async assert=>{
    const state=await inspect(a),{pkg,program}=await context(a),plan=pkg.agentPlanning!;
    if(state.blockers.length)throw new SocialProgramError('weekly_pipeline_start_blocked',409,state.blockers.map(b=>b.message).join('；'));
    if(plan.version!==input.expectedPlanningVersion||program.version!==input.expectedProgramVersion)throw new SocialProgramError('weekly_pipeline_confirmation_changed',409,'规划确认或项目版本已变化，请读取当前确认范围，不会沿用旧批准。');
    const selected=[...input.selectedSlotIds].sort(),confirmed=[...(plan.userConfirmation?.selectedSlotIds??plan.skeleton.slots.map(slot=>slot.slotId))].sort();
    if(JSON.stringify(selected)!==JSON.stringify(confirmed))throw new SocialProgramError('weekly_pipeline_scope_changed',409,'启动范围与真实用户确认不一致，未扩展或缩减已批准范围。');
    // A replay is a read of the already active graph, never another dispatch or activation.
    if(state.started)return {item:pkg,pipeline:state};
    await adoptWeeklyAutomationTemplate(store,a,a.actorUserId);
    await assert();
    if(plan.status==='confirmed')await packages.dispatchAgentSchedule(a.tenantId,a.programId,a.packageId,{expectedPackageVersion:a.packageVersion,expectedPlanningVersion:plan.version,selectedSlotIds:selected});
    await assert();
    if(pkg.status==='draft')await packages.activate(a.tenantId,a.actorUserId,a.programId,a.packageId,{expectedVersion:a.packageVersion,expectedProgramVersion:program.version,authorizePublishing:false});
    const [actual,pipeline]=await Promise.all([packages.get(a.tenantId,a.programId,a.packageId),inspect(a)]);
    if(!pipeline.started)throw new SocialProgramError('weekly_pipeline_not_started',409,'已保留实际派单或激活结果，但执行器状态未就绪；请只读恢复，勿重复批准。');
    return {item:actual,pipeline};
   });
  },
 };
}
