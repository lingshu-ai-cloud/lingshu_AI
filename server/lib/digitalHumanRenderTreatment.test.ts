import assert from 'node:assert/strict';
import {
  DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_MOUTH_LOCAL_OUTPUT_ARTIFACT,
  DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
  DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX,
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER,
  buildDigitalHumanFinalFilterComplex,
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
  digitalHumanFinalVideoFilter,
  shouldAttemptDigitalHumanMouthLocalStability,
  shouldAttemptDigitalHumanTemporalStability,
  verifyDigitalHumanRenderTreatmentAudit,
  verifyDigitalHumanRenderTreatmentReceipt,
} from './digitalHumanRenderTreatment.js';
import {
  DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
  DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION,
  DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS,
  buildDigitalHumanMouthStabilizationFingerprint,
  parseDigitalHumanMouthStabilizationAudit,
} from './digitalHumanMouthStabilization.js';

const rawSha = 'a'.repeat(64);
const baselineOutputSha = 'b'.repeat(64);
const temporalOutputSha = 'c'.repeat(64);
const mouthProcessorOutputSha = 'd'.repeat(64);
const mouthLocalOutputSha = '0'.repeat(64);
const mouthStabilizationScriptSha = 'e'.repeat(64);
const audioPacketSha = 'f'.repeat(64);
const timestamp = '2026-09-03T00:00:00.000Z';

const mouthStabilizationEvidence = parseDigitalHumanMouthStabilizationAudit({
  auditFile: JSON.stringify({
    schemaVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_AUDIT_VERSION,
    algorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
    passed: true,
    parameters: DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETERS,
    input: {
      path: '/worker/raw.mp4', sha256: rawSha, durationSeconds: 15,
      videoDurationSeconds: 15, audioDurationSeconds: 15,
      videoCodec: 'h264', audioCodec: 'aac', width: 1080, height: 1920,
      fps: 25, frameCount: 375, audioPacketSha256: audioPacketSha,
    },
    output: {
      path: '/worker/result.mouth-processor.mp4', sha256: mouthProcessorOutputSha, durationSeconds: 15,
      videoDurationSeconds: 15, audioDurationSeconds: 15,
      videoCodec: 'h264', audioCodec: 'aac', width: 1080, height: 1920,
      fps: 25, frameCount: 375, audioPacketSha256: audioPacketSha,
    },
    tracking: {
      totalFrames: 375, detectedFrames: 375, missingFrames: 0, detectionRate: 1,
      maximumConsecutiveMissingFrames: 0, multipleFaceFrames: 0, boundaryFailureFrames: 0,
      minimumMouthWidthPixels: 24, maximumMouthWidthPixels: 31,
    },
    locality: {
      meanMaskCoverageFraction: 0.02, maximumMaskCoverageFraction: 0.04,
      maximumAllowedMaskCoverageFraction: 0.08, maximumOutsideMaskPixelDeltaBeforeEncoding: 0,
      fullFrameTemporalFilterApplied: false, localSharpenPasses: 1, fullResolutionFramesBuffered: 0,
    },
    integrity: {
      passed: true, failures: [], decodedFrameCount: 375, inputFrameCount: 375, outputFrameCount: 375,
      inputDurationSeconds: 15, outputDurationSeconds: 15, durationDeltaSeconds: 0,
      durationToleranceSeconds: 0.045, fpsPreserved: true, resolutionPreserved: true,
      inputAudioPacketSha256: audioPacketSha, outputAudioPacketSha256: audioPacketSha,
      audioPacketHashMatch: true,
    },
    failures: [],
  }),
  rawInputSha256: rawSha,
  processorOutputSha256: mouthProcessorOutputSha,
  scriptSha256: mouthStabilizationScriptSha,
  expectedScriptSha256: mouthStabilizationScriptSha,
});
const mouthVerificationOptions = {
  expectedMouthStabilizationScriptSha256: mouthStabilizationScriptSha,
};

