export const DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA = 'digital-human-worker-presence-v2' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface DigitalHumanWorkerHealthReport {
  schemaVersion: typeof DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA;
  pipelineVersion: string;
  runnerConfigured: boolean;
  mouthStabilizerConfigured: boolean;
  mouthStabilizerAlgorithmVersion: string;
  mouthStabilizerScriptSha256: string;
  gpu: { available: boolean; name?: string; totalVramMb?: number; freeVramMb?: number };
  disk: { freeBytes?: number };
  validatorConfigured: boolean;
  validatorVersion: string;
  gateVersion: string;
  reportedAt: string;
}

export interface DigitalHumanWorkerPreflight {
  ready: boolean;
  failures: string[];
  expectedPipelineVersion: string;
  observedPipelineVersion?: string;
  runnerConfigured: boolean;
  mouthStabilizerConfigured: boolean;
  expectedMouthStabilizerAlgorithmVersion: string;
  observedMouthStabilizerAlgorithmVersion?: string;
  expectedMouthStabilizerScriptSha256: string;
  observedMouthStabilizerScriptSha256?: string;
  gpuAvailable: boolean;
  totalVramMb?: number;
  freeVramMb?: number;
  diskFreeBytes?: number;
  validatorVersion?: string;
  gateVersion?: string;
}

export interface DigitalHumanWorkerPresenceSnapshot {
  online: boolean;
  ready: boolean;
  lastSeenAt?: string;
  workerId?: string;
  preflight: DigitalHumanWorkerPreflight;
}

export interface DigitalHumanWorkerPreflightOptions {
  expectedPipelineVersion: string;
  expectedMouthStabilizerAlgorithmVersion: string;
  expectedMouthStabilizerScriptSha256: string;
  minimumTotalVramMb?: number;
  minimumFreeVramMb?: number;
  minimumDiskFreeBytes?: number;
}

interface StoredPresence { lastSeenAtMs: number; report?: DigitalHumanWorkerHealthReport }

