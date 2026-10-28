import {initialMaterialPlanHash} from './socialContentInitialMaterialPlanIdentity.js';
import type {ContentExecutionJob} from '../contentExecution/durableQueue.js';
import {readMaterialLibrary} from '../lib/materialLibrary.js';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import type {SocialAssetSupplyShotRequest} from '../../shared/socialContentAssetSupply.js';
import type {Starter198Repository} from './repository.js';
import {buildSocialWorkflowMaterialCandidates} from './socialContentRecordProjection.js';
import {themeMaterialRoutingRequests} from './socialContentThemeMaterialRouting.js';
import {readCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {validateInitialShootPresenter} from './socialContentInitialShootTask.js';
import {SocialContentWorkflowError, socialObject, socialRequestHash} from './socialContentValidation.js';

const fail = (code: string, status = 409): never => { throw new SocialContentWorkflowError(`content_execution_material_recovery_${code}`, status); };

export const MATERIAL_RECOVERY_STAGE = 'social.material_recovery_selection';
export const materialRecoveryScopeHash = (tenantId: string, taskId: string, runId: string) =>
  socialRequestHash({tenantId, taskId, runId});
export type MaterialRecoverySelections = {tenantId: string; taskId: string; runId: string;
  selections: Record<string, {materialId?: string; originalPlanHash: string; sourceRevision?: string;
    requiredSeconds?: number; phase?: 'measured' | 'initial' | 'initial_presenter'; shootingTaskId?:string;shootingTaskVersion?:string;
    presenterAssetId?:string;presenterAssetVersion?:number;presenterBindingHash?:string}>};

/** Validate the requested selection against the original blocked evidence.
 * The worker independently rechecks current rights and bytes on its next pass. */
export async function validateMeasuredMaterialRecovery(input: {
  repository: Starter198Repository; tenantId: string; taskId: string; runId: string;
  job: ContentExecutionJob; slotId: string; materialId: string; currentPlan?: SocialAssetSupplyPlan | null;
}): Promise<{originalPlanHash: string; phase: 'measured' | 'initial'; sourceRevision: string; requiredSeconds?: number}> {
  const checkpoint = input.job.checkpoints['social.measured_local_materials'];
  const payload = socialObject(checkpoint?.payload);
  if (!payload || checkpoint?.version !== '1') {
    const initialCheckpoint = input.job.checkpoints['social.initial_material_block'];
    const initial = socialObject(initialCheckpoint?.payload);
    if (!initial || initialCheckpoint?.version !== '1') return fail('checkpoint_missing');
    if (initial.schemaVersion !== 'social-initial-material-block.v1' || initial.status !== 'blocked'
      || initial.tenantId !== input.tenantId || initial.taskId !== input.taskId || initial.runId !== input.runId
      || initialCheckpoint.inputHash !== socialRequestHash(initial) || !Array.isArray(initial.pending)
      || !input.currentPlan || input.currentPlan.materialRoutingPolicyVersion !== 'type-aware.v3'
      || initial.planHash !== initialMaterialPlanHash(input.currentPlan)) return fail('checkpoint_changed');
    const pending = initial.pending.map(socialObject).filter(row => row?.shotId === input.slotId);
    const shots = input.currentPlan.shots.filter(shot => shot.shotId === input.slotId);
    if (pending.length !== 1 || shots.length !== 1 || pending[0]?.reason !== 'awaiting_theme_material'
      || pending[0]?.materialType !== shots[0]?.materialRouting?.materialType
      || ['talking_head', 'unknown'].includes(String(pending[0]?.materialType))) return fail('slot_not_pending');
    const duration = Number(pending[0]?.referenceDurationSeconds);
    const inventory = await (input.repository.materialLibrary ?? readMaterialLibrary)(input.tenantId,
      {dataStore: input.repository.dataStore});
    if (inventory.status === 'unavailable') return fail('inventory_unavailable', 503);
    const candidates = buildSocialWorkflowMaterialCandidates({records: inventory.items, tenantId: input.tenantId,
      themeOnly: true, deferVideoSkuFilter: true, voiceoverRows: []}).candidates.filter(row => row.assetId === input.materialId);
    const shot = shots[0]!;
    const [match] = themeMaterialRoutingRequests({policyVersion: 'type-aware.v3', tenantId: input.tenantId,
      productRef: null, candidates, shots: [{...shot, materialType: shot.materialRouting!.materialType,
        ...(Number.isFinite(duration) && duration > 0 ? {plannedDurationSeconds: duration} : {})} as unknown as SocialAssetSupplyShotRequest]});
    if (!match?.selectedMaterialSegment || !match.localVideoMatch) return fail('material_not_eligible');
    const selected = candidates.find(row => row.sourceRef === match.selectedMaterialSegment!.sourceRef
      && row.segmentId === match.selectedMaterialSegment!.segmentId);
    if (!selected?.sourceRevision) return fail('material_revision_missing');
    return {originalPlanHash: String(initial.planHash), phase: 'initial', sourceRevision: selected.sourceRevision,
      ...(Number.isFinite(duration) && duration > 0 ? {requiredSeconds: duration} : {})};
  }
  const {status, effectivePlan, sourceResult: _sourceResult, ...evidence} = payload;
  if (status !== 'blocked' || evidence.schemaVersion !== 'social-measured-local-materials.v1'
    || evidence.tenantId !== input.tenantId || evidence.taskId !== input.taskId || evidence.runId !== input.runId
    || checkpoint.inputHash !== socialRequestHash(evidence)) return fail('checkpoint_changed');
  const plan = effectivePlan as SocialAssetSupplyPlan | null;
  if (!plan || plan.materialRoutingPolicyVersion !== 'type-aware.v3' || !Array.isArray(plan.shots)
    || !Array.isArray(evidence.pending) || !Array.isArray(evidence.timeline)) return fail('checkpoint_invalid');
  const pending = evidence.pending.map(socialObject).filter(row => row?.shotId === input.slotId);
  const shots = plan.shots.filter(shot => shot.shotId === input.slotId);
  const times = evidence.timeline.map(socialObject).filter(row => row?.shotId === input.slotId);
  if (pending.length !== 1 || shots.length !== 1 || times.length !== 1
    || pending[0]?.pendingReason !== 'awaiting_theme_material') return fail('slot_not_pending');
  const shot = shots[0]!;
  const time = times[0]!;
  const seconds = Number(time.end) - Number(time.start);
  if (!Number.isFinite(seconds) || seconds <= 0 || Math.abs(seconds - Number(pending[0]?.requiredSeconds)) > 1e-6
    || !shot.materialRouting || ['talking_head', 'unknown'].includes(shot.materialRouting.materialType)
    || shot.materialRouting.materialType !== pending[0]?.theme) return fail('slot_changed');
  const inventory = await (input.repository.materialLibrary ?? readMaterialLibrary)(input.tenantId,
    {dataStore: input.repository.dataStore});
  if (inventory.status === 'unavailable') return fail('inventory_unavailable', 503);
  const candidates = buildSocialWorkflowMaterialCandidates({records: inventory.items, tenantId: input.tenantId,
    themeOnly: true, deferVideoSkuFilter: true, voiceoverRows: []}).candidates.filter(row => row.assetId === input.materialId);
  const [match] = themeMaterialRoutingRequests({tenantId: input.tenantId, productRef: null, candidates,
    shots: [{shotId: shot.shotId, function: shot.function, materialType: shot.materialRouting.materialType,
      plannedDurationSeconds: seconds}]});
  if (!match?.selectedMaterialSegment || !match.localVideoMatch) return fail('material_not_eligible');
  if (typeof evidence.originalPlanHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.originalPlanHash)) return fail('checkpoint_invalid');
  const selected = candidates.find(row => row.sourceRef === match.selectedMaterialSegment!.sourceRef
    && row.segmentId === match.selectedMaterialSegment!.segmentId);
  if (!selected?.sourceRevision) return fail('material_revision_missing');
  return {originalPlanHash: evidence.originalPlanHash, phase: 'measured', sourceRevision: selected.sourceRevision};
}