assert.equal(shouldAttemptDigitalHumanTemporalStability({
  passed: false,
  failureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
}), true, '只有类型化 mouth_jump 拒绝才触发');
for (const quality of [
  { passed: true, failureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE] },
  { passed: false, failureCodes: [] },
  { passed: false, failures: ['mouth motion contains excessive frame-to-frame jumps'] },
  { passed: false, mouthJumpP95: 0.2 },
]) {
  assert.equal(shouldAttemptDigitalHumanTemporalStability(quality), false,
    '不得靠文案、指标或已通过结果猜测兜底触发');
}
for (const failureCode of [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE, DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE]) {
  assert.equal(shouldAttemptDigitalHumanMouthLocalStability({
    passed: false,
    failureCodes: [failureCode],
  }), true, '第三档只接受第二档的类型化嘴部质量拒绝');
}
for (const quality of [
  { passed: true, failureCodes: [DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE] },
  { passed: false, failureCodes: ['syncnet_confidence_below_minimum'] },
  { passed: false, failures: ['mouth region is excessively blurred'] },
]) {
  assert.equal(shouldAttemptDigitalHumanMouthLocalStability(quality), false,
    '不得用已通过结果、非嘴部类型码或失败文案触发第三档');
}

const baselineFilter = buildDigitalHumanFinalFilterComplex(
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX,
  'baseline_unsharp',
);
const temporalFilter = buildDigitalHumanFinalFilterComplex(
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX,
  'mouth_jump_tmix2_equal_unsharp',
);
const mouthLocalIdentityFilter = buildDigitalHumanFinalFilterComplex(
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX,
  'mouth_jump_mouth_local_v1',
);
assert.equal(baselineFilter.split(DIGITAL_HUMAN_FINAL_SHARPEN_FILTER).length - 1, 1);
assert.equal(temporalFilter.split(DIGITAL_HUMAN_FINAL_SHARPEN_FILTER).length - 1, 0,
  '时序兜底不得先应用基线 0.35 锐化');
assert.equal(temporalFilter.split(DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER).length - 1, 1,
  '时序兜底必须从未锐化输入单次应用实测通过的 0.50 锐化');
assert.equal(temporalFilter.split(DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER).length - 1, 1);
assert.match(temporalFilter, /tmix=frames=2:weights='1 1',unsharp=5:5:0\.50:5:5:0\[v\]$/);
assert.equal(digitalHumanFinalVideoFilter('mouth_jump_mouth_local_v1'), 'null');
assert.equal(mouthLocalIdentityFilter, `${DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX},null[v]`);
assert.doesNotMatch(mouthLocalIdentityFilter, /\btmix\s*=|\bunsharp\s*=/,
  'mouth-local 档不得用 FFmpeg 全帧时序或锐化滤镜冒充局部处理');
assert.throws(() => buildDigitalHumanFinalFilterComplex(`${DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX},unsharp=3:3:0.2`, 'baseline_unsharp'), /禁止重复/);
assert.throws(() => buildDigitalHumanFinalFilterComplex(`${DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX},tmix=frames=2`, 'mouth_jump_tmix2_equal_unsharp'), /禁止重复/);

const baselinePassed = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 1,
  treatmentId: 'baseline_unsharp',
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: baselineOutputSha,
  qualityPassed: true,
  appliedAt: timestamp,
});
assert.deepEqual(verifyDigitalHumanRenderTreatmentReceipt(baselinePassed), []);
assert.equal(baselinePassed.version, 'render-treatment-receipt-v2');
assert.equal(baselinePassed.temporalFilter, null);
assert.equal(baselinePassed.finalSharpenFilter, DIGITAL_HUMAN_FINAL_SHARPEN_FILTER);
assert.equal(baselinePassed.processorEvidence, null);
assert.equal(baselinePassed.processorEvidenceFingerprint, null);
const baselineAudit = buildDigitalHumanRenderTreatmentAudit([baselinePassed], 1);
assert.equal(baselineAudit.version, 'render-treatment-audit-v2');
assert.deepEqual(verifyDigitalHumanRenderTreatmentAudit(baselineAudit, {
  expectedOutputSha256: baselineOutputSha,
  expectedRenderContext: 'standard_vertical',
  expectedBaseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
}), []);

const baselineRejected = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 1,
  treatmentId: 'baseline_unsharp',
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: baselineOutputSha,
  qualityPassed: false,
  qualityFailureCodes: [
    DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
    DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
  ],
  // A concurrent SyncNet failure is deliberately retained. The temporal
  // attempt still has to rerun and pass that unchanged gate.
  qualityFailures: ['mouth motion contains excessive frame-to-frame jumps', 'SyncNet置信度低于3.0'],
  appliedAt: timestamp,
});
const temporalPassed = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 2,
  treatmentId: 'mouth_jump_tmix2_equal_unsharp',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: temporalOutputSha,
  qualityPassed: true,
  appliedAt: timestamp,
});
const temporalAudit = buildDigitalHumanRenderTreatmentAudit([baselineRejected, temporalPassed], 2);
assert.equal(temporalPassed.finalSharpenFilter, DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER);
assert.deepEqual(verifyDigitalHumanRenderTreatmentAudit(temporalAudit, {
  expectedOutputSha256: temporalOutputSha,
  expectedRenderContext: 'standard_vertical',
}), []);
assert.notEqual(baselineRejected.filterSha256, temporalPassed.filterSha256);
assert.notEqual(baselineRejected.renderFingerprint, temporalPassed.renderFingerprint,
  '处理档位改变必须改变渲染指纹');
