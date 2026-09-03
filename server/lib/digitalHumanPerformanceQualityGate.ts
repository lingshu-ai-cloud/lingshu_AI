export const DIGITAL_HUMAN_PERFORMANCE_SCHEMA_V2 = 'digital-human-performance-observation-v2' as const;

export type ReviewDecision = 'approved' | 'rejected' | 'pending';
export type ObservationStatus = 'passed' | 'failed' | 'unavailable';
export type GreenEdgeStatus = 'passed' | 'failed' | 'not_applicable' | 'unavailable';

/**
 * Required, flattened machine input emitted as `gate_input` by
 * scripts/validate-digital-human-performance.py. Visual claims are measured on
 * the final render; only semantic beats and keyword timestamps come from the
 * plan manifest.
 */
export interface PerformanceQualityInput {
  schemaVersion: typeof DIGITAL_HUMAN_PERFORMANCE_SCHEMA_V2;
  durationSeconds: number;
  ratio: string;
  semanticBeatCount: number;
  semanticBeatCountSource: 'manifest_time_anchor';
  sampledFrameCount: number;
  sceneSampleCount: number;
  presenterExpectedSampleCount: number;
  presenterDetectedSampleCount: number;
  poseSampleCount: number;
  observedDistinctGestureCount: number;
  observedExpressionChangeCount: number;
  observedAdjacentRepeatedActions: number;
  maximumNonMouthStaticSeconds: number;
  observedSceneOrCompositionCount: number;
  observedActionChangeCount: number;
  observedActionPeakCount: number;
  actionAlignmentObservationCount: number;
  actionAlignmentMaxMs: number | null;
  multipleFaceRate: number;
  missingPresenterFaceRate: number;
  identityGeometryOutlierRate: number;
  identityProxyStatus: ObservationStatus;
  freezeSegments: number;
  handStructuralAnomalyDetected: boolean;
  greenEdgeStatus: GreenEdgeStatus;
  doubleMouthReview: ReviewDecision;
  complexHandReview: ReviewDecision;
  voiceMatchReview: ReviewDecision;
  humanReviewRecordValid: boolean;
}

export interface PerformanceGateCheck {
  id: string;
  status: 'passed' | 'failed';
  source: 'observed_video' | 'manifest_time_anchor';
  message: string;
}

export interface PerformanceGateResult {
  passed: boolean;
  automatedPassed: boolean;
  validationStatus: 'passed' | 'failed' | 'requires_human_review';
  requiresHumanReview: boolean;
  failures: string[];
  humanReviewReasons: string[];
  warnings: string[];
  checks: PerformanceGateCheck[];
  gateVersion: 'performance-gate-v2';
}

export const DIGITAL_HUMAN_PERFORMANCE_THRESHOLDS = Object.freeze({
  durationSecondsMinimum: 14.5,
  durationSecondsMaximum: 15.5,
  minimumSampledFrames: 60,
  minimumFaceCoverage: 0.95,
  minimumPoseCoverage: 0.35,
  maximumNonMouthStaticSeconds: 4,
  maximumActionAlignmentMs: 900,
  maximumMultipleFaceRate: 0.01,
  maximumMissingPresenterFaceRate: 0.05,
  maximumIdentityGeometryOutlierRate: 0.08,
});

const REQUIRED_NUMERIC_FIELDS = [
  'durationSeconds',
  'semanticBeatCount',
  'sampledFrameCount',
  'sceneSampleCount',
  'presenterExpectedSampleCount',
  'presenterDetectedSampleCount',
  'poseSampleCount',
  'observedDistinctGestureCount',
  'observedExpressionChangeCount',
  'observedAdjacentRepeatedActions',
  'maximumNonMouthStaticSeconds',
  'observedSceneOrCompositionCount',
  'observedActionChangeCount',
  'observedActionPeakCount',
  'actionAlignmentObservationCount',
  'multipleFaceRate',
  'missingPresenterFaceRate',
  'identityGeometryOutlierRate',
  'freezeSegments',
] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Fail-closed complete-film gate. A clean automated result is not a release
 * approval until double-mouth, complex fingers and voice/avatar fit have an
 * explicit human decision; current landmark models cannot clear those reliably.
 */
