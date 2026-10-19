import { createSocialWeeklyProducerEvidenceRouter } from './socialWeeklyProducerEvidence.js';
import {createWeeklyAutomaticScheduleRouter} from './weeklyAutomaticSchedule.js';
import {createSocialWeeklyInventoryReuseRouter} from './socialWeeklyInventoryReuse.js';
import {createWeeklyInventoryReuseService} from '../socialPrograms/weeklyInventoryReuse.js';
import {createSocialWeeklyProfileUpgradeRouter} from './socialWeeklyProfileUpgrade.js';
import {createWeeklyProfileUpgradeService} from '../socialPrograms/weeklyProfileUpgrade.js';
import { createSocialCrossWeekMaterialContinuationsRouter } from './socialCrossWeekMaterialContinuations.js';
import { createSocialWeeklyCustomerKnowledgeQuoteRouter } from './socialWeeklyCustomerKnowledgeQuote.js';
import { createSocialWeeklyPublicationRecoveryRouter } from './socialWeeklyPublicationRecovery.js';
import { createWeeklyPublicationRecoveryService } from '../socialPrograms/weeklyPublicationRecovery.js';
import { createSocialWeeklyNativeSendRecoveryRouter } from './socialWeeklyNativeSendRecovery.js';
import { createWeeklyNativeSendRecoveryService } from '../socialPrograms/weeklyNativeSendRecovery.js';
import { createSocialWeeklyNativeDispatchRouter } from './socialWeeklyNativeDispatch.js';
import { createWeeklyNativeFollowupDispatchService } from '../digitalEmployees/weeklyNativeFollowupDispatch.js';
import { Router, type RequestHandler } from 'express';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { createSocialProgramService, SocialProgramError } from '../socialPrograms/service.js';
import { readWeeklyCancellation } from '../socialPrograms/weeklyCancellation.js';
import {readWeeklyCancellationSettlements} from '../socialPrograms/weeklyCancellationSettlement.js';
import {recheckWeeklyRequiredMaterials} from '../socialPrograms/weeklyRequiredMaterialRecovery.js';
import {readWeeklyContentNavigation} from '../socialPrograms/weeklyContentNavigation.js';
import {readWeeklyReferenceReviewNavigation} from '../socialPrograms/weeklyReferenceReviewNavigation.js';
import {backfillWeeklyTaskWorkspaces,readWeeklyTaskWorkspace} from '../socialPrograms/weeklyTaskWorkspaces.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import {createWeeklyExecutionPipelineService} from '../socialPrograms/weeklyExecutionPipeline.js';
import { createSocialOperatingOrchestrationService, weeklyAuthorityFromResolution } from '../socialOperating/orchestration.js';
import { SocialOperatingDecisionError } from '../socialOperating/service.js';
import type { OperatingPlanningRequest } from '../../shared/contracts/socialOperatingDecision.js';
import { createWeeklyExecutionTaskService } from '../socialPrograms/executionTasks.js';
import { revokePublicationAssignments } from '../publishing/weeklyLineage.js';
import { assessWeeklyRecovery } from '../socialPrograms/weeklyRecoveryAssessment.js';
import { planWeeklyBackwardSchedule } from '../socialPrograms/weeklyBackwardSchedule.js';
import { bindWeeklyCustomerRun, readWeeklyCustomerStep, readWeeklyCustomerCalendar, listWeeklyCustomerRunCandidates, type WeeklyCustomerStep } from '../runtime/socialWeeklyCustomerBridge.js';
import { savePublicationReceptionBinding } from '../socialPrograms/publicationReceptionService.js';
import { createSocialWeeklyMaterialRequestsRouter } from './socialWeeklyMaterialRequests.js';
import { createSocialWeeklySalesHandoffsRouter } from './socialWeeklySalesHandoffs.js';
import { createSocialWeeklyCustomerSendRecoveryRouter } from './socialWeeklyCustomerSendRecovery.js';
import { createSocialWeeklyCustomerChannelScopeRouter } from './socialWeeklyCustomerChannelScope.js';
import { createWeeklyCustomerSendRecoveryService } from '../socialPrograms/weeklyCustomerSendRecovery.js';
import { createSocialWeeklySalesConversationEvidenceRouter } from './socialWeeklySalesConversationEvidence.js';
import { createSocialWeeklyScheduleRevisionsRouter } from './socialWeeklyScheduleRevisions.js';
import { createWeeklyInitialScheduleRouter } from './weeklyInitialSchedule.js';
import { createSocialWeeklyMaterialEvidenceConfigurationRouter } from './socialWeeklyMaterialEvidenceConfiguration.js';
import { createSocialCustomerFeedbackTopicsRouter } from './socialCustomerFeedbackTopics.js';
import { projectWeeklyContinuationCalendar } from '../socialPrograms/weeklyContinuationCalendar.js';
import { listUnplannedSocialDeliveryCards, projectWeeklyDeliveryCards } from '../socialPrograms/weeklyDeliveryCards.js';
import { createSocialWeeklyContentTemplatesRouter } from './socialWeeklyContentTemplates.js';
import { createSocialWeeklyReviewEvidenceRouter } from './socialWeeklyReviewEvidence.js';
import { createSocialWeeklyRunningResourceEvidenceRouter } from './socialWeeklyRunningResourceEvidence.js';
import { createSocialWeeklySupplementRequestsRouter } from './socialWeeklySupplementRequests.js';
import {createWeeklyProductionRepairCaseService} from '../socialPrograms/weeklyProductionRepairCases.js';
import {createWeeklyTechnicalRepairCompletionService} from '../socialPrograms/weeklyTechnicalRepairCompletion.js';
import {createWeeklyCreativeRepairConfigurationService} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {createWeeklyCreativeRepairExecutionService} from '../socialPrograms/weeklyCreativeRepairExecution.js';
import {createWeeklyCreativeRepairCompletionService} from '../socialPrograms/weeklyCreativeRepairCompletion.js';
import {createWeeklyCreativeRepairProductionPort} from '../runtime/weeklyCreativeRepairProductionPort.js';
import {createSocialWeeklyCreativeRepairExecutionRouter} from './socialWeeklyCreativeRepairExecution.js';
import {assertSocialSceneReworkQueueRegistered,wakeSocialSceneReworkJob} from '../starter198/socialContentProductionQueue.js';
import {readWeeklyCtaContactCard,saveWeeklyCtaContact} from '../socialPrograms/weeklyCtaContact.js';
import {readWeeklyPublicationProductSelectionChoices,issueWeeklyPublicationProductSelections} from '../socialPrograms/weeklyPublicationProductSelection.js';
import {assertWeeklySamplePolicyCandidateActor,readWeeklySamplePolicyCandidateContext,submitWeeklySamplePolicyCandidate,type SamplePolicyTerms} from '../socialPrograms/weeklySamplePolicyEvidence.js';
import {readWeeklyReviewActor} from '../socialPrograms/weeklyReviewEvidence.js';
import {organizationRoleOrNull} from '../lib/organizationRole.js';
import {readWeeklyPinnableReferenceOptions} from '../socialPrograms/planningAuthority.js';
import {readWeeklyCollectionBudgetCard,readWeeklyCollectionBudgetContext,readWeeklyCollectionRuntimeCard} from '../socialPrograms/weeklyCollectionBudgetCard.js';
import {issueWeeklyAccountCollectionBudgetAuthorization} from '../socialDiscovery/weeklyAccountCollectionBudget.js';

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

