import { Button, Modal } from 'antd';
import { ChevronDown, ChevronUp, Loader2, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { lsMotion } from '../../lib/designTokens';
import { sourceEmbedUrl } from '../../lib/inspirationVideoPlayback';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { AuthenticatedVideo, ThumbnailImage } from './InspirationMedia';
import { SocialPlatformIcon } from '../SocialPlatformIcon';

const SWIPE_HINT_STORAGE_KEY = 'lingshu.inspiration-watch.swipe-hint.v1';
const SWIPE_DISTANCE_THRESHOLD = 72;
const SWIPE_VELOCITY_THRESHOLD = 560;

function evidenceText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim()
    : value && typeof value === 'object' && 'text' in value && typeof value.text === 'string' ? value.text.trim() : '';
  return text === '[object Object]' ? '' : text;
}

function briefContentStructure(video: TrendVideo): string[] {
  const gemini = video.aiAnalysis?.gemini;
  const explicit = evidenceText(gemini?.structure);
  if (explicit) return explicit.split(/\s*(?:→|->|⇒|\n|\|)\s*/).map(item => item.trim()).filter(Boolean).slice(0, 5);
  const coarse = (gemini?.coarseStructure || []).map(item => [item.time, item.label, item.description || item.desc]
    .map(evidenceText).filter(Boolean).join(' · ')).filter(Boolean);
  if (coarse.length) return coarse.slice(0, 5);
  return (gemini?.scriptDetails15s || []).map(item => [item.time || item.timestamp, item.purpose || item.visual || item.shot]
    .map(evidenceText).filter(Boolean).join(' · ')).filter(Boolean).slice(0, 4);
}

function AdjacentVideoPreview({ video, position }: { video: TrendVideo; position: -1 | 1 }) {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden bg-black"
    style={{ transform: `translateY(${position * 100}%)` }}>
    {video.thumbnail ? <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="h-full w-full object-contain opacity-80"/>
      : <div className="flex h-full w-full items-center justify-center bg-neutral-950 text-white/50"><Play size={32}/></div>}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-5 pb-6 pt-16 text-white">
      <p className="line-clamp-2 text-sm font-semibold">{video.title}</p>
    </div>
  </div>;
}

