import express, { type NextFunction, type Request, type Response as ExpressResponse } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import dotenv from 'dotenv';
import {
  acknowledgeDigitalHumanResult,
  dueDigitalHumanResultOutbox,
  markDigitalHumanResultUploaded,
  digitalHumanDeliveryKind,
  reviveDigitalHumanDeadLetter,
  retryDigitalHumanResult,
  type DigitalHumanResultOutboxRecord,
} from '../server/lib/digitalHumanResultTransfer.js';
import {
  DIGITAL_HUMAN_FINAL_VALIDATOR_VERSION,
  buildDigitalHumanFinalQualityReport,
  isLoopbackHostname,
  validateDigitalHumanHubUrl,
  validateResolvedDigitalHumanInputUrl,
  validateDigitalHumanWorkerInputUrl,
  type DigitalHumanFinalQualityReport,
} from '../server/lib/digitalHumanWorkerFinalQuality.js';
import {
  DIGITAL_HUMAN_PERFORMANCE_SHOT_GATE_VERSION,
  DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT,
  DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH,
  buildPerformanceExecutionReceipt,
  buildPerformanceExecutionRecipe,
  digitalHumanPerformanceShotGate,
  parseExecutablePerformancePlan,
  type ExecutablePerformancePlan,
  type PerformanceExecutionRecipe,
  type PerformanceExecutionReceipt,
  type PerformanceShotGateResult,
} from '../server/lib/digitalHumanPerformanceExecution.js';
import {
  DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA,
  type DigitalHumanWorkerHealthReport,
} from '../server/lib/digitalHumanWorkerPresence.js';
import {
  DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
  DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE,
  DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION,
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX,
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER,
  DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER,
  buildDigitalHumanFinalFilterComplex,
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
  shouldAttemptDigitalHumanTemporalStability,
  shouldAttemptDigitalHumanMouthLocalStability,
  digitalHumanFinalVideoFilter,
  type DigitalHumanRenderTreatmentAudit,
  type DigitalHumanRenderTreatmentId,
  type DigitalHumanRenderTreatmentReceipt,
} from '../server/lib/digitalHumanRenderTreatment.js';
import {
  DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
  DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES,
  DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
  parseDigitalHumanMouthStabilizationAudit,
  type DigitalHumanMouthStabilizationEvidence,
  type DigitalHumanMouthStabilizationProfileId,
} from '../server/lib/digitalHumanMouthStabilization.js';
import {
  buildMuseTalkProfileSelectionNotes,
  MUSE_TALK_PROFILE_POLICY_VERSION,
  museTalkRunnerProfileArguments,
  nextMuseTalkProfile,
  type MuseTalkProfileAttemptOutcome,
  type MuseTalkProfileAttemptSummary,
  type MuseTalkProfileId,
  type MuseTalkRenderProfile,
} from '../server/lib/digitalHumanMuseTalkProfilePolicy.js';
import {
  DIGITAL_HUMAN_PIPELINE_VERSION,
  parseDigitalHumanPipelineVersion,
} from '../src/lib/digitalHumanPipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true });

type WorkerStatus = 'queued' | 'processing' | 'quality_check' | 'completed' | 'failed' | 'cancelled';
interface WorkerJob {
  id: string;
  externalJobId: string;
  leaseId?: string;
  status: WorkerStatus;
  stage: string;
  progress: number;
  outputUrl?: string;
  quality?: {
    passed: boolean;
    validationStatus?: 'passed' | 'review';
    reviewRequired?: boolean;
    outputSha256?: string;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioCodec?: string;
    lipSyncScore?: number;
    avOffsetFrames?: number;
    freezeSegments?: number;
    durationSeconds?: number;
    faceDetectionRate?: number;
    mouthJumpP95?: number;
    mouthOpennessStd?: number;
    mouthSharpnessMedian?: number;
    validationScope?: 'full_video' | 'segment';
    thresholds?: { lipSyncScoreMinimum: number; absoluteAvOffsetFramesMaximum: number };
    validatorVersion?: string;
    gateVersion?: string;
    gateFailures?: string[];
    performanceExecutionVersion?: string;
    performancePlanFingerprint?: string;
    pipelineVersion?: typeof DIGITAL_HUMAN_PIPELINE_VERSION;
    failureCodes?: string[];
    renderTreatmentAudit?: DigitalHumanRenderTreatmentAudit;
    failures?: string[];
    notes: string[];
  };
  errorCode?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  artifactsCleanedAt?: string;
}

interface PerformancePlanInput {
  version?: string;
  beats?: Array<{
    id?: string;
    startMs?: number;
    endMs?: number;
    gesture?: string;
    expression?: string;
    head?: string;
    gaze?: string;
    actionPeakMs?: number;
  }>;
  scene?: { mode?: string; camera?: string; composition?: string };
}

interface WorkerInput {
  avatarVideoUrl: string;
  audioUrl: string;
  audioSegment?: { startSeconds: number; endSeconds: number };
  performancePlanVersion?: string;
  performancePlan?: PerformancePlanInput;
  motionClipIds?: string[];
  motionClips?: Array<{ id: string; videoUrl: string; beatIds?: string[] }>;
  pipelineVersion?: string;
  usagePurpose?: 'internal_preview' | 'customer_delivery' | 'paid_media' | 'organic_social';
}

function validateWorkerPipelineVersion(input: WorkerInput): void {
  const pipelineVersion = parseDigitalHumanPipelineVersion(input.pipelineVersion);
  if (!pipelineVersion) throw new Error(`不支持的数字人 pipelineVersion，当前仅支持 ${DIGITAL_HUMAN_PIPELINE_VERSION}`);
  input.pipelineVersion = pipelineVersion;
}

type WorkerQuality = NonNullable<WorkerJob['quality']>;

interface MuseTalkProfileAttemptArtifact {
  attempt: number;
  profile: MuseTalkRenderProfile;
  outcome: MuseTalkProfileAttemptOutcome | 'running';
  startedAt: string;
  completedAt?: string;
  artifacts: {
    directory: string;
    rawOutput: string;
    output: string;
    finalQuality: string;
    performanceExecution?: string;
    performanceQuality?: string;
    renderTreatmentAudit: string;
  };
  quality?: WorkerQuality;
  performanceGate?: PerformanceShotGateResult;
  failure?: string;
}

interface MuseTalkProfileAttemptManifest {
  version: 'musetalk-profile-attempts-v2';
  policyVersion: typeof MUSE_TALK_PROFILE_POLICY_VERSION;
  pipelineVersion: typeof DIGITAL_HUMAN_PIPELINE_VERSION;
  finalSharpenFilter: typeof DIGITAL_HUMAN_FINAL_SHARPEN_FILTER;
  temporalFinalSharpenFilter: typeof DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER;
  temporalStabilityFilter: typeof DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER;
  renderTreatmentAuditVersion: typeof DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION;
  retryTrigger: 'final_quality_rejected_only';
  temporalRetryTrigger: typeof DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE;
  mouthLocalRetryTriggers: [typeof DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE, typeof DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE];
  mouthStabilizerScriptSha256: typeof DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256;
  thresholds: {
    shortSegmentMaximumSeconds: number;
    shortSegmentMinimumLipSyncScore: number;
    absoluteAvOffsetFramesMaximum: 3;
  };
  attempts: MuseTalkProfileAttemptArtifact[];
  selectedProfileId?: MuseTalkProfileId;
  selectedOutputSha256?: string;
  updatedAt: string;
}

class FinalQualityRejectedError extends Error {
  constructor(
    readonly quality: WorkerQuality,
    readonly performanceGate?: PerformanceShotGateResult,
    readonly renderReceipt?: DigitalHumanRenderTreatmentReceipt,
    readonly outputPath?: string,
  ) {
    super(`最终成片质量门禁未通过: ${quality.failures.join('；')}`);
    this.name = 'FinalQualityRejectedError';
  }
}

class PerformanceQualityRejectedError extends Error {
  constructor(
    readonly quality: WorkerQuality,
    readonly gate: PerformanceShotGateResult,
    readonly renderReceipt?: DigitalHumanRenderTreatmentReceipt,
    readonly outputPath?: string,
  ) {
    super(`数字人表演计划门禁未通过: ${gate.failures.join('；')}`);
    this.name = 'PerformanceQualityRejectedError';
  }
}

const port = Math.max(1024, Number(process.env.DIGITAL_HUMAN_WORKER_PORT || 8792));
const host = String(process.env.DIGITAL_HUMAN_WORKER_HOST || '127.0.0.1');
const apiKey = String(process.env.DIGITAL_HUMAN_API_KEY || '').trim();
const hubUrl = validateDigitalHumanHubUrl(process.env.DIGITAL_HUMAN_HUB_URL, process.env.NODE_ENV);
if (!isLoopbackHostname(host) && !apiKey) throw new Error('DIGITAL_HUMAN_API_KEY is required when Worker listens on a non-loopback host');
const workerKey = String(process.env.DIGITAL_HUMAN_WORKER_KEY || apiKey).trim();
const workerId = String(process.env.DIGITAL_HUMAN_WORKER_ID || `gpu-${process.env.COMPUTERNAME || 'local'}`).trim();
const runnerSetting = String(process.env.DIGITAL_HUMAN_LOCAL_RUNNER || '').trim();
const runner = runnerSetting ? path.resolve(runnerSetting) : '';
const workRoot = path.resolve(process.env.DIGITAL_HUMAN_WORKER_DATA_DIR || path.join(rootDir, 'data', 'digital-human-worker'));
const jobsFile = path.join(workRoot, 'jobs.json');
const resultOutboxFile = path.join(workRoot, 'result-outbox.json');
const maxInputBytes = 110 * 1024 * 1024;
const resultUploadTimeoutMs = Math.max(120_000, Number(process.env.DIGITAL_HUMAN_WORKER_UPLOAD_TIMEOUT_MS || 20 * 60_000));
const resultRetryBaseMs = Math.max(500, Number(process.env.DIGITAL_HUMAN_WORKER_RESULT_RETRY_BASE_MS || 2_000));
const resultRetryMaxMs = Math.max(resultRetryBaseMs, Number(process.env.DIGITAL_HUMAN_WORKER_RESULT_RETRY_MAX_MS || 5 * 60_000));
const resultMaxAttempts = Math.max(1, Number(process.env.DIGITAL_HUMAN_WORKER_RESULT_MAX_ATTEMPTS || 8));
const deadLetterMaxRecoveries = Math.max(0, Number(process.env.DIGITAL_HUMAN_WORKER_DEAD_LETTER_MAX_RECOVERIES || 2));
const jobRetentionMs = Math.max(60 * 60_000, Number(process.env.DIGITAL_HUMAN_WORKER_JOB_RETENTION_MS || 24 * 60 * 60_000));
const inputDownloadTimeoutMs = Math.max(30_000, Number(process.env.DIGITAL_HUMAN_WORKER_INPUT_TIMEOUT_MS || 5 * 60_000));
const maximumInputRedirects = Math.max(0, Math.min(10, Number(process.env.DIGITAL_HUMAN_WORKER_MAX_INPUT_REDIRECTS || 5)));
const production = process.env.NODE_ENV === 'production';
const requestedValidationMode = String(process.env.DIGITAL_HUMAN_WORKER_FINAL_VALIDATION_MODE || 'strict').trim().toLowerCase();
const reviewModeAllowed = ['development', 'test'].includes(String(process.env.NODE_ENV || '').trim().toLowerCase());
const finalValidationMode: 'strict' | 'review' = reviewModeAllowed && requestedValidationMode === 'review' ? 'review' : 'strict';
const validatorWslDistro = String(process.env.DIGITAL_HUMAN_VALIDATOR_WSL_DISTRO || 'Ubuntu-22.04').trim();
const validatorWslUser = String(process.env.DIGITAL_HUMAN_VALIDATOR_WSL_USER || 'root').trim();
const validatorPython = String(process.env.DIGITAL_HUMAN_VALIDATOR_PYTHON || '/root/digital-human-lab/repos/MuseTalk/.venv/bin/python').trim();
const visualValidatorSetting = String(process.env.DIGITAL_HUMAN_VISUAL_VALIDATOR || path.join(rootDir, 'scripts', 'validate-digital-human.py')).trim();
const syncValidatorSetting = String(process.env.DIGITAL_HUMAN_SYNC_VALIDATOR || path.join(rootDir, 'scripts', 'validate-syncnet.py')).trim();
const mouthStabilizerSetting = String(process.env.DIGITAL_HUMAN_MOUTH_STABILIZER || path.join(rootDir, 'scripts', 'stabilize-digital-human-mouth.py')).trim();
const mouthStabilizerPath = path.resolve(mouthStabilizerSetting);
const syncnetDir = String(process.env.DIGITAL_HUMAN_SYNCNET_DIR || '/syncnet_python').trim();
const freezeNoise = String(process.env.DIGITAL_HUMAN_FREEZE_NOISE || '0.0001').trim();
const freezeDurationSeconds = Math.max(0.3, Number(process.env.DIGITAL_HUMAN_FREEZE_DURATION_SECONDS || 0.8));
const shortSegmentMaximumSeconds = 5.5;
const shortSegmentMinimumLipSyncScore = 3;
const allowedInputHosts = new Set(
  String(process.env.DIGITAL_HUMAN_WORKER_INPUT_HOSTS || '127.0.0.1,localhost')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
);
function configuredPorts(name: string, fallback: string): Set<number> {
  return new Set(String(process.env[name] || fallback).split(',').map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 65535));
}
const allowedRemoteInputPorts = configuredPorts('DIGITAL_HUMAN_WORKER_INPUT_PORTS', '443');
const allowedLoopbackInputPorts = configuredPorts(
  'DIGITAL_HUMAN_WORKER_LOOPBACK_INPUT_PORTS',
  '80,443,8688,8692,8788,8792',
);
const running = new Map<string, ChildProcess>();
const jobAbortControllers = new Map<string, AbortController>();
fs.mkdirSync(workRoot, { recursive: true });

