import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aggregateDigitalHumanSegmentQualityReports,
  buildDigitalHumanAcceptanceItemResult,
  buildDigitalHumanTrilingualAcceptanceSummary,
  parseDigitalHumanAcceptanceManifest,
  parseFfmpegFreezeSegments,
  validateDigitalHumanSegmentBounds,
} from './digitalHumanTrilingualAcceptance.js';

const manifest = parseDigitalHumanAcceptanceManifest({
  schemaVersion: 'digital-human-trilingual-acceptance-v1',
  items: [
    { language: 'zh', video: 'zh.mp4', performanceManifest: 'zh-performance.json' },
    { language: 'en', video: 'en.mp4', performanceManifest: 'en-performance.json' },
    { language: 'es', video: 'es.mp4', performanceManifest: 'es-performance.json' },
  ],
});
assert.deepEqual(manifest.items.map(item => item.language), ['zh', 'en', 'es']);
assert.equal(manifest.items.some(item => item.humanReview), false, '不得自动伪造人工复核路径');
assert.equal(manifest.items.some(item => item.digitalHumanSegments), false, '旧版纯数字人清单必须继续支持整片验证');

const segmentedManifest = parseDigitalHumanAcceptanceManifest({
  schemaVersion: 'digital-human-trilingual-acceptance-v1',
  items: ['zh', 'en', 'es'].map(language => ({
    language,
    video: `${language}.mp4`,
    performanceManifest: `${language}-performance.json`,
    digitalHumanSegments: [
      { start: 0, end: 3.25 },
      { start: 5, end: 8.5 },
      { start: 11, end: 15 },
    ],
    browserClaimedQuality: { passed: true },
  })),
});
assert.deepEqual(segmentedManifest.items[0]?.digitalHumanSegments, [
  { start: 0, end: 3.25 },
  { start: 5, end: 8.5 },
  { start: 11, end: 15 },
]);
assert.equal('browserClaimedQuality' in segmentedManifest.items[0]!, false, '解析器必须丢弃浏览器声称的质量结果');
assert.throws(() => parseDigitalHumanAcceptanceManifest({
  schemaVersion: 'digital-human-trilingual-acceptance-v1',
  items: ['zh', 'en', 'es'].map(language => ({
    language, video: `${language}.mp4`, performanceManifest: `${language}.json`,
    digitalHumanSegments: [{ start: 0, end: 2 }, { start: 3, end: 5 }],
  })),
}), /至少需要3段/);
assert.throws(() => parseDigitalHumanAcceptanceManifest({
  schemaVersion: 'digital-human-trilingual-acceptance-v1',
  items: ['zh', 'en', 'es'].map(language => ({
    language, video: `${language}.mp4`, performanceManifest: `${language}.json`,
    digitalHumanSegments: [{ start: 0, end: 3 }, { start: 2.9, end: 5 }, { start: 6, end: 8 }],
  })),
}), /不得重叠/);
assert.throws(() => parseDigitalHumanAcceptanceManifest({
  schemaVersion: 'digital-human-trilingual-acceptance-v1',
  items: ['zh', 'en', 'es'].map(language => ({
    language, video: `${language}.mp4`, performanceManifest: `${language}.json`,
    digitalHumanSegments: [{ start: '0', end: 3 }, { start: 4, end: 6 }, { start: 7, end: 9 }],
  })),
}), /有限秒数/);
assert.deepEqual(validateDigitalHumanSegmentBounds(segmentedManifest.items[0]!.digitalHumanSegments!, 15), []);
assert.match(validateDigitalHumanSegmentBounds([{ start: 0, end: 15.01 }], 15)[0]!, /超出成片时长/);
assert.match(validateDigitalHumanSegmentBounds([{ start: 0, end: 1 }], undefined)[0]!, /ffprobe/);
assert.throws(() => parseDigitalHumanAcceptanceManifest({
  schemaVersion: 'digital-human-trilingual-acceptance-v1',
  items: [
    { language: 'zh', video: '1.mp4', performanceManifest: '1.json' },
    { language: 'zh', video: '2.mp4', performanceManifest: '2.json' },
    { language: 'en', video: '3.mp4', performanceManifest: '3.json' },
  ],
}), /zh\/en\/es/);

