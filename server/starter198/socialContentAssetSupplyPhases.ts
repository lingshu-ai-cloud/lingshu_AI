import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import { readCurrentContentExecutionCheckpoint, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { socialRequestHash } from './socialContentValidation.js';
import type { PreparedWholeVoice } from './socialContentPreparedWholeVoice.js';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import {
  executeSocialAssetSupplyPlan,
  type SocialAssetSupplyExecution,
  type SocialAssetSupplyExecutionResult,
  type SocialAssetSupplyProviderAdapter,
} from './socialContentAssetSupplyExecution.js';
import { restoreSocialAssetSupplyCheckpointAssets } from './socialContentProductionCheckpoints.js';

export type SocialAssetSupplyPhase = 'source_assets' | 'presenter_assets';
export const SOCIAL_SOURCE_ASSETS_CHECKPOINT = 'social.graph_source_assets';
export const SOCIAL_PRESENTER_ASSETS_CHECKPOINT = 'social.graph_presenter_assets';
const CHECKPOINT_VERSION = '1';

/** Classifies the reviewed plan without replanning it. Presenter media is the
 * only supply output that consumes the frozen voice track; every other shot is
 * executable before voice synthesis. */
export function socialAssetSupplyPhaseShotIds(plan: SocialAssetSupplyPlan): Record<SocialAssetSupplyPhase, string[]> {
  const source_assets: string[] = [];
  const presenter_assets: string[] = [];
  const seen = new Set<string>();
  for (const shot of plan.shots) {
    if (!shot.shotId || seen.has(shot.shotId)) throw new Error('asset_supply_phase_shot_identity_invalid');
    seen.add(shot.shotId);
    const presenter = shot.sourceStrategy === 'authorized_digital_presenter'
      || shot.materialRouting?.materialType === 'talking_head';
    (presenter ? presenter_assets : source_assets).push(shot.shotId);
  }
  return { source_assets, presenter_assets };
}

export async function executeSocialAssetSupplyPhase(input: {
  phase: SocialAssetSupplyPhase;
  tenantId: string;
  taskId: string;
  outputDirectory: string;
  plan: SocialAssetSupplyPlan;
  baseline: StoredSocialScriptBaseline;
  availableAssets: SocialProductionAsset[];
  adapters: SocialAssetSupplyProviderAdapter[];
  now?: Date;
}): Promise<SocialAssetSupplyExecutionResult> {
  const selectedShotIds = socialAssetSupplyPhaseShotIds(input.plan)[input.phase];
  return executeSocialAssetSupplyPlan({ ...input, selectedShotIds });
}

/** Joins independently recoverable source and presenter supply receipts in
 * reviewed plan order. It fails closed on missing, duplicate or cross-plan
 * outputs, so a later trim stage never observes a half-restored timeline. */
export function mergeSocialAssetSupplyPhases(input: {
  plan: SocialAssetSupplyPlan;
  source: SocialAssetSupplyExecutionResult;
  presenter: SocialAssetSupplyExecutionResult;
}): SocialAssetSupplyExecutionResult {
  const expected = socialAssetSupplyPhaseShotIds(input.plan);
  const assertPhase = (phase: SocialAssetSupplyPhase, value: SocialAssetSupplyExecutionResult) => {
    if (value.execution.planVersion !== input.plan.planVersion
      || value.execution.creationMode !== input.plan.creationMode
      || value.execution.productionRoute !== input.plan.productionRoute
      || value.execution.managementMode !== input.plan.managementMode) {
      throw new Error(`asset_supply_phase_plan_changed:${phase}`);
    }
    const actual = value.execution.shots.map(shot => shot.sceneId);
    if (actual.length !== new Set(actual).size
      || actual.length !== expected[phase].length
      || actual.some((sceneId, index) => sceneId !== expected[phase][index])) {
      throw new Error(`asset_supply_phase_incomplete:${phase}`);
    }
  };
  assertPhase('source_assets', input.source);
  assertPhase('presenter_assets', input.presenter);
  const executionByScene = new Map([...input.source.execution.shots, ...input.presenter.execution.shots]
    .map(shot => [shot.sceneId, shot] as const));
  const shots = input.plan.shots.map(shot => executionByScene.get(shot.shotId));
  if (shots.some(shot => !shot) || executionByScene.size !== input.plan.shots.length) {
    throw new Error('asset_supply_phase_merge_incomplete');
  }
  const assets = [...input.source.assets, ...input.presenter.assets];
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) throw new Error('asset_supply_phase_asset_duplicate');
  const execution: SocialAssetSupplyExecution = {
    schemaVersion: 'social-content.asset-supply-execution.v1',
    planVersion: input.plan.planVersion,
    creationMode: input.plan.creationMode,
    productionRoute: input.plan.productionRoute,
    managementMode: input.plan.managementMode,
    executedAt: input.presenter.execution.executedAt,
    shots: shots as SocialAssetSupplyExecution['shots'],
  };
  return { plan: structuredClone(input.plan), assets, execution };
}

