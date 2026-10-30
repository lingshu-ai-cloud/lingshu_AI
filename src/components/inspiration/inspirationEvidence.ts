import { analysisProgressIsActive } from './VideoAnalysisProgressPanel';
import { videoPipelineFailure } from '../../../shared/videoPipelineFailure';
import type { TrendVideo } from '../../lib/inspirationTypes';

export function observedVideoAnalysis(video: TrendVideo) {
  const analysis = video.aiAnalysis;
  if (!analysis?.gemini || analysis.analysisQuality === 'metadata' || analysis.analysisSource === 'metadata-fallback') return undefined;
  if (['video', 'video_review_required'].includes(analysis.analysisQuality || '')) return analysis.gemini;
  if (analysis.analysisError || analysis.videoLevelFailureStatus || ['video_failed', 'waiting_for_video', 'failed'].includes(analysis.geminiStatus || '')) return undefined;
  return analysis.gemini;
}

export function failureForVideo(video: TrendVideo) {
  if (analysisProgressIsActive(video.aiAnalysis?.analysisProgress)) return videoPipelineFailure('');
  return (video.aiAnalysis?.pipelineFailure?.code !== 'none' ? video.aiAnalysis?.pipelineFailure : undefined) || videoPipelineFailure(video.aiAnalysis?.analysisError
    || video.aiAnalysis?.videoLevelFailureStatus || video.aiAnalysis?.downloadError || (video.status === 'failed' ? 'analysis_failed' : ''));
}

export function imageAnalysisNeedsSubmission(video: TrendVideo): boolean {
  return video.contentFormat === 'image' && video.aiAnalysis?.imageAnalysisStatus === 'pending'
    && !video.aiAnalysis.imageAnalysisQueueState;
}
