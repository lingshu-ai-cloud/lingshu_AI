export const DIGITAL_HUMAN_TRILINGUAL_ACCEPTANCE_SCHEMA = 'digital-human-trilingual-acceptance-v1';
export const DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES = ['zh', 'en', 'es'] as const;

export type DigitalHumanAcceptanceLanguage = typeof DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES[number];
export type DigitalHumanAcceptanceStatus = 'passed' | 'requires_human_review' | 'failed';

export interface DigitalHumanAcceptanceSegment {
  /** Inclusive segment start in final-video seconds. */
  start: number;
  /** Exclusive segment end in final-video seconds. */
  end: number;
}

export interface DigitalHumanAcceptanceManifestItem {
  language: DigitalHumanAcceptanceLanguage;
  video: string;
  performanceManifest: string;
  humanReview?: string;
  chromaKey?: 'auto' | 'yes' | 'no';
  /**
   * Server-frozen presenter intervals. Gaps are B-roll and are intentionally
   * excluded from face/lip-sync validation. Omit only for a full-presenter video.
   */
  digitalHumanSegments?: DigitalHumanAcceptanceSegment[];
}

export interface DigitalHumanAcceptanceManifest {
  schemaVersion: typeof DIGITAL_HUMAN_TRILINGUAL_ACCEPTANCE_SCHEMA;
  items: DigitalHumanAcceptanceManifestItem[];
}

export interface DigitalHumanAcceptanceItemResult {
  language: DigitalHumanAcceptanceLanguage;
  automatedPassed: boolean;
  requiresHumanReview: boolean;
  passed: boolean;
  validationStatus: DigitalHumanAcceptanceStatus;
  failures: string[];
  humanReviewReasons: string[];
  technical?: Record<string, unknown>;
}

type UnknownRecord = Record<string, unknown>;

const REQUIRED_VISUAL_METRICS: Array<[string, string]> = [
  ['face_detection_rate', '人脸跟踪率'],
  ['mouth_openness_std', '嘴部开合标准差'],
  ['mouth_jump_p95', '嘴部跳变P95'],
  ['mouth_sharpness_median', '嘴部清晰度中位数'],
  ['activity_alignment_lag_frames', '口型活动对齐偏移'],
];

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function parseDigitalHumanSegments(value: unknown, itemIndex: number): DigitalHumanAcceptanceSegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`items[${itemIndex}].digitalHumanSegments 必须为数组`);
  if (value.length < 3) throw new Error(`items[${itemIndex}].digitalHumanSegments 至少需要3段`);
  const segments = value.map((raw, segmentIndex) => {
    const segment = asRecord(raw);
    const start = segment.start;
    const end = segment.end;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
      throw new Error(`items[${itemIndex}].digitalHumanSegments[${segmentIndex}].start 必须为大于等于0的有限秒数`);
    }
    if (typeof end !== 'number' || !Number.isFinite(end) || end <= start) {
      throw new Error(`items[${itemIndex}].digitalHumanSegments[${segmentIndex}].end 必须为大于start的有限秒数`);
    }
    return { start, end };
  });
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index]!.start < segments[index - 1]!.end) {
      throw new Error(`items[${itemIndex}].digitalHumanSegments 必须按时间升序且不得重叠`);
    }
  }
  return segments;
}

export function validateDigitalHumanSegmentBounds(
  segments: DigitalHumanAcceptanceSegment[],
  durationSeconds: number | undefined,
): string[] {
  if (!Number.isFinite(durationSeconds) || Number(durationSeconds) <= 0) return ['ffprobe未提供有效成片时长，无法校验数字人区间边界'];
  const duration = Number(durationSeconds);
  return segments.flatMap((segment, index) => segment.end > duration
    ? [`数字人片段${index + 1}终点 ${segment.end}s 超出成片时长 ${duration}s`]
    : []);
}

function finiteMetrics(records: UnknownRecord[], key: string): number[] {
  return records.map(record => finiteNumber(record[key])).filter((value): value is number => value !== undefined);
}

