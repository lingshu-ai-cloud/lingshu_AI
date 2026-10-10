// Preserved as an inactive module: no upload route calls this admission gate.
// Enabling it requires separate user confirmation and integration acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectPersonReplacementPair } from './personReplacementMediaQuality.js';

export type MaterialCleanupReport = {
  schemaVersion: 'material-cleanup.v1';
  status: 'passed' | 'rejected';
  toolchain: {
    ocr: 'paddleocr';
    maskTracker: 'sam2';
    inpaint: 'opencv-temporal';
    compositor: 'ffmpeg';
    seedanceUsed: false;
  };
  framesProcessed: number;
  totalFrames: number;
  residualTextDetections: number;
  unresolvedRegions: number;
  maximumMaskCoverage: number;
  temporalFlickerScore: number;
  failures?: string[];
};

export type MaterialCleanupAdmission = {
  path: string;
  sizeBytes: number;
  sha256: string;
  sourceSha256: string;
  report: MaterialCleanupReport;
};

export type MaterialIngestionOrigin = 'manual_upload' | 'trusted_automatic_ingestion';

/**
 * Cleanup is an admission rule for browser/API uploads made by a person. It
 * must never be inferred from sourceType because that field is supplied by the
 * client and is also used by automatic collectors. Trusted automatic imports
 * have their own provenance and quality checks and bypass this worker.
 */
export function requiresMaterialCleanup(input: {
  type: 'video' | 'image' | 'audio';
  ingestionOrigin: MaterialIngestionOrigin;
}): boolean {
  return input.ingestionOrigin === 'manual_upload' && input.type === 'video';
}

export class MaterialCleanupAdmissionError extends Error {
  constructor(
    message: string,
    readonly code: 'material_cleanup_unavailable' | 'material_cleanup_rejected',
  ) {
    super(message);
    this.name = 'MaterialCleanupAdmissionError';
  }
}

type QueuedCleanup<T> = {
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

/** A process-local FIFO protects a shared accelerator from unbounded parallel
 * model loads. All authenticated tenants use the same bounded capacity; when
 * the queue is full we fail before persisting the upload. */
export class MaterialCleanupQueue {
  private active = 0;
  private readonly pending: Array<QueuedCleanup<unknown>> = [];

  constructor(
    private readonly maximumConcurrency: number,
    private readonly maximumQueued: number,
  ) {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1) throw new Error('maximumConcurrency must be a positive integer');
    if (!Number.isInteger(maximumQueued) || maximumQueued < 0) throw new Error('maximumQueued must be a non-negative integer');
  }

  snapshot(): { active: number; queued: number; maximumConcurrency: number; maximumQueued: number } {
    return { active: this.active, queued: this.pending.length, maximumConcurrency: this.maximumConcurrency, maximumQueued: this.maximumQueued };
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.maximumConcurrency) return this.start(task);
    if (this.pending.length >= this.maximumQueued) {
      return Promise.reject(new MaterialCleanupAdmissionError('素材清理队列已满，请稍后重试；视频未入库', 'material_cleanup_unavailable'));
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ run: task, resolve, reject } as QueuedCleanup<unknown>);
    });
  }

  private start<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1;
    return task().finally(() => {
      this.active -= 1;
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.active < this.maximumConcurrency && this.pending.length) {
      const next = this.pending.shift()!;
      void this.start(next.run).then(next.resolve, next.reject);
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number, minimum = 1, maximum = 64): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? Math.min(parsed, maximum) : fallback;
}

const sharedCleanupQueue = new MaterialCleanupQueue(
  positiveInteger(process.env.MATERIAL_CLEANUP_MAX_CONCURRENCY, 1),
  positiveInteger(process.env.MATERIAL_CLEANUP_MAX_QUEUE, 8, 0, 256),
);

type Dependencies = {
  runPipeline: (inputPath: string, outputPath: string, reportPath: string) => Promise<void>;
  inspectPair: typeof inspectPersonReplacementPair;
};

function configuredPipeline(inputPath: string, outputPath: string, reportPath: string): Promise<void> {
  const python = String(process.env.MATERIAL_CLEANUP_PYTHON || '').trim();
  const configuredScript = String(process.env.MATERIAL_CLEANUP_SCRIPT || '').trim();
  if (!python || !configuredScript) {
    return Promise.reject(new MaterialCleanupAdmissionError(
      '本地素材清理工作器尚未配置，视频未入库',
      'material_cleanup_unavailable',
    ));
  }
  const script = path.resolve(configuredScript);
  if (!fs.existsSync(script)) {
    return Promise.reject(new MaterialCleanupAdmissionError(
      '本地素材清理工作器脚本不存在，视频未入库',
      'material_cleanup_unavailable',
    ));
  }
  const timeout = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.MATERIAL_CLEANUP_TIMEOUT_MS || 15 * 60_000)));
  return new Promise((resolve, reject) => execFile(python, [script, inputPath, outputPath, reportPath], {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONNOUSERSITE: '1' },
  }, (error, _stdout, stderr) => error
    ? reject(new MaterialCleanupAdmissionError(
      `素材清理工作器执行失败，视频未入库${String(stderr || '').trim() ? `：${String(stderr).trim().slice(0, 300)}` : ''}`,
      'material_cleanup_unavailable',
    ))
    : resolve()));
}

