import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import type {Starter198Repository} from './repository.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
import type {SocialProductionAsset} from './socialContentProductionPlan.js';
import type {SocialWorkflowMaterialClipCandidate} from './socialContentRecords.js';
import type {MeasuredSceneTime} from './socialContentMeasuredSceneTimeline.js';
import {reconcileMeasuredMaterialRouting} from './socialContentMeasuredMaterialRouting.js';
import {executeSocialAssetSupplyPlan, type SocialAssetSupplyExecutionResult} from './socialContentAssetSupplyExecution.js';
import {existingAssetSupplyAdapters, taskProductionAssets} from './socialContentProductionSupport.js';
import {recordCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {socialRequestHash} from './socialContentValidation.js';

type LoaderInput = Parameters<typeof taskProductionAssets>[0];
export interface MeasuredLocalMaterialSupplyInput {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  runId: string;
  plan: SocialAssetSupplyPlan;
  baseline: StoredSocialScriptBaseline;
  timeline: MeasuredSceneTime[];
  voiceSha256: string;
  materialCandidates: SocialWorkflowMaterialClipCandidate[];
  requiredMaterials?: Record<string, string>;
  requiredMaterialRevisions?: Record<string, string>;
  /** Optional isolated local slots for a scene-rework execution. */
  selectedShotIds?: string[];
  availableAssets: SocialProductionAsset[];
  sourceResult?: SocialAssetSupplyExecutionResult | null;
  outputDirectory: string;
  sources: LoaderInput['sources'];
  productRef: LoaderInput['productRef'];
  themeId: LoaderInput['themeId'];
  productionMode: LoaderInput['productionMode'];
  loadProductionAssets?: typeof taskProductionAssets;
}

/** A free execution projection, deliberately separate from the approved paid
 * plan and original source checkpoint. Rechecking bytes on every invocation
 * avoids treating an old checkpoint as current rights or media evidence. */
export async function prepareMeasuredLocalMaterialSupply(input: MeasuredLocalMaterialSupplyInput) {
  if (!/^[a-f0-9]{64}$/.test(input.voiceSha256)) throw Error('measured_material_voice_hash_invalid');
  const routed = reconcileMeasuredMaterialRouting({tenantId: input.tenantId, plan: input.plan,
    timeline: input.timeline, candidates: input.materialCandidates, requiredMaterials: input.requiredMaterials,
    requiredMaterialRevisions: input.requiredMaterialRevisions});
  const selectedSet = input.selectedShotIds ? new Set(input.selectedShotIds) : null;
  if (selectedSet && (selectedSet.size !== input.selectedShotIds!.length
    || [...selectedSet].some(id => !input.plan.shots.some(shot => shot.shotId === id))))
    throw Error('measured_material_selection_invalid');
  if (selectedSet) {
    routed.plan.shots = routed.plan.shots.map((shot,index) => selectedSet.has(shot.shotId) ? shot : input.plan.shots[index]!);
    routed.changes = routed.changes.filter(change => selectedSet.has(change.shotId));
    routed.pending = routed.pending.filter(change => selectedSet.has(change.shotId));
    if (!routed.pending.length) {
      routed.plan.status = input.plan.status;
      routed.plan.overallFeasibility = input.plan.overallFeasibility;
    }
  }
  const selectedIds = routed.changes.filter(change => change.kind !== 'pending').map(change => change.shotId);
  const localIds = new Set(routed.changes.map(change => change.shotId));
  const selected = routed.plan.shots.filter(shot => selectedIds.includes(shot.shotId));
  const segments = selected.flatMap(shot => shot.selectedMaterialSegment ? [shot.selectedMaterialSegment] : []);
  const refs = [...new Set(segments.map(segment => segment.sourceRef))];
  const physicalFailures: Array<{shotId: string; theme: string; requiredSeconds: number; pendingReason: string; reason: string}> = [];
  const selectedCandidates = segments.map(segment => input.materialCandidates.find(candidate =>
    candidate.sourceRef === segment.sourceRef && candidate.segmentId === segment.segmentId));
  const versionMatches = (asset: SocialProductionAsset, ref: string) => selectedCandidates
    .filter(candidate => candidate?.sourceRef === ref).every(candidate => candidate &&
      (/^[a-f0-9]{64}$/.test(candidate.sourceRevision)
        ? asset.contentHash === candidate.sourceRevision : asset.scriptAnalysis?.sourceRevision === candidate.sourceRevision));
  const reloadRefs = refs.filter(ref => !input.availableAssets.some(asset =>
    (asset.id === ref || asset.sourceId === ref) && versionMatches(asset, ref)));
  const loaded: SocialProductionAsset[] = [];
  const loadFailures = new Map<string, string>();
  for (const ref of reloadRefs) {
    try {
      loaded.push(...await (input.loadProductionAssets ?? taskProductionAssets)({
        tenantId: input.tenantId, sources: input.sources, productRef: input.productRef,
        themeId: input.themeId, productionMode: input.productionMode, outputDirectory: input.outputDirectory,
        materialLibrary: input.repository.materialLibrary, productFootageStore: input.repository.dataStore,
        allowAuthorizedSharedLibrary: false, requiredMaterialIds: [ref],
        selectedMaterialSegments: segments.filter(segment => segment.sourceRef === ref),
      }));
    } catch (error) {loadFailures.set(ref, error instanceof Error ? error.message : 'local_video_load_failed');}
  }
  const available = [...new Map([...input.availableAssets, ...loaded].map(asset => [asset.id, asset])).values()];
  const sourceBytes: Array<{sourceRef: string; sha256: string}> = [];
  const verified = new Set<string>();
  for (const shot of selected) {
    const segment = shot.selectedMaterialSegment!;
    const asset = available.find(row => row.id === segment.sourceRef || row.sourceId === segment.sourceRef);
    try {
      if (loadFailures.has(segment.sourceRef)) throw Error(loadFailures.get(segment.sourceRef));
      if (!asset?.localPath || !asset.contentHash || asset.type !== 'video') throw Error('local_video_bytes_missing');
      if (!versionMatches(asset, segment.sourceRef)) throw Error('local_video_source_revision_changed');
      const sha256 = createHash('sha256').update(await fs.readFile(asset.localPath)).digest('hex');
      if (sha256 !== asset.contentHash) throw Error('local_video_bytes_changed');
      if (!sourceBytes.some(row => row.sourceRef === segment.sourceRef)) sourceBytes.push({sourceRef: segment.sourceRef, sha256});
      verified.add(shot.shotId);
    } catch (error) {
      physicalFailures.push({shotId: shot.shotId, theme: shot.materialRouting!.materialType,
        requiredSeconds: segment.endSeconds - segment.startSeconds, pendingReason: 'awaiting_theme_material',
        reason: error instanceof Error ? error.message : 'local_video_bytes_unverified'});
    }
  }
  const executionInput = {tenantId: input.tenantId, taskId: input.taskId,
    outputDirectory: input.outputDirectory, plan: routed.plan, baseline: input.baseline,
    availableAssets: available,
    adapters: existingAssetSupplyAdapters().filter(adapter => adapter.adapterId === 'existing_customer_asset.v1')};
  const local = await executeSocialAssetSupplyPlan({...executionInput, selectedShotIds: []});
  for (const shot of selected.filter(row => verified.has(row.shotId))) {
    try {
      const executed = await executeSocialAssetSupplyPlan({...executionInput, selectedShotIds: [shot.shotId]});
      local.assets.push(...executed.assets);
      local.execution.shots.push(...executed.execution.shots);
    } catch (error) {
      const segment = shot.selectedMaterialSegment!;
      physicalFailures.push({shotId: shot.shotId, theme: shot.materialRouting!.materialType,
        requiredSeconds: segment.endSeconds - segment.startSeconds, pendingReason: 'awaiting_theme_material',
        reason: error instanceof Error ? error.message : 'local_video_window_unavailable'});
    }
  }
  const retained = input.sourceResult?.execution.shots.filter(shot => !localIds.has(shot.sceneId)) ?? [];
  const receipts = new Map([...retained, ...local.execution.shots].map(shot => [shot.sceneId, shot]));
  const shots = input.plan.shots.flatMap(shot => receipts.has(shot.shotId) ? [receipts.get(shot.shotId)!] : []);
  const retainedIds = new Set(retained.map(shot => shot.assetId));
  const resultAssets = [...new Map([...(input.sourceResult?.assets.filter(asset => retainedIds.has(asset.id)) ?? []),
    ...local.assets].map(asset => [asset.id, asset])).values()];
  const sourceResult: SocialAssetSupplyExecutionResult = {plan: routed.plan, assets: resultAssets,
    execution: {...local.execution, shots}};
  const pending = [...routed.pending, ...physicalFailures];
  const evidence = {schemaVersion: 'social-measured-local-materials.v1', tenantId: input.tenantId,
    taskId: input.taskId, runId: input.runId, originalPlanHash: socialRequestHash(input.plan),
    voiceSha256: input.voiceSha256, timeline: input.timeline,
    candidateHash: socialRequestHash(input.materialCandidates), sourceBytes, changes: routed.changes, pending};
  const inputHash = socialRequestHash(evidence);
  await recordCurrentContentExecutionCheckpoint({stage: 'social.measured_local_materials', version: '1', inputHash,
    payload: {...evidence, status: pending.length ? 'blocked' : 'completed', effectivePlan: routed.plan,
      sourceResult}});
  if (pending.length) throw Error(`user_input_required:awaiting_theme_material:${pending.map(row => row.shotId).join(',')}`);
  const assets = [...new Map([...available, ...resultAssets].map(asset => [asset.id, asset])).values()];
  return {effectivePlan: routed.plan, assets, sourceResult, inputHash, evidence};
}
