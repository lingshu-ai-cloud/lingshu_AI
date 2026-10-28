import type {runSocialContentAutoProduction} from './socialContentProductionExecution.js';
import type {readSocialTaskDetail} from './socialContentRecords.js';
import type {prepareSocialContentProductionBudget} from './socialContentProductionBudgetPreflight.js';
import type {PreparedWholeVoice} from './socialContentPreparedWholeVoice.js';
import type {SocialAssetSupplyPlan,SocialDirectorBrief} from '../../shared/contracts/socialContentWorkflow.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
import type {SocialProductionAsset} from './socialContentProductionPlan.js';
import type {SocialAssetSupplyExecutionResult} from './socialContentAssetSupplyExecution.js';
import {verifyMeasuredSupplyVoice} from './socialContentMeasuredSupplyTimeline.js';
import {prepareMeasuredLocalMaterialSupply} from './socialContentMeasuredMaterialPreparation.js';
import {buildSocialWorkflowMaterialCandidates} from './socialContentRecordProjection.js';
import {readMaterialLibrary,type MaterialRecord} from '../lib/materialLibrary.js';
import {socialRequestHash,socialText} from './socialContentValidation.js';
import {readCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {MATERIAL_RECOVERY_STAGE, materialRecoveryScopeHash, type MaterialRecoverySelections} from './socialContentMaterialRecovery.js';

type Execution=Parameters<typeof runSocialContentAutoProduction>[0];
type Detail=NonNullable<Awaited<ReturnType<typeof readSocialTaskDetail>>>;

/** Only the local execution projection can change after voice. The approved
 * source and paid plan remain immutable and keep their original identities. */
export async function prepareMeasuredMaterialForExecution(input:{
 execution:Execution;detail:Detail;plan:SocialAssetSupplyPlan|null;
 baseline:StoredSocialScriptBaseline;scenes:SocialDirectorBrief['scenes'];
 prepared:PreparedWholeVoice|null;budget:Awaited<ReturnType<typeof prepareSocialContentProductionBudget>>;
 assets:SocialProductionAsset[];sourceResult:SocialAssetSupplyExecutionResult|null;
 outputDirectory:string;
}){
 const {execution,detail,plan,prepared,budget}=input;
 if(detail.brief.materialRoutingPolicyVersion!=='type-aware.v3'||!plan
  ||['source_assets','voice'].includes(execution.graphPhase??'')
  ||!plan.shots.some(shot=>shot.sourceStrategy==='customer_real_asset'&&shot.materialRouting
    &&!['talking_head','unknown'].includes(shot.materialRouting.materialType)))return null;
 if(!prepared||budget.status!=='reserved')throw Error('user_input_required:measured_material_voice_evidence_missing');
 const proof=await verifyMeasuredSupplyVoice({prepared,scope:budget.scope,scenes:input.scenes,spokenScenes:input.baseline.scenes});
 const inventory=await (execution.repository.materialLibrary??readMaterialLibrary)(execution.tenantId,{dataStore:execution.repository.dataStore});
 if(inventory.status==='unavailable')throw Error('material_inventory_unavailable');
 const overlays:MaterialRecord[]=[];
 // Use the same independent signed footage reader as the existing planner.
 // A raw footage-candidate row alone is never a currently authorized segment.
 if(detail.enterpriseProductBinding&&execution.repository.dataStore){
  const {configuredFootageVisualAuthorities,readApprovedProductFootageVisualOverlay}=await import('../routes/enterpriseProductFootageVisualReview.js');
  if(configuredFootageVisualAuthorities().length)for(const record of inventory.items){
   if(record.type!=='video'||!record.provenance?.footageCandidate
    ||socialText(record.tenantId||record.tenant_id)!==execution.tenantId
    ||socialText(record.productId)!==detail.enterpriseProductBinding.productId)continue;
   const overlay=await readApprovedProductFootageVisualOverlay({store:execution.repository.dataStore,material:record,
    tenantId:execution.tenantId,productId:detail.enterpriseProductBinding.productId}).catch(()=>null);
   if(overlay)overlays.push(overlay);
  }
 }
 const candidates=buildSocialWorkflowMaterialCandidates({records:inventory.items,reviewedFootageOverlays:overlays,
  tenantId:execution.tenantId,themeOnly:true,deferVideoSkuFilter:true,
  voiceoverRows:input.baseline.scenes.map(scene=>({cueId:scene.sceneId,text:scene.voiceover||scene.narration||''})),
  themeId:detail.theme?.themeId??null}).candidates;
 const recovery = readCurrentContentExecutionCheckpoint<MaterialRecoverySelections>({stage: MATERIAL_RECOVERY_STAGE,
  version: '1', inputHash: materialRecoveryScopeHash(execution.tenantId, execution.taskId, execution.runId),
  rejectMismatch: true});
 const requiredMaterials: Record<string, string> = {};
 const requiredMaterialRevisions: Record<string, string> = {};
 if (recovery) {
  if (recovery.tenantId !== execution.tenantId || recovery.taskId !== execution.taskId || recovery.runId !== execution.runId
   || !recovery.selections || typeof recovery.selections !== 'object') throw Error('material_recovery_binding_invalid');
  for (const [shotId, selection] of Object.entries(recovery.selections)) {
   if (selection?.phase === 'initial') continue;
   if (!plan.shots.some(shot => shot.shotId === shotId) || !selection?.materialId
    || !selection.sourceRevision || selection.originalPlanHash !== socialRequestHash(plan)) throw Error('material_recovery_binding_invalid');
   requiredMaterials[shotId] = selection.materialId;
   requiredMaterialRevisions[shotId] = selection.sourceRevision;
  }
 }
 const result=await prepareMeasuredLocalMaterialSupply({repository:execution.repository,tenantId:execution.tenantId,
  taskId:execution.taskId,runId:execution.runId,plan,baseline:input.baseline,timeline:proof.timeline,
  voiceSha256:proof.wholeTrackSha256,materialCandidates:candidates,requiredMaterials,requiredMaterialRevisions,availableAssets:input.assets,
  sourceResult:input.sourceResult,outputDirectory:input.outputDirectory,sources:detail.sources,
  productRef:detail.brief.productRef,themeId:detail.theme?.themeId??null,
  productionMode:detail.brief.productionMode??'concept_preview',loadProductionAssets:execution.runtime?.loadProductionAssets});
 // Unrelated inventory rows do not invalidate completed presenter operations.
 const executionBindingHash=socialRequestHash({plan:result.effectivePlan,sourceBytes:result.evidence.sourceBytes,
  voiceSha256:proof.wholeTrackSha256,timeline:proof.timeline});
 return {...result,executionBindingHash};
}