assert.ok(baselineRejected.qualityFailures.some(item => item.includes('SyncNet')),
  '兜底不得删除同次的其他失败证据');

const temporalRejected = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 2,
  treatmentId: 'mouth_jump_tmix2_equal_unsharp',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: temporalOutputSha,
  qualityPassed: false,
  qualityFailureCodes: [
    DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
    DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
  ],
  qualityFailures: ['嘴部跳变P95超过0.085', '嘴部区域过度模糊'],
  appliedAt: timestamp,
});
const mouthLocalPassed = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 3,
  treatmentId: 'mouth_jump_mouth_local_v1',
  // Builder canonicalizes the trigger order so the receipt is deterministic.
  triggerFailureCodes: [
    DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
    DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
  ],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: mouthLocalOutputSha,
  processorEvidence: mouthStabilizationEvidence,
  expectedProcessorScriptSha256: mouthStabilizationScriptSha,
  qualityPassed: true,
  appliedAt: timestamp,
});
const mouthLocalAudit = buildDigitalHumanRenderTreatmentAudit(
  [baselineRejected, temporalRejected, mouthLocalPassed],
  3,
);
assert.deepEqual(verifyDigitalHumanRenderTreatmentReceipt(mouthLocalPassed, {
  ...mouthVerificationOptions,
}), []);
assert.match(verifyDigitalHumanRenderTreatmentReceipt(mouthLocalPassed).join(' '), /缺少固定发布版 processor script SHA256/,
  '第三档验真不得用 evidence 内的 script SHA 自证');
assert.deepEqual(verifyDigitalHumanRenderTreatmentAudit(mouthLocalAudit, {
  expectedOutputSha256: mouthLocalOutputSha,
  expectedRenderContext: 'standard_vertical',
  expectedBaseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  ...mouthVerificationOptions,
}), []);
assert.match(verifyDigitalHumanRenderTreatmentAudit(mouthLocalAudit).join(' '), /缺少固定发布版 processor script SHA256/,
  '第三档 audit 缺少服务端发布白名单 SHA 时必须 fail closed');
assert.deepEqual(mouthLocalPassed.triggerFailureCodes, [
  DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
  DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
]);
assert.equal(mouthLocalPassed.temporalFilter, null);
assert.equal(mouthLocalPassed.finalSharpenFilter, null);
assert.equal(mouthLocalPassed.finalVideoFilter, 'null');
assert.match(mouthLocalPassed.filterSha256, /^[a-f0-9]{64}$/);
assert.equal(mouthLocalPassed.outputArtifact, DIGITAL_HUMAN_MOUTH_LOCAL_OUTPUT_ARTIFACT);
assert.deepEqual(mouthLocalPassed.processorEvidence, mouthStabilizationEvidence);
assert.equal(mouthLocalPassed.processorEvidenceFingerprint, mouthStabilizationEvidence.fingerprint);
assert.equal(mouthLocalPassed.processorOutputSha256, mouthProcessorOutputSha);
assert.notEqual(mouthLocalPassed.processorOutputSha256, mouthLocalPassed.outputSha256,
  'processor 中间片 SHA 与最终候选 SHA 必须使用不同合同字段');
assert.equal(mouthLocalPassed.inputSha256, baselineRejected.inputSha256);
assert.equal(mouthLocalPassed.baseRenderFingerprint, baselineRejected.baseRenderFingerprint);
assert.notEqual(mouthLocalPassed.renderFingerprint, temporalRejected.renderFingerprint,
  '第三档 processor evidence 必须进入 renderFingerprint');
