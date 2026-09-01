export type DigitalHumanMode = 'fast' | 'quality';

export interface DigitalHumanGateInput {
  passed?: boolean;
  lipSyncScore?: number;
  avOffsetFrames?: number;
  freezeSegments?: number;
  faceDetectionRate?: number;
  mouthJumpP95?: number;
}

export function commercialDigitalHumanGate(input: DigitalHumanGateInput, mode: DigitalHumanMode, provider = '') {
  const failures: string[] = [];
  // Raw SyncNet confidence distributions differ materially by model family.
  // MuseTalk's official/validated gate uses 3.0; we require 4.0 in quality
  // mode and retain the stricter 7.0 bar for LatentSync-class providers.
  const museTalk = /musetalk/i.test(provider);
  const minimumSync = museTalk ? (mode === 'quality' ? 4 : 3) : (mode === 'quality' ? 7 : 4);
  const maximumOffset = mode === 'quality' ? 1 : 2;

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

  return { passed: failures.length === 0, failures };
}
