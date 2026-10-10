import { Button, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { Clock, Eye, Images, Loader2, Play, Sparkles, Star } from 'lucide-react';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import type { TrendVideo } from '../lib/inspirationTypes';
import { AuthenticatedVideo, ThumbnailImage, VideoThumbnail, candidateDimensionLabels, discoveryOriginTitle, discoverySupplyLabel, getPlatformMeta, inspirationScoresForVideo } from './InspirationDashboard';
import { LsMediaStateFrame } from './ui/LsExperiencePrimitives';

interface VideoCardProps {
  video: TrendVideo;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onWatch: () => void;
  onFavoriteMaterial?: () => void;
  favoritingMaterial?: boolean;
  isFavoriteMaterial?: boolean;
  createLabel?: string;
  creating?: boolean;
  createDisabled?: boolean;
  createDisabledReason?: string;
}

export function VideoCard({ video, index, isSelected, onSelect, onCreate, onWatch, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating, createDisabled, createDisabledReason }: VideoCardProps) {
  const meta = getPlatformMeta(video.platform);
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const inspirationScores = inspirationScoresForVideo(video);
  const serverScore = video.aiAnalysis?.discoveryScore;
  const candidateDimensions = candidateDimensionLabels(video);
  const isImagePost = video.contentFormat === 'image';
  const [mediaReady, setMediaReady] = useState(false);
  useEffect(() => setMediaReady(false), [video.id, video.thumbnail, video.videoUrl]);
  const imageAnalyzed = video.aiAnalysis?.imageEvidence?.status === 'analyzed' && Boolean(video.aiAnalysis.imageEvidence.observedFacts?.length);
  const imageFailed = video.aiAnalysis?.imageAnalysisStatus === 'failed' || video.status === 'failed';
  const trendLabel = isImagePost
    ? (imageAnalyzed ? '✓ 已完成拆解' : imageFailed ? '! 分析失败' : '… 待分析')
    : video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';
  const trendColor = isImagePost
    ? (imageAnalyzed ? 'text-green' : imageFailed ? 'text-red-500' : 'text-text-muted')
    : video.trend === 'hot' ? 'text-accent' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const crawledDate = video.crawledAt ? new Date(video.crawledAt) : null;
  const crawledLabel = crawledDate && !Number.isNaN(crawledDate.getTime())
    ? `${String(crawledDate.getMonth() + 1).padStart(2, '0')}-${String(crawledDate.getDate()).padStart(2, '0')} 入库`
    : '';
  const analysisProgress = video.aiAnalysis?.analysisProgress;
  const analysisStage = analysisProgress?.stage;
  const analysisPaused = ['paused', 'cancelled'].includes(String(analysisStage || '')) || video.aiAnalysis?.geminiStatus === 'paused';
  const analysisActive = ['queued', 'downloading', 'transcoding', 'analyzing', 'extracting_evidence'].includes(String(analysisStage || ''));
  const mediaState = !analysisPaused && (imageFailed || analysisStage === 'failed')
    ? 'error'
    : analysisActive || (video.status === 'pending' && !analysisPaused)
      ? 'processing'
      : 'ready';

  return (
    <article
      className={`group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] hover:border-border-bright ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}>
      <div role="button" tabIndex={0} onClick={onWatch}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWatch();
          }
        }}
        className="relative overflow-hidden w-full aspect-[9/16] text-left block"
        style={{ background: 'var(--color-surface-2)' }}>
        <LsMediaStateFrame state={mediaState} percent={analysisProgress?.percent} label={analysisProgress?.stageLabel} className="absolute inset-0">
          <VideoThumbnail platform={video.platform} title={video.title} />
          {video.thumbnail && (
            <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 w-full h-full object-cover" />
          )}
          {video.videoUrl ? (
            <AuthenticatedVideo
              apiUrl={video.videoUrl}
              poster={/^https?:\/\//i.test(video.thumbnail) ? video.thumbnail : undefined}
              loadOnMount
              previewFrame
              preload="auto"
              hoverPlay
              className={`absolute inset-0 w-full h-full object-cover ls-media-reveal ${mediaReady ? 'opacity-100' : 'opacity-0'}`}
              onReady={() => setMediaReady(true)}
              onError={() => setMediaReady(false)}
            />
          ) : null}
        </LsMediaStateFrame>
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-900 shadow-none" aria-hidden="true">
            {isImagePost ? <Images size={16} /> : <Play size={16} fill="currentColor" />}
          </span>
        </div>
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md ls-type-label-small tabular-nums text-white bg-black/50">
          {isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}
        </div>
        <div className="absolute bottom-2 right-2 max-w-[60%] truncate px-1.5 py-0.5 rounded-md ls-type-label-small text-white bg-black/55" title={crawlRule}>
          {crawlRule}
        </div>
        <div className="absolute top-2 left-2">
          <span className="platform-badge inline-flex items-center gap-1 ls-type-label-small" style={{ background: 'rgba(255,255,255,.94)', color: 'var(--color-text-primary)' }}><SocialPlatformIcon platform={video.platform} size={13} />{meta.label}</span>
          {video.id.startsWith('material-') && (
            <span className="mt-1 block rounded-md bg-green-600 px-1.5 py-0.5 ls-type-label-small text-white shadow-none">收藏 · 片段已分析</span>
          )}
        </div>
        {!isImagePost && onFavoriteMaterial && <button
          type="button"
          onClick={event => { event.stopPropagation(); onFavoriteMaterial?.(); }}
          disabled={favoritingMaterial}
          aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
          title={isFavoriteMaterial ? '取消收藏' : '收藏到我的素材'}
          className={`absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-none transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] ${isFavoriteMaterial ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-white/70 bg-white/95 text-text-secondary hover:text-amber-500'} disabled:cursor-wait disabled:opacity-60`}
        >
          {favoritingMaterial ? <Loader2 size={15} className="animate-spin" /> : <Star size={16} fill={isFavoriteMaterial ? 'currentColor' : 'none'} />}
        </button>}
        {crawledLabel && (
          <div className={`absolute max-w-[48%] truncate rounded-md bg-black/50 px-1.5 py-0.5 ls-type-label-small tabular-nums text-white ${video.canManage ? 'right-2 top-12' : video.sourceUrl && !isImagePost ? 'right-12 top-2' : 'right-2 top-2'}`}
            title={`爬取入库时间：${crawledDate!.toLocaleString()}`}>
            {crawledLabel}
          </div>
        )}
      </div>
      <div className="flex min-h-52 flex-1 flex-col p-3">
        <p className="mb-2 min-h-11 ls-type-title-small text-text-primary line-clamp-2" title={video.title}>{video.title}</p>
        {!video.id.startsWith('material-') && <p className="mb-2 truncate ls-type-body-small text-text-muted">账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'}</p>}
        <div className="flex items-center justify-between mb-2">
          <span className={`ls-type-label-medium ${trendColor}`}>{trendLabel}</span>
          <span className="flex items-center gap-1 ls-type-body-small tabular-nums text-text-muted">{isImagePost ? <Images size={12} /> : <Clock size={12} />}{isImagePost ? `${video.aiAnalysis?.imageCount || video.aiAnalysis?.imageUrls?.length || 1} 张` : `${video.views} 次播放`}</span>
        </div>
        {!video.id.startsWith('material-') && <div className="flex max-h-14 flex-wrap gap-1 overflow-hidden ls-type-label-medium" title={serverScore ? serverScore.reasons.join('；') : `来源优先 ${inspirationScores.sourcePriority}；内容机会 ${inspirationScores.contentOpportunityScore}`}>
          {serverScore && <span className={`rounded-md px-2 py-1 ${serverScore.decision === 'accepted' ? 'bg-emerald-100 text-emerald-900' : serverScore.decision === 'review' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>服务端 {serverScore.overall} 分 · {serverScore.decision === 'accepted' ? '入选' : serverScore.decision === 'review' ? '复核' : '淘汰'}</span>}
          {video.aiAnalysis?.discoveryBusinessModel && <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">{video.aiAnalysis.discoveryBusinessModel.toUpperCase()}</span>}
          <Tag title={discoveryOriginTitle(video)}>{discoverySupplyLabel(video)}</Tag><span className="rounded-md bg-cyan-50 px-2 py-1 text-cyan-900">{candidateDimensions.relevance}</span><span className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">{candidateDimensions.momentum}</span><span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">{candidateDimensions.transferability}</span></div>}
        <div className="mt-auto border-t border-border pt-3">
          <div className="ls-media-card-actions">
            <Button onClick={onSelect} icon={<Eye size={14} />}>查看详情</Button>
            <Button type="primary" onClick={onCreate} loading={creating} disabled={createDisabled} title={createDisabled ? createDisabledReason : undefined}>{createLabel || '用于创作'}</Button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Video List Item ───────────────────────────────────────────────────────────
export function VideoListItem({ video, isSelected, onSelect, onCreate, onWatch, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating, createDisabled, createDisabledReason }: {
  video: TrendVideo;
  isSelected: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onWatch: () => void;
  onFavoriteMaterial?: () => void;
  favoritingMaterial?: boolean;
  isFavoriteMaterial?: boolean;
  createLabel?: string;
  creating?: boolean;
  createDisabled?: boolean;
  createDisabledReason?: string;
}) {
  const meta = getPlatformMeta(video.platform);
  const trendColor = video.trend === 'hot' ? 'text-accent' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const isImagePost = video.contentFormat === 'image';
  const inspirationScores = inspirationScoresForVideo(video);
  const serverScore = video.aiAnalysis?.discoveryScore;
  const candidateDimensions = candidateDimensionLabels(video);
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group sm:flex-nowrap ${isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'}`}>
      <button type="button" onClick={e => { e.stopPropagation(); onWatch(); }}
        className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border bg-surface-2 relative group/thumb">
        <VideoThumbnail platform={video.platform} title={video.title} />
        {video.thumbnail && <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 w-full h-full object-cover" />}
        {video.videoUrl && <AuthenticatedVideo apiUrl={video.videoUrl} loadOnMount previewFrame preload="auto" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
        <span className="absolute inset-0 bg-black/35 opacity-0 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] flex items-center justify-center text-white">
          {isImagePost ? <Images size={13} /> : <Play size={13} fill="currentColor" />}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge inline-flex items-center gap-1 ls-type-label-small" style={{ background: '#fff', color: 'var(--color-text-primary)' }}><SocialPlatformIcon platform={video.platform} size={12} />{meta.label}</span>
          {video.id.startsWith('material-') && <span className="rounded bg-green-100 px-1.5 py-0.5 ls-type-label-medium text-green-700">收藏 · 片段已分析</span>}
          <span className={`ls-type-label-medium ${trendColor}`}>{trendLabel}</span>
        </div>
        <p className="ls-type-title-small text-text-primary line-clamp-2" title={video.title}>{video.title}</p>
        {!video.id.startsWith('material-') && <p className="truncate ls-type-body-small text-text-muted">账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'}</p>}
      </div>
      <span className="hidden xl:inline-flex flex-shrink-0 px-2 py-1 rounded-md ls-type-label-medium bg-surface-2 border border-border text-text-muted">
        {crawlRule}
      </span>
      {!video.id.startsWith('material-') && <span className="hidden 2xl:inline-flex shrink-0 gap-1 ls-type-label-medium" title={serverScore ? serverScore.reasons.join('；') : `来源优先 ${inspirationScores.sourcePriority}；内容机会 ${inspirationScores.contentOpportunityScore}`}>
        {serverScore && <span className={`rounded px-1.5 py-1 ${serverScore.decision === 'accepted' ? 'bg-emerald-100 text-emerald-900' : serverScore.decision === 'review' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>{serverScore.overall} 分</span>}
        <span className="rounded bg-cyan-50 px-1.5 py-1 text-cyan-900">{candidateDimensions.relevance}</span><span className="rounded bg-amber-50 px-1.5 py-1 text-amber-900">{candidateDimensions.momentum}</span><span className="rounded bg-emerald-50 px-1.5 py-1 text-emerald-800">{candidateDimensions.transferability}</span></span>}
      <div className="flex-shrink-0 text-right min-w-[52px]">
        <p className="ls-type-body-small tabular-nums text-text-secondary">{isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}</p>
        <p className="ls-type-body-small tabular-nums text-text-muted">{video.views}</p>
      </div>
      <div className="ml-auto flex w-full items-center justify-end gap-1.5 sm:ml-0 sm:w-auto">
        <Button type="primary" onClick={onCreate} loading={creating} disabled={createDisabled} title={createDisabled ? createDisabledReason : undefined}>{createLabel || '用此灵感创作'}</Button>
        <Button onClick={onSelect} icon={<Eye size={14} />}>查看详情</Button>
      </div>
      {!isImagePost && onFavoriteMaterial && (
        <button onClick={e => { e.stopPropagation(); onFavoriteMaterial?.(); }} disabled={favoritingMaterial}
          aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
          title={isFavoriteMaterial ? '取消收藏' : '收藏到我的素材'}
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] ${isFavoriteMaterial ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-border text-text-muted hover:border-amber-300 hover:text-amber-500'} disabled:cursor-wait disabled:opacity-60`}>
          {favoritingMaterial ? <Loader2 size={13} className="animate-spin" /> : <Star size={15} fill={isFavoriteMaterial ? 'currentColor' : 'none'} />}
        </button>
      )}
    </div>
  );
}
