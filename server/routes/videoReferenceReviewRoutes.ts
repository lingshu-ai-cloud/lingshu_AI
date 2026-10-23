import { createReferenceReviewReadHandlers } from '../lib/referenceReviewReadHandlers.js';
import { publicVideoRecord } from './videoPublicRecordProjection.js';
import { isPublicTestTenantVideo, isVisibleVideoPipelineRecord } from './videoRecordVisibility.js';
import { createReferencePhraseAsrHandler } from './referencePhraseAsr.js';
import { prepareReferenceNarration, readCachedReferenceNarration } from '../lib/referenceNarration.js';
import { lockReferenceSpeechTimeline } from '../lib/referenceSpeechAnalysis.js';
import { probeReferenceMediaClock } from '../lib/referenceMediaClock.js';
import { produceReferenceCriticalShots } from '../lib/referenceCriticalShotProduction.js';
import { produceReferenceProductionRouting } from '../lib/referenceProductionRouting.js';
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { fetchFile } from '../storage/files.js';
import { objectStorageEnabled, objectStorageDownload } from '../storage/objectStorage.js';
import { assertSalesPresenterQwenConfigured, reviewSalesPresenterFramesWithQwen } from '../agents/qwen.js';
import { salesReviewKey, validateSalesReview, SALES_REVIEW_VERSION, type SalesShot } from '../lib/salesPresenterReview.js';
import { resolveReferenceSalesPresenter } from './referencePresenterLock.js';
import { buildReferenceSpeechTimeline, type ReferenceStructureInput } from './referenceSpeechTimeline.js';
import { approximateSpeechLines } from '../lib/referenceApproxSpeech.js';
import { attachReviewShotMaterials, loadReferenceShotReview, reviewShotMaterialFingerprint, updateReferenceShotReview } from '../lib/referenceShotReview.js';
import { currentVerifiedSpeech, validateVerifiedSpeechLines, verifiedSpeechStatus, type VerifiedReferenceSpeech } from '../lib/verifiedReferenceSpeech.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { parseAnalysisTimeRange } from '../lib/videoAnalysisCodec.js';
import { parseJsonRecord } from './videoCrawlerNormalization.js';
import { COL, execFileAsync, MEDIA_DIR, ANALYSIS_DIR, ffmpegBin } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoReferenceReviewRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'localReferenceVideoPath' | 'uploadCrawlerCosObject' | 'crawlerCosKey' | 'streamCrawlerCosObject' | 'isTestTenantId' | 'durableAnalysisRecords' | 'probeDuration' | 'ensureLocalReferenceVideoPath'>) {
  const videosRouter = deps.videosRouter;
  const localReferenceVideoPath: VideoApplicationPorts['localReferenceVideoPath'] = (...args) => deps.localReferenceVideoPath(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);
  const crawlerCosKey: VideoApplicationPorts['crawlerCosKey'] = (...args) => deps.crawlerCosKey(...args);
  const streamCrawlerCosObject: VideoApplicationPorts['streamCrawlerCosObject'] = (...args) => deps.streamCrawlerCosObject(...args);
  const isTestTenantId: VideoApplicationPorts['isTestTenantId'] = (...args) => deps.isTestTenantId(...args);
  const durableAnalysisRecords = deps.durableAnalysisRecords;
  const probeDuration: VideoApplicationPorts['probeDuration'] = (...args) => deps.probeDuration(...args);
  const ensureLocalReferenceVideoPath: VideoApplicationPorts['ensureLocalReferenceVideoPath'] = (...args) => deps.ensureLocalReferenceVideoPath(...args);

  function registerGetIdShotReview() {
    videosRouter.get('/:id/shot-review', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(loadReferenceShotReview(record));
    });
  }

  function registerPutIdShotReview() {
    videosRouter.put('/:id/shot-review', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      try {
        const updated = updateReferenceShotReview(record, req.body || {});
        await store.update(COL, req.params.id, { referenceShotReview: JSON.stringify(updated), updatedAt: new Date().toISOString() });
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid_review';
        res.status(message === 'review_version_conflict' ? 409 : 400).json({ error: message });
      }
    });
  }

  function registerPostIdShotReviewShotIdMaterialize() {
    videosRouter.post('/:id/shot-review/:shotId/materialize', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      if (!ffmpegBin) { res.status(503).json({ error: 'ffmpeg_unavailable' }); return; }
      const review = loadReferenceShotReview(record);
      const shot = review.shots.find(item => item.shotId === req.params.shotId && item.reviewStatus !== 'discarded');
      if (!shot || !/^[A-Za-z0-9_-]{1,80}$/.test(shot.shotId)) { res.status(404).json({ error: 'review_shot_not_found' }); return; }
      if (String(req.body?.expectedVersion || '') !== review.version) { res.status(409).json({ error: 'review_version_conflict' }); return; }
      const key = reviewShotMaterialFingerprint(record, shot);
      const temporary = path.join(ANALYSIS_DIR, `review-${randomUUID()}`);
      const inputPath = `${temporary}-input.mp4`;
      const clipPath = `${temporary}-clip.mp4`;
      const framePath = `${temporary}-first-frame.jpg`;
      try {
        fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
        const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
        const local = localReferenceVideoPath(String(record.videoFileId || ''), tenantId);
        let source = local && fs.existsSync(local) ? local : '';
        if (!source) {
          const media = analysis.videoObjectKey ? await objectStorageDownload(String(analysis.videoObjectKey))
            : record.videoFileId ? await fetchFile(COL, req.params.id, String(record.videoFileId)) : null;
          if (!media || media.buf.length > 100 * 1024 * 1024) { res.status(404).json({ error: 'source_video_unavailable' }); return; }
          fs.writeFileSync(inputPath, media.buf); source = inputPath;
        }
        await execFileAsync(ffmpegBin, ['-hide_banner','-loglevel','error','-ss',String(shot.start),'-i',source,
          '-t',String(shot.end-shot.start),'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','24','-c:a','aac','-movflags','+faststart','-y',clipPath],{timeout:90_000});
        await execFileAsync(ffmpegBin, ['-hide_banner','-loglevel','error','-ss',String(shot.start+Math.min(.04,(shot.end-shot.start)/4)),'-i',source,
          '-frames:v','1','-q:v','3','-y',framePath],{timeout:30_000});
        if (objectStorageEnabled()) {
          await uploadCrawlerCosObject(req.params.id, `review-${key}-clip`, fs.readFileSync(clipPath), 'video/mp4');
          await uploadCrawlerCosObject(req.params.id, `review-${key}-first-frame`, fs.readFileSync(framePath), 'image/jpeg');
        } else {
          const dir = path.join(tenantAssetDir(MEDIA_DIR, tenantId), 'review-shots', req.params.id);
          fs.mkdirSync(dir,{recursive:true});
          fs.copyFileSync(clipPath,path.join(dir,`${key}.mp4`));
          fs.copyFileSync(framePath,path.join(dir,`${key}.jpg`));
        }
        const updated = attachReviewShotMaterials(record,shot.shotId,review.version);
        await store.update(COL,req.params.id,{referenceShotReview:JSON.stringify(updated),updatedAt:new Date().toISOString()});
        res.json(updated);
      } catch (error) {
        console.warn('[videos] review shot extraction failed:',error instanceof Error ? error.message : error);
        res.status(500).json({error:'review_shot_extraction_failed'});
      } finally {
        for (const file of [inputPath,clipPath,framePath]) try { fs.unlinkSync(file); } catch {}
      }
    });
  }

  function registerGetIdShotReviewShotIdKind() {
    videosRouter.get('/:id/shot-review/:shotId/:kind', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const review = loadReferenceShotReview(record);
      const shot = review.shots.find(item => item.shotId === req.params.shotId && item.reviewStatus !== 'discarded');
      const kind = req.params.kind;
      if (!shot || !['clip','first-frame'].includes(kind)) { res.status(404).json({ error: 'review_material_not_found' }); return; }
      const key = reviewShotMaterialFingerprint(record,shot);
      const expected = `/api/overseas/videos/${encodeURIComponent(req.params.id)}/shot-review/${encodeURIComponent(shot.shotId)}/${kind}?key=${key}`;
      if (req.query.key !== key || !shot.evidenceRefs.includes(expected)) { res.status(404).json({ error: 'review_material_not_found' }); return; }
      if (objectStorageEnabled()) {
        const objectKey = crawlerCosKey(record,`review-${key}-${kind}`,kind === 'clip' ? 'mp4' : 'jpg');
        if (!await streamCrawlerCosObject(res,objectKey,kind === 'clip' ? req.headers.range : undefined)) res.status(404).json({error:'review_material_not_found'});
        return;
      }
      const file = path.join(tenantAssetDir(MEDIA_DIR,tenantId),'review-shots',req.params.id,`${key}.${kind === 'clip' ? 'mp4' : 'jpg'}`);
      if (!fs.existsSync(file)) { res.status(404).json({error:'review_material_not_found'}); return; }
      res.setHeader('Cache-Control','private, max-age=3600'); res.sendFile(file);
    });
  }

  const referenceReviewReadHandlers=createReferenceReviewReadHandlers({store,isTestTenantId,isPublicTestTenantVideo,isVisibleVideoPipelineRecord,publicVideoRecord,presenter:async tenantId=>{
      const defaults=await store.list<{payload?:{presenters?:Array<Record<string,unknown>>}}>('studio_production_defaults',{where:{tenant_id:tenantId},perPage:2});
      return defaults.totalItems===1?resolveReferenceSalesPresenter(defaults.items):null;
    }});

  function registerGetIdReviewHandoff() {
    videosRouter.get('/:id/review-handoff',referenceReviewReadHandlers.handoff);
  }

  function registerGetIdVerifiedSpeech() {
    videosRouter.get('/:id/verified-speech', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const analysisRunId = String(analysis.analysisRunId || '');
      const sourceSha256 = String(analysis.contentSha256 || '');
      const saved = currentVerifiedSpeech(parseJsonRecord(record.referenceVerifiedSpeech, null), analysisRunId, sourceSha256);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ analysisRunId, sourceSha256, duration: Number(record.duration || 0),
        status: verifiedSpeechStatus(saved),
        coverageConfirmed: saved?.coverageConfirmed || false, lines: saved?.lines || [], reviewerId: saved?.reviewerId || null,
        verifiedAt: saved?.verifiedAt || null });
    });
  }

  function registerPutIdVerifiedSpeech() {
    videosRouter.put('/:id/verified-speech', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const analysisRunId = String(analysis.analysisRunId || '');
      const sourceSha256 = String(analysis.contentSha256 || '');
      if (!analysisRunId || !sourceSha256 || req.body?.analysisRunId !== analysisRunId || req.body?.sourceSha256 !== sourceSha256) {
        res.status(409).json({ error: '视频或分析版本已变化，请重新加载后校时' }); return;
      }
      let lines;
      try { lines = validateVerifiedSpeechLines(req.body?.lines, Number(record.duration || 0)); }
      catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '逐句口播无效' }); return; }
      const verifiedAt = new Date().toISOString();
      const coverageConfirmed = req.body?.coverageConfirmed === true;
      const saved: VerifiedReferenceSpeech = { schemaVersion: 1, analysisRunId, sourceSha256, lines, coverageConfirmed, reviewerId: userId, verifiedAt };
      await store.update(COL, req.params.id, { referenceVerifiedSpeech: JSON.stringify(saved) });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ analysisRunId, sourceSha256, duration: Number(record.duration || 0),
        status: verifiedSpeechStatus(saved), coverageConfirmed, lines, reviewerId: userId, verifiedAt });
    });
  }

  const salesReviewRunning = new Map<string, Promise<unknown>>();

  function registerPostIdSalesPresenterReview() {
    videosRouter.post('/:id/sales-presenter-review', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const analysis = parseJsonRecord<Record<string, any>>(record.aiAnalysis, {});
      const shots = (analysis.gemini?.scriptDetails15s || analysis.scriptDetails15s) as SalesShot[];
      if (!Array.isArray(shots) || !shots.length || shots.length > 60 || !analysis.contentSha256) { res.status(422).json({ error: '销售识别需要完整原片分镜及视频指纹，最多支持60个分镜' }); return; }
      const key = createHash('sha256').update(salesReviewKey(String(analysis.contentSha256), shots)).digest('hex');
      const previous = analysis.salesPresenterReview;
      if (previous?.key === key && previous.submitted !== false) {
        if (previous.state === 'completed') { res.json({ ok: true, cached: true, ...previous, rows: previous.rows.map((row: any) => ({ ...row, sourceVisual: shots[row.index]?.visual || '' })) }); return; }
        res.status(409).json({ error: previous.error || '该销售识别请求未完成，请核对原任务，未再次提交付费识别' }); return;
      }
      try { assertSalesPresenterQwenConfigured(); } catch { res.status(503).json({ error: '销售识别服务未配置千问凭证，未提交模型请求' }); return; }
      const filename = String(record.videoFileId || '');
      const videoPath = localReferenceVideoPath(filename, tenantId);
      if (!videoPath || !fs.existsSync(videoPath) || !ffmpegBin) { res.status(422).json({ error: '原片文件不可用，未提交销售识别' }); return; }
      const lock = `${tenantId}:${record.id}:${key}`;
      let pending = salesReviewRunning.get(lock);
      if (!pending) {
        pending = durableAnalysisRecords.run(`sales:${lock}`, async () => {
          const freshRecord = await store.getById<Record<string, unknown>>(COL, req.params.id);
          const freshAnalysis = parseJsonRecord<Record<string, any>>(freshRecord?.aiAnalysis, {});
          if (freshAnalysis.salesPresenterReview?.key === key && freshAnalysis.salesPresenterReview.submitted !== false) {
            if (freshAnalysis.salesPresenterReview.state === 'completed') return freshAnalysis.salesPresenterReview;
            throw new Error('销售识别尚未确认完成，未重复提交付费请求');
          }
          fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
          const dir = fs.mkdtempSync(path.join(ANALYSIS_DIR, 'sales-review-'));
          try {
            const probedDuration = await probeDuration(videoPath!);
            const videoDuration = Math.min(probedDuration, Number(record.duration) > 0 ? Number(record.duration) : probedDuration - .5);
            if (!Number.isFinite(videoDuration) || videoDuration <= 0) throw new Error('原片时长不可读取');
            const frames = [];
            for (let index = 0; index < shots.length; index++) {
              const range = parseAnalysisTimeRange(shots[index].time);
              if (!range || range.end <= range.start || range.start >= videoDuration) throw new Error('原片分镜时间无效');
              const clipEnd = Math.min(range.end, videoDuration - .05);
              const images: string[] = [];
              for (const fraction of [.55, .85]) {
                const target = path.join(dir, `${index}-${fraction}.jpg`);
                await execFileAsync(ffmpegBin!, ['-hide_banner', '-loglevel', 'error', '-ss', String(range.start + (clipEnd-range.start)*fraction), '-i', videoPath!, '-frames:v', '1', '-vf', 'scale=384:-2', '-q:v', '5', '-y', target], { timeout: 15000 });
                images.push(fs.readFileSync(target).toString('base64'));
              }
              frames.push({ index, images, dialogue: shots[index].dialogue || '', visual: shots[index].visual || '' });
            }
            // Persist before paid submission. Unknown/failure never silently retries.
            const latest = await store.getById<Record<string, unknown>>(COL, req.params.id);
            const before = parseJsonRecord<Record<string, any>>(latest?.aiAnalysis, {});
            if (createHash('sha256').update(salesReviewKey(String(before.contentSha256), before.gemini?.scriptDetails15s || before.scriptDetails15s || [])).digest('hex') !== key) throw new Error('原片分析已变化，请重新打开草稿');
            await store.update(COL, req.params.id, { aiAnalysis: JSON.stringify({ ...before, salesPresenterReview: { key, version: SALES_REVIEW_VERSION, state: 'running', provider: 'qwen', submitted: true, startedAt: new Date().toISOString() } }) });
            const recognition = await reviewSalesPresenterFramesWithQwen({ frames });
            const rows = validateSalesReview(recognition, shots.length);
            const current = await store.getById<Record<string, unknown>>(COL, req.params.id);
            const saved = parseJsonRecord<Record<string, any>>(current?.aiAnalysis, {});
            if (saved.salesPresenterReview?.key !== key || createHash('sha256').update(salesReviewKey(String(saved.contentSha256), saved.gemini?.scriptDetails15s || saved.scriptDetails15s || [])).digest('hex') !== key) throw new Error('原片分析已变化，识别结果未覆盖新分析');
            const review = { key, version: SALES_REVIEW_VERSION, provider: recognition.provider, model: recognition.model, usage: recognition.usage, state: 'completed', rows: rows.map(row => ({ ...row, time: shots[row.index].time, sourceVisual: shots[row.index].visual || '' })), digitalHumanShotIndexes: rows.filter(row => row.observedPresenterRole === 'sales_presenter' && !row.needsReview).map(row => row.index), presenterGroups: [...new Set(rows.filter(row => row.observedPresenterRole === 'sales_presenter' && !row.needsReview).map(row => row.personContinuityId))].map(personId => ({ personId, shotIndexes: rows.filter(row => row.observedPresenterRole === 'sales_presenter' && !row.needsReview && row.personContinuityId === personId).map(row => row.index) })), frameCount: frames.length * 2, completedAt: new Date().toISOString() };
            const reviewedShots = (saved.gemini?.scriptDetails15s || saved.scriptDetails15s).map((shot: any, index: number) => ({ ...shot,
              observedPresenterRole: rows[index].observedPresenterRole, personContinuityId: rows[index].personContinuityId,
              salesPresenterConfirmed: rows[index].observedPresenterRole === 'sales_presenter' && !rows[index].needsReview,
              presenterRecognition: rows[index] }));
            await store.update(COL, req.params.id, { aiAnalysis: JSON.stringify({ ...saved, salesPresenterReview: review,
                ...(saved.gemini?.scriptDetails15s ? { gemini: { ...saved.gemini, scriptDetails15s: reviewedShots } } : { scriptDetails15s: reviewedShots }) }) });
            return review;
          } catch (error) {
            const failedRecord = await store.getById<Record<string, unknown>>(COL, req.params.id);
            const failedAnalysis = parseJsonRecord<Record<string, any>>(failedRecord?.aiAnalysis, {});
            if (failedAnalysis.salesPresenterReview?.key === key && failedAnalysis.salesPresenterReview.state === 'running') {
              await store.update(COL, req.params.id, { aiAnalysis: JSON.stringify({ ...failedAnalysis,
                  salesPresenterReview: { ...failedAnalysis.salesPresenterReview, state: 'failed', failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : '销售识别失败' } }) });
            }
            throw error;
          } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });
        salesReviewRunning.set(lock, pending);
        pending.finally(() => salesReviewRunning.delete(lock)).catch(() => {});
      }
      try { res.json({ ok: true, cached: false, ...(await pending as object) }); }
      catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : '销售识别失败' }); }
    });
  }

  function registerPostIdAlignSpeech() {
    videosRouter.post('/:id/align-speech', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const recordId = String(req.params.id);
      const record = await store.getById<Record<string, unknown>>(COL, recordId);
      if (!record || String(record.tenantId || '') !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const before = parseJsonRecord<Record<string, any>>(record.aiAnalysis, {});
      const videoPath = localReferenceVideoPath(String(record.videoFileId || ''), tenantId);
      if (!videoPath || !fs.existsSync(videoPath)) { res.status(422).json({ error: '本地原片不可用，不能建立真实词级对齐' }); return; }
      const fingerprint = (value: Record<string, any>) => createHash('sha256').update(JSON.stringify({
        contentSha256: value.contentSha256, analysisRunId: value.analysisRunId, gemini: value.gemini,
      })).digest('hex');
      try {
        const measuredHash = createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex');
        if (before.contentSha256 && before.contentSha256 !== measuredHash) {
          res.status(409).json({ error: '原片已变化，不能将新音频写入旧分镜分析' }); return;
        }
        const clock = await probeReferenceMediaClock(videoPath);
        const transcript = await prepareReferenceNarration(videoPath, clock.duration, { tenantId });
        const mapped = lockReferenceSpeechTimeline(before.gemini, transcript, { duration: clock.duration, fps: clock.fps ?? undefined });
        const latest = await store.getById<Record<string, unknown>>(COL, recordId);
        const current = parseJsonRecord<Record<string, any>>(latest?.aiAnalysis, {});
        if (!latest || String(latest.tenantId || '') !== tenantId || fingerprint(current) !== fingerprint(before)) {
          res.status(409).json({ error: '分析已变化，对齐结果未覆盖新分析' }); return;
        }
        const alignment = { version: 2, status: 'aligned', provider: 'qwen', model: transcript.model,
          taskId: transcript.taskId, sourceSha256: measuredHash, audioSha256: transcript.sourceSha256,
          wordCount: transcript.words.length, shotCount: mapped.scriptDetails15s?.length || 0,
          mappedWordCount: mapped.speechAlignmentSummary?.acceptedWordCount || 0,
          clippedShotIds: mapped.speechAlignmentSummary?.clippedShotIds || [],
          timestampResolutionMs: transcript.timestampResolutionMs, accuracyMs: transcript.accuracyMs,
          durationSeconds: clock.duration, fps: clock.fps, completedAt: new Date().toISOString() };
        if (!await store.update(COL, recordId, { duration: clock.duration,
          aiAnalysis: JSON.stringify({ ...current, gemini: mapped, speechAlignment: alignment,
            // A previous semantic classification cannot survive a changed audio clock.
            criticalShotAnalysis: undefined, referenceProductionRoutingSummary: undefined }) })) throw new Error('对齐结果保存失败');
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ ok: true, status: 'aligned', alignment, analysisRunId: current.analysisRunId, sourceSha256: measuredHash });
      } catch (error) { res.status(422).json({ ok: false, status: 'unavailable',
          error: error instanceof Error ? error.message : '口播对齐失败，未伪造时间戳' }); }
    });
  }

  function registerPostIdClassifyCriticalShots() {
    videosRouter.post('/:id/classify-critical-shots', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const id = String(req.params.id);
      const record = await store.getById<Record<string, unknown>>(COL, id);
      if (!record || record.tenantId !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const before = parseJsonRecord<Record<string, any>>(record.aiAnalysis, {});
      const filePath = await ensureLocalReferenceVideoPath(record, tenantId);
      if (!filePath || !fs.existsSync(filePath)) { res.status(422).json({ error: '原片不可用，不能观察实际动作' }); return; }
      if (!before.gemini?.audioTranscript?.words?.length || !before.gemini?.speechAlignmentSummary?.acceptedWordCount) {
        res.status(422).json({ error: '缺少真实词级对齐，不能判定动作台词卡点' }); return;
      }
      const fingerprint = (value: Record<string, any>) => createHash('sha256')
        .update(JSON.stringify({ contentSha256: value.contentSha256, analysisRunId: value.analysisRunId, gemini: value.gemini })).digest('hex');
      try {
        const sourceSha256 = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        if (before.contentSha256 && before.contentSha256 !== sourceSha256) { res.status(409).json({ error: '源视频已变化' }); return; }
        const clock = await probeReferenceMediaClock(filePath);
        const critical = await produceReferenceCriticalShots({ filePath, analysis: before.gemini,
          videoId: id, sourceSha256, duration: clock.duration, tenantId });
        const classified = before.gemini.presenterContinuitySummary
          ? await produceReferenceProductionRouting({filePath,analysis:critical,videoId:id,sourceSha256,duration:clock.duration,tenantId}) : critical;
        const latest = await store.getById<Record<string, unknown>>(COL, id);
        const current = parseJsonRecord<Record<string, any>>(latest?.aiAnalysis, {});
        if (!latest || latest.tenantId !== tenantId || fingerprint(current) !== fingerprint(before)) {
          res.status(409).json({ error: '分析已变化，卡点判定未覆盖新版本' }); return;
        }
        if (!await store.update(COL, id, { aiAnalysis: JSON.stringify({ ...current,
            gemini: classified, criticalShotAnalysis: classified.criticalShotSummary }) })) throw new Error('卡点判定保存失败');
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ ok: true, status: 'classified', classification: classified.criticalShotSummary });
      } catch (error) { res.status(422).json({ ok: false, status: 'unavailable',
          error: error instanceof Error ? error.message : '卡点识别失败，未伪造判定' }); }
    });
  }

  function registerPostIdRouteProduction() {
    videosRouter.post('/:id/route-production', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const id = String(req.params.id), record = await store.getById<Record<string, unknown>>(COL, id);
      if (!record || record.tenantId !== tenantId) { res.status(404).json({ error: 'Not found' }); return; }
      const before = parseJsonRecord<Record<string, any>>(record.aiAnalysis, {});
      const filePath = await ensureLocalReferenceVideoPath(record, tenantId);
      if (!filePath || !fs.existsSync(filePath)) { res.status(422).json({ error: '原片不可用，不能识别人物连续性' }); return; }
      if (!before.gemini?.scriptDetails15s?.length || !before.gemini.scriptDetails15s.every((s:any)=>s.criticalShot)) {
        res.status(422).json({ error: '缺少独立关键性证据，先完成原片分析' }); return;
      }
      const fingerprint = (value: Record<string, any>) => createHash('sha256').update(JSON.stringify({
        source:value.contentSha256,run:value.analysisRunId,gemini:value.gemini })).digest('hex');
      try {
        const sourceSha256 = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        if (before.contentSha256 !== sourceSha256) { res.status(409).json({ error: '原片指纹已变化' }); return; }
        const clock = await probeReferenceMediaClock(filePath);
        const routed = await produceReferenceProductionRouting({filePath,analysis:before.gemini,sourceSha256,
          videoId:id,tenantId,duration:clock.duration});
        const latest = await store.getById<Record<string,unknown>>(COL,id), current = parseJsonRecord<Record<string,any>>(latest?.aiAnalysis,{});
        if (!latest || latest.tenantId !== tenantId || fingerprint(current) !== fingerprint(before)) {
          res.status(409).json({error:'分析已变化，人物路由未覆盖新版本'});return;
        }
        if(!await store.update(COL,id,{aiAnalysis:JSON.stringify({...current,gemini:routed,
            presenterContinuitySummary:routed.presenterContinuitySummary,referenceProductionRoutingSummary:routed.referenceProductionRoutingSummary})})) throw new Error('生产路由保存失败');
        res.setHeader('Cache-Control','private, no-store');
        res.json({ok:true,status:'routed',presenterContinuitySummary:routed.presenterContinuitySummary,
          routing:routed.referenceProductionRoutingSummary});
      } catch(error) {res.status(422).json({ok:false,status:'unavailable',error:error instanceof Error?error.message:'人物识别失败，未猜测路由'});}
    });
  }

  function registerPostIdPhraseAsr() {
    videosRouter.post('/:id/phrase-asr', createReferencePhraseAsrHandler({
      readRecord: id => store.getById(COL,id),
      localPath: localReferenceVideoPath,
      exists: fs.existsSync,
      probe: probeReferenceMediaClock,
      prepare: prepareReferenceNarration,
      readCache: readCachedReferenceNarration,
    }));
  }

  function registerPostIdSpeechTimeline() {
    videosRouter.post('/:id/speech-timeline', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || String(record.tenantId || '') !== tenantId) {
        res.status(404).json({ error: 'Not found' }); return;
      }
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const shotReview = parseJsonRecord<Record<string, unknown>>(record.referenceShotReview, {});
      const currentShotReview = String(shotReview.sourceAnalysisRunId || '') === String(analysis.analysisRunId || '')
        && Boolean(shotReview.sourceAnalysisRunId);
      const rawSections = currentShotReview && Array.isArray(shotReview.sections)
        ? shotReview.sections : req.body?.sections;
      if (!Array.isArray(rawSections) || rawSections.length !== 6 || rawSections.some(item =>
        !item || typeof item.sectionId !== 'string' || typeof item.title !== 'string'
        || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start)) {
        res.status(400).json({ error: 'Six valid narrative sections are required' }); return;
      }
      const sections = rawSections as ReferenceStructureInput[];
      const gemini = analysis.gemini && typeof analysis.gemini === 'object'
        ? analysis.gemini as Record<string, unknown> : parseJsonRecord<Record<string, unknown>>(analysis.gemini, {});
      const transcript = gemini.audioTranscript && typeof gemini.audioTranscript === 'object'
        ? gemini.audioTranscript as Record<string, unknown>
        : parseJsonRecord<Record<string, unknown>>(gemini.audioTranscript, {});
      const savedSpeech = currentVerifiedSpeech(parseJsonRecord(record.referenceVerifiedSpeech, null),
        String(analysis.analysisRunId || ''), String(analysis.contentSha256 || ''));
      const speech = savedSpeech ? savedSpeech.lines.map(line => ({ ...line, timingPrecision: 'phrase' as const,
        provenance: `manual_verified:${savedSpeech.reviewerId}:${savedSpeech.verifiedAt}` }))
        : approximateSpeechLines(transcript.segments);
      const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
      const candidateShots = details.flatMap((raw, index) => {
        const detail = raw && typeof raw === 'object' ? raw as Record<string, unknown>
          : parseJsonRecord<Record<string, unknown>>(raw, {});
        const range = parseAnalysisTimeRange(String(detail.time || detail.timestamp || ''));
        return range ? [{ shotId: `shot-${index + 1}`, start: range.start, end: range.end,
          content: String(detail.visual || ''), purpose: String(detail.purpose || '') }] : [];
      });
      const shots = currentShotReview && Array.isArray(shotReview.shots)
        ? (shotReview.shots as Array<Record<string, unknown>>).filter(shot => shot.reviewStatus !== 'discarded').map(shot => ({
          shotId: String(shot.shotId || ''), start: Number(shot.start), end: Number(shot.end),
          content: String(shot.content || ''), purpose: String(shot.purpose || ''),
        })) : candidateShots;
      const timeline = buildReferenceSpeechTimeline({
        speech: Array.isArray(speech) ? speech as any : [], shots, sections,
        speechCoverageVerified: savedSpeech?.coverageConfirmed === true,
        shotCutsVerified: currentShotReview && shotReview.reviewComplete === true && req.body?.shotCutsVerified === true,
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ referenceRecordId: req.params.id, analysisRunId: analysis.analysisRunId || null, ...timeline });
    });
  }

  function registerGetId() {
    videosRouter.get('/:id',referenceReviewReadHandlers.video);
  }

  function registerPatchIdAnalysisCorrections() {
    videosRouter.patch('/:id/analysis-corrections', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById(COL, req.params.id);
      if (!record) { res.status(404).json({ error: 'Not found' }); return; }
      if (record.tenantId !== tenantId && !await requireAdminUser(req)) { res.status(404).json({ error: 'Not found' }); return; }
      const details = Array.isArray(req.body?.scriptDetails15s) ? req.body.scriptDetails15s.slice(0, 500) : null;
      const summary = req.body?.scriptSummary15s && typeof req.body.scriptSummary15s === 'object' ? req.body.scriptSummary15s : null;
      if (!details) { res.status(400).json({ error: 'scriptDetails15s required' }); return; }
      const previous = parseJsonRecord<Record<string, any>>(record.aiAnalysis, {});
      const gemini = previous.gemini && typeof previous.gemini === 'object' ? previous.gemini : {};
      const correctedAt = new Date().toISOString();
      const next = {
        ...previous,
        originalGemini: previous.originalGemini || gemini,
        gemini: { ...gemini, ...(summary ? { scriptSummary15s: summary } : {}), scriptDetails15s: details },
        correction: { correctedAt, correctedBy: userId, confirmed: Boolean(req.body?.confirmed), version: Number(previous.correction?.version || 0) + 1 },
      };
      await store.update(COL, req.params.id, { aiAnalysis: JSON.stringify(next) });
      res.json({ ok: true, correctedAt, version: next.correction.version, analysis: next.gemini });
    });
  }

  function registerPostIdRefinementSync() {
    videosRouter.post('/:id/refinement-sync', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
        res.status(404).json({ error: 'Video record not found' });
        return;
      }
      const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      if (previous.analysisMode !== 'exact' || previous.requestedAnalysisMode === 'exact' || previous.analysisError) {
        res.status(409).json({ error: '请先完成合格的全片精确分析，再进入精修流程' });
        return;
      }
      const syncedAt = new Date().toISOString();
      await store.update(COL, req.params.id, {
        aiAnalysis: JSON.stringify({
          ...previous,
          refinementStatus: 'ready',
          refinementQueuedAt: syncedAt,
          refinementQueuedBy: userId,
          refinementSource: String(req.body?.source || 'inspiration_analysis'),
        }),
      });
      res.json({ ok: true, id: req.params.id, status: 'ready', syncedAt });
    });
  }

  return { registerGetIdShotReview, registerPutIdShotReview, registerPostIdShotReviewShotIdMaterialize, registerGetIdShotReviewShotIdKind, registerGetIdReviewHandoff, registerGetIdVerifiedSpeech, registerPutIdVerifiedSpeech, registerPostIdSalesPresenterReview, registerPostIdAlignSpeech, registerPostIdClassifyCriticalShots, registerPostIdRouteProduction, registerPostIdPhraseAsr, registerPostIdSpeechTimeline, registerGetId, registerPatchIdAnalysisCorrections, registerPostIdRefinementSync };
}
