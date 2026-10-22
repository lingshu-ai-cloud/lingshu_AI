import { Pagination } from 'antd';
import { Pencil, Trash2 } from 'lucide-react';
import type { ContentFormat, TrendVideo } from '../../lib/inspirationTypes';
import { resultEmptyState } from '../../lib/inspirationDataQuality';
import { LsLoadingState, LsMasonryGallery } from '../ui/LsExperiencePrimitives';
import InspirationEmptyState from '../InspirationEmptyState';
import { VideoCard, VideoListItem } from '../InspirationVideoCards';
import { inspirationCreationAvailability } from './inspirationAnalysisProjection';

interface InspirationVideoResultsProps {
  videos: TrendVideo[];
  visibleVideoCount: number;
  loaded: boolean;
  loading: boolean;
  viewMode: 'grid' | 'list';
  search: string;
  platformFiltered: boolean;
  contentFormat: ContentFormat;
  localMaterialCount: number;
  launchingReferences: string[];
  replicationTasks: Record<string, string>;
  creationAccountId: string;
  favoritingMaterialIds: string[];
  favoritedVideoIds: string[];
  favoriteSourceUrls: ReadonlySet<string>;
  showPagination: boolean;
  page: number;
  totalPages: number;
  pageSize: number;
  onReset: () => void;
  onOpenLibrary: () => void;
  onSelect: (video: TrendVideo) => void;
  onCreate: (video: TrendVideo) => void;
  onWatch: (video: TrendVideo) => void;
  onFavorite: (video: TrendVideo) => void;
  onManage: (video: TrendVideo, action: 'edit' | 'delete') => void;
  onPageChange: (page: number) => void;
}

export default function InspirationVideoResults({
  videos, visibleVideoCount, loaded, loading, viewMode, search, platformFiltered,
  contentFormat, localMaterialCount, launchingReferences, replicationTasks,
  creationAccountId, favoritingMaterialIds, favoritedVideoIds, favoriteSourceUrls,
  showPagination, page, totalPages, pageSize, onReset, onOpenLibrary,
  onSelect, onCreate, onWatch, onFavorite, onManage, onPageChange,
}: InspirationVideoResultsProps) {
  const cardActions = (video: TrendVideo) => ({
    onSelect: () => onSelect(video),
    onCreate: () => onCreate(video),
    createLabel: launchingReferences.includes(video.id) ? '正在启动…' : replicationTasks[`${video.id}:${creationAccountId}`] ? '继续制作' : video.id.startsWith('material-') ? '开始创作' : '爆款裂变',
    creating: launchingReferences.includes(video.id),
    createDisabled: video.contentFormat === 'image' && !inspirationCreationAvailability(video).ready,
    createDisabledReason: inspirationCreationAvailability(video).reason,
    onWatch: () => onWatch(video),
    onFavoriteMaterial: () => onFavorite(video),
    favoritingMaterial: favoritingMaterialIds.includes(video.id),
    isFavoriteMaterial: favoritedVideoIds.includes(video.id) || favoriteSourceUrls.has(String(video.sourceUrl || '').trim()),
  });

  return (
    <>
      {!loaded && loading ? (
        <LsLoadingState loading mode="spin" label="正在读取真实视频库存" description="正在同步全部可展示灵感" className="min-h-[360px] rounded-lg border border-border bg-surface">
          <span />
        </LsLoadingState>
      ) : videos.length === 0 ? (
        <InspirationEmptyState state={resultEmptyState(visibleVideoCount, search, platformFiltered)} contentFormat={contentFormat} search={search} localMaterialCount={localMaterialCount} onReset={onReset} onOpenLibrary={onOpenLibrary} />
      ) : viewMode === 'grid' ? (
        <LsMasonryGallery layout="masonry" items={videos.map((video, index) => ({
          id: video.id,
          content: <div className="relative h-full">
            <VideoCard video={video} index={index} isSelected={false} {...cardActions(video)} />
            {video.canManage && <div className="absolute right-12 top-2 z-30 flex gap-1">
              <button type="button" title="编辑素材" aria-label="编辑素材" onClick={() => onManage(video, 'edit')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-text-secondary shadow transition hover:text-accent"><Pencil size={14} /></button>
              <button type="button" title="删除素材" aria-label="删除素材" onClick={() => onManage(video, 'delete')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-text-secondary shadow transition hover:text-red-600"><Trash2 size={14} /></button>
            </div>}
          </div>,
        }))} />
      ) : (
        <div className="card overflow-hidden divide-y divide-border">
          {videos.map(video => <VideoListItem key={video.id} video={video} isSelected={false} {...cardActions(video)} />)}
        </div>
      )}
      {loaded && showPagination && totalPages > 1 && (
        <nav className="flex justify-center py-4" aria-label="灵感发现分页">
          <Pagination current={page} total={totalPages * pageSize} pageSize={pageSize}
            showSizeChanger={false} disabled={loading} onChange={onPageChange}
            showTotal={() => `第 ${page} / ${totalPages} 页`} />
        </nav>
      )}
    </>
  );
}
