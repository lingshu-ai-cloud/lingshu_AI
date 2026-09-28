import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Clock, Eye, Images, Loader2, Play, Sparkles, Star } from 'lucide-react';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import type { TrendVideo } from '../lib/inspirationTypes';
import { AuthenticatedVideo, ThumbnailImage, VideoThumbnail, candidateDimensionLabels, discoveryOriginTitle, discoverySupplyLabel, getPlatformMeta, inspirationScoresForVideo } from './InspirationDashboard';

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
}

export function VideoCard({ video, index, isSelected, onSelect, onCreate, onWatch, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating }: VideoCardProps) {
  const meta = getPlatformMeta(video.platform);
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const inspirationScores = inspirationScoresForVideo(video);
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

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.25 }}
      className={`group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:border-border-bright hover:shadow-md ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}>
      <div role="button" tabIndex={0} onClick={onWatch}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWatch();
          }
        }}
        className="relative overflow-hidden w-full aspect-[9/16] text-left block"
        style={{ background: 'var(--color-surface-2)' }}>
        <VideoThumbnail platform={video.platform} title={video.title} />
        {video.thumbnail && (
          <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 w-full h-full object-cover" />
        )}
        {video.videoUrl ? (
          <AuthenticatedVideo
            apiUrl={video.videoUrl}
            poster={/^https?:\/\//i.test(video.thumbnail) ? video.thumbnail : undefined}
            hoverPlay
            className={`absolute inset-0 w-full h-full object-cover transition-opacity ${mediaReady ? 'opacity-100' : 'opacity-0'}`}
            onReady={() => setMediaReady(true)}
            onError={() => setMediaReady(false)}
          />
        ) : null}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-900 shadow-sm" aria-hidden="true">
            {isImagePost ? <Images size={16} /> : <Play size={16} fill="currentColor" />}
          </span>
        </div>
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white bg-black/50 backdrop-blur-sm">
          {isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}
        </div>
        <div className="absolute bottom-2 right-2 max-w-[60%] truncate px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-black/55 backdrop-blur-sm">
          {crawlRule}
        </div>
        <div className="absolute top-2 left-2">
          <span className="platform-badge inline-flex items-center gap-1 text-[10px]" style={{ background: 'rgba(255,255,255,.94)', color: '#0f172a' }}><SocialPlatformIcon platform={video.platform} size={13} />{meta.label}</span>
          {video.id.startsWith('material-') && (
            <span className="mt-1 block rounded-md bg-green-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow-sm">收藏 · 片段已分析</span>
          )}
        </div>
        {!isImagePost && onFavoriteMaterial && <button
          type="button"
          onClick={event => { event.stopPropagation(); onFavoriteMaterial?.(); }}
          disabled={favoritingMaterial}
          aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
          title={isFavoriteMaterial ? '取消收藏' : '收藏到我的素材'}
          className={`absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm transition ${isFavoriteMaterial ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-white/70 bg-white/95 text-text-secondary hover:text-amber-500'} disabled:cursor-wait disabled:opacity-60`}
        >
          {favoritingMaterial ? <Loader2 size={15} className="animate-spin" /> : <Star size={16} fill={isFavoriteMaterial ? 'currentColor' : 'none'} />}
        </button>}
        {crawledLabel && (
          <div className={`absolute max-w-[48%] truncate rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white backdrop-blur-sm ${video.canManage ? 'right-2 top-12' : video.sourceUrl && !isImagePost ? 'right-12 top-2' : 'right-2 top-2'}`}
            title={`爬取入库时间：${crawledDate!.toLocaleString()}`}>
            {crawledLabel}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="mb-2 min-h-9 text-sm font-bold leading-snug text-text-primary line-clamp-2">{video.title}</p>
        {!video.id.startsWith('material-') && <p className="mb-2 truncate text-xs text-text-muted">账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'}</p>}
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-mono font-bold ${trendColor}`}>{trendLabel}</span>
          <span className="flex items-center gap-1 text-[10px] text-text-muted">{isImagePost ? <Images size={9} /> : <Clock size={9} />}{isImagePost ? `${video.aiAnalysis?.imageCount || video.aiAnalysis?.imageUrls?.length || 1} 张` : `${video.views} views`}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {video.tags.slice(0, 2).map(tag => <span key={tag} className="tag text-[10px]">#{tag}</span>)}
        </div>
        {!video.id.startsWith('material-') && <div className="mt-2 flex flex-wrap gap-1 text-[9px] font-bold" title={`来源优先 ${inspirationScores.sourcePriority}；内容机会 ${inspirationScores.contentOpportunityScore}`}><span className="rounded-md bg-violet-50 px-2 py-1 text-violet-900" title={discoveryOriginTitle(video)}>{discoverySupplyLabel(video)}</span><span className="rounded-md bg-cyan-50 px-2 py-1 text-cyan-900">{candidateDimensions.relevance}</span><span className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">{candidateDimensions.momentum}</span><span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">{candidateDimensions.transferability}</span></div>}
        <div className="mt-auto border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onSelect}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-xs font-bold text-text-secondary transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
              <Eye size={12} />查看详情
            </button>
            <button type="button" onClick={onCreate} disabled={creating}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-xs font-bold text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
              <Sparkles size={12} />{createLabel || '用于创作'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Video List Item ───────────────────────────────────────────────────────────
export function VideoListItem({ video, isSelected, onSelect, onCreate, onWatch, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating }: {
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
}) {
  const meta = getPlatformMeta(video.platform);
  const trendColor = video.trend === 'hot' ? 'text-accent' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const isImagePost = video.contentFormat === 'image';
  const inspirationScores = inspirationScoresForVideo(video);
  const candidateDimensions = candidateDimensionLabels(video);
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-all group sm:flex-nowrap ${isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'}`}>
      <button type="button" onClick={e => { e.stopPropagation(); onWatch(); }}
        className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border bg-surface-2 relative group/thumb">
        <VideoThumbnail platform={video.platform} title={video.title} />
        {video.thumbnail && <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 w-full h-full object-cover" />}
        <span className="absolute inset-0 bg-black/35 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
          {isImagePost ? <Images size={13} /> : <Play size={13} fill="currentColor" />}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge inline-flex items-center gap-1 text-[9px]" style={{ background: '#fff', color: '#0f172a' }}><SocialPlatformIcon platform={video.platform} size={12} />{meta.label}</span>
          {video.id.startsWith('material-') && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700">收藏 · 片段已分析</span>}
          <span className={`text-[10px] font-semibold ${trendColor}`}>{trendLabel}</span>
        </div>
        <p className="text-sm text-text-primary font-medium truncate">{video.title}</p>
        {!video.id.startsWith('material-') && <p className="truncate text-xs text-text-muted">账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'}</p>}
      </div>
      <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
        {video.tags.slice(0, 2).map(tag => <span key={tag} className="tag text-[10px]">#{tag}</span>)}
      </div>
      <span className="hidden xl:inline-flex flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-semibold bg-surface-2 border border-border text-text-muted">
        {crawlRule}
      </span>
      {!video.id.startsWith('material-') && <span className="hidden 2xl:inline-flex shrink-0 gap-1 text-[9px] font-bold" title={`来源优先 ${inspirationScores.sourcePriority}；内容机会 ${inspirationScores.contentOpportunityScore}`}><span className="rounded bg-cyan-50 px-1.5 py-1 text-cyan-900">{candidateDimensions.relevance}</span><span className="rounded bg-amber-50 px-1.5 py-1 text-amber-900">{candidateDimensions.momentum}</span><span className="rounded bg-emerald-50 px-1.5 py-1 text-emerald-800">{candidateDimensions.transferability}</span></span>}
      <div className="flex-shrink-0 text-right min-w-[52px]">
        <p className="text-xs font-mono text-text-secondary">{isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}</p>
        <p className="text-[10px] text-text-muted">{video.views}</p>
      </div>
      <div className="ml-auto flex w-full items-center justify-end gap-1.5 sm:ml-0 sm:w-auto">
        <button type="button" onClick={onCreate} disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white transition hover:brightness-95">
          <Sparkles size={12} />{createLabel || '用此灵感创作'}
        </button>
        <button type="button" onClick={onSelect}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-accent hover:bg-surface hover:text-accent disabled:opacity-60">
          <Eye size={13} />查看详情
        </button>
      </div>
      {!isImagePost && onFavoriteMaterial && (
        <button onClick={e => { e.stopPropagation(); onFavoriteMaterial?.(); }} disabled={favoritingMaterial}
          aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
          title={isFavoriteMaterial ? '取消收藏' : '收藏到我的素材'}
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition ${isFavoriteMaterial ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-border text-text-muted hover:border-amber-300 hover:text-amber-500'} disabled:cursor-wait disabled:opacity-60`}>
          {favoritingMaterial ? <Loader2 size={13} className="animate-spin" /> : <Star size={15} fill={isFavoriteMaterial ? 'currentColor' : 'none'} />}
        </button>
      )}
    </div>
  );
}
