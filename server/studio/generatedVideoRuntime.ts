import { humanSize, type Material } from '../routes/studioMaterialProjection.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { runVeoWorker } from '../lib/generativeVideoGateway.js';
import { tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { objectStorageEnabled, objectStorageUpload } from '../storage/objectStorage.js';
import { materialAssetContentType, materialAssetObjectKey } from '../storage/materialAssets.js';
import { SEEDANCE_BASE_URL, MEDIA_DIR } from './runtimeConfig.js';
import type { StudioApplicationPorts } from './applicationPorts.js';

export function createGeneratedVideoRuntime(deps: Pick<StudioApplicationPorts, 'extractPoster' | 'loadMaterials' | 'persistMaterials'>) {
  const extractPoster: StudioApplicationPorts['extractPoster'] = (...args) => deps.extractPoster(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);

  function geminiVideoConfig() {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const model = (process.env.GEMINI_VIDEO_MODEL || 'veo-2.0-generate-001').trim();
    return { apiKey, model };
  }

  function isGeminiVideoEnabled(): boolean {
    return process.env.GEMINI_VIDEO_ENABLED === 'true';
  }

  function seedanceVideoConfig() {
    const apiKey = (process.env.SEEDANCE_API_KEY || '').trim();
    const baseUrl = (process.env.SEEDANCE_BASE_URL || SEEDANCE_BASE_URL).replace(/\/+$/, '');
    const model = (process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128').trim();
    const timeoutMs = Math.max(60_000, Number(process.env.SEEDANCE_VIDEO_TIMEOUT_MS || 600_000));
    const pollIntervalMs = Math.max(2_000, Number(process.env.SEEDANCE_VIDEO_POLL_INTERVAL_MS || 8_000));
    return { apiKey, baseUrl, model, timeoutMs, pollIntervalMs };
  }

  function isSeedanceVideoEnabled(): boolean {
    return process.env.SEEDANCE_VIDEO_ENABLED === 'true';
  }

  function normalizeGeminiVideoDuration(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 8;
    // Current Gemini/Veo API accepts only 5-8 seconds for durationSeconds.
    return Math.max(5, Math.min(8, Math.round(n)));
  }

  function normalizeSeedanceVideoDuration(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 8;
    // Seedance 2.0 supports integer durations from 4 to 15 seconds.
    return Math.max(4, Math.min(15, Math.round(n)));
  }

  function generatedMediaUrl(tenantId: string, file: string): string {
    return `/media/${tenantAssetRelativePath(tenantId, file)}`;
  }

  async function createGeneratedVideoMaterial(input: {
    title: string;
    filename: string;
    duration: number;
    tenantId: string;
    sourceType?: string;
  }): Promise<Material | null> {
    const filePath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), input.filename);
    if (!fs.existsSync(filePath)) return null;
    const id = randomUUID();
    const posterFile = `${id}.poster.jpg`;
    const posterPath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), posterFile);
    const material: Material = {
      id,
      name: input.title || 'Seedance 生成视频',
      folder: 'upload',
      type: 'video',
      duration: Number(input.duration) || 0,
      size: humanSize(fs.statSync(filePath).size),
      file: tenantAssetRelativePath(input.tenantId, input.filename),
      url: generatedMediaUrl(input.tenantId, input.filename),
      scope: 'own',
      tenantId: input.tenantId,
      sourceType: input.sourceType || 'ai-generated',
      createdAt: new Date().toISOString(),
    };
    const posterOk = await extractPoster(filePath, posterPath, material.duration > 1 ? 1 : 0);
    if (posterOk) material.poster = generatedMediaUrl(input.tenantId, posterFile);
    if (objectStorageEnabled()) {
      material.objectKey = materialAssetObjectKey(input.tenantId, input.filename);
      await objectStorageUpload({ key: material.objectKey, body: fs.readFileSync(filePath), contentType: materialAssetContentType(input.filename) });
      material.url = '';
      if (posterOk) {
        material.posterObjectKey = materialAssetObjectKey(input.tenantId, posterFile);
        await objectStorageUpload({ key: material.posterObjectKey, body: fs.readFileSync(posterPath), contentType: 'image/jpeg' });
        material.poster = undefined;
      }
      fs.rmSync(filePath, { force: true });
      fs.rmSync(posterPath, { force: true });
    }
    const list = loadMaterials().filter(item => item.id !== material.id);
    list.push(material);
    persistMaterials(list);
    return material;
  }

  async function seedanceFetchJson(url: string, apiKey: string, init?: RequestInit): Promise<any> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = json?.error?.message || json?.message || json?.error || text || response.statusText;
      const failure = new Error(`Seedance API ${response.status}: ${String(detail).slice(0, 500)}`) as Error & { providerRejected?: boolean };
      failure.providerRejected = [400, 401, 403, 404, 422].includes(response.status);
      throw failure;
    }
    return json;
  }

  function findUrlDeep(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return /^https?:\/\/.+/i.test(value) ? value : null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findUrlDeep(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of ['url', 'video_url', 'videoUrl', 'content_url', 'contentUrl']) {
        const found = findUrlDeep(obj[key]);
        if (found) return found;
      }
      for (const item of Object.values(obj)) {
        const found = findUrlDeep(item);
        if (found) return found;
      }
    }
    return null;
  }

  function seedanceTaskStatus(task: any): string {
    return String(task?.status || task?.data?.status || task?.task?.status || '').toLowerCase();
  }

  function seedanceTaskId(task: any): string {
    return String(task?.id || task?.data?.id || task?.task?.id || '').trim();
  }

  function summarizeSeedanceError(error: unknown): string {
    const text = String((error as any)?.message ?? error);
    if (/not activated the model|do not have access|model or endpoint/i.test(text)) {
      return '当前方舟账号尚未开通所选 Seedance 模型服务。请在火山方舟控制台开通 Seedance 2.0 模型，或把 SEEDANCE_MODEL 改成已开通的模型/接入点 ID。';
    }
    if (/api key/i.test(text)) {
      return 'Seedance API Key 无效或不属于当前区域，请检查火山方舟 API Key 和 SEEDANCE_BASE_URL。';
    }
    return text.slice(0, 500);
  }

  async function waitForSeedanceTask(config: ReturnType<typeof seedanceVideoConfig>, taskId: string): Promise<any> {
    const deadline = Date.now() + config.timeoutMs;
    let lastTask: any = null;
    while (Date.now() < deadline) {
      lastTask = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, config.apiKey);
      const status = seedanceTaskStatus(lastTask);
      if (['succeeded', 'success', 'completed', 'done'].includes(status)) return lastTask;
      if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status)) {
        const reason = lastTask?.error?.message || lastTask?.message || lastTask?.error || status;
        throw new Error(`Seedance 任务失败：${String(reason).slice(0, 500)}`);
      }
      await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
    }
    throw new Error(`Seedance 任务超时${lastTask ? `，最后状态：${seedanceTaskStatus(lastTask) || 'unknown'}` : ''}`);
  }

  async function downloadGeneratedVideo(url: string, filename: string, tenantId: string): Promise<string> {
    const outputDir = tenantAssetDir(MEDIA_DIR, tenantId);
    fs.mkdirSync(outputDir, { recursive: true });
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`视频下载失败：${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(path.join(outputDir, filename), Buffer.from(arrayBuffer));
    return generatedMediaUrl(tenantId, filename);
  }

  async function runGeminiVideoWorker(job: Record<string, unknown>, timeoutMs: number) {
    return runVeoWorker(job, timeoutMs);
  }

  return { geminiVideoConfig, isGeminiVideoEnabled, seedanceVideoConfig, isSeedanceVideoEnabled, normalizeGeminiVideoDuration, normalizeSeedanceVideoDuration, createGeneratedVideoMaterial, seedanceFetchJson, findUrlDeep, seedanceTaskId, summarizeSeedanceError, waitForSeedanceTask, downloadGeneratedVideo, runGeminiVideoWorker };
}
