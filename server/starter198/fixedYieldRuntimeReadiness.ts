import { FIXED_YIELD_PATH_IDS, type FixedYieldProductionMode } from '../../shared/fixedYieldCapabilityMap.js';
import type { FixedYieldPathId } from '../../shared/fixedYieldCapabilityMap.js';
import { fixedYieldRuntimeSnapshotId, type FixedYieldPathRuntimeState, type FixedYieldRuntimeReadinessSnapshot } from '../../shared/fixedYieldPathRegistry.js';

export interface FixedYieldModeProbe {
  adapterRegistered: boolean;
  authenticationReady: boolean;
  quotaAndBillingReady: boolean;
  qualityInspectionReady: boolean;
  objectStorageReady: boolean;
  reasonCodes: string[];
}

export interface FixedYieldRuntimeProbeFacts {
  checkedAt: string;
  localVideo: {
    ffmpegReady: boolean;
    segmentProfilesReady: boolean;
    localQualityReady: boolean;
    reasonCodes: string[];
  };
  presenter: Record<'pipeline_1' | 'pipeline_2' | 'pipeline_3', FixedYieldModeProbe>;
}

function reasonsForMode(mode: string, probe: FixedYieldModeProbe): string[] {
  return [...new Set([
    ...(!probe.adapterRegistered ? [`${mode}:adapter_missing`] : []),
    ...(!probe.authenticationReady ? [`${mode}:authentication_unavailable`] : []),
    ...(!probe.quotaAndBillingReady ? [`${mode}:quota_or_billing_unavailable`] : []),
    ...(!probe.qualityInspectionReady ? [`${mode}:quality_inspection_unavailable`] : []),
    ...(!probe.objectStorageReady ? [`${mode}:object_storage_unavailable`] : []),
    ...probe.reasonCodes,
  ])];
}

function modeReady(probe: FixedYieldModeProbe): boolean {
  return probe.adapterRegistered && probe.authenticationReady && probe.quotaAndBillingReady
    && probe.qualityInspectionReady && probe.objectStorageReady && probe.reasonCodes.length === 0;
}

/** Builds the frozen server-owned readiness snapshot from real probe results.
 * It performs no optimistic fallback and exposes no credential values. */
export function buildFixedYieldRuntimeReadinessSnapshot(facts: FixedYieldRuntimeProbeFacts): FixedYieldRuntimeReadinessSnapshot {
  const checkedAt = new Date(facts.checkedAt).toISOString();
  const presenterModes = (['pipeline_1', 'pipeline_2', 'pipeline_3'] as const).filter(mode => modeReady(facts.presenter[mode]));
  const presenterReasons = (['pipeline_1', 'pipeline_2', 'pipeline_3'] as const).flatMap(mode => reasonsForMode(mode, facts.presenter[mode]));
  const localReasons = [...new Set([
    ...(!facts.localVideo.ffmpegReady ? ['local:ffmpeg_unavailable'] : []),
    ...(!facts.localVideo.segmentProfilesReady ? ['local:segment_profiles_unavailable'] : []),
    ...(!facts.localVideo.localQualityReady ? ['local:quality_inspection_unavailable'] : []),
    ...facts.localVideo.reasonCodes,
  ])];
  const localReady = localReasons.length === 0;
  const state = (pathId: FixedYieldPathId, allowedModes: FixedYieldProductionMode[], reasonCodes: string[], expectedModes: number): FixedYieldPathRuntimeState => ({
    pathId, allowedModes, reasonCodes: [...new Set(reasonCodes)], checkedAt,
    state: allowedModes.length === 0 ? 'unavailable' : allowedModes.length < expectedModes ? 'degraded' : 'available',
  });
  const states = Object.fromEntries(FIXED_YIELD_PATH_IDS.map(pathId => pathId === 'P1_PRESENTER'
    ? [pathId, state(pathId, presenterModes, presenterReasons, 3)]
    : [pathId, state(pathId, localReady ? ['local_video_match'] : [], localReasons, 1)])) as Record<FixedYieldPathId, FixedYieldPathRuntimeState>;
  const snapshotCore = { schemaVersion: 'fixed-yield-runtime-readiness.v2' as const,
    capabilityMapVersion: 'fixed-yield-capability.v2' as const, states, checkedAt };
  return { ...snapshotCore, snapshotId: fixedYieldRuntimeSnapshotId(snapshotCore) };
}