function loadResultOutbox(): DigitalHumanResultOutboxRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(resultOutboxFile, 'utf8')) as DigitalHumanResultOutboxRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let resultOutbox = loadResultOutbox();

function persistResultOutbox(): void {
  const temporary = `${resultOutboxFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(resultOutbox, null, 2), 'utf8');
  fs.renameSync(temporary, resultOutboxFile);
}

function updateResultOutbox(id: string, next: DigitalHumanResultOutboxRecord): void {
  const index = resultOutbox.findIndex(item => item.id === id);
  if (index < 0) resultOutbox.push(next);
  else resultOutbox[index] = next;
  const active = resultOutbox.filter(item => item.phase === 'upload_pending' || item.phase === 'finalize_pending');
  const terminal = resultOutbox
    .filter(item => item.phase === 'acked' || item.phase === 'dead_letter')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 500);
  resultOutbox = [...active, ...terminal];
  persistResultOutbox();
}

function hasPendingResultDelivery(): boolean {
  return resultOutbox.some(item => item.phase === 'upload_pending' || item.phase === 'finalize_pending');
}

function loadJobs(): WorkerJob[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(jobsFile, 'utf8')) as WorkerJob[];
    return parsed.map(job => ['queued', 'processing', 'quality_check'].includes(job.status)
      ? { ...job, status: 'failed', stage: 'worker_restart', errorCode: 'WORKER_RESTARTED', error: '本地数字人 Worker 已重启，请重新提交任务。' }
      : job);
  } catch {
    return [];
  }
}

let jobs = loadJobs();
persistJobs();
persistResultOutbox();

function persistJobs(): void {
  const temporary = `${jobsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(jobs, null, 2), 'utf8');
  fs.renameSync(temporary, jobsFile);
}

function updateJob(id: string, patch: Partial<WorkerJob>): WorkerJob {
  const index = jobs.findIndex(job => job.id === id);
  if (index < 0) throw new Error('worker job not found');
  jobs[index] = { ...jobs[index]!, ...patch, updatedAt: new Date().toISOString() };
  persistJobs();
  const updated = jobs[index]!;
  if (hubUrl && updated.externalJobId && updated.leaseId && ['processing', 'quality_check'].includes(updated.status)) {
    void reportHubProgress(updated).catch(() => undefined);
  }
  return updated;
}

function cancelLocalJob(id: string, stage: 'cancelled' | 'cancelled_by_hub' | 'worker_lease_lost'): void {
  const job = jobs.find(item => item.id === id);
  if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return;
  jobAbortControllers.get(id)?.abort();
  running.get(id)?.kill();
  updateJob(id, { status: 'cancelled', stage, error: undefined, errorCode: undefined });
}

function throwIfJobCancelled(id: string): void {
  if (jobs.find(job => job.id === id)?.status === 'cancelled') throw new Error('worker job cancelled');
}

async function applyHubControl(response: globalThis.Response, localJobId: string): Promise<void> {
  if (response.status === 404 || response.status === 409) {
    cancelLocalJob(localJobId, 'worker_lease_lost');
    return;
  }
  if (!response.ok) return;
  const payload = await response.json().catch(() => ({})) as { cancelRequested?: boolean };
  if (payload.cancelRequested === true) cancelLocalJob(localJobId, 'cancelled_by_hub');
}

async function reportHubProgress(job: WorkerJob): Promise<void> {
  if (!job.externalJobId || !job.leaseId) return;
  const response = await hubFetch(`/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(job.externalJobId)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ workerId, leaseId: job.leaseId, status: job.status, stage: job.stage, progress: job.progress }),
  });
  await applyHubControl(response, job.id);
}

async function hubFetch(route: string, init?: RequestInit): Promise<globalThis.Response> {
  if (!hubUrl || !workerKey) throw new Error('DIGITAL_HUMAN_HUB_URL / DIGITAL_HUMAN_WORKER_KEY 未配置');
  return fetch(`${hubUrl}${route}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerKey}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(120_000),
  });
}

class HubTransferError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hubTransferError(response: globalThis.Response, action: string): Promise<HubTransferError> {
  const payload = await response.text().catch(() => '');
  return new HubTransferError(`${action} failed (${response.status})${payload ? `: ${payload.slice(0, 1_000)}` : ''}`, response.status);
}

