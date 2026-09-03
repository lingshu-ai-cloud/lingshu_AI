import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDigitalHumanFinalQualityReport,
  countFreezeSegments,
  DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
  isBlockedDigitalHumanNetworkAddress,
  isLoopbackHostname,
  validateDigitalHumanHubUrl,
  validateResolvedDigitalHumanInputUrl,
  validateDigitalHumanWorkerInputUrl,
} from './digitalHumanWorkerFinalQuality.js';
import { DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE } from './digitalHumanRenderTreatment.js';
import {
  buildMuseTalkProfileSelectionNotes,
  MUSE_TALK_RENDER_PROFILES,
  museTalkRunnerProfileArguments,
  nextMuseTalkProfile,
  type MuseTalkProfileAttemptSummary,
} from './digitalHumanMuseTalkProfilePolicy.js';

const allowed = new Set(['127.0.0.1', 'localhost', 'media.example.com']);
assert.equal(validateDigitalHumanWorkerInputUrl('http://127.0.0.1:8788/file.mp4', allowed).protocol, 'http:');
assert.equal(validateDigitalHumanWorkerInputUrl('https://media.example.com/file.mp4', allowed).protocol, 'https:');
assert.throws(() => validateDigitalHumanWorkerInputUrl('http://media.example.com/file.mp4', allowed), /HTTPS/);
assert.throws(() => validateDigitalHumanWorkerInputUrl('https://evil.example/file.mp4', allowed), /not allowed/);
assert.throws(() => validateDigitalHumanWorkerInputUrl('https://user:pass@media.example.com/file.mp4', allowed), /credentials/);
assert.throws(() => validateDigitalHumanWorkerInputUrl('https://media.example.com:8443/file.mp4', allowed), /port/);
assert.equal(validateDigitalHumanHubUrl('http://127.0.0.1:8788', 'development'), 'http://127.0.0.1:8788');
assert.throws(() => validateDigitalHumanHubUrl('http://127.0.0.1:8788', 'production'), /HTTPS/);
assert.equal(validateDigitalHumanHubUrl('https://hub.example.com/', 'production'), 'https://hub.example.com');
assert.equal(isBlockedDigitalHumanNetworkAddress('169.254.169.254'), true);
assert.equal(isBlockedDigitalHumanNetworkAddress('10.0.0.1'), true);
assert.equal(isBlockedDigitalHumanNetworkAddress('8.8.8.8'), false);
await assert.rejects(validateResolvedDigitalHumanInputUrl(new URL('https://media.example.com/a'), async () => ['192.168.1.1']), /private/);
assert.deepEqual(await validateResolvedDigitalHumanInputUrl(new URL('https://media.example.com/a'), async () => ['8.8.8.8']), ['8.8.8.8']);
assert.equal(isLoopbackHostname('127.42.0.1'), true);
assert.equal(isLoopbackHostname('[::1]'), true);
assert.equal(isLoopbackHostname('192.168.1.2'), false);
assert.equal(countFreezeSegments('freeze_start: 1.2\nfreeze_end: 2.1\nfreeze_start: 8.0'), 2);