function parseReport(reportPath: string): MaterialCleanupReport {
  let report: MaterialCleanupReport;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as MaterialCleanupReport; }
  catch { throw new MaterialCleanupAdmissionError('素材清理工作器没有返回有效质检报告，视频未入库', 'material_cleanup_unavailable'); }
  const exactToolchain = report.toolchain?.ocr === 'paddleocr'
    && report.toolchain?.maskTracker === 'sam2'
    && report.toolchain?.inpaint === 'opencv-temporal'
    && report.toolchain?.compositor === 'ffmpeg'
    && report.toolchain?.seedanceUsed === false;
  if (report.schemaVersion !== 'material-cleanup.v1' || !exactToolchain) {
    throw new MaterialCleanupAdmissionError('素材清理工作器技术栈不符合准入合同，视频未入库', 'material_cleanup_unavailable');
  }
  return report;
}

function reportFailures(report: MaterialCleanupReport): string[] {
  const failures = [...(Array.isArray(report.failures) ? report.failures : [])];
  if (report.status !== 'passed') failures.push('工作器未给出通过结论');
  if (!Number.isFinite(report.totalFrames) || report.totalFrames <= 0) failures.push('没有可验证的视频帧');
  if (report.framesProcessed !== report.totalFrames) failures.push('未完成逐帧处理');
  if (report.residualTextDetections !== 0) failures.push(`仍检出 ${report.residualTextDetections} 处字幕、水印或标识文字`);
  if (report.unresolvedRegions !== 0) failures.push(`仍有 ${report.unresolvedRegions} 个无法稳定修复的区域`);
  if (!Number.isFinite(report.maximumMaskCoverage) || report.maximumMaskCoverage > 0.22) failures.push('单帧修复面积过大');
  if (!Number.isFinite(report.temporalFlickerScore) || report.temporalFlickerScore > 0.08) failures.push('修复区域存在明显时序闪烁');
  return Array.from(new Set(failures));
}

/** Clean first, verify second, persist never. A failed or unavailable local
 * worker leaves only the request-scoped temporary upload, which the route
 * removes in its finally block. */
export function cleanVideoBeforeMaterialAdmission(input: {
  sourcePath: string;
  outputDirectory: string;
  sourceSha256: string;
}, overrides: Partial<Dependencies> = {}): Promise<MaterialCleanupAdmission> {
  return sharedCleanupQueue.run(() => executeVideoCleanupAdmission(input, overrides));
}

async function executeVideoCleanupAdmission(input: {
  sourcePath: string;
  outputDirectory: string;
  sourceSha256: string;
}, overrides: Partial<Dependencies>): Promise<MaterialCleanupAdmission> {
  const deps: Dependencies = { runPipeline: configuredPipeline, inspectPair: inspectPersonReplacementPair, ...overrides };
  const outputPath = path.join(input.outputDirectory, 'cleaned.mp4');
  const reportPath = path.join(input.outputDirectory, 'material-cleanup-report.json');
  await deps.runPipeline(input.sourcePath, outputPath, reportPath);
  const report = parseReport(reportPath);
  const failures = reportFailures(report);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) failures.push('清理结果文件为空');
  if (failures.length) {
    throw new MaterialCleanupAdmissionError(`素材清理未通过：${Array.from(new Set(failures)).join('；')}`, 'material_cleanup_rejected');
  }
  const technical = await deps.inspectPair(input.sourcePath, outputPath);
  if (technical.durationDeltaFrames > 1
    || technical.source.width !== technical.candidate.width
    || technical.source.height !== technical.candidate.height
    || (technical.source.hasAudio && (technical.audioCorrelation === null || technical.audioCorrelation < 0.995))) {
    throw new MaterialCleanupAdmissionError('素材清理改变了原始时长、尺寸或音轨，视频未入库', 'material_cleanup_rejected');
  }
  const bytes = fs.readFileSync(outputPath);
  return {
    path: outputPath,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceSha256: input.sourceSha256,
    report,
  };
}
