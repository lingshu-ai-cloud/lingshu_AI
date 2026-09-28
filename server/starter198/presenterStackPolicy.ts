import type { PresenterShotMeasurements, PresenterStackDecision, PresenterStackRoute } from '../../shared/contracts/presenterStackPolicy.js';

export const PRESENTER_STACK_POLICY_V1 = Object.freeze({
  minimumDecisionConfidence: 0.85,
  minimumVisibleSpeechSeconds: 0.5,
  maximumHeygenBodyTravelFrameWidth: 0.08,
  maximumHeygenCameraTravelFrameDiagonal: 0.05,
  maximumSeedanceShotSeconds: 15,
});

type Readiness = { heygen: boolean; seedance: boolean; budget: boolean };

/** The model supplies observations; this function alone selects the stack. */
export function decidePresenterStack(measurements: PresenterShotMeasurements, readiness: Readiness): PresenterStackDecision {
  const result = (route: PresenterStackRoute, reasonCodes: string[], executable = false): PresenterStackDecision => ({
    policyVersion: '1', route, reasonCodes, executable, measurements: structuredClone(measurements),
  });
  const m = measurements;
  const scalar = [m.durationSeconds, m.decisionConfidence, m.visibleSpeechSeconds,
    m.specificGestureCount, m.bodyCenterTravelFrameWidth, m.cameraTravelFrameDiagonal];
  if (!m.shotId || m.durationSeconds <= 0 || scalar.some(value => value === null || !Number.isFinite(value) || value < 0)
    || m.decisionConfidence > 1 || m.bodyCenterTravelFrameWidth! > 1 || m.cameraTravelFrameDiagonal! > 1
    || m.lipSyncRequired === null || m.compositionLockRequired === null || m.physicalProductContact === null
    || !Number.isSafeInteger(m.specificGestureCount)) {
    return result('needs_evidence', ['measurement_missing_or_invalid']);
  }
  if (!m.sourceFirstFrameRef || !m.enterprisePresenterAssetRef) return result('needs_evidence', ['source_first_frame_or_enterprise_presenter_missing']);
  if (m.decisionConfidence < PRESENTER_STACK_POLICY_V1.minimumDecisionConfidence) return result('needs_evidence', ['decision_confidence_below_0_85']);
  if (!m.evidence.length || m.evidence.some(item => !item.frameRef || !item.observation.trim()
    || !Number.isFinite(item.startSeconds) || !Number.isFinite(item.endSeconds)
    || item.startSeconds < 0 || item.endSeconds <= item.startSeconds || item.endSeconds > m.durationSeconds + 0.05)) {
    return result('needs_evidence', ['timecoded_frame_evidence_missing_or_invalid']);
  }
  if (m.physicalProductContact) return result('blocked', ['physical_product_contact_requires_separate_verified_capability']);
  const speech = m.visibleSpeechSeconds! >= PRESENTER_STACK_POLICY_V1.minimumVisibleSpeechSeconds && m.lipSyncRequired;
  const motion = m.specificGestureCount! > 0
    || m.bodyCenterTravelFrameWidth! > PRESENTER_STACK_POLICY_V1.maximumHeygenBodyTravelFrameWidth
    || m.cameraTravelFrameDiagonal! > PRESENTER_STACK_POLICY_V1.maximumHeygenCameraTravelFrameDiagonal
    || m.compositionLockRequired;
  if (!speech && !motion) return result('no_presenter_stack', ['no_precise_speech_or_motion_requirement']);
  if (speech && motion) return result('split_motion_and_speech', ['precise_lip_sync_and_motion_both_required']);
  if (!readiness.budget) return result('blocked', ['budget_unavailable']);
  if (motion) {
    if (m.durationSeconds > PRESENTER_STACK_POLICY_V1.maximumSeedanceShotSeconds) return result('blocked', ['seedance_shot_exceeds_15_seconds']);
    return readiness.seedance
      ? result('seedance_first_frame', ['measured_motion_or_composition_requires_first_frame'], true)
      : result('blocked', ['seedance_capability_unavailable']);
  }
  return readiness.heygen
    ? result('heygen_talking', ['precise_speech_within_motion_limits'], true)
    : result('blocked', ['heygen_capability_unavailable']);
}
