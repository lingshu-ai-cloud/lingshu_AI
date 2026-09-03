export type DigitalHumanMode = 'fast' | 'quality';

export interface DigitalHumanGateInput {
  passed?: boolean;
  lipSyncScore?: number;
  avOffsetFrames?: number;
  freezeSegments?: number;
  faceDetectionRate?: number;
  mouthJumpP95?: number;
  durationSeconds?: number;
}

export interface DigitalHumanGateContext {
  validationScope?: 'segment' | 'final';
  /** Server-measured/expected duration. Never populate this from a client claim. */
  expectedDurationSeconds?: number;
}

export function commercialDigitalHumanGate(
  input: DigitalHumanGateInput,
  mode: DigitalHumanMode,
  provider = '',
  context: DigitalHumanGateContext = {},
) {
  const failures: string[] = [];
  // Raw SyncNet confidence distributions differ materially by model family.
  // MuseTalk's official/validated gate uses 3.0; we require 4.0 in quality
  // mode and retain the stricter 7.0 bar for LatentSync-class providers.
  const museTalk = /musetalk/i.test(provider);
  // SyncNet confidence is length-sensitive. A server-confirmed short storyboard
  // segment uses the separately validated segment threshold; it must not weaken
  // the whole-film publishing gate. Both the expected and measured duration are
  // bounded so a provider/client cannot label a long film as a segment.
  const shortMuseTalkSegment = museTalk
    && context.validationScope === 'segment'
    && Number.isFinite(context.expectedDurationSeconds)
    && Number(context.expectedDurationSeconds) <= 5.5
    && Number.isFinite(input.durationSeconds)
    && Number(input.durationSeconds) <= 5.5;
  // V2 trilingual acceptance validates every digital-human interval at 3.0.
  // Keep the per-shot server gate identical so a segment cannot pass here and
  // become an inevitable rejection only after the complete film is assembled.
  const minimumSync = shortMuseTalkSegment ? 3 : museTalk ? (mode === 'quality' ? 4 : 3) : (mode === 'quality' ? 7 : 4);
  const maximumOffset = shortMuseTalkSegment ? 3 : mode === 'quality' ? 1 : 2;

  if (input.passed !== true) failures.push('推理服务未确认质量通过');
  if (!Number.isFinite(input.lipSyncScore) || Number(input.lipSyncScore) < minimumSync) {
    failures.push(`SyncNet置信度须不低于${minimumSync}`);
  }
  if (!Number.isFinite(input.avOffsetFrames) || Math.abs(Number(input.avOffsetFrames)) > maximumOffset) {
    failures.push(`音画偏移须不超过${maximumOffset}帧`);
  }
  if (Number(input.freezeSegments || 0) > 0) failures.push('存在冻结片段');
  if (Number.isFinite(input.faceDetectionRate) && Number(input.faceDetectionRate) < 0.98) failures.push('人脸跟踪率须不低于98%');
  if (Number.isFinite(input.mouthJumpP95) && Number(input.mouthJumpP95) > 0.085) failures.push('嘴部时序跳变超过商业门槛');

  return {
    passed: failures.length === 0,
    failures,
    validationScope: shortMuseTalkSegment ? 'segment' as const : 'final' as const,
    thresholds: { minimumSync, maximumOffset },
  };
}