type PhaseCheckpointPayload = {
  phase: SocialAssetSupplyPhase;
  planHash: string;
  assetSupplyExecution: SocialAssetSupplyExecution;
  selectedAssets: Array<{assetId:string;sourceId:string;contentHash:string|null;asset:SocialProductionAsset}>;
};

export function socialAssetSupplyPhaseInputHash(input:{phase:SocialAssetSupplyPhase;plan:SocialAssetSupplyPlan;
  materialAnalysisInputHash:string;baselineVersion:string;voiceOutputSha256?:string|null}) {
  return socialRequestHash({schemaVersion:'social-asset-supply-phase-input.v1',phase:input.phase,
    planHash:socialRequestHash(input.plan),materialAnalysisInputHash:input.materialAnalysisInputHash,
    baselineVersion:input.baselineVersion,...(input.phase==='presenter_assets'?{voiceOutputSha256:input.voiceOutputSha256??null}:{})});
}

export async function recordSocialAssetSupplyPhaseCheckpoint(input:{phase:SocialAssetSupplyPhase;inputHash:string;
  plan:SocialAssetSupplyPlan;result:SocialAssetSupplyExecutionResult}) {
  const payload:PhaseCheckpointPayload={phase:input.phase,planHash:socialRequestHash(input.plan),
    assetSupplyExecution:structuredClone(input.result.execution),selectedAssets:input.result.assets.map(asset=>({assetId:asset.id,
      sourceId:asset.sourceId,contentHash:asset.contentHash??null,asset:structuredClone(asset)}))};
  await recordCurrentContentExecutionCheckpoint({stage:input.phase==='source_assets'?SOCIAL_SOURCE_ASSETS_CHECKPOINT:SOCIAL_PRESENTER_ASSETS_CHECKPOINT,
    version:CHECKPOINT_VERSION,inputHash:input.inputHash,payload});
}

