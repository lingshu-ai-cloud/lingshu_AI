import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true });

type WorkerStatus = 'queued' | 'processing' | 'quality_check' | 'completed' | 'failed' | 'cancelled';
interface WorkerJob {
  id: string;
  externalJobId: string;
  status: WorkerStatus;
  stage: string;
  progress: number;
  outputUrl?: string;
  quality?: {
    passed: boolean;
    lipSyncScore?: number;
    avOffsetFrames?: number;
    freezeSegments?: number;
    durationSeconds?: number;
    faceDetectionRate?: number;
    mouthJumpP95?: number;
    notes: string[];
  };
  errorCode?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const port = Math.max(1024, Number(process.env.DIGITAL_HUMAN_WORKER_PORT || 8792));
const host = String(process.env.DIGITAL_HUMAN_WORKER_HOST || '127.0.0.1');
const apiKey = String(process.env.DIGITAL_HUMAN_API_KEY || '').trim();
const hubUrl = String(process.env.DIGITAL_HUMAN_HUB_URL || '').trim().replace(/\/+$/, '');
const workerKey = String(process.env.DIGITAL_HUMAN_WORKER_KEY || apiKey).trim();
const workerId = String(process.env.DIGITAL_HUMAN_WORKER_ID || `gpu-${process.env.COMPUTERNAME || 'local'}`).trim();
const runnerSetting = String(process.env.DIGITAL_HUMAN_LOCAL_RUNNER || '').trim();
const runner = runnerSetting ? path.resolve(runnerSetting) : '';
const workRoot = path.resolve(process.env.DIGITAL_HUMAN_WORKER_DATA_DIR || path.join(rootDir, 'data', 'digital-human-worker'));
const jobsFile = path.join(workRoot, 'jobs.json');
const maxInputBytes = 110 * 1024 * 1024;
const allowedInputHosts = new Set(
  String(process.env.DIGITAL_HUMAN_WORKER_INPUT_HOSTS || '127.0.0.1,localhost')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
);
const running = new Map<string, ChildProcess>();
fs.mkdirSync(workRoot, { recursive: true });

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
  if (hubUrl && updated.externalJobId && ['processing', 'quality_check'].includes(updated.status)) {
    void hubFetch(`/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(updated.externalJobId)}/progress`, {
      method: 'POST',
      body: JSON.stringify({ workerId, status: updated.status, stage: updated.stage, progress: updated.progress }),
    }).catch(() => undefined);
  }
  return updated;
}