async function uploadCompletedResult(record: DigitalHumanResultOutboxRecord): Promise<void> {
  if (digitalHumanDeliveryKind(record) !== 'completed_result' || !record.outputPath || !record.sha256 || !record.sizeBytes) throw new Error('completed result outbox record is incomplete');
  if (!fs.existsSync(record.outputPath)) throw new Error(`result file missing: ${record.outputPath}`);
  const actualSize = fs.statSync(record.outputPath).size;
  if (!actualSize || actualSize !== record.sizeBytes || actualSize > maxInputBytes) throw new Error('result file changed after outbox enqueue');
  if (await sha256File(record.outputPath) !== record.sha256) throw new Error('result SHA256 changed after outbox enqueue');
  const stream = fs.createReadStream(record.outputPath);
  try {
    const response = await fetch(
      `${hubUrl}/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(record.remoteJobId)}/result-upload`,
      {
        method: 'PUT',
        body: stream as any,
        duplex: 'half',
        headers: {
          Authorization: `Bearer ${workerKey}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(record.sizeBytes),
          'X-Worker-Id': record.workerId,
          'X-Worker-Lease-Id': record.leaseId,
          'X-Content-Sha256': record.sha256,
        },
        signal: AbortSignal.timeout(resultUploadTimeoutMs),
      } as RequestInit & { duplex: 'half' },
    );
    if (!response.ok) throw await hubTransferError(response, 'result upload');
    const payload = await response.json().catch(() => ({})) as { sha256?: string };
    if (String(payload.sha256 || '').toLowerCase() !== record.sha256) throw new Error('hub acknowledged an unexpected result SHA256');
  } finally {
    stream.destroy();
  }
}

async function enqueueCompletedResult(job: WorkerJob, outputPath: string): Promise<void> {
  if (!job.externalJobId || !job.leaseId) throw new Error('completed pull job is missing remote lease metadata');
  if (!fs.existsSync(outputPath)) throw new Error('completed result file is missing');
  const sizeBytes = fs.statSync(outputPath).size;
  if (!sizeBytes || sizeBytes > maxInputBytes) throw new Error('completed result size is invalid');
  const resultSha256 = await sha256File(outputPath);
  const existing = resultOutbox.find(item => digitalHumanDeliveryKind(item) === 'completed_result' && item.remoteJobId === job.externalJobId && item.leaseId === job.leaseId && item.sha256 === resultSha256);
  if (existing) {
    if (existing.phase === 'dead_letter') updateResultOutbox(existing.id, reviveDigitalHumanDeadLetter(existing, Date.now(), deadLetterMaxRecoveries));
    return;
  }
  const now = new Date().toISOString();
  const record: DigitalHumanResultOutboxRecord = {
    id: randomUUID(), remoteJobId: job.externalJobId, localJobId: job.id,
    workerId, leaseId: job.leaseId, outputPath, sha256: resultSha256, sizeBytes,
    quality: job.quality ? { ...job.quality } : undefined,
    phase: 'upload_pending', attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
  };
  updateResultOutbox(record.id, record);
}

function enqueueTerminalNotification(job: WorkerJob, status: 'failed' | 'cancelled', errorCode?: string, error?: string): void {
  if (!job.externalJobId || !job.leaseId) return;
  const existing = resultOutbox.find(item => digitalHumanDeliveryKind(item) === 'terminal_notification'
    && item.remoteJobId === job.externalJobId && item.leaseId === job.leaseId && item.terminalStatus === status);
  if (existing) {
    if (existing.phase === 'dead_letter') updateResultOutbox(existing.id, reviveDigitalHumanDeadLetter(existing, Date.now(), deadLetterMaxRecoveries));
    return;
  }
  const now = new Date().toISOString();
  const record: DigitalHumanResultOutboxRecord = {
    id: randomUUID(), deliveryKind: 'terminal_notification', remoteJobId: job.externalJobId,
    localJobId: job.id, workerId, leaseId: job.leaseId, terminalStatus: status,
    errorCode, error, phase: 'finalize_pending', attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
  };
  updateResultOutbox(record.id, record);
}

let resultOutboxFlushing = false;
let resultRecoveryComplete = false;

async function recoverCompletedResultOutbox(): Promise<void> {
  try {
    for (const job of jobs.filter(item => ['completed', 'failed', 'cancelled'].includes(item.status) && item.externalJobId && item.leaseId)) {
      if (job.status === 'completed') {
        const outputPath = path.join(workRoot, job.id, 'result.mp4');
        if (fs.existsSync(outputPath)) await enqueueCompletedResult(job, outputPath);
      } else enqueueTerminalNotification(job, job.status as 'failed' | 'cancelled', job.errorCode, job.error);
    }
  } finally {
    resultRecoveryComplete = true;
  }
}

async function flushResultOutbox(): Promise<void> {
  if (!hubUrl || !workerKey || resultOutboxFlushing) return;
  const record = dueDigitalHumanResultOutbox(resultOutbox)[0];
  if (!record) return;
  resultOutboxFlushing = true;
  try {
    let current = resultOutbox.find(item => item.id === record.id) || record;
    if (digitalHumanDeliveryKind(current) === 'completed_result' && current.phase === 'upload_pending') {
      await heartbeatHubJob(current.remoteJobId, current.leaseId, current.localJobId);
      let transferHeartbeatInFlight = false;
      const transferHeartbeatTimer = setInterval(() => {
        if (transferHeartbeatInFlight) return;
        transferHeartbeatInFlight = true;
        void heartbeatHubJob(current.remoteJobId, current.leaseId, current.localJobId)
          .catch(error => console.warn('[digital-human-worker] transfer heartbeat:', error instanceof Error ? error.message : error))
          .finally(() => { transferHeartbeatInFlight = false; });
      }, Math.max(5_000, Number(process.env.DIGITAL_HUMAN_WORKER_HEARTBEAT_MS || 30_000)));
      transferHeartbeatTimer.unref?.();
      try {
        await uploadCompletedResult(current);
      } finally {
        clearInterval(transferHeartbeatTimer);
      }
      current = markDigitalHumanResultUploaded(current);
      updateResultOutbox(current.id, current);
    }
    await heartbeatHubJob(current.remoteJobId, current.leaseId, current.localJobId);
    const completed = digitalHumanDeliveryKind(current) === 'completed_result';
    const resultBody = completed ? {
      workerId: current.workerId,
      leaseId: current.leaseId,
      status: 'completed',
      sha256: current.sha256,
      quality: current.quality,
    } : {
      workerId: current.workerId,
      leaseId: current.leaseId,
      status: current.terminalStatus,
      errorCode: current.errorCode,
      error: current.error,
    };
    const response = await hubFetch(`/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(current.remoteJobId)}/result`, {
      method: 'POST',
      body: JSON.stringify(resultBody),
    });
    if (!response.ok) throw await hubTransferError(response, 'result finalize');
    updateResultOutbox(current.id, acknowledgeDigitalHumanResult(current));
  } catch (error) {
    const current = resultOutbox.find(item => item.id === record.id) || record;
    if (error instanceof HubTransferError && (error.status === 404 || error.status === 409)) {
      const now = new Date().toISOString();
      updateResultOutbox(current.id, {
        ...current, phase: 'dead_letter', lastError: error.message,
        updatedAt: now, nextAttemptAt: now,
      });
    } else {
      updateResultOutbox(current.id, retryDigitalHumanResult(current, error, Date.now(), resultRetryBaseMs, resultRetryMaxMs, resultMaxAttempts));
    }
    console.warn('[digital-human-worker] result delivery:', error instanceof Error ? error.message : error);
  } finally {
    resultOutboxFlushing = false;
  }
}

const outboxHeartbeatInFlight = new Set<string>();
async function heartbeatPendingOutboxLeases(): Promise<void> {
  if (!hubUrl || !workerKey) return;
  await Promise.all(resultOutbox.filter(item => item.phase === 'upload_pending' || item.phase === 'finalize_pending').map(async record => {
    if (outboxHeartbeatInFlight.has(record.id)) return;
    outboxHeartbeatInFlight.add(record.id);
    try { await heartbeatHubJob(record.remoteJobId, record.leaseId, record.localJobId); }
    catch (error) { console.warn('[digital-human-worker] pending delivery heartbeat:', error instanceof Error ? error.message : error); }
    finally { outboxHeartbeatInFlight.delete(record.id); }
  }));
}

function cleanupExpiredJobArtifacts(nowMs = Date.now()): void {
  let changed = false;
  const root = path.resolve(workRoot);
  for (const job of jobs) {
    if (job.artifactsCleanedAt || !['completed', 'failed', 'cancelled'].includes(job.status)) continue;
    let retainedSince = Date.parse(job.updatedAt);
    if (job.externalJobId && job.leaseId) {
      const deliveries = resultOutbox.filter(item => item.remoteJobId === job.externalJobId && item.leaseId === job.leaseId);
      const acknowledged = deliveries.filter(item => item.phase === 'acked' && item.acknowledgedAt).sort((a, b) => String(b.acknowledgedAt).localeCompare(String(a.acknowledgedAt)))[0];
      if (!acknowledged?.acknowledgedAt) continue;
      retainedSince = Date.parse(acknowledged.acknowledgedAt);
    }
    if (!Number.isFinite(retainedSince) || nowMs - retainedSince < jobRetentionMs) continue;
    const directory = path.resolve(workRoot, job.id);
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(directory) !== root) continue;
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
    job.artifactsCleanedAt = new Date(nowMs).toISOString();
    changed = true;
  }
  if (changed) persistJobs();
}

function authorized(req: Request, res: ExpressResponse, next: NextFunction): void {
  if (!apiKey) { next(); return; }
  if (req.headers.authorization !== `Bearer ${apiKey}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function safeInputUrl(value: unknown): URL {
  return validateDigitalHumanWorkerInputUrl(value, allowedInputHosts, { allowedRemotePorts: allowedRemoteInputPorts, allowedLoopbackPorts: allowedLoopbackInputPorts });
}

async function fetchInputWithValidatedRedirects(initialUrl: URL, signal: AbortSignal): Promise<globalThis.Response> {
  let currentUrl = safeInputUrl(initialUrl.toString());
  for (let redirectCount = 0; redirectCount <= maximumInputRedirects; redirectCount += 1) {
    await validateResolvedDigitalHumanInputUrl(currentUrl);
    const response = await fetch(currentUrl, { signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error('input redirect is missing Location');
    if (redirectCount >= maximumInputRedirects) throw new Error('input redirect limit exceeded');
    // Re-validate protocol, credentials and allowlist on every redirect hop.
    currentUrl = safeInputUrl(new URL(location, currentUrl).toString());
  }
  throw new Error('input redirect limit exceeded');
}

async function download(url: URL, destination: string, jobId?: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), inputDownloadTimeoutMs);
  const jobSignal = jobId ? jobAbortControllers.get(jobId)?.signal : undefined;
  const abortForJob = () => controller.abort();
  jobSignal?.addEventListener('abort', abortForJob, { once: true });
  const temporary = `${destination}.${randomUUID()}.part`;
  try {
    const response = await fetchInputWithValidatedRedirects(url, controller.signal);
    if (!response.ok) throw new Error(`input download failed (${response.status})`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxInputBytes) throw new Error('input exceeds 110 MB');
    if (!response.body) throw new Error('input download returned an empty body');
    const handle = fs.openSync(temporary, 'wx');
    let received = 0;
    try {
      for await (const raw of response.body as any) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        received += chunk.length;
        if (received > maxInputBytes) throw new Error('input exceeds 110 MB');
        fs.writeSync(handle, chunk);
      }
    } finally {
      fs.closeSync(handle);
    }
    if (!received || (declared > 0 && received !== declared)) throw new Error('input size is invalid');
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    clearTimeout(timeout);
    jobSignal?.removeEventListener('abort', abortForJob);
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcessCapture(file: string, args: string[], jobId?: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: rootDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (jobId) running.set(jobId, child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout = `${stdout}${String(chunk)}`.slice(-1_000_000); });
    child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-8000); });
    child.on('error', reject);
    child.on('close', code => {
      if (jobId) running.delete(jobId);
      resolve({ code, stdout, stderr });
    });
  });
}

let cachedWorkerHealth: { expiresAt: number; report: DigitalHumanWorkerHealthReport } | undefined;

async function collectWorkerHealthReport(): Promise<DigitalHumanWorkerHealthReport> {
  if (cachedWorkerHealth && cachedWorkerHealth.expiresAt > Date.now()) return cachedWorkerHealth.report;
  let gpu: DigitalHumanWorkerHealthReport['gpu'] = { available: false };
  try {
    const probe = await runProcessCapture('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits']);
    const first = probe.code === 0 ? probe.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) : undefined;
    const [name, total, free] = first?.split(',').map(value => value.trim()) || [];
    const totalVramMb = Number(total);
    const freeVramMb = Number(free);
    gpu = {
      available: Boolean(first && Number.isFinite(totalVramMb) && Number.isFinite(freeVramMb)),
      ...(name ? { name: name.slice(0, 160) } : {}),
      ...(Number.isFinite(totalVramMb) ? { totalVramMb } : {}),
      ...(Number.isFinite(freeVramMb) ? { freeVramMb } : {}),
    };
  } catch { /* fail closed in the server preflight */ }
  let freeBytes: number | undefined;
  try {
    const stats = fs.statfsSync(workRoot);
    freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch { /* fail closed in the server preflight */ }
  const observedMouthStabilizerSha256 = fs.existsSync(mouthStabilizerPath) ? sha256(mouthStabilizerPath) : '';
  const mouthStabilizerConfigured = observedMouthStabilizerSha256 === DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256;
  const report: DigitalHumanWorkerHealthReport = {
    schemaVersion: DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    runnerConfigured: Boolean(runner && fs.existsSync(runner)),
    mouthStabilizerConfigured,
    mouthStabilizerAlgorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
    mouthStabilizerScriptSha256: observedMouthStabilizerSha256 || '0'.repeat(64),
    gpu,
    disk: { ...(Number.isFinite(freeBytes) ? { freeBytes } : {}) },
    validatorConfigured: Boolean(ffmpegStatic && fs.existsSync(visualValidatorSetting) && fs.existsSync(syncValidatorSetting)),
    validatorVersion: DIGITAL_HUMAN_FINAL_VALIDATOR_VERSION,
    gateVersion: DIGITAL_HUMAN_PERFORMANCE_SHOT_GATE_VERSION,
    reportedAt: new Date().toISOString(),
  };
  cachedWorkerHealth = { expiresAt: Date.now() + 15_000, report };
  return report;
}

async function runProcess(file: string, args: string[], jobId?: string): Promise<void> {
  const result = await runProcessCapture(file, args, jobId);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `${path.basename(file)} exited with code ${result.code}`);
}

function toWslPath(value: string): string {
  if (!/^[a-z]:[\\/]/i.test(value)) return value.replace(/\\/g, '/');
  const resolved = path.resolve(value);
  return `/mnt/${resolved[0]!.toLowerCase()}/${resolved.slice(3).replace(/\\/g, '/')}`;
}

function parseJsonOutput(output: string, label: string): Record<string, unknown> {
  const trimmed = String(output || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`${label}未输出JSON报告`);
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}报告结构无效`);
  return parsed as Record<string, unknown>;
}

async function runWsl(command: string, args: string[], jobId?: string): Promise<ProcessResult> {
  return runProcessCapture('wsl.exe', ['-d', validatorWslDistro, '-u', validatorWslUser, '--', command, ...args], jobId);
}

async function runJsonValidator(
  label: string,
  scriptSetting: string,
  args: string[],
  reportPath: string,
  jobId?: string,
): Promise<Record<string, unknown>> {
  const scriptPath = toWslPath(scriptSetting);
  const result = await runWsl(validatorPython, [scriptPath, ...args], jobId);
  let report: Record<string, unknown>;
  try {
    report = parseJsonOutput(result.stdout, label);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}${result.stderr.trim() ? `: ${result.stderr.trim().slice(-1200)}` : ''}`);
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  if (result.code !== 0 && result.code !== 2) {
    throw new Error(`${label}执行失败 (${result.code}): ${result.stderr.trim().slice(-1200)}`);
  }
  return report;
}

