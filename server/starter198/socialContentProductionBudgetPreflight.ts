import {readHeyGenPublishedTariff} from '../lib/heygenPublishedPricing.js';
import {heyGenRuntimeRouteEvidence,readTrustedHeyGenRuntimeBinding,type TrustedHeyGenRuntimeBinding} from './socialContentHeyGenRuntimeBinding.js';
import {readSeedreamPublishedTariff} from '../lib/seedreamPublishedPricing.js';
import {readNativeVoicePublishedTariff} from '../lib/studioVoicePublishedPricing.js';
import {readWanPublishedTariff} from '../lib/wanPublishedPricing.js';
import fs from 'node:fs';
import {getQwenProviderBinding} from '../agents/qwen.js';
import {createSocialContentPublishedTariffReader} from '../lib/socialContentPublishedTariffs.js';
import path from 'node:path';
import os from 'node:os';
import {createProductionBudgetRouteReaders,type CanonicalProductBudgetBounds} from './socialContentProductionBudgetRoutes.js';
import {readProductReplacementRequestBounds} from './socialContentProductReplacementEnvironment.js';
import {createSocialContentLocalSupplyBudgetProofReader} from './socialContentLocalSupplyBudgetProof.js';
import { createSocialContentPaidOperationPermit } from '../lib/socialContentPaidOperationPermit.js';
import { createHash } from 'node:crypto';
import type { Starter198Repository } from './repository.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { socialJson, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';
import { readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { assertCurrentContentExecutionActive, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { socialMaterialAnalysisInputHash } from './socialContentProductionCheckpoints.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import type { SocialGraphApprovedContext } from './socialContentProductionExecution.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentReplication.js';
import { createSocialContentPaidOperationPlanner, paidProductionApprovalHash, paidProductionRecordHash, paidProductionHash, presenterGroupContractHash, type FrozenPaidProduction, type FrozenPresenterGroup, type PaidOperationPlannerPorts, type BoundPaidRoute, type PaidStageRequirement } from './socialContentPaidOperationPlan.js';
import { createSocialContentTaskBudgetAuthority, type SocialApprovedBudgetPlan, type SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { createSocialContentVerifiedTariffReader } from '../lib/socialContentVerifiedTariffs.js';
import { SocialContentTaskBudget, type SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import {readConfirmedPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
export interface ProductionBudgetReadPorts {
    /** Trusted readonly runtime/account readers. Never task/body supplied manifests. */
    resolveBoundRoute?: PaidOperationPlannerPorts['resolveBoundRoute'];
    readVerifiedLocalExecution?: PaidOperationPlannerPorts['readVerifiedLocalExecution'];
    readProductFrameBounds?: PaidOperationPlannerPorts['readProductFrameBounds'];
    readVoicePlan?: (baseline: StoredSocialScriptBaseline) => Promise<FrozenPaidProduction['voice'] | null>;
    readAnalysisFrames?: (asset: SocialProductionAsset) => Promise<{
        frameCount: number;
        batchFrameCounts: number[];
    } | null>;
    readTariff?: (operation: Parameters<ReturnType<typeof createSocialContentVerifiedTariffReader>['read']>[0]) => Promise<SocialVerifiedAccountTariff | null>;
    readDirectedProductRetryShotIds?: (input: {scope: SocialTaskBudgetScope; shots: SocialAssetSupplyPlan['shots']; priorPlan: unknown}) => Promise<string[]>;
    /** Trusted explicit-user decision reader. A task/body `confirmed:true` is never authority. */
    readConfirmedPresenterFirstFrame?: (input:{scope:SocialTaskBudgetScope;group:FrozenPresenterGroup})=>Promise<Awaited<ReturnType<typeof readConfirmedPresenterFirstFrameApproval>>>;
    /** Produces the paid review images only after the complete whole-film
     * reservation exists. Dynamic presenter video remains confirmation-gated. */
    preparePresenterFirstFrameReviews?: (input:{scope:SocialTaskBudgetScope;groups:FrozenPresenterGroup[];requirements:PaidStageRequirement[];intents:SocialApprovedBudgetPlan['paidOperations'];paidPermit:ReturnType<typeof createSocialContentPaidOperationPermit>})=>Promise<void>;
    ledgerRoot?: string;
}
export interface ProductionBudgetPreflightInput {
    repository: Starter198Repository;
    tenantId: string;
    taskId: string;
    runId: string;
    baseline: StoredSocialScriptBaseline;
    assets: SocialProductionAsset[];
    /** Exact owned inputs consumed by a local supply adapter without requiring
     * a separate semantic-analysis purchase. */
    localSupplyAssets?: SocialProductionAsset[];
    supplyPlan: SocialAssetSupplyPlan | null;
    graphApprovedContext?: SocialGraphApprovedContext;
    recoveryOnly?: boolean;
    ports?: ProductionBudgetReadPorts;
}
const STAGE = 'social.whole_film_budget';
const error = (gap: string): never => { throw Error(`user_input_required:whole_film_budget_preflight:${gap}`); };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function readDirectedProductRetryShotIds(input: {scope: SocialTaskBudgetScope; shots: SocialAssetSupplyPlan['shots']; priorPlan: unknown}) {
    const prior = socialObject(input.priorPlan), operations = Array.isArray(prior?.paidOperations) ? prior.paidOperations.map(socialObject) : [];
    const root = path.resolve('data/social-product-replacement-executions');
    const prefix = path.join(root, sha(input.scope.tenantId), sha(input.scope.taskId), sha(input.scope.runId));
    const retryShots: string[] = [];
    for (const shot of input.shots) {
        if (shot.sourceStrategy !== 'aigc_product_scene_replication' || shot.productSceneReplication?.validation.singleShotRetryOnFailure !== true) continue;
        const attempt0 = operations.find(operation => operation?.shotId === shot.shotId && operation?.stage === 'video_qa');
        const shotRoot = path.join(prefix, sha(shot.shotId));
        if (!attempt0?.operationId || !fs.existsSync(shotRoot)) continue;
        let proven = false;
        for (const execution of fs.readdirSync(shotRoot)) {
            const qaRoot = path.join(shotRoot, execution, 'video-qa');
            if (!fs.existsSync(qaRoot)) continue;
            for (const name of fs.readdirSync(qaRoot).filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
                try {
                    const receipt = socialObject(JSON.parse(fs.readFileSync(path.join(qaRoot, name), 'utf8'))), report = socialObject(receipt?.report), funding = socialObject(receipt?.funding);
                    if (receipt?.state === 'completed' && funding?.paidOperationId === attempt0.operationId && funding?.inputContractHash === attempt0.inputContractHash
                        && report?.passed === false && report?.status === 'retry_video') proven = true;
                } catch { /* malformed evidence never authorizes a retry */ }
            }
        }
        if (proven) retryShots.push(shot.shotId);
    }
    return retryShots;
}
export function productRetryReservationShotIds(shots: SocialAssetSupplyPlan['shots'], priorFailureShotIds: string[]) {
    const eligible = shots.filter(shot => shot.sourceStrategy === 'aigc_product_scene_replication'
        && shot.productSceneReplication?.validation.singleShotRetryOnFailure === true).map(shot => shot.shotId);
    return [...new Set([...eligible, ...priorFailureShotIds])].filter(id => eligible.includes(id));
}
async function bytesHash(asset: SocialProductionAsset) {
    if (!asset.localPath)
        return null;
    try {
        const h = createHash('sha256');
        for await (const part of fs.createReadStream(asset.localPath))
            h.update(part);
        return h.digest('hex');
    }
    catch {
        return null;
    }
}
/** Called BEFORE material analysis, not merely before video submission. This
 * gate reads approved task facts and never creates prices, approvals or media. */
export async function prepareSocialContentProductionBudget(input: ProductionBudgetPreflightInput) {
    const row = await requireSocialTask(input), brief = socialObject(socialJson(row.brief));
    // Historical frozen jobs retain their existing admission and recovery contracts.
    if (brief?.materialRoutingPolicyVersion !== 'type-aware.v1')
        return { status: 'legacy' as const };
    const store = input.repository.dataStore;
    if (!store)
        return error('canonical_store_missing');
    const job = await readContentExecutionJob(store, input.tenantId, input.taskId, input.runId);
    if (!job)
        return error('canonical_job_missing');
    if (socialText(row.run_id) !== input.runId)
        return error('run_superseded');
    const graph = await import('./socialContentProductionGraph.js');
    const loadDetail = () => input.graphApprovedContext ? graph.readSocialProductionGraphDetail(input, input.graphApprovedContext) : readSocialTaskDetail(input);
    const detail = await loadDetail();
    if (!detail?.agentWorkflow || !input.supplyPlan)
        return error('approved_execution_missing');
    const approved = input.graphApprovedContext?.agentWorkflow || detail.agentWorkflow, review = approved.executionPlanReview, plan = approved.executionPlan;
    if (!review.approved || review.executionPlanId !== plan.executionPlanId || review.executionPlanVersion !== plan.version || review.directorBriefId !== approved.directorBrief.directorBriefId || review.directorBriefVersion !== approved.directorBrief.version)
        return error('approved_review_changed');
    const baselineHash = socialRequestHash(input.baseline);
    if (socialRequestHash(socialJson(row.script_baseline)) !== baselineHash)
        return error('baseline_authority_changed');
    const binding = socialObject(job.checkpoints['social.executor']?.payload);
    const prior = job.checkpoints[STAGE];
    const priorPayload = socialObject(prior?.payload);
    // A retry of the same run must retain its original paid-operation scope.
    // Task status timestamps and legacy version counters are not provider
    // inputs and must never create a second set of reservations.
    const priorPlanHash = prior?.inputHash && /^[a-f0-9]{64}$/.test(prior.inputHash)
      && priorPayload?.baselineHash === baselineHash ? prior.inputHash : null;
    const calculatedPlanHash = priorPlanHash || (typeof binding?.inputHash === 'string' && /^[a-f0-9]{64}$/.test(binding.inputHash) ? binding.inputHash : paidProductionHash({ baselineHash, plan, review, supplyPlan: input.supplyPlan }));
    // The ledger is the durable financial authority. If an interrupted worker
    // wrote a newer planning checkpoint through a different working directory,
    // keep the single already-funded scope for this same run.
    const ledgerProbe = new SocialContentTaskBudget(input.ports?.ledgerRoot, {
      authorization: async()=>{throw Error('budget_probe_read_only');}, quote:async()=>{throw Error('budget_probe_read_only');},
      assertCurrent:async()=>{},verifyRejection:async()=>false,
    }).status({tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,planHash:calculatedPlanHash});
    const fundedPlanHashes=[...new Set((ledgerProbe?.entries||[]).filter(entry=>entry.runId===input.runId&&entry.status!=='rejected').map(entry=>entry.planHash))];
    const planHash = fundedPlanHashes.length===1 ? fundedPlanHashes[0]! : calculatedPlanHash;
    if (input.graphApprovedContext && graph.socialProductionGraphInput(detail, input.graphApprovedContext).inputHash !== planHash)
        return error('graph_binding_changed');
    const initialWorkflowHash = socialRequestHash({ plan: detail.agentWorkflow.executionPlan, review: detail.agentWorkflow.executionPlanReview, director: detail.agentWorkflow.directorBrief });
    const scope: SocialTaskBudgetScope = { tenantId: input.tenantId, taskId: input.taskId, runId: input.runId, planHash };
    const assertCurrent = async () => {
        await assertCurrentContentExecutionActive();
        const current = await requireSocialTask(input);
        if (socialText(current.run_id) !== input.runId || socialRequestHash(socialObject(socialJson(current.brief))) !== socialRequestHash(brief))
            return error('task_authority_changed');
        const live = await loadDetail();
        if (!live?.agentWorkflow || (input.graphApprovedContext ? graph.socialProductionGraphInput(live, input.graphApprovedContext).inputHash !== planHash : socialRequestHash({ plan: live.agentWorkflow.executionPlan, review: live.agentWorkflow.executionPlanReview, director: live.agentWorkflow.directorBrief }) !== initialWorkflowHash))
            return error('approved_review_changed');
        const active = await readContentExecutionJob(store, input.tenantId, input.taskId, input.runId);
        if (!active || active.id !== job.id || ['cancelled', 'failed'].includes(active.status))
            return error('job_authority_changed');
    };
    // Once this run has a frozen whole-film reservation, every later execution
    // is recovery. Re-planning could append newly priced operations after local
    // code or routing changes and spend beyond the user's original cap.
    if (input.recoveryOnly || prior) {
        // Read-only recovery cannot obtain a new quote, reserve or reset task expenses.
        if (!prior || prior.inputHash !== planHash)
            return error('existing_whole_film_reservation_missing');
        const payload = socialObject(prior.payload);
        if (payload?.scopeHash !== paidProductionHash(scope) || payload?.baselineHash !== baselineHash)
            return error('existing_reservation_scope_changed');
        const ledger = new SocialContentTaskBudget(input.ports?.ledgerRoot, { authorization: async () => { throw Error('recovery_never_authorizes'); }, quote: async () => { throw Error('recovery_never_quotes'); }, assertCurrent, verifyRejection: async () => false });
        const status = ledger.status(scope);
        if (!status || !Array.isArray(payload.operationIds) || payload.operationIds.some(id => !status.entries.some(e => e.operationId === id && e.runId === scope.runId && e.planHash === scope.planHash)))
            return error('existing_reservation_corrupt');
        const frozenPlan = payload.plan as SocialApprovedBudgetPlan | undefined;
        const requirements = Array.isArray(payload.requirements) ? payload.requirements as PaidStageRequirement[] : null;
        const routeBindings = socialObject(payload.routeBindings) as Record<string, BoundPaidRoute> | null;
        const quotes = socialObject(payload.quotes) as Record<string, import('../lib/socialContentTaskBudget.js').SocialTaskBudgetQuote> | null;
        if (!frozenPlan || paidProductionHash(frozenPlan.scope) !== paidProductionHash(scope)
          || !Array.isArray(frozenPlan.paidOperations) || !requirements || !routeBindings || !quotes)
            return error('existing_reservation_contract_missing');
        const operationIds = payload.operationIds as string[];
        const operations = operationIds.map(id => status.entries.find(entry => entry.operationId === id)!);
        const paidPermit = createSocialContentPaidOperationPermit({scope,operations,intents:frozenPlan.paidOperations,
          ledger,root:path.join(input.ports?.ledgerRoot || process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR || 'data/social-content-task-budget','.permits'),assertCurrent});
        const recoveryPresenterGroups=frozenPlan.presenterGroups||[];
        await input.ports?.preparePresenterFirstFrameReviews?.({scope,groups:recoveryPresenterGroups,requirements,intents:frozenPlan.paidOperations,paidPermit});
        const approvalReader=input.ports?.readConfirmedPresenterFirstFrame??(async({scope,group}:{scope:SocialTaskBudgetScope;group:FrozenPresenterGroup})=>readConfirmedPresenterFirstFrameApproval(store,{scope,groupId:group.groupId,presenterGroupContractHash:group.contractHash,presenterAssetId:group.presenterAssetId}));
        for(const group of recoveryPresenterGroups)if(!await approvalReader({scope,group}))return error(`presenter_first_frame_confirmation_missing:${group.groupId}`);
        await assertCurrent();
        return {status:'reserved' as const,scope,reserved:{scope,operations,intents:structuredClone(frozenPlan.paidOperations),quotes,status,ledger},paidPermit,requirements,routeBindings};
    }
    const ports = input.ports, assetInputs: FrozenPaidProduction['assets'] = [];
    const cached = job.checkpoints['social.material_analysis'];
    const cachedPayload = socialObject(cached?.payload), cacheRows = Array.isArray(cachedPayload?.analyzedAssets) ? cachedPayload.analyzedAssets : [];
    const cacheBound = cached?.inputHash === socialMaterialAnalysisInputHash({ tenantId: input.tenantId, assets: input.assets });
    const verifiedAssets = new Map<string, string>();
    for (const asset of input.assets) {
        const sha = await bytesHash(asset);
        if (!sha || asset.contentHash !== sha)
            return error(`material_bytes_unverified:${asset.id}`);
        verifiedAssets.set(asset.id, sha);
        const cachedRow = cacheBound ? cacheRows.find(value => socialObject(value)?.assetId === asset.id) : null;
        const reuseRef = cachedRow ? `job:${job.id}:social.material_analysis:${cached!.inputHash}` : null;
        let frameCount: number | null = asset.type === 'image' ? 1 : null, batches: number[] | null = null;
        if (asset.type === 'video' && !reuseRef) {
            const extracted = await ports?.readAnalysisFrames?.(asset);
            if (extracted) {
                frameCount = extracted.frameCount;
                batches = extracted.batchFrameCounts;
            }
        }
        assetInputs.push({ assetId: asset.id, contentHash: sha, type: asset.type, verifiedAnalysisRef: reuseRef, analysisMode: asset.type === 'image' ? 'image' : 'qwen_batches', frameCount, analysisBatchFrameCounts: batches });
    }
    const lines = input.baseline.scenes.map(scene => (scene.voiceover || scene.narration || '').trim()).filter(Boolean);
    const voice = lines.length ? await (ports?.readVoicePlan || (async () => null))(input.baseline) : { mode: 'none' as const, lines: [], requiresClone: false, allowFallback: false, requiresAsr: false, reuseReceiptRef: null };
    if (!voice)
        return error('selected_voice_runtime_route_missing');
    const amount = Number(brief?.perItemBudgetCny), retry = Number(brief?.retryReserveCny || 0);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(retry) || retry < 0)
        return error('task_budget_missing');
    const priorPlan = socialObject(priorPayload?.plan);
    const directedRetryShotIds = await (ports?.readDirectedProductRetryShotIds
      ? ports.readDirectedProductRetryShotIds({scope,shots:input.supplyPlan.shots,priorPlan})
      : Promise.resolve(readDirectedProductRetryShotIds({scope,shots:input.supplyPlan.shots,priorPlan})));
    // The paid plan is immutable once the first supplier request is admitted.
    // Therefore the one allowed product-video correction must be priced and
    // reserved before attempt zero; waiting for failed-QA evidence would make
    // the retry impossible because recovery is deliberately read-only. Runtime
    // still exposes attempt one only after attempt-zero QA fails.
    const authorizedRetryShots = productRetryReservationShotIds(input.supplyPlan.shots, directedRetryShotIds);
    const frozenScenes:FrozenPaidProduction['scenes']=approved.directorBrief.scenes.map(scene => ({ ...(voice.mode === 'continuous' && voice.requiresAlignment && input.supplyPlan?.shots.some(shot => shot.shotId === scene.sceneId && shot.sourceStrategy === 'authorized_digital_presenter') ? {presenterSpeech:'whole_track' as const} : {}), shotId: scene.sceneId, durationSeconds: scene.duration.endSeconds - scene.duration.startSeconds, spokenText: input.baseline.scenes.find(s => s.sceneId === scene.sceneId)?.voiceover || input.baseline.scenes.find(s => s.sceneId === scene.sceneId)?.narration || '' }));
    const presenterGroups:FrozenPresenterGroup[]=[];
    let pending:{presenterAssetId:string;scenes:typeof frozenScenes}|null=null;
    const flushPresenterGroup=()=>{if(!pending?.scenes.length)return;const value={shotIds:pending.scenes.map(scene=>scene.shotId),durationSeconds:pending.scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0),spokenText:pending.scenes.map(scene=>scene.spokenText).join(' '),presenterAssetId:pending.presenterAssetId};const groupId=`presenter-mother-${presenterGroups.length+1}`;const group={groupId,...value,contractHash:''};group.contractHash=presenterGroupContractHash(group);presenterGroups.push(group);pending=null;};
    for(const scene of frozenScenes){const shot=input.supplyPlan.shots.find(item=>item.shotId===scene.shotId);const ids=[...new Set(shot?.digitalHumanPlan?.presenterAssetIds?.length?shot.digitalHumanPlan.presenterAssetIds:shot?.sourceRefs||[])];const eligible=scene.presenterSpeech==='whole_track'&&shot?.sourceStrategy==='authorized_digital_presenter'&&ids.length===1;if(!eligible){flushPresenterGroup();continue;}if(pending&&pending.presenterAssetId!==ids[0])flushPresenterGroup();if(!pending)pending={presenterAssetId:ids[0]!,scenes:[]};pending.scenes.push(scene);}
    flushPresenterGroup();
    const snapshot: FrozenPaidProduction = { scope, baselineHash, recordHash: '', approval: { approved: true, reviewRef: review.reviewId, sourceHash: '', planHash }, authorization: { ref: `task-budget:${socialRequestHash({ tenantId: input.tenantId, taskId: input.taskId, createdBy: row.created_by, budget: amount, retry })}`, maximumCny: Math.min(10, amount) }, maximumRetries: authorizedRetryShots.length ? 1 : 0, directedRetryShotIds: authorizedRetryShots,
        scenes:frozenScenes, presenterGroups, shots: input.supplyPlan.shots, assets: assetInputs, voice, finalReview: 'local' };
    snapshot.approval.sourceHash = paidProductionApprovalHash(snapshot);
    snapshot.recordHash = paidProductionRecordHash(snapshot);
    const localSupplyProof=createSocialContentLocalSupplyBudgetProofReader({scope,supplyPlan:input.supplyPlan,baseline:input.baseline,
      assets:[...input.assets,...(input.localSupplyAssets??[])],repository:input.repository,assertCurrent});
    const productBounds=new Map<string,CanonicalProductBudgetBounds>();
    const canonicalRoutes=createProductionBudgetRouteReaders({readCanonicalProductBounds:async req=>{
      if(!req.shotId)return null;const shot=input.supplyPlan!.shots.find(s=>s.shotId===req.shotId);
      if(!shot?.materialRouting||!shot.productSceneReplication)return null;
      await assertCurrent();
      const value=await readProductReplacementRequestBounds({tenantId:input.tenantId,taskId:input.taskId,shotId:req.shotId,idempotencyKey:`budget-read:${planHash}:${req.shotId}`,spec:shot.productSceneReplication,materialRouting:shot.materialRouting,referenceImages:[],outputDirectory:os.tmpdir(),maximumCostCny:Math.min(10,amount)}, {
        dataStore:store,
        materials:input.repository.materialLibrary,
        assertCurrent,
        frozenSupplyPlan:input.supplyPlan!,
        frozenSupplyPlanBinding:{planVersion:String(input.supplyPlan!.planVersion),planHash:socialRequestHash(input.supplyPlan)},
      });
      const previous=productBounds.get(req.shotId);if(previous&&socialRequestHash(previous)!==socialRequestHash(value))return error('product_input_authority_changed');
      productBounds.set(req.shotId,value);return value;
    }});
    const presenterBindings = new Map<string, TrustedHeyGenRuntimeBinding>();
    const readPresenterRoute = async (requirement: Parameters<PaidOperationPlannerPorts['resolveBoundRoute']>[0]): Promise<BoundPaidRoute | null> => {
      if (!requirement.presenterGroupId || !['first_frame','first_frame_qa','presenter_video'].includes(requirement.stage)) return null;
      const memberIds=requirement.presenterGroupId?requirement.presenterGroupShotIds:requirement.shotId?[requirement.shotId]:null;
      if(!memberIds?.length)return null;
      const frozenGroup=requirement.presenterGroupId?snapshot.presenterGroups?.find(group=>group.groupId===requirement.presenterGroupId):null;
      if(requirement.presenterGroupId&&(!frozenGroup||paidProductionHash(frozenGroup.shotIds)!==paidProductionHash(memberIds)||frozenGroup.presenterAssetId!==requirement.presenterAssetId))return null;
      const memberShots=memberIds.map(id=>input.supplyPlan?.shots.find(item=>item.shotId===id));
      if(memberShots.some(shot=>!shot||shot.sourceStrategy!=='authorized_digital_presenter'))return null;
      const presenterIds=[...new Set(memberShots.flatMap(shot=>shot?.digitalHumanPlan?.presenterAssetIds?.length?shot.digitalHumanPlan.presenterAssetIds:shot?.sourceRefs||[]))];
      if (presenterIds.length !== 1 || (requirement.presenterAssetId&&requirement.presenterAssetId!==presenterIds[0])) return null;
      if(requirement.stage==='first_frame'||requirement.stage==='first_frame_qa'){
        const generic=await canonicalRoutes.resolveBoundRoute(requirement);
        if(generic)return generic;
        const staticReaders=createProductionBudgetRouteReaders({readCanonicalProductBounds:async()=>({qaModel:'qwen3-vl-plus',firstFrameMaximumFrames:3,videoMaximumFrames:3,productSha256s:[requirement.presenterGroupContractHash!],providerDurationSeconds:4,evidenceRef:`presenter-first-frame:${requirement.presenterGroupContractHash}`})});
        return staticReaders.resolveBoundRoute(requirement);
      }
      if (!requirement.durationSeconds || requirement.durationSeconds <= 0) return null;
      let binding = presenterBindings.get(presenterIds[0]!);
      if (!binding) {
        const resolved = await readTrustedHeyGenRuntimeBinding({tenantId:input.tenantId,presenterAssetId:presenterIds[0]!},{store,assertCurrent});
        if (!resolved) return null;
        binding = resolved; presenterBindings.set(presenterIds[0]!,binding);
      }
      return {provider:'heygen',model:'avatar_iv',accountRef:binding.accountRef,
        routeEvidenceRef:heyGenRuntimeRouteEvidence(binding),
        usageBoundRef:(requirement.presenterGroupId?'measured-presenter-group:':'measured-whole-track-scene:')+requirement.inputContractHash,
        maximumAttempts:1,maximumUnits:{providerSeconds:Math.ceil(requirement.durationSeconds)}};
    };
    const routeBindings: Record<string, BoundPaidRoute> = {};
    const planner = createSocialContentPaidOperationPlanner({ readFrozenProduction: async () => { await assertCurrent(); return snapshot; }, assertCurrent,
        resolveBoundRoute: async (requirement) => {
          const route = await ports?.resolveBoundRoute?.(requirement) || await readPresenterRoute(requirement) || await canonicalRoutes.resolveBoundRoute(requirement);
          if (route) routeBindings[requirement.key] = structuredClone(route); return route;
        },
        readProductFrameBounds: async req=>await ports?.readProductFrameBounds?.(req)||await canonicalRoutes.readProductFrameBounds(req),
        readVerifiedLocalExecution: async (req) => {
            const trusted = await ports?.readVerifiedLocalExecution?.(req); if(trusted)return trusted;
            if (req.stage === 'material_analysis_cache') {
                const asset = assetInputs.find(a => a.contentHash === req.sourceRef && a.verifiedAnalysisRef);
                if (asset)
                    return { kind: 'analysis_cache', scopeHash: paidProductionHash(scope), inputContractHash: req.inputContractHash, receiptRef: asset.verifiedAnalysisRef!, sourceSha256: asset.contentHash, sourceRef: asset.assetId };
            }
            // A source strategy alone never proves a free local executor. The selected
            // local provider reader must bind real bytes and exact scene requirements.
            return localSupplyProof(req);
        } });
    const planned = await planner.plan(scope);
    if (!planned.plan)
        return error(planned.gaps.join('|'));
    if (!planned.plan.paidOperations.length)
        return { status: 'local' as const, scope };
    const reader = createSocialContentVerifiedTariffReader(store, input.tenantId);
    const publishedReader=createSocialContentPublishedTariffReader({readProviderBinding:async intent=>{
      if(intent.provider!=='qwen')return null;let b:ReturnType<typeof getQwenProviderBinding>;try{b=getQwenProviderBinding();}catch{return null;}
      const model=intent.stage==='material_image_analysis'?b.imageModel:['material_video_analysis','material_video_review'].includes(intent.stage)?b.materialModel:['first_frame_qa','video_qa'].includes(intent.stage)?(intent.model==='qwen3-vl-plus'?intent.model:process.env.QWEN_VL_MODEL||'qwen3-vl-plus'):null;
      return model?{provider:'qwen',model,baseUrl:b.baseUrl,credentialSha256:b.credentialSha256}:null;
    }});
    const authority = createSocialContentTaskBudgetAuthority({ ledgerRoot: ports?.ledgerRoot, ports: { assertCurrent, readApprovedPlan: async () => { await assertCurrent(); return planned.plan!; }, readVerifiedTariff: async intent=>await ports?.readTariff?.(intent)||await reader.read(intent)||(['tts','voice_asr','voice_alignment'].includes(intent.stage)?await readNativeVoicePublishedTariff(intent):intent.provider==='seedream'?await readSeedreamPublishedTariff(intent,{baseUrl:process.env.SEEDREAM_BASE_URL||process.env.SEEDANCE_BASE_URL||'https://ark.cn-beijing.volces.com/api/v3',credentialSha256:createHash('sha256').update((process.env.SEEDREAM_API_KEY||process.env.SEEDANCE_API_KEY||'').trim()).digest('hex')}):intent.provider==='wan'?await readWanPublishedTariff(intent,getQwenProviderBinding()):intent.provider==='heygen'?await readHeyGenPublishedTariff(intent,{readBinding:async operation=>[...presenterBindings.values()].find(binding=>binding.accountRef===operation.accountRef)||null}):await publishedReader.read(intent)), verifyRejection: async () => false } });
    const reserved = await authority.prepareAndReserve(scope);
    const formalPaidRouteUpperBoundCny=Object.values(reserved.quotes).reduce((sum,quote)=>sum+quote.upperBoundCny,0);
    if(formalPaidRouteUpperBoundCny>planned.plan.maximumCny||formalPaidRouteUpperBoundCny>10)
      return error(`formal_paid_route_budget_exceeded:${formalPaidRouteUpperBoundCny.toFixed(6)}`);
    await recordCurrentContentExecutionCheckpoint({ stage: STAGE, version: '1', inputHash: planHash, payload: { scopeHash: paidProductionHash(scope), baselineHash, operationIds: reserved.operations.map(o => o.operationId), requirements: planned.requirements, routeBindings, quotes: reserved.quotes, formalPaidRouteUpperBoundCny, wholeTaskRetainedCny:reserved.status.retainedCny, plan: planned.plan } });
    const paidPermit = createSocialContentPaidOperationPermit({ ...reserved, root: path.join(ports?.ledgerRoot || process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR || 'data/social-content-task-budget', '.permits'), assertCurrent });
    await input.ports?.preparePresenterFirstFrameReviews?.({scope,groups:presenterGroups,requirements:planned.requirements,intents:planned.plan.paidOperations,paidPermit});
    const approvalReader=input.ports?.readConfirmedPresenterFirstFrame??(async({scope,group}:{scope:SocialTaskBudgetScope;group:FrozenPresenterGroup})=>readConfirmedPresenterFirstFrameApproval(store,{scope,groupId:group.groupId,presenterGroupContractHash:group.contractHash,presenterAssetId:group.presenterAssetId}));
    for(const group of presenterGroups)if(!await approvalReader({scope,group}))return error(`presenter_first_frame_confirmation_missing:${group.groupId}`);
    return { status: 'reserved' as const, scope, reserved, paidPermit, requirements: planned.requirements, routeBindings };
}
