import { materialResponse } from '../routes/studioMaterialProjection.js';
import { inspectRenderedVisuals } from '../lib/renderVisualQuality.js';
import { downloadHeygenSubtitles, heygenConfigured, heygenRequest, listHeygenAvatars, submitHeygenVideo, downloadHeygenOutput } from '../integrations/heygen.js';
import { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl, tenantAssetDir } from '../lib/assetAccess.js';
import { commercialDigitalHumanGate } from '../lib/creativeTransformation.js';
import { MEDIA_DIR, DIGITAL_HUMAN_JOBS_FILE, DIGITAL_HUMAN_MAX_OUTPUT_BYTES, TTS_ROOT } from './runtimeConfig.js';
import type { DigitalHumanQualityReport, DigitalHumanJob } from './contracts.js';
import type { StudioApplicationPorts } from './applicationPorts.js';

export function createDigitalHumanRuntime(deps: Pick<StudioApplicationPorts, 'createGeneratedVideoMaterial' | 'persistMaterials' | 'loadMaterials' | 'studioRouter'>) {
  const createGeneratedVideoMaterial: StudioApplicationPorts['createGeneratedVideoMaterial'] = (...args) => deps.createGeneratedVideoMaterial(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const studioRouter = deps.studioRouter;

  const digitalHumanRefreshes = new Map<string, Promise<DigitalHumanJob>>();

  function loadDigitalHumanJobs(): DigitalHumanJob[] {
    try { return JSON.parse(fs.readFileSync(DIGITAL_HUMAN_JOBS_FILE, 'utf8')) as DigitalHumanJob[]; }
    catch { return []; }
  }

  function persistDigitalHumanJobs(list: DigitalHumanJob[]): void {
    fs.mkdirSync(path.dirname(DIGITAL_HUMAN_JOBS_FILE), { recursive: true });
    const temp = `${DIGITAL_HUMAN_JOBS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(temp, DIGITAL_HUMAN_JOBS_FILE);
  }

  function updateDigitalHumanJob(id: string, patch: Partial<DigitalHumanJob>): DigitalHumanJob {
    const list = loadDigitalHumanJobs();
    const index = list.findIndex(item => item.id === id);
    if (index < 0) throw new Error('digital human job not found');
    if (list[index]!.provider === 'heygen' && list[index]!.status === 'cancelled' && patch.status !== 'cancelled') return list[index]!;
    const next = { ...list[index]!, ...patch, updatedAt: new Date().toISOString() };
    list[index] = next;
    persistDigitalHumanJobs(list);
    return next;
  }

  function digitalHumanConfig() {
    const baseUrl = String(process.env.DIGITAL_HUMAN_API_URL || '').trim().replace(/\/+$/, '');
    const apiKey = String(process.env.DIGITAL_HUMAN_API_KEY || '').trim();
    const provider = String(process.env.DIGITAL_HUMAN_PROVIDER || 'latentsync').trim() || 'latentsync';
    const timeoutMs = Math.max(10_000, Number(process.env.DIGITAL_HUMAN_API_TIMEOUT_MS || 30_000));
    return { baseUrl, apiKey, provider, timeoutMs };
  }

  function digitalHumanProviderHeaders(): Record<string, string> {
    const { apiKey } = digitalHumanConfig();
    return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  }

  async function digitalHumanFetch(url: string, init?: RequestInit): Promise<globalThis.Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), digitalHumanConfig().timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function safeProviderOutputUrl(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let output: URL;
    let provider: URL;
    try { output = new URL(raw); provider = new URL(digitalHumanConfig().baseUrl); }
    catch { return ''; }
    if (!['https:', 'http:'].includes(output.protocol)) return '';
    const allowed = new Set([
      provider.host,
      ...String(process.env.DIGITAL_HUMAN_OUTPUT_HOSTS || '').split(',').map(item => item.trim()).filter(Boolean),
    ]);
    return allowed.has(output.host) ? output.toString() : '';
  }

  function publicDigitalHumanJob(job: DigitalHumanJob) {
    const { tenantId: _tenantId, voiceoverUrl: _voiceoverUrl, ...safe } = job;
    return { ...safe, ...(job.outputUrl?.startsWith('/') ? { outputUrl: signAssetUrl(job.outputUrl.split('?')[0], job.tenantId) } : {}) };
  }

  function appAssetUrl(req: Request, value: string): string {
    if (/^https?:\/\//i.test(value)) return value;
    const base = `${req.protocol}://${req.get('host')}`;
    return `${base}${value.startsWith('/') ? value : `/${value}`}`;
  }

  async function finalizeDigitalHumanOutput(job: DigitalHumanJob, outputUrl: string, providerQuality: DigitalHumanQualityReport): Promise<DigitalHumanJob> {
    const commercialGate = commercialDigitalHumanGate(providerQuality || {}, job.mode);
    if (!providerQuality || !commercialGate.passed) {
      return updateDigitalHumanJob(job.id, {
        status: 'review', stage: 'quality_review', progress: 100,
        qualityReport: {
          ...providerQuality,
          passed: false,
          gateVersion: 'commercial-v1',
          gateFailures: commercialGate.failures,
          notes: [...(providerQuality?.notes || []), ...commercialGate.failures, '商业质量门禁未通过，禁止自动进入成片与发布。'],
        },
      });
    }
    const response = await digitalHumanFetch(outputUrl, { headers: digitalHumanProviderHeaders() });
    if (!response.ok) throw new Error(`数字人成片下载失败（${response.status}）`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') throw new Error('数字人服务返回的不是视频');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > DIGITAL_HUMAN_MAX_OUTPUT_BYTES) throw new Error('数字人成片超过 110MB 限制');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > DIGITAL_HUMAN_MAX_OUTPUT_BYTES) throw new Error('数字人成片大小无效');

    const outputDir = tenantAssetDir(MEDIA_DIR, job.tenantId);
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = `${job.id}.mp4`;
    fs.writeFileSync(path.join(outputDir, filename), bytes);
    const material = await createGeneratedVideoMaterial({
      title: `视频保真数字人口播 · ${job.avatarName}`,
      filename,
      duration: Number(providerQuality.durationSeconds) || 0,
      tenantId: job.tenantId,
      sourceType: 'digital-human',
    });
    if (!material) throw new Error('数字人成片未能写入素材库');
    material.folder = 'presenter';
    persistMaterials(loadMaterials().map(item => item.id === material.id ? material : item));
    return updateDigitalHumanJob(job.id, {
      status: 'completed', stage: 'completed', progress: 100,
      outputMaterialId: material.id, outputUrl: material.url || undefined,
      qualityReport: { ...providerQuality, passed: true, gateVersion: 'commercial-v1', gateFailures: [] }, completedAt: new Date().toISOString(),
    });
  }

  async function refreshDigitalHumanJob(jobId: string, req?: Request, options: { providerPollOnly?: boolean } = {}): Promise<DigitalHumanJob> {
    const existingRefresh = digitalHumanRefreshes.get(jobId);
    if (existingRefresh) return existingRefresh;
    const task = (async () => {
      let job = loadDigitalHumanJobs().find(item => item.id === jobId);
      if (!job) throw new Error('digital human job not found');
      if (['completed', 'review', 'failed', 'cancelled'].includes(job.status)) return job;
      if (job.provider === 'heygen') return advanceHeygenJob(job, options.providerPollOnly === true);
      const { baseUrl, provider } = digitalHumanConfig();
      if (!baseUrl) return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'configuration', errorCode: 'PROVIDER_NOT_CONFIGURED', errorMessage: '数字人推理服务尚未配置。' });

      if (!job.providerTaskId) {
        if (!req) return job;
        const material = loadMaterials().find(item => item.id === job!.avatarMaterialId && item.tenantId === job!.tenantId && item.scope === 'own');
        if (!material) return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'input_validation', errorCode: 'AVATAR_NOT_FOUND', errorMessage: '人物素材不存在或不属于当前企业。' });
        const avatar = await materialResponse(material, job.tenantId);
        const response = await digitalHumanFetch(`${baseUrl}/v1/jobs`, {
          method: 'POST', headers: digitalHumanProviderHeaders(), body: JSON.stringify({
            externalJobId: job.id,
            provider,
            avatarVideoUrl: appAssetUrl(req, String(avatar.url || '')),
            audioUrl: appAssetUrl(req, job.voiceoverUrl),
            script: job.scriptSnapshot,
            language: job.language,
            mode: job.mode,
            output: { ratio: '9:16', container: 'mp4' },
          }),
        });
        const payload = await response.json().catch(() => ({})) as any;
        if (!response.ok || !payload.id) throw new Error(String(payload.error || `数字人服务提交失败（${response.status}）`));
        job = updateDigitalHumanJob(job.id, { providerTaskId: String(payload.id), status: 'processing', stage: String(payload.stage || 'inference'), progress: Math.max(1, Math.min(95, Number(payload.progress) || 5)) });
      }

      const response = await digitalHumanFetch(`${baseUrl}/v1/jobs/${encodeURIComponent(job.providerTaskId!)}`, { headers: digitalHumanProviderHeaders() });
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok) throw new Error(String(payload.error || `数字人服务查询失败（${response.status}）`));
      const providerStatus = String(payload.status || 'processing');
      if (providerStatus === 'failed') return updateDigitalHumanJob(job.id, { status: 'failed', stage: String(payload.stage || 'inference'), progress: Math.max(0, Math.min(99, Number(payload.progress) || job.progress)), errorCode: String(payload.errorCode || 'PROVIDER_FAILED'), errorMessage: String(payload.error || '数字人生成失败') });
      if (providerStatus === 'cancelled') return updateDigitalHumanJob(job.id, { status: 'cancelled', stage: 'cancelled', progress: job.progress });
      if (providerStatus !== 'completed') return updateDigitalHumanJob(job.id, { status: providerStatus === 'quality_check' ? 'quality_check' : 'processing', stage: String(payload.stage || 'inference'), progress: Math.max(job.progress, Math.min(95, Number(payload.progress) || job.progress)) });

      const outputUrl = safeProviderOutputUrl(payload.outputUrl);
      if (!outputUrl) throw new Error('数字人服务返回了不受信任的输出地址');
      return finalizeDigitalHumanOutput(job, outputUrl, payload.quality as DigitalHumanQualityReport);
    })().catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      const current = loadDigitalHumanJobs().find(item => item.id === jobId);
      if (current?.provider === 'heygen' && current.providerTaskId && /fetch failed|timeout|timed out|aborted|HeyGen (429|5\d\d)/i.test(message)) {
        return updateDigitalHumanJob(jobId, { status: 'processing', stage: 'heygen_rendering', errorCode: 'PROVIDER_POLL_RETRY', errorMessage: '网络暂时不可用，继续查询原 HeyGen 任务，不重复生成。' });
      }
      return updateDigitalHumanJob(jobId, { status: 'failed', stage: 'provider', errorCode: 'PROVIDER_ERROR', errorMessage: message });
    }).finally(() => digitalHumanRefreshes.delete(jobId));
    digitalHumanRefreshes.set(jobId, task);
    return task;
  }

  const digitalHumanRecoveryTimer = setInterval(() => {
    if (!digitalHumanConfig().baseUrl && !heygenConfigured()) return;
    for (const job of loadDigitalHumanJobs().filter(item => item.providerTaskId && ['processing', 'quality_check'].includes(item.status)).slice(0, 20)) {
      void refreshDigitalHumanJob(job.id);
    }
  }, 15_000);

  digitalHumanRecoveryTimer.unref?.();

  function validDigitalHumanVoiceoverUrl(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 1200) return '';
    if (raw.startsWith('/tts/') || /^\/api\/overseas\/studio\/private-assets\/tts\//.test(raw)) return raw;
    return '';
  }

  async function advanceHeygenJob(job: DigitalHumanJob, providerPollOnly = false): Promise<DigitalHumanJob> {
    if (!job.providerTaskId) {
      if (providerPollOnly) throw new Error('heygen_paid_submission_authorization_missing');
      const audioPath = path.join(tenantAssetDir(TTS_ROOT, job.tenantId), path.basename(new URL(job.voiceoverUrl, 'http://local').pathname));
      const providerTaskId = await submitHeygenVideo({ id: job.id, avatarId: job.heygenAvatarId!, audioPath, title: '数字人口播' });
      job = updateDigitalHumanJob(job.id, { providerTaskId, status: 'processing', stage: 'heygen_rendering', progress: 10 });
    }
    const payload = await heygenRequest(`videos/${encodeURIComponent(job.providerTaskId!)}`);
    const result = payload.data || {};
    if (result.status === 'failed') return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'provider', errorMessage: String(result.failure_message || 'HeyGen 生成失败') });
    if (result.status !== 'completed') return job;
    const subtitleCues = await downloadHeygenSubtitles(String(result.subtitle_url || ''), Number(result.duration), job.scriptSnapshot);
    const bytes = await downloadHeygenOutput(String(result.video_url || ''));
    const outputDir = tenantAssetDir(MEDIA_DIR, job.tenantId);
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = `${job.id}.mp4`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, bytes);
    const visual = await inspectRenderedVisuals({ outputPath, expectedDuration: Number(result.duration) || 1, expectedUniqueScenes: 1 });
    if (!visual.passed) return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'quality', errorMessage: visual.failures.join('；') });
    const material = await createGeneratedVideoMaterial({ title: `HeyGen 数字人口播 · ${job.avatarName}`, filename, duration: Number(result.duration) || 0, tenantId: job.tenantId, sourceType: 'digital-human' });
    if (!material) throw Error('HeyGen 成片素材保存失败');
    material.folder = 'presenter';
    persistMaterials(loadMaterials().map(item => item.id === material.id ? material : item));
    return updateDigitalHumanJob(job.id, { status: 'review', stage: 'human_quality_review', progress: 100, subtitleCues, errorCode: undefined, errorMessage: undefined, outputMaterialId: material.id, outputUrl: material.url || undefined,
      qualityReport: { passed: false, durationSeconds: Number(result.duration) || 0, notes: ['文件与画面检查通过；请预览确认人物、口型及声音后使用。HeyGen 不提供本系统的口型分数，不伪造分数。'] } });
  }

  function heygenOutputPath(tenantId: string, jobId: string): string { return path.join(tenantAssetDir(MEDIA_DIR, tenantId), `${jobId}.mp4`); }

  const heygenCreationQueues = new Map<string, Promise<unknown>>();

  async function ensureHeygenAutomationJob(input: { tenantId: string; projectId: string; avatarId: string; consent: boolean; voiceoverUrl: string; script: string; language: string; providerPollOnly?: boolean }): Promise<DigitalHumanJob> {
    const key = input.tenantId;
    const previous = heygenCreationQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => ensureHeygenJobLocked(input));
    heygenCreationQueues.set(key, next);
    try { return await next; } finally { if (heygenCreationQueues.get(key) === next) heygenCreationQueues.delete(key); }
  }

  async function ensureHeygenJobLocked(input: { tenantId: string; projectId: string; avatarId: string; consent: boolean; voiceoverUrl: string; script: string; language: string; providerPollOnly?: boolean }): Promise<DigitalHumanJob> {
    if (!input.consent || !input.avatarId) throw Error('请选择 HeyGen 人物并确认使用权');
    let job = loadDigitalHumanJobs().slice().reverse().find(item => item.tenantId === input.tenantId && item.projectId === input.projectId && item.provider === 'heygen' && item.scriptSnapshot === input.script && item.heygenAvatarId === input.avatarId && item.voiceoverUrl === input.voiceoverUrl);
    if (!job) {
      if (input.providerPollOnly) throw new Error('heygen_paid_submission_authorization_missing');
      if (loadDigitalHumanJobs().filter(item => item.tenantId === input.tenantId && ['queued', 'submitting', 'processing', 'quality_check'].includes(item.status)).length >= 2) throw Error('当前已有 2 个数字人任务在运行，请稍后再试');
      const avatar = (await listHeygenAvatars()).find(item => item.id === input.avatarId);
      if (!avatar) throw Error('所选 HeyGen 人物不可用，请重新选择');
      const now = new Date().toISOString();
      job = { id: randomUUID(), tenantId: input.tenantId, projectId: input.projectId, heygenAvatarId: input.avatarId, avatarMaterialId: '', avatarName: avatar.name,
        voiceoverUrl: input.voiceoverUrl, scriptSnapshot: input.script, language: input.language, mode: 'quality', consentConfirmed: true, commercialRightsStatus: 'cleared', provider: 'heygen', status: 'queued', stage: 'queued', progress: 0, versionNumber: 1, createdAt: now, updatedAt: now };
      persistDigitalHumanJobs([...loadDigitalHumanJobs(), job]);
    }
    return refreshDigitalHumanJob(job.id, undefined, { providerPollOnly: input.providerPollOnly === true });
  }

  function registerGetDigitalHumanAvatars() {
    studioRouter.get('/digital-human/avatars', async (_req, res) => {
      try { res.json({ items: await listHeygenAvatars() }); } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'HeyGen 人物不可用', items: [] }); }
    });
  }

  function registerPostDigitalHumanJobsIdApprove() {
    studioRouter.post('/digital-human/jobs/:id/approve', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const job = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
      if (!job || job.provider !== 'heygen' || job.status !== 'review' || !job.outputMaterialId) { res.status(409).json({ error: '没有可确认的 HeyGen 成片' }); return; }
      if (req.body?.reviewed !== true) { res.status(400).json({ error: '请先预览并确认人物、口型与声音' }); return; }
      const updated = updateDigitalHumanJob(job.id, { status: 'completed', stage: 'completed', completedAt: new Date().toISOString(), qualityReport: { ...job.qualityReport, passed: true, notes: [...(job.qualityReport?.notes || []), '用户已预览并确认人物、口型与声音'] } });
      res.json({ ok: true, job: publicDigitalHumanJob(updated) });
    });
  }

  function digitalHumanCapabilities() {
    return { available: heygenConfigured(), provider: 'heygen', features: ['lip_sync'], modes: [{ id: 'quality', label: 'HeyGen 数字人' }], output: { ratio: '9:16', container: 'mp4' }, qualityGateRequired: true, maxConcurrentJobs: 2,
      unavailableReason: heygenConfigured() ? undefined : '尚未配置 HeyGen 服务（HEYGEN_API_KEY）' };
  }

  function registerGetDigitalHumanCapabilities() {
    studioRouter.get('/digital-human/capabilities', (_req, res) => {
      res.json(digitalHumanCapabilities());
    });
  }

  return { loadDigitalHumanJobs, persistDigitalHumanJobs, updateDigitalHumanJob, digitalHumanConfig, digitalHumanProviderHeaders, digitalHumanFetch, publicDigitalHumanJob, refreshDigitalHumanJob, validDigitalHumanVoiceoverUrl, heygenOutputPath, ensureHeygenAutomationJob, digitalHumanCapabilities, registerGetDigitalHumanAvatars, registerPostDigitalHumanJobsIdApprove, registerGetDigitalHumanCapabilities };
}