/** Rebuild only explicitly recovered pre-run slots from the current tenant
 * inventory. The frozen task plan remains unchanged; this effective binding is
 * rechecked on every worker pass before any provider submission. */
export async function applyInitialMaterialRecovery(input: {repository: Starter198Repository; tenantId: string;
  taskId: string; runId: string; taskVersion:string; plan: SocialAssetSupplyPlan}): Promise<{plan: SocialAssetSupplyPlan; originalPlanHash: string}> {
  const originalPlanHash = initialMaterialPlanHash(input.plan);
  const recovery = readCurrentContentExecutionCheckpoint<MaterialRecoverySelections>({stage: MATERIAL_RECOVERY_STAGE,
    version: '1', inputHash: materialRecoveryScopeHash(input.tenantId, input.taskId, input.runId), rejectMismatch: true});
  if (!recovery) return {plan: input.plan, originalPlanHash};
  if (recovery.tenantId !== input.tenantId || recovery.taskId !== input.taskId || recovery.runId !== input.runId
    || !recovery.selections || typeof recovery.selections !== 'object') throw Error('material_recovery_binding_invalid');
  const selections = Object.entries(recovery.selections).filter(([, value]) =>
    value.phase === 'initial'||value.phase==='initial_presenter');
  if (!selections.length) return {plan: input.plan, originalPlanHash};
  const inventory = await (input.repository.materialLibrary ?? readMaterialLibrary)(input.tenantId,
    {dataStore: input.repository.dataStore});
  if (inventory.status === 'unavailable') throw Error('material_inventory_unavailable');
  const candidates = buildSocialWorkflowMaterialCandidates({records: inventory.items, tenantId: input.tenantId,
    themeOnly: true, deferVideoSkuFilter: true, voiceoverRows: []}).candidates;
  const plan = structuredClone(input.plan);
  for (const [shotId, selection] of selections) {
    if (selection.originalPlanHash !== originalPlanHash)
      throw Error('material_recovery_binding_invalid');
    const indexes = plan.shots.flatMap((shot, index) => shot.shotId === shotId ? [index] : []);
    if (indexes.length !== 1) throw Error('material_recovery_binding_invalid');
    const shot = plan.shots[indexes[0]!]!;
    const type = shot.materialRouting?.materialType;
    if(selection.phase==='initial_presenter'){
      if(shot.materialRouting?.pendingReason!=='awaiting_shoot'||type!=='talking_head'||!input.repository.dataStore
       ||!selection.shootingTaskId||!selection.presenterAssetId||!selection.presenterAssetVersion||!selection.presenterBindingHash)
        throw Error('material_recovery_binding_invalid');
      const trusted=await validateInitialShootPresenter({store:input.repository.dataStore,tenantId:input.tenantId,
       taskId:input.taskId,runId:input.runId,taskVersion:selection.shootingTaskVersion??input.taskVersion,shotId,planHash:originalPlanHash,
       shootingTaskId:selection.shootingTaskId,presenterAssetId:selection.presenterAssetId});
      if(trusted.presenterAssetVersion!==selection.presenterAssetVersion||trusted.presenterBindingHash!==selection.presenterBindingHash)
       throw Error('material_recovery_selection_no_longer_eligible');
      plan.shots[indexes[0]!] = {...shot,feasibility:'full_fidelity',feasibilityReason:'待拍产物已绑定授权数字人，沿原真人口播路线继续。',customerShootRequired:false,sourceStrategy:'authorized_digital_presenter',fallbackSourceStrategy:null,
       sourceRefs:[trusted.presenterAssetId],materialRouting:{...shot.materialRouting,pendingReason:undefined,policy:'authorized_presenter'},
       digitalHumanPlan:{workflow:'material_processing',method:'talking',presenterAssetIds:[trusted.presenterAssetId],
        referenceMaterialIds:[],referenceRequired:false,candidateTools:['heygen'],executionState:'ready_for_capability_check'},
       productionInstruction:'使用已完成待拍、绑定原拍摄素材并通过授权核验的数字人执行真人口播。'};
      continue;
    }
    if (!selection?.materialId || !selection.sourceRevision) throw Error('material_recovery_binding_invalid');
    if (shot.materialRouting?.pendingReason !== 'awaiting_theme_material' || !type
      || ['talking_head', 'unknown'].includes(type)) throw Error('material_recovery_binding_invalid');
    const [routed] = themeMaterialRoutingRequests({policyVersion: 'type-aware.v3', tenantId: input.tenantId,
      productRef: null, candidates: candidates.filter(row => row.assetId === selection.materialId
        && row.sourceRevision === selection.sourceRevision),
      shots: [{...shot, materialType: type,
        ...(selection.requiredSeconds ? {plannedDurationSeconds: selection.requiredSeconds} : {})} as unknown as SocialAssetSupplyShotRequest]});
    if (!routed?.selectedMaterialSegment || !routed.localVideoMatch) throw Error('material_recovery_selection_no_longer_eligible');
    plan.shots[indexes[0]!] = {...shot, feasibility:'full_fidelity',feasibilityReason:'同主题素材已经验证并绑定原槽位。',customerShootRequired:false, sourceStrategy: 'customer_real_asset', fallbackSourceStrategy: null,
      sourceRefs: [...routed.localVideoMatch.sourceRefs], selectedMaterialSegment: structuredClone(routed.selectedMaterialSegment),
      materialRouting: {...shot.materialRouting, pendingReason: undefined, policy: 'local_only', localMatch: {
        state: 'matched', sourceRefs: [...routed.localVideoMatch.sourceRefs], evidenceRef: routed.localVideoMatch.evidenceRef,
        sourceTier: routed.localVideoMatch.sourceTier, productRef: routed.localVideoMatch.productRef, reuseKind: 'direct_cut'}},
      productionInstruction: '使用用户为当前受阻分镜指定且重新核验通过的同主题本地素材。'};
  }
  return {plan, originalPlanHash};
}
