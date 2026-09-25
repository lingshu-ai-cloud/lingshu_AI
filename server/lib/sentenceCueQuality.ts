import type { SentenceCueQuality } from '../../src/lib/digitalHumanPlan.js';
import type { PersonReplacementTechnicalMetrics } from './personReplacementMediaQuality.js';
import type { ReferenceVisualMetrics } from '../../src/lib/digitalHumanQuality.js';
import type { SentenceSemanticQualityReport, SentenceSemanticDecision } from './sentenceSemanticQuality.js';

type Check = SentenceCueQuality['checks'][number];

const pending = (key: Check['key'], evidence: string): Check => ({ key, status: 'pending', evidence });
const decided = (key: Check['key'], passed: boolean, evidence: string): Check => ({ key, status: passed ? 'passed' : 'failed', evidence });

/**
 * Converts independent local detectors into conservative per-cue decisions.
 * Proxy evidence may reject an obvious defect, but never claims identity,
 * product/text fidelity, action semantics, or lip sync on its own.
 */
export function sentenceCueQualityFromEvidence(input: {
  cueId: string;
  mediaEvidence: string;
  technical?: PersonReplacementTechnicalMetrics | null;
  technicalError?: string;
  visual?: ReferenceVisualMetrics | null;
  visualError?: string;
  semantic?: SentenceSemanticQualityReport | null;
  semanticError?: string;
}): SentenceCueQuality {
  const technical = input.technical;
  const visual = input.visual;
  const technicalEvidence = technical
    ? `独立 FFmpeg：对比 ${technical.comparedFrames} 帧，时长差 ${technical.durationDeltaFrames} 帧，运动差 ${technical.temporalMotionDifference.toFixed(2)}，停帧差异 ${(technical.freezeMismatchRatio * 100).toFixed(1)}%`
    : `独立 FFmpeg 未完成：${input.technicalError || '无可用证据'}`;
  const motionAnomaly = Boolean(technical && (technical.comparedFrames < 5 || technical.temporalMotionDifference > 8 || technical.freezeMismatchRatio > 0.05));
  const audioStructuralFailure = Boolean(technical && (!technical.candidate.hasAudio || technical.durationDeltaFrames > 1));
  const visualPoseAnomaly = Boolean(visual && (visual.posePairCount < 5 || visual.normalizedPoseError === null || visual.normalizedPoseError > 0.08
    || (visual.handPairCount > 0 && (visual.handPckAt008 === null || visual.handPckAt008 < 0.7))
    || (visual.wristPosePairCount > 0 && (visual.wristSeparationMae === null || visual.wristSeparationMae > 0.35))));
  const visualEvidence = visual
    ? `独立视觉代理：姿态配对 ${visual.posePairCount} 帧，误差 ${visual.normalizedPoseError?.toFixed(3) ?? '缺失'}；背景 SSIM ${visual.backgroundSsim?.toFixed(3) ?? '缺失'}；关键点异常 ${visual.landmarkArtifactCount}`
    : `独立视觉代理未完成：${input.visualError || '未配置'}`;

  let motion = pending('motion', `${technicalEvidence}；${visualEvidence}。代理正常仍需确认动作语义。`);
  if (motionAnomaly || visualPoseAnomaly) motion = decided('motion', false, `${technicalEvidence}；${visualEvidence}。检测到运动／姿态异常。`);

  let background = pending('background', visualEvidence);
  if (visual?.backgroundSsim !== null && visual?.backgroundSsim !== undefined) {
    background = decided('background', visual.backgroundSsim >= 0.85, `${visualEvidence}。阈值 0.85。`);
  }

  let audioSync = pending('audio_sync', technical
    ? `${technicalEvidence}；候选音轨=${technical.candidate.hasAudio ? '有' : '无'}。结构检查不能证明口型同步，仍需人工验收。`
    : technicalEvidence);
  if (audioStructuralFailure) audioSync = decided('audio_sync', false, `${technicalEvidence}；候选缺少音轨或时长偏差超过 1 帧。`);

  let reuseRisk = pending('reuse_risk', technicalEvidence);
  if (technical?.comparedFrames) {
    const frameRisk = technical.wholeFrameSimilarity >= 0.92;
    const audioRisk = technical.audioCorrelation !== null && Math.abs(technical.audioCorrelation) >= 0.9;
    reuseRisk = decided('reuse_risk', !frameRisk && !audioRisk,
      `${technicalEvidence}；整帧相似度 ${technical.wholeFrameSimilarity.toFixed(3)}（风险阈值 0.92）；音频相关度 ${technical.audioCorrelation === null ? '不可用' : Math.abs(technical.audioCorrelation).toFixed(3)}（风险阈值 0.90）。`);
  }

  const semanticCheck = (key: 'identity' | 'product_brand_text', value: SentenceSemanticDecision | undefined, fallback: string): Check => {
    if (!value || value.status === 'unknown') return pending(key, value ? `${input.semantic?.model} · 置信度 ${value.confidence.toFixed(3)} · ${value.evidence}` : `${fallback}${input.semanticError ? `；独立语义检测未完成：${input.semanticError}` : ''}`);
    const evidence = `${input.semantic?.model} · 置信度 ${value.confidence.toFixed(3)} · ${value.evidence} · 帧 ${value.frameRefs.join('、')}`;
    if (value.status === 'fail' && value.confidence >= 0.6) return decided(key, false, evidence);
    if (value.status === 'pass' && value.confidence >= 0.85) return decided(key, true, evidence);
    return pending(key, `${evidence}；置信度未达到自动判定阈值`);
  };
  const checks: SentenceCueQuality['checks'] = [
    decided('media', true, input.mediaEvidence),
    semanticCheck('identity', input.semantic?.identity, '等待独立身份模型或人工逐镜验收；人脸外观代理不得作为身份通过证据'),
    motion,
    semanticCheck('product_brand_text', input.semantic?.productBrandText, '等待独立产品、品牌与文字识别或人工逐镜验收'),
    background,
    audioSync,
    reuseRisk,
  ];
  const state = checks.some(check => check.status === 'failed') ? 'failed' : 'manual_review';
  return { cueId: input.cueId, kind: 'person_generated', state, checks };
}
