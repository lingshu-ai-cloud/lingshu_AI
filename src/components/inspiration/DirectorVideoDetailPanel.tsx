import { observedVideoAnalysis, failureForVideo, imageAnalysisNeedsSubmission } from './inspirationEvidence';
import { useEffect, useState } from 'react';
import { Button, Drawer } from 'antd';
import { BarChart2, ChevronRight, Images, Loader2, Star, X } from 'lucide-react';
import InspirationVideoAnalysisTabs from './InspirationVideoAnalysisTabs';
import ImageEvidenceSummaryPanel from './ImageEvidenceSummaryPanel';
import VideoAnalysisProgressPanel, { analysisProgressIsActive } from './VideoAnalysisProgressPanel';
import ReferenceSpeechAlignmentPanel from './ReferenceSpeechAlignmentPanel';
import type { DirectorReviewHandoff } from './DirectorReviewWorkspace';
import { AuthenticatedVideo } from './InspirationMedia';
import { exactAnalysisQuality, getAnalysis, inspirationDetailStatusLabel, videoAnalysisFailed } from './inspirationAnalysisProjection';
import { imagePostAnalysisQueuePresentation } from './imagePostAnalysisPresentation';
import { PLATFORM_META } from './inspirationVideoProjection';
import { buildBenchmarkAnalysis } from '../../../shared/benchmarkAnalysis';
import { authHeader } from '../../lib/auth';
import { displayDuration } from '../../lib/inspirationDataQuality';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { SocialPlatformIcon } from '../SocialPlatformIcon';

