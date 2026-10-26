import { groupExactObservationWindows, selectFramesForPhysicalCuts } from '../routes/videoAnalysisTimelineProjection.js';
import { classifyDiscoverySourceFailure } from '../socialDiscovery/sourceFailure.js';
import { exactQwenScope } from '../agents/exactQwenScope.js';
import { lockReferenceSpeechTimeline, type ReferenceSpeechTranscript } from '../lib/referenceSpeechAnalysis.js';
import { probeReferenceMediaClock } from '../lib/referenceMediaClock.js';
import { produceReferenceCriticalShots } from '../lib/referenceCriticalShotProduction.js';
import { produceReferenceProductionRouting } from '../lib/referenceProductionRouting.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { presenterDenseSamplingRanges, requiresPresenterDenseSampling, type ReferenceFrameSamplingRange } from '../lib/referenceFrameSamplingPolicy.js';
import { detectVideoSceneCuts, extractOpeningHookFrames, extractQwenAnalysisFrames } from '../routes/videoFrameExtraction.js';
import { analyzeVideo } from '../agents/gemini.js';
import { analyzeVideoFramesWithQwen, repairVideoShotClassificationsWithQwen, inspectOpeningHookMotionWithQwen } from '../agents/qwen.js';
import type { Platform, VideoAiAnalysis } from '../types/index.js';
import { analysisTimelineQualityError, exactVideoClassificationQualityError, parseAnalysisTimeRange } from '../lib/videoAnalysisCodec.js';
import { applyOpeningHookMotionEvidence, firstSubstantiveOpeningShot } from '../routes/hookMotionEvidence.js';
import { ffmpegBin } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoAnalysisProvider(deps: Pick<VideoApplicationPorts, 'referenceNarrationForVideoAnalysis' | 'analyzeExactLongVideoChunks' | 'lockAsrTimeline' | 'assertFullVideoTimeline' | 'enrichExactGeminiEvidence' | 'runFfmpeg'>) {
  const referenceNarrationForVideoAnalysis: VideoApplicationPorts['referenceNarrationForVideoAnalysis'] = (...args) => deps.referenceNarrationForVideoAnalysis(...args);
  const analyzeExactLongVideoChunks: VideoApplicationPorts['analyzeExactLongVideoChunks'] = (...args) => deps.analyzeExactLongVideoChunks(...args);
  const lockAsrTimeline: VideoApplicationPorts['lockAsrTimeline'] = (...args) => deps.lockAsrTimeline(...args);
  const assertFullVideoTimeline: VideoApplicationPorts['assertFullVideoTimeline'] = (...args) => deps.assertFullVideoTimeline(...args);
  const enrichExactGeminiEvidence: VideoApplicationPorts['enrichExactGeminiEvidence'] = (...args) => deps.enrichExactGeminiEvidence(...args);
  const runFfmpeg: VideoApplicationPorts['runFfmpeg'] = (...args) => deps.runFfmpeg(...args);

  function isQwenConfigured(): boolean {
    let fileKey = '';
    try { fileKey = fs.readFileSync(process.env.DASHSCOPE_API_KEY_FILE || path.join(process.env.HOME || '', '.config/lingshu/dashscope.key'), 'utf8').trim(); } catch { /* optional */ }
    const key = process.env.DASHSCOPE_API_KEY?.trim() || fileKey;
    return /^[\x21-\x7E]{20,}$/.test(key);
  }

  function isGeminiConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }

  function shouldUseQwenFirst(): boolean {
    return (process.env.VIDEO_ANALYSIS_PROVIDER || 'qwen').trim().toLowerCase() === 'qwen';
  }

  function qwenFallbackTimeoutMs(): number {
    return Math.max(3000, Number(process.env.QWEN_VIDEO_FALLBACK_TIMEOUT_MS || 12000));
  }

  function videoAnalysisHardTimeoutMs(analysisMode: 'strategy' | 'exact' = 'strategy'): number {
    // Bound the complete frame extraction + ASR + VL request, not only the
    // individual OpenAI-compatible HTTP call.  Otherwise a record can remain in
    // `analyzing` forever when one of the preparatory stages stalls.
    const fallback = analysisMode === 'exact' ? 720_000 : 150_000;
    return Math.max(30_000, Number(process.env.VIDEO_ANALYSIS_HARD_TIMEOUT_MS || fallback));
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  function isRetryableAnalysisFailure(error: unknown): boolean {
    if (classifyDiscoverySourceFailure(error) === 'model_unavailable') return false;
    return /analysis_quality_retryable|analysis_retryable|chunk_quality_failed|video_analysis_hard_timeout|exact_chunk_timeout/i
      .test(error instanceof Error ? error.message : String(error));
  }

  const permitsCrossProviderHookMotionInspection = () => !exactQwenScope();

  function readExactQwenScopeContinuity(){const current=exactQwenScope();return current?{model:current.model,configurationHash:current.configurationHash,endpoint:current.endpoint,credentialDigest:current.credentialDigest}:null;}

  async function analyzeDownloadedVideoWithFallback(opts: {
    filePath: string;
    mimeType: string;
    title?: string;
    platform?: Platform;
    duration?: number;
    views?: string;
    tags?: string[];
    sourceLabel: string;
    videoId?: string;
    tenantId?: string;
    analysisMode?: 'strategy' | 'exact';
    analysisRunId?: string;
    videoObjectKey?: string;
  }): Promise<{ analysis: VideoAiAnalysis; source: string }> {
    const sourceClock = await probeReferenceMediaClock(opts.filePath);
    opts = { ...opts, duration: sourceClock.duration };
    const sourceSha256 = createHash('sha256').update(fs.readFileSync(opts.filePath)).digest('hex');
    let speechPromise: Promise<ReferenceSpeechTranscript | undefined> | undefined;
    // A weekly candidate model revision authorizes one exact VL model/provider,
    // not an additional ASR product. Reuse already measured words when present,
    // but never turn the scoped visual retry into an unapproved paid ASR submit.
    const sourceSpeech = () => speechPromise ??= referenceNarrationForVideoAnalysis(
      opts.filePath, Number(opts.duration), opts.tenantId || 'reference_analysis')
      .catch(error => {
        console.warn('[videos] Measured source speech unavailable:', error instanceof Error ? error.message : error);
        return { text: '', segments: [], words: [], alignmentStatus: 'unavailable',
          alignmentError: error instanceof Error ? error.message : 'source_speech_unavailable' };
      });
    const finishSourceAnalysis = async (analysis: VideoAiAnalysis) => {
      const locked = lockReferenceSpeechTimeline(analysis, await sourceSpeech(),
        { duration: sourceClock.duration, fps: sourceClock.fps ?? undefined });
      const sourceBound = { ...locked, contentSha256: sourceSha256,
        durationSeconds: sourceClock.duration } as VideoAiAnalysis;
      const withClock: VideoAiAnalysis = opts.analysisMode === 'exact' && opts.analysisRunId ? {
        ...sourceBound,
        sourceMediaClock: { schemaVersion: 1, duration: sourceClock.duration, fps: sourceClock.fps,
          sourceSha256, analysisRunId: opts.analysisRunId, ...(opts.videoObjectKey ? { videoObjectKey: opts.videoObjectKey } : {}),
          measuredAt: new Date().toISOString() },
      } : sourceBound;
      if (opts.analysisMode !== 'exact' || !withClock.audioTranscript?.words?.length) return withClock;
      try {
        const sourceInput = { filePath: opts.filePath, analysis: withClock,
          videoId: opts.videoId || path.basename(opts.filePath, path.extname(opts.filePath)),
          sourceSha256,
          duration: sourceClock.duration, tenantId: opts.tenantId };
        const classified = await produceReferenceCriticalShots(sourceInput);
        try { return await produceReferenceProductionRouting({ ...sourceInput, analysis: classified }); }
        catch (error) { return { ...classified, referenceProductionRoutingError: error instanceof Error ? error.message : 'person_continuity_unavailable' }; }
      } catch (error) {
        return { ...withClock, criticalShotError: error instanceof Error ? error.message : 'critical_shot_unavailable' };
      }
    };
    const runQwen = async () => {
      // Dense opening frames + evenly distributed full-video evidence. Sixty base64
      // frames made long-video requests time out without materially improving the
      // Eighteen frames combine a dense opening with uniform and scene-change
      // evidence across the full duration, small enough for a reliable request.
      const exactFrameCount = Math.max(24, Math.min(72, Number(process.env.VIDEO_QWEN_EXACT_FRAME_COUNT || 42)));
      const strategyFrameCount = Math.max(3, Math.min(24, Number(process.env.VIDEO_QWEN_FRAME_COUNT || Math.ceil(Math.max(Number(opts.duration || 0), 10) / 5) + 1)));
      const detectedSceneCuts = opts.analysisMode === 'exact' ? await detectVideoSceneCuts(opts.filePath) : [];
      const coarseFrames = await extractQwenAnalysisFrames(
        opts.filePath,
        opts.analysisMode === 'exact' ? exactFrameCount : strategyFrameCount,
        Number(opts.duration || 0),
        opts.analysisMode === 'exact' ? 'exact' : 'strategy',
        detectedSceneCuts,
        'coarse',
      );
      const transcript = await sourceSpeech();
      let frames = coarseFrames;
      let presenterDenseSampling: { intervalSeconds: 0.5; ranges: ReferenceFrameSamplingRange[] } | null = null;
      if (opts.analysisMode === 'exact') {
        // Pass one answers only the material-type question from coarse, whole-video
        // evidence. Only a confirmed presenter shot authorizes the second,
        // temporally dense extraction used to distinguish stable/dynamic speech.
        const classificationFrames = selectFramesForPhysicalCuts(
          coarseFrames, detectedSceneCuts, 0, Number(opts.duration || 0), Math.min(12, coarseFrames.length),
        );
        const preliminary = await analyzeVideoFramesWithQwen({
          frames: classificationFrames,
          title: opts.title,
          platform: opts.platform,
          duration: opts.duration,
          views: opts.views,
          tags: opts.tags,
          transcript,
          analysisMode: 'strategy',
          exactModel: true,
        });
        if (requiresPresenterDenseSampling(preliminary)) {
          const denseRanges = presenterDenseSamplingRanges(preliminary, Number(opts.duration || 0));
          presenterDenseSampling = { intervalSeconds: 0.5, ranges: denseRanges };
          frames = await extractQwenAnalysisFrames(
            opts.filePath, Math.max(exactFrameCount, Math.ceil(denseRanges.reduce((sum, range) => sum + range.endSeconds - range.startSeconds, 0) * 2)),
            Number(opts.duration || 0), 'exact', detectedSceneCuts, 'talking_head_dense', denseRanges,
          );
        }
      }
      // Exact mode always uses the chunk path, including short clips. Strategy
      // mode also chunks longer clips so each request stays bounded. Missing or
      // low-quality timelines now fail as retryable instead of being padded with
      // invented tail segments.
      const qwenAnalysis = opts.analysisMode === 'exact' || Number(opts.duration || 0) > 15
        ? await analyzeExactLongVideoChunks({ filePath: opts.filePath, frames, title: opts.title, platform: opts.platform, duration: Number(opts.duration), views: opts.views, tags: opts.tags, transcript, analysisMode: opts.analysisMode || 'strategy', sceneCuts: detectedSceneCuts })
        : await analyzeVideoFramesWithQwen({
          frames,
          title: opts.title,
          platform: opts.platform,
          duration: opts.duration,
          views: opts.views,
          tags: opts.tags,
          transcript,
          analysisMode: opts.analysisMode || 'strategy',
        });
      const observationAnalysis = lockAsrTimeline(qwenAnalysis, transcript);
      assertFullVideoTimeline(observationAnalysis, Number(opts.duration || 0), 'qwen');
      const qualityError = analysisTimelineQualityError(observationAnalysis, Number(opts.duration || 0), opts.analysisMode || 'strategy');
      if (qualityError) throw new Error(`analysis_quality_retryable_${qualityError}`);
      let analysis = opts.analysisMode === 'exact'
        ? groupExactObservationWindows(observationAnalysis, detectedSceneCuts)
        : observationAnalysis;
      analysis = lockReferenceSpeechTimeline(analysis, transcript, { duration: Number(opts.duration), fps: sourceClock.fps ?? undefined });
      if (opts.analysisMode === 'exact' && (exactVideoClassificationQualityError(analysis)
        || (analysis.scriptDetails15s || []).some(shot => shot.needsReview === true))) {
        analysis = await repairVideoShotClassificationsWithQwen(analysis);
      }
      let hookReviewReasons: string[] = [];
      if (opts.analysisMode === 'exact') {
        const hookIndex = firstSubstantiveOpeningShot(analysis);
        if (hookIndex >= 0) {
          const hook = analysis.scriptDetails15s?.[hookIndex];
          const range = parseAnalysisTimeRange(String(hook?.time || hook?.timestamp || ''));
          if (range) {
            let motionEvidence;
            try {
              // Keep this Qwen pipeline on its configured provider/model,
              // including frozen paid scopes; no second provider is required.
              const hookFrames = await extractOpeningHookFrames(opts.filePath);
              motionEvidence = await inspectOpeningHookMotionWithQwen({ frames: hookFrames, start: 0, end: 1 });
            } catch (error) {
              console.warn('[videos] opening hook motion inspection unavailable:', error instanceof Error ? error.message : error);
              motionEvidence = { observations: [], transitions: [], uncertainties: ['opening_hook_motion_inspection_failed'] };
            }
            const applied = applyOpeningHookMotionEvidence(analysis, motionEvidence);
            analysis = applied.analysis;
            hookReviewReasons = applied.reviewReasons;
          }
        } else {
          hookReviewReasons = ['opening_hook_no_substantive_shot'];
        }
      }
      return { analysis: await finishSourceAnalysis({ ...analysis, detectedSceneCuts, hookReviewReasons,
          ...(presenterDenseSampling ? { presenterDenseSampling } : {}) } as VideoAiAnalysis), source: 'qwen-frame-video' };
    };

    if (exactQwenScope() || shouldUseQwenFirst()) {
      if (!isQwenConfigured()) throw new Error('DASHSCOPE_API_KEY is not set');
      return withTimeout(runQwen(), videoAnalysisHardTimeoutMs(opts.analysisMode), 'video_analysis_hard_timeout');
    }

    try {
      const buf = fs.readFileSync(opts.filePath);
      const geminiPromise = analyzeVideo({
        videoBase64: buf.toString('base64'),
        mimeType: opts.mimeType,
        analysisMode: opts.analysisMode || 'strategy',
      });
      let analysis = isQwenConfigured()
        ? await withTimeout(geminiPromise, qwenFallbackTimeoutMs(), 'Gemini analysis timed out before Qwen fallback')
        : await geminiPromise;
      if (opts.analysisMode === 'exact') analysis = await enrichExactGeminiEvidence(opts.filePath, analysis);
      assertFullVideoTimeline(analysis, Number(opts.duration || 0), 'gemini');
      const qualityError = analysisTimelineQualityError(analysis, Number(opts.duration || 0), opts.analysisMode || 'strategy');
      if (qualityError) throw new Error(`analysis_quality_retryable_${qualityError}`);
      return { analysis: await finishSourceAnalysis(analysis), source: opts.sourceLabel };
    } catch (e) {
      // Promise timeouts do not prove that Gemini rejected or cancelled the
      // upstream request. Starting Qwen here could create a second paid analysis
      // while the first provider is still running. Fail closed and let the saved
      // run be reconciled instead of switching providers on an unknown outcome.
      if (/Gemini analysis timed out before Qwen fallback/i.test(e instanceof Error ? e.message : String(e))) throw e;
      if (shouldRetryGeminiWithNormalizedVideo(e)) {
        const normalizedPath = await normalizeVideoForGemini(opts.filePath);
        if (normalizedPath) {
          try {
            const buf = fs.readFileSync(normalizedPath);
            let analysis = await analyzeVideo({
              videoBase64: buf.toString('base64'),
              mimeType: 'video/mp4',
              analysisMode: opts.analysisMode || 'strategy',
            });
            if (opts.analysisMode === 'exact') analysis = await enrichExactGeminiEvidence(normalizedPath, analysis);
            assertFullVideoTimeline(analysis, Number(opts.duration || 0), 'gemini_normalized');
            const qualityError = analysisTimelineQualityError(analysis, Number(opts.duration || 0), opts.analysisMode || 'strategy');
            if (qualityError) throw new Error(`analysis_quality_retryable_${qualityError}`);
            return { analysis: await finishSourceAnalysis(analysis), source: `${opts.sourceLabel}-normalized` };
          } catch (normalizedError) {
            console.warn('[videos] Gemini normalized video analysis failed:', normalizedError instanceof Error ? normalizedError.message : normalizedError);
          } finally {
            try { fs.unlinkSync(normalizedPath); } catch { /* best effort cleanup */ }
          }
        }
      }
      if (!isQwenConfigured()) throw e;
      console.warn('[videos] Gemini video analysis failed, falling back to Qwen frames:', e instanceof Error ? e.message : e);
      return withTimeout(runQwen(), videoAnalysisHardTimeoutMs(opts.analysisMode), 'video_analysis_hard_timeout');
    }
  }

  function shouldRetryGeminiWithNormalizedVideo(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /0 Frames found|wrong video metadata|corrupted|INVALID_ARGUMENT/i.test(msg);
  }

  async function normalizeVideoForGemini(filePath: string): Promise<string> {
    if (!ffmpegBin || !fs.existsSync(filePath)) return '';
    const outPath = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.gemini.mp4`);
    const ok = await runFfmpeg([
      '-i', filePath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', 'scale=trunc(min(720,iw)/2)*2:-2',
      '-r', '24',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-y', outPath,
    ]);
    return ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 0 ? outPath : '';
  }

  return { isQwenConfigured, isGeminiConfigured, shouldUseQwenFirst, isRetryableAnalysisFailure, permitsCrossProviderHookMotionInspection, readExactQwenScopeContinuity, analyzeDownloadedVideoWithFallback };
}
