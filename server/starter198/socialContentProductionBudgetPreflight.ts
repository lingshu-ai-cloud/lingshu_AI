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
import { createSocialContentPaidOperationPlanner, paidProductionApprovalHash, paidProductionRecordHash, paidProductionHash, type FrozenPaidProduction, type PaidOperationPlannerPorts, type BoundPaidRoute } from './socialContentPaidOperationPlan.js';
import { createSocialContentTaskBudgetAuthority, type SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { createSocialContentVerifiedTariffReader } from '../lib/socialContentVerifiedTariffs.js';
import { SocialContentTaskBudget, type SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
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
    if (input.recoveryOnly) {
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
        await assertCurrent();
        return { status: 'recovery' as const, scope, budget: status };
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
    const snapshot: FrozenPaidProduction = { scope, baselineHash, recordHash: '', approval: { approved: true, reviewRef: review.reviewId, sourceHash: '', planHash }, authorization: { ref: `task-budget:${socialRequestHash({ tenantId: input.tenantId, taskId: input.taskId, createdBy: row.created_by, budget: amount, retry })}`, maximumCny: Math.min(10, amount) }, maximumRetries: 0,
        scenes: approved.directorBrief.scenes.map(scene => ({ ...(voice.mode === 'continuous' && voice.requiresAlignment && input.supplyPlan?.shots.some(shot => shot.shotId === scene.sceneId && shot.sourceStrategy === 'authorized_digital_presenter') ? {presenterSpeech:'whole_track' as const} : {}), shotId: scene.sceneId, durationSeconds: scene.duration.endSeconds - scene.duration.startSeconds, spokenText: input.baseline.scenes.find(s => s.sceneId === scene.sceneId)?.voiceover || input.baseline.scenes.find(s => s.sceneId === scene.sceneId)?.narration || '' })), shots: input.supplyPlan.shots, assets: assetInputs, voice, finalReview: 'local' };
    snapshot.approval.sourceHash = paidProductionApprovalHash(snapshot);
    snapshot.recordHash = paidProductionRecordHash(snapshot);
    const localSupplyProof=createSocialContentLocalSupplyBudgetProofReader({scope,supplyPlan:input.supplyPlan,baseline:input.baseline,
      assets:[...input.assets,...(input.localSupplyAssets??[])],repository:input.repository,assertCurrent});
    const productBounds=new Map<string,CanonicalProductBudgetBounds>();
    const canonicalRoutes=createProductionBudgetRouteReaders({readCanonicalProductBounds:async req=>{
      if(!req.shotId)return null;const shot=input.supplyPlan!.shots.find(s=>s.shotId===req.shotId);
      if(!shot?.materialRouting||!shot.productSceneReplication)return null;
      await assertCurrent();
      const value=await readProductReplacementRequestBounds({tenantId:input.tenantId,taskId:input.taskId,shotId:req.shotId,idempotencyKey:`budget-read:${planHash}:${req.shotId}`,spec:shot.productSceneReplication,materialRouting:shot.materialRouting,referenceImages:[],outputDirectory:os.tmpdir(),maximumCostCny:Math.min(10,amount)}, {dataStore:store,materials:input.repository.materialLibrary,assertCurrent});
      const previous=productBounds.get(req.shotId);if(previous&&socialRequestHash(previous)!==socialRequestHash(value))return error('product_input_authority_changed');
      productBounds.set(req.shotId,value);return value;
    }});
    const presenterBindings = new Map<string, TrustedHeyGenRuntimeBinding>();
    const readPresenterRoute = async (requirement: Parameters<PaidOperationPlannerPorts['resolveBoundRoute']>[0]): Promise<BoundPaidRoute | null> => {
      if (requirement.stage !== 'presenter_video' || !requirement.shotId || !requirement.durationSeconds || requirement.durationSeconds <= 0) return null;
      const shot = input.supplyPlan?.shots.find(item => item.shotId === requirement.shotId);
      if (!shot || shot.sourceStrategy !== 'authorized_digital_presenter') return null;
      const presenterIds = [...new Set(shot.digitalHumanPlan?.presenterAssetIds.length ? shot.digitalHumanPlan.presenterAssetIds : shot.sourceRefs)];
      if (presenterIds.length !== 1) return null;
      let binding = presenterBindings.get(requirement.shotId);
      if (!binding) {
        const resolved = await readTrustedHeyGenRuntimeBinding({tenantId:input.tenantId,presenterAssetId:presenterIds[0]!},{store,assertCurrent});
        if (!resolved) return null;
        binding = resolved; presenterBindings.set(requirement.shotId,binding);
      }
      return {provider:'heygen',model:'avatar_iv',accountRef:binding.accountRef,
        routeEvidenceRef:heyGenRuntimeRouteEvidence(binding),
        usageBoundRef:'measured-whole-track-scene:'+requirement.inputContractHash,
        maximumAttempts:1,maximumUnits:{providerSeconds:Math.ceil(requirement.durationSeconds)}};
    };
    const routeBindings: Record<string, BoundPaidRoute> = {};
    const planner = createSocialContentPaidOperationPlanner({ readFrozenProduction: async () => { await assertCurrent(); return snapshot; }, assertCurrent,
        resolveBoundRoute: async (requirement) => { const route = await ports?.resolveBoundRoute?.(requirement) || await readPresenterRoute(requirement) || await canonicalRoutes.resolveBoundRoute(requirement); if (route)
            routeBindings[requirement.key] = structuredClone(route); return route; },
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
    const authority = createSocialContentTaskBudgetAuthority({ ledgerRoot: ports?.ledgerRoot, ports: { assertCurrent, readApprovedPlan: async () => { await assertCurrent(); return planned.plan!; }, readVerifiedTariff: ports?.readTariff || (async intent=>await reader.read(intent)||(['tts','voice_asr','voice_alignment'].includes(intent.stage)?await readNativeVoicePublishedTariff(intent):intent.provider==='seedream'?await readSeedreamPublishedTariff(intent,{baseUrl:process.env.SEEDREAM_BASE_URL||process.env.SEEDANCE_BASE_URL||'https://ark.cn-beijing.volces.com/api/v3',credentialSha256:createHash('sha256').update((process.env.SEEDREAM_API_KEY||process.env.SEEDANCE_API_KEY||'').trim()).digest('hex')}):intent.provider==='wan'?await readWanPublishedTariff(intent,getQwenProviderBinding()):intent.provider==='heygen'?await readHeyGenPublishedTariff(intent,{readBinding:async operation=>operation.shotId?presenterBindings.get(operation.shotId)||null:null}):await publishedReader.read(intent))), verifyRejection: async () => false } });
    const reserved = await authority.prepareAndReserve(scope);
    await recordCurrentContentExecutionCheckpoint({ stage: STAGE, version: '1', inputHash: planHash, payload: { scopeHash: paidProductionHash(scope), baselineHash, operationIds: reserved.operations.map(o => o.operationId), requirements: planned.requirements, routeBindings, quotes: reserved.quotes, plan: planned.plan } });
    const paidPermit = createSocialContentPaidOperationPermit({ ...reserved, root: path.join(ports?.ledgerRoot || process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR || 'data/social-content-task-budget', '.permits'), assertCurrent });
    return { status: 'reserved' as const, scope, reserved, paidPermit, requirements: planned.requirements, routeBindings };
}