function minimumMetric(records: UnknownRecord[], key: string): number | undefined {
  const values = finiteMetrics(records, key);
  return values.length ? Math.min(...values) : undefined;
}

function maximumMetric(records: UnknownRecord[], key: string): number | undefined {
  const values = finiteMetrics(records, key);
  return values.length ? Math.max(...values) : undefined;
}

function maximumAbsoluteMetric(records: UnknownRecord[], key: string): number | undefined {
  const values = finiteMetrics(records, key);
  return values.length ? values.reduce((worst, value) => Math.abs(value) > Math.abs(worst) ? value : worst) : undefined;
}

export function aggregateDigitalHumanSegmentQualityReports(entries: Array<{
  segment: DigitalHumanAcceptanceSegment;
  visual: unknown;
  syncnet: unknown;
}>): { visual: UnknownRecord; syncnet: UnknownRecord; segmentReports: UnknownRecord[] } {
  const visualFailures: string[] = [];
  const syncnetFailures: string[] = [];
  const visualReports = entries.map(entry => asRecord(entry.visual));
  const syncnetReports = entries.map(entry => asRecord(entry.syncnet));
  const segmentReports = entries.map((entry, index) => {
    const visual = visualReports[index]!;
    const syncnet = syncnetReports[index]!;
    const prefix = `数字人片段${index + 1} (${entry.segment.start}-${entry.segment.end}s)`;
    const currentVisualFailures: string[] = [];
    for (const [key, label] of REQUIRED_VISUAL_METRICS) {
      if (finiteNumber(visual[key]) === undefined) currentVisualFailures.push(`MediaPipe报告缺少${label}`);
    }
    if (visual.passed !== true) {
      currentVisualFailures.push(...(Array.isArray(visual.failures) && visual.failures.length
        ? visual.failures.map(String)
        : ['MediaPipe口型门禁未通过']));
    }
    const currentSyncnetFailures: string[] = [];
    if (finiteNumber(syncnet.syncnet_confidence) === undefined) currentSyncnetFailures.push('SyncNet报告缺少置信度');
    if (finiteNumber(syncnet.av_offset_frames) === undefined) currentSyncnetFailures.push('SyncNet报告缺少音画偏移');
    if (syncnet.passed !== true) {
      currentSyncnetFailures.push(...(Array.isArray(syncnet.failures) && syncnet.failures.length
        ? syncnet.failures.map(String)
        : ['SyncNet门禁未通过']));
    }
    visualFailures.push(...currentVisualFailures.map(failure => `${prefix}: ${failure}`));
    syncnetFailures.push(...currentSyncnetFailures.map(failure => `${prefix}: ${failure}`));
    return {
      index: index + 1,
      start: entry.segment.start,
      end: entry.segment.end,
      durationSeconds: entry.segment.end - entry.segment.start,
      visualPassed: currentVisualFailures.length === 0,
      syncnetPassed: currentSyncnetFailures.length === 0,
      visualFailures: [...new Set(currentVisualFailures)],
      syncnetFailures: [...new Set(currentSyncnetFailures)],
    };
  });
  if (!entries.length) {
    visualFailures.push('未提供可验证的数字人片段');
    syncnetFailures.push('未提供可验证的数字人片段');
  }
  return {
    visual: {
      passed: visualFailures.length === 0,
      failures: [...new Set(visualFailures)],
      face_detection_rate: minimumMetric(visualReports, 'face_detection_rate'),
      mouth_openness_std: minimumMetric(visualReports, 'mouth_openness_std'),
      mouth_jump_p95: maximumMetric(visualReports, 'mouth_jump_p95'),
      mouth_jump_max: maximumMetric(visualReports, 'mouth_jump_max'),
      mouth_sharpness_median: minimumMetric(visualReports, 'mouth_sharpness_median'),
      activity_alignment_lag_frames: maximumAbsoluteMetric(visualReports, 'activity_alignment_lag_frames'),
      av_activity_correlation: minimumMetric(visualReports, 'av_activity_correlation'),
      validation_scope: 'digital_human_segments',
      segment_count: entries.length,
      segment_reports: segmentReports,
    },
    syncnet: {
      passed: syncnetFailures.length === 0,
      failures: [...new Set(syncnetFailures)],
      syncnet_confidence: minimumMetric(syncnetReports, 'syncnet_confidence'),
      av_offset_frames: maximumAbsoluteMetric(syncnetReports, 'av_offset_frames'),
      validation_scope: 'digital_human_segments',
      segment_count: entries.length,
      segment_reports: segmentReports,
    },
    segmentReports,
  };
}