type RouteBody = Record<string, unknown>;
function routeBody(value: unknown): RouteBody | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RouteBody : null;
}
function samplePolicyRouteError(error: unknown): never {
  if(error instanceof Error&&/^weekly_sample_policy_[a-z_]+$/.test(error.message)){
    const code=error.message;
    const status=code==='weekly_sample_policy_package_missing'?404:code==='weekly_sample_policy_actor_invalid'?403:code==='weekly_sample_policy_source_invalid'||code==='weekly_sample_policy_terms_invalid'||code==='weekly_sample_policy_context_hash_invalid'?400:409;
    throw new SocialProgramError(code,status,code);
  }
  throw error;
}
function samplePolicyPdf(value:unknown):Buffer{
  if(typeof value!=='string'||value.length>28*1024*1024)return samplePolicyRouteError(Error('weekly_sample_policy_source_invalid'));
  const match=/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[1]!.length%4!==0)return samplePolicyRouteError(Error('weekly_sample_policy_source_invalid'));
  const bytes=Buffer.from(match[1]!,'base64');
  if(bytes.length<5||bytes.length>20*1024*1024||bytes.toString('base64')!==match[1]||bytes.subarray(0,5).toString('ascii')!=='%PDF-')return samplePolicyRouteError(Error('weekly_sample_policy_source_invalid'));
  return bytes;
}
export function parseWeeklyCreativeRepairConfigurationBody(value: unknown) {
  const body=routeBody(value);
  if(!body||Object.keys(body).some(key=>!['packageVersion','expectedCaseHash','revisionScope','estimatedDurationMinutes','maximumCostCny','deadlineAt'].includes(key))||typeof body.expectedCaseHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseHash)||typeof body.revisionScope!=='string'||body.revisionScope!==body.revisionScope.trim()||!body.revisionScope||body.revisionScope.length>4000||!Number.isSafeInteger(body.estimatedDurationMinutes)||Number(body.estimatedDurationMinutes)<1||Number(body.estimatedDurationMinutes)>1440||typeof body.maximumCostCny!=='number'||!Number.isFinite(body.maximumCostCny)||body.maximumCostCny<0||typeof body.deadlineAt!=='string'||!Number.isFinite(Date.parse(body.deadlineAt)))throw new SocialProgramError('weekly_creative_repair_input_invalid',400,'创意修订配置无效。');
  return{expectedCaseHash:body.expectedCaseHash,revisionScope:body.revisionScope,estimatedDurationMinutes:Number(body.estimatedDurationMinutes),maximumCostCny:body.maximumCostCny,deadlineAt:body.deadlineAt};
}
export function assertWeeklyTechnicalRepairReconcileBody(value: unknown): void {
  const body=routeBody(value);
  if(!body||Object.keys(body).some(key=>key!=='packageVersion'))throw new SocialProgramError('weekly_repair_reconcile_input_invalid',400,'返工结果核验参数无效。');
}
export function parseWeeklyTechnicalQualityRecoveryBody(value: unknown) {
  const body=routeBody(value);
  if(!body||Object.keys(body).some(key=>!['packageVersion','requestId','expectedContextHash'].includes(key))||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,160}$/.test(body.requestId)||typeof body.expectedContextHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedContextHash))throw new SocialProgramError('weekly_repair_quality_recovery_input_invalid',400,'质量复核恢复参数无效。');
  return{requestId:body.requestId,expectedContextHash:body.expectedContextHash};
}