const { fingerprint: _mouthEvidenceFingerprint, ...alternateEvidenceBody } = mouthStabilizationEvidence;
const alternateEvidenceBodyWithDistinctAudit = {
  ...alternateEvidenceBody,
  auditFileSha256: '7'.repeat(64),
};
const alternateMouthStabilizationEvidence = {
  ...alternateEvidenceBodyWithDistinctAudit,
  fingerprint: buildDigitalHumanMouthStabilizationFingerprint(alternateEvidenceBodyWithDistinctAudit),
};
const alternateEvidenceReceipt = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 3,
  treatmentId: 'mouth_jump_mouth_local_v1',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE, DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: mouthLocalOutputSha,
  processorEvidence: alternateMouthStabilizationEvidence,
  expectedProcessorScriptSha256: mouthStabilizationScriptSha,
  qualityPassed: true,
  appliedAt: timestamp,
});
assert.notEqual(alternateEvidenceReceipt.renderFingerprint, mouthLocalPassed.renderFingerprint,
  '任一 processor evidence 字段变化都必须改变 renderFingerprint');

const tamperedWeights = {
  ...temporalPassed,
  temporalFilter: "tmix=frames=3:weights='1 1 1'",
};
assert.match(verifyDigitalHumanRenderTreatmentReceipt(tamperedWeights).join(' '), /滤镜配方/);
assert.match(verifyDigitalHumanRenderTreatmentReceipt({
  ...temporalPassed,
  outputSha256: 'd'.repeat(64),
}).join(' '), /渲染指纹/);
assert.match(verifyDigitalHumanRenderTreatmentReceipt({
  ...mouthLocalPassed,
  finalVideoFilter: `${DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER},${DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER}`,
}, mouthVerificationOptions).join(' '), /滤镜配方/,
  '第三档不得伪装成全帧 tmix/unsharp');
assert.match(verifyDigitalHumanRenderTreatmentReceipt({
  ...mouthLocalPassed,
  outputArtifact: 'result.tmix-2-equal.mp4',
}, mouthVerificationOptions).join(' '), /产物标识/,
  '第三档必须使用独立固定产物');
assert.match(verifyDigitalHumanRenderTreatmentReceipt({
  ...mouthLocalPassed,
  processorOutputSha256: '1'.repeat(64),
}, mouthVerificationOptions).join(' '), /processor output SHA不匹配/,
  'processor 中间输出必须与净化 evidence 独立绑定');
assert.match(verifyDigitalHumanRenderTreatmentReceipt({
  ...mouthLocalPassed,
  processorEvidence: {
    ...mouthStabilizationEvidence,
    locality: {
      ...mouthStabilizationEvidence.locality,
      fullFrameTemporalFilterApplied: true,
    },
  },
}, mouthVerificationOptions).join(' '), /必须为false|净化证据/,
  '被篡改或非局部 processor evidence 必须 fail closed');
assert.match(verifyDigitalHumanRenderTreatmentReceipt({
  ...baselinePassed,
  version: 'render-treatment-receipt-v1',
}).join(' '), /版本无效/,
  '旧 v1 receipt 必须被 v2 合同拒绝');
assert.match(verifyDigitalHumanRenderTreatmentAudit({
  ...temporalAudit,
  attempts: [baselineRejected, { ...temporalPassed, inputSha256: 'e'.repeat(64) }],
}, { expectedOutputSha256: temporalOutputSha }).join(' '), /同一未锐化输入/);
assert.match(verifyDigitalHumanRenderTreatmentAudit({
  ...temporalAudit,
  version: 'render-treatment-audit-v1',
}, { expectedOutputSha256: temporalOutputSha }).join(' '), /版本无效/,
  '旧 v1 audit 必须被 v2 合同拒绝');
assert.match(verifyDigitalHumanRenderTreatmentAudit(temporalAudit, {
  expectedOutputSha256: 'f'.repeat(64),
}).join(' '), /实测不一致/);
assert.match(verifyDigitalHumanRenderTreatmentAudit(temporalAudit, {
  expectedBaseRenderFingerprint: 'f'.repeat(64),
}).join(' '), /服务端重建的基础渲染指纹/);

assert.match(verifyDigitalHumanRenderTreatmentAudit(
  buildDigitalHumanRenderTreatmentAudit([baselineRejected, mouthLocalPassed], 3),
  mouthVerificationOptions,
).join(' '), /尝试顺序/,
  '第三档不得绕过第二档直跳');
assert.match(verifyDigitalHumanRenderTreatmentAudit(
  buildDigitalHumanRenderTreatmentAudit([baselineRejected, temporalPassed, mouthLocalPassed], 3),
  mouthVerificationOptions,
).join(' '), /已通过后不得继续尝试/,
  '第二档已通过后不得继续运行第三档');