export function parseDigitalHumanAcceptanceManifest(value: unknown): DigitalHumanAcceptanceManifest {
  const source = asRecord(value);
  if (source.schemaVersion !== DIGITAL_HUMAN_TRILINGUAL_ACCEPTANCE_SCHEMA) {
    throw new Error(`三语验收清单 schemaVersion 必须为 ${DIGITAL_HUMAN_TRILINGUAL_ACCEPTANCE_SCHEMA}`);
  }
  if (!Array.isArray(source.items)) throw new Error('三语验收清单缺少 items');
  const items = source.items.map((raw, index) => {
    const item = asRecord(raw);
    const language = nonEmptyString(item.language);
    if (!DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES.includes(language as DigitalHumanAcceptanceLanguage)) {
      throw new Error(`items[${index}].language 必须为 zh/en/es`);
    }
    const video = nonEmptyString(item.video);
    const performanceManifest = nonEmptyString(item.performanceManifest);
    if (!video) throw new Error(`items[${index}].video 为必填路径`);
    if (!performanceManifest) throw new Error(`items[${index}].performanceManifest 为必填路径`);
    const chromaKey = nonEmptyString(item.chromaKey) || 'auto';
    if (!['auto', 'yes', 'no'].includes(chromaKey)) throw new Error(`items[${index}].chromaKey 只能为 auto/yes/no`);
    const digitalHumanSegments = parseDigitalHumanSegments(item.digitalHumanSegments, index);
    return {
      language: language as DigitalHumanAcceptanceLanguage,
      video,
      performanceManifest,
      ...(nonEmptyString(item.humanReview) ? { humanReview: nonEmptyString(item.humanReview) } : {}),
      chromaKey: chromaKey as 'auto' | 'yes' | 'no',
      ...(digitalHumanSegments ? { digitalHumanSegments } : {}),
    };
  });
  const languages = items.map(item => item.language);
  const missing = DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES.filter(language => !languages.includes(language));
  const duplicates = DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES.filter(language => languages.filter(item => item === language).length > 1);
  if (items.length !== 3 || missing.length || duplicates.length) {
    throw new Error(`三语验收必须且只能包含 zh/en/es 各1条${missing.length ? `；缺少 ${missing.join(',')}` : ''}${duplicates.length ? `；重复 ${duplicates.join(',')}` : ''}`);
  }
  return { schemaVersion: DIGITAL_HUMAN_TRILINGUAL_ACCEPTANCE_SCHEMA, items };
}