export function createSocialProgramsRouter(dataStore: DataStore = store, authenticate = true): Router {
  const router = Router();
  if (authenticate) router.use(requireAuth, enforceSupportSessionReadOnly);
  const service = createSocialProgramService(dataStore);
  router.use('/:programId/operating-packages/:packageId/producer-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyProducerEvidenceRouter(dataStore));
  const weeklyPackages = createWeeklyOperatingPackageService(dataStore);
  router.get('/:programId/operating-packages/:packageId/collection-runtime',asyncRoute(async(req,res)=>{
    const {tenantId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_collection_budget_input_invalid',400,'请指定当前周包版本。');
    res.setHeader('Cache-Control','private, no-store');
    try{res.json({item:await readWeeklyCollectionRuntimeCard(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});}
    catch(error){const code=error instanceof Error?error.message:'weekly_collection_budget_context_unverified';throw new SocialProgramError(code,409,'采集任务范围暂无法核验。');}
  }));
  router.get('/:programId/operating-packages/:packageId/collection-budget',asyncRoute(async(req,res)=>{
    const {tenantId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_collection_budget_input_invalid',400,'请指定当前周包版本。');
    res.setHeader('Cache-Control','private, no-store');
    try{res.json({item:(await readWeeklyCollectionBudgetCard(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})).card});}
    catch(error){const code=error instanceof Error?error.message:'weekly_collection_budget_context_unverified';throw new SocialProgramError(code,409,'采集任务范围暂无法核验。');}
  }));
  router.post('/:programId/operating-packages/:packageId/collection-budget',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,b=routeBody(req.body);
    if(!b||Object.keys(b).sort().join(',')!==['expectedContextHash','expectedPackageVersion','perRunLimitCny','totalLimitCny'].sort().join(',')||!Number.isSafeInteger(b.expectedPackageVersion)||Number(b.expectedPackageVersion)<1||typeof b.expectedContextHash!=='string'||typeof b.totalLimitCny!=='number'||typeof b.perRunLimitCny!=='number')throw new SocialProgramError('weekly_collection_budget_input_invalid',400,'人民币预算参数无效。');
    const scope={tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(b.expectedPackageVersion)};
    const context=await readWeeklyCollectionBudgetContext(dataStore,scope);
    if(b.expectedContextHash!==context.contextHash)throw new SocialProgramError('weekly_collection_budget_context_changed',409,'采集范围已变化，请重新读取任务卡。');
    try{const authorization=await issueWeeklyAccountCollectionBudgetAuthorization({store:dataStore,tenantId,actorUserId:userId,programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,scopeId:context.scopeId,scopeVersion:context.scopeVersion,scopeHash:context.scopeHash,actorId:context.actorId,totalLimitCny:b.totalLimitCny,perRunLimitCny:b.perRunLimitCny,expiresAt:new Date(Date.now()+86400000).toISOString()});res.setHeader('Cache-Control','private, no-store');res.status(201).json({item:{authorizationId:authorization.authorizationId,totalLimitCny:authorization.totalLimitCny,perRunLimitCny:authorization.perRunLimitCny,expiresAt:authorization.expiresAt,permitsPaidCollection:false,paidBlocker:'weekly_preproduction_collection_cost_ceiling_unverified'}});}
    catch(error){const code=error instanceof Error?error.message:'weekly_account_collection_budget_unavailable';throw new SocialProgramError(code,code.endsWith('actor_invalid')?403:code.endsWith('approval_input_invalid')?400:code.endsWith('authorization_write_unknown')?503:409,'预算未签发，请重新读取当前回执和采集范围。');}
  }));
  router.get('/:programId/operating-packages/:packageId/product-selection',asyncRoute(async(req,res)=>{
    const {tenantId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_product_selection_input_invalid',400,'请指定当前周包版本。');
    res.setHeader('Cache-Control','private, no-store');
    res.json({item:await readWeeklyPublicationProductSelectionChoices(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});
  }));
  router.post('/:programId/operating-packages/:packageId/product-selection',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,b=routeBody(req.body);
    if(!b||Object.keys(b).some(k=>!['expectedPackageVersion','expectedContextHash','productId','publicationTaskIds'].includes(k))||!Number.isSafeInteger(b.expectedPackageVersion)||Number(b.expectedPackageVersion)<1||typeof b.expectedContextHash!=='string'||typeof b.productId!=='string'||!Array.isArray(b.publicationTaskIds)||b.publicationTaskIds.some(id=>typeof id!=='string'))throw new SocialProgramError('weekly_product_selection_input_invalid',400,'选品参数无效。');
    res.setHeader('Cache-Control','private, no-store');
    res.json({item:await issueWeeklyPublicationProductSelections(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(b.expectedPackageVersion)},userId,{expectedContextHash:b.expectedContextHash,productId:b.productId,publicationTaskIds:b.publicationTaskIds})});
  }));
  router.get('/:programId/operating-packages/:packageId/sample-policy-candidates',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,packageVersion=Number(req.query.version),publicationTaskId=req.query.publicationTaskId;
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1||typeof publicationTaskId!=='string'||!publicationTaskId.trim()||publicationTaskId.length>160||Object.keys(req.query).some(key=>!['version','publicationTaskId'].includes(key)))throw new SocialProgramError('weekly_sample_policy_scope_invalid',400,'请指定当前周包版本与发布任务。');
    res.setHeader('Cache-Control','private, no-store');
    try{await assertWeeklySamplePolicyCandidateActor(dataStore,tenantId,userId);res.json({item:await readWeeklySamplePolicyCandidateContext(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion,publicationTaskId})});}
    catch(error){samplePolicyRouteError(error);}
  }));
  router.post('/:programId/operating-packages/:packageId/sample-policy-candidates',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,b=routeBody(req.body);
    if(!b||Object.keys(b).some(key=>!['expectedPackageVersion','publicationTaskId','expectedContextHash','terms','pdfDataUrl'].includes(key))
      ||!Number.isSafeInteger(b.expectedPackageVersion)||Number(b.expectedPackageVersion)<1
      ||typeof b.publicationTaskId!=='string'||!b.publicationTaskId.trim()||b.publicationTaskId.length>160
      ||typeof b.expectedContextHash!=='string'||!/^[a-f0-9]{64}$/.test(b.expectedContextHash)
      ||!routeBody(b.terms))throw new SocialProgramError('weekly_sample_policy_input_invalid',400,'样品政策候选参数无效。');
    const terms=b.terms as unknown as SamplePolicyTerms,pdfBytes=samplePolicyPdf(b.pdfDataUrl);
    const scope={tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(b.expectedPackageVersion),publicationTaskId:b.publicationTaskId};
    res.setHeader('Cache-Control','private, no-store');
    try{
      const candidate=await submitWeeklySamplePolicyCandidate({store:dataStore,scope,actorUserId:userId,expectedContextHash:b.expectedContextHash,terms,pdfBytes});
      res.status(201).json({item:{candidateId:candidate.candidateId,publicationTaskId:scope.publicationTaskId,sourceSha256:candidate.sourceSha256,sourceSize:candidate.sourceSize,submittedAt:candidate.submittedAt,terms:candidate.terms,reviewStatus:candidate.reviewStatus,policyStatus:'candidate_only',authorizesProduction:false}});
    }catch(error){samplePolicyRouteError(error);}
  }));
  router.get('/:programId/operating-packages/:packageId/cta-contact',asyncRoute(async(req,res)=>{
    const {tenantId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_cta_version_invalid',400,'请指定当前周包版本。');
    res.setHeader('Cache-Control','private, no-store');
    res.json({item:await readWeeklyCtaContactCard(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});
  }));
  router.post('/:programId/operating-packages/:packageId/cta-contact',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,b=routeBody(req.body);
    if(!b||Object.keys(b).some(k=>!['expectedPackageVersion','contactChannel','contactValue','expectedContextHash','expectedReceiptId'].includes(k))||!Number.isSafeInteger(b.expectedPackageVersion)||Number(b.expectedPackageVersion)<1||b.contactChannel!=='whatsapp'||typeof b.contactValue!=='string'||typeof b.expectedContextHash!=='string'||!('expectedReceiptId' in b)||(b.expectedReceiptId!==null&&typeof b.expectedReceiptId!=='string'))throw new SocialProgramError('weekly_cta_contact_input_invalid',400,'联系信息参数无效。');
    res.setHeader('Cache-Control','private, no-store');
    res.json({item:await saveWeeklyCtaContact(dataStore,{tenantId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(b.expectedPackageVersion)},userId,{contactChannel:'whatsapp',contactValue:b.contactValue,expectedContextHash:b.expectedContextHash,expectedReceiptId:b.expectedReceiptId as string|null})});
  }));
  const pipeline=createWeeklyExecutionPipelineService(dataStore);
  router.use('/:programId/operating-packages/:packageId/automatic-schedule',createWeeklyAutomaticScheduleRouter(dataStore));
  router.get('/:programId/operating-packages/:packageId/execution-pipeline/customer-settings',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本。');
    res.json({item:await pipeline.readCustomerSettings({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/customer-settings',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,b=routeBody(req.body);
    if(!b||Object.keys(b).some(k=>!['expectedPackageVersion','expectedConfigVersion','enabled','allowRealCustomerMessages'].includes(k))||![b.expectedPackageVersion,b.expectedConfigVersion].every(v=>Number.isSafeInteger(v)&&Number(v)>0)||typeof b.enabled!=='boolean'||typeof b.allowRealCustomerMessages!=='boolean')throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请明确当前版本、客服启用与真实消息许可。');
    res.json({item:await pipeline.updateCustomerSettings({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(b.expectedPackageVersion)},{expectedConfigVersion:Number(b.expectedConfigVersion),enabled:b.enabled,allowRealCustomerMessages:b.allowRealCustomerMessages})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/publishing-authorization',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>!['expectedPackageVersion','authorizePublishing'].includes(k))||body.authorizePublishing!==true||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请明确确认当前周包的有界发布许可。');
    res.json({item:await pipeline.authorizePublishing({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)})});
  }));
  router.get('/:programId/operating-packages/:packageId/execution-pipeline/template',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本。');
    res.json({item:await pipeline.readTemplate({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/template',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>k!=='expectedPackageVersion')||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'只允许采用当前服务端模板，不接受审批或模板对象注入。');
    res.json({item:await pipeline.adoptTemplate({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)})});
  }));
  router.get('/:programId/operating-packages/:packageId/execution-pipeline/task-audit',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本。');
    res.setHeader('Cache-Control','private, no-store');
    res.json({item:await pipeline.audit({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/start-independent',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>k!=='expectedPackageVersion')||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'只接受当前周包版本，不接受授权或交付物注入。');
    res.json(await pipeline.startIndependent({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)}));
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/connect-local-consumer',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>k!=='expectedPackageVersion')||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本。');
    res.json({item:await pipeline.connectLocalConsumer({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/whatsapp-mock',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>!['expectedPackageVersion','taskId'].includes(k))||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1||typeof body.taskId!=='string'||!body.taskId.trim())throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本及客服任务。');
    res.json({item:await pipeline.runWhatsAppMock({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)},{taskId:body.taskId})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/bind-existing-facts',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>k!=='expectedPackageVersion')||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本。');
    res.json(await pipeline.bindExistingFacts({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)}));
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/prepare-authority',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>k!=='expectedPackageVersion')||!Number.isSafeInteger(body.expectedPackageVersion)||Number(body.expectedPackageVersion)<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定当前周包版本。');
    res.json(await pipeline.prepareAuthority({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)}));
  }));
  router.get('/:programId/operating-packages/:packageId/execution-pipeline',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals;
    const packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('weekly_pipeline_input_invalid',400,'请指定周包版本。');
    res.json({item:await pipeline.read({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion})});
  }));
  router.post('/:programId/operating-packages/:packageId/execution-pipeline/start',asyncRoute(async(req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals,body=routeBody(req.body);
    if(!body||Object.keys(body).some(k=>!['expectedPackageVersion','expectedPlanningVersion','expectedProgramVersion','selectedSlotIds','authorizePublishing'].includes(k))||!['expectedPackageVersion','expectedPlanningVersion','expectedProgramVersion'].every(k=>Number.isSafeInteger(body[k])&&Number(body[k])>0)||body.authorizePublishing!==false||!Array.isArray(body.selectedSlotIds)||body.selectedSlotIds.some(id=>typeof id!=='string'||!id.trim()))throw new SocialProgramError('weekly_pipeline_input_invalid',400,'启动参数无效；不包含发布或发送授权。');
    res.json(await pipeline.start({tenantId,actorUserId:userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:Number(body.expectedPackageVersion)},{expectedPackageVersion:Number(body.expectedPackageVersion),expectedPlanningVersion:Number(body.expectedPlanningVersion),expectedProgramVersion:Number(body.expectedProgramVersion),selectedSlotIds:body.selectedSlotIds as string[],authorizePublishing:false}));
  }));
  const operating = createSocialOperatingOrchestrationService(dataStore);
  const executionTasks = createWeeklyExecutionTaskService(dataStore);
  const repairCases=createWeeklyProductionRepairCaseService(dataStore);
  const technicalRepairCompletion=createWeeklyTechnicalRepairCompletionService(dataStore);
  const creativeRepairConfiguration=createWeeklyCreativeRepairConfigurationService(dataStore);
  const creativeRepairExecution=createWeeklyCreativeRepairExecutionService(dataStore,createWeeklyCreativeRepairProductionPort(dataStore));
  const creativeRepairCompletion=createWeeklyCreativeRepairCompletionService(dataStore);
  router.get('/unplanned-delivery-cards',asyncRoute(async(_req,res)=>{const{tenantId}=res.locals as AuthLocals;res.setHeader('Cache-Control','private, no-store');res.json({items:await listUnplannedSocialDeliveryCards(dataStore,tenantId)});}));
  router.use('/:programId/operating-packages/:packageId/supplement-requests', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklySupplementRequestsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/running-resource-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyRunningResourceEvidenceRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/review-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyReviewEvidenceRouter(dataStore));
  router.use('/:programId/content-templates', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyContentTemplatesRouter(dataStore));
  router.use('/:programId/customer-feedback-topics', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialCustomerFeedbackTopicsRouter(dataStore));
  router.use('/:programId/material-requests', asyncRoute(async (req, res, next) => {
    const { tenantId } = res.locals as AuthLocals;
    await service.getProgram(tenantId, String(req.params.programId || ''));
    next();
  }), createSocialWeeklyMaterialRequestsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/initial-schedule', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createWeeklyInitialScheduleRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/schedule-revisions', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyScheduleRevisionsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/material-evidence-configuration', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyMaterialEvidenceConfigurationRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/customer-channel-scope', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyCustomerChannelScopeRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/inventory-reuse',asyncRoute(async(req,res,next)=>{await service.getProgram((res.locals as AuthLocals).tenantId,req.params.programId);next();}),createSocialWeeklyInventoryReuseRouter(createWeeklyInventoryReuseService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/profile-upgrades', asyncRoute(async (req,res,next)=>{
    await service.getProgram((res.locals as AuthLocals).tenantId,req.params.programId);next();
  }),createSocialWeeklyProfileUpgradeRouter(createWeeklyProfileUpgradeService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/cross-week-material-continuations', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialCrossWeekMaterialContinuationsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/customer-knowledge-quote-requests', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyCustomerKnowledgeQuoteRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/publication-recoveries', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyPublicationRecoveryRouter(createWeeklyPublicationRecoveryService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/native-send-recoveries', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyNativeSendRecoveryRouter(createWeeklyNativeSendRecoveryService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/native-dispatch', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyNativeDispatchRouter(dataStore, createWeeklyNativeFollowupDispatchService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/send-recoveries', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyCustomerSendRecoveryRouter(createWeeklyCustomerSendRecoveryService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/sales-handoffs', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklySalesHandoffsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/sales-conversation-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklySalesConversationEvidenceRouter(dataStore));

  router.get('/', asyncRoute(async (_req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await service.listPrograms(tenantId) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.createProgram(tenantId, userId, req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await service.getProgram(tenantId, String(req.params.programId || '')) });
  }));

  router.patch('/:programId', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.updateProgram(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.json({ item });
  }));

  router.get('/:programId/accounts', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await service.listAccounts(tenantId, String(req.params.programId || '')) });
  }));

  router.post('/:programId/accounts', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.createAccount(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.put('/:programId/accounts/:accountId/playbook', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.savePlaybook(
      tenantId, userId, String(req.params.programId || ''), String(req.params.accountId || ''), req.body || {},
    );
    res.status(201).json({ item });
  }));

  router.post('/:programId/plans/monthly', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.saveMonthlyPlan(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.post('/:programId/plans/weekly', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.saveWeeklyPlan(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId/operating-constraints', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await operating.getConstraints(tenantId, String(req.params.programId || '')) });
  }));

  router.put('/:programId/operating-constraints', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await operating.saveConstraints(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.post('/:programId/operating-plan/resolve', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    // Deliberately allow-list intent only. Caller supplied readiness, capacity,
    // policy and rights fields never cross the server authority boundary.
    const request: OperatingPlanningRequest = {
      weekStart: String(body.weekStart || ''),
      ...(Number.isSafeInteger(body.desiredOriginalContents) ? { desiredOriginalContents: Number(body.desiredOriginalContents) } : {}),
      ...(Number.isSafeInteger(body.desiredAdaptations) ? { desiredAdaptations: Number(body.desiredAdaptations) } : {}),
      ...(body.requestedReferenceMode === 'ordinary_inspiration' || body.requestedReferenceMode === 'high_fidelity' || body.requestedReferenceMode === 'auto'
        ? { requestedReferenceMode: body.requestedReferenceMode } : {}),
      ...(body.referenceSelectionRef && typeof body.referenceSelectionRef === 'object' && !Array.isArray(body.referenceSelectionRef)
        ? { referenceSelectionRef: body.referenceSelectionRef as OperatingPlanningRequest['referenceSelectionRef'] } : {}),
      ...(Number.isSafeInteger(body.expectedSnapshotVersion) ? { expectedSnapshotVersion: Number(body.expectedSnapshotVersion) } : {}),
    };
    const resolution = await operating.resolve(tenantId, userId, String(req.params.programId || ''), request);
    res.status(201).json({ item: resolution, weeklyAuthority: weeklyAuthorityFromResolution(resolution) });
  }));

  router.get('/:programId/operating-snapshots/:snapshotId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const version = typeof req.query.version === 'string' ? Number(req.query.version) : undefined;
    const item = await operating.getSnapshot(tenantId, String(req.params.programId || ''), String(req.params.snapshotId || ''), version);
    res.json({ item });
  }));

  router.get('/:programId/operating-packages', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const items = await weeklyPackages.list(
      tenantId,
      String(req.params.programId || ''),
      typeof req.query.weekStart === 'string' ? req.query.weekStart : undefined,
    );
    res.json({ items });
  }));

  router.post('/:programId/operating-packages', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.create(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId/operating-packages/:packageId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const item = await weeklyPackages.get(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''),
    );
    res.json({ item });
  }));

  router.put('/:programId/operating-packages/:packageId', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const previousVersion = Number(req.body?.expectedVersion);
    const item = await weeklyPackages.revise(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    await revokePublicationAssignments({
      tenantId, operatingPackageId: String(req.params.packageId || ''),
      ...(Number.isSafeInteger(previousVersion) ? { operatingPackageVersion: previousVersion } : {}),
      revokedBy: userId, revokedAt: item.updatedAt, dataStore,
    });
    res.status(201).json({ item });
  }));

  router.post('/:programId/operating-packages/:packageId/activate', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.activate(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    res.json({ item });
  }));

  router.post('/:programId/operating-packages/:packageId/retire', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.retire(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    await revokePublicationAssignments({
      tenantId, operatingPackageId: item.packageId, operatingPackageVersion: item.version,
      revokedBy: userId, revokedAt: item.updatedAt, dataStore,
    });
    res.json({ item });
  }));

  router.get('/:programId/operating-packages/:packageId/agent-planning', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const version = typeof req.query.version === 'string' ? Number(req.query.version) : undefined;
    res.json({ item: await weeklyPackages.getAgentPlanning(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), version,
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/director-analysis', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.runDirectorPlanning(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.get('/:programId/operating-packages/:packageId/agent-planning/pinned-reference-options', asyncRoute(async (req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals;
    const actor=await readWeeklyReviewActor(dataStore,tenantId,userId);
    if(!actor||actor.tenantId!==tenantId||!['super_admin','admin','social_operator'].includes(organizationRoleOrNull(actor.role)??'')||actor.disabled===true||actor.active===false||['disabled','suspended'].includes(String(actor.status)))throw new SocialProgramError('weekly_pinned_reference_actor_invalid',403,'当前用户无权指定周包参考视频。');
    const programId=String(req.params.programId||''),packageId=String(req.params.packageId||'');
    const pkg=await weeklyPackages.get(tenantId,programId,packageId);
    res.json({item:await readWeeklyPinnableReferenceOptions(dataStore,{tenantId,programId,packageId,packageVersion:pkg.version})});
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/pinned-reference', asyncRoute(async (req,res)=>{
    const {tenantId,userId}=res.locals as AuthLocals;
    const actor=await readWeeklyReviewActor(dataStore,tenantId,userId);
    if(!actor||actor.tenantId!==tenantId||!['super_admin','admin','social_operator'].includes(organizationRoleOrNull(actor.role)??'')||actor.disabled===true||actor.active===false||['disabled','suspended'].includes(String(actor.status)))throw new SocialProgramError('weekly_pinned_reference_actor_invalid',403,'当前用户无权指定周包参考视频。');
    const body=routeBody(req.body),authority=routeBody(body?.discoveryAuthority);
    if(!body||Object.keys(body).some(key=>!['expectedPackageVersion','expectedPlanningVersion','candidateId','expectedAccountUrl','discoveryAuthority'].includes(key))||!Number.isSafeInteger(body.expectedPackageVersion)||!Number.isSafeInteger(body.expectedPlanningVersion)||typeof body.candidateId!=='string'||!body.candidateId.trim()||typeof body.expectedAccountUrl!=='string'||!/^https?:\/\//i.test(body.expectedAccountUrl)||!authority||Object.keys(authority).some(key=>!['rootJobId','currentJobId','runId'].includes(key))||['rootJobId','currentJobId','runId'].some(key=>typeof authority[key]!=='string'||!String(authority[key]).trim()))throw new SocialProgramError('weekly_pinned_reference_input_invalid',400,'指定视频命令缺少有效版本、账号或本轮采集身份。');
    res.json({item:await weeklyPackages.pinAgentReference(tenantId,userId,String(req.params.programId||''),String(req.params.packageId||''),{expectedPackageVersion:Number(body.expectedPackageVersion),expectedPlanningVersion:Number(body.expectedPlanningVersion),candidateId:body.candidateId,expectedAccountUrl:body.expectedAccountUrl,discoveryAuthority:{rootJobId:String(authority.rootJobId),currentJobId:String(authority.currentJobId),runId:String(authority.runId)}})});
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/merge', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.mergeAgentSchedule(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/confirm', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.confirmAgentSchedule(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/dispatch', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.dispatchAgentSchedule(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.get('/:programId/operating-packages/:packageId/cancellation', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const version = Number(req.query.version ?? pkg.version);
    if (!Number.isSafeInteger(version) || version < 1) throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    const summary = await readWeeklyCancellation(dataStore, tenantId, programId, packageId, version);
    res.json({ item: summary ? {...summary, currentSettlements: await readWeeklyCancellationSettlements({dataStore, tenantId, programId, packageId, packageVersion: version})} : null });
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks/:taskId/reference-review-navigation', asyncRoute(async (req, res) => {
    const {tenantId} = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1 || typeof req.query.recordId !== 'string') throw new SocialProgramError('reference_navigation_scope_invalid', 400, '请选择当前周任务的具体参考视频。');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({item: await readWeeklyReferenceReviewNavigation(dataStore, {tenantId, programId: String(req.params.programId), packageId: String(req.params.packageId), packageVersion, executionTaskId: String(req.params.taskId)}, req.query.recordId)});
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks/:taskId/production-navigation', asyncRoute(async (req, res) => {
    const {tenantId} = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    res.json({item: await readWeeklyContentNavigation(dataStore, {tenantId, programId: String(req.params.programId), packageId: String(req.params.packageId), packageVersion, executionTaskId: String(req.params.taskId)})});
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks/:taskId/workspace', asyncRoute(async (req, res) => {
    const {tenantId}=res.locals as AuthLocals;const packageVersion=Number(req.query.version);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');
    res.setHeader('Cache-Control','private, no-store');
    res.json({item:await readWeeklyTaskWorkspace(dataStore,{tenantId,programId:String(req.params.programId),packageId:String(req.params.packageId),packageVersion,executionTaskId:String(req.params.taskId)})});
  }));

  router.post('/:programId/operating-packages/:packageId/task-workspaces/backfill', asyncRoute(async (req, res) => {
    const {tenantId}=res.locals as AuthLocals;const packageVersion=Number(req.body?.packageVersion);
    if(!Number.isSafeInteger(packageVersion)||packageVersion<1||Object.keys(req.body??{}).some(key=>key!=='packageVersion'))throw new SocialProgramError('weekly_task_workspace_backfill_input_invalid',400,'生产现场补建参数无效。');
    await service.getProgram(tenantId,String(req.params.programId));
    res.setHeader('Cache-Control','private, no-store');
    res.json(await backfillWeeklyTaskWorkspaces(dataStore,{tenantId,programId:String(req.params.programId),packageId:String(req.params.packageId),packageVersion}));
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const requestedVersion = Number(req.query.version ?? pkg.version);
    if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) {
      throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    }
    res.json({ items: await projectWeeklyContinuationCalendar(dataStore, await executionTasks.list(tenantId, programId, packageId, requestedVersion)) });
  }));

  router.get('/:programId/operating-packages/:packageId/delivery-cards', asyncRoute(async (req,res)=>{
    const {tenantId}=res.locals as AuthLocals,programId=String(req.params.programId||''),packageId=String(req.params.packageId||'');
    const pkg=await weeklyPackages.get(tenantId,programId,packageId),requestedVersion=Number(req.query.version??pkg.version);
    if(!Number.isSafeInteger(requestedVersion)||requestedVersion<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');
    if(pkg.version!==requestedVersion)throw new SocialProgramError('package_version_conflict',409,'周包版本已变化，请刷新真实排期。');
    const tasks=await projectWeeklyContinuationCalendar(dataStore,await executionTasks.list(tenantId,programId,packageId,requestedVersion));
    res.setHeader('Cache-Control','private, no-store');
    res.json({items:await projectWeeklyDeliveryCards(dataStore,tenantId,pkg,tasks)});
  }));

  router.get('/:programId/operating-packages/:packageId/repair-cases',asyncRoute(async(req,res)=>{
    const {tenantId}=res.locals as AuthLocals,programId=String(req.params.programId||''),packageId=String(req.params.packageId||'');
    await service.getProgram(tenantId,programId);const pkg=await weeklyPackages.get(tenantId,programId,packageId),requestedVersion=Number(req.query.version??pkg.version);
    if(!Number.isSafeInteger(requestedVersion)||requestedVersion<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');
    res.setHeader('Cache-Control','private, no-store');res.json({items:await repairCases.list(tenantId,programId,packageId,requestedVersion)});
  }));
  const repairCaseScope=async(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1])=>{const{tenantId,userId}=res.locals as AuthLocals,programId=String(req.params.programId||''),packageId=String(req.params.packageId||''),caseId=String(req.params.caseId||''),version=Number(req.query.version??req.body?.packageVersion);if(!Number.isSafeInteger(version)||version<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');await service.getProgram(tenantId,programId);const item=await repairCases.read(tenantId,caseId);if(item.programId!==programId||item.packageId!==packageId||item.packageVersion!==version)throw new SocialProgramError('weekly_repair_case_scope_invalid',404,'返工任务不属于当前周包。');return{tenantId,userId,programId,packageId,caseId,version,item};};
  router.use('/:programId/operating-packages/:packageId/repair-cases/:caseId/creative-execution',createSocialWeeklyCreativeRepairExecutionRouter({execution:creativeRepairExecution,completion:creativeRepairCompletion,resolveScope:async(req,res,packageVersion)=>{const scoped=await repairCaseScope(req,res);if(scoped.version!==packageVersion)throw new SocialProgramError('package_version_conflict',409,'周包版本已变化，请刷新后重试。');return{...scoped,packageVersion:scoped.version};}}));
  router.get('/:programId/operating-packages/:packageId/repair-cases/:caseId/capacity-preview',asyncRoute(async(req,res)=>{const scope=await repairCaseScope(req,res);if(Object.keys(req.query).some(key=>key!=='version'))throw new SocialProgramError('weekly_repair_case_query_invalid',400,'容量预览参数无效。');res.setHeader('Cache-Control','private, no-store');res.json({item:await repairCases.previewTechnicalCapacity(scope.tenantId,scope.userId,scope.caseId)});}));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/confirm-capacity',asyncRoute(async(req,res)=>{const scope=await repairCaseScope(req,res),body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['packageVersion','expectedCaseRecordHash','expectedPreviewHash','expectedQuoteHash','authorizedMaximumCostCny'].includes(key))||typeof body.expectedCaseRecordHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseRecordHash)||typeof body.expectedPreviewHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedPreviewHash)||body.expectedQuoteHash!==undefined&&(typeof body.expectedQuoteHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedQuoteHash))||typeof body.authorizedMaximumCostCny!=='number'||!Number.isFinite(body.authorizedMaximumCostCny)||body.authorizedMaximumCostCny<0)throw new SocialProgramError('weekly_repair_case_capacity_input_invalid',400,'容量确认参数无效。');res.json({item:await repairCases.confirmTechnicalCapacity(scope.tenantId,scope.userId,scope.caseId,{expectedCaseRecordHash:body.expectedCaseRecordHash,expectedPreviewHash:body.expectedPreviewHash,...(body.expectedQuoteHash?{expectedQuoteHash:body.expectedQuoteHash}:{}),authorizedMaximumCostCny:body.authorizedMaximumCostCny})});}));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/start',asyncRoute(async(req,res)=>{const scope=await repairCaseScope(req,res),body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['packageVersion','expectedCaseRecordHash'].includes(key))||typeof body.expectedCaseRecordHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseRecordHash))throw new SocialProgramError('weekly_repair_case_start_input_invalid',400,'返工作业启动参数无效。');await assertSocialSceneReworkQueueRegistered();const item=await repairCases.startTechnical(scope.tenantId,scope.userId,scope.caseId,{expectedCaseRecordHash:body.expectedCaseRecordHash});if(item.execution)await wakeSocialSceneReworkJob(item.execution.jobId).catch(()=>undefined);res.status(202).json({item});}));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/configure',asyncRoute(async(req,res)=>{
    const scope=await repairCaseScope(req,res),input=parseWeeklyCreativeRepairConfigurationBody(req.body);
    res.json({item:await creativeRepairConfiguration.configure(scope.tenantId,scope.userId,scope.caseId,input)});
  }));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/reconcile',asyncRoute(async(req,res)=>{
    const scope=await repairCaseScope(req,res);assertWeeklyTechnicalRepairReconcileBody(req.body);
    res.setHeader('Cache-Control','private, no-store');res.json({item:await technicalRepairCompletion.reconcile(scope.tenantId,scope.userId,scope.caseId)});
  }));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/recover-quality',asyncRoute(async(req,res)=>{
    const scope=await repairCaseScope(req,res),input=parseWeeklyTechnicalQualityRecoveryBody(req.body);
    res.json({item:await technicalRepairCompletion.recoverQuality(scope.tenantId,scope.userId,scope.caseId,input)});
  }));

  router.post('/:programId/operating-packages/:packageId/publications/:publicationId/reception-binding', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || ''), packageId = String(req.params.packageId || ''), publicationId = String(req.params.publicationId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const packageVersion = Number(req.body?.packageVersion);
    if (![pkg.version, pkg.version + 1].includes(packageVersion)) throw new SocialProgramError('package_version_conflict', 409, '绑定只能用于当前版本或下一次明确修订。');
    const publication = pkg.socialContentPackage.publicationTasks.find(item => item.publicationTaskId === publicationId);
    if (!publication) throw new SocialProgramError('weekly_publication_identity_invalid', 404, '当前周包不包含该发布任务。');
    try {
      const item = await savePublicationReceptionBinding(dataStore, {
        tenantId, programId, packageId, packageVersion, publicationId,
        cta: packageVersion === pkg.version ? publication.cta ?? '' : req.body?.cta,
        enterpriseFactHash: req.body?.enterpriseFactHash,
        targets: req.body?.targets,
      }, userId);
      res.json({ item, planningRevisionRequired: true });
    } catch (error) { throw new SocialProgramError('publication_reception_binding_invalid', 400, error instanceof Error ? error.message : '承接绑定无效。'); }
  }));

  router.get('/:programId/operating-packages/:packageId/customer-run-candidates', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定周包版本。');
    res.json(await listWeeklyCustomerRunCandidates(dataStore, { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion }));
  }));

  router.get('/:programId/operating-packages/:packageId/customer-run-binding', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定周包版本。');
    res.json({ item: await readWeeklyCustomerCalendar(dataStore, { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion }) });
  }));

  router.post('/:programId/operating-packages/:packageId/customer-run-binding', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const authority = { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion: Number(req.body?.packageVersion) };
    if (!Number.isSafeInteger(authority.packageVersion) || authority.packageVersion < 1 || typeof req.body?.runId !== 'string' || !req.body.runId.trim()) {
      throw new SocialProgramError('weekly_customer_binding_input_invalid', 400, '请选择具体客服运行及周包版本。');
    }
    res.json({ item: await bindWeeklyCustomerRun(dataStore, authority, req.body.runId.trim(), userId) });
  }));

  router.get('/:programId/operating-packages/:packageId/customer-run-binding/:runId/steps/:step', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const authority = { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion: Number(req.query.version) };
    if (!Number.isSafeInteger(authority.packageVersion) || authority.packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定周包版本。');
    const step = String(req.params.step || '');
    if (!['customer_segmentation', 'customer_followup_draft', 'customer_followup_approval', 'customer_followup_dispatch'].includes(step)) {
      throw new SocialProgramError('weekly_customer_step_unsupported', 400, '客服阶段无效。');
    }
    res.json({ item: await readWeeklyCustomerStep(dataStore, authority, String(req.params.runId || ''), step as WeeklyCustomerStep) });
  }));

  router.post('/:programId/operating-packages/:packageId/backward-schedule', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['packageVersion', 'constraints', 'resources', 'remainingBudgetCny', 'operationalDeadlines'].includes(key))) throw new SocialProgramError('weekly_backward_input_invalid', 400, '倒排只能提交明确容量条件，执行任务由服务端读取。');
    if (!Number.isSafeInteger(body.packageVersion) || body.packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定倒排周包版本。');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    if (pkg.version !== body.packageVersion) throw new SocialProgramError('package_version_conflict', 409, '周包版本已变化，请刷新后重新倒排。');
    const tasks = await executionTasks.list(tenantId, programId, packageId, body.packageVersion);
    if (!tasks.length) throw new SocialProgramError('weekly_backward_tasks_missing', 409, '该版本没有可倒排的真实执行任务。');
    try {
      const item = planWeeklyBackwardSchedule({ tasks, now: new Date().toISOString(), constraints: body.constraints, resources: body.resources, remainingBudgetCny: body.remainingBudgetCny, operationalDeadlines: body.operationalDeadlines, frozenOperationalWeek: { weekStart: pkg.weekStart, weekEnd: pkg.weekEnd } });
      res.json({ item, inputAuthority: 'stored_tasks_with_user_supplied_capacity_assumptions' });
    } catch (cause) { throw new SocialProgramError('weekly_backward_input_invalid', 400, cause instanceof Error ? cause.message : '倒排容量输入无效。'); }
  }));

  router.post('/:programId/operating-packages/:packageId/recovery-assessment', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const requestedVersion = Number(req.body?.packageVersion);
    if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定需要评估的周包版本。');
    const tasks = await executionTasks.list(tenantId, programId, packageId, requestedVersion);
    if (!tasks.length || pkg.programId !== programId) throw new SocialProgramError('weekly_recovery_tasks_missing', 409, '该版本没有可评估的执行任务。');
    // Capacity inputs are explicit scenario assumptions, never persisted completion evidence.
    // Task identity, dependencies, blockers and deadlines always come from the authenticated store.
    try {
      const item = assessWeeklyRecovery({
        tasks, now: new Date().toISOString(),
        changedTaskIds: req.body?.changedTaskIds,
        constraints: req.body?.constraints,
        resources: req.body?.resources,
        remainingBudgetCny: req.body?.remainingBudgetCny,
      });
      res.json({ item, inputAuthority: 'stored_tasks_with_user_supplied_capacity_assumptions' });
    } catch (error) {
      throw new SocialProgramError('weekly_recovery_input_invalid', 400, error instanceof Error ? error.message : '补救评估输入无效。');
    }
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/block', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.block(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), String(req.body?.reason || '')) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/recheck-required-materials', asyncRoute(async (req, res) => {
    const {tenantId,userId}=res.locals as AuthLocals;
    if(!tenantId||!userId)throw new SocialProgramError('auth_required',401,'请登录后重新核验素材。');
    const version=req.body?.expectedPackageVersion;
    if(!Number.isSafeInteger(version)||version<1||Object.keys(req.body??{}).some(key=>key!=='expectedPackageVersion'))throw new SocialProgramError('weekly_material_recovery_input_invalid',400,'请指定准确周包版本。');
    res.json({items:await recheckWeeklyRequiredMaterials(dataStore,{tenantId,programId:String(req.params.programId||''),packageId:String(req.params.packageId||''),packageVersion:version,taskId:String(req.params.taskId||'')})});
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/unblock', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.unblock(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), req.body?.reason) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/cancel', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.cancel(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), String(req.body?.reason || '')) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/recover', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.recoverDeadLetter(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || '')) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/approve', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const body=routeBody(req.body),ref=body?.expectedArtifactRef as {type?:unknown;id?:unknown;version?:unknown}|undefined;
    if(!body||Object.keys(body).some(key=>key!=='expectedArtifactRef')||ref!==undefined&&(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(key=>!['type','id','version'].includes(key))||ref.type!=='starter_social_content_artifact'||typeof ref.id!=='string'||!ref.id.trim()||!Number.isSafeInteger(ref.version)||Number(ref.version)<1))throw new SocialProgramError('weekly_production_approval_input_invalid',400,'请提交当前预览成片的确切版本。');
    res.json({ items: await executionTasks.approve(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), userId,
      ref as import('../../shared/contracts/socialProgram.js').VersionedSocialRef|undefined,
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/workflow-events', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.applyWorkflowEvent(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    res.json({ item });
  }));

  router.use(((error, _req, res, next) => {
    if (!(error instanceof SocialProgramError) && !(error instanceof SocialOperatingDecisionError)) {
      next(error);
      return;
    }
    res.status(error.status).json({ error: error.code, message: error.message });
  }) as import('express').ErrorRequestHandler);

  return router;
}

export const socialProgramsRouter = createSocialProgramsRouter();
