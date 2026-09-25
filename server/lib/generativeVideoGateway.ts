import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateSeedanceCostCny, releaseSeedanceBudget, reserveSeedanceBudget } from './seedanceBudget.js';

export interface ConceptVideoResult {
  providerId: 'seedance' | 'veo';
  model: string;
  providerTaskId: string;
  bytes: Buffer;
  duration: number;
  estimatedCostCny: number;
}

export interface ConceptVideoInput {
  tenantId: string;
  prompt: string;
  durationSeconds: number;
  ratio: '9:16';
  resolution?: '720p';
  idempotencyKey: string;
  timeoutMs: number;
}

type SeedanceTask = Record<string, any>;

function deepUrl(value: unknown): string | null {
  if (typeof value === 'string') return /^https:\/\//i.test(value) ? value : null;
  if (Array.isArray(value)) return value.map(deepUrl).find(Boolean) || null;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['video_url', 'videoUrl', 'url', 'content_url']) {
      const found = deepUrl(record[key]);
      if (found) return found;
    }
    return Object.values(record).map(deepUrl).find(Boolean) || null;
  }
  return null;
}

async function jsonRequest(fetcher: typeof fetch, url: string, apiKey: string, init?: RequestInit): Promise<SeedanceTask> {
  const response = await fetcher(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: init?.signal || AbortSignal.timeout(45_000),
  });
  const value = await response.json().catch(() => ({})) as SeedanceTask;
  if (!response.ok) {
    const detail = value?.error?.message || value?.message || value?.error || response.statusText;
    throw new Error(`Seedance ${response.status}: ${String(detail).slice(0, 500)}`);
  }
  return value;
}

export async function generateSeedanceConceptVideo(input: ConceptVideoInput & {
  apiKey: string;
  model: string;
  baseUrl?: string;
  pollMs?: number;
  transport?: typeof fetch;
  reserveBudget?: typeof reserveSeedanceBudget;
  releaseBudget?: typeof releaseSeedanceBudget;
}): Promise<ConceptVideoResult> {
  if (!input.apiKey.trim()) throw new Error('Seedance 未配置方舟 API Key');
  // This gateway is deliberately text-only. Reference-person inputs belong to
  // the separately authorized digital-human pipeline and are never accepted.
  const fetcher = input.transport || fetch;
  const duration = Math.max(4, Math.min(15, Math.round(input.durationSeconds)));
  const resolution = input.resolution || '720p';
  const reserve = input.reserveBudget || reserveSeedanceBudget;
  const release = input.releaseBudget || releaseSeedanceBudget;
  const budget = reserve({ tenantId: input.tenantId, duration, resolution });
  if (!budget.ok || !budget.reservationId) throw new Error('seedance_monthly_budget_exceeded');
  const baseUrl = (input.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  let accepted = false;
  try {
    const created = await jsonRequest(fetcher, `${baseUrl}/contents/generations/tasks`, input.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: input.model,
        content: [{ type: 'text', text: input.prompt.slice(0, 8000) }],
        ratio: input.ratio,
        duration,
        resolution,
        generate_audio: false,
        watermark: false,
      }),
    });
    const taskId = String(created.id || created.data?.id || created.task?.id || '').trim();
    if (!taskId) throw new Error('Seedance 提交结果未知：未返回任务 ID，不能自动重试');
    accepted = true;
    const deadline = Date.now() + input.timeoutMs;
    let completed: SeedanceTask | null = null;
    while (Date.now() < deadline) {
      const task = await jsonRequest(fetcher, `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, input.apiKey);
      const status = String(task.status || task.data?.status || task.task?.status || '').toLowerCase();
      if (['succeeded', 'success', 'completed', 'done'].includes(status)) { completed = task; break; }
      if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status)) {
        throw new Error(`Seedance ${status}: ${String(task.error?.message || task.message || task.error || '').slice(0, 500)}`);
      }
      await new Promise(resolve => setTimeout(resolve, input.pollMs || 8_000));
    }
    if (!completed) throw new Error(`Seedance task ${taskId} timed out; do not resubmit automatically`);
    const url = deepUrl(completed);
    if (!url) throw new Error('Seedance 任务成功但没有输出 URL');
    const media = await fetcher(url, { signal: AbortSignal.timeout(Math.min(input.timeoutMs, 120_000)) });
    if (!media.ok) throw new Error(`Seedance 视频下载失败：${media.status}`);
    return {
      providerId: 'seedance', model: input.model, providerTaskId: taskId,
      bytes: Buffer.from(await media.arrayBuffer()), duration,
      estimatedCostCny: budget.reservedCny,
    };
  } catch (error) {
    if (!accepted) release(input.tenantId, budget.reservationId);
    throw error;
  }
}

export type VeoWorker = (job: Record<string, unknown>, timeoutMs: number) => Promise<Record<string, any>>;

function videoWorkerEnvironment(): NodeJS.ProcessEnv {
  const proxy = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890';
  return {
    ...process.env,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || '1',
    HTTPS_PROXY: process.env.HTTPS_PROXY || proxy,
    HTTP_PROXY: process.env.HTTP_PROXY || proxy,
    https_proxy: process.env.https_proxy || process.env.HTTPS_PROXY || proxy,
    http_proxy: process.env.http_proxy || process.env.HTTP_PROXY || proxy,
  };
}

export async function runVeoWorker(job: Record<string, unknown>, timeoutMs: number): Promise<Record<string, any>> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const worker = path.resolve(moduleDir, '../../scripts/gemini-video-worker.mjs');
  const outputDir = String(job.outputDir || path.resolve(process.cwd(), 'data/media/generated'));
  await fsp.mkdir(outputDir, { recursive: true });
  const jobFile = path.join(outputDir, `veo-job-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await fsp.writeFile(jobFile, JSON.stringify(job), 'utf8');
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, jobFile], { cwd: process.cwd(), env: videoWorkerEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Veo worker timed out')); }, timeoutMs + 30_000);
      child.stdout.on('data', chunk => { stdout += String(chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch { reject(new Error((stderr || `Veo worker exited with ${code}`).slice(0, 500))); }
      });
    });
  } finally {
    await fsp.rm(jobFile, { force: true });
  }
}

export async function generateVeoConceptVideo(input: ConceptVideoInput & {
  model: string;
  outputDirectory: string;
  worker?: VeoWorker;
  estimatedCostCny: number;
}): Promise<ConceptVideoResult> {
  const duration = Math.max(5, Math.min(8, Math.round(input.durationSeconds)));
  const output = await (input.worker || runVeoWorker)({
    prompt: input.prompt, model: input.model, ratio: input.ratio, duration,
    resolution: input.resolution || '720p', outputDir: input.outputDirectory,
    timeoutMs: input.timeoutMs, idempotencyKey: input.idempotencyKey,
  }, input.timeoutMs);
  if (output.ok !== true) throw new Error(String(output.error || 'Veo generation failed'));
  const file = String(output.file || '').trim();
  if (!file || path.basename(file) !== file) throw new Error('Veo worker returned an unsafe output filename');
  const filePath = path.join(input.outputDirectory, file);
  if (!fs.existsSync(filePath)) throw new Error('Veo worker output file is missing');
  return {
    providerId: 'veo', model: String(output.model || input.model),
    providerTaskId: String(output.id || input.idempotencyKey),
    bytes: await fsp.readFile(filePath), duration,
    estimatedCostCny: input.estimatedCostCny,
  };
}

export { estimateSeedanceCostCny };