export function readSocialAssetSupplyPhaseCheckpoint(input:{phase:SocialAssetSupplyPhase;inputHash:string;
  tenantId:string;plan:SocialAssetSupplyPlan;availableAssets:SocialProductionAsset[]}):SocialAssetSupplyExecutionResult|null {
  const checkpoint=readCurrentContentExecutionCheckpoint<PhaseCheckpointPayload>({stage:input.phase==='source_assets'
    ?SOCIAL_SOURCE_ASSETS_CHECKPOINT:SOCIAL_PRESENTER_ASSETS_CHECKPOINT,version:CHECKPOINT_VERSION,inputHash:input.inputHash});
  if(!checkpoint)return null;
  if(checkpoint.phase!==input.phase||checkpoint.planHash!==socialRequestHash(input.plan))throw Error(`asset_supply_phase_checkpoint_changed:${input.phase}`);
  const expected=socialAssetSupplyPhaseShotIds(input.plan)[input.phase];
  const actual=checkpoint.assetSupplyExecution?.shots?.map(shot=>shot.sceneId)??[];
  if(actual.length!==expected.length||actual.some((sceneId,index)=>sceneId!==expected[index]))throw Error(`asset_supply_phase_checkpoint_incomplete:${input.phase}`);
  const restored=restoreSocialAssetSupplyCheckpointAssets({tenantId:input.tenantId,availableAssets:input.availableAssets,selectedAssets:checkpoint.selectedAssets});
  const assets=restored??checkpoint.selectedAssets.map(selected=>selected.asset?.objectKey&&selected.contentHash
    && selected.asset.contentHash===selected.contentHash&&isTenantPrivateObjectKey(selected.asset.objectKey,input.tenantId)
    ?structuredClone(selected.asset):null);
  if(!assets||assets.some(asset=>!asset))throw Error(`asset_supply_phase_checkpoint_assets_changed:${input.phase}`);
  return {plan:structuredClone(input.plan),execution:structuredClone(checkpoint.assetSupplyExecution),assets:assets as SocialProductionAsset[]};
}

export function restoreV4SourceAssets(input:{enabled:boolean;phase?:string;tenantId:string;plan:SocialAssetSupplyPlan|null;
  materialAnalysisInputHash:string;baselineVersion:string;availableAssets:SocialProductionAsset[]}){
  if(!input.enabled)return{inputHash:'',result:null,assets:input.availableAssets};
  if(!input.plan)throw Error('graph_split_supply_plan_missing');
  const inputHash=socialAssetSupplyPhaseInputHash({phase:'source_assets',plan:input.plan,
    materialAnalysisInputHash:input.materialAnalysisInputHash,baselineVersion:input.baselineVersion});
  const result=input.phase==='source_assets'?null:readSocialAssetSupplyPhaseCheckpoint({phase:'source_assets',inputHash,
    tenantId:input.tenantId,plan:input.plan,availableAssets:input.availableAssets});
  if(input.phase!=='source_assets'&&!result)throw Error('graph_source_assets_checkpoint_missing');
  return{inputHash,result,assets:result?[...input.availableAssets,...result.assets]:input.availableAssets};
}

export async function recordV4WholeVoiceCheckpoint(input:{sourceAssetsInputHash:string;prepared:PreparedWholeVoice|null;voiceInput:unknown}){
  if(!input.prepared)throw Error('graph_whole_voice_checkpoint_missing');
  const cueCount=input.prepared.voice.cues?.length??0;
  if(!cueCount)throw Error('graph_whole_voice_cues_missing');
  await recordCurrentContentExecutionCheckpoint({stage:'social.graph_voice',version:'1',inputHash:socialRequestHash({
    sourceAssetsInputHash:input.sourceAssetsInputHash,wholeVoiceInputHash:socialRequestHash(input.voiceInput)}),payload:{
      outputSha256:input.prepared.wholeTrackSha256,durationSeconds:input.prepared.voice.duration,cueCount,
      source:input.prepared.voice.source||'prepared_whole_voice',alignmentSource:input.prepared.voice.alignmentSource||'measured',
      narrationCheckpointInputHash:socialRequestHash(input.voiceInput),sourceAssetsInputHash:input.sourceAssetsInputHash}});
}

export async function finishV4AssetSupplyPhase(input:{phase:SocialAssetSupplyPhase;inputHash:string;plan:SocialAssetSupplyPlan;
  supplied:SocialAssetSupplyExecutionResult;source:SocialAssetSupplyExecutionResult|null}){
  await recordSocialAssetSupplyPhaseCheckpoint({phase:input.phase,inputHash:input.inputHash,plan:input.plan,result:input.supplied});
  if(input.phase==='source_assets')return input.supplied;
  if(!input.source)throw Error('graph_source_assets_checkpoint_missing');
  return mergeSocialAssetSupplyPhases({plan:input.plan,source:input.source,presenter:input.supplied});
}
