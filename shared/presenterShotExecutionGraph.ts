import type { FixedYieldArchetypeId } from './fixedYieldMaterialRegistry.js';

export type PresenterArchetypeId = Extract<FixedYieldArchetypeId, `P1${string}`>;
export type PresenterPipeline = 'pipeline_1_heygen' | 'pipeline_2_performance_reference' | 'pipeline_3_reconstructed_frames';
export type PresenterOperationRole = 'canonical_voice' | 'presenter_identity' | 'background_scene'
  | 'performance_motion' | 'brand_contact_overlay' | 'target_first_frame'
  | 'talking_video' | 'layer_composite' | 'quality_gate';

export interface PresenterShotOperation {
  id: string;
  role: PresenterOperationRole;
  executor: 'canonical_voice' | 'enterprise_presenter_lock' | 'local_material_match'
    | 'authorized_performance_clip' | 'existing_first_frame_pipeline'
    | 'heygen_talking_video' | 'existing_reference_video_pipeline'
    | 'local_brand_overlay' | 'ffmpeg' | 'presenter_quality_gate';
  dependsOn: string[];
}

export interface PresenterShotExecutionGraph {
  schemaVersion: 'fixed-yield.presenter-shot-graph.v1';
  shotId: string;
  archetypeId: PresenterArchetypeId;
  pipeline: PresenterPipeline;
  operations: PresenterShotOperation[];
  blockers: Array<'presenter_missing' | 'voice_missing' | 'background_missing'
    | 'performance_reference_missing' | 'brand_contact_missing' | 'pipeline_not_supported'>;
}

const dynamicArchetypes = new Set<PresenterArchetypeId>([
  'P1A_FACTORY_WALK_TALK', 'P1D_SHELF_ACTION_TALK', 'P1F_REAL_PRODUCT_CONTACT',
]);

const pipelinesByArchetype: Record<PresenterArchetypeId, PresenterPipeline[]> = {
  P1A_FACTORY_WALK_TALK: ['pipeline_2_performance_reference', 'pipeline_3_reconstructed_frames'],
  P1B_FACTORY_STAND_TALK: ['pipeline_1_heygen', 'pipeline_3_reconstructed_frames'],
  P1C_SHELF_STAND_TALK: ['pipeline_1_heygen', 'pipeline_3_reconstructed_frames'],
  P1D_SHELF_ACTION_TALK: ['pipeline_2_performance_reference', 'pipeline_3_reconstructed_frames'],
  P1E_PRESENTER_CTA: ['pipeline_1_heygen', 'pipeline_3_reconstructed_frames'],
  P1F_REAL_PRODUCT_CONTACT: ['pipeline_2_performance_reference'],
};

/** Expands one already-selected presenter route. This compiler never selects a
 * provider and never changes pipelines after execution begins. */
export function compilePresenterShotExecutionGraph(input: {
  shotId: string;
  archetypeId: PresenterArchetypeId;
  pipeline: PresenterPipeline;
  readiness: {
    presenter: boolean;
    voice: boolean;
    background: boolean;
    performanceReference: boolean;
    brandContact: boolean;
  };
}): PresenterShotExecutionGraph {
  const blockers: PresenterShotExecutionGraph['blockers'] = [];
  if (!pipelinesByArchetype[input.archetypeId].includes(input.pipeline)) blockers.push('pipeline_not_supported');
  if (!input.readiness.presenter) blockers.push('presenter_missing');
  if (!input.readiness.voice) blockers.push('voice_missing');
  if (!input.readiness.background) blockers.push('background_missing');
  if (dynamicArchetypes.has(input.archetypeId) && !input.readiness.performanceReference) blockers.push('performance_reference_missing');
  if (input.archetypeId === 'P1E_PRESENTER_CTA' && !input.readiness.brandContact) blockers.push('brand_contact_missing');

  const operations: PresenterShotOperation[] = [
    { id: `${input.shotId}:voice`, role: 'canonical_voice', executor: 'canonical_voice', dependsOn: [] },
    { id: `${input.shotId}:identity`, role: 'presenter_identity', executor: 'enterprise_presenter_lock', dependsOn: [] },
    { id: `${input.shotId}:background`, role: 'background_scene', executor: 'local_material_match', dependsOn: [] },
  ];
  if (dynamicArchetypes.has(input.archetypeId)) operations.push({
    id: `${input.shotId}:performance`, role: 'performance_motion', executor: 'authorized_performance_clip', dependsOn: [],
  });
  if (input.archetypeId === 'P1E_PRESENTER_CTA') operations.push({
    id: `${input.shotId}:brand-contact`, role: 'brand_contact_overlay', executor: 'local_brand_overlay', dependsOn: [],
  });
  const firstFrameDependencies = [`${input.shotId}:identity`, `${input.shotId}:background`];
  if (dynamicArchetypes.has(input.archetypeId)) firstFrameDependencies.push(`${input.shotId}:performance`);
  operations.push({ id: `${input.shotId}:first-frame`, role: 'target_first_frame', executor: 'existing_first_frame_pipeline', dependsOn: firstFrameDependencies });
  operations.push({
    id: `${input.shotId}:talking-video`, role: 'talking_video',
    executor: input.pipeline === 'pipeline_1_heygen' ? 'heygen_talking_video' : 'existing_reference_video_pipeline',
    dependsOn: [`${input.shotId}:voice`, `${input.shotId}:first-frame`],
  });
  const compositeDependencies = [`${input.shotId}:talking-video`];
  if (input.archetypeId === 'P1E_PRESENTER_CTA') compositeDependencies.push(`${input.shotId}:brand-contact`);
  operations.push({ id: `${input.shotId}:composite`, role: 'layer_composite', executor: 'ffmpeg', dependsOn: compositeDependencies });
  operations.push({ id: `${input.shotId}:qa`, role: 'quality_gate', executor: 'presenter_quality_gate', dependsOn: [`${input.shotId}:composite`] });
  return { schemaVersion: 'fixed-yield.presenter-shot-graph.v1', shotId: input.shotId,
    archetypeId: input.archetypeId, pipeline: input.pipeline, operations, blockers };
}
