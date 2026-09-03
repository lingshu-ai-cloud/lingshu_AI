import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
  DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION,
  DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES,
  DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS,
  DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
  buildDigitalHumanMouthStabilizationFingerprint,
  parseDigitalHumanMouthStabilizationAudit,
  verifyDigitalHumanMouthStabilizationEvidence,
} from './digitalHumanMouthStabilization.js';

const rawSha = 'a'.repeat(64);
const processorOutputSha = 'b'.repeat(64);
const audioPacketSha = 'c'.repeat(64);
const scriptSha = 'd'.repeat(64);

const releaseScriptBytes = readFileSync(new URL('../../scripts/stabilize-digital-human-mouth.py', import.meta.url));
assert.equal(createHash('sha256').update(releaseScriptBytes).digest('hex'), DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
  '发布白名单SHA必须与仓库内嘴部局部稳像脚本完全一致');

function validAudit(): Record<string, unknown> {
  const input = {
    path: 'C:\\private\\worker\\result.raw.mp4',
    sha256: rawSha,
    durationSeconds: 3,
    videoDurationSeconds: 3,
    audioDurationSeconds: 3,
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1080,
    height: 1920,
    fps: 25,
    frameCount: 75,
    audioPacketSha256: audioPacketSha,
  };
  const output = {
    ...input,
    path: '/mnt/d/private/worker/result.mouth-local-v1.intermediate.mp4',
    sha256: processorOutputSha,
  };
  return {
    schemaVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION,
    algorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
    passed: true,
    parameters: structuredClone(DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS),
    input,
    output,
    tracking: {
      totalFrames: 75,
      detectedFrames: 75,
      missingFrames: 0,
      detectionRate: 1,
      maximumConsecutiveMissingFrames: 0,
      multipleFaceFrames: 0,
      boundaryFailureFrames: 0,
      minimumMouthWidthPixels: 40,
      maximumMouthWidthPixels: 52,
    },
    locality: {
      meanMaskCoverageFraction: 0.01,
      maximumMaskCoverageFraction: 0.02,
      maximumAllowedMaskCoverageFraction: 0.08,
      maximumOutsideMaskPixelDeltaBeforeEncoding: 0,
      fullFrameTemporalFilterApplied: false,
      localSharpenPasses: 1,
      fullResolutionFramesBuffered: 0,
    },
    integrity: {
      passed: true,
      failures: [],
      decodedFrameCount: 75,
      inputFrameCount: 75,
      outputFrameCount: 75,
      inputDurationSeconds: 3,
      outputDurationSeconds: 3,
      durationDeltaSeconds: 0,
      durationToleranceSeconds: 0.045,
      fpsPreserved: true,
      resolutionPreserved: true,
      inputAudioPacketSha256: audioPacketSha,
      outputAudioPacketSha256: audioPacketSha,
      audioPacketHashMatch: true,
    },
    failures: [],
  };
}

function parse(audit: Record<string, unknown> = validAudit()) {
  const auditFile = `${JSON.stringify(audit, null, 2)}\n`;
  const evidence = parseDigitalHumanMouthStabilizationAudit({
    auditFile,
    rawInputSha256: rawSha,
    processorOutputSha256: processorOutputSha,
    scriptSha256: scriptSha,
    expectedScriptSha256: scriptSha,
  });
  return { auditFile, evidence };
}

function mutate(mutator: (audit: Record<string, any>) => void): Record<string, unknown> {
  const audit = structuredClone(validAudit()) as Record<string, any>;
  mutator(audit);
  return audit;
}