const validProbe = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '15.000' },
};
const validVisual = {
  passed: true, duration_seconds: 15, face_detection_rate: 0.995,
  mouth_jump_p95: 0.04, mouth_openness_std: 0.03, mouth_sharpness_median: 80,
  failures: [],
};
const validSync = { passed: true, syncnet_confidence: 5.2, av_offset_frames: 1, failures: [] };
const valid = buildDigitalHumanFinalQualityReport({
  probe: validProbe, visual: validVisual, syncnet: validSync,
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(valid.passed, true);
assert.equal(valid.freezeSegments, 0);
assert.equal(valid.width, 1080);
assert.equal(valid.validatorVersion, 'final-quality-v2.4.0');
assert.deepEqual(valid.failureCodes, []);
assert.equal(valid.validationScope, 'full_video');
assert.deepEqual(valid.thresholds, { lipSyncScoreMinimum: 3, absoluteAvOffsetFramesMaximum: 3 });

const belowWholeVideoThreshold = buildDigitalHumanFinalQualityReport({
  probe: validProbe, visual: validVisual,
  syncnet: { passed: true, syncnet_confidence: 2.75, av_offset_frames: 3, failures: [] },
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(belowWholeVideoThreshold.passed, false, '整片默认门槛必须继续保持3.0');
assert.match(belowWholeVideoThreshold.failures.join(' '), /低于3\.0/);

const shortProbe = { ...validProbe, format: { duration: '5.200' } };
const shortVisual = { ...validVisual, duration_seconds: 5.2 };
const validShortSegment = buildDigitalHumanFinalQualityReport({
  probe: shortProbe, visual: shortVisual,
  syncnet: { passed: true, syncnet_confidence: 3.05, av_offset_frames: 3, failures: [] },
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
  minLipSyncScore: 3, validationScope: 'segment',
});
assert.equal(validShortSegment.passed, true, '短分镜与三语最终验收统一使用3.0置信度门槛');
assert.equal(validShortSegment.validationScope, 'segment');
assert.deepEqual(validShortSegment.thresholds, { lipSyncScoreMinimum: 3, absoluteAvOffsetFramesMaximum: 3 });
assert.match(validShortSegment.notes.join(' '), /分镜片段.*3\.0.*3帧/);

const belowV2SegmentThreshold = buildDigitalHumanFinalQualityReport({
  probe: shortProbe, visual: shortVisual,
  syncnet: { passed: true, syncnet_confidence: 2.999, av_offset_frames: 0, failures: [] },
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
  minLipSyncScore: 3, validationScope: 'segment',
});
assert.equal(belowV2SegmentThreshold.passed, false);
assert.match(belowV2SegmentThreshold.failures.join(' '), /置信度低于3\.0/);

const forbiddenRelaxedSegment = buildDigitalHumanFinalQualityReport({
  probe: shortProbe, visual: shortVisual,
  syncnet: { passed: true, syncnet_confidence: 3.05, av_offset_frames: 0, failures: [] },
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
  minLipSyncScore: 2.5, validationScope: 'segment',
});
assert.equal(forbiddenRelaxedSegment.passed, false, '短分镜不得再请求2.5宽松门槛');
assert.deepEqual(forbiddenRelaxedSegment.thresholds, { lipSyncScoreMinimum: 3, absoluteAvOffsetFramesMaximum: 3 });
assert.match(forbiddenRelaxedSegment.failures.join(' '), /低于V2最低3\.0/);

const invalidSegmentOffset = buildDigitalHumanFinalQualityReport({
  probe: shortProbe, visual: shortVisual,
  syncnet: { passed: true, syncnet_confidence: 3.05, av_offset_frames: 4, failures: [] },
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
  minLipSyncScore: 3, validationScope: 'segment',
});
assert.equal(invalidSegmentOffset.passed, false, '短分镜不能放宽3帧偏移门槛');
assert.match(invalidSegmentOffset.failures.join(' '), /超过3帧/);

const missingMetric = buildDigitalHumanFinalQualityReport({
  probe: validProbe,
  visual: { ...validVisual, face_detection_rate: Number.NaN },
  syncnet: validSync,
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(missingMetric.passed, false, '必填指标NaN不得假通过');
assert.match(missingMetric.failures.join(' '), /人脸跟踪率缺失/);

const excessiveMouthJump = buildDigitalHumanFinalQualityReport({
  probe: validProbe,
  visual: {
    ...validVisual,
    passed: false,
    mouth_jump_p95: 0.09,
    failures: ['mouth motion contains excessive frame-to-frame jumps'],
  },
  syncnet: validSync,
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(excessiveMouthJump.passed, false);
assert.deepEqual(excessiveMouthJump.failureCodes, [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  'mouth_jump 必须由完整门禁输出稳定类型码');

const roundedSharpnessStillRejected = buildDigitalHumanFinalQualityReport({
  probe: validProbe,
  visual: {
    ...validVisual,
    passed: false,
    // Python reports rounded display values but emits the code from the
    // unrounded measurement, so 24.999 displayed as 25.00 stays rejected.
    mouth_sharpness_median: 25,
    failure_codes: [DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE],
    failures: ['mouth region is excessively blurred'],
  },
  syncnet: validSync,
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(roundedSharpnessStillRejected.passed, false, '原始清晰度低于25不得因展示舍入自动放行');
assert.deepEqual(roundedSharpnessStillRejected.failureCodes, [DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE]);
assert.match(roundedSharpnessStillRejected.failures.join(' '), /嘴部区域过度模糊/);

const numericSharpnessRejected = buildDigitalHumanFinalQualityReport({
  probe: validProbe,
  visual: { ...validVisual, passed: false, mouth_sharpness_median: 24.88, failures: ['mouth region is excessively blurred'] },
  syncnet: validSync,
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(numericSharpnessRejected.passed, false);
assert.deepEqual(numericSharpnessRejected.failureCodes, [DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE]);

const simultaneousJumpAndSharpnessRejected = buildDigitalHumanFinalQualityReport({
  probe: validProbe,
  visual: {
    ...validVisual,
    passed: false,
    mouth_jump_p95: 0.09,
    mouth_sharpness_median: 24.99,
    // Input order and duplicates must not control the final classification.
    failure_codes: [
      DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
      DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
      DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
    ],
    failures: [
      'mouth region is excessively blurred',
      'mouth motion contains excessive frame-to-frame jumps',
    ],
  },
  syncnet: validSync,
  freezeLog: '', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(simultaneousJumpAndSharpnessRejected.passed, false);
assert.deepEqual(simultaneousJumpAndSharpnessRejected.failureCodes, [
  DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
  DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
], '同时存在跳变与模糊时必须保留全部类型，并按固定次序归一化');
assert.match(simultaneousJumpAndSharpnessRejected.failures.join(' '), /嘴部跳变P95超过0\.085/);
assert.match(simultaneousJumpAndSharpnessRejected.failures.join(' '), /嘴部区域过度模糊/);

const freeze = buildDigitalHumanFinalQualityReport({
  probe: validProbe, visual: validVisual, syncnet: validSync,
  freezeLog: '[freezedetect] freeze_start: 3.4', freezeValidated: true, outputSha256: 'a'.repeat(64),
});
assert.equal(freeze.passed, false);
assert.equal(freeze.freezeSegments, 1);

const validatorUnavailable = buildDigitalHumanFinalQualityReport({
  probe: validProbe, visual: validVisual, syncnet: validSync,
  freezeLog: '', freezeValidated: false, outputSha256: 'a'.repeat(64),
});
assert.equal(validatorUnavailable.passed, false, '卡帧门禁未执行不得假通过');

const preferredProfile = nextMuseTalkProfile([]);
assert.deepEqual(preferredProfile, {
  id: 'jaw-padding-2-2', parsingMode: 'jaw', audioPaddingLeft: 2, audioPaddingRight: 2,
});
assert.deepEqual(museTalkRunnerProfileArguments(preferredProfile!), [
  '-ParsingMode', 'jaw', '-AudioPaddingLeft', '2', '-AudioPaddingRight', '2',
]);
const preferredQualityRejected: MuseTalkProfileAttemptSummary[] = [{
  profileId: 'jaw-padding-2-2',
  outcome: belowV2SegmentThreshold.passed ? 'passed' : 'final_quality_rejected',
  failure: belowV2SegmentThreshold.failures.join('；'),
}];
assert.deepEqual(nextMuseTalkProfile(preferredQualityRejected), {
  id: 'raw-padding-0-0', parsingMode: 'raw', audioPaddingLeft: 0, audioPaddingRight: 0,
}, '只有首选档位被最终基础质量门禁拒绝才能进入 raw 备选档');
for (const outcome of ['passed', 'performance_quality_rejected', 'execution_failed'] as const) {
  assert.equal(nextMuseTalkProfile([{ profileId: 'jaw-padding-2-2', outcome }]), undefined,
    `${outcome} 不得触发 raw 档位`);
}
assert.equal(nextMuseTalkProfile([
  ...preferredQualityRejected,
  { profileId: 'raw-padding-0-0', outcome: 'final_quality_rejected' },
]), undefined, 'raw 档位最多只能执行一次');
assert.equal(MUSE_TALK_RENDER_PROFILES.length, 2);
const selectionNotes = buildMuseTalkProfileSelectionNotes([
  ...preferredQualityRejected,
  { profileId: 'raw-padding-0-0', outcome: 'passed' },
], 'raw-padding-0-0').join(' ');
assert.match(selectionNotes, /jaw-padding-2-2.*未降低阈值/);
assert.match(selectionNotes, /MuseTalk最终档位：raw-padding-0-0/);
assert.match(selectionNotes, /解码、MediaPipe、SyncNet、卡帧与表演回执门禁/);

const worker = readFileSync(new URL('../../scripts/digital-human-local-worker.ts', import.meta.url), 'utf8');
assert.match(worker, /redirect: 'manual'/, '输入下载必须禁止 fetch 自动跟随跳转');
assert.match(worker, /currentUrl = safeInputUrl\(new URL\(location, currentUrl\)\.toString\(\)\)/, '每一次跳转必须重新校验 URL');
assert.match(worker, /prefetchAndValidateInputs/);
assert.match(worker, /All signed motion URLs are consumed before the first GPU inference/);
const performanceRenderer = worker.slice(worker.indexOf('async function renderPerformanceSequence'), worker.indexOf('async function executeJob'));
assert.doesNotMatch(performanceRenderer, /\bdownload\(/, '逐节拍 GPU 推理期间不得再下载动作素材');
assert.match(worker, /'ffprobe'/, '必须重新探测最终成片容器');
assert.match(worker, /validate-digital-human\.py/);
assert.match(worker, /validate-syncnet\.py/);
assert.match(worker, /freezedetect=n=/);
assert.match(worker, /outputPath}\.final-quality\.json/);
const runnerWrapper = worker.slice(worker.indexOf('async function runMuseTalkSegment'), worker.indexOf('async function renderPerformanceSequence'));
assert.match(runnerWrapper, /runProcess\('pwsh\.exe'/, 'MuseTalk 必须经过单一受控 runner 入口');
assert.match(runnerWrapper, /'-SegmentMode'/, '每个分镜级 MuseTalk 调用必须启用 SegmentMode');
assert.match(runnerWrapper, /museTalkRunnerProfileArguments\(profile\)/, 'runner 必须显式接收受控档位参数');
assert.match(performanceRenderer, /runMuseTalkSegment\(jobId, profile, sourcePath, beatAudio, beatRaw\)/,
  '多节拍的每个 beat 必须使用同一当次档位');
const profileAttemptRenderer = worker.slice(worker.indexOf('async function renderMuseTalkProfileAttempt'), worker.indexOf('function promoteMuseTalkProfileResult'));
assert.match(profileAttemptRenderer, /runMuseTalkSegment\(jobId, profile, sourcePath, audioPath, paths\.rawOutput\)/,
  '单节拍必须使用同一受控档位入口');
assert.match(worker, /preparedAudioDuration <= shortSegmentMaximumSeconds \? shortSegmentMinimumLipSyncScore : 3/);
assert.match(worker, /const shortSegmentMinimumLipSyncScore = 3;/,
  'V2 Worker短分镜必须与三语最终验收统一到3.0');
assert.match(worker, /validationScope: 'segment'/);
assert.doesNotMatch(worker, /fs\.copyFileSync\(`\$\{rawOutputPath\}\$\{suffix\}`/, '不得复制中间片段质检报告冒充最终成片报告');
assert.match(worker, /error instanceof FinalQualityRejectedError && nextProfile/, '只有类型化的最终质量拒绝可触发备选档');
assert.match(worker, /status === 'cancelled'[\s\S]{0,260}const nextProfile = nextMuseTalkProfile/,
  '已取消任务必须在档位选择前停止，不得被重试恢复');
assert.doesNotMatch(worker, /message\.includes\([^\n]+\)[\s\S]{0,120}retry_lip_sync/,
  '不得依靠错误文案猜测是否重试');
assert.match(worker, /musetalk-profile-attempts\.json/, '每次档位及失败证据必须持久化');
assert.match(worker, /pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,[\s\S]{0,120}finalSharpenFilter: DIGITAL_HUMAN_FINAL_SHARPEN_FILTER/,
  '档位尝试证据必须记录P1管线与清晰度处理');
assert.match(worker, /annotateDigitalHumanPipelineQuality\(quality, treatmentId\)/,
  '最终质量备注必须可审计P1清晰度处理');
assert.match(worker, /shouldAttemptDigitalHumanTemporalStability\(error\.quality\)/,
  '只能根据完整门禁的类型化 mouth_jump 失败触发时序兜底');
assert.doesNotMatch(worker, /error\.message[\s\S]{0,160}mouth_jump/,
  '不得根据异常文案猜测是否启用时序兜底');
const finalTreatmentRenderer = worker.slice(
  worker.indexOf('async function renderFinalTreatmentAttempt'),
  worker.indexOf('async function renderMuseTalkProfileAttempt'),
);
assert.match(finalTreatmentRenderer, /const renderInputPath = mouthLocalProcessor\?\.inputPath \|\| paths\.rawOutput/,
  '基线与全帧时序兜底必须从raw合成，局部稳像只能使用已验真的processor中间片');
const mouthLocalProcessor = worker.slice(
  worker.indexOf('async function runMouthLocalProcessor'),
  worker.indexOf('function persistRenderTreatmentAudit'),
);
assert.match(mouthLocalProcessor, /rawInputSha256 = await sha256File\(paths\.rawOutput\)/,
  '嘴部局部稳像必须从同一 MuseTalk raw 输入起步');
assert.match(mouthLocalProcessor, /rawAfterSha256 !== rawInputSha256/,
  '嘴部局部稳像必须验证raw未被修改');
assert.match(mouthLocalProcessor, /DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256/,
  '嘴部局部稳像必须固定发布脚本SHA');
assert.match(finalTreatmentRenderer, /buildDigitalHumanRenderTreatmentReceipt/);
assert.match(finalTreatmentRenderer, /quality = await validateOutput/,
  '每个最终处理尝试都必须重跑解码、MediaPipe、SyncNet与冻结门禁');
assert.ok((finalTreatmentRenderer.match(/applyPerformanceShotGate\(/g) || []).length >= 2,
  '通过或拒绝分支都必须重跑表现回执门禁');
assert.match(worker, /DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER/);
assert.match(worker, /render-treatment-audit\.json/);
assert.equal((profileAttemptRenderer.match(/renderFinalTreatmentAttempt\(/g) || []).length, 3,
  '基线、全帧时序与嘴部局部稳像必须复用同一完整门禁实现');
assert.match(profileAttemptRenderer, /shouldAttemptDigitalHumanMouthLocalStability\(temporalError\.quality\)/,
  '第三档只能由第二档的类型化嘴部质量失败触发');
assert.match(worker, /buildMuseTalkProfileSelectionNotes\(summaries, profile\.id\)/,
  '最终质量备注必须记录所选档位');
assert.match(worker, /promoteMuseTalkProfileResult\(result\.paths\.output, outputPath/,
  '只能提升已通过当次全部门禁的字节级产物');
const workerInputContract = worker.slice(worker.indexOf('interface WorkerInput'), worker.indexOf('type WorkerQuality'));
assert.doesNotMatch(workerInputContract, /ParsingMode|audioPaddingLeft|audioPaddingRight|MuseTalkProfile/,
  '自适应档位不得暴露成 API 输入合同');
assert.doesNotMatch(workerInputContract, /renderTreatment|temporal|tmix|unsharp/i,
  '时序兜底是Worker内部质量策略，不得改变API输入合同');

const runnerScript = readFileSync(new URL('../../scripts/run-musetalk.ps1', import.meta.url), 'utf8');
assert.match(runnerScript, /\[string\]\$ParsingMode\s*=\s*'jaw'/, 'MuseTalk v1.5生产档必须默认使用官方jaw融合');
assert.match(runnerScript, /\$AudioPaddingLeft\s*=\s*2/, 'MuseTalk v1.5生产档必须保留左侧音频上下文');
assert.match(runnerScript, /\$AudioPaddingRight\s*=\s*2/, 'MuseTalk v1.5生产档必须保留右侧音频上下文');
assert.match(runnerScript, /\$visualCommand = if \(\$SegmentMode\) \{[\s\S]*?visual-quality\.json[^\n]*\|\| test `\$\? -eq 2/, 'SegmentMode必须只容忍视觉门禁的质量拒绝码2');
assert.match(runnerScript, /\$visualCommand = if \(\$SegmentMode\)[\s\S]*?\} else \{[\s\S]*?visual-quality\.json`""\s*\}/, '整片视觉门禁必须继续强制失败');
assert.match(runnerScript, /if \(\$SegmentMode\)[\s\S]*?--min-confidence 3\.0 --max-offset 3/, '分镜级SyncNet必须使用3.0和3帧阈值');
assert.match(runnerScript, /else \{[\s\S]*?\$syncValidatorWsl[^\n]*syncnet-quality\.json/, '整片分支必须继续调用默认SyncNet门禁');
const syncValidator = readFileSync(new URL('../../scripts/validate-syncnet.py', import.meta.url), 'utf8');
assert.match(syncValidator, /--min-confidence"\s*,\s*type=float,\s*default=3\.0/, 'SyncNet默认整片阈值不得从3.0下调');

console.log('digital human worker final-quality tests passed');
