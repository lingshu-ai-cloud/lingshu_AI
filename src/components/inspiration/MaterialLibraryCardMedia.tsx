import { useEffect, useState } from 'react';
import { Film, Loader2, Music2, Pencil, Play, Star, Trash2 } from 'lucide-react';
import { LsMediaStateFrame } from '../ui/LsExperiencePrimitives';
import { AuthenticatedImage, AuthenticatedVideo } from './InspirationMedia';
import { isFavoriteMaterial } from './inspirationMaterialLibrary';
import { materialHasAuthoritativeAspectRatio, materialIntrinsicAspectRatio } from '../material-library/ProductMaterialGroup';
import type { Material } from '../../lib/studioApi';

export function materialPreviewImageSources(material: Pick<Material, 'type' | 'poster' | 'url' | 'segments'>): string[] {
  const candidates = [material.poster, ...(material.segments || []).map(segment => segment.poster), material.type === 'image' ? material.url : ''];
  return Array.from(new Set(candidates.map(value => String(value || '').trim()).filter(Boolean)));
}

type MaterialCardMediaSource = 'image' | 'video';

function MaterialCardMedia({ material, onRefresh, onNaturalAspectRatio }: { material: Material; onRefresh?: () => Promise<unknown>; onNaturalAspectRatio?: (ratio: number, source: MaterialCardMediaSource) => void }) {
  const imageSources = materialPreviewImageSources(material);
  const sourceIdentity = imageSources.join('|');
  const [imageIndex, setImageIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setImageIndex(0);
    setState(imageSources.length || (material.type === 'video' && material.url) ? 'loading' : 'error');
  }, [material.id, material.type, material.url, sourceIdentity, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const imageSource = imageSources[imageIndex];
  const videoFallback = material.type === 'video' && !imageSource && Boolean(material.url);
  const failImage = () => {
    if (imageIndex + 1 < imageSources.length) {
      setImageIndex(index => index + 1);
      setState('loading');
    } else if (material.type === 'video' && material.url) {
      setImageIndex(imageSources.length);
      setState('loading');
    } else setState('error');
  };
  return <div className="relative h-full w-full">
    <LsMediaStateFrame state={state} label={state === 'error' ? '封面加载失败' : '正在加载封面'} className="h-full w-full bg-surface-2">
      {imageSource ? <AuthenticatedImage key={`${imageSource}:${attempt}`} src={imageSource} alt={material.name} className="h-full w-full object-cover" onReady={() => setState('ready')} onError={failImage} onNaturalAspectRatio={ratio => onNaturalAspectRatio?.(ratio, 'image')} />
        : videoFallback ? <AuthenticatedVideo key={`${material.url}:${attempt}`} apiUrl={material.url} loadOnMount previewFrame preload="auto" className="pointer-events-none h-full w-full bg-slate-950 object-cover" onReady={() => setState('ready')} onError={() => setState('error')} onLoadingChange={loading => loading && setState('loading')} onMetadata={metadata => { if (metadata.width > 0 && metadata.height > 0) onNaturalAspectRatio?.(metadata.width / metadata.height, 'video'); }} />
          : null}
    </LsMediaStateFrame>
    {state === 'error' && <button type="button" disabled={refreshing} className="absolute bottom-3 left-1/2 z-20 inline-flex min-h-8 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-text-secondary disabled:cursor-wait disabled:opacity-60" onClick={async event => {
      event.stopPropagation();
      setRefreshing(true);
      try { await onRefresh?.(); }
      finally { setAttempt(value => value + 1); setRefreshing(false); }
    }}>
      {refreshing && <Loader2 size={13} className="animate-spin" />}{refreshing ? '正在刷新' : '重新加载'}
    </button>}
  </div>;
}

export function MaterialLibraryCardMedia({
  material,
  favoriting,
  onRefresh,
  onEdit,
  onDelete,
  onFavorite,
  onPlay,
}: {
  material: Material;
  favoriting: boolean;
  onRefresh?: () => Promise<unknown>;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onPlay: () => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(() => materialIntrinsicAspectRatio(material));
  useEffect(() => setAspectRatio(materialIntrinsicAspectRatio(material)), [material.aspectRatio, material.height, material.id, material.width]);
  return (
    <div className="relative bg-surface-2" style={{ aspectRatio }}>
      <div className="absolute right-2 top-2 z-30 flex gap-1">
        {material.canManage && <button type="button" aria-label={`编辑 ${material.name}`} title="编辑" onClick={onEdit} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/70 bg-white/95 text-text-secondary shadow transition hover:text-accent"><Pencil size={14} /></button>}
        {material.canManage && <button type="button" aria-label={`删除 ${material.name}`} title="删除" onClick={onDelete} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/70 bg-white/95 text-text-secondary shadow transition hover:text-red-600"><Trash2 size={14} /></button>}
        <button type="button" aria-label={`${isFavoriteMaterial(material) ? '取消收藏' : '收藏'} ${material.name}`} title={isFavoriteMaterial(material) ? '取消收藏' : '收藏'} onClick={onFavorite} disabled={favoriting}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow transition disabled:cursor-wait disabled:opacity-60 ${isFavoriteMaterial(material) ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-white/70 bg-white/95 text-text-secondary hover:text-amber-500'}`}>
          {favoriting ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} fill={isFavoriteMaterial(material) ? 'currentColor' : 'none'} />}
        </button>
      </div>
      {material.type === 'video' || material.type === 'image' ? (
        <MaterialCardMedia material={material} onRefresh={onRefresh} onNaturalAspectRatio={(ratio, source) => {
          if (material.type === 'video' && source === 'image' && materialHasAuthoritativeAspectRatio(material)) return;
          setAspectRatio(ratio);
        }} />
      ) : material.type === 'audio' ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-muted"><Music2 size={28} /><span className="text-xs font-bold">音频素材</span></div>
      ) : (
        <div className="flex h-full items-center justify-center text-text-muted"><Film size={22} /></div>
      )}
      {material.type === 'video' ? (
        <button
          type="button"
          aria-label={`播放 ${material.name}`}
          disabled={!material.url}
          onClick={event => { event.stopPropagation(); onPlay(); }}
          className="absolute left-1/2 top-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-lg transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white disabled:hidden"
        >
          <Play size={19} fill="currentColor" />
        </button>
      ) : null}
    </div>
  );
}
