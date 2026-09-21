import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { ProductionDefaults } from '../../src/lib/shotProduction.js';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import { RunwaySwapClient, prepareSwapVideo, finishSwapVideo, imageRatio, ff } from '../lib/runwaySwap.js';
import { downloadSwapAsset } from '../lib/swapDownload.js';

export type SwapJob = { id: string; presenterId: string; presenterName: string; status: 'ready' | 'image_submitting' | 'image_pending' | 'preview' | 'video_submitting' | 'video_pending' | 'completed' | 'failed' | 'uncertain'; duration: number; generationDuration: number; width: number; height: number; hasAudio: boolean; createdAt: string; updatedAt: string; imageTaskId?: string; videoTaskId?: string; error?: string; estimatedCny?: number };
export function swapConfig() {
  const rate = Number(process.env.RUNWAY_SWAP_VIDEO_CNY_PER_SECOND), image = Number(process.env.RUNWAY_SWAP_IMAGE_CNY), limit = Number(process.env.RUNWAY_SWAP_BUDGET_CNY);
  const enabled = Boolean(process.env.RUNWAY_API_KEY) && process.env.RUNWAY_SWAP_ENABLED === 'true' && [rate, image, limit].every(n => Number.isFinite(n) && n > 0);
  return { enabled, rate, image, limit, reason: enabled ? '' : '请配置 Runway 密钥、启用开关及图像/视频估价和累计预算' };
}
export function createPersonSwapRouter(store: DataStore, options: { root?: string; client?: RunwaySwapClient; config?: typeof swapConfig; download?: typeof downloadSwapAsset; prepare?: typeof prepareSwapVideo; finish?: typeof finishSwapVideo } = {}) {
  const router = Router();
  const root = options.root || path.resolve('data/person-swap');
  const config = options.config || swapConfig;
  const client = () => options.client || new RunwaySwapClient(process.env.RUNWAY_API_KEY || '');
  const download = options.download || downloadSwapAsset;
  const tenantRoot = (tenant: string) => path.join(root, createHash('sha256').update(tenant).digest('hex'));
  const dirFor = (tenant: string, id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('任务不存在'); return path.join(tenantRoot(tenant), id); };
  const load = async (dir: string): Promise<SwapJob> => JSON.parse(await fs.readFile(path.join(dir, 'job.json'), 'utf8'));
  const save = async (dir: string, job: SwapJob) => { job.updatedAt = new Date().toISOString(); const temp = path.join(dir, `${randomUUID()}.json`); await fs.writeFile(temp, JSON.stringify(job), { mode: 0o600 }); await fs.rename(temp, path.join(dir, 'job.json')); };
  const reserve = async (id: string, amount: number) => withPaidOperationLock(path.join(root, '.locks'), 'budget', async () => {
    const file = path.join(root, 'budget.json');
    let ledger: Record<string, number> = {};
    try { ledger = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (Object.values(ledger).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('预算账本无效');
    if (ledger[id]) return;
    if (Object.values(ledger).reduce((sum, n) => sum + n, 0) + amount > config().limit) throw new Error('Runway 累计预算不足，未提交生成');
    ledger[id] = amount;
    const temp = `${file}.${randomUUID()}`; await fs.writeFile(temp, JSON.stringify(ledger), { mode: 0o600 }); await fs.rename(temp, file);
  });
  const fail = (res: any, e: unknown) => res.status(400).json({ error: (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? '任务不存在' : e instanceof Error ? e.message : '人物替换处理失败' });
  router.get('/capabilities', (_req, res) => { const c = config(); res.json({ enabled: c.enabled, reason: c.reason, imageCny: Number.isFinite(c.image) ? c.image : null, videoCnyPerSecond: Number.isFinite(c.rate) ? c.rate : null }); });
  router.get('/jobs', async (_req, res) => {
    try { const base = tenantRoot(res.locals.tenantId); const entries = await fs.readdir(base).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
      const jobs = await Promise.all(entries.filter(s => /^[a-f0-9-]{36}$/.test(s)).map(id => load(path.join(base, id)).catch(() => null)));
      res.json(jobs.filter(Boolean).sort((a, b) => b!.createdAt.localeCompare(a!.createdAt)).slice(0, 30));
    } catch (e) { fail(res, e); }
  });
  router.post('/jobs', async (req, res) => {
    let dir = '';
    try {
      const tenant = res.locals.tenantId;
      const defaults = (await store.list<{ payload: ProductionDefaults }>('studio_production_defaults', { where: { tenant_id: tenant }, perPage: 1 })).items[0]?.payload;
      const person = defaults?.presenters.find(p => p.id === req.body.presenterId && p.authorized);
      if (!person?.imageUrl) throw new Error('请选择本企业已有参考图片且已授权的人物资产');
      const match = String(req.body.video || '').match(/^data:video\/(?:mp4|quicktime);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error('请上传 MP4/MOV 视频');
      const bytes = Buffer.from(match[1], 'base64');
      if (!bytes.length || bytes.length > 40 * 1024 * 1024) throw new Error('视频大小须在 40MB 以内');
      const id = randomUUID(); dir = dirFor(tenant, id); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(dir, 'source.mp4'), bytes, { mode: 0o600 });
      const info = await (options.prepare || prepareSwapVideo)(dir);
      const image = await download(person.imageUrl, 10 * 1024 * 1024);
      await fs.writeFile(path.join(dir, 'person-source'), image, { mode: 0o600 });
      await ff(['-protocol_whitelist', 'file,pipe', '-f', 'image2', '-i', path.join(dir, 'person-source'), '-frames:v', '1', '-vf', "scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease", path.join(dir, 'person.png')]);
      const job: SwapJob = { id, presenterId: person.id, presenterName: person.name, status: 'ready', ...info, createdAt: new Date().toISOString(), updatedAt: '' };
      await save(dir, job); res.json(job);
    } catch (e) { if (dir) await fs.rm(dir, { recursive: true, force: true }); fail(res, e); }
  });
  for (const stage of ['image', 'video'] as const) router.post(`/jobs/:id/${stage}`, async (req, res) => {
    try {
      const dir = dirFor(res.locals.tenantId, req.params.id);
      const result = await withPaidOperationLock(path.join(root, '.locks'), dir, async () => {
        const job = await load(dir);
        // An already submitted stage never creates another paid task, even after timeout/reload.
        if ((stage === 'image' && job.status !== 'ready') || (stage === 'video' && job.status !== 'preview')) return job;
        const c = config(); if (!c.enabled) throw new Error(c.reason);
        const cost = stage === 'image' ? c.image : Math.ceil(c.rate * job.generationDuration * 100) / 100;
        if (req.body.confirmed !== true || req.body.maxCostCny !== cost) throw new Error('请确认当前阶段的生成估价');
        // Prepare all non-billable uploads before reserving and marking the irreversible submission.
        const a = await client().upload(path.join(dir, stage === 'image' ? 'frame.png' : 'input.mp4'), stage === 'image' ? 'image/png' : 'video/mp4');
        const b = await client().upload(path.join(dir, stage === 'image' ? 'person.png' : 'keyframe.png'), 'image/png');
        await reserve(`${job.id}:${stage}`, cost);
        job.status = stage === 'image' ? 'image_submitting' : 'video_submitting'; job.estimatedCny = (job.estimatedCny || 0) + cost; await save(dir, job);
        try {
          if (stage === 'image') { job.imageTaskId = await client().keyframe(a, b, imageRatio(job.width, job.height)); job.status = 'image_pending'; }
          else { job.videoTaskId = await client().video(a, b); job.status = 'video_pending'; }
          await save(dir, job);
        } catch { job.status = 'uncertain'; job.error = '供应商提交结果待核对。不会自动重复提交；请管理员核对任务及账单。'; await save(dir, job); }
        return job;
      }); res.json(result);
    } catch (e) { fail(res, e); }
  });
  router.post('/jobs/:id/refresh', async (req, res) => {
    try {
      const dir = dirFor(res.locals.tenantId, req.params.id);
      res.json(await withPaidOperationLock(path.join(root, '.locks'), dir, async () => {
        const job = await load(dir);
        if (!['image_pending', 'video_pending'].includes(job.status)) return job;
        const image = job.status === 'image_pending';
        const remote = await client().status((image ? job.imageTaskId : job.videoTaskId)!);
        if (['FAILED', 'CANCELED'].includes(remote.status)) { job.status = 'failed'; job.error = 'Runway 未能完成该任务，可检查原素材后创建新任务。新任务会重新计费。'; }
        if (remote.status === 'SUCCEEDED') {
          try {
            if (!remote.output?.[0]) throw new Error('供应商未返回生成文件');
            await fs.writeFile(path.join(dir, image ? 'keyframe-source' : 'generated.mp4'), await download(remote.output[0], image ? 20 * 1024 * 1024 : 100 * 1024 * 1024));
            if (image) {
              // Fit the generated still without cropping. User sees this exact frame before video generation.
              await ff(['-protocol_whitelist', 'file,pipe', '-f', 'image2', '-i', path.join(dir, 'keyframe-source'), '-frames:v', '1', '-vf', `scale=${job.width}:${job.height}:force_original_aspect_ratio=decrease,pad=${job.width}:${job.height}:(ow-iw)/2:(oh-ih)/2`, path.join(dir, 'keyframe.png')]);
              job.status = 'preview';
            } else { await (options.finish || finishSwapVideo)(dir, job.duration); job.status = 'completed'; }
            job.error = '';
          } catch (e) { job.error = `${e instanceof Error ? e.message : '结果导入失败'}。刷新仅重新导入，不重新付费生成。`; }
        }
        await save(dir, job); return job;
      }));
    } catch (e) { fail(res, e); }
  });
  router.get('/jobs/:id/media/:file', async (req, res) => {
    try {
      if (!['source.mp4', 'frame.png', 'person.png', 'keyframe.png', 'output.mp4'].includes(req.params.file)) throw new Error('文件不存在');
      const dir = dirFor(res.locals.tenantId, req.params.id); const job = await load(dir);
      if (req.params.file === 'output.mp4' && job.status !== 'completed') throw new Error('输出视频尚未完成');
      res.setHeader('Cache-Control', 'private, no-store');
      res.sendFile(path.join(dir, req.params.file), e => { if (e && !res.headersSent) res.status(404).end(); });
    } catch (e) { fail(res, e); }
  });
  return router;
}
