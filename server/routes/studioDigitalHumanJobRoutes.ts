import { materialResponse } from './studioMaterialProjection.js';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import { type AuthLocals } from '../middleware/auth.js';
import type { DigitalHumanJob } from '../studio/contracts.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioDigitalHumanJobRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadDigitalHumanJobs' | 'publicDigitalHumanJob' | 'digitalHumanCapabilities' | 'validDigitalHumanVoiceoverUrl' | 'ensureHeygenAutomationJob' | 'loadMaterials' | 'updateDigitalHumanJob' | 'refreshDigitalHumanJob' | 'persistDigitalHumanJobs' | 'digitalHumanConfig' | 'digitalHumanFetch' | 'digitalHumanProviderHeaders'>) {
  const studioRouter = deps.studioRouter;
  const loadDigitalHumanJobs: StudioApplicationPorts['loadDigitalHumanJobs'] = (...args) => deps.loadDigitalHumanJobs(...args);
  const publicDigitalHumanJob: StudioApplicationPorts['publicDigitalHumanJob'] = (...args) => deps.publicDigitalHumanJob(...args);
  const digitalHumanCapabilities: StudioApplicationPorts['digitalHumanCapabilities'] = (...args) => deps.digitalHumanCapabilities(...args);
  const validDigitalHumanVoiceoverUrl: StudioApplicationPorts['validDigitalHumanVoiceoverUrl'] = (...args) => deps.validDigitalHumanVoiceoverUrl(...args);
  const ensureHeygenAutomationJob: StudioApplicationPorts['ensureHeygenAutomationJob'] = (...args) => deps.ensureHeygenAutomationJob(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const updateDigitalHumanJob: StudioApplicationPorts['updateDigitalHumanJob'] = (...args) => deps.updateDigitalHumanJob(...args);
  const refreshDigitalHumanJob: StudioApplicationPorts['refreshDigitalHumanJob'] = (...args) => deps.refreshDigitalHumanJob(...args);
  const persistDigitalHumanJobs: StudioApplicationPorts['persistDigitalHumanJobs'] = (...args) => deps.persistDigitalHumanJobs(...args);
  const digitalHumanConfig: StudioApplicationPorts['digitalHumanConfig'] = (...args) => deps.digitalHumanConfig(...args);
  const digitalHumanFetch: StudioApplicationPorts['digitalHumanFetch'] = (...args) => deps.digitalHumanFetch(...args);
  const digitalHumanProviderHeaders: StudioApplicationPorts['digitalHumanProviderHeaders'] = (...args) => deps.digitalHumanProviderHeaders(...args);

  function registerGetDigitalHumanJobs() {
    studioRouter.get('/digital-human/jobs', (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const projectId = String(req.query.projectId || '').trim();
      const jobs = loadDigitalHumanJobs()
        .filter(item => item.tenantId === tenantId && (!projectId || item.projectId === projectId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50)
        .map(publicDigitalHumanJob);
      res.json(jobs);
    });
  }

  function registerPostDigitalHumanJobs() {
    studioRouter.post('/digital-human/jobs', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const capabilities = digitalHumanCapabilities();
      if (!capabilities.available) { res.status(503).json({ ok: false, error: capabilities.unavailableReason, code: 'PROVIDER_NOT_CONFIGURED' }); return; }
      if (req.body?.heygenAvatarId) {
        try {
          if (req.body.projectId) { const project = await store.getById<any>('studio_projects', String(req.body.projectId)); if (!project || project.tenant_id !== tenantId) { res.status(404).json({ error: '当前企业的制作项目不存在' }); return; } }
          const voiceoverUrl = validDigitalHumanVoiceoverUrl(req.body.voiceoverUrl);
          if (!voiceoverUrl || !String(req.body.script || '').trim()) { res.status(400).json({ error: '请先确认口播并生成音频' }); return; }
          if (String(req.body.script).length > 8000) { res.status(400).json({ error: '口播过长，请缩短后重新确认' }); return; }
          const job = await ensureHeygenAutomationJob({ tenantId, projectId: String(req.body.projectId || randomUUID()), avatarId: String(req.body.heygenAvatarId), consent: req.body.consentConfirmed === true, voiceoverUrl, script: String(req.body.script), language: String(req.body.language || 'en') });
          res.status(202).json({ ok: true, job: publicDigitalHumanJob(job) });
        } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'HeyGen 提交失败' }); }
        return;
      }
      res.status(400).json({ error: '请选择 HeyGen 人物', code: 'HEYGEN_AVATAR_REQUIRED' }); return;

    });
  }

  function registerGetDigitalHumanJobsId() {
    studioRouter.get('/digital-human/jobs/:id', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const job = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
      if (!job) { res.status(404).json({ ok: false, error: '数字人任务不存在' }); return; }
      const outputMaterial = job.outputMaterialId ? loadMaterials().find(item => item.id === job!.outputMaterialId && item.tenantId === tenantId) : undefined;
      res.json({ ok: true, job: publicDigitalHumanJob(job), outputMaterial: outputMaterial ? await materialResponse(outputMaterial, tenantId) : undefined });
    });
  }

  function registerPostDigitalHumanJobsIdRetry() {
    studioRouter.post('/digital-human/jobs/:id/retry', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const source = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
      if (!source) { res.status(404).json({ ok: false, error: '数字人任务不存在' }); return; }
      if (!['failed', 'review', 'cancelled'].includes(source.status)) { res.status(409).json({ ok: false, error: '只有失败、待复核或已取消任务可以重试' }); return; }
      // A repeated click/replayed request against one parent is the same retry.
      // To retry a failed child again the caller must explicitly target that child.
      // Resolve this before capacity checks, which may already include this child.
      const existingRetry = loadDigitalHumanJobs().find(item => item.tenantId === tenantId && item.parentJobId === source.id);
      if (existingRetry) {
        res.status(202).json({ ok: true, job: publicDigitalHumanJob(existingRetry) }); return;
      }
      if (!digitalHumanCapabilities().available) { res.status(503).json({ ok: false, error: 'HeyGen 服务尚未配置' }); return; }
      const active = loadDigitalHumanJobs().filter(item => item.tenantId === tenantId && ['queued', 'submitting', 'processing', 'quality_check'].includes(item.status));
      if (active.length >= 2) { res.status(429).json({ ok: false, error: '当前已有 2 个数字人任务在运行，请稍后再试' }); return; }
      if (source.provider === 'heygen' && source.providerTaskId && source.errorCode === 'PROVIDER_ERROR' && /fetch failed|timeout|timed out|aborted|HeyGen (429|5\d\d)|字幕与已确认口播不一致/i.test(source.errorMessage || '')) {
        const resumed = updateDigitalHumanJob(source.id, { status: 'processing', stage: 'heygen_rendering', errorCode: undefined, errorMessage: undefined });
        void refreshDigitalHumanJob(source.id, req);
        res.status(202).json({ ok: true, job: publicDigitalHumanJob(resumed) }); return;
      }
      const now = new Date().toISOString();
      const retry: DigitalHumanJob = {
        ...source, id: randomUUID(), parentJobId: source.id, providerTaskId: undefined,
        status: 'queued', stage: 'queued', progress: 0, outputMaterialId: undefined, outputUrl: undefined,
        qualityReport: undefined, errorCode: undefined, errorMessage: undefined, completedAt: undefined,
        versionNumber: source.versionNumber + 1, createdAt: now, updatedAt: now,
      };
      const jobs = loadDigitalHumanJobs(); jobs.push(retry); persistDigitalHumanJobs(jobs);
      void refreshDigitalHumanJob(retry.id, req);
      res.status(202).json({ ok: true, job: publicDigitalHumanJob(retry) });
    });
  }

  function registerPostDigitalHumanJobsIdCancel() {
    studioRouter.post('/digital-human/jobs/:id/cancel', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const job = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
      if (!job) { res.status(404).json({ ok: false, error: '数字人任务不存在' }); return; }
      if (['completed', 'failed', 'review', 'cancelled'].includes(job.status)) { res.status(409).json({ ok: false, error: '该任务当前不可取消' }); return; }
      if (job.provider !== 'heygen' && job.providerTaskId && digitalHumanConfig().baseUrl) {
        void digitalHumanFetch(`${digitalHumanConfig().baseUrl}/v1/jobs/${encodeURIComponent(job.providerTaskId)}/cancel`, { method: 'POST', headers: digitalHumanProviderHeaders() }).catch(() => undefined);
      }
      const cancelled = updateDigitalHumanJob(job.id, { status: 'cancelled', stage: 'cancelled', errorCode: undefined, errorMessage: undefined });
      res.json({ ok: true, job: publicDigitalHumanJob(cancelled) });
    });
  }

  return { registerGetDigitalHumanJobs, registerPostDigitalHumanJobs, registerGetDigitalHumanJobsId, registerPostDigitalHumanJobsIdRetry, registerPostDigitalHumanJobsIdCancel };
}
