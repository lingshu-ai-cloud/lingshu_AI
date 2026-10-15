import { fixedYieldSha256 } from './fixedYieldProduction.js';

export interface FixedYieldQualityDecisionCore {
  schemaVersion: 'fixed-yield-quality-decision.v2';
  subjectOperationId: string;
  subjectOutputName: string;
  subjectSha256: string;
  qaProfileId: string;
  thresholdsVersion: string;
  verdict: 'accepted' | 'rejected';
  failureCodes: string[];
  measurements: Record<string, number | string | boolean | null>;
}

export interface FixedYieldQualityDecision {
  core: FixedYieldQualityDecisionCore;
  decisionHash: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

export function sealFixedYieldQualityDecision(value: FixedYieldQualityDecisionCore): FixedYieldQualityDecision {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 'fixed-yield-quality-decision.v2'
    || !['accepted', 'rejected'].includes(value.verdict) || !Array.isArray(value.failureCodes)
    || !value.measurements || typeof value.measurements !== 'object' || Array.isArray(value.measurements)
    || Object.values(value.measurements).some(item => item !== null
      && !['string', 'number', 'boolean'].includes(typeof item)
      || typeof item === 'number' && !Number.isFinite(item))) {
    throw new Error('fixed_yield_quality_shape_invalid');
  }
  const core: FixedYieldQualityDecisionCore = {
    ...value,
    subjectOperationId: text(value.subjectOperationId),
    subjectOutputName: text(value.subjectOutputName),
    subjectSha256: text(value.subjectSha256),
    qaProfileId: text(value.qaProfileId),
    thresholdsVersion: text(value.thresholdsVersion),
    failureCodes: [...new Set(value.failureCodes.map(text).filter(Boolean))].sort(),
  };
  if (!core.subjectOperationId || !core.subjectOutputName || !SHA256_PATTERN.test(core.subjectSha256)
    || !core.qaProfileId || !core.thresholdsVersion) throw new Error('fixed_yield_quality_identity_invalid');
  if (core.verdict === 'accepted' && core.failureCodes.length) throw new Error('fixed_yield_quality_accepted_with_failures');
  if (core.verdict === 'rejected' && !core.failureCodes.length) throw new Error('fixed_yield_quality_rejected_without_failure');
  return { core, decisionHash: fixedYieldSha256(core) };
}

export function assertFixedYieldQualityDecision(value: unknown): asserts value is FixedYieldQualityDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('fixed_yield_quality_shape_invalid');
  const decision = value as Partial<FixedYieldQualityDecision>;
  if (!decision.core || !SHA256_PATTERN.test(String(decision.decisionHash ?? ''))) {
    throw new Error('fixed_yield_quality_hash_invalid');
  }
  const sealed = sealFixedYieldQualityDecision(decision.core);
  if (sealed.decisionHash !== decision.decisionHash) throw new Error('fixed_yield_quality_hash_invalid');
}
