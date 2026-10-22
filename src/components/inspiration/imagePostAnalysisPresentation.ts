import type { TrendVideo } from '../../lib/inspirationTypes';

type QueuePresentation = { state: 'queued' | 'processing' | 'unknown'; label: string; detail: string; canReanalyze: false };

/** A queued or uncertain paid attempt must not be presented as retryable. */
export function imagePostAnalysisQueuePresentation(video: TrendVideo): QueuePresentation | null {
  if (video.contentFormat !== 'image') return null;
  const queueState = video.aiAnalysis?.imageAnalysisQueueState || video.aiAnalysis?.imageAnalysisStatus;
  if (queueState === 'queued') return {
    state: 'queued', label: '图文分析已排队', detail: '图文证据已排队，完成前请勿重复提交。', canReanalyze: false,
  };
  if (queueState === 'processing') return {
    state: 'processing', label: '图文分析中', detail: '图文证据正在分析，完成前请勿重复提交。', canReanalyze: false,
  };
  if (queueState === 'unknown') return {
    state: 'unknown', label: '图文结果待核对', detail: '供应商调用结果不明，请先核对任务与费用，暂勿重新分析。', canReanalyze: false,
  };
  return null;
}
