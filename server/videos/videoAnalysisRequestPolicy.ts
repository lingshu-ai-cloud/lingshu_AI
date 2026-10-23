import type { Platform, VideoAiAnalysis } from '../types/index.js';
import { resolvePublicVideoSource, type ValidatedPublicVideoSource } from '../lib/publicVideoSourceSecurity.js';
import { analysisTimelineQualityError, canPromoteExistingAnalysisToExact, exactVideoClassificationQualityError, hasCompletedExactVideoEvidence } from '../lib/videoAnalysisCodec.js';
import { benchmarkAnalysisForRecord } from '../lib/benchmarkAnalysis.js';
import { productionReferenceAdmission } from '../../shared/productionReferenceAdmission.js';
import { parseJsonRecord } from '../routes/videoCrawlerNormalization.js';

import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoAnalysisRequestPolicy(deps: Pick<VideoApplicationPorts, 'canUseApifyVideoFallback' | 'apifyTenantIdFromRecord'>) {
  const canUseApifyVideoFallback: VideoApplicationPorts['canUseApifyVideoFallback'] = (...args) => deps.canUseApifyVideoFallback(...args);
  const apifyTenantIdFromRecord: VideoApplicationPorts['apifyTenantIdFromRecord'] = (...args) => deps.apifyTenantIdFromRecord(...args);

  function activeAnalysisRequest(analysis: Record<string, unknown>, mode?: 'strategy' | 'exact'): boolean {
    if (!analysis.requestedAnalysisMode) return false;
    if (mode && String(analysis.requestedAnalysisMode) !== mode) return false;
    const activeStatuses = ['queued', 'waiting_for_video', 'analyzing', 'downloading', 'download_retrying', 'ops_queued', 'ops_processing'];
    return [analysis.geminiStatus, analysis.downloadStatus, analysis.videoFetchStatus]
      .some(status => activeStatuses.includes(String(status || '')))
      || ['queued', 'running'].includes(String(analysis.analysisQueueState || ''));
  }

  function isWeeklyOriginalAccountCollectionRecord(record?:Record<string,unknown>|null):boolean{
    const analysis=record?.aiAnalysis;
    let parsed:Record<string,unknown>|null=null;
    if(typeof analysis==='string'){
      try{const value:unknown=JSON.parse(analysis);parsed=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}catch{return false;}
    }else if(analysis&&typeof analysis==='object'&&!Array.isArray(analysis))parsed=analysis as Record<string,unknown>;
    return Array.isArray(parsed?.discoveryOrigins)&&parsed.discoveryOrigins.some(origin=>origin&&typeof origin==='object'&&'weeklyOriginalAccountCollection' in origin);
  }

  function shouldResumeReferenceAnalysis(analysis: Record<string, unknown>, duration = 0): boolean {
    if (hasCompletedExactVideoEvidence(analysis)) {
      const gemini = analysis.gemini && typeof analysis.gemini === 'object'
        ? analysis.gemini as VideoAiAnalysis
        : parseJsonRecord<VideoAiAnalysis>(analysis.gemini, {} as VideoAiAnalysis);
      if (exactVideoClassificationQualityError(gemini)) return true;
      if (duration <= 0) return false;
      return Boolean(analysisTimelineQualityError(gemini, duration, 'exact'));
    }
    const status = String(analysis.geminiStatus || '');
    const activelyRunning = analysis.requestedAnalysisMode === 'exact'
      && ['queued', 'waiting_for_video', 'analyzing'].includes(status)
      && !analysis.analysisError;
    return !activelyRunning;
  }

  function canRepairStoredExactClassification(
    record: Record<string, unknown>,
    analysis: Record<string, unknown>,
  ): boolean {
    const gemini = analysis.gemini && typeof analysis.gemini === 'object'
      ? analysis.gemini as VideoAiAnalysis
      : parseJsonRecord<VideoAiAnalysis>(analysis.gemini, {} as VideoAiAnalysis);
    if (!['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''))
      || !canPromoteExistingAnalysisToExact(gemini, Number(record.duration || 0))) return false;
    const admission = productionReferenceAdmission(benchmarkAnalysisForRecord(record, analysis));
    return !admission.ready && admission.blockers.length > 0 && admission.blockers.every(blocker => (
      /镜头类型未确认|画面、用途或分类依据待复核/.test(blocker)
    ));
  }

  function shouldQueueVideoAnalysis(record: Record<string, unknown>): boolean {
    const sourceUrl = String(record.sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(sourceUrl)) return false;
    const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
    if (analysis.analysisPausedAt || analysis.geminiStatus === 'paused') return false;
    const status = String(analysis.downloadStatus || '');
    const videoFetchStatus = String(analysis.videoFetchStatus || '');
    const geminiStatus = String(analysis.geminiStatus || '');
    if (['metadata_only', 'analyzed'].includes(status) || ['unavailable', 'url_failed', 'ops_failed'].includes(videoFetchStatus) || geminiStatus === 'metadata_fallback') return false;
    if (['queued', 'downloading', 'analyzing'].includes(status)) return false;
    if (analysis.analysisQuality === 'video' && status === 'analyzed') return false;
    const queuedAt = Date.parse(String(analysis.analysisQueuedAt || analysis.videoAnalysisAttemptedAt || ''));
    if (Number.isFinite(queuedAt) && Date.now() - queuedAt < 5 * 60 * 1000) return false;
    return true;
  }

  function resolvedPublicVideoSource(
    record: Record<string, unknown> | null,
    input: { sourceUrl?: string; platform?: Platform },
  ): ValidatedPublicVideoSource | null {
    return resolvePublicVideoSource({
      recordSourceUrl: record?.sourceUrl,
      recordPlatform: record?.platform,
      requestedSourceUrl: input.sourceUrl,
      requestedPlatform: input.platform,
    });
  }

  function isTikTokUnusableWithoutVideoFallback(platform: Platform, message: string, record?: Record<string, unknown> | null): boolean {
    if (platform !== 'tiktok') return false;
    if (canUseApifyVideoFallback(apifyTenantIdFromRecord(record))) return false;
    return /0 Frames found|wrong video metadata|corrupted|INVALID_ARGUMENT|yt-dlp did not produce an analysis video file/i.test(message);
  }

  return { activeAnalysisRequest, isWeeklyOriginalAccountCollectionRecord, shouldResumeReferenceAnalysis, canRepairStoredExactClassification, shouldQueueVideoAnalysis, resolvedPublicVideoSource, isTikTokUnusableWithoutVideoFallback };
}