async function hubFetch(route: string, init?: RequestInit): Promise<Response> {
  if (!hubUrl || !workerKey) throw new Error('DIGITAL_HUMAN_HUB_URL / DIGITAL_HUMAN_WORKER_KEY 未配置');
  return fetch(`${hubUrl}${route}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerKey}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(120_000),
  });
}

function authorized(req: Request, res: Response, next: NextFunction): void {
  if (!apiKey) { next(); return; }
  if (req.headers.authorization !== `Bearer ${apiKey}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function safeInputUrl(value: unknown): URL {
  const parsed = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(parsed.protocol) || !allowedInputHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`input host is not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

async function download(url: URL, destination: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`input download failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxInputBytes) throw new Error('input exceeds 110 MB');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxInputBytes) throw new Error('input size is invalid');
  fs.writeFileSync(destination, bytes);
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runProcess(file: string, args: string[], jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: rootDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (jobId) running.set(jobId, child);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-8000); });
    child.on('error', reject);
    child.on('close', code => {
      if (jobId) running.delete(jobId);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${path.basename(file)} exited with code ${code}`));
    });
  });
}

function readQualityReport(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) throw new Error(`缺少质量检测报告: ${path.basename(file)}`);
  const report = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (report.passed !== true) throw new Error(`质量检测未通过: ${JSON.stringify(report.failures || [])}`);
  return report;
}

async function validateOutput(avatarPath: string, outputPath: string): Promise<NonNullable<WorkerJob['quality']>> {
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) throw new Error('数字人输出为空');
  if (sha256(avatarPath) === sha256(outputPath)) throw new Error('数字人服务返回了原人物视频，已拒绝回流');
  if (!ffmpegStatic) throw new Error('ffmpeg unavailable for output validation');
  await runProcess(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-frames:v', '1', '-f', 'null', '-']);
  await runProcess(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-map', '0:a:0', '-t', '1', '-f', 'null', '-']);
  const validationDir = path.join(path.dirname(outputPath), 'validation');
  fs.mkdirSync(validationDir, { recursive: true });
  const visual = readQualityReport(`${outputPath}.visual-quality.json`);
  const syncnet = readQualityReport(`${outputPath}.syncnet-quality.json`);
  const duration = Math.max(0.6, Number(visual.duration_seconds) || 0.6);
  const earlyFrame = path.join(validationDir, 'early.png');
  const lateFrame = path.join(validationDir, 'late.png');
  await runProcess(ffmpegStatic, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(0.35, duration * 0.2)), '-i', outputPath, '-frames:v', '1', earlyFrame]);
  await runProcess(ffmpegStatic, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0.4, duration * 0.8)), '-i', outputPath, '-frames:v', '1', lateFrame]);
  if (!fs.existsSync(earlyFrame) || !fs.existsSync(lateFrame) || sha256(earlyFrame) === sha256(lateFrame)) {
    throw new Error('表情数字人成片缺少可检测的人脸动作，已拒绝回流');
  }
  fs.rmSync(validationDir, { recursive: true, force: true });
  return {
    passed: true,
    lipSyncScore: Number(syncnet.syncnet_confidence),
    avOffsetFrames: Number(syncnet.av_offset_frames),
    freezeSegments: 0,
    durationSeconds: Number(visual.duration_seconds),
    faceDetectionRate: Number(visual.face_detection_rate),
    mouthJumpP95: Number(visual.mouth_jump_p95),
    notes: [
      'MuseTalk 1.5 + MediaPipe 动态嘴部裁剪推理成功',
      `SyncNet 通过：置信度 ${Number(syncnet.syncnet_confidence).toFixed(3)}，音画偏移 ${Number(syncnet.av_offset_frames)} 帧`,
      `嘴部时序稳定性通过：P95 跳变 ${Number(visual.mouth_jump_p95).toFixed(4)}，人脸跟踪 ${(Number(visual.face_detection_rate) * 100).toFixed(1)}%`,
      '头部、颈部与肩部运动沿用真人源视频，输出音轨和编码均已验证',
    ],
  };
}

async function executeJob(id: string, input: { avatarVideoUrl: string; audioUrl: string; audioSegment?: { startSeconds: number; endSeconds: number } }): Promise<void> {
  const jobDir = path.join(workRoot, id);
  fs.mkdirSync(jobDir, { recursive: true });
  const avatarPath = path.join(jobDir, 'avatar.mp4');
  const sourceAudioPath = path.join(jobDir, 'voice-source');
  const audioPath = path.join(jobDir, 'voice.wav');
  const rawOutputPath = path.join(jobDir, 'result.raw.mp4');
  const outputPath = path.join(jobDir, 'result.mp4');
  try {
    updateJob(id, { status: 'processing', stage: 'download_inputs', progress: 8 });
    await Promise.all([
      download(safeInputUrl(input.avatarVideoUrl), avatarPath),
      download(safeInputUrl(input.audioUrl), sourceAudioPath),
    ]);
    if (!ffmpegStatic) throw new Error('ffmpeg unavailable for audio preparation');
    const segment = input.audioSegment;
    const trimArgs = segment ? ['-ss', String(segment.startSeconds), '-to', String(segment.endSeconds)] : [];
    await runProcess(ffmpegStatic, ['-y', '-hide_banner', '-loglevel', 'error', ...trimArgs, '-i', sourceAudioPath, '-vn', '-ar', '16000', '-ac', '1', audioPath]);
    if (!runner || !fs.existsSync(runner)) throw new Error('DIGITAL_HUMAN_LOCAL_RUNNER 未配置或文件不存在');
    updateJob(id, { stage: 'video_preserving_lip_sync', progress: 30 });
    await runProcess('pwsh.exe', ['-NoProfile', '-File', runner, '-Video', avatarPath, '-Audio', audioPath, '-Output', rawOutputPath], id);
    updateJob(id, { stage: 'vertical_composition', progress: 82 });
    await runProcess(ffmpegStatic, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', rawOutputPath,
      '-filter_complex', '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=60,eq=brightness=-0.28:saturation=0.55[bg];[0:v]scale=1000:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]',
      '-map', '[v]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputPath,
    ], id);
    for (const suffix of ['.visual-quality.json', '.syncnet-quality.json']) {
      const report = `${rawOutputPath}${suffix}`;
      if (fs.existsSync(report)) fs.copyFileSync(report, `${outputPath}${suffix}`);
    }
    updateJob(id, { status: 'quality_check', stage: 'output_validation', progress: 88 });
    const quality = await validateOutput(avatarPath, outputPath);
    updateJob(id, {
      status: 'completed', stage: 'completed', progress: 100,
      outputUrl: `http://${host}:${port}/outputs/${encodeURIComponent(id)}.mp4`,
      quality, error: undefined, errorCode: undefined,
    });
  } catch (error) {
    const cancelled = jobs.find(job => job.id === id)?.status === 'cancelled';
    if (!cancelled) updateJob(id, {
      status: 'failed', stage: 'failed', progress: Math.min(99, jobs.find(job => job.id === id)?.progress || 0),
      errorCode: 'LOCAL_RUNNER_FAILED', error: error instanceof Error ? error.message : String(error),
    });
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(authorized);

app.get('/health', (_req, res) => res.json({ ok: true, provider: 'musetalk-v1.5-local', features: ['lip_sync', 'source_motion', 'neck_shoulder_preservation'], runnerConfigured: Boolean(runner && fs.existsSync(runner)) }));

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
  const now = new Date().toISOString();
  const job: WorkerJob = {
    id: randomUUID(), externalJobId,
    status: 'queued', stage: 'queued', progress: 0, createdAt: now, updatedAt: now,
  };
  jobs.push(job);
  persistJobs();
  void executeJob(job.id, { avatarVideoUrl: avatarVideoUrl.toString(), audioUrl: audioUrl.toString(), audioSegment });
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
  running.get(job.id)?.kill();
  res.json(updateJob(job.id, { status: 'cancelled', stage: 'cancelled', error: undefined, errorCode: undefined }));
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
async function pollHub(): Promise<void> {
  if (!hubUrl || !workerKey || claiming || running.size > 0) return;
  claiming = true;
  try {
    const response = await hubFetch(`/api/overseas/studio/digital-human/worker/claim?workerId=${encodeURIComponent(workerId)}`);
    if (response.status === 204) return;
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok || !payload?.job?.id) throw new Error(String(payload?.error || `claim failed (${response.status})`));
    const remote = payload.job;
    const now = new Date().toISOString();
    const local: WorkerJob = { id: randomUUID(), externalJobId: String(remote.id), status: 'queued', stage: 'queued', progress: 0, createdAt: now, updatedAt: now };
    jobs.push(local); persistJobs();
    await executeJob(local.id, { avatarVideoUrl: String(remote.avatarVideoUrl), audioUrl: String(remote.audioUrl), audioSegment: remote.audioSegment });
    const finished = jobs.find(item => item.id === local.id)!;
    if (finished.status === 'completed') {
      const outputPath = path.join(workRoot, local.id, 'result.mp4');
      const result = await hubFetch(`/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(remote.id)}/result`, {
        method: 'POST',
        body: JSON.stringify({ workerId, status: 'completed', quality: finished.quality, dataBase64: fs.readFileSync(outputPath).toString('base64') }),
      });
      if (!result.ok) throw new Error(`result upload failed (${result.status}): ${await result.text()}`);
    } else {
      await hubFetch(`/api/overseas/studio/digital-human/worker/jobs/${encodeURIComponent(remote.id)}/result`, {
        method: 'POST',
        body: JSON.stringify({ workerId, status: 'failed', errorCode: finished.errorCode, error: finished.error }),
      });
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
  pollTimer.unref?.();
  void pollHub();
}
