import { isTrustedSocialOutputWorkspace } from '../starter198/socialContentWorkspacePolicy.js';
import { type RenderSpec } from './studioRenderManifestProjection.js';
import { safeStudioRenderOutputPath } from '../lib/studioRenderMedia.js';
import { isManualStudioProject } from '../../shared/contracts/studioManualHandoff.js';
import { compareAndSwapStudioProject } from '../lib/studioProjectRevision.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { secureStudioRenderManifest, MAX_STUDIO_RENDER_ASSET_BYTES, MAX_STUDIO_RENDER_TOTAL_BYTES } from '../lib/studioRenderSecurity.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { type AuthLocals } from '../middleware/auth.js';
import { appendMaterialUsageManifest, buildStudioMaterialUsageManifest } from '../lib/materialUsageTracking.js';
import type { StoredStudioRenderJob } from '../studio/contracts.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioPersistentRenderRoutes(deps: Pick<StudioApplicationPorts, 'buildManifest' | 'publishingRenderDir' | 'composite' | 'publishingRenderPreviewUrl' | 'studioRouter' | 'execFileAsync'>) {
  const buildManifest: StudioApplicationPorts['buildManifest'] = (...args) => deps.buildManifest(...args);
  const publishingRenderDir: StudioApplicationPorts['publishingRenderDir'] = (...args) => deps.publishingRenderDir(...args);
  const composite = deps.composite;
  const publishingRenderPreviewUrl: StudioApplicationPorts['publishingRenderPreviewUrl'] = (...args) => deps.publishingRenderPreviewUrl(...args);
  const studioRouter = deps.studioRouter;
  const execFileAsync: StudioApplicationPorts['execFileAsync'] = (...args) => deps.execFileAsync(...args);

  const activePersistentStudioRenders = new Set<string>();

  function publicStudioRenderJob(job: StoredStudioRenderJob) {
    return { id: job.id, projectId: job.project_id, outputKey: job.output_key,
      inputSignature: job.input_signature, status: job.status, progress: Number(job.progress || 0),
      attempts: Number(job.attempts || 0), outputPath: job.output_path || '', previewUrl: job.preview_url || '',
      error: job.error || '', createdAt: job.created_at, updatedAt: job.updated_at };
  }

  async function runPersistentStudioRender(jobId: string, tenantId: string, origin: string, localPort: number,
    assetHeaders: Record<string, string>) {
    const activeKey = `${tenantId}:${jobId}`;
    if (activePersistentStudioRenders.has(activeKey)) return;
    activePersistentStudioRenders.add(activeKey);
    try {
      const current = await store.getById<StoredStudioRenderJob>('studio_render_jobs', jobId);
      if (!current || current.tenant_id !== tenantId || current.status === 'completed') return;
      const now = new Date().toISOString();
      await store.update('studio_render_jobs', jobId, { status: 'processing', progress: 15,
        attempts: Number(current.attempts || 0) + 1, error: '', updated_at: now });
      const manifest = buildManifest(jobId, current.spec, origin);
      const safeManifest = secureStudioRenderManifest(manifest, tenantId, origin, `http://127.0.0.1:${localPort}`);
      const outputDir = publishingRenderDir(tenantId);
      fs.mkdirSync(outputDir, { recursive: true });
      let lastProgress = 15;
      const result = await composite({ ...safeManifest, requireVisualAssets: true,
        assetOrigin: `http://127.0.0.1:${localPort}`, serverStrictAssets: true,
        maxAssetBytes: MAX_STUDIO_RENDER_ASSET_BYTES, maxTotalAssetBytes: MAX_STUDIO_RENDER_TOTAL_BYTES,
        assetHeaders }, (rawProgress: number) => {
        const progress = Math.max(15, Math.min(95, Math.round(rawProgress)));
        if (progress < lastProgress + 3) return;
        lastProgress = progress;
        void store.update('studio_render_jobs', jobId, { progress, updated_at: new Date().toISOString() });
      }, outputDir);
      if (!result.ok || !result.outputPath) throw new Error(result.error || '本地 MP4 导出失败');
      const outputPath = String(result.outputPath);
      const previewUrl = publishingRenderPreviewUrl(tenantId, outputPath);
      const finishedAt = new Date().toISOString();
      await store.update('studio_render_jobs', jobId, { status: 'completed', progress: 100,
        output_path: outputPath, preview_url: previewUrl, error: '', updated_at: finishedAt });
      const project = await store.getById<any>('studio_projects', current.project_id);
      if (project && project.tenant_id === tenantId && !isTrustedSocialOutputWorkspace(project)) {
        const projectSpec = typeof project.spec === 'string' ? JSON.parse(project.spec) : project.spec || {};
        const outputs = projectSpec.languageRenderOutputs && typeof projectSpec.languageRenderOutputs === 'object'
          ? projectSpec.languageRenderOutputs : {};
        const versions = projectSpec.languageRenderVersions && typeof projectSpec.languageRenderVersions === 'object'
          ? projectSpec.languageRenderVersions : {};
        const priorVersions = Array.isArray(versions[current.output_key]) ? versions[current.output_key] : [];
        const generation = { id: jobId, versionNumber: Number(priorVersions[0]?.versionNumber || 0) + 1,
          status: 'done', path: outputPath, previewUrl, inputSignature: current.input_signature, createdAt: finishedAt };
        const renderedSpec = { ...projectSpec, languageRenderOutputs: { ...outputs,
            [current.output_key]: { status: 'done', path: outputPath, previewUrl, inputSignature: current.input_signature } },
          languageRenderVersions: { ...versions, [current.output_key]: [generation, ...priorVersions.filter((item: any) => item?.id !== jobId)] },
          manualRenderJob: { id: jobId, status: 'completed', outputKey: current.output_key,
            inputSignature: current.input_signature, outputPath, previewUrl, updatedAt: finishedAt },
          staleReason: '' };
        const nextSpec = appendMaterialUsageManifest(renderedSpec, buildStudioMaterialUsageManifest({
          projectId: current.project_id,
          projectTitle: String(project.title || ''),
          artifactId: jobId,
          usedAt: finishedAt,
          spec: renderedSpec,
        }));
        const savedProject = await compareAndSwapStudioProject(store, project, { spec: nextSpec }, finishedAt);
        if (!savedProject.ok) {
          await store.update('studio_render_jobs', jobId, {
            error: '渲染完成，但草稿在渲染期间已更新；系统未覆盖新版本，请刷新后重新关联成片。',
            updated_at: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      await store.update('studio_render_jobs', jobId, { status: 'failed', progress: 0,
        error: error instanceof Error ? error.message : '本地 MP4 导出失败', updated_at: new Date().toISOString() });
    } finally { activePersistentStudioRenders.delete(activeKey); }
  }

  function registerPostRenderJobs() {
    studioRouter.post('/render/jobs', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const projectId = String(req.body?.projectId || '');
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
      if(isTrustedSocialOutputWorkspace(project)){res.status(409).json({ok:false,code:'social_output_workspace_readonly',error:'原生产快照不可重新渲染覆盖'});return;}
      const projectSpec = typeof project.spec === 'string' ? JSON.parse(project.spec) : project.spec || {};
      if (!isManualStudioProject(projectSpec)) { res.status(409).json({ ok: false, error: '只有人工自由创作项目可创建持久渲染任务' }); return; }
      const spec = req.body?.spec as RenderSpec;
      const outputKey = String(req.body?.outputKey || '').slice(0, 240);
      const inputSignature = String(req.body?.inputSignature || '');
      if (!spec || !outputKey || !inputSignature) { res.status(400).json({ ok: false, error: '渲染任务参数不完整' }); return; }
      const idempotencyKey = createHash('sha256').update(`${projectId}\n${outputKey}\n${inputSignature}`).digest('hex');
      const listed = await store.list<StoredStudioRenderJob>('studio_render_jobs', { where: {
          tenant_id: tenantId, project_id: projectId, idempotency_key: idempotencyKey }, sort: '-created_at', perPage: 1 });
      let job: StoredStudioRenderJob | null = listed.items[0] || null;
      if (!job) {
        if (!await consumeDemoQuota(req, res, 'render')) return;
        const now = new Date().toISOString();
        job = await store.create<StoredStudioRenderJob>('studio_render_jobs', { tenant_id: tenantId,
          project_id: projectId, idempotency_key: idempotencyKey, output_key: outputKey,
          input_signature: inputSignature, spec, status: 'queued', progress: 0, attempts: 0,
          created_at: now, updated_at: now });
        if (!job) { res.status(503).json({ ok: false, error: '渲染任务未能保存，请重试' }); return; }
      }
      const localPort = req.socket.localPort;
      if (!localPort) { res.status(503).json({ ok: false, error: '无法确认本机渲染服务端口' }); return; }
      if (job.status === 'queued' || job.status === 'failed') void runPersistentStudioRender(job.id, tenantId,
        `${req.protocol}://${req.get('host')}`, localPort, { ...(req.get('authorization') ? { authorization: req.get('authorization')! } : {}),
        ...(req.get('cookie') ? { cookie: req.get('cookie')! } : {}) });
      res.status(job.status === 'completed' ? 200 : 202).json({ ok: true, replayed: Boolean(listed.items[0]), job: publicStudioRenderJob(job) });
    });
  }

  function registerGetRenderJobsProjectProjectIdLatest() {
    studioRouter.get('/render/jobs/project/:projectId/latest', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const project = await store.getById<any>('studio_projects', req.params.projectId);
      if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
      const result = await store.list<StoredStudioRenderJob>('studio_render_jobs', { where: {
          tenant_id: tenantId, project_id: req.params.projectId }, sort: '-created_at', perPage: 1 });
      const job = result.items[0];
      if (!job) { res.json({ ok: true, job: null }); return; }
      // A process restart leaves a processing record behind. The first authenticated status read resumes it.
      if ((job.status === 'queued' || job.status === 'processing') && !activePersistentStudioRenders.has(`${tenantId}:${job.id}`)) {
        const localPort = req.socket.localPort;
        if (localPort) void runPersistentStudioRender(job.id, tenantId, `${req.protocol}://${req.get('host')}`, localPort,
          { ...(req.get('authorization') ? { authorization: req.get('authorization')! } : {}),
            ...(req.get('cookie') ? { cookie: req.get('cookie')! } : {}) });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, job: publicStudioRenderJob(job) });
    });
  }

  function registerPostRenderJobsIdRetry() {
    studioRouter.post('/render/jobs/:id/retry', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const job = await store.getById<StoredStudioRenderJob>('studio_render_jobs', req.params.id);
      if (!job || job.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: 'Render job not found' }); return; }
      if (job.status === 'completed') { res.json({ ok: true, replayed: true, job: publicStudioRenderJob(job) }); return; }
      await store.update('studio_render_jobs', job.id, { status: 'queued', error: '', progress: 0, updated_at: new Date().toISOString() });
      const localPort = req.socket.localPort;
      if (localPort) void runPersistentStudioRender(job.id, tenantId, `${req.protocol}://${req.get('host')}`, localPort,
        { ...(req.get('authorization') ? { authorization: req.get('authorization')! } : {}),
          ...(req.get('cookie') ? { cookie: req.get('cookie')! } : {}) });
      res.status(202).json({ ok: true, job: publicStudioRenderJob({ ...job, status: 'queued', error: '', progress: 0 }) });
    });
  }

  function registerPostRenderOpenOutput() {
    studioRouter.post('/render/open-output', async (req, res) => {
      const rawPath = String(req.body?.path || '').trim().replace(/^file:\/\//, '').replace(/^["']|["']$/g, '');
      if (!rawPath) {
        res.status(400).json({ ok: false, error: '缺少本地文件路径' });
        return;
      }
      const filePath = safeStudioRenderOutputPath(path.resolve(process.cwd(), 'data/publishing-uploads'), String(res.locals.tenantId || ''), rawPath);
      if (!filePath) {
        res.status(404).json({ ok: false, error: '本地成片文件不存在，请重新导出。' });
        return;
      }
      try {
        if (process.platform === 'darwin') {
          await execFileAsync('open', ['-R', filePath], 5000);
        } else if (process.platform === 'win32') {
          await execFileAsync('explorer.exe', ['/select,', filePath], 5000);
        } else {
          await execFileAsync('xdg-open', [path.dirname(filePath)], 5000);
        }
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || '打开本地文件夹失败' });
      }
    });
  }

  return { registerPostRenderJobs, registerGetRenderJobsProjectProjectIdLatest, registerPostRenderJobsIdRetry, registerPostRenderOpenOutput };
}