const { auditFile, evidence } = parse();
const auditFileSha = createHash('sha256').update(auditFile).digest('hex');
assert.equal(evidence.auditFileSha256, auditFileSha, 'audit SHA必须由精确文件字节计算');
assert.equal(evidence.rawInputSha256, rawSha);
assert.equal(evidence.processorOutputSha256, processorOutputSha);
assert.equal(evidence.scriptSha256, scriptSha);
assert.equal(evidence.profileId, 'balanced');
assert.equal(evidence.media.input.sha256, rawSha);
assert.equal(evidence.media.output.sha256, processorOutputSha);
assert.match(evidence.parametersSha256, /^[a-f0-9]{64}$/);
assert.equal(evidence.fingerprint, buildDigitalHumanMouthStabilizationFingerprint(evidence));
assert.doesNotMatch(JSON.stringify(evidence), /"path"|C:\\private|\/mnt\/d\/private/,
  '可跨机序列化的净化证据不得泄露绝对路径');
assert.deepEqual(verifyDigitalHumanMouthStabilizationEvidence(evidence, {
  expectedRawInputSha256: rawSha,
  expectedProcessorOutputSha256: processorOutputSha,
  expectedScriptSha256: scriptSha,
  expectedAuditFileSha256: auditFileSha,
}), []);

const reordered = {
  integrity: evidence.integrity,
  locality: evidence.locality,
  tracking: evidence.tracking,
  media: evidence.media,
  auditFileSha256: evidence.auditFileSha256,
  scriptSha256: evidence.scriptSha256,
  processorOutputSha256: evidence.processorOutputSha256,
  rawInputSha256: evidence.rawInputSha256,
  parametersSha256: evidence.parametersSha256,
  parameters: evidence.parameters,
  profileId: evidence.profileId,
  algorithmVersion: evidence.algorithmVersion,
  auditSchemaVersion: evidence.auditSchemaVersion,
  evidenceVersion: evidence.evidenceVersion,
};
assert.equal(buildDigitalHumanMouthStabilizationFingerprint(reordered), evidence.fingerprint,
  '证据指纹必须与对象键顺序无关');

const strongAudit = structuredClone(validAudit()) as Record<string, any>;
strongAudit.parameters = structuredClone(DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES.strong);
const strongEvidence = parse(strongAudit).evidence;
assert.equal(strongEvidence.profileId, 'strong');
assert.notEqual(strongEvidence.parametersSha256, evidence.parametersSha256,
  '普通档与强稳像档必须拥有不同参数指纹');
assert.match(verifyDigitalHumanMouthStabilizationEvidence({ ...strongEvidence, profileId: 'balanced' }, {
  expectedRawInputSha256: rawSha,
  expectedProcessorOutputSha256: processorOutputSha,
  expectedScriptSha256: scriptSha,
  expectedAuditFileSha256: strongEvidence.auditFileSha256,
}).join(' '), /档位与参数/);

assert.throws(() => parse(mutate(audit => { audit.algorithmVersion = 'mouth-roi-temporal-stabilizer-v0'; })), /算法版本/);
assert.throws(() => parse(mutate(audit => { audit.passed = false; audit.failures = ['tracking failed']; })), /passed/);
assert.throws(() => parse(mutate(audit => { audit.extra = true; })), /字段集合/);
assert.throws(() => parse(mutate(audit => { audit.parameters.localSharpenAmount = 2.49; })), /固定生产配方/);
assert.throws(() => parse(mutate(audit => { delete audit.parameters.minimumTrackingConfidence; })), /固定生产配方/);
assert.throws(() => parse(mutate(audit => { audit.parameters.unreviewedOption = 1; })), /固定生产配方/);

for (const invalidTracking of [
  (audit: Record<string, any>) => { audit.tracking.missingFrames = 1; },
  (audit: Record<string, any>) => { audit.tracking.multipleFaceFrames = 1; },
  (audit: Record<string, any>) => { audit.tracking.boundaryFailureFrames = 1; },
  (audit: Record<string, any>) => { audit.tracking.maximumConsecutiveMissingFrames = 1; },
  (audit: Record<string, any>) => { audit.tracking.detectedFrames = 74; },
]) {
  assert.throws(() => parse(mutate(invalidTracking)), /唯一人脸|连续嘴部/);
}