export function DirectorVideoDetailPanel({
  video,
  onClose,
  onPreview,
  onCreate,
  onRetry,
  onReanalyzeImage,
  onExactAnalysis,
  onReanalyze,
  onCancelAnalysis,
  analyzing,
  notice,
  onFavorite,
  favoriting,
  isFavorite,
}: {
  video: TrendVideo;
  onClose: () => void;
  onPreview: () => void;
  onCreate: () => void;
  onRetry: () => void;
  onReanalyzeImage: () => void;
  onExactAnalysis: () => void;
  onReanalyze?: () => void;
  onCancelAnalysis: () => void;
  analyzing: boolean;
  notice?: string;
  onFavorite: () => void;
  favoriting?: boolean;
  isFavorite?: boolean;
}) {
  const observed = observedVideoAnalysis(video);
  const failure = failureForVideo(video);
  const needsSubmission = imageAnalysisNeedsSubmission(video);
  const canRetryFailure = failure.code === 'none' || failure.retryable;
  const analysis = observed ? getAnalysis(video) : null;
  const exactQuality = exactAnalysisQuality(video);
  const payload = video.aiAnalysis;
  const analysisFailed = videoAnalysisFailed(video);
  const imageEvidence = payload?.imageEvidence;
  const isImagePost = video.contentFormat === 'image';
  const imageQueue = imagePostAnalysisQueuePresentation(video);
  const imageAnalysisReady = !imageQueue && imageEvidence?.status === 'analyzed' && Boolean(imageEvidence.observedFacts?.length);
  const legacyImageAnalysis = isImagePost && imageAnalysisReady && !Array.isArray(imageEvidence?.productionLabels);
  const progressStage = payload?.analysisProgress?.stage;
  const hasServerProgress = Boolean(payload?.analysisProgress);
  const terminalAnalysisState = Boolean(payload?.analysisError)
    || ['completed', 'failed', 'paused', 'cancelled'].includes(String(progressStage || ''))
    || ['paused', 'cancelled', 'video_failed', 'failed', 'needs_review', 'analysis_retryable', 'analyzed'].includes(String(payload?.geminiStatus || ''));
  const activeServerAnalysis = analysisProgressIsActive(payload?.analysisProgress);
  const pending = analyzing
    || (hasServerProgress
      ? activeServerAnalysis
      : (payload?.requestedAnalysisMode === 'exact' && !terminalAnalysisState)
        || (video.status === 'pending' && !terminalAnalysisState && !needsSubmission));
  const reviewHandoffRequestKey = [video.recordId || '', payload?.analyzedAt || '', payload?.geminiStatus || '', payload?.requestedAnalysisMode || '', payload?.analysisProgress?.runId || '', payload?.analysisProgress?.stage || ''].join(':');
  const [reviewHandoffState, setReviewHandoffState] = useState<{ key: string; value: DirectorReviewHandoff } | null>(null);
  const reviewHandoff = reviewHandoffState?.key === reviewHandoffRequestKey ? reviewHandoffState.value : null;
  useEffect(() => {
    const recordId = video.recordId;
    if (activeServerAnalysis || !recordId || !['analyzed', 'needs_review'].includes(String(payload?.geminiStatus || ''))) { setReviewHandoffState(null); return; }
    let active = true;
    void fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/review-handoff`, { headers: authHeader() })
      .then(async response => response.ok ? await response.json() as DirectorReviewHandoff : null)
      .then(result => { if (active) setReviewHandoffState(result ? { key: reviewHandoffRequestKey, value: result } : null); })
      .catch(() => { if (active) setReviewHandoffState(null); });
    return () => { active = false; };
  }, [video.recordId, payload?.geminiStatus, activeServerAnalysis, reviewHandoffRequestKey]);
  const benchmark = payload?.benchmarkAnalysis || buildBenchmarkAnalysis({ analysis: payload, videoId: video.recordId || video.id, duration: video.duration });
  const handoffReady = !pending && reviewHandoff?.status === 'production_ready' && reviewHandoff.productionExecutionAllowed === true;
  const draftReady = !pending && reviewHandoff?.directorHandoffReady === true;
  // A missing review-handoff response must not hide an otherwise valid
  // replication action. The task-creation endpoint owns handoff recovery; the
  // UI only needs verified exact evidence and a non-running analysis.
  const detailCreationReady = video.id.startsWith('material-') ? true : isImagePost ? imageAnalysisReady : exactQuality.ready && !pending && !analysisFailed;
  const isReadOnlySnapshot = payload?.analysisSource === 'weekly-plan-snapshot' || video.id.startsWith('weekly-reference-');
  const canRunExactAnalysis = !isReadOnlySnapshot && canRetryFailure && Boolean(video.recordId || video.id.startsWith('material-'));
  const canRunDetailAnalysis = isImagePost ? Boolean(video.recordId) && !imageQueue : canRunExactAnalysis;
  const needsDirectorReview = !isImagePost && (payload?.geminiStatus === 'needs_review' || payload?.analysisQuality === 'video_review_required');
  const detailedAnalysisReason = isReadOnlySnapshot
    ? '原爆款已删除，仅可查看周计划保存的历史分析快照。'
    : exactQuality.ready
      ? '精确分析已通过实际画面时间线校验'
      : exactQuality.reason;
  const showAnalysisProgress = !isImagePost && progressStage !== 'completed'
    && (pending || ['failed', 'paused', 'cancelled'].includes(String(progressStage || '')));
  const analysisInterrupted = ['paused', 'cancelled'].includes(String(progressStage || '')) || payload?.geminiStatus === 'paused';
  const statusLabel = inspirationDetailStatusLabel(video, { pending, imageAnalysisReady,
    exactAnalysisReady: exactQuality.ready, hasStrategyAnalysis: Boolean(analysis) });

  return (
    <Drawer open title={video.title} size={800} onClose={onClose}
      extra={<Button onClick={onFavorite} loading={favoriting} aria-label={isFavorite ? `取消收藏 ${video.title}` : `收藏 ${video.title}`} icon={<Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />}>{isFavorite ? '已收藏' : '收藏'}</Button>}
      footer={<div className="flex flex-wrap items-center gap-2">
        {!isImagePost && canRunExactAnalysis && (pending
          ? <Button onClick={onCancelAnalysis} icon={<X size={13} />}>停止分析</Button>
          : <Button onClick={analysisInterrupted ? (onReanalyze || onExactAnalysis) : exactQuality.ready ? (onReanalyze || onExactAnalysis) : onExactAnalysis} icon={<BarChart2 size={13} />}>{analysisInterrupted ? '继续详细分析' : exactQuality.ready ? '重新详细分析' : '详细分析'}</Button>)}
        {!isImagePost && canRetryFailure && !analysisInterrupted && (payload?.analysisError || video.status === 'failed') && <Button onClick={onRetry} loading={analyzing}>重新分析</Button>}
        {isImagePost && (!imageAnalysisReady || legacyImageAnalysis) && !imageQueue && <Button onClick={onReanalyzeImage} loading={analyzing} icon={<Images size={13} />}>{needsSubmission ? '提交图文分析' : legacyImageAnalysis ? '补充参考图分析' : '重新分析图文'}</Button>}
        <Button onClick={onPreview}>预览原内容</Button>
        <Button type="primary" onClick={detailCreationReady ? onCreate : isImagePost ? onReanalyzeImage : onExactAnalysis} disabled={!detailCreationReady && !canRunDetailAnalysis} className="ml-auto">{video.id.startsWith('material-') ? '开始创作' : '爆款裂变'}</Button>
        {!detailCreationReady && <p className="w-full text-xs text-text-secondary">{failure.code !== 'none' && !canRetryFailure ? `${failure.message} ${failure.action}` : isImagePost ? imageQueue?.detail || '点击“爆款裂变”会先完成图文证据分析。' : analysisFailed ? '精确分析失败，已有分镜仅供参考；请重试分析，通过后再进入制作。' : pending ? '详细分析完成后会开放复刻，当前任务不会重复提交。' : needsDirectorReview ? '分镜证据仍待复核，尚未通过制作条件检查。' : canRunExactAnalysis ? '点击“爆款裂变”会先完成详细分析，再进入制作。' : detailedAnalysisReason}</p>}
      </div>}
      styles={{ body: { padding: 0 } }}>
      <div className="border-b border-border px-5 py-3">
        {failure.code !== 'none' && <div role="alert" className="mb-3 border-l-2 border-warning bg-surface-2 p-3 text-xs"><p className="font-semibold">{failure.message}</p><p className="mt-1">{failure.action}</p></div>}
        {needsSubmission && <p role="status" className="mb-3 border-l-2 border-warning bg-surface-2 p-3 text-xs">图片已保存，但没有分析任务回执。请点击“提交图文分析”；结果不明的旧调用需先核对。</p>}
        <p className="text-sm font-medium text-text-primary">编导 Agent · {statusLabel}</p>
        <p className="mt-1 flex items-center gap-2 text-xs text-text-secondary"><SocialPlatformIcon platform={video.platform} size={14}/>{PLATFORM_META[video.platform]?.label || video.platform} · {displayDuration(video.duration)} · {payload?.analysisSource || '待确认分析来源'}</p>
        {video.tags.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="内容标签">
          <span className="mr-1 text-xs font-semibold text-text-secondary">内容标签</span>
          {video.tags.map(tag => <span key={tag} className="rounded-md border border-border bg-accent-glow px-2 py-1 text-xs font-semibold text-accent">#{tag}</span>)}
        </div>}
      </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {legacyImageAnalysis && <p role="status" className="mb-4 border-l-2 border-warning bg-surface-2 px-3 py-2 text-xs text-text-secondary">旧版拆解缺少逐图产品判断；补充分析后才能用于图文复刻。</p>}
          {isImagePost && notice && <p role="status" className="mb-4 border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">{notice}</p>}
          {isImagePost && imageAnalysisReady && imageEvidence ? (
            <ImageEvidenceSummaryPanel evidence={imageEvidence} />
          ) : isImagePost ? (
            <section className="mt-4 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              {pending && imageQueue?.state !== 'unknown' ? <Loader2 size={24} className="mx-auto animate-spin text-accent" /> : <BarChart2 size={24} className="mx-auto text-text-muted" />}
              <p className="mt-3 text-sm font-semibold text-text-primary">{statusLabel}</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-text-muted">{needsSubmission ? '图片已入库，尚未形成可恢复的分析任务。' : imageQueue?.detail || (pending ? '可以先关闭此页；完成时间与失败状态以后台返回为准。' : '完成后会展示图文证据与轮播节奏。')}</p>
            </section>
          ) : !observed ? (
            <section className="mt-4 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center"><p className="text-sm font-semibold">尚无可核验的视频分析结果</p><p className="mt-2 text-xs text-text-secondary">标题、标签和模板建议不能代替真实画面、镜头或卖点证据。</p>{showAnalysisProgress && <VideoAnalysisProgressPanel progress={payload?.analysisProgress} pending={pending} onRetry={onReanalyze || onExactAnalysis} retryDisabled={analyzing || !canRetryFailure} />}</section>
          ) : (
            <InspirationVideoAnalysisTabs
              benchmark={benchmark}
              gemini={payload?.gemini}
              duration={video.duration}
              pending={pending}
              detailedReady={exactQuality.ready}
              detailedReason={detailedAnalysisReason}
              onAnalyze={onExactAnalysis}
              onReanalyze={onReanalyze || onExactAnalysis}
              analysisActionAvailable={canRunExactAnalysis}
              renderClip={url => <AuthenticatedVideo apiUrl={url} controls className="max-h-64 w-full rounded-lg bg-black" />}
              adaptTip={analysis?.adaptTip}
              baseRequirements={analysis?.baseRequirements}
              storyboardStatus={<>
                {showAnalysisProgress && <VideoAnalysisProgressPanel
                  progress={payload?.analysisProgress}
                  pending={pending}
                  onRetry={onReanalyze || onExactAnalysis}
                  retryDisabled={analyzing || !canRetryFailure}
                />}
                {notice && <p role="status" className="border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">{notice}</p>}
                <section aria-label="编导到内容 Agent 交接状态" className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="rounded bg-surface-2 px-2 py-1 text-green">原片入库</span><ChevronRight size={13} className="text-text-muted" /><span className={`rounded px-2 py-1 ${pending || !draftReady ? 'bg-amber-dim text-amber' : 'bg-surface-2 text-green'}`}>{pending ? '编导分析中' : draftReady ? '可交接内容起稿' : '编导证据不足'}</span><ChevronRight size={13} className="text-text-muted" /><span className={`rounded px-2 py-1 ${draftReady ? 'bg-surface-2 text-green' : 'bg-surface-2 text-text-muted'}`}>{handoffReady ? '可制作成片' : draftReady ? '可生成口播草稿' : '内容起稿未开放'}</span></div>
                  {!handoffReady && !pending && <p className="mt-2 text-[11px] leading-5 text-amber">系统将使用带估计时间码的原片口播，并继续检查镜头切片、钩子动作和企业“销售”人物资产。如需继续，编导 Agent 会按清单补证，无需人工逐句校时或逐镜勾选。</p>}
                </section>
              </>}
              speechAlignment={<ReferenceSpeechAlignmentPanel details={payload?.gemini?.scriptDetails15s} transcript={payload?.gemini?.audioTranscript} />}
            />
          )}
        </div>

    </Drawer>
  );
}
