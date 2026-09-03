import { createHash } from 'node:crypto';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  buildDigitalHumanMouthStabilizationFingerprint,
  verifyDigitalHumanMouthStabilizationEvidence,
  type DigitalHumanMouthStabilizationEvidence,
} from './digitalHumanMouthStabilization.js';

export const DIGITAL_HUMAN_FINAL_SHARPEN_FILTER = 'unsharp=5:5:0.35:5:5:0' as const;
export const DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER = 'unsharp=5:5:0.50:5:5:0' as const;
export const DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER = "tmix=frames=2:weights='1 1'" as const;
export const DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE = 'mouth_jump_excessive_frame_to_frame' as const;
export const DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE = 'mouth_sharpness_below_minimum' as const;
export const DIGITAL_HUMAN_RENDER_TREATMENT_RECEIPT_VERSION = 'render-treatment-receipt-v2' as const;
export const DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION = 'render-treatment-audit-v2' as const;
export const DIGITAL_HUMAN_MOUTH_LOCAL_OUTPUT_ARTIFACT = 'result.mouth-local-v1.mp4' as const;
export const DIGITAL_HUMAN_MOUTH_LOCAL_IDENTITY_FILTER = 'null' as const;

export const DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX = [
  '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=60,eq=brightness=-0.28:saturation=0.55[bg]',
  '[0:v]scale=1000:-2[fg]',
  '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1',
].join(';');

export const DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT = createHash('sha256')
  .update(DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX)
  .digest('hex');

export type DigitalHumanRenderTreatmentId =
  | 'baseline_unsharp'
  | 'mouth_jump_tmix2_equal_unsharp'
  | 'mouth_jump_mouth_local_v1';
export type DigitalHumanFinalSharpenFilter = typeof DIGITAL_HUMAN_FINAL_SHARPEN_FILTER | typeof DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER;
export type DigitalHumanRenderContext = 'standard_vertical' | 'performance';
export type DigitalHumanRenderTreatmentTrigger = 'initial' | 'typed_mouth_jump_failure' | 'typed_mouth_quality_failure';

export interface DigitalHumanRenderTreatmentReceipt {
  version: typeof DIGITAL_HUMAN_RENDER_TREATMENT_RECEIPT_VERSION;
  pipelineVersion: typeof DIGITAL_HUMAN_PIPELINE_VERSION;
  attempt: number;
  treatmentId: DigitalHumanRenderTreatmentId;
  trigger: DigitalHumanRenderTreatmentTrigger;
  triggerFailureCodes: string[];
  renderContext: DigitalHumanRenderContext;
  temporalFilter: typeof DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER | null;
  finalSharpenFilter: DigitalHumanFinalSharpenFilter | null;
  finalVideoFilter: string;
  filterSha256: string;
  processorEvidence: DigitalHumanMouthStabilizationEvidence | null;
  processorEvidenceFingerprint: string | null;
  processorOutputSha256: string | null;
  baseRenderFingerprint: string;
  inputSha256: string;
  outputSha256: string;
  outputArtifact: 'result.mp4' | 'result.tmix-2-equal.mp4' | typeof DIGITAL_HUMAN_MOUTH_LOCAL_OUTPUT_ARTIFACT;
  qualityPassed: boolean;
  qualityFailureCodes: string[];
  qualityFailures: string[];
  appliedAt: string;
  renderFingerprint: string;
}

export interface DigitalHumanRenderTreatmentAudit {
  version: typeof DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION;
  pipelineVersion: typeof DIGITAL_HUMAN_PIPELINE_VERSION;
  attempts: DigitalHumanRenderTreatmentReceipt[];
  selectedAttempt?: number;
  selectedTreatmentId?: DigitalHumanRenderTreatmentId;
}

