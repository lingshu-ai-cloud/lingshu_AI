import { createCandidateContextAssessment, type CandidateContextInput } from '../socialDiscovery/candidateContextAssessment.js';
import { assessCandidateSemantics } from '../socialDiscovery/candidateSemanticAssessment.js';
import { resolveCandidateSemanticPaidCall } from '../socialDiscovery/candidateSemanticBudgetResolver.js';
import { type Request, type Response } from 'express';
import path from 'path';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { parseJsonRecord } from './videoCrawlerNormalization.js';
import { COL, __dirname } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoSourceRequestRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'resolvedPublicVideoSource' | 'shouldQueueVideoAnalysis' | 'queueAnalyzeSource' | 'analyzeSourceVideoJob' | 'loadMaterials' | 'persistMaterials' | 'copyStoredCrawlerVideoToMaterial' | 'downloadMaterialJob'>) {
  const videosRouter = deps.videosRouter;
  const resolvedPublicVideoSource: VideoApplicationPorts['resolvedPublicVideoSource'] = (...args) => deps.resolvedPublicVideoSource(...args);
  const shouldQueueVideoAnalysis: VideoApplicationPorts['shouldQueueVideoAnalysis'] = (...args) => deps.shouldQueueVideoAnalysis(...args);
  const queueAnalyzeSource: VideoApplicationPorts['queueAnalyzeSource'] = (...args) => deps.queueAnalyzeSource(...args);
  const analyzeSourceVideoJob: VideoApplicationPorts['analyzeSourceVideoJob'] = (...args) => deps.analyzeSourceVideoJob(...args);
  const loadMaterials: VideoApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const persistMaterials: VideoApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);
  const copyStoredCrawlerVideoToMaterial: VideoApplicationPorts['copyStoredCrawlerVideoToMaterial'] = (...args) => deps.copyStoredCrawlerVideoToMaterial(...args);
  const downloadMaterialJob: VideoApplicationPorts['downloadMaterialJob'] = (...args) => deps.downloadMaterialJob(...args);

  function registerPostDownloadMaterial() {
    videosRouter.post('/download-material', async (req, res) => {
      const { id, sourceUrl, title, platform, async } = req.body as {
        id?: string;
        sourceUrl?: string;
        title?: string;
        platform?: Platform;
        async?: boolean;
      };
      await handleDownloadMaterial(req, res, { id, sourceUrl, title, platform, async });
    });
  }

  function registerPostIdDownloadMaterial() {
    videosRouter.post('/:id/download-material', async (req, res) => {
      const { sourceUrl, title, platform, async } = req.body as { sourceUrl?: string; title?: string; platform?: Platform; async?: boolean };
      await handleDownloadMaterial(req, res, { id: req.params.id, sourceUrl, title, platform, async });
    });
  }

  function registerPostAnalyzeSource() {
    videosRouter.post('/analyze-source', async (req, res) => {
      const { id, sourceUrl, title, platform, async } = req.body as {
        id?: string;
        sourceUrl?: string;
        title?: string;
        platform?: Platform;
        async?: boolean;
      };
      const scoped = (res.locals as AuthLocals).starter198SocialContext;
      await handleAnalyzeSource(req, res, scoped ? { id, async } : { id, sourceUrl, title, platform, async });
    });
  }

  function registerPostIdAnalyzeSource() {
    videosRouter.post('/:id/analyze-source', async (req, res) => {
      const { sourceUrl, title, platform, async } = req.body as { sourceUrl?: string; title?: string; platform?: Platform; async?: boolean };
      await handleAnalyzeSource(req, res, { id: req.params.id, sourceUrl, title, platform, async });
    });
  }

  function registerPostIdContextAssessment() {
    videosRouter.post('/:id/context-assessment', async(req,res)=>{
      const {tenantId,userId}=res.locals as AuthLocals;
      try{const item=await createCandidateContextAssessment(store,tenantId,userId,req.params.id,req.body as CandidateContextInput,path.resolve(__dirname,'../../data/media'));res.json({ok:true,assessment:item,providerCalled:false,exactAnalysisReused:true});}
      catch(error){const code=error instanceof Error?error.message:'candidate_context_assessment_failed';res.status(code==='candidate_context_actor_forbidden'?403:409).json({error:code});}
    });
  }

  function registerPostIdContextAssessmentAssessmentIdEvaluate() {
    videosRouter.post('/:id/context-assessment/:assessmentId/evaluate',async(req,res)=>{
      const {tenantId,userId}=res.locals as AuthLocals;
      try{const taskId=typeof (req.body as Record<string,unknown>)?.taskId==='string'?String((req.body as Record<string,unknown>).taskId).trim():'';const contextRow=await store.getById<Record<string,unknown>>('social_candidate_context_assessments',req.params.assessmentId),context=contextRow?.payload as import('../socialDiscovery/candidateContextAssessment.js').CandidateContextAssessment|undefined;
        const result=await assessCandidateSemantics(store,tenantId,userId,req.params.id,req.params.assessmentId,taskId&&context?{paidCall:async()=>resolveCandidateSemanticPaidCall({store,tenantId,taskId,candidateId:req.params.id,context})}:{});res.status(result.state==='blocked'?409:result.state==='unknown'?202:200).json(result);}
      catch(error){const code=error instanceof Error?error.message:'candidate_semantic_failed';res.status(code==='candidate_semantic_actor_forbidden'?403:409).json({error:code});}
    });
  }

  async function handleAnalyzeSource(
    req: Request,
    res: Response,
    input: { id?: string; sourceUrl?: string; title?: string; platform?: Platform; async?: boolean },
  ): Promise<void> {
    const { tenantId } = res.locals as AuthLocals;
    try {
      let record: Record<string, unknown> | null = null;
      if (input.id) {
        record = await store.getById(COL, input.id);
        if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
          res.status(404).json({ error: 'Video record not found' });
          return;
        }
      }

      const source = resolvedPublicVideoSource(record, input);
      if (!source) {
        res.status(400).json({ error: '只允许当前记录绑定的 YouTube、TikTok、Instagram 或 Facebook HTTPS 单条视频链接' });
        return;
      }
      const job = {
        record,
        sourceUrl: source.sourceUrl,
        title: String(input.title || record?.title || `${source.platform}-video`),
        platform: source.platform,
      };

      if (input.async && record?.id) {
        if (!shouldQueueVideoAnalysis(record)) {
          res.status(202).json({ ok: true, status: 'already_queued', id: record.id });
          return;
        }
        await queueAnalyzeSource(record, job);
        res.status(202).json({ ok: true, status: 'queued', id: record.id });
        return;
      }

      const analysis = await analyzeSourceVideoJob(job);
      res.status(200).json({ ok: true, analysis });
    } catch (e) {
      console.error('[videos] analyze-source failed:', e);
      res.status(502).json({ error: e instanceof Error ? e.message : 'Video analysis failed' });
    }
  }

  async function handleDownloadMaterial(
    req: Request,
    res: Response,
    input: { id?: string; sourceUrl?: string; title?: string; platform?: Platform; async?: boolean },
  ): Promise<void> {
    const { tenantId } = res.locals as AuthLocals;
    try {
      let record: Record<string, unknown> | null = null;
      if (input.id) {
        record = await store.getById(COL, input.id);
        if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
          res.status(404).json({ error: 'Video record not found' });
          return;
        }
      }

      if (record) {
        const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
        const linkedMaterialId = String(analysis.materialId || '').trim();
        const materials = loadMaterials();
        const linkedMaterial = materials.find(item => item.id === linkedMaterialId && item.tenantId === tenantId);
        if (linkedMaterial) {
          linkedMaterial.pinned = true;
          persistMaterials(materials);
          res.status(200).json({ ok: true, material: linkedMaterial });
          return;
        }

        const hasStoredVideo = Boolean(analysis.videoObjectKey || record.videoFileId);
        if (hasStoredVideo) {
          const material = await copyStoredCrawlerVideoToMaterial({
            record,
            tenantId,
            title: String(input.title || record.title || `${record.platform || 'tiktok'}-video`),
            platform: (input.platform || record.platform || 'tiktok') as Platform,
            duration: Number(record.duration || 0),
          });
          res.status(201).json({ ok: true, material });
          return;
        }
      }

      const source = resolvedPublicVideoSource(record, input);
      if (!source) {
        res.status(400).json({ error: '只允许当前记录绑定的 YouTube、TikTok、Instagram 或 Facebook HTTPS 单条视频链接' });
        return;
      }
      const job = {
        record,
        tenantId,
        sourceUrl: source.sourceUrl,
        title: String(input.title || record?.title || `${source.platform}-video`),
        platform: source.platform,
        duration: Number(record?.duration || 0),
      };

      if (input.async && record?.id) {
        const analysis = parseJsonRecord(record.aiAnalysis, {});
        await store.update(COL, String(record.id), {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({ ...analysis, downloadStatus: 'queued', downloadQueuedAt: new Date().toISOString() }),
        });
        void downloadMaterialJob(job).catch((e) => {
          console.warn('[videos] async download-material failed:', e instanceof Error ? e.message : e);
        });
        res.status(202).json({ ok: true, status: 'queued', id: record.id });
        return;
      }

      const material = await downloadMaterialJob(job);
      res.status(201).json({ ok: true, material });
    } catch (e) {
      console.error('[videos] download-material failed:', e);
      res.status(502).json({ error: e instanceof Error ? e.message : 'Video download failed' });
    }
  }

  return { registerPostDownloadMaterial, registerPostIdDownloadMaterial, registerPostAnalyzeSource, registerPostIdAnalyzeSource, registerPostIdContextAssessment, registerPostIdContextAssessmentAssessmentIdEvaluate };
}