const probe = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '15.0' },
};
const visual = {
  passed: true,
  face_detection_rate: 0.995,
  mouth_openness_std: 0.035,
  mouth_jump_p95: 0.055,
  mouth_jump_max: 0.11,
  mouth_sharpness_median: 64,
  activity_alignment_lag_frames: 1,
  av_activity_correlation: 0.3,
  failures: [],
};
const syncnet = { passed: true, syncnet_confidence: 4.5, av_offset_frames: 0, failures: [] };
const segmentedQuality = aggregateDigitalHumanSegmentQualityReports([
  { segment: { start: 0, end: 3 }, visual: { ...visual, face_detection_rate: 0.99 }, syncnet: { ...syncnet, syncnet_confidence: 4.8 } },
  { segment: { start: 5, end: 8 }, visual: { ...visual, mouth_jump_p95: 0.07 }, syncnet: { ...syncnet, syncnet_confidence: 3.4 } },
  { segment: { start: 11, end: 15 }, visual: { ...visual, mouth_sharpness_median: 58 }, syncnet: { ...syncnet, av_offset_frames: -2 } },
]);
assert.equal(segmentedQuality.visual.passed, true);
assert.equal(segmentedQuality.syncnet.passed, true);
assert.equal(segmentedQuality.visual.face_detection_rate, 0.99, '聚合人脸率必须取最差片段');
assert.equal(segmentedQuality.visual.mouth_jump_p95, 0.07, '聚合嘴部跳变必须取最差片段');
assert.equal(segmentedQuality.visual.mouth_sharpness_median, 58, '聚合清晰度必须取最差片段');
assert.equal(segmentedQuality.syncnet.syncnet_confidence, 3.4, '聚合 SyncNet 置信度必须取最差片段');
assert.equal(segmentedQuality.syncnet.av_offset_frames, -2, '聚合音画偏移必须取绝对值最差片段');

const failedSegmentQuality = aggregateDigitalHumanSegmentQualityReports([
  { segment: { start: 0, end: 3 }, visual, syncnet },
  { segment: { start: 5, end: 8 }, visual: { ...visual, passed: false, failures: ['mouth jump'] }, syncnet },
  { segment: { start: 11, end: 15 }, visual, syncnet: { ...syncnet, passed: false, failures: ['confidence too low'] } },
]);
assert.equal(failedSegmentQuality.visual.passed, false);
assert.equal(failedSegmentQuality.syncnet.passed, false);
assert.match(String((failedSegmentQuality.visual.failures as string[])[0]), /数字人片段2/);
assert.match(String((failedSegmentQuality.syncnet.failures as string[])[0]), /数字人片段3/);
const gateInput = {
  semanticBeatCount: 3,
  observedDistinctGestureCount: 2,
  observedExpressionChangeCount: 1,
  observedAdjacentRepeatedActions: 0,
  maximumNonMouthStaticSeconds: 3.2,
  observedSceneOrCompositionCount: 2,
  actionAlignmentMaxMs: 600,
  multipleFaceRate: 0,
};
const pendingPerformance = {
  passed: false,
  automated_passed: true,
  requires_human_review: true,
  validation_status: 'requires_human_review',
  failures: [],
  human_review_reasons: ['双嘴需人工复核'],
  validator_version: '2.0.0',
  gate_input: gateInput,
  observations: { identity_proxy: {}, hand_structure_proxy: {}, green_edge: {} },
  provenance: { human_review: null },
};
const pending = buildDigitalHumanAcceptanceItemResult({
  language: 'zh', probe, decodePassed: true, visual, syncnet,
  performance: pendingPerformance, freezeValidated: true, freezeLog: '', outputSha256: 'a'.repeat(64),
});
assert.equal(pending.automatedPassed, true);
assert.equal(pending.passed, false);
assert.equal(pending.validationStatus, 'requires_human_review');
assert.equal(pending.requiresHumanReview, true);
assert.equal(pending.technical?.humanReviewRecord, undefined, '批量验收不得生成人工批准记录');