interface BuildReceiptInput {
  attempt: number;
  treatmentId: DigitalHumanRenderTreatmentId;
  triggerFailureCodes?: string[];
  renderContext: DigitalHumanRenderContext;
  baseRenderFingerprint: string;
  inputSha256: string;
  outputSha256: string;
  qualityPassed: boolean;
  qualityFailureCodes?: string[];
  qualityFailures?: string[];
  processorEvidence?: DigitalHumanMouthStabilizationEvidence;
  expectedProcessorScriptSha256?: string;
  appliedAt?: string;
}

export interface VerifyDigitalHumanRenderTreatmentReceiptOptions {
  expectedMouthStabilizationScriptSha256?: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function isDigitalHumanRenderTreatmentId(value: unknown): value is DigitalHumanRenderTreatmentId {
  return value === 'baseline_unsharp'
    || value === 'mouth_jump_tmix2_equal_unsharp'
    || value === 'mouth_jump_mouth_local_v1';
}

export function digitalHumanFinalVideoFilter(treatmentId: DigitalHumanRenderTreatmentId): string {
  if (treatmentId === 'mouth_jump_mouth_local_v1') return DIGITAL_HUMAN_MOUTH_LOCAL_IDENTITY_FILTER;
  if (treatmentId === 'mouth_jump_tmix2_equal_unsharp') {
    return `${DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER},${DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER}`;
  }
  return DIGITAL_HUMAN_FINAL_SHARPEN_FILTER;
}

/**
 * Append the one and only final treatment. Callers must provide a base chain
 * that has not already been sharpened or temporally mixed.
 */
export function buildDigitalHumanFinalFilterComplex(
  baseFilterComplex: string,
  treatmentId: DigitalHumanRenderTreatmentId,
): string {
  if (/\bunsharp\s*=|\btmix\s*=/.test(baseFilterComplex)) {
    throw new Error('数字人基础渲染链已包含最终清晰度或时序处理，禁止重复应用');
  }
  return `${baseFilterComplex},${digitalHumanFinalVideoFilter(treatmentId)}[v]`;
}

export function shouldAttemptDigitalHumanTemporalStability(quality: {
  passed?: boolean;
  failureCodes?: unknown;
}): boolean {
  return quality.passed === false
    && stringArray(quality.failureCodes).includes(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE);
}

export function shouldAttemptDigitalHumanMouthLocalStability(quality: {
  passed?: boolean;
  failureCodes?: unknown;
}): boolean {
  if (quality.passed !== false) return false;
  const failureCodes = stringArray(quality.failureCodes);
  return failureCodes.includes(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE)
    || failureCodes.includes(DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE);
}

function receiptFingerprintPayload(receipt: Omit<DigitalHumanRenderTreatmentReceipt, 'renderFingerprint'>): string {
  return JSON.stringify({
    version: receipt.version,
    pipelineVersion: receipt.pipelineVersion,
    attempt: receipt.attempt,
    treatmentId: receipt.treatmentId,
    trigger: receipt.trigger,
    triggerFailureCodes: receipt.triggerFailureCodes,
    renderContext: receipt.renderContext,
    temporalFilter: receipt.temporalFilter,
    finalSharpenFilter: receipt.finalSharpenFilter,
    finalVideoFilter: receipt.finalVideoFilter,
    filterSha256: receipt.filterSha256,
    processorEvidence: receipt.processorEvidence,
    processorEvidenceFingerprint: receipt.processorEvidenceFingerprint,
    processorOutputSha256: receipt.processorOutputSha256,
    baseRenderFingerprint: receipt.baseRenderFingerprint,
    inputSha256: receipt.inputSha256,
    outputSha256: receipt.outputSha256,
    outputArtifact: receipt.outputArtifact,
    qualityPassed: receipt.qualityPassed,
    qualityFailureCodes: receipt.qualityFailureCodes,
    qualityFailures: receipt.qualityFailures,
    appliedAt: receipt.appliedAt,
  });
}

export function buildDigitalHumanRenderTreatmentReceipt(input: BuildReceiptInput): DigitalHumanRenderTreatmentReceipt {
  const temporal = input.treatmentId === 'mouth_jump_tmix2_equal_unsharp';
  const mouthLocal = input.treatmentId === 'mouth_jump_mouth_local_v1';
  const attempt = mouthLocal ? 3 : temporal ? 2 : 1;
  if (input.attempt !== attempt) throw new Error('数字人时序处理尝试顺序无效');
  const suppliedTriggerFailureCodes = [...new Set((input.triggerFailureCodes || []).map(String).filter(Boolean))];
  const allowedTriggerFailureCodes: string[] = mouthLocal
    ? [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE, DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE]
    : temporal ? [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE] : [];
  const unsupportedTriggerFailureCode = suppliedTriggerFailureCodes.find(code => !allowedTriggerFailureCodes.includes(code));
  if (unsupportedTriggerFailureCode) throw new Error('数字人处理回执包含非允许的触发类型');
  const triggerFailureCodes = allowedTriggerFailureCodes.filter(code => suppliedTriggerFailureCodes.includes(code));
  if (temporal && !triggerFailureCodes.includes(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE)) {
    throw new Error('数字人时序兜底缺少类型化 mouth_jump 触发证据');
  }
  if (mouthLocal && !triggerFailureCodes.length) {
    throw new Error('数字人嘴部局部处理缺少类型化 mouth_jump 或 mouth_sharpness 触发证据');
  }
  if (!temporal && !mouthLocal && triggerFailureCodes.length) throw new Error('数字人基线尝试不得伪造兜底触发证据');
  const inputSha256 = String(input.inputSha256 || '').toLowerCase();
  const outputSha256 = String(input.outputSha256 || '').toLowerCase();
  const baseRenderFingerprint = String(input.baseRenderFingerprint || '').toLowerCase();
  if (!isSha256(inputSha256) || !isSha256(outputSha256) || !isSha256(baseRenderFingerprint)) {
    throw new Error('数字人时序处理回执 SHA256 无效');
  }
  const qualityFailureCodes = [...new Set((input.qualityFailureCodes || []).map(String).filter(Boolean))];
  const qualityFailures = [...new Set((input.qualityFailures || []).map(String).filter(Boolean))];
  if (input.qualityPassed && (qualityFailureCodes.length || qualityFailures.length)) {
    throw new Error('数字人时序处理通过回执不得包含失败证据');
  }
  if (!input.qualityPassed && !qualityFailures.length) throw new Error('数字人时序处理拒绝回执缺少失败证据');
  const finalVideoFilter = digitalHumanFinalVideoFilter(input.treatmentId);
  let processorEvidence: DigitalHumanMouthStabilizationEvidence | null = null;
  let processorEvidenceFingerprint: string | null = null;
  let processorOutputSha256: string | null = null;
  if (mouthLocal) {
    if (!input.processorEvidence) throw new Error('数字人嘴部局部处理缺少净化 processor evidence');
    try {
      processorEvidence = JSON.parse(JSON.stringify(input.processorEvidence)) as DigitalHumanMouthStabilizationEvidence;
    } catch {
      throw new Error('数字人嘴部局部处理 processor evidence 不可序列化');
    }
    const evidenceRecord = asRecord(processorEvidence);
    processorOutputSha256 = String(evidenceRecord.processorOutputSha256 || '').toLowerCase();
    if (!isSha256(processorOutputSha256)) throw new Error('数字人嘴部局部处理 processor output SHA256 无效');
    const expectedProcessorScriptSha256 = String(input.expectedProcessorScriptSha256 || '').toLowerCase();
    if (!isSha256(expectedProcessorScriptSha256)) {
      throw new Error('数字人嘴部局部处理缺少固定发布版 processor script SHA256');
    }
    const evidenceFailures = verifyDigitalHumanMouthStabilizationEvidence(processorEvidence, {
      expectedRawInputSha256: inputSha256,
      expectedProcessorOutputSha256: processorOutputSha256,
      expectedScriptSha256: expectedProcessorScriptSha256,
      expectedAuditFileSha256: String(evidenceRecord.auditFileSha256 || ''),
    });
    if (evidenceFailures.length) throw new Error(`数字人嘴部局部处理 processor evidence 无效：${evidenceFailures.join('；')}`);
    processorEvidenceFingerprint = buildDigitalHumanMouthStabilizationFingerprint(processorEvidence);
  } else if (input.processorEvidence !== undefined) {
    throw new Error('非嘴部局部处理档位不得携带 processor evidence');
  } else if (input.expectedProcessorScriptSha256 !== undefined) {
    throw new Error('非嘴部局部处理档位不得声明 processor script SHA256');
  }
  const serializable: Omit<DigitalHumanRenderTreatmentReceipt, 'renderFingerprint'> = {
    version: DIGITAL_HUMAN_RENDER_TREATMENT_RECEIPT_VERSION,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    attempt,
    treatmentId: input.treatmentId,
    trigger: mouthLocal ? 'typed_mouth_quality_failure' : temporal ? 'typed_mouth_jump_failure' : 'initial',
    triggerFailureCodes,
    renderContext: input.renderContext,
    temporalFilter: temporal ? DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER : null,
    finalSharpenFilter: mouthLocal
      ? null
      : temporal ? DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER : DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
    finalVideoFilter,
    filterSha256: sha256(finalVideoFilter),
    processorEvidence,
    processorEvidenceFingerprint,
    processorOutputSha256,
    baseRenderFingerprint,
    inputSha256,
    outputSha256,
    outputArtifact: mouthLocal
      ? DIGITAL_HUMAN_MOUTH_LOCAL_OUTPUT_ARTIFACT
      : temporal ? 'result.tmix-2-equal.mp4' : 'result.mp4',
    qualityPassed: input.qualityPassed,
    qualityFailureCodes,
    qualityFailures,
    appliedAt: input.appliedAt || new Date().toISOString(),
  };
  return { ...serializable, renderFingerprint: sha256(receiptFingerprintPayload(serializable)) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function verifyDigitalHumanRenderTreatmentReceipt(
  value: unknown,
  options: VerifyDigitalHumanRenderTreatmentReceiptOptions = {},
): string[] {
  const receipt = asRecord(value);
  const failures: string[] = [];
  if (receipt.version !== DIGITAL_HUMAN_RENDER_TREATMENT_RECEIPT_VERSION) failures.push('时序处理回执缺失或版本无效');
  if (receipt.pipelineVersion !== DIGITAL_HUMAN_PIPELINE_VERSION) failures.push('时序处理回执 pipeline 版本无效');
  if (!isDigitalHumanRenderTreatmentId(receipt.treatmentId)) failures.push('时序处理回执档位无效');
  const treatmentId = isDigitalHumanRenderTreatmentId(receipt.treatmentId) ? receipt.treatmentId : 'baseline_unsharp';
  const temporal = treatmentId === 'mouth_jump_tmix2_equal_unsharp';
  const mouthLocal = treatmentId === 'mouth_jump_mouth_local_v1';
  if (receipt.attempt !== (mouthLocal ? 3 : temporal ? 2 : 1)) failures.push('时序处理回执尝试顺序无效');
  const expectedTrigger = mouthLocal ? 'typed_mouth_quality_failure' : temporal ? 'typed_mouth_jump_failure' : 'initial';
  if (receipt.trigger !== expectedTrigger) failures.push('时序处理回执触发类型无效');
  const triggerFailureCodes = stringArray(receipt.triggerFailureCodes);
  const allowedTriggerFailureCodes: string[] = mouthLocal
    ? [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE, DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE]
    : temporal ? [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE] : [];
  if (triggerFailureCodes.some(code => !allowedTriggerFailureCodes.includes(code))) failures.push('时序处理回执包含非允许的触发类型');
  if (temporal && !triggerFailureCodes.includes(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE)) failures.push('时序兜底回执缺少 mouth_jump 触发证据');
  if (mouthLocal && !triggerFailureCodes.some(code => allowedTriggerFailureCodes.includes(code))) {
    failures.push('嘴部局部处理回执缺少 mouth_jump 或 mouth_sharpness 触发证据');
  }
  if (!temporal && !mouthLocal && triggerFailureCodes.length) failures.push('基线回执包含非法兜底触发证据');
  if (receipt.renderContext !== 'standard_vertical' && receipt.renderContext !== 'performance') failures.push('时序处理回执渲染上下文无效');
  const expectedFinalFilter = digitalHumanFinalVideoFilter(treatmentId);
  const expectedSharpenFilter = mouthLocal
    ? null
    : temporal ? DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER : DIGITAL_HUMAN_FINAL_SHARPEN_FILTER;
  if (receipt.temporalFilter !== (temporal ? DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER : null)
    || receipt.finalSharpenFilter !== expectedSharpenFilter
    || receipt.finalVideoFilter !== expectedFinalFilter) {
    failures.push('时序处理回执滤镜配方被篡改');
  }
  if (receipt.filterSha256 !== sha256(expectedFinalFilter)) failures.push('时序处理回执滤镜指纹无效');
  if (!isSha256(receipt.baseRenderFingerprint)) failures.push('时序处理回执基础渲染指纹无效');
  if (receipt.renderContext === 'standard_vertical'
    && receipt.baseRenderFingerprint !== DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT) {
    failures.push('标准竖屏基础渲染指纹不匹配');
  }
  if (!isSha256(receipt.inputSha256) || !isSha256(receipt.outputSha256)) failures.push('时序处理回执输入或输出 SHA256 无效');
  const expectedOutputArtifact = mouthLocal
    ? DIGITAL_HUMAN_MOUTH_LOCAL_OUTPUT_ARTIFACT
    : temporal ? 'result.tmix-2-equal.mp4' : 'result.mp4';
  if (receipt.outputArtifact !== expectedOutputArtifact) failures.push('时序处理回执产物标识无效');
  if (mouthLocal) {
    const processorEvidence = asRecord(receipt.processorEvidence);
    const processorOutputSha256 = String(receipt.processorOutputSha256 || '').toLowerCase();
    if (!isSha256(processorOutputSha256)) failures.push('嘴部局部处理 processor output SHA256 无效');
    const expectedScriptSha256 = String(options.expectedMouthStabilizationScriptSha256 || '').toLowerCase();
    if (!isSha256(expectedScriptSha256)) failures.push('嘴部局部处理缺少固定发布版 processor script SHA256');
    const processorEvidenceFailures = isSha256(processorOutputSha256) && isSha256(expectedScriptSha256)
      ? verifyDigitalHumanMouthStabilizationEvidence(receipt.processorEvidence, {
        expectedRawInputSha256: String(receipt.inputSha256 || ''),
        expectedProcessorOutputSha256: processorOutputSha256,
        expectedScriptSha256,
        expectedAuditFileSha256: String(processorEvidence.auditFileSha256 || ''),
      })
      : [];
    failures.push(...processorEvidenceFailures);
    if (!processorEvidenceFailures.length) {
      const expectedProcessorFingerprint = buildDigitalHumanMouthStabilizationFingerprint(
        receipt.processorEvidence as DigitalHumanMouthStabilizationEvidence,
      );
      if (receipt.processorEvidenceFingerprint !== expectedProcessorFingerprint) {
        failures.push('嘴部局部处理 processor evidence 指纹无效');
      }
    }
  } else if (receipt.processorEvidence !== null
    || receipt.processorEvidenceFingerprint !== null
    || receipt.processorOutputSha256 !== null) {
    failures.push('非嘴部局部处理回执包含非法 processor evidence');
  }
  if (typeof receipt.qualityPassed !== 'boolean') failures.push('时序处理回执质量结论缺失');
  const qualityFailureCodes = stringArray(receipt.qualityFailureCodes);
  const qualityFailures = stringArray(receipt.qualityFailures);
  if (receipt.qualityPassed === true && (qualityFailureCodes.length || qualityFailures.length)) failures.push('时序处理通过回执包含失败证据');
  if (receipt.qualityPassed === false && !qualityFailures.length) failures.push('时序处理拒绝回执缺少失败证据');
  if (!Number.isFinite(Date.parse(String(receipt.appliedAt || '')))) failures.push('时序处理回执时间无效');

  const serializable = {
    version: receipt.version,
    pipelineVersion: receipt.pipelineVersion,
    attempt: receipt.attempt,
    treatmentId: receipt.treatmentId,
    trigger: receipt.trigger,
    triggerFailureCodes,
    renderContext: receipt.renderContext,
    temporalFilter: receipt.temporalFilter,
    finalSharpenFilter: receipt.finalSharpenFilter,
    finalVideoFilter: receipt.finalVideoFilter,
    filterSha256: receipt.filterSha256,
    processorEvidence: receipt.processorEvidence,
    processorEvidenceFingerprint: receipt.processorEvidenceFingerprint,
    processorOutputSha256: receipt.processorOutputSha256,
    baseRenderFingerprint: receipt.baseRenderFingerprint,
    inputSha256: receipt.inputSha256,
    outputSha256: receipt.outputSha256,
    outputArtifact: receipt.outputArtifact,
    qualityPassed: receipt.qualityPassed,
    qualityFailureCodes,
    qualityFailures,
    appliedAt: receipt.appliedAt,
  } as Omit<DigitalHumanRenderTreatmentReceipt, 'renderFingerprint'>;
  if (receipt.renderFingerprint !== sha256(receiptFingerprintPayload(serializable))) failures.push('时序处理回执渲染指纹无效');
  return [...new Set(failures)];
}

export function buildDigitalHumanRenderTreatmentAudit(
  attempts: DigitalHumanRenderTreatmentReceipt[],
  selectedAttempt?: number,
): DigitalHumanRenderTreatmentAudit {
  const selected = selectedAttempt === undefined ? undefined : attempts.find(item => item.attempt === selectedAttempt);
  return {
    version: DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    attempts: attempts.map(item => ({ ...item })),
    ...(selected ? { selectedAttempt: selected.attempt, selectedTreatmentId: selected.treatmentId } : {}),
  };
}

export function verifyDigitalHumanRenderTreatmentAudit(
  value: unknown,
  options: {
    expectedOutputSha256?: string;
    expectedRenderContext?: DigitalHumanRenderContext;
    expectedBaseRenderFingerprint?: string;
    expectedMouthStabilizationScriptSha256?: string;
    requireSelected?: boolean;
  } = {},
): string[] {
  const audit = asRecord(value);
  const failures: string[] = [];
  if (audit.version !== DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION) failures.push('数字人时序处理审计回执缺失或版本无效');
  if (audit.pipelineVersion !== DIGITAL_HUMAN_PIPELINE_VERSION) failures.push('数字人时序处理审计 pipeline 版本无效');
  const attempts = Array.isArray(audit.attempts) ? audit.attempts : [];
  if (attempts.length < 1 || attempts.length > 3) failures.push('数字人时序处理尝试数无效');
  attempts.forEach(item => failures.push(...verifyDigitalHumanRenderTreatmentReceipt(item, {
    expectedMouthStabilizationScriptSha256: options.expectedMouthStabilizationScriptSha256,
  })));
  const records = attempts.map(asRecord);
  const first = records[0];
  const second = records[1];
  const third = records[2];
  const treatmentSequence: DigitalHumanRenderTreatmentId[] = [
    'baseline_unsharp',
    'mouth_jump_tmix2_equal_unsharp',
    'mouth_jump_mouth_local_v1',
  ];
  records.forEach((record, index) => {
    if (record.attempt !== index + 1 || record.treatmentId !== treatmentSequence[index]) {
      failures.push(index === 0 ? '数字人时序处理首次尝试必须为基线' : '数字人时序兜底尝试顺序无效');
    }
    if (index > 0 && records[index - 1]?.qualityPassed !== false) failures.push('数字人时序处理已通过后不得继续尝试');
    if (index > 0 && first?.inputSha256 !== record.inputSha256) failures.push('数字人时序兜底未从同一未锐化输入重新渲染');
    if (index > 0 && first?.baseRenderFingerprint !== record.baseRenderFingerprint) failures.push('数字人时序兜底改变了基础渲染配方');
  });
  if (second) {
    if (first?.qualityPassed !== false || !stringArray(first?.qualityFailureCodes).includes(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE)) {
      failures.push('数字人时序兜底缺少前一次 mouth_jump 质量拒绝证据');
    }
    if (JSON.stringify(stringArray(second.triggerFailureCodes)) !== JSON.stringify([DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE])) {
      failures.push('数字人时序兜底触发原因未与前一次 mouth_jump 拒绝确定性绑定');
    }
  }
  if (third) {
    const secondFailureCodes = stringArray(second?.qualityFailureCodes);
    const expectedMouthLocalTriggers = [
      DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
      DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
    ].filter(code => secondFailureCodes.includes(code));
    if (second?.qualityPassed !== false || !expectedMouthLocalTriggers.length) {
      failures.push('数字人嘴部局部处理缺少第二次 mouth_jump 或 mouth_sharpness 质量拒绝证据');
    }
    if (JSON.stringify(stringArray(third.triggerFailureCodes)) !== JSON.stringify(expectedMouthLocalTriggers)) {
      failures.push('数字人嘴部局部处理触发原因未与第二次类型化质量拒绝确定性绑定');
    }
    const expectedProfileId = stringArray(first?.qualityFailureCodes).includes(DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE)
      ? 'balanced' : 'strong';
    if (asRecord(third.processorEvidence).profileId !== expectedProfileId) {
      failures.push('数字人嘴部局部处理参数档位未按基线类型化质量结果确定性选择');
    }
  }
  if (options.expectedRenderContext && records.some(item => item.renderContext !== options.expectedRenderContext)) {
    failures.push('时序处理回执与任务渲染上下文不匹配');
  }
  const expectedBaseRenderFingerprint = String(options.expectedBaseRenderFingerprint || '').toLowerCase();
  if (expectedBaseRenderFingerprint && (!isSha256(expectedBaseRenderFingerprint)
    || records.some(item => item.baseRenderFingerprint !== expectedBaseRenderFingerprint))) {
    failures.push('时序处理回执与服务端重建的基础渲染指纹不一致');
  }
  const selectedAttempt = Number(audit.selectedAttempt);
  const selected = records.find(item => item.attempt === selectedAttempt);
  if (options.requireSelected !== false) {
    if (!selected || selected !== records[records.length - 1]) failures.push('数字人时序处理未选中最后通过尝试');
    if (selected?.qualityPassed !== true) failures.push('数字人时序处理选中尝试未通过完整质量门禁');
    if (selected && audit.selectedTreatmentId !== selected.treatmentId) failures.push('数字人时序处理选中档位与回执不一致');
  }
  const expectedOutputSha256 = String(options.expectedOutputSha256 || '').toLowerCase();
  if (expectedOutputSha256 && (!isSha256(expectedOutputSha256) || selected?.outputSha256 !== expectedOutputSha256)) {
    failures.push('时序处理选中回执 SHA256 与服务端实测不一致');
  }
  return [...new Set(failures)];
}