function finiteNonNegative(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function requiredString(value: unknown, maximum = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function requiredSha256(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return SHA256_PATTERN.test(candidate) ? candidate : '';
}

export function parseDigitalHumanWorkerHealthReport(value: unknown): DigitalHumanWorkerHealthReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const gpu = source.gpu && typeof source.gpu === 'object' && !Array.isArray(source.gpu) ? source.gpu as Record<string, unknown> : {};
  const disk = source.disk && typeof source.disk === 'object' && !Array.isArray(source.disk) ? source.disk as Record<string, unknown> : {};
  const reportedAt = requiredString(source.reportedAt);
  if (source.schemaVersion !== DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA
    || !requiredString(source.pipelineVersion)
    || typeof source.runnerConfigured !== 'boolean'
    || typeof source.mouthStabilizerConfigured !== 'boolean'
    || !requiredString(source.mouthStabilizerAlgorithmVersion)
    || !requiredSha256(source.mouthStabilizerScriptSha256)
    || typeof gpu.available !== 'boolean'
    || typeof source.validatorConfigured !== 'boolean'
    || !requiredString(source.validatorVersion)
    || !requiredString(source.gateVersion)
    || !Number.isFinite(Date.parse(reportedAt))) return null;
  const totalVramMb = finiteNonNegative(gpu.totalVramMb);
  const freeVramMb = finiteNonNegative(gpu.freeVramMb);
  const freeBytes = finiteNonNegative(disk.freeBytes);
  return {
    schemaVersion: DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA,
    pipelineVersion: requiredString(source.pipelineVersion),
    runnerConfigured: source.runnerConfigured,
    mouthStabilizerConfigured: source.mouthStabilizerConfigured,
    mouthStabilizerAlgorithmVersion: requiredString(source.mouthStabilizerAlgorithmVersion),
    mouthStabilizerScriptSha256: requiredSha256(source.mouthStabilizerScriptSha256),
    gpu: {
      available: gpu.available,
      ...(requiredString(gpu.name) ? { name: requiredString(gpu.name) } : {}),
      ...(totalVramMb !== undefined ? { totalVramMb } : {}),
      ...(freeVramMb !== undefined ? { freeVramMb } : {}),
    },
    disk: { ...(freeBytes !== undefined ? { freeBytes } : {}) },
    validatorConfigured: source.validatorConfigured,
    validatorVersion: requiredString(source.validatorVersion),
    gateVersion: requiredString(source.gateVersion),
    reportedAt,
  };
}

export function assessDigitalHumanWorkerPreflight(report: DigitalHumanWorkerHealthReport | undefined, options: DigitalHumanWorkerPreflightOptions): DigitalHumanWorkerPreflight {
  const minimumTotalVramMb = Math.max(1, options.minimumTotalVramMb ?? 7_000);
  const minimumFreeVramMb = Math.max(1, options.minimumFreeVramMb ?? 3_500);
  const minimumDiskFreeBytes = Math.max(1, options.minimumDiskFreeBytes ?? 5 * 1024 ** 3);
  const expectedMouthStabilizerAlgorithmVersion = requiredString(options.expectedMouthStabilizerAlgorithmVersion);
  const expectedMouthStabilizerScriptSha256 = requiredSha256(options.expectedMouthStabilizerScriptSha256);
  const failures: string[] = [];
  if (!report) failures.push('Worker 未上报可验证健康信息');
  if (report && report.pipelineVersion !== options.expectedPipelineVersion) failures.push('Worker pipelineVersion 与服务端 P1 不匹配');
  if (report?.runnerConfigured !== true) failures.push('Worker 未配置可执行的数字人 runner');
  if (!expectedMouthStabilizerAlgorithmVersion) failures.push('服务端未配置有效的嘴部局部稳定器算法版本');
  if (!expectedMouthStabilizerScriptSha256) failures.push('服务端未配置有效的嘴部局部稳定器脚本 SHA256');
  if (report?.mouthStabilizerConfigured !== true) failures.push('Worker 未配置可执行的嘴部局部稳定器');
  if (expectedMouthStabilizerAlgorithmVersion
    && report?.mouthStabilizerAlgorithmVersion !== expectedMouthStabilizerAlgorithmVersion) {
    failures.push(`Worker 嘴部局部稳定器算法版本不匹配（期待 ${expectedMouthStabilizerAlgorithmVersion}，实测 ${report?.mouthStabilizerAlgorithmVersion || '缺失'}）`);
  }
  if (expectedMouthStabilizerScriptSha256
    && report?.mouthStabilizerScriptSha256 !== expectedMouthStabilizerScriptSha256) {
    failures.push(`Worker 嘴部局部稳定器脚本 SHA256 不匹配（期待 ${expectedMouthStabilizerScriptSha256}，实测 ${report?.mouthStabilizerScriptSha256 || '缺失'}）`);
  }
  if (report?.gpu.available !== true) failures.push('Worker GPU 不可用');
  if (report?.gpu.totalVramMb === undefined || report.gpu.totalVramMb < minimumTotalVramMb) failures.push(`Worker 显存总量低于 ${minimumTotalVramMb}MB`);
  if (report?.gpu.freeVramMb === undefined || report.gpu.freeVramMb < minimumFreeVramMb) failures.push(`Worker 可用显存低于 ${minimumFreeVramMb}MB`);
  if (report?.disk.freeBytes === undefined || report.disk.freeBytes < minimumDiskFreeBytes) failures.push('Worker 可用磁盘空间低于安全阈值');
  if (report?.validatorConfigured !== true) failures.push('Worker 最终质检器未完整配置');
  if (!report?.validatorVersion) failures.push('Worker validator 版本缺失');
  if (!report?.gateVersion) failures.push('Worker gate 版本缺失');
  return {
    ready: failures.length === 0,
    failures,
    expectedPipelineVersion: options.expectedPipelineVersion,
    observedPipelineVersion: report?.pipelineVersion,
    runnerConfigured: report?.runnerConfigured === true,
    mouthStabilizerConfigured: report?.mouthStabilizerConfigured === true,
    expectedMouthStabilizerAlgorithmVersion,
    observedMouthStabilizerAlgorithmVersion: report?.mouthStabilizerAlgorithmVersion,
    expectedMouthStabilizerScriptSha256,
    observedMouthStabilizerScriptSha256: report?.mouthStabilizerScriptSha256,
    gpuAvailable: report?.gpu.available === true,
    totalVramMb: report?.gpu.totalVramMb,
    freeVramMb: report?.gpu.freeVramMb,
    diskFreeBytes: report?.disk.freeBytes,
    validatorVersion: report?.validatorVersion,
    gateVersion: report?.gateVersion,
  };
}

export function digitalHumanWorkerIsOnline(lastSeenAtMs: number | undefined, nowMs: number, ttlMs: number): boolean {
  return Number.isFinite(lastSeenAtMs) && Number(lastSeenAtMs) > 0 && nowMs - Number(lastSeenAtMs) <= Math.max(1, ttlMs);
}

/** Process-local and deliberately ephemeral; readiness requires a fresh P1 report. */
export class DigitalHumanWorkerPresenceRegistry {
  private readonly presenceByWorker = new Map<string, StoredPresence>();

  touch(workerId: string, reportOrNow?: unknown, explicitNowMs?: number): void {
    const normalized = String(workerId || '').trim().slice(0, 160);
    const report = typeof reportOrNow === 'number' ? undefined : parseDigitalHumanWorkerHealthReport(reportOrNow);
    const nowMs = typeof reportOrNow === 'number' ? reportOrNow : explicitNowMs ?? Date.now();
    if (!normalized || !Number.isFinite(nowMs)) return;
    const current = this.presenceByWorker.get(normalized);
    this.presenceByWorker.set(normalized, { lastSeenAtMs: nowMs, report: report || current?.report });
  }

  snapshotForWorker(workerId: string, nowMs: number, ttlMs: number, options: DigitalHumanWorkerPreflightOptions): DigitalHumanWorkerPresenceSnapshot {
    const normalized = String(workerId || '').trim().slice(0, 160);
    const presence = this.presenceByWorker.get(normalized);
    if (!presence || !digitalHumanWorkerIsOnline(presence.lastSeenAtMs, nowMs, ttlMs)) {
      if (presence) this.presenceByWorker.delete(normalized);
      return { online: false, ready: false, preflight: assessDigitalHumanWorkerPreflight(undefined, options) };
    }
    const reportFresh = presence.report && nowMs - Date.parse(presence.report.reportedAt) <= Math.max(1, ttlMs)
      ? presence.report : undefined;
    const preflight = assessDigitalHumanWorkerPreflight(reportFresh, options);
    return { online: true, ready: preflight.ready, workerId: normalized, lastSeenAt: new Date(presence.lastSeenAtMs).toISOString(), preflight };
  }

  snapshot(nowMs: number, ttlMs: number, options: DigitalHumanWorkerPreflightOptions): DigitalHumanWorkerPresenceSnapshot {
    let latest: { workerId: string; presence: StoredPresence } | undefined;
    let ready: { workerId: string; presence: StoredPresence; preflight: DigitalHumanWorkerPreflight } | undefined;
    for (const [workerId, presence] of this.presenceByWorker) {
      if (!digitalHumanWorkerIsOnline(presence.lastSeenAtMs, nowMs, ttlMs)) { this.presenceByWorker.delete(workerId); continue; }
      if (!latest || presence.lastSeenAtMs > latest.presence.lastSeenAtMs) latest = { workerId, presence };
      const reportFresh = nowMs - Date.parse(presence.report?.reportedAt || '') <= Math.max(1, ttlMs) ? presence.report : undefined;
      const preflight = assessDigitalHumanWorkerPreflight(reportFresh, options);
      if (preflight.ready && (!ready || presence.lastSeenAtMs > ready.presence.lastSeenAtMs)) ready = { workerId, presence, preflight };
    }
    const latestReport = latest && nowMs - Date.parse(latest.presence.report?.reportedAt || '') <= Math.max(1, ttlMs) ? latest.presence.report : undefined;
    const selected = ready || (latest ? { ...latest, preflight: assessDigitalHumanWorkerPreflight(latestReport, options) } : undefined);
    if (!selected) return { online: false, ready: false, preflight: assessDigitalHumanWorkerPreflight(undefined, options) };
    return { online: true, ready: selected.preflight.ready, workerId: selected.workerId, lastSeenAt: new Date(selected.presence.lastSeenAtMs).toISOString(), preflight: selected.preflight };
  }
}