function failedValidatorReport(message: string): Record<string, unknown> {
  return { passed: false, failures: [message] };
}

async function validateOutput(
  avatarPath: string,
  outputPath: string,
  options: { minLipSyncScore?: number; validationScope?: 'full_video' | 'segment' } = {},
  jobId?: string,
): Promise<WorkerQuality> {
  if (jobId) throwIfJobCancelled(jobId);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) throw new Error('数字人输出为空');
  if (sha256(avatarPath) === sha256(outputPath)) throw new Error('数字人服务返回了原人物视频，已拒绝回流');
  if (!ffmpegStatic) throw new Error('ffmpeg unavailable for output validation');
  // These decode checks target the final composed MP4, not any intermediate
  // MuseTalk segment or copied sidecar report.
  await runProcess(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-frames:v', '1', '-f', 'null', '-'], jobId);
  await runProcess(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-map', '0:a:0', '-t', '1', '-f', 'null', '-'], jobId);
  const validationDir = path.join(path.dirname(outputPath), 'validation');
  fs.mkdirSync(validationDir, { recursive: true });
  const finalAudioPath = path.join(validationDir, 'final-audio.wav');
  await runProcess(ffmpegStatic, ['-y', '-hide_banner', '-loglevel', 'error', '-i', outputPath, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', finalAudioPath], jobId);

  let probe: Record<string, unknown> = {};
  let visual: Record<string, unknown> = {};
  let syncnet: Record<string, unknown> = {};
  let freezeLog = '';
  let freezeValidated = false;
  try {
    const probeResult = await runWsl('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json', toWslPath(outputPath),
    ], jobId);
    if (probeResult.code !== 0) throw new Error(probeResult.stderr.trim() || `ffprobe exited with code ${probeResult.code}`);
    probe = parseJsonOutput(probeResult.stdout, 'ffprobe');
    fs.writeFileSync(`${outputPath}.ffprobe.json`, JSON.stringify(probe, null, 2), 'utf8');
  } catch (error) {
    probe = { error: error instanceof Error ? error.message : String(error) };
  }

  try {
    visual = await runJsonValidator(
      'MediaPipe视觉门禁', visualValidatorSetting,
      ['--video', toWslPath(outputPath), '--audio', toWslPath(finalAudioPath), '--enforce'],
      `${outputPath}.visual-quality.json`, jobId,
    );
  } catch (error) {
    visual = failedValidatorReport(error instanceof Error ? error.message : String(error));
    fs.writeFileSync(`${outputPath}.visual-quality.json`, JSON.stringify(visual, null, 2), 'utf8');
  }

  try {
    syncnet = await runJsonValidator(
      'SyncNet门禁', syncValidatorSetting,
      [
        '--video', toWslPath(outputPath),
        '--work-dir', toWslPath(path.join(validationDir, 'syncnet')),
        '--syncnet-dir', syncnetDir,
        '--min-confidence', String(options.minLipSyncScore ?? 3),
        '--max-offset', '3',
      ],
      `${outputPath}.syncnet-quality.json`, jobId,
    );
  } catch (error) {
    syncnet = failedValidatorReport(error instanceof Error ? error.message : String(error));
    fs.writeFileSync(`${outputPath}.syncnet-quality.json`, JSON.stringify(syncnet, null, 2), 'utf8');
  }

  try {
    const freezeResult = await runProcessCapture(ffmpegStatic, [
      '-hide_banner', '-nostats', '-i', outputPath,
      '-vf', `freezedetect=n=${freezeNoise}:d=${freezeDurationSeconds}`, '-an', '-f', 'null', '-',
    ], jobId);
    if (freezeResult.code !== 0) throw new Error(freezeResult.stderr.trim() || `freezedetect exited with code ${freezeResult.code}`);
    freezeLog = `${freezeResult.stdout}\n${freezeResult.stderr}`;
    freezeValidated = true;
    fs.writeFileSync(`${outputPath}.freeze-quality.json`, JSON.stringify({
      passed: !/freeze_start\s*:/.test(freezeLog),
      detector: 'ffmpeg-freezedetect', noise: freezeNoise, durationSeconds: freezeDurationSeconds,
      freezeSegments: (freezeLog.match(/freeze_start\s*:/g) || []).length,
    }, null, 2), 'utf8');
  } catch (error) {
    freezeLog = error instanceof Error ? error.message : String(error);
  }

  const quality: DigitalHumanFinalQualityReport = buildDigitalHumanFinalQualityReport({
    probe, visual, syncnet, freezeLog, freezeValidated,
    outputSha256: await sha256File(outputPath),
    minLipSyncScore: options.minLipSyncScore,
    validationScope: options.validationScope,
  });
  quality.notes.push(`验证策略：${finalValidationMode}${production ? '（生产强制 fail-closed）' : ''}`);
  fs.writeFileSync(`${outputPath}.final-quality.json`, JSON.stringify(quality, null, 2), 'utf8');
  fs.rmSync(validationDir, { recursive: true, force: true });
  if (!quality.passed && finalValidationMode === 'strict') {
    throw new FinalQualityRejectedError(quality);
  }
  return quality;
}

function validatePerformanceInput(input: WorkerInput): ExecutablePerformancePlan | undefined {
  if (!input.performancePlan) {
    if (input.performancePlanVersion) throw new Error('数字人表演计划内容缺失');
    return undefined;
  }
  if (input.performancePlanVersion !== 'performance-v1') throw new Error('不支持的数字人表演计划版本');
  const plan = parseExecutablePerformancePlan(input.performancePlan);
  buildPerformanceExecutionRecipe({
    plan,
    motionClipIds: (input.motionClips || []).map(item => item.id),
  });
  return plan;
}

function validateAllInputUrls(input: WorkerInput): { avatar: URL; audio: URL; motions: URL[] } {
  return {
    avatar: safeInputUrl(input.avatarVideoUrl),
    audio: safeInputUrl(input.audioUrl),
    motions: (input.motionClips || []).map(motion => safeInputUrl(motion.videoUrl)),
  };
}

async function validateDownloadedVideo(file: string, jobId: string): Promise<void> {
  if (!ffmpegStatic) throw new Error('ffmpeg unavailable for input validation');
  await runProcess(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-',
  ], jobId);
}

async function validateDownloadedAudio(file: string, jobId: string): Promise<void> {
  if (!ffmpegStatic) throw new Error('ffmpeg unavailable for input validation');
  await runProcess(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-map', '0:a:0', '-t', '1', '-f', 'null', '-',
  ], jobId);
}

async function prefetchAndValidateInputs(
  jobId: string,
  jobDir: string,
  input: WorkerInput,
  avatarPath: string,
  sourceAudioPath: string,
): Promise<string[]> {
  // Resolve and validate every URL before starting I/O. This also guarantees
  // an invalid late motion clip cannot waste an otherwise successful download.
  const urls = validateAllInputUrls(input);
  const motionPaths: string[] = [];
  const uniqueMotionDownloads = new Map<string, { url: URL; path: string }>();
  urls.motions.forEach((url, index) => {
    const key = url.toString();
    let cached = uniqueMotionDownloads.get(key);
    if (!cached) {
      cached = { url, path: path.join(jobDir, `motion-${uniqueMotionDownloads.size + 1}.mp4`) };
      uniqueMotionDownloads.set(key, cached);
    }
    motionPaths[index] = cached.path;
  });

  // All signed motion URLs are consumed before the first GPU inference. A
  // long multi-beat render therefore cannot lose a later clip to URL expiry.
  await Promise.all([
    download(urls.avatar, avatarPath, jobId),
    download(urls.audio, sourceAudioPath, jobId),
    ...[...uniqueMotionDownloads.values()].map(item => download(item.url, item.path, jobId)),
  ]);
  throwIfJobCancelled(jobId);
  updateJob(jobId, { stage: 'validate_inputs', progress: 18 });
  await validateDownloadedVideo(avatarPath, jobId);
  await validateDownloadedAudio(sourceAudioPath, jobId);
  for (const item of uniqueMotionDownloads.values()) await validateDownloadedVideo(item.path, jobId);

  const inputManifest = {
    validatorVersion: 'input-prefetch-v1',
    completedAt: new Date().toISOString(),
    avatar: { sizeBytes: fs.statSync(avatarPath).size, sha256: await sha256File(avatarPath) },
    audio: { sizeBytes: fs.statSync(sourceAudioPath).size, sha256: await sha256File(sourceAudioPath) },
    motions: await Promise.all(motionPaths.map(async (file, index) => ({
      index, id: input.motionClips?.[index]?.id,
      sizeBytes: fs.statSync(file).size, sha256: await sha256File(file),
    }))),
  };
  fs.writeFileSync(path.join(jobDir, 'input-manifest.json'), JSON.stringify(inputManifest, null, 2), 'utf8');
  return motionPaths;
}

async function runMuseTalkSegment(
  jobId: string,
  profile: MuseTalkRenderProfile,
  sourcePath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  await runProcess('pwsh.exe', [
    '-NoProfile', '-File', runner,
    '-Video', sourcePath,
    '-Audio', audioPath,
    '-Output', outputPath,
    '-SegmentMode',
    ...museTalkRunnerProfileArguments(profile),
  ], jobId);
}