export function digitalHumanPerformanceGate(input: PerformanceQualityInput): PerformanceGateResult {
  const candidate = input as unknown as Record<string, unknown>;
  const failures: string[] = [];
  const humanReviewReasons: string[] = [];
  const checks: PerformanceGateCheck[] = [];
  const threshold = DIGITAL_HUMAN_PERFORMANCE_THRESHOLDS;

  const check = (
    id: string,
    passed: boolean,
    message: string,
    source: PerformanceGateCheck['source'] = 'observed_video',
  ) => {
    checks.push({ id, status: passed ? 'passed' : 'failed', source, message });
    if (!passed) failures.push(message);
  };

  if (candidate.schemaVersion !== DIGITAL_HUMAN_PERFORMANCE_SCHEMA_V2) {
    failures.push('表现力报告 schema 版本缺失或不受支持');
  }
  const missingNumericFields = REQUIRED_NUMERIC_FIELDS.filter((field) => !isFiniteNumber(candidate[field]));
  if (missingNumericFields.length > 0) {
    failures.push(`表现力报告缺少必填实测字段: ${missingNumericFields.join(', ')}`);
  } else {
    check(
      'duration',
      input.durationSeconds >= threshold.durationSecondsMinimum
        && input.durationSeconds <= threshold.durationSecondsMaximum,
      '成片时长不在15秒验收容差内',
    );
    check('semantic_beats', input.semanticBeatCount >= 3, '语义段落少于3个', 'manifest_time_anchor');
    check(
      'sample_coverage',
      input.sampledFrameCount >= threshold.minimumSampledFrames
        && input.sceneSampleCount >= threshold.minimumSampledFrames,
      '视频实测采样覆盖不足',
    );
    const expectedSamples = Math.max(1, input.presenterExpectedSampleCount);
    check(
      'face_coverage',
      input.presenterDetectedSampleCount / expectedSamples >= threshold.minimumFaceCoverage,
      '人物应出现区间的人脸实测覆盖不足',
    );
    check(
      'pose_coverage',
      input.poseSampleCount / expectedSamples >= threshold.minimumPoseCoverage,
      '动作姿态实测覆盖不足',
    );
    check('gestures', input.observedDistinctGestureCount >= 2, '实测明确不同的手势少于2种');
    check('expression', input.observedExpressionChangeCount >= 1, '未实测到自然可见的非嘴部表情变化');
    check('adjacent_actions', input.observedAdjacentRepeatedActions === 0, '相邻分镜实测为重复动作');
    check(
      'static_span',
      input.maximumNonMouthStaticSeconds <= threshold.maximumNonMouthStaticSeconds,
      '连续非嘴部静止超过4秒',
    );
    check('composition', input.observedSceneOrCompositionCount >= 2, '实测场景或构图少于2种');
    check('action_changes', input.observedActionChangeCount >= 1, '未实测到明确动作状态变化');
    check('action_peaks', input.observedActionPeakCount >= 2, '实测有效动作峰值少于2次');
    check(
      'action_alignment',
      isFiniteNumber(input.actionAlignmentMaxMs)
        && input.actionAlignmentObservationCount >= 2
        && input.actionAlignmentMaxMs <= threshold.maximumActionAlignmentMs,
      '实测动作峰值与台词语义锚点不同步',
    );
    check('multiple_faces', input.multipleFaceRate <= threshold.maximumMultipleFaceRate, '多脸帧比例超过门槛');
    check(
      'missing_faces',
      input.missingPresenterFaceRate <= threshold.maximumMissingPresenterFaceRate,
      '人物应出现区间的人脸跟踪不稳定',
    );
    if (input.identityProxyStatus === 'unavailable') {
      humanReviewReasons.push('身份稳定代理不可用，需人工复核');
    } else {
      check(
        'identity_proxy',
        input.identityProxyStatus === 'passed'
          && input.identityGeometryOutlierRate <= threshold.maximumIdentityGeometryOutlierRate,
        '人脸几何身份稳定代理未通过',
      );
    }
    check('freeze', input.freezeSegments === 0, '检测到卡帧区间');
    check('hand_structure', input.handStructuralAnomalyDetected === false, '检测到手部数量或时序结构异常');
    check(
      'green_edge',
      input.greenEdgeStatus === 'passed' || input.greenEdgeStatus === 'not_applicable',
      '绿边检测失败或在适用场景不可用',
    );
    check('ratio', input.ratio === '9:16', '输出构图不是9:16');
  }

  const malformedRequiredFields: string[] = [];
  if (typeof candidate.ratio !== 'string') malformedRequiredFields.push('ratio');
  if (!['passed', 'failed', 'unavailable'].includes(String(candidate.identityProxyStatus))) malformedRequiredFields.push('identityProxyStatus');
  if (!['passed', 'failed', 'not_applicable', 'unavailable'].includes(String(candidate.greenEdgeStatus))) malformedRequiredFields.push('greenEdgeStatus');
  if (typeof candidate.handStructuralAnomalyDetected !== 'boolean') malformedRequiredFields.push('handStructuralAnomalyDetected');
  for (const field of ['doubleMouthReview', 'complexHandReview', 'voiceMatchReview'] as const) {
    if (!['approved', 'rejected', 'pending'].includes(String(candidate[field]))) malformedRequiredFields.push(field);
  }
  if (typeof candidate.humanReviewRecordValid !== 'boolean') malformedRequiredFields.push('humanReviewRecordValid');
  if (malformedRequiredFields.length > 0) {
    failures.push(`表现力报告缺少必填状态字段: ${malformedRequiredFields.join(', ')}`);
  }

  if (candidate.semanticBeatCountSource !== 'manifest_time_anchor') {
    failures.push('语义段落来源字段缺失或不受支持');
  }

  const reviewChecks: Array<[ReviewDecision | unknown, string]> = [
    [candidate.doubleMouthReview, '双嘴'],
    [candidate.complexHandReview, '复杂手部'],
    [candidate.voiceMatchReview, '声音与人物匹配'],
  ];
  for (const [decision, label] of reviewChecks) {
    if (decision === 'rejected') failures.push(`人工复核确认${label}不合格`);
    else if (decision !== 'approved') humanReviewReasons.push(`${label}无法由当前自动模型可靠排除，需人工复核`);
  }
  if (reviewChecks.some(([decision]) => decision === 'approved') && candidate.humanReviewRecordValid !== true) {
    failures.push('人工复核结论缺少 reviewer 或 reviewedAt，记录不可审计');
  }

  const automatedPassed = failures.length === 0;
  const requiresHumanReview = humanReviewReasons.length > 0;
  return {
    passed: automatedPassed && !requiresHumanReview,
    automatedPassed,
    validationStatus: failures.length > 0 ? 'failed' : requiresHumanReview ? 'requires_human_review' : 'passed',
    requiresHumanReview,
    failures,
    humanReviewReasons,
    warnings: ['语义段落数与关键词时间仅来自编排清单；动作和画面指标来自成片实测'],
    checks,
    gateVersion: 'performance-gate-v2',
  };
}