const rejectedByOneSegment = buildDigitalHumanAcceptanceItemResult({
  language: 'zh', probe, decodePassed: true,
  visual: failedSegmentQuality.visual,
  syncnet: failedSegmentQuality.syncnet,
  performance: pendingPerformance,
  freezeValidated: true,
  freezeLog: '',
  outputSha256: 'd'.repeat(64),
});
assert.equal(rejectedByOneSegment.automatedPassed, false, '任一数字人片段失败必须使整片自动门禁失败');
assert.match(rejectedByOneSegment.failures.join('\n'), /数字人片段[23]/);

const approved = buildDigitalHumanAcceptanceItemResult({
  language: 'en', probe, decodePassed: true, visual, syncnet,
  performance: {
    ...pendingPerformance,
    passed: true,
    requires_human_review: false,
    validation_status: 'passed',
    human_review_reasons: [],
    provenance: { human_review: 'signed-review.json' },
  },
  freezeValidated: true, freezeLog: '', outputSha256: 'b'.repeat(64),
});
assert.equal(approved.passed, true);

const frozen = buildDigitalHumanAcceptanceItemResult({
  language: 'es', probe, decodePassed: true, visual, syncnet,
  performance: { ...pendingPerformance, passed: true, requires_human_review: false, human_review_reasons: [] },
  freezeValidated: true,
  freezeLog: 'freeze_start: 2.4\nfreeze_end: 3.8\nfreeze_duration: 1.4',
  outputSha256: 'c'.repeat(64),
});
assert.equal(frozen.automatedPassed, false);
assert.equal(parseFfmpegFreezeSegments('freeze_start: 2\nfreeze_duration: 1.5').longestFreezeSeconds, 1.5);

const summaryPending = buildDigitalHumanTrilingualAcceptanceSummary([
  pending,
  { ...approved, language: 'en', passed: false, requiresHumanReview: true, validationStatus: 'requires_human_review' },
  { ...approved, language: 'es', passed: false, requiresHumanReview: true, validationStatus: 'requires_human_review' },
]);
assert.equal(summaryPending.automatedPassed, true);
assert.equal(summaryPending.passed, false);
assert.equal(summaryPending.validationStatus, 'requires_human_review');

const cli = readFileSync(new URL('../../scripts/validate-digital-human-trilingual.ts', import.meta.url), 'utf8');
assert.match(cli, /'ffprobe'/);
assert.match(cli, /validate-digital-human-performance\.py/);
assert.match(cli, /validate-digital-human\.py/);
assert.match(cli, /validate-syncnet\.py/);
assert.match(cli, /freezedetect=n=/);
assert.match(cli, /trim=start=\$\{start\}:end=\$\{end\}/, '数字人画面必须按冻结区间精确裁切');
assert.match(cli, /atrim=start=\$\{start\}:end=\$\{end\}/, '数字人音轨必须与画面用同一冻结区间裁切');
assert.match(cli, /aggregateDigitalHumanSegmentQualityReports\(entries\)/, '逐段门禁结果必须聚合');
assert.match(cli, /item\.digitalHumanSegments[\s\S]{0,160}validateSegmentedFaceAndLipSync[\s\S]{0,120}validateWholeVideoFaceAndLipSync/, '新清单逐段验证，旧清单保留整片验证');
assert.match(cli, /'--min-confidence', String\(strictSyncnetConfidence\)/, 'SyncNet 必须显式使用严格整片门槛');
assert.match(cli, /const performanceArgs = \[[\s\S]{0,120}'--video', toExecutionPath\(video\)/, '表现力门禁必须仍使用整片路径');
assert.match(cli, /const performance = await jsonValidator\(\s*'表现力门禁'/, '表现力门禁必须仍对整片执行');
assert.match(cli, /if \(humanReviewPath\) performanceArgs\.push/, '仅当调用方显式提供复核文件时才能传入');
assert.doesNotMatch(cli, /doubleMouth[^\n]{0,80}approved/);
assert.doesNotMatch(cli, /complexHands[^\n]{0,80}approved/);
assert.doesNotMatch(cli, /voiceMatch[^\n]{0,80}approved/);

console.log('digital human trilingual acceptance tests passed');