assert.throws(() => parse(mutate(audit => { audit.locality.maximumMaskCoverageFraction = 0.081; })), /遮罩范围/);
assert.throws(() => parse(mutate(audit => { audit.locality.maximumOutsideMaskPixelDeltaBeforeEncoding = 1; })), /遮罩外像素/);
assert.throws(() => parse(mutate(audit => { audit.locality.fullFrameTemporalFilterApplied = true; })), /必须为false/);
assert.throws(() => parse(mutate(audit => { audit.locality.localSharpenPasses = 2; })), /只能执行一次/);

assert.throws(() => parse(mutate(audit => { audit.integrity.passed = false; audit.integrity.failures = ['bad']; })), /passed/);
assert.throws(() => parse(mutate(audit => { audit.integrity.outputFrameCount = 74; })), /帧数/);
assert.throws(() => parse(mutate(audit => { audit.output.width = 720; })), /分辨率/);
assert.throws(() => parse(mutate(audit => { audit.output.fps = 24.9; })), /帧率/);
assert.throws(() => parse(mutate(audit => {
  audit.output.audioPacketSha256 = 'e'.repeat(64);
  audit.integrity.outputAudioPacketSha256 = 'e'.repeat(64);
})), /AAC音频包哈希/);
assert.throws(() => parse(mutate(audit => {
  audit.output.durationSeconds = 3.046;
  audit.output.videoDurationSeconds = 3.046;
  audit.output.audioDurationSeconds = 3.046;
  audit.integrity.outputDurationSeconds = 3.046;
  audit.integrity.durationDeltaSeconds = 0.046;
})), /时长/);

assert.throws(() => parseDigitalHumanMouthStabilizationAudit({
  auditFile,
  rawInputSha256: 'f'.repeat(64),
  processorOutputSha256: processorOutputSha,
  scriptSha256: scriptSha,
  expectedScriptSha256: scriptSha,
}), /输入或输出SHA/);
assert.throws(() => parseDigitalHumanMouthStabilizationAudit({
  auditFile,
  rawInputSha256: rawSha,
  processorOutputSha256: 'f'.repeat(64),
  scriptSha256: scriptSha,
  expectedScriptSha256: scriptSha,
}), /输入或输出SHA/);
assert.throws(() => parseDigitalHumanMouthStabilizationAudit({
  auditFile,
  rawInputSha256: rawSha,
  processorOutputSha256: processorOutputSha,
  scriptSha256: 'e'.repeat(64),
  expectedScriptSha256: scriptSha,
}), /发布白名单/);

assert.match(verifyDigitalHumanMouthStabilizationEvidence({ ...evidence, fingerprint: '0'.repeat(64) }, {
  expectedRawInputSha256: rawSha,
  expectedProcessorOutputSha256: processorOutputSha,
  expectedScriptSha256: scriptSha,
  expectedAuditFileSha256: auditFileSha,
}).join(' '), /指纹/);
assert.match(verifyDigitalHumanMouthStabilizationEvidence({ ...evidence, path: 'C:\\private\\leak.mp4' }, {
  expectedRawInputSha256: rawSha,
  expectedProcessorOutputSha256: processorOutputSha,
  expectedScriptSha256: scriptSha,
  expectedAuditFileSha256: auditFileSha,
}).join(' '), /字段集合/);
assert.match(verifyDigitalHumanMouthStabilizationEvidence(evidence, {
  expectedRawInputSha256: rawSha,
  expectedProcessorOutputSha256: processorOutputSha,
  expectedScriptSha256: scriptSha,
  expectedAuditFileSha256: 'f'.repeat(64),
}).join(' '), /audit file SHA/);

const bytesEvidence = parseDigitalHumanMouthStabilizationAudit({
  auditFile: new TextEncoder().encode(auditFile),
  rawInputSha256: rawSha,
  processorOutputSha256: processorOutputSha,
  scriptSha256: scriptSha,
  expectedScriptSha256: scriptSha,
});
assert.deepEqual(bytesEvidence, evidence, '字符串与精确UTF-8字节输入必须生成同一证据');

console.log('digital human mouth-stabilization evidence tests passed');