async function renderPerformanceSequence(
  jobId: string,
  attemptDir: string,
  plan: ExecutablePerformancePlan,
  input: WorkerInput,
  motionSources: string[],
  audioPath: string,
  rawOutputPath: string,
  profile: MuseTalkRenderProfile,
  performanceRecipe: PerformanceExecutionRecipe,
): Promise<void> {
  const beats = plan.beats;
  const motionClips = input.motionClips || [];
  if (beats.length < 2 || motionClips.length < beats.length) throw new Error('多动作任务缺少逐节拍人物动作素材');
  if (!performanceRecipe.multiBeatIntermediateVideo.applied
    || performanceRecipe.multiBeatIntermediateVideo.width !== DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH
    || performanceRecipe.multiBeatIntermediateVideo.height !== DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT) {
    throw new Error(`多动作数字人中间视频配方必须保持${DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_WIDTH}x${DIGITAL_HUMAN_MULTI_BEAT_INTERMEDIATE_HEIGHT}`);
  }
  const segmentOutputs: string[] = [];
  for (let index = 0; index < beats.length; index += 1) {
    throwIfJobCancelled(jobId);
    const beat = beats[index]!;
    const sourcePath = motionSources[index];
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`节拍${index + 1}缺少已预下载的动作素材`);
    const startSeconds = Number(beat.startMs) / 1000;
    const endSeconds = Number(beat.endMs) / 1000;
    const beatAudio = path.join(attemptDir, `beat-${index + 1}.wav`);
    const beatRaw = path.join(attemptDir, `beat-${index + 1}.raw.mp4`);
    const beatNormalized = path.join(attemptDir, `beat-${index + 1}.mp4`);
    const currentProgress = jobs.find(job => job.id === jobId)?.progress || 0;
    updateJob(jobId, {
      stage: `lip_sync_${profile.id}_${index + 1}_of_${beats.length}`,
      progress: Math.max(currentProgress, 24 + Math.round(index / beats.length * 52)),
    });
    await runProcess(ffmpegStatic!, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(startSeconds), '-to', String(endSeconds), '-i', audioPath, '-vn', '-ar', '16000', '-ac', '1', beatAudio], jobId);
    await runMuseTalkSegment(jobId, profile, sourcePath, beatAudio, beatRaw);
    await runProcess(ffmpegStatic!, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', beatRaw,
      '-vf', performanceRecipe.multiBeatIntermediateVideo.filter,
      '-af', 'aresample=48000', '-t', String(Math.max(0.2, endSeconds - startSeconds)),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', beatNormalized,
    ], jobId);
    segmentOutputs.push(beatNormalized);
  }
  throwIfJobCancelled(jobId);
  const concatInputs = segmentOutputs.flatMap(file => ['-i', file]);
  const videoInputs = segmentOutputs.map((_, index) => `[${index}:v:0]`).join('');
  const audioInputs = segmentOutputs.map((_, index) => `[${index}:a:0]`).join('');
  await runProcess(ffmpegStatic!, [
    '-y', '-hide_banner', '-loglevel', 'error', ...concatInputs,
    '-filter_complex', `${videoInputs}concat=n=${segmentOutputs.length}:v=1:a=0[v];${audioInputs}concat=n=${segmentOutputs.length}:v=0:a=1[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', rawOutputPath,
  ], jobId);
}

async function verifyPerformanceOutputMetadata(
  outputPath: string,
  expectedComment: string,
  jobId: string,
): Promise<boolean> {
  const result = await runWsl('ffprobe', [
    '-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'json', toWslPath(outputPath),
  ], jobId);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `ffprobe exited with code ${result.code}`);
  const report = parseJsonOutput(result.stdout, '表演执行元数据验证');
  const format = report.format && typeof report.format === 'object' && !Array.isArray(report.format)
    ? report.format as Record<string, unknown>
    : {};
  const tags = format.tags && typeof format.tags === 'object' && !Array.isArray(format.tags)
    ? format.tags as Record<string, unknown>
    : {};
  return String(tags.comment || '') === expectedComment;
}

async function probeMediaDurationSeconds(file: string, jobId: string): Promise<number> {
  const result = await runWsl('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', toWslPath(file),
  ], jobId);
  const duration = Number(result.stdout.trim());
  if (result.code !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`无法读取表演素材时长: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return duration;
}

interface MuseTalkProfileAttemptPaths {
  directory: string;
  rawOutput: string;
  output: string;
}

interface MuseTalkProfileRenderResult {
  paths: MuseTalkProfileAttemptPaths;
  quality: WorkerQuality;
  performanceReceipt?: PerformanceExecutionReceipt;
  performanceGate?: PerformanceShotGateResult;
}

function jobArtifactPath(jobDir: string, file: string): string {
  const relative = path.relative(path.resolve(jobDir), path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('数字人任务证据路径越界');
  return relative.replace(/\\/g, '/');
}

function museTalkProfileAttemptPaths(
  jobDir: string,
  attempt: number,
  profile: MuseTalkRenderProfile,
): MuseTalkProfileAttemptPaths {
  const directory = path.join(jobDir, 'profile-attempts', `${String(attempt).padStart(2, '0')}-${profile.id}`);
  fs.mkdirSync(directory, { recursive: true });
  return {
    directory,
    rawOutput: path.join(directory, 'result.raw.mp4'),
    output: path.join(directory, 'result.mp4'),
  };
}

function profileAttemptSummaries(attempts: MuseTalkProfileAttemptArtifact[]): MuseTalkProfileAttemptSummary[] {
  return attempts
    .filter((attempt): attempt is MuseTalkProfileAttemptArtifact & { outcome: MuseTalkProfileAttemptOutcome } => attempt.outcome !== 'running')
    .map(attempt => ({ profileId: attempt.profile.id, outcome: attempt.outcome, failure: attempt.failure }));
}

function persistMuseTalkProfileManifest(
  jobDir: string,
  attempts: MuseTalkProfileAttemptArtifact[],
  selectedProfileId?: MuseTalkProfileId,
  selectedOutputSha256?: string,
): void {
  const manifest: MuseTalkProfileAttemptManifest = {
    version: 'musetalk-profile-attempts-v2',
    policyVersion: MUSE_TALK_PROFILE_POLICY_VERSION,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    finalSharpenFilter: DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
    temporalFinalSharpenFilter: DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER,
    temporalStabilityFilter: DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER,
    renderTreatmentAuditVersion: DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION,
    retryTrigger: 'final_quality_rejected_only',
    temporalRetryTrigger: DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
    mouthLocalRetryTriggers: [DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE, DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE],
    mouthStabilizerScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
    thresholds: {
      shortSegmentMaximumSeconds,
      shortSegmentMinimumLipSyncScore,
      absoluteAvOffsetFramesMaximum: 3,
    },
    attempts,
    selectedProfileId,
    selectedOutputSha256,
    updatedAt: new Date().toISOString(),
  };
  const destination = path.join(jobDir, 'musetalk-profile-attempts.json');
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(temporary, destination);
}

function annotateDigitalHumanPipelineQuality(
  quality: WorkerQuality,
  treatmentId: DigitalHumanRenderTreatmentId,
): void {
  quality.pipelineVersion = DIGITAL_HUMAN_PIPELINE_VERSION;
  const finalFilter = digitalHumanFinalVideoFilter(treatmentId);
  const note = `数字人处理管线：${DIGITAL_HUMAN_PIPELINE_VERSION}；最终处理档位：${treatmentId}；时序/清晰度处理：${finalFilter}（仅应用一次）。`;
  if (!quality.notes.includes(note)) quality.notes.push(note);
}

function applyPerformanceShotGate(
  outputPath: string,
  performancePlan: ExecutablePerformancePlan | undefined,
  input: WorkerInput,
  performanceReceipt: PerformanceExecutionReceipt | undefined,
  quality: WorkerQuality,
): PerformanceShotGateResult | undefined {
  if (!performancePlan) return undefined;
  const performanceGate = digitalHumanPerformanceShotGate({
    plan: performancePlan,
    motionClipIds: (input.motionClips || []).map(item => item.id),
    receipt: performanceReceipt,
    baseQualityPassed: quality.passed,
  });
  fs.writeFileSync(`${outputPath}.performance-quality.json`, JSON.stringify(performanceGate, null, 2), 'utf8');
  quality.gateVersion = `${quality.validatorVersion || 'worker-final'}+${performanceGate.gateVersion}`;
  quality.gateFailures = performanceGate.failures;
  quality.performanceExecutionVersion = performanceReceipt?.version;
  quality.performancePlanFingerprint = performanceReceipt?.planFingerprint;
  quality.notes.push(...performanceGate.notes);
  fs.writeFileSync(`${outputPath}.final-quality.json`, JSON.stringify(quality, null, 2), 'utf8');
  return performanceGate;
}

function renderTreatmentOutputPath(
  paths: MuseTalkProfileAttemptPaths,
  treatmentId: DigitalHumanRenderTreatmentId,
): string {
  switch (treatmentId) {
    case 'baseline_unsharp': return paths.output;
    case 'mouth_jump_tmix2_equal_unsharp': return path.join(paths.directory, 'result.tmix-2-equal.mp4');
    case 'mouth_jump_mouth_local_v1': return path.join(paths.directory, 'result.mouth-local-v1.mp4');
  }
}

interface MouthLocalProcessorResult {
  inputPath: string;
  auditPath: string;
  evidence: DigitalHumanMouthStabilizationEvidence;
  profileId: DigitalHumanMouthStabilizationProfileId;
}

function selectMouthStabilizationProfile(failureCodes: string[]): DigitalHumanMouthStabilizationProfileId {
  const codes = new Set(failureCodes.map(String));
  if (!codes.has(DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE)
    && !codes.has(DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE)) {
    throw new Error('嘴部局部稳定器缺少类型化触发证据');
  }
  // If the preceding full-frame treatment also lost sharpness, the balanced
  // three-frame recipe retains more current-phoneme detail. Jump-only failures
  // have enough sharpness headroom for the stronger five-frame recipe.
  return codes.has(DIGITAL_HUMAN_MOUTH_SHARPNESS_FAILURE_CODE) ? 'balanced' : 'strong';
}

async function runMouthLocalProcessor(input: {
  jobId: string;
  paths: MuseTalkProfileAttemptPaths;
  triggerFailureCodes: string[];
  profileFailureCodes?: string[];
}): Promise<MouthLocalProcessorResult> {
  const { jobId, paths, triggerFailureCodes, profileFailureCodes = triggerFailureCodes } = input;
  const profileId = selectMouthStabilizationProfile(profileFailureCodes);
  const parameters = DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES[profileId];
  if (!fs.existsSync(mouthStabilizerPath)) throw new Error('数字人嘴部局部稳定器脚本不存在');
  const scriptSha256 = sha256(mouthStabilizerPath);
  if (scriptSha256 !== DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256) {
    throw new Error('数字人嘴部局部稳定器脚本与固定发布版本不一致');
  }
  const processorOutput = path.join(paths.directory, 'result.mouth-local-v1.intermediate.mp4');
  const auditPath = `${processorOutput}.audit.json`;
  fs.rmSync(processorOutput, { force: true });
  fs.rmSync(auditPath, { force: true });
  const rawInputSha256 = await sha256File(paths.rawOutput);
  updateJob(jobId, {
    status: 'processing',
    stage: `mouth_local_stabilization_${profileId}`,
    progress: Math.max(jobs.find(job => job.id === jobId)?.progress || 0, 95),
  });
  const result = await runWsl(validatorPython, [
    toWslPath(mouthStabilizerPath),
    '--input', toWslPath(paths.rawOutput),
    '--output', toWslPath(processorOutput),
    '--audit', toWslPath(auditPath),
    '--mode', parameters.mode,
    '--window-size', String(parameters.windowSize),
    '--weights', parameters.weights.join(','),
    '--canonical-width', String(parameters.canonicalWidth),
    '--canonical-height', String(parameters.canonicalHeight),
    '--roi-width-scale', String(parameters.roiWidthScale),
    '--roi-height-scale', String(parameters.roiHeightScale),
    '--feather', String(parameters.featherFraction),
    '--sharpen', String(parameters.localSharpenAmount),
    '--sharpen-kernel', String(parameters.localSharpenKernel),
    '--minimum-mouth-width', String(parameters.minimumMouthWidthPixels),
    '--minimum-detection-confidence', String(parameters.minimumDetectionConfidence),
    '--minimum-tracking-confidence', String(parameters.minimumTrackingConfidence),
    '--boundary-margin', String(parameters.boundaryMarginPixels),
    '--maximum-mask-fraction', String(parameters.maximumMaskFraction),
    '--duration-tolerance-ms', String(parameters.durationToleranceMilliseconds),
    '--preset', parameters.encoder.preset,
    '--crf', String(parameters.encoder.crf),
    '--ffmpeg', 'ffmpeg',
    '--ffprobe', 'ffprobe',
    '--overwrite',
  ], jobId);
  throwIfJobCancelled(jobId);
  if (result.code !== 0) {
    throw new Error(`数字人嘴部局部稳定器执行失败 (${result.code}): ${result.stderr.trim().slice(-1200)}`);
  }
  if (!fs.existsSync(processorOutput) || fs.statSync(processorOutput).size < 1024 || !fs.existsSync(auditPath)) {
    throw new Error('数字人嘴部局部稳定器缺少输出或审计文件');
  }
  const rawAfterSha256 = await sha256File(paths.rawOutput);
  if (rawAfterSha256 !== rawInputSha256) throw new Error('数字人嘴部局部稳定器修改了原始 MuseTalk 输出');
  const processorOutputSha256 = await sha256File(processorOutput);
  const auditFile = fs.readFileSync(auditPath);
  const evidence = parseDigitalHumanMouthStabilizationAudit({
    auditFile,
    rawInputSha256,
    processorOutputSha256,
    scriptSha256,
    expectedScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
  });
  if (evidence.profileId !== profileId) throw new Error('数字人嘴部局部稳定器实际参数与确定性选择档位不一致');
  fs.writeFileSync(path.join(paths.directory, 'mouth-local-stabilization-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return { inputPath: processorOutput, auditPath, evidence, profileId };
}

function persistRenderTreatmentAudit(
  paths: MuseTalkProfileAttemptPaths,
  outputPath: string,
  quality: WorkerQuality,
  receipts: DigitalHumanRenderTreatmentReceipt[],
  selectedAttempt?: number,
): DigitalHumanRenderTreatmentAudit {
  const audit = buildDigitalHumanRenderTreatmentAudit(receipts, selectedAttempt);
  quality.renderTreatmentAudit = audit;
  const serialized = JSON.stringify(audit, null, 2);
  fs.writeFileSync(path.join(paths.directory, 'render-treatment-audit.json'), serialized, 'utf8');
  fs.writeFileSync(`${outputPath}.render-treatment-audit.json`, serialized, 'utf8');
  fs.writeFileSync(`${outputPath}.final-quality.json`, JSON.stringify(quality, null, 2), 'utf8');
  return audit;
}

async function renderFinalTreatmentAttempt(input: {
  jobId: string;
  paths: MuseTalkProfileAttemptPaths;
  avatarPath: string;
  preparedAudioDuration: number;
  workerInput: WorkerInput;
  performancePlan?: ExecutablePerformancePlan;
  treatmentId: DigitalHumanRenderTreatmentId;
  triggerFailureCodes?: string[];
  priorReceipts: DigitalHumanRenderTreatmentReceipt[];
  mouthLocalProcessor?: MouthLocalProcessorResult;
}): Promise<MuseTalkProfileRenderResult> {
  const {
    jobId, paths, avatarPath, preparedAudioDuration, workerInput, performancePlan,
    treatmentId, triggerFailureCodes = [], priorReceipts, mouthLocalProcessor,
  } = input;
  const treatmentAttempt = treatmentId === 'mouth_jump_mouth_local_v1'
    ? 3 : treatmentId === 'mouth_jump_tmix2_equal_unsharp' ? 2 : 1;
  if ((treatmentId === 'mouth_jump_mouth_local_v1') !== Boolean(mouthLocalProcessor)) {
    throw new Error('数字人嘴部局部处理档位与 processor evidence 不一致');
  }
  const outputPath = renderTreatmentOutputPath(paths, treatmentId);
  const renderInputPath = mouthLocalProcessor?.inputPath || paths.rawOutput;
  const performanceRecipe = performancePlan
    ? buildPerformanceExecutionRecipe({
      plan: performancePlan,
      motionClipIds: (workerInput.motionClips || []).map(item => item.id),
      finalTreatmentId: treatmentId,
    })
    : undefined;
  const filterComplex = performanceRecipe?.filterComplex
    || buildDigitalHumanFinalFilterComplex(DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX, treatmentId);
  const baseRenderFingerprint = performanceRecipe?.baseRenderFingerprint
    || DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT;
  const currentProgress = jobs.find(job => job.id === jobId)?.progress || 0;
  updateJob(jobId, {
    stage: `${performancePlan ? 'scene_composite' : 'vertical_composition'}_${treatmentId}`,
    progress: Math.max(currentProgress, treatmentAttempt === 1 ? 82 : 91),
  });
  await runProcess(ffmpegStatic!, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', renderInputPath,
    '-filter_complex', filterComplex,
    '-map', '[v]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '160k',
    ...(performanceRecipe ? ['-metadata', `comment=${performanceRecipe.metadataComment}`] : []),
    '-movflags', '+faststart', outputPath,
  ], jobId);
  throwIfJobCancelled(jobId);

  let performanceReceipt: PerformanceExecutionReceipt | undefined;
  if (performanceRecipe) {
    const metadataVerified = await verifyPerformanceOutputMetadata(outputPath, performanceRecipe.metadataComment, jobId);
    performanceReceipt = buildPerformanceExecutionReceipt(performanceRecipe, metadataVerified);
    fs.writeFileSync(`${outputPath}.performance-execution.json`, JSON.stringify(performanceReceipt, null, 2), 'utf8');
  }
  updateJob(jobId, {
    status: 'quality_check',
    stage: `${performancePlan ? 'performance_quality_gate' : 'output_validation'}_${treatmentId}`,
    progress: Math.max(jobs.find(job => job.id === jobId)?.progress || 0, treatmentAttempt === 1 ? 88 : 94),
  });

  const rawInputSha256 = await sha256File(paths.rawOutput);
  let quality: WorkerQuality;
  try {
    quality = await validateOutput(avatarPath, outputPath, {
      minLipSyncScore: preparedAudioDuration <= shortSegmentMaximumSeconds ? shortSegmentMinimumLipSyncScore : 3,
      validationScope: 'segment',
    }, jobId);
  } catch (error) {
    if (!(error instanceof FinalQualityRejectedError)) throw error;
    quality = error.quality;
    annotateDigitalHumanPipelineQuality(quality, treatmentId);
    const performanceGate = applyPerformanceShotGate(
      outputPath, performancePlan, workerInput, performanceReceipt, quality,
    );
    const receipt = buildDigitalHumanRenderTreatmentReceipt({
      attempt: treatmentAttempt,
      treatmentId,
      triggerFailureCodes,
      renderContext: performancePlan ? 'performance' : 'standard_vertical',
      baseRenderFingerprint,
      inputSha256: rawInputSha256,
      outputSha256: quality.outputSha256 || await sha256File(outputPath),
      qualityPassed: false,
      qualityFailureCodes: quality.failureCodes || [],
      qualityFailures: quality.failures || [],
      ...(mouthLocalProcessor ? {
        processorEvidence: mouthLocalProcessor.evidence,
        expectedProcessorScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
      } : {}),
    });
    persistRenderTreatmentAudit(paths, outputPath, quality, [...priorReceipts, receipt]);
    throw new FinalQualityRejectedError(quality, performanceGate, receipt, outputPath);
  }

  annotateDigitalHumanPipelineQuality(quality, treatmentId);
  const performanceGate = applyPerformanceShotGate(
    outputPath, performancePlan, workerInput, performanceReceipt, quality,
  );
  const receipt = buildDigitalHumanRenderTreatmentReceipt({
    attempt: treatmentAttempt,
    treatmentId,
    triggerFailureCodes,
    renderContext: performancePlan ? 'performance' : 'standard_vertical',
    baseRenderFingerprint,
    inputSha256: rawInputSha256,
    outputSha256: quality.outputSha256 || await sha256File(outputPath),
    qualityPassed: quality.passed,
    qualityFailureCodes: quality.failureCodes || [],
    qualityFailures: quality.failures || [],
    ...(mouthLocalProcessor ? {
      processorEvidence: mouthLocalProcessor.evidence,
      expectedProcessorScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
    } : {}),
  });
  const allReceipts = [...priorReceipts, receipt];
  const selectedAttempt = quality.passed && (!performanceGate || performanceGate.passed)
    ? treatmentAttempt
    : undefined;
  persistRenderTreatmentAudit(paths, outputPath, quality, allReceipts, selectedAttempt);
  if (performanceGate && !performanceGate.passed) {
    throw new PerformanceQualityRejectedError(quality, performanceGate, receipt, outputPath);
  }
  return {
    paths: { ...paths, output: outputPath },
    quality,
    performanceReceipt,
    performanceGate,
  };
}

async function renderMuseTalkProfileAttempt(input: {
  jobId: string;
  profile: MuseTalkRenderProfile;
  paths: MuseTalkProfileAttemptPaths;
  avatarPath: string;
  audioPath: string;
  preparedAudioDuration: number;
  workerInput: WorkerInput;
  motionSources: string[];
  performancePlan?: ExecutablePerformancePlan;
  performanceRecipe?: PerformanceExecutionRecipe;
}): Promise<MuseTalkProfileRenderResult> {
  const {
    jobId, profile, paths, avatarPath, audioPath, preparedAudioDuration,
    workerInput, motionSources, performancePlan, performanceRecipe,
  } = input;
  const currentProgress = jobs.find(job => job.id === jobId)?.progress || 0;
  updateJob(jobId, {
    stage: `${performancePlan ? 'lip_sync' : 'video_preserving_lip_sync'}_${profile.id}`,
    progress: Math.max(currentProgress, 30),
  });
  if ((performancePlan?.beats.length || 0) >= 2) {
    if (!performanceRecipe) throw new Error('多动作数字人缺少可审计的中间视频配方');
    await renderPerformanceSequence(
      jobId, paths.directory, performancePlan!, workerInput, motionSources,
      audioPath, paths.rawOutput, profile, performanceRecipe,
    );
  } else {
    const sourcePath = performancePlan ? motionSources[0] : (motionSources[0] || avatarPath);
    if (!sourcePath) throw new Error('表演计划缺少已下载的动作素材');
    await runMuseTalkSegment(jobId, profile, sourcePath, audioPath, paths.rawOutput);
  }
  throwIfJobCancelled(jobId);
  try {
    return await renderFinalTreatmentAttempt({
      jobId,
      paths,
      avatarPath,
      preparedAudioDuration,
      workerInput,
      performancePlan,
      treatmentId: 'baseline_unsharp',
      priorReceipts: [],
    });
  } catch (error) {
    if (!(error instanceof FinalQualityRejectedError)) throw error;
    if (!shouldAttemptDigitalHumanTemporalStability(error.quality) || !error.renderReceipt) throw error;
    updateJob(jobId, {
      status: 'processing',
      stage: `retry_temporal_stability_${profile.id}`,
      progress: Math.max(jobs.find(job => job.id === jobId)?.progress || 0, 90),
    });
    try {
      const result = await renderFinalTreatmentAttempt({
        jobId,
        paths,
        avatarPath,
        preparedAudioDuration,
        workerInput,
        performancePlan,
        treatmentId: 'mouth_jump_tmix2_equal_unsharp',
        triggerFailureCodes: (error.quality.failureCodes || [])
          .filter(code => code === DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE),
        priorReceipts: [error.renderReceipt],
      });
      result.quality.notes.push('基线完整门禁明确报告 mouth_jump，已从同一未锐化 MuseTalk 输出执行一次两帧等权时序兜底并重跑全部门禁。');
      fs.writeFileSync(`${result.paths.output}.final-quality.json`, JSON.stringify(result.quality, null, 2), 'utf8');
      return result;
    } catch (temporalError) {
      if (!(temporalError instanceof FinalQualityRejectedError)
        || !temporalError.renderReceipt
        || !shouldAttemptDigitalHumanMouthLocalStability(temporalError.quality)) throw temporalError;
      const triggerFailureCodes = temporalError.quality.failureCodes || [];
      const mouthLocalProcessor = await runMouthLocalProcessor({
        jobId,
        paths,
        triggerFailureCodes,
        profileFailureCodes: error.quality.failureCodes || [],
      });
      const result = await renderFinalTreatmentAttempt({
        jobId,
        paths,
        avatarPath,
        preparedAudioDuration,
        workerInput,
        performancePlan,
        treatmentId: 'mouth_jump_mouth_local_v1',
        triggerFailureCodes,
        priorReceipts: [error.renderReceipt, temporalError.renderReceipt],
        mouthLocalProcessor,
      });
      result.quality.notes.push(`全帧时序兜底仍被类型化嘴部门禁拒绝，已从同一 MuseTalk raw 输入执行 ${mouthLocalProcessor.profileId} 嘴部ROI局部稳像，并重跑完整门禁。`);
      fs.writeFileSync(`${result.paths.output}.final-quality.json`, JSON.stringify(result.quality, null, 2), 'utf8');
      return result;
    }
  }
}

function promoteMuseTalkProfileResult(
  attemptOutputPath: string,
  finalOutputPath: string,
  includePerformanceArtifacts: boolean,
): void {
  const suffixes = [
    '', '.ffprobe.json', '.visual-quality.json', '.syncnet-quality.json',
    '.freeze-quality.json', '.final-quality.json', '.render-treatment-audit.json',
    ...(includePerformanceArtifacts ? ['.performance-execution.json', '.performance-quality.json'] : []),
  ];
  for (const suffix of suffixes) {
    const source = `${attemptOutputPath}${suffix}`;
    if (!fs.existsSync(source)) throw new Error(`通过档位缺少可审计产物: ${path.basename(source)}`);
    const destination = `${finalOutputPath}${suffix}`;
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.copyFileSync(source, temporary);
    fs.renameSync(temporary, destination);
  }
  if (sha256(attemptOutputPath) !== sha256(finalOutputPath)) throw new Error('通过档位产物提升后 SHA256 不一致');
}

async function executeJob(id: string, input: WorkerInput): Promise<void> {
  const jobDir = path.join(workRoot, id);
  fs.mkdirSync(jobDir, { recursive: true });
  const avatarPath = path.join(jobDir, 'avatar.mp4');
  const sourceAudioPath = path.join(jobDir, 'voice-source');
  const audioPath = path.join(jobDir, 'voice.wav');
  const outputPath = path.join(jobDir, 'result.mp4');
  const jobAbortController = new AbortController();
  jobAbortControllers.set(id, jobAbortController);
  try {
    updateJob(id, { status: 'processing', stage: 'download_inputs', progress: 8 });
    validateWorkerPipelineVersion(input);
    if (!ffmpegStatic) throw new Error('ffmpeg unavailable for audio preparation');
    const motionSources = await prefetchAndValidateInputs(id, jobDir, input, avatarPath, sourceAudioPath);
    throwIfJobCancelled(id);
    const segment = input.audioSegment;
    const trimArgs = segment ? ['-ss', String(segment.startSeconds), '-to', String(segment.endSeconds)] : [];
    await runProcess(ffmpegStatic, ['-y', '-hide_banner', '-loglevel', 'error', ...trimArgs, '-i', sourceAudioPath, '-vn', '-ar', '16000', '-ac', '1', audioPath], id);
    throwIfJobCancelled(id);
    if (!runner || !fs.existsSync(runner)) throw new Error('DIGITAL_HUMAN_LOCAL_RUNNER 未配置或文件不存在');
    const performancePlan = validatePerformanceInput(input);
    const performanceRecipe: PerformanceExecutionRecipe | undefined = performancePlan
      ? buildPerformanceExecutionRecipe({ plan: performancePlan, motionClipIds: (input.motionClips || []).map(item => item.id) })
      : undefined;
    const preparedAudioDuration = await probeMediaDurationSeconds(audioPath, id);
    if (performanceRecipe) {
      if (Math.abs(preparedAudioDuration - performanceRecipe.durationSeconds) > 0.16) {
        throw new Error(`表演计划与口播时长不一致（计划 ${performanceRecipe.durationSeconds.toFixed(3)}s，音频 ${preparedAudioDuration.toFixed(3)}s）`);
      }
      for (let index = 0; index < performancePlan!.beats.length; index += 1) {
        const motionPath = motionSources[index];
        if (!motionPath) throw new Error(`节拍${index + 1}缺少已下载的动作素材`);
        const motionDuration = await probeMediaDurationSeconds(motionPath, id);
        const beatDuration = (performancePlan!.beats[index]!.endMs - performancePlan!.beats[index]!.startMs) / 1000;
        if (motionDuration + 0.08 < beatDuration) {
          throw new Error(`节拍${index + 1}动作素材时长不足，禁止循环或冻结补帧`);
        }
      }
      fs.writeFileSync(path.join(jobDir, 'performance-plan.json'), JSON.stringify(performancePlan, null, 2), 'utf8');
      fs.writeFileSync(path.join(jobDir, 'performance-recipe.json'), JSON.stringify(performanceRecipe, null, 2), 'utf8');
    }
    const profileAttempts: MuseTalkProfileAttemptArtifact[] = [];
    let selectedResult: MuseTalkProfileRenderResult | undefined;
    while (!selectedResult) {
      const profile = nextMuseTalkProfile(profileAttemptSummaries(profileAttempts));
      if (!profile) throw new Error('MuseTalk档位策略未选出可执行档位');
      const attemptNumber = profileAttempts.length + 1;
      const paths = museTalkProfileAttemptPaths(jobDir, attemptNumber, profile);
      const attempt: MuseTalkProfileAttemptArtifact = {
        attempt: attemptNumber,
        profile: { ...profile },
        outcome: 'running',
        startedAt: new Date().toISOString(),
        artifacts: {
          directory: jobArtifactPath(jobDir, paths.directory),
          rawOutput: jobArtifactPath(jobDir, paths.rawOutput),
          output: jobArtifactPath(jobDir, paths.output),
          finalQuality: jobArtifactPath(jobDir, `${paths.output}.final-quality.json`),
          renderTreatmentAudit: jobArtifactPath(jobDir, path.join(paths.directory, 'render-treatment-audit.json')),
          ...(performancePlan ? {
            performanceExecution: jobArtifactPath(jobDir, `${paths.output}.performance-execution.json`),
            performanceQuality: jobArtifactPath(jobDir, `${paths.output}.performance-quality.json`),
          } : {}),
        },
      };
      profileAttempts.push(attempt);
      persistMuseTalkProfileManifest(jobDir, profileAttempts);

      try {
        const result = await renderMuseTalkProfileAttempt({
          jobId: id,
          profile,
          paths,
          avatarPath,
          audioPath,
          preparedAudioDuration,
          workerInput: input,
          motionSources,
          performancePlan,
          performanceRecipe,
        });
        attempt.artifacts.output = jobArtifactPath(jobDir, result.paths.output);
        attempt.artifacts.finalQuality = jobArtifactPath(jobDir, `${result.paths.output}.final-quality.json`);
        if (performancePlan) {
          attempt.artifacts.performanceExecution = jobArtifactPath(jobDir, `${result.paths.output}.performance-execution.json`);
          attempt.artifacts.performanceQuality = jobArtifactPath(jobDir, `${result.paths.output}.performance-quality.json`);
        }
        promoteMuseTalkProfileResult(result.paths.output, outputPath, Boolean(performancePlan));
        attempt.outcome = 'passed';
        attempt.completedAt = new Date().toISOString();
        const summaries = profileAttemptSummaries(profileAttempts);
        result.quality.notes.push(...buildMuseTalkProfileSelectionNotes(summaries, profile.id));
        fs.writeFileSync(`${result.paths.output}.final-quality.json`, JSON.stringify(result.quality, null, 2), 'utf8');
        fs.writeFileSync(`${outputPath}.final-quality.json`, JSON.stringify(result.quality, null, 2), 'utf8');
        attempt.quality = result.quality;
        attempt.performanceGate = result.performanceGate;
        selectedResult = result;
        persistMuseTalkProfileManifest(jobDir, profileAttempts, profile.id, result.quality.outputSha256);
      } catch (error) {
        const rejectedOutputPath = error instanceof FinalQualityRejectedError || error instanceof PerformanceQualityRejectedError
          ? error.outputPath
          : undefined;
        if (rejectedOutputPath) {
          attempt.artifacts.output = jobArtifactPath(jobDir, rejectedOutputPath);
          attempt.artifacts.finalQuality = jobArtifactPath(jobDir, `${rejectedOutputPath}.final-quality.json`);
          if (performancePlan) {
            attempt.artifacts.performanceExecution = jobArtifactPath(jobDir, `${rejectedOutputPath}.performance-execution.json`);
            attempt.artifacts.performanceQuality = jobArtifactPath(jobDir, `${rejectedOutputPath}.performance-quality.json`);
          }
        }
        attempt.completedAt = new Date().toISOString();
        attempt.failure = error instanceof Error ? error.message : String(error);
        if (error instanceof FinalQualityRejectedError) {
          attempt.outcome = 'final_quality_rejected';
          attempt.quality = error.quality;
          attempt.performanceGate = error.performanceGate;
        } else if (error instanceof PerformanceQualityRejectedError) {
          attempt.outcome = 'performance_quality_rejected';
          attempt.quality = error.quality;
          attempt.performanceGate = error.gate;
        } else {
          attempt.outcome = 'execution_failed';
        }
        const summaries = profileAttemptSummaries(profileAttempts);
        if (jobs.find(job => job.id === id)?.status === 'cancelled') {
          persistMuseTalkProfileManifest(jobDir, profileAttempts);
          throw error;
        }
        const nextProfile = nextMuseTalkProfile(summaries);
        if (error instanceof FinalQualityRejectedError && nextProfile) {
          persistMuseTalkProfileManifest(jobDir, profileAttempts);
          updateJob(id, {
            status: 'processing',
            stage: `retry_lip_sync_${nextProfile.id}`,
            progress: Math.max(jobs.find(job => job.id === id)?.progress || 0, 89),
          });
          continue;
        }
        if (error instanceof FinalQualityRejectedError || error instanceof PerformanceQualityRejectedError) {
          error.quality.notes.push(...buildMuseTalkProfileSelectionNotes(summaries));
          fs.writeFileSync(`${error.outputPath || paths.output}.final-quality.json`, JSON.stringify(error.quality, null, 2), 'utf8');
          attempt.quality = error.quality;
        }
        persistMuseTalkProfileManifest(jobDir, profileAttempts);
        throw error;
      }
    }
    const quality = selectedResult.quality;
    throwIfJobCancelled(id);
    updateJob(id, {
      status: 'completed', stage: 'completed', progress: 100,
      outputUrl: `http://${host}:${port}/outputs/${encodeURIComponent(id)}.mp4`,
      quality, error: undefined, errorCode: undefined,
    });
  } catch (error) {
    const cancelled = jobs.find(job => job.id === id)?.status === 'cancelled';
    const message = error instanceof Error ? error.message : String(error);
    const rejectedQuality = error instanceof FinalQualityRejectedError || error instanceof PerformanceQualityRejectedError
      ? error.quality
      : undefined;
    if (!cancelled) updateJob(id, {
      status: 'failed', stage: 'failed', progress: Math.min(99, jobs.find(job => job.id === id)?.progress || 0),
      errorCode: error instanceof PerformanceQualityRejectedError
        ? 'PERFORMANCE_QUALITY_REJECTED'
        : error instanceof FinalQualityRejectedError ? 'FINAL_QUALITY_REJECTED' : 'LOCAL_RUNNER_FAILED',
      error: message,
      ...(rejectedQuality ? { quality: rejectedQuality } : {}),
    });
  } finally {
    jobAbortControllers.delete(id);
  }
}

// MuseTalk and its validators share one 8GB GPU. All ingress paths (direct API
// and pull hub) enter the same FIFO so two HTTP requests can never infer in
// parallel even if the caller ignores the advertised capacity.
let executionTail: Promise<void> = Promise.resolve();
let executionQueueDepth = 0;
function enqueueJobExecution(id: string, input: WorkerInput): Promise<void> {
  executionQueueDepth += 1;
  const scheduled = executionTail.then(async () => {
    if (jobs.find(job => job.id === id)?.status === 'cancelled') return;
    await executeJob(id, input);
  });
  executionTail = scheduled.catch(() => undefined);
  return scheduled.finally(() => { executionQueueDepth = Math.max(0, executionQueueDepth - 1); });
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(authorized);

app.get('/health', async (_req, res) => res.json({
  ok: true,
  provider: 'musetalk-v1.5-local',
  pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
  finalSharpenFilter: DIGITAL_HUMAN_FINAL_SHARPEN_FILTER,
  temporalStabilityFallback: {
    triggerFailureCode: DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE,
    temporalFilter: DIGITAL_HUMAN_TEMPORAL_STABILITY_FILTER,
    finalSharpenFilter: DIGITAL_HUMAN_TEMPORAL_FINAL_SHARPEN_FILTER,
    receiptVersion: DIGITAL_HUMAN_RENDER_TREATMENT_AUDIT_VERSION,
  },
  mouthLocalStabilization: {
    algorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
    scriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
    profiles: Object.keys(DIGITAL_HUMAN_MOUTH_STABILIZATION_PARAMETER_PROFILES),
    fullFrameTemporalFilterApplied: false,
  },
  features: ['lip_sync', 'source_motion', 'neck_shoulder_preservation', 'input_prefetch', 'performance_plan_execution', 'performance_shot_gate', 'final_quality_gate', 'adaptive_musetalk_profiles', 'typed_mouth_jump_temporal_fallback', 'mouth_local_stabilization', 'audited_render_treatment_receipt'],
  finalValidationMode,
  maxConcurrentGpuJobs: 1,
  executionQueueDepth,
  runnerConfigured: Boolean(runner && fs.existsSync(runner)),
  preflight: await collectWorkerHealthReport(),
}));

app.post('/v1/jobs', (req, res) => {
  let avatarVideoUrl: URL;
  let audioUrl: URL;
  try {
    avatarVideoUrl = safeInputUrl(req.body?.avatarVideoUrl);
    audioUrl = safeInputUrl(req.body?.audioUrl);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid input URL' });
    return;
  }
  const externalJobId = String(req.body?.externalJobId || '').trim();
  const existing = externalJobId ? jobs.find(item => item.externalJobId === externalJobId) : undefined;
  if (existing) { res.status(200).json(existing); return; }
  const rawSegment = req.body?.audioSegment;
  const audioSegment = rawSegment ? { startSeconds: Number(rawSegment.startSeconds), endSeconds: Number(rawSegment.endSeconds) } : undefined;
  if (audioSegment && (!Number.isFinite(audioSegment.startSeconds) || !Number.isFinite(audioSegment.endSeconds) || audioSegment.startSeconds < 0 || audioSegment.endSeconds <= audioSegment.startSeconds || audioSegment.endSeconds - audioSegment.startSeconds > 30)) {
    res.status(400).json({ error: 'invalid audio segment' }); return;
  }
  const input: WorkerInput = {
    avatarVideoUrl: avatarVideoUrl.toString(), audioUrl: audioUrl.toString(), audioSegment,
    performancePlanVersion: req.body?.performancePlanVersion, performancePlan: req.body?.performancePlan,
    motionClipIds: req.body?.motionClipIds, motionClips: req.body?.motionClips, pipelineVersion: req.body?.pipelineVersion,
  };
  try {
    validateWorkerPipelineVersion(input);
    validatePerformanceInput(input);
    validateAllInputUrls(input);
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'invalid performance plan' }); return; }
  const now = new Date().toISOString();
  const job: WorkerJob = {
    id: randomUUID(), externalJobId,
    status: 'queued', stage: 'queued', progress: 0, createdAt: now, updatedAt: now,
  };
  jobs.push(job);
  persistJobs();
  void enqueueJobExecution(job.id, input);
  res.status(202).json(job);
});

app.get('/v1/jobs/:id', (req, res) => {
  const job = jobs.find(item => item.id === req.params.id);
  if (!job) { res.status(404).json({ error: 'job not found' }); return; }
  res.json(job);
});

app.post('/v1/jobs/:id/cancel', (req, res) => {
  const job = jobs.find(item => item.id === req.params.id);
  if (!job) { res.status(404).json({ error: 'job not found' }); return; }
  cancelLocalJob(job.id, 'cancelled');
  res.json(jobs.find(item => item.id === job.id));
});

app.get('/outputs/:file', (req, res) => {
  const match = /^([0-9a-f-]{36})\.mp4$/i.exec(req.params.file);
  if (!match) { res.status(404).end(); return; }
  const outputPath = path.join(workRoot, match[1]!, 'result.mp4');
  if (!fs.existsSync(outputPath)) { res.status(404).end(); return; }
  res.type('video/mp4').sendFile(outputPath);
});

app.listen(port, host, () => {
  console.log(`[video-preserving-avatar-worker] http://${host}:${port} runner=${runner || 'unconfigured'}`);
});

let claiming = false;

async function heartbeatHubJob(remoteJobId: string, leaseId: string, localJobId: string): Promise<void> {
  const response = await hubFetch(`/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(remoteJobId)}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({ workerId, leaseId }),
  });
  await applyHubControl(response, localJobId);
  if (!response.ok) throw await hubTransferError(response, 'worker heartbeat');
}

async function reportHubPresence(): Promise<boolean> {
  const response = await hubFetch('/api/overseas/studio/digital-human/worker/presence', {
    method: 'POST',
    body: JSON.stringify({ workerId, health: await collectWorkerHealthReport() }),
  });
  if (response.ok) return true;
  const payload = await response.json().catch(() => ({})) as { error?: string; preflight?: unknown };
  console.warn('[digital-human-worker] preflight blocked:', payload.error || response.status, payload.preflight || '');
  return false;
}

async function pollHub(): Promise<void> {
  if (!hubUrl || !workerKey || !resultRecoveryComplete || claiming || executionQueueDepth > 0 || running.size > 0) return;
  await flushResultOutbox();
  if (hasPendingResultDelivery()) return;
  claiming = true;
  try {
    if (!await reportHubPresence()) return;
    const response = await hubFetch(`/api/overseas/studio/digital-human/worker/claim?workerId=${encodeURIComponent(workerId)}`);
    if (response.status === 204) return;
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok || !payload?.job?.id) throw new Error(String(payload?.error || `claim failed (${response.status})`));
    const remote = payload.job;
    const leaseId = String(remote.leaseId || '').trim();
    if (!leaseId) throw new Error('claim response missing leaseId');
    const input: WorkerInput = {
      avatarVideoUrl: String(remote.avatarVideoUrl), audioUrl: String(remote.audioUrl), audioSegment: remote.audioSegment,
      performancePlanVersion: remote.performancePlanVersion, performancePlan: remote.performancePlan,
      motionClipIds: remote.motionClipIds, motionClips: remote.motionClips, pipelineVersion: remote.pipelineVersion,
      usagePurpose: remote.usagePurpose,
    };
    const now = new Date().toISOString();
    const local: WorkerJob = { id: randomUUID(), externalJobId: String(remote.id), leaseId, status: 'queued', stage: 'queued', progress: 0, createdAt: now, updatedAt: now };
    jobs.push(local); persistJobs();
    try {
      validateWorkerPipelineVersion(input);
      validatePerformanceInput(input);
      validateAllInputUrls(input);
    } catch (error) {
      const failed = updateJob(local.id, { status: 'failed', stage: 'input_validation', progress: 0, errorCode: 'INVALID_WORKER_INPUT', error: error instanceof Error ? error.message : String(error) });
      enqueueTerminalNotification(failed, 'failed', failed.errorCode, failed.error);
      await flushResultOutbox();
      return;
    }
    await heartbeatHubJob(String(remote.id), leaseId, local.id);
    let heartbeatInFlight = false;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight || ['failed', 'cancelled'].includes(jobs.find(item => item.id === local.id)?.status || 'failed')) return;
      heartbeatInFlight = true;
      void heartbeatHubJob(String(remote.id), leaseId, local.id)
        .catch(error => console.warn('[digital-human-worker] heartbeat:', error instanceof Error ? error.message : error))
        .finally(() => { heartbeatInFlight = false; });
    }, Math.max(5_000, Number(process.env.DIGITAL_HUMAN_WORKER_HEARTBEAT_MS || 30_000)));
    heartbeatTimer.unref?.();
    try {
      if (jobs.find(item => item.id === local.id)?.status !== 'cancelled') await enqueueJobExecution(local.id, input);
      const finished = jobs.find(item => item.id === local.id)!;
      if (finished.status === 'completed') {
        const outputPath = path.join(workRoot, local.id, 'result.mp4');
        await enqueueCompletedResult(finished, outputPath);
        await flushResultOutbox();
      } else if (finished.status === 'cancelled') {
        if (finished.stage !== 'worker_lease_lost') enqueueTerminalNotification(finished, 'cancelled');
      } else {
        enqueueTerminalNotification(finished, 'failed', finished.errorCode, finished.error);
      }
      await flushResultOutbox();
    } finally {
      clearInterval(heartbeatTimer);
    }
  } catch (error) {
    console.error('[digital-human-worker] hub poll:', error instanceof Error ? error.message : error);
  } finally {
    claiming = false;
  }
}

if (hubUrl) {
  console.log(`[digital-human-worker] pull mode hub=${hubUrl} worker=${workerId}`);
  const pollTimer = setInterval(() => { void pollHub(); }, Math.max(2_000, Number(process.env.DIGITAL_HUMAN_WORKER_POLL_MS || 5_000)));
  const resultOutboxTimer = setInterval(() => { void flushResultOutbox(); }, Math.max(1_000, Number(process.env.DIGITAL_HUMAN_WORKER_RESULT_RETRY_TICK_MS || 2_000)));
  const pendingHeartbeatTimer = setInterval(() => { void heartbeatPendingOutboxLeases(); }, Math.max(5_000, Number(process.env.DIGITAL_HUMAN_WORKER_HEARTBEAT_MS || 30_000)));
  const cleanupTimer = setInterval(() => { cleanupExpiredJobArtifacts(); }, Math.max(60_000, Number(process.env.DIGITAL_HUMAN_WORKER_CLEANUP_INTERVAL_MS || 15 * 60_000)));
  pollTimer.unref?.();
  resultOutboxTimer.unref?.();
  pendingHeartbeatTimer.unref?.();
  cleanupTimer.unref?.();
  void recoverCompletedResultOutbox().then(async () => {
    await flushResultOutbox();
    await pollHub();
  }).catch(error => console.error('[digital-human-worker] result recovery:', error instanceof Error ? error.message : error));
}