export default function InspirationWatchDialog({ video, videos, onClose, onOpenDetails }: {
  video: TrendVideo;
  videos: TrendVideo[];
  onClose: () => void;
  onOpenDetails?: (video: TrendVideo) => void;
}) {
  const ordered = videos.some(item => item.id === video.id) ? videos : [video, ...videos];
  const [index, setIndex] = useState(() => Math.max(0, ordered.findIndex(item => item.id === video.id)));
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [useEmbed, setUseEmbed] = useState(false);
  const [boundary, setBoundary] = useState('');
  const [transitionDirection, setTransitionDirection] = useState<-1 | 1>(1);
  const [showSwipeHint, setShowSwipeHint] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(SWIPE_HINT_STORAGE_KEY) !== 'seen'; } catch { return true; }
  });
  const reduceMotion = usePrefersReducedMotion();
  const lastSwipeAt = useRef(0);
  const detailsRef = useRef<HTMLElement>(null);
  const current = ordered[Math.min(index, ordered.length - 1)] || video;
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const embedUrl = sourceEmbedUrl(current);
  const hooks = (current.aiAnalysis?.gemini?.hooks || []).map(evidenceText).filter(Boolean);
  const sellingPoints = (current.aiAnalysis?.gemini?.sellingPoints || []).map(evidenceText).filter(Boolean);
  const contentStructure = briefContentStructure(current);

  useEffect(() => {
    if (!showSwipeHint) return;
    try { window.localStorage.setItem(SWIPE_HINT_STORAGE_KEY, 'seen'); } catch { /* local storage may be unavailable */ }
    const timer = window.setTimeout(() => setShowSwipeHint(false), 3600);
    return () => window.clearTimeout(timer);
  }, [showSwipeHint]);

  const changeVideo = (direction: -1 | 1) => {
    setShowSwipeHint(false);
    const next = index + direction;
    if (next < 0 || next >= ordered.length) {
      setBoundary(direction > 0 ? '已到当前筛选结果末尾，可返回列表翻页' : '已到当前筛选结果第一条');
      return;
    }
    setTransitionDirection(direction);
    setIndex(next);
    setAttempt(0);
    setLoading(true);
    setError('');
    setUseEmbed(false);
    setBoundary('');
    window.requestAnimationFrame(() => detailsRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
  };
  const swipe = (delta: number) => {
    setShowSwipeHint(false);
    if (Math.abs(delta) < 55 || Date.now() - lastSwipeAt.current < 450) return;
    lastSwipeAt.current = Date.now();
    changeVideo(delta > 0 ? 1 : -1);
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) swipe(event.deltaY);
  };
  const completeDrag = (offsetY: number, velocityY: number) => {
    const direction = offsetY < 0 ? 1 : -1;
    const crossedDistance = Math.abs(offsetY) >= SWIPE_DISTANCE_THRESHOLD;
    const crossedVelocity = Math.abs(velocityY) >= SWIPE_VELOCITY_THRESHOLD;
    if (!crossedDistance && !crossedVelocity) return;
    if (Date.now() - lastSwipeAt.current < 450) return;
    lastSwipeAt.current = Date.now();
    changeVideo(direction);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || (event.target as HTMLElement).closest('[data-preview-details],button,input,textarea,a')) return;
    event.preventDefault();
    changeVideo(event.key === 'ArrowDown' ? 1 : -1);
  };
  const retry = () => { setAttempt(value => value + 1); setLoading(true); setError(''); setUseEmbed(false); };

  return <Modal open title={<AnimatePresence initial={false} mode="wait"><motion.span key={current.id}
    initial={reduceMotion ? false : { opacity: 0, y: transitionDirection * 5 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: transitionDirection * -5 }}
    transition={{ duration: reduceMotion ? 0 : .18 }}>{current.title}</motion.span></AnimatePresence>} className="ls-inspiration-watch-dialog" width={1180} zIndex={2200} footer={null} onCancel={onClose}
    style={{ maxWidth: 'calc(100vw - 16px)' }} styles={{ body: { padding: 0 } }} destroyOnHidden>
    <div className="grid max-h-[calc(100dvh-100px)] overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden">
      <div className="relative flex min-h-[320px] flex-col bg-black" tabIndex={0} onKeyDown={onKeyDown} onWheel={onWheel}
        aria-label="视频预览，向上滑动、滚轮或按方向键切换">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false} custom={transitionDirection} mode="popLayout">
            <motion.div key={current.id} custom={transitionDirection}
              drag={!reduceMotion && ordered.length > 1 ? 'y' : false}
              dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.92} dragMomentum={false}
              onDragStart={() => setShowSwipeHint(false)}
              onDragEnd={(_, info) => completeDrag(info.offset.y, info.velocity.y)}
              initial={reduceMotion ? false : { opacity: 0, y: `${transitionDirection * 100}%`, scale: .985, filter: 'blur(5px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={reduceMotion ? undefined : { opacity: 0, y: `${transitionDirection * -100}%`, scale: .99, filter: 'blur(3px)' }}
              transition={{ duration: reduceMotion ? 0 : lsMotion.duration.standard / 1000, ease: lsMotion.ease.standard }}
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing">
              {previous && <AdjacentVideoPreview video={previous} position={-1}/>}
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                {current.videoUrl && !useEmbed ? <AuthenticatedVideo key={`${current.id}:${attempt}`} apiUrl={current.videoUrl} poster={current.thumbnail}
                  controls autoPlay className="max-h-[68dvh] w-full bg-black object-contain" onReady={() => { setLoading(false); setError(''); }}
                  onLoadingChange={setLoading} onError={message => { setLoading(false); if (embedUrl) setUseEmbed(true); else setError(message || '视频预览失败'); }} />
                  : embedUrl ? <iframe key={current.id} src={embedUrl} title={`${current.title} 站内播放器`}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
                    className="aspect-video w-full border-0 bg-black" />
                    : <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-white/70"><Play size={28}/><p>当前没有可播放的媒体，可从来源查看原视频。</p></div>}
                {loading && current.videoUrl && !useEmbed && !error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Loader2 size={20} className="animate-spin"/><span className="ml-2">正在准备视频…</span></div>}
                {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center text-white"><p>{error}</p><Button onClick={retry}>重新获取播放地址</Button></div>}
              </div>
              {next && <AdjacentVideoPreview video={next} position={1}/>}
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>{showSwipeHint && ordered.length > 1 ? <motion.div data-swipe-hint className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex justify-center px-4"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : lsMotion.duration.enter / 1000, ease: lsMotion.ease.enter }}>
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-4 py-2.5 text-sm font-medium text-white shadow-lg backdrop-blur">
              <ChevronUp size={18} aria-hidden="true"/><span>向上滑动切换视频</span>
            </div>
          </motion.div> : null}</AnimatePresence>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/15 px-4 py-2 text-xs text-white/80">
          <span>{index + 1} / {ordered.length}</span>
          <span role="status" aria-live="polite">{boundary || '向上滑动查看下一条，详情区可独立滚动'}</span>
          <div className="flex gap-1"><Button size="small" icon={<ChevronUp size={14}/>} onClick={() => changeVideo(-1)} aria-label="上一条视频"/><Button size="small" icon={<ChevronDown size={14}/>} onClick={() => changeVideo(1)} aria-label="下一条视频"/></div>
        </div>
      </div>
      <aside ref={detailsRef} data-preview-details className="max-h-[42dvh] overflow-y-auto border-t border-border bg-surface p-5 text-text-primary md:max-h-[calc(100dvh-100px)] md:border-l md:border-t-0" aria-label="视频详情">
        <AnimatePresence initial={false} mode="wait"><motion.div key={current.id}
          initial={reduceMotion ? false : { opacity: 0, x: transitionDirection * 12 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? undefined : { opacity: 0, x: transitionDirection * -8 }}
          transition={{ duration: reduceMotion ? 0 : .2 }}>
        <div className="flex items-center gap-2 text-sm font-semibold"><SocialPlatformIcon platform={current.platform} size={18}/>{current.platform}</div>
        <h3 className="mt-4 text-base font-semibold leading-6">{current.title}</h3>
        <dl className="mt-5 space-y-3 text-sm"><div><dt className="text-text-muted">播放量</dt><dd>{current.views || '待获取'}</dd></div>
          <div><dt className="text-text-muted">来源账号</dt><dd>{current.aiAnalysis?.author || current.aiAnalysis?.sourceAccountName || '未抓取'}</dd></div>
          {current.aiAnalysis?.gemini?.theme && <div><dt className="text-text-muted">内容主题</dt><dd>{current.aiAnalysis.gemini.theme}</dd></div>}
        </dl>
        {current.aiAnalysis?.analysisError && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">分析未完成：{current.aiAnalysis.analysisError}</p>}
        {contentStructure.length ? <section className="mt-5 border-t border-border pt-4"><h4 className="text-sm font-semibold">内容结构</h4><ol className="mt-2 space-y-2 text-xs leading-5 text-text-secondary">{contentStructure.map((item, itemIndex) => <li key={`${item}-${itemIndex}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2"><span className="text-text-muted">{String(itemIndex + 1).padStart(2, '0')}</span><span>{item}</span></li>)}</ol></section> : null}
        {hooks.length ? <section className="mt-5 border-t border-border pt-4"><h4 className="text-sm font-semibold">开场钩子</h4><ul className="mt-2 space-y-2 text-xs leading-5 text-text-secondary">{hooks.slice(0, 3).map((hook, hookIndex) => <li key={`${hook}-${hookIndex}`}>{hook}</li>)}</ul></section> : null}
        {sellingPoints.length ? <section className="mt-5 border-t border-border pt-4"><h4 className="text-sm font-semibold">已提取卖点</h4><ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-text-secondary">{sellingPoints.slice(0, 4).map((point, pointIndex) => <li key={`${point}-${pointIndex}`}>{point}</li>)}</ul></section> : null}
        {!current.aiAnalysis?.gemini?.theme && !contentStructure.length && !hooks.length && <p className="mt-5 rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">当前尚无可展示的分析结论；来源信息和原视频仍可查看。</p>}
        <div className="mt-6 flex flex-wrap gap-2">{onOpenDetails && <Button type="primary" onClick={() => onOpenDetails(current)}>查看完整拆解</Button>}
          {current.sourceUrl && <Button href={current.sourceUrl} target="_blank" rel="noopener noreferrer">原站打开</Button>}</div>
        </motion.div></AnimatePresence>
      </aside>
    </div>
  </Modal>;
}
