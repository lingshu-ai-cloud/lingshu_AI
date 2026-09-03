import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_SCHEMA = 'digital-human-server-acceptance-v2' as const;
export const DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_LANGUAGES = ['zh', 'en', 'es'] as const;
export type DigitalHumanTrustedAcceptanceLanguage = typeof DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_LANGUAGES[number];

export interface DigitalHumanHumanReviewRecord {
  reviewer: string;
  reviewerId: string;
  reviewedAt: string;
  outputSha256: string;
  sourceJobId: string;
  doubleMouth: 'approved' | 'rejected';
  complexHands: 'approved' | 'rejected';
  voiceMatch: 'approved' | 'rejected';
  performanceContinuity: 'approved' | 'rejected';
  notes?: string;
}

export interface DigitalHumanAttestedHumanReview extends DigitalHumanHumanReviewRecord {
  attestation: { algorithm: 'hmac-sha256'; signature: string };
}

export interface DigitalHumanTrustedAcceptanceJob {
  jobId: string;
  batchId: string;
  language: string;
  sourceProjectId?: string;
  status: string;
  containsDigitalHuman: boolean;
  downloadable: boolean;
  manifestSha256?: string;
  computedManifestSha256?: string;
  snapshotManifestSha256?: string;
  outputFilename?: string;
  outputSizeBytes?: number;
  outputSha256?: string;
  actualOutputSizeBytes?: number;
  actualOutputSha256?: string;
  downloadUrl?: string;
  timelineEvidencePassed: boolean;
  digitalHumanSegments?: Array<Record<string, unknown>>;
  qualityReport?: Record<string, unknown>;
  completedAt?: string;
  humanReview?: unknown;
}

export class DigitalHumanTrustedAcceptanceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) {
    super(message);
    this.name = 'DigitalHumanTrustedAcceptanceError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function sha256(value: unknown): string {
  const normalized = text(value, 64).toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : '';
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`;
}

function decision(value: unknown): 'approved' | 'rejected' | '' {
  const source = record(value);
  const normalized = text(source.decision || value, 32).toLowerCase();
  if (normalized === 'approved' || normalized === 'passed' || normalized === 'pass') return 'approved';
  if (normalized === 'rejected' || normalized === 'failed' || normalized === 'fail') return 'rejected';
  return '';
}

export function validateDigitalHumanHumanReview(input: {
  value: unknown;
  outputSha256: string;
  sourceJobId: string;
  completedAt?: string;
  nowMs?: number;
  authenticatedReviewerId?: string;
}): { valid: true; review: DigitalHumanHumanReviewRecord } | { valid: false; failures: string[] } {
  const source = record(input.value);
  const failures: string[] = [];
  const reviewer = text(source.reviewer, 160);
  const reviewerId = text(source.reviewerId || input.authenticatedReviewerId, 160);
  const reviewedAt = text(source.reviewedAt, 80);
  const reviewedAtMs = Date.parse(reviewedAt);
  const nowMs = input.nowMs ?? Date.now();
  const completedAtMs = Date.parse(String(input.completedAt || ''));
  const reviewSha = sha256(source.outputSha256);
  const expectedSha = sha256(input.outputSha256);
  const sourceJobId = text(source.sourceJobId || input.sourceJobId, 200);
  const doubleMouth = decision(source.doubleMouth);
  const complexHands = decision(source.complexHands);
  const voiceMatch = decision(source.voiceMatch);
  const performanceContinuity = decision(source.performanceContinuity);
  if (!reviewer) failures.push('人工复核缺少 reviewer');
  if (!reviewerId) failures.push('人工复核缺少可审计 reviewerId');
  if (input.authenticatedReviewerId && reviewerId !== input.authenticatedReviewerId) failures.push('人工复核 reviewerId 与当前认证账号不一致');
  if (!Number.isFinite(reviewedAtMs)) failures.push('人工复核 reviewedAt 无效');
  else {
    if (reviewedAtMs > nowMs + 5 * 60_000) failures.push('人工复核 reviewedAt 不得晚于服务器时间');
    if (Number.isFinite(completedAtMs) && reviewedAtMs < completedAtMs - 5 * 60_000) failures.push('人工复核早于本次成片完成时间');
  }
  if (!reviewSha || !expectedSha || reviewSha !== expectedSha) failures.push('人工复核未绑定当前输出 SHA256');
  if (!sourceJobId || sourceJobId !== input.sourceJobId) failures.push('人工复核未绑定当前渲染任务');
  if (!doubleMouth || !complexHands || !voiceMatch || !performanceContinuity) failures.push('人工复核必须分别判定双嘴、复杂手部、声音匹配和全片表演连续性');
  if (failures.length) return { valid: false, failures };
  return {
    valid: true,
    review: {
      reviewer, reviewerId, reviewedAt: new Date(reviewedAtMs).toISOString(), outputSha256: reviewSha,
      sourceJobId,
      doubleMouth: doubleMouth as 'approved' | 'rejected',
      complexHands: complexHands as 'approved' | 'rejected',
      voiceMatch: voiceMatch as 'approved' | 'rejected',
      performanceContinuity: performanceContinuity as 'approved' | 'rejected',
      ...(text(source.notes, 2000) ? { notes: text(source.notes, 2000) } : {}),
    },
  };
}

export function attestDigitalHumanHumanReview(review: DigitalHumanHumanReviewRecord, secret: string): DigitalHumanAttestedHumanReview {
  if (!text(secret)) throw new Error('human-review attestation secret is required');
  const signature = createHmac('sha256', secret).update(canonicalJson(review)).digest('hex');
  return { ...review, attestation: { algorithm: 'hmac-sha256', signature } };
}

export function verifyDigitalHumanHumanReviewAttestation(value: unknown, secret: string): boolean {
  const source = record(value);
  const attestation = record(source.attestation);
  const signature = sha256(attestation.signature);
  if (attestation.algorithm !== 'hmac-sha256' || !signature || !text(secret)) return false;
  const { attestation: _attestation, ...review } = source;
  const expected = createHmac('sha256', secret).update(canonicalJson(review)).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

function segmentEvidenceComplete(segments: Array<Record<string, unknown>> | undefined, language: string, sourceProjectId: string): boolean {
  if (!Array.isArray(segments) || segments.length < 3) return false;
  return segments.every(segment => {
    const provenance = record(segment.provenance);
    const start = Number(segment.start ?? segment.targetStart);
    const end = Number(segment.end ?? segment.targetEnd);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
      && text(segment.language) === language
      && text(segment.sourceProjectId) === sourceProjectId
      && ['avatarMaterialId', 'performanceProfileFingerprint', 'configuredGesture', 'inputSignature', 'workerOutputSha256']
        .every(field => Boolean(text(provenance[field])));
  });
}

export function buildDigitalHumanTrustedAcceptance(input: {
  batchId: string;
  tenantId: string;
  jobs: DigitalHumanTrustedAcceptanceJob[];
  attestationSecret: string;
  nowMs?: number;
}) {
  const batchId = text(input.batchId, 160);
  const tenantId = text(input.tenantId, 200);
  const secret = text(input.attestationSecret, 10_000);
  if (!batchId || !tenantId) throw new DigitalHumanTrustedAcceptanceError('验收批次标识缺失', 'ACCEPTANCE_BATCH_INVALID', 400);
  if (!secret) throw new DigitalHumanTrustedAcceptanceError('服务端验收签名密钥未配置', 'ACCEPTANCE_ATTESTATION_UNAVAILABLE', 503);
  if (input.jobs.length !== 3) throw new DigitalHumanTrustedAcceptanceError('服务端批次必须恰好包含 zh/en/es 三条成片', 'ACCEPTANCE_BATCH_INCOMPLETE');
  const languages = input.jobs.map(job => text(job.language).toLowerCase());
  if (!DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_LANGUAGES.every(language => languages.filter(item => item === language).length === 1)) {
    throw new DigitalHumanTrustedAcceptanceError('服务端批次语言必须且只能是 zh/en/es 各1条', 'ACCEPTANCE_LANGUAGES_INVALID');
  }
  const projects = new Set(input.jobs.map(job => text(job.sourceProjectId)).filter(Boolean));
  if (projects.size !== 1) throw new DigitalHumanTrustedAcceptanceError('三语成片必须来自同一 sourceProjectId', 'ACCEPTANCE_PROJECT_MISMATCH');
  const sourceProjectId = [...projects][0]!;
  const nowMs = input.nowMs ?? Date.now();
  const ordered = [...input.jobs].sort((left, right) => languages.indexOf(left.language) - languages.indexOf(right.language));
  const items = ordered.map(job => {
    const language = text(job.language).toLowerCase() as DigitalHumanTrustedAcceptanceLanguage;
    const quality = record(job.qualityReport);
    const media = record(quality.media);
    const timelineIntegrity = record(quality.timelineIntegrity);
    const persistedSha = sha256(job.outputSha256);
    const actualSha = sha256(job.actualOutputSha256);
    const qualitySha = sha256(media.sha256);
    const structuralFailures: string[] = [];
    if (job.batchId !== batchId) structuralFailures.push('渲染任务不属于请求批次');
    if (job.status !== 'completed' || !job.downloadable) structuralFailures.push('渲染任务未 completed+downloadable');
    if (!job.containsDigitalHuman) structuralFailures.push('渲染任务未声明数字人时间线');
    if (!job.timelineEvidencePassed || !segmentEvidenceComplete(job.digitalHumanSegments, language, sourceProjectId)) structuralFailures.push('冻结数字人 segments 证据不完整');
    if (!sha256(job.manifestSha256) || job.manifestSha256 !== job.computedManifestSha256 || job.manifestSha256 !== job.snapshotManifestSha256) structuralFailures.push('持久化 manifest 与冻结授权快照不一致');
    if (!persistedSha || !actualSha || persistedSha !== actualSha || qualitySha !== actualSha) structuralFailures.push('成片文件 SHA256 与任务/质检回执不一致');
    if (!job.outputFilename || !job.downloadUrl || !Number.isFinite(job.actualOutputSizeBytes) || Number(job.actualOutputSizeBytes) <= 0 || Number(job.outputSizeBytes) !== Number(job.actualOutputSizeBytes)) structuralFailures.push('成片不可下载或文件大小证据不一致');
    if (quality.passed !== true || timelineIntegrity.passed !== true) structuralFailures.push('服务端最终自动门禁未通过');
    if (structuralFailures.length) {
      throw new DigitalHumanTrustedAcceptanceError(`${language}: ${structuralFailures.join('；')}`, 'ACCEPTANCE_EVIDENCE_INVALID');
    }
    const reviewResult = validateDigitalHumanHumanReview({
      value: job.humanReview,
      outputSha256: actualSha,
      sourceJobId: job.jobId,
      completedAt: job.completedAt,
      nowMs,
    });
    const reviewAttested = reviewResult.valid && verifyDigitalHumanHumanReviewAttestation(job.humanReview, secret);
    const manualEvidence = reviewResult.valid && reviewAttested
      ? { present: true, valid: true, review: reviewResult.review }
      : { present: Object.keys(record(job.humanReview)).length > 0, valid: false, failures: reviewResult.valid ? ['人工复核缺少服务端签名或签名无效'] : reviewResult.failures };
    const review = reviewResult.valid && reviewAttested ? reviewResult.review : undefined;
    const manualPassed = Boolean(review && review.doubleMouth === 'approved' && review.complexHands === 'approved'
      && review.voiceMatch === 'approved' && review.performanceContinuity === 'approved');
    return {
      language,
      jobId: job.jobId,
      sourceProjectId,
      output: { filename: job.outputFilename, sha256: actualSha, sizeBytes: job.actualOutputSizeBytes, downloadUrl: job.downloadUrl },
      digitalHumanSegments: job.digitalHumanSegments,
      automatedEvidence: {
        passed: true,
        qualitySchemaVersion: text(quality.schemaVersion),
        qualityCheckedAt: text(quality.checkedAt),
        manifestSha256: job.manifestSha256,
        timelineIntegrity,
        media,
      },
      manualEvidence,
      manualPassed,
    };
  });
  const manualRejected = items.some(item => item.manualEvidence.valid && !item.manualPassed);
  const manualComplete = items.every(item => item.manualPassed);
  const validationStatus = manualRejected ? 'failed' : manualComplete ? 'passed' : 'requires_human_review';
  const unsigned = {
    schemaVersion: DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_SCHEMA,
    trust: 'server_attested' as const,
    productUse: 'release_acceptance' as const,
    batchId,
    tenantId,
    sourceProjectId,
    issuedAt: new Date(nowMs).toISOString(),
    summary: {
      automatedPassed: true,
      manualReviewComplete: manualComplete,
      passed: validationStatus === 'passed',
      validationStatus,
      languages: [...DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_LANGUAGES],
      automatedEvidenceCount: items.length,
      manualEvidenceCount: items.filter(item => item.manualEvidence.valid).length,
    },
    items,
  };
  const canonical = canonicalJson(unsigned);
  const digest = createHash('sha256').update(canonical).digest('hex');
  const signature = createHmac('sha256', secret).update(digest).digest('hex');
  return { ...unsigned, attestation: { algorithm: 'hmac-sha256' as const, digest, signature } };
}

export function verifyDigitalHumanTrustedAcceptance(value: unknown, secret: string): boolean {
  const source = record(value);
  const attestation = record(source.attestation);
  const signature = sha256(attestation.signature);
  if (source.schemaVersion !== DIGITAL_HUMAN_TRUSTED_ACCEPTANCE_SCHEMA || !signature || !text(secret)) return false;
  const { attestation: _attestation, ...unsigned } = source;
  const digest = createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  if (sha256(attestation.digest) !== digest) return false;
  const expected = createHmac('sha256', secret).update(digest).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
