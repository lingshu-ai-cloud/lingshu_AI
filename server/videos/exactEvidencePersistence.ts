import { reinspectSplitShotDescriptions } from '../routes/videoSplitShotDescriptions.js';
import { splitExactGeminiShotsAtSceneCuts } from '../routes/videoAnalysisTimelineProjection.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { detectVideoSceneCuts, extractOpeningHookFrames } from '../routes/videoFrameExtraction.js';
import { store } from '../storage/index.js';
import { objectStorageEnabled } from '../storage/objectStorage.js';
import { inspectVideoOpeningFrameWithQwen } from '../agents/qwen.js';
import { analyzeVideo } from '../agents/gemini.js';
import { inspectOpeningHookMotionWithGemini } from '../agents/geminiHookMotion.js';
import type { VideoAiAnalysis } from '../types/index.js';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { parseAnalysisTimeRange } from '../lib/videoAnalysisCodec.js';
import { applyOpeningHookMotionEvidence, firstSubstantiveOpeningShot } from '../routes/hookMotionEvidence.js';
import { COL, execFileAsync, MEDIA_DIR, ANALYSIS_DIR, ffmpegBin } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createExactEvidencePersistence(deps: Pick<VideoApplicationPorts, 'isQwenConfigured' | 'uploadCrawlerCosObject'>) {
  const isQwenConfigured: VideoApplicationPorts['isQwenConfigured'] = (...args) => deps.isQwenConfigured(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);

  async function persistExactShotEvidence(recordId: string, filePath: string, analysis: VideoAiAnalysis): Promise<VideoAiAnalysis> {
    if (!ffmpegBin || !Array.isArray(analysis.scriptDetails15s)) return analysis;
    const record = await store.getById<Record<string, unknown>>(COL, recordId);
    if (!record) return analysis;
    const details = [...analysis.scriptDetails15s];
    let openingFrameInspection: ReturnType<typeof inspectVideoOpeningFrameWithQwen> | null = null;
    for (let index = 0; index < details.length; index += 1) {
      const detail = details[index]!;
      const range = parseAnalysisTimeRange(String(detail.time || detail.timestamp || ''));
      if (!range || range.end - range.start < 0.2) continue;
      const prefix = path.join(ANALYSIS_DIR, `shot-${recordId}-${index}-${randomUUID()}`);
      const clipPath = `${prefix}.mp4`;
      const framePath = `${prefix}.jpg`;
      const firstFrameSeconds = Math.max(0, range.start + Math.min(0.04, (range.end - range.start) / 4));
      try {
        fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
        await execFileAsync(ffmpegBin, [
          '-hide_banner', '-loglevel', 'error', '-ss', String(range.start), '-i', filePath,
          '-t', String(range.end - range.start), '-map', '0:v:0', '-map', '0:a?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'aac', '-movflags', '+faststart', '-y', clipPath,
        ], { timeout: 90_000 });
        await execFileAsync(ffmpegBin, [
          '-hide_banner', '-loglevel', 'error', '-ss', String(firstFrameSeconds), '-i', filePath,
          '-frames:v', '1', '-q:v', '3', '-y', framePath,
        ], { timeout: 30_000 });
        if (index === 0 && isQwenConfigured()) {
          openingFrameInspection = inspectVideoOpeningFrameWithQwen({
            base64: fs.readFileSync(framePath).toString('base64'), mimeType: 'image/jpeg',
          }).catch(error => {
            console.warn('[videos] independent opening-frame check unavailable:', error instanceof Error ? error.message : error);
            return { scene: 'unknown' as const, hasPerson: null, hasProduct: null, confidence: 0 };
          });
        }
        let clipKey = '';
        let frameKey = '';
        if (objectStorageEnabled()) {
          clipKey = await uploadCrawlerCosObject(recordId, `shot-${index + 1}-clip`, fs.readFileSync(clipPath), 'video/mp4');
          frameKey = await uploadCrawlerCosObject(recordId, `shot-${index + 1}-first-frame`, fs.readFileSync(framePath), 'image/jpeg');
        } else {
          const destination = path.join(tenantAssetDir(MEDIA_DIR, String(record.tenantId || '')), 'trend-shots', recordId);
          fs.mkdirSync(destination, { recursive: true });
          fs.copyFileSync(clipPath, path.join(destination, `shot-${index + 1}.mp4`));
          fs.copyFileSync(framePath, path.join(destination, `shot-${index + 1}.jpg`));
        }
        details[index] = {
          ...detail,
          materialEvidence: {
            sourceVideoRef: `/api/overseas/videos/${recordId}/media`,
            clipRef: `/api/overseas/videos/${recordId}/shot/${index + 1}/clip`,
            firstFrameRef: `/api/overseas/videos/${recordId}/shot/${index + 1}/first-frame`,
            firstFrameSeconds,
            extractionStatus: 'ready',
            clipObjectKey: clipKey,
            firstFrameObjectKey: frameKey,
          },
        } as typeof detail;
      } catch (error) {
        console.warn(`[videos] shot evidence ${recordId}/${index + 1} unavailable:`, error instanceof Error ? error.message : error);
        details[index] = { ...detail, materialEvidence: {
            sourceVideoRef: `/api/overseas/videos/${recordId}/media`, clipRef: null, firstFrameRef: null,
            firstFrameSeconds, extractionStatus: 'unavailable',
          } } as typeof detail;
      } finally {
        for (const file of [clipPath, framePath]) { try { fs.unlinkSync(file); } catch { /* best effort */ } }
      }
    }
    const detectedSceneCuts = (analysis as VideoAiAnalysis & { detectedSceneCuts?: number[] }).detectedSceneCuts
      ?? await detectVideoSceneCuts(filePath);
    const openingFrameObservation = openingFrameInspection ? await openingFrameInspection : null;
    return { ...analysis, scriptDetails15s: details, detectedSceneCuts, openingFrameObservation } as VideoAiAnalysis;
  }

  async function enrichExactGeminiEvidence(filePath: string, analysis: VideoAiAnalysis): Promise<VideoAiAnalysis> {
    const detectedSceneCuts = await detectVideoSceneCuts(filePath);
    let enriched = await reinspectSplitShotDescriptions(filePath, splitExactGeminiShotsAtSceneCuts(analysis, detectedSceneCuts), video => analyzeVideo({ videoBase64: video.toString('base64'), mimeType: 'video/mp4', analysisMode: 'exact' }));
    let hookReviewReasons: string[] = [];
    const hookIndex = firstSubstantiveOpeningShot(enriched);
    if (hookIndex >= 0) {
      try {
        const hookFrames = await extractOpeningHookFrames(filePath);
        const applied = applyOpeningHookMotionEvidence(enriched, await inspectOpeningHookMotionWithGemini({ frames: hookFrames }));
        enriched = applied.analysis;
        hookReviewReasons = applied.reviewReasons;
      } catch (error) {
        console.warn('[videos] opening hook motion inspection unavailable:', error instanceof Error ? error.message : error);
        hookReviewReasons = ['opening_hook_motion_inspection_failed'];
      }
    } else hookReviewReasons = ['opening_hook_no_substantive_shot'];
    return { ...enriched, detectedSceneCuts, hookReviewReasons } as VideoAiAnalysis;
  }

  return { persistExactShotEvidence, enrichExactGeminiEvidence };
}
