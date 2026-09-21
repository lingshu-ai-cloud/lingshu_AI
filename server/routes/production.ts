import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import { studioPaidBudget } from '../lib/studioPaidBudget.js';
import type { DataStore } from '../storage/datastore.js';
import { HeyGenClient, type HeyGenInput } from '../lib/heygen.js';
import { EMPTY_DEFAULTS, avatarMotionPrompt, shotFingerprint, type AvatarJob, type ProductionDefaults, type ShotProduction } from '../../src/lib/shotProduction.js';
import { mapNarrationCues, narrationFromDetail } from '../../src/lib/narrationAlignment.js';
import { createPresenterAssetsRouter } from './presenterAssets.js';
import { mediaUrl } from '../lib/heygenPresenters.js';

type JobRecord = { id: string; tenant_id: string; project_id: string; request_id: string; payload: AvatarJob; input: HeyGenInput };
export function createProductionRouter(store: DataStore, importVideo: (url: string, duration: number, job: AvatarJob, input: HeyGenInput, tenantId: string) => Promise<string>, options: { client?: HeyGenClient; enabled?: () => boolean; lockRoot?: string; reserve?: (id: string) => Promise<void>; prepareAudio?: (ref: NonNullable<HeyGenInput['audioRef']>, tenantId: string) => Promise<Uint8Array> } = {}) {
  const router = Router();
  const locks = new Map<string, Promise<unknown>>();
  const exclusive = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) || Promise.resolve()).catch(() => undefined).then(() =>
      withPaidOperationLock(options.lockRoot || path.resolve(process.cwd(), 'data/studio-production-locks'), key, operation));
    locks.set(key, next); try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  };
  const enabled = () => options.enabled?.() ?? Boolean(process.env.HEYGEN_API_KEY && process.env.HEYGEN_GENERATION_ENABLED === 'true');
  const motionPromptEnabled = () => process.env.HEYGEN_MOTION_PROMPT_ENABLED === 'true';
  const client = () => options.client || new HeyGenClient(process.env.HEYGEN_API_KEY || '');
  const readDefaults = async (tenantId: string) => (await store.list<any>('studio_production_defaults', { where: { tenant_id: tenantId }, perPage: 1 })).items[0];
  router.use('/presenters', createPresenterAssetsRouter(store, exclusive));
  router.get('/capabilities', (_req, res) => {
    const rate = Number(process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND);
    const singleTestCap = Number(process.env.HEYGEN_SINGLE_TEST_CAP_CNY);
    const budget = studioPaidBudget.status('heygen');
    res.json({ configured: enabled() && budget.allowed, motionPromptEnabled: motionPromptEnabled(), reason: !enabled() ? '管理员须配置 HEYGEN_API_KEY 并明确启用 HEYGEN_GENERATION_ENABLED；当前不会发起付费生成' : budget.reason, costPerSecond: rate > 0 ? rate : null, singleTestCapCny: singleTestCap > 0 ? singleTestCap : null, budget });
  });
  router.get('/defaults', async (_req, res) => {
    try { res.json((await readDefaults(res.locals.tenantId))?.payload || EMPTY_DEFAULTS); }
    catch { res.status(503).json({ error: '企业出镜设置读取失败' }); }
  });
  router.post('/defaults', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const b = req.body as ProductionDefaults;
      if (!b || !['auto', 'avatar', 'real', 'none'].includes(b.preference) || !Array.isArray(b.presenters) || b.presenters.length > 50 || b.presenters.some(item => !item || !item.id || !item.name || !item.avatarId || !item.voiceId || item.authorized !== true)
        || new Set(b.presenters.map(item => item.id)).size !== b.presenters.length || (b.defaultPresenterId && !b.presenters.some(item => item.id === b.defaultPresenterId))) {
        res.status(400).json({ error: '请完整填写人物、声音ID并确认已取得使用授权' }); return;
      }
        const payload: ProductionDefaults = { preference: b.preference, defaultPresenterId: String(b.defaultPresenterId || ''), presenters: b.presenters.map(item => ({ id: String(item.id).slice(0, 100), name: String(item.name).slice(0, 100), avatarId: String(item.avatarId).slice(0, 200), voiceId: String(item.voiceId).slice(0, 200), authorized: item.authorized === true, supportsAlpha: item.supportsAlpha === true, imageUrl: mediaUrl(item.imageUrl), videoUrl: mediaUrl(item.videoUrl), creationMode: item.creationMode === 'expert' ? 'expert' : 'quick', nativeOrientation: ['portrait', 'landscape', 'square'].includes(item.nativeOrientation || '') ? item.nativeOrientation : 'unknown' })) };
      await exclusive(`defaults:${tenantId}`, async () => {
        const existing = await readDefaults(tenantId);
        const saved = existing ? await store.update('studio_production_defaults', existing.id, { payload }) : await store.create('studio_production_defaults', { tenant_id: tenantId, payload });
        if (!saved) throw new Error('storage');
      });
      res.json(payload);
    } catch { res.status(503).json({ error: '企业出镜设置保存失败' }); }
  });
  router.get('/jobs', async (req, res) => {
    try {
      const result = await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: res.locals.tenantId, project_id: String(req.query.projectId || '') }, perPage: 500 });
      res.json(result.items.filter(item => item.tenant_id === res.locals.tenantId).map(item => ({ ...item.payload, id: item.id })));
    } catch { res.status(503).json({ error: '镜头任务读取失败' }); }
  });
  const update = async (record: JobRecord, patch: Partial<AvatarJob>): Promise<AvatarJob> => {
    const payload = { ...record.payload, id: record.id, ...patch, updatedAt: new Date().toISOString() };
    if (!await store.update('studio_avatar_jobs', record.id, { payload })) throw new Error('镜头任务状态保存失败，请刷新原任务；不要重复提交');
    record.payload = payload; return payload;
  };
  const submitRemote = async (record: JobRecord) => {
    try {
      if (record.input.audioRef && !record.input.audioAssetId) {
        if (!options.prepareAudio) throw new Error('统一旁白分段服务不可用');
        const audio = await options.prepareAudio(record.input.audioRef, record.tenant_id);
        const audioAssetId = await client().uploadAudio(audio, `${record.request_id}:audio`);
        const input = { ...record.input, audioAssetId };
        if (!await store.update('studio_avatar_jobs', record.id, { input })) throw new Error('音频资产绑定保存失败');
        record.input = input;
      }
      const remoteId = await client().create(record.input, record.request_id);
      return await update(record, { remoteId, status: 'pending', error: '' });
    } catch (error) {
      return update(record, { status: 'uncertain', error: error instanceof Error ? error.message : '供应商提交结果待核实' });
    }
  };
  router.post('/jobs', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const b = req.body || {};
      if (!enabled()) { res.status(503).json({ error: '数字人服务尚未配置或启用' }); return; }
      if (b.confirmed !== true || !/^[A-Za-z0-9_:.-]{1,150}$/.test(String(b.requestId || ''))) { res.status(400).json({ error: '请确认本镜头生成及供应商计费，并提供有效请求标识' }); return; }
      const job = await exclusive(`submit:${tenantId}`, async () => {
        const existing = (await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: tenantId, request_id: `${tenantId}:${b.requestId}` }, perPage: 1 })).items[0];
        if (existing) return { ...existing.payload, id: existing.id };
        const project = await store.getById<any>('studio_projects', String(b.projectId || ''));
        if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
        const pendingJobs = await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: tenantId, project_id: project.id }, perPage: 500 });
        if (pendingJobs.items.some(item => item.payload.assemblyId === b.assemblyId && item.payload.shotId === b.shotId && item.payload.fingerprint === b.fingerprint && ['submitting', 'pending', 'uncertain'].includes(item.payload.status))) throw new Error('该镜头已有未结束任务，请刷新原任务，不重复提交');
        const shot = project.spec?.shotProductions?.[`${b.assemblyId}:${b.shotId}`] as ShotProduction | undefined;
        const context = project.spec?.shotProductionContext;
        if (!shot) throw new Error('草稿中未找到当前镜头，请重新打开分镜');
        if (shot.source !== 'avatar') throw new Error('当前镜头尚未保存为数字人来源');
        if (shot.avatarMode === 'cinematic') throw new Error('运镜口播需要 Cinematic / Avatar Shots 专用接口，当前不会使用普通口播接口代替或扣费');
        if (shot.avatarMode === 'overlay' && !shot.transparent) throw new Error('透明人物层必须启用透明输出并使用已核验支持的人物');
        if (shot.locked) throw new Error('当前镜头已锁定，请先解锁');
        if (shotFingerprint(shot, String(context || '')) !== b.fingerprint) throw new Error('数字人参数与已保存草稿不一致，请保存后重试');
        const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
        const presenter = defaults?.presenters.find(item => item.id === shot.presenterId && item.authorized);
        if (!presenter) throw new Error('请先保存已授权的人物与声音资产');
        if (shot.layout === 'pip' && !shot.transparent) throw new Error('数字人画中画需要去背景的透明人物层；请先核验透明支持，或改用全屏普通混剪');
        if (b.ratio === '9:16' && !shot.transparent && presenter.nativeOrientation !== 'portrait') throw new Error('竖屏生成前须在人物资产中核验原生竖屏画幅；横屏或未知人物可能产生大面积留白，已阻止付费提交');
        if (shot.transparent && !presenter.supportsAlpha) throw new Error('该人物未确认支持透明视频，不能生成独立背景人物层');
        if (shot.backgroundMaterialId && shot.backgroundMode === 'baked') throw new Error('首版只支持独立背景合成，请改用透明人物层；不将新背景参数静默忽略');
        if (!shot.narration.trim() || shot.narration.length > 5000 || !['9:16', '16:9', '1:1'].includes(b.ratio) || b.ratio !== project.spec.ratio) throw new Error('台词或画幅无效，请先保存当前草稿');
        const rate = Number(process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND);
        const singleTestCap = Number(process.env.HEYGEN_SINGLE_TEST_CAP_CNY);
        if (singleTestCap > 0) {
          const slot = (project.spec.shootingSlots || []).find((item: any) => item.id === b.shotId);
          const shotDuration = Number(slot?.duration ?? (Number(slot?.end) - Number(slot?.start)));
          if (!(rate > 0) || !(shotDuration > 0)) throw new Error('无法核算本次数字人测试费用，已在调用供应商前停止');
          const estimatedCost = rate * shotDuration;
          if (estimatedCost > singleTestCap + 0.0001) throw new Error(`本镜头预计费用 ¥${estimatedCost.toFixed(2)}，超过单次测试上限 ¥${singleTestCap.toFixed(2)}；请缩短镜头或调整管理员预算`);
        }
        const now = new Date().toISOString();
        const slot = (project.spec.shootingSlots || []).find((item: any) => item.id === b.shotId);
        const requestedMotion = avatarMotionPrompt(shot, Number(slot?.duration ?? (Number(slot?.end) - Number(slot?.start))));
        if ((shot.performancePreset || 'natural') !== 'natural' && !motionPromptEnabled()) throw new Error('当前 HeyGen 账户尚未启用 Motion Prompt；已阻止付费提交，避免表演要求被静默忽略');
        const intensity = shot.emotionIntensity ?? 0.5;
        const input: HeyGenInput = { avatarId: presenter.avatarId, voiceId: presenter.voiceId, script: shot.narration, ratio: b.ratio, transparent: shot.transparent, title: `灵枢镜头 ${b.shotId}`,
          ...(motionPromptEnabled() ? presenter.creationMode === 'expert'
            ? { engine: 'avatar_v' as const, motionPrompt: requestedMotion }
            : { engine: 'avatar_iv' as const, motionPrompt: requestedMotion, expressiveness: intensity >= 0.67 ? 'high' as const : intensity >= 0.34 ? 'medium' as const : 'low' as const } : {}) };
        if (shot.sound === 'voiceover') {
          const language = project.spec.activeVoiceLang || project.spec.lang;
          const audio = project.spec.voiceoverAudios?.[language];
          const audioUrl = project.spec.voiceoverMode === 'ai' ? audio?.url : project.spec.voiceoverUrl;
          if (!audioUrl) throw new Error('请先生成或上传并确认统一旁白，再用其驱动数字人');
          const slots = project.spec.shootingSlots || []; const slotIndex = slots.findIndex((item: any) => item.id === b.shotId);
          if (slotIndex < 0) throw new Error('未找到镜头音频区间');
          const ranges = mapNarrationCues(slots.map((item: any) => project.spec.shotProductions?.[`${b.assemblyId}:${item.id}`]?.narration ?? narrationFromDetail(item.detail)),
            project.spec.alignedCuesByLang?.[language] || audio?.cues || [],
            project.spec.voiceoverMode === 'ai' ? audio?.duration : project.spec.voiceoverDur, audio?.alignmentSource);
          const range = ranges[slotIndex];
          if (!range) throw new Error('该镜头没有已对齐的口播，不提交数字人生成');
          if (range.end - range.start > slots[slotIndex].duration + 0.01) throw new Error('台词超过镜头时长，请先延长镜头');
          input.audioRef = { url: audioUrl, start: range.start, duration: range.end - range.start };
        }
        const payload: AvatarJob = { id: '', projectId: project.id, shotId: String(b.shotId), assemblyId: String(b.assemblyId), fingerprint: b.fingerprint, status: 'submitting', createdAt: now, updatedAt: now };
        await (options.reserve || (id => studioPaidBudget.reserve('heygen', id)))(`${tenantId}:${b.requestId}`);
        const record = await store.create<JobRecord>('studio_avatar_jobs', { tenant_id: tenantId, project_id: project.id, request_id: `${tenantId}:${b.requestId}`, payload, input });
        if (!record) throw new Error('任务存储不可用，未发起付费生成');
        return submitRemote(record);
      });
      res.json(job);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '生成提交失败' }); }
  });
  router.post('/jobs/:id/refresh', async (req, res) => {
    try {
      const job = await exclusive(`job:${req.params.id}`, async () => {
        const record = await store.getById<JobRecord>('studio_avatar_jobs', req.params.id);
        if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('镜头任务不存在');
        if (record.payload.status === 'completed' || record.payload.status === 'failed') return { ...record.payload, id: record.id };
        if (!record.payload.remoteId) {
          const matches = await client().reconcile(record.input.title, record.payload.createdAt);
          if (matches.length > 1) throw new Error('供应商存在多个同时间镜头任务，需管理员核对账单后绑定，禁止重复提交');
          if (!matches.length) return update(record, { status: 'failed', error: '已核对供应商任务列表：本次请求未创建任务，可重新生成。' });
          const recovered = matches[0];
          await update(record, { remoteId: recovered.id, status: recovered.status === 'failed' ? 'failed' : 'pending', error: '已找回供应商原任务，未重复生成。' });
          if (recovered.status === 'failed') return { ...record.payload, id: record.id };
        }
        const remote = await client().status(record.payload.remoteId!);
        if (remote.status === 'completed') {
          try {
            const materialId = await importVideo(remote.url!, remote.duration!, { ...record.payload, id: record.id }, record.input, record.tenant_id);
            return await update(record, { status: 'completed', materialId, error: '' });
          } catch (error) {
            return update(record, { status: 'pending', error: `供应商已生成，但下载或技术检查未通过：${error instanceof Error ? error.message : '导入失败'}。刷新仅复查原任务，不重新生成。` });
          }
        }
        return update(record, { status: remote.status, error: remote.error || '' });
      });
      res.json(job);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '镜头状态刷新失败' }); }
  });
  return router;
}