assert.match(verifyDigitalHumanRenderTreatmentAudit(
  buildDigitalHumanRenderTreatmentAudit([
    baselineRejected,
    temporalRejected,
    { ...mouthLocalPassed, inputSha256: '1'.repeat(64) },
  ], 3),
  mouthVerificationOptions,
).join(' '), /同一未锐化输入/,
  '第三档不得更换 raw input');
assert.match(verifyDigitalHumanRenderTreatmentAudit(
  buildDigitalHumanRenderTreatmentAudit([
    baselineRejected,
    temporalRejected,
    { ...mouthLocalPassed, baseRenderFingerprint: '2'.repeat(64) },
  ], 3),
  mouthVerificationOptions,
).join(' '), /改变了基础渲染配方/,
  '第三档不得更换 baseRenderFingerprint');
assert.match(verifyDigitalHumanRenderTreatmentAudit(
  buildDigitalHumanRenderTreatmentAudit([baselineRejected, temporalRejected, mouthLocalPassed], 2),
  mouthVerificationOptions,
).join(' '), /未选中最后通过尝试/,
  '只能选中最后一档');
assert.match(verifyDigitalHumanRenderTreatmentAudit({
  ...mouthLocalAudit,
  attempts: [...mouthLocalAudit.attempts, mouthLocalPassed],
}, mouthVerificationOptions).join(' '), /尝试数无效/,
  '审计最多允许三档');
assert.match(verifyDigitalHumanRenderTreatmentAudit({
  ...mouthLocalAudit,
  attempts: [baselineRejected, temporalRejected, {
    ...mouthLocalPassed,
    triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  }],
}, mouthVerificationOptions).join(' '), /确定性绑定/,
  '第三档不得丢弃第二档的任一类型化嘴部失败原因');

const temporalOnlySyncRejected = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 2,
  treatmentId: 'mouth_jump_tmix2_equal_unsharp',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: temporalOutputSha,
  qualityPassed: false,
  qualityFailureCodes: ['syncnet_confidence_below_minimum'],
  qualityFailures: ['SyncNet置信度低于3.0'],
  appliedAt: timestamp,
});
assert.match(verifyDigitalHumanRenderTreatmentAudit(
  buildDigitalHumanRenderTreatmentAudit([baselineRejected, temporalOnlySyncRejected, mouthLocalPassed], 3),
  mouthVerificationOptions,
).join(' '), /缺少第二次 mouth_jump 或 mouth_sharpness/,
  '第三档只能由第二档仍存在的类型化嘴部失败触发');

assert.throws(() => buildDigitalHumanRenderTreatmentReceipt({
  attempt: 2,
  treatmentId: 'mouth_jump_tmix2_equal_unsharp',
  triggerFailureCodes: [],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: temporalOutputSha,
  qualityPassed: true,
}), /mouth_jump/);

assert.throws(() => buildDigitalHumanRenderTreatmentReceipt({
  attempt: 3,
  treatmentId: 'mouth_jump_mouth_local_v1',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: mouthLocalOutputSha,
  qualityPassed: true,
}), /processor evidence/,
'第三档缺少净化 processor evidence 必须拒绝构建');
assert.throws(() => buildDigitalHumanRenderTreatmentReceipt({
  attempt: 3,
  treatmentId: 'mouth_jump_mouth_local_v1',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: mouthLocalOutputSha,
  processorEvidence: mouthStabilizationEvidence,
  qualityPassed: true,
}), /固定发布版 processor script SHA256/,
'第三档构建不得使用 evidence 内的 script SHA 自证');
assert.throws(() => buildDigitalHumanRenderTreatmentReceipt({
  attempt: 3,
  treatmentId: 'mouth_jump_mouth_local_v1',
  triggerFailureCodes: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE],
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: mouthLocalOutputSha,
  processorEvidence: mouthStabilizationEvidence,
  expectedProcessorScriptSha256: '9'.repeat(64),
  qualityPassed: true,
}), /script SHA不匹配/,
'第三档构建必须匹配服务端提供的发布白名单 SHA');
assert.throws(() => buildDigitalHumanRenderTreatmentReceipt({
  attempt: 1,
  treatmentId: 'baseline_unsharp',
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: rawSha,
  outputSha256: baselineOutputSha,
  processorEvidence: mouthStabilizationEvidence,
  qualityPassed: true,
}), /不得携带 processor evidence/,
'前两档不得夹带局部处理证据');

console.log('digital human render-treatment tests passed');