export function parseFfmpegFreezeSegments(log: string): { freezeSegments: number; longestFreezeSeconds: number } {
  const starts = [...String(log || '').matchAll(/freeze_start\s*:\s*(-?\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
  const durations = [...String(log || '').matchAll(/freeze_duration\s*:\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
  return {
    freezeSegments: starts.filter(Number.isFinite).length,
    longestFreezeSeconds: durations.filter(Number.isFinite).reduce((maximum, value) => Math.max(maximum, value), 0),
  };
}

export function assessDigitalHumanAcceptanceProbe(value: unknown): { passed: boolean; failures: string[]; metadata: UnknownRecord } {
  const probe = asRecord(value);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(asRecord) : [];
  const video = streams.find(stream => stream.codec_type === 'video') || {};
  const audio = streams.find(stream => stream.codec_type === 'audio') || {};
  const format = asRecord(probe.format);
  const width = finiteNumber(video.width);
  const height = finiteNumber(video.height);
  const durationSeconds = finiteNumber(format.duration ?? video.duration);
  const videoCodec = nonEmptyString(video.codec_name)?.toLowerCase();
  const audioCodec = nonEmptyString(audio.codec_name)?.toLowerCase();
  const formatName = nonEmptyString(format.format_name)?.toLowerCase();
  const failures: string[] = [];
  if (width !== 1080 || height !== 1920) failures.push('最终成片必须为1080x1920');
  if (videoCodec !== 'h264') failures.push('最终成片视频编码必须为H.264');
  if (audioCodec !== 'aac') failures.push('最终成片音频编码必须为AAC');
  if (!formatName || !/(?:^|,)mov(?:,|$)|(?:^|,)mp4(?:,|$)/.test(formatName)) failures.push('最终成片必须为MP4容器');
  if (durationSeconds === undefined || durationSeconds < 14.5 || durationSeconds > 15.5) failures.push('最终成片时长必须在14.5至15.5秒内');
  return {
    passed: failures.length === 0,
    failures,
    metadata: { width, height, durationSeconds, videoCodec, audioCodec, formatName },
  };
}

export function buildDigitalHumanAcceptanceItemResult(input: {
  language: DigitalHumanAcceptanceLanguage;
  probe: unknown;
  decodePassed: boolean;
  visual: unknown;
  syncnet: unknown;
  performance: unknown;
  freezeValidated: boolean;
  freezeLog: string;
  outputSha256?: string;
}): DigitalHumanAcceptanceItemResult {
  const failures: string[] = [];
  const probe = assessDigitalHumanAcceptanceProbe(input.probe);
  failures.push(...probe.failures);
  if (!input.decodePassed) failures.push('ffmpeg无法完整解码最终成片');
  const visual = asRecord(input.visual);
  const syncnet = asRecord(input.syncnet);
  const performance = asRecord(input.performance);
  const freeze = input.freezeValidated ? parseFfmpegFreezeSegments(input.freezeLog) : undefined;

  for (const [key, label] of REQUIRED_VISUAL_METRICS) {
    if (finiteNumber(visual[key]) === undefined) failures.push(`MediaPipe报告缺少${label}`);
  }
  if (visual.passed !== true) failures.push(...(Array.isArray(visual.failures) ? visual.failures.map(String) : ['MediaPipe口型门禁未通过']));
  if (finiteNumber(syncnet.syncnet_confidence) === undefined) failures.push('SyncNet报告缺少置信度');
  if (finiteNumber(syncnet.av_offset_frames) === undefined) failures.push('SyncNet报告缺少音画偏移');
  if (syncnet.passed !== true) failures.push(...(Array.isArray(syncnet.failures) ? syncnet.failures.map(String) : ['SyncNet门禁未通过']));
  if (!input.freezeValidated || !freeze) failures.push('ffmpeg卡帧检测未成功执行');
  else if (freeze.freezeSegments > 0) failures.push(`ffmpeg检测到${freeze.freezeSegments}个冻结片段`);
  if (performance.automated_passed !== true) {
    failures.push(...(Array.isArray(performance.failures) && performance.failures.length
      ? performance.failures.map(String)
      : ['表现力自动门禁未通过']));
  }
  const outputSha256 = nonEmptyString(input.outputSha256)?.toLowerCase();
  if (!outputSha256 || !/^[0-9a-f]{64}$/.test(outputSha256)) failures.push('最终成片SHA256缺失或无效');

  const uniqueFailures = [...new Set(failures.filter(Boolean))];
  const automatedPassed = uniqueFailures.length === 0;
  const reviewReasons = Array.isArray(performance.human_review_reasons)
    ? performance.human_review_reasons.map(String).filter(Boolean)
    : [];
  // Never invent or auto-approve human-review decisions. The performance
  // validator is authoritative and remains pending when no signed record exists.
  const requiresHumanReview = performance.requires_human_review === true || reviewReasons.length > 0;
  const passed = automatedPassed && performance.passed === true && !requiresHumanReview;
  const validationStatus: DigitalHumanAcceptanceStatus = !automatedPassed
    ? 'failed'
    : passed ? 'passed' : 'requires_human_review';
  const gateInput = asRecord(performance.gate_input);
  const observations = asRecord(performance.observations);
  return {
    language: input.language,
    automatedPassed,
    requiresHumanReview,
    passed,
    validationStatus,
    failures: uniqueFailures,
    humanReviewReasons: reviewReasons,
    technical: {
      ...probe.metadata,
      outputSha256,
      decodePassed: input.decodePassed,
      freezeSegments: freeze?.freezeSegments,
      longestFreezeSeconds: freeze?.longestFreezeSeconds,
      faceDetectionRate: finiteNumber(visual.face_detection_rate),
      mouthOpennessStd: finiteNumber(visual.mouth_openness_std),
      mouthJumpP95: finiteNumber(visual.mouth_jump_p95),
      mouthJumpMax: finiteNumber(visual.mouth_jump_max),
      mouthSharpnessMedian: finiteNumber(visual.mouth_sharpness_median),
      activityAlignmentLagFrames: finiteNumber(visual.activity_alignment_lag_frames),
      avActivityCorrelation: finiteNumber(visual.av_activity_correlation),
      syncnetConfidence: finiteNumber(syncnet.syncnet_confidence),
      avOffsetFrames: finiteNumber(syncnet.av_offset_frames),
      semanticBeatCount: finiteNumber(gateInput.semanticBeatCount),
      observedDistinctGestureCount: finiteNumber(gateInput.observedDistinctGestureCount),
      observedExpressionChangeCount: finiteNumber(gateInput.observedExpressionChangeCount),
      observedAdjacentRepeatedActions: finiteNumber(gateInput.observedAdjacentRepeatedActions),
      observedGlobalRepeatedActions: finiteNumber(gateInput.observedGlobalRepeatedActions),
      observedGlobalRepeatedExpressions: finiteNumber(gateInput.observedGlobalRepeatedExpressions),
      maximumNonMouthStaticSeconds: finiteNumber(gateInput.maximumNonMouthStaticSeconds),
      observedSceneOrCompositionCount: finiteNumber(gateInput.observedSceneOrCompositionCount),
      actionAlignmentMaxMs: finiteNumber(gateInput.actionAlignmentMaxMs),
      multipleFaceRate: finiteNumber(gateInput.multipleFaceRate),
      identityProxy: asRecord(observations.identity_proxy),
      handStructureProxy: asRecord(observations.hand_structure_proxy),
      greenEdge: asRecord(observations.green_edge),
      performanceValidatorVersion: nonEmptyString(performance.validator_version),
      humanReviewRecord: nonEmptyString(asRecord(performance.provenance).human_review),
    },
  };
}

export function buildDigitalHumanTrilingualAcceptanceSummary(items: DigitalHumanAcceptanceItemResult[]) {
  const languages = new Set(items.map(item => item.language));
  const complete = items.length === 3 && DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES.every(language => languages.has(language));
  const automatedPassed = complete && items.every(item => item.automatedPassed);
  const requiresHumanReview = items.some(item => item.requiresHumanReview || item.validationStatus === 'requires_human_review');
  const passed = complete && items.every(item => item.passed) && !requiresHumanReview;
  const validationStatus: DigitalHumanAcceptanceStatus = !automatedPassed
    ? 'failed'
    : passed ? 'passed' : 'requires_human_review';
  return {
    schemaVersion: DIGITAL_HUMAN_TRILINGUAL_ACCEPTANCE_SCHEMA,
    automatedPassed,
    requiresHumanReview,
    passed,
    validationStatus,
    expectedLanguages: [...DIGITAL_HUMAN_ACCEPTANCE_LANGUAGES],
    completedLanguages: items.map(item => item.language),
    failures: items.flatMap(item => item.failures.map(failure => `${item.language}: ${failure}`)),
    humanReviewReasons: items.flatMap(item => item.humanReviewReasons.map(reason => `${item.language}: ${reason}`)),
    items,
  };
}
