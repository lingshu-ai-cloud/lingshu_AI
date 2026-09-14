import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Film, Image as ImageIcon, Play, X } from 'lucide-react';
import type { LeadContentPackageResult } from '../../lib/studioApi';
import { authHeader } from '../../lib/auth';
import type { VideoKickoff } from '../AiCreateStudio';
import { playVideoWithAuthenticatedFallback } from './studioAuthenticatedMedia';

const leadPackageRoleLabels: Record<string, string> = {
  buyer_attention: '第 1 组 · 吸引目标买家',
  capability_explanation: '第 2 组 · 解释合作能力',
  supplier_trust: '第 3 组 · 建立供应商信任',
};

export function LeadContentPackagePreview({ value, imageUrl }: { value: LeadContentPackageResult; imageUrl?: string }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-emerald-900">三组获客内容包</p>
          <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(value, null, 2))} className="text-xs font-bold text-emerald-700">复制全部</button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-emerald-800">{value.strategySummary || '按买家注意、合作能力、供应商信任依次发布，形成连续承接。'}</p>
      </div>
      {imageUrl && <div className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="border-b border-border px-3 py-2 text-[11px] font-bold text-text-secondary">第 1 组首图预览</div>
        <img src={imageUrl} alt="获客内容包首图预览" className="max-h-[520px] w-full object-contain" />
      </div>}
      <div className="grid gap-3 xl:grid-cols-3">
        {value.items.map((item, itemIndex) => <article key={`${item.role}-${itemIndex}`} className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-[10px] font-bold text-accent">{leadPackageRoleLabels[item.role] || item.role}</p>
          <h4 className="mt-1 text-sm font-bold text-text-primary">{item.title}</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">目标：{item.objective}</p>
          <div className="mt-3 space-y-2">{item.slides.map((slide, slideIndex) => <div key={`${slide.index}-${slideIndex}`} className="rounded-lg border border-border/70 bg-white p-2">
            <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-black text-accent">{slide.index || slideIndex + 1}</span><span className="text-[9px] text-text-muted">{slide.assetRole}</span></div>
            <p className="mt-1 text-[11px] font-bold text-text-primary">{slide.headline}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{slide.body}</p>
          </div>)}</div>
          <div className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed text-text-secondary">
            <p><span className="font-bold text-text-primary">CTA：</span>{item.cta}</p>
            <p className="mt-1"><span className="font-bold text-text-primary">私信开场：</span>{item.dmOpening}</p>
          </div>
        </article>)}
      </div>
      {value.referenceModulesUsed.length > 0 && <div className="rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-xs font-bold text-text-primary">从对标图文保留的通用元素</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">{value.referenceModulesUsed.map((module, index) => <div key={`${module.module}-${index}`} className="rounded-lg bg-white p-2 text-[10px] leading-relaxed text-text-secondary">
          <p className="font-bold text-text-primary">{module.module}</p><p className="mt-1">证据：{module.evidence}</p><p className="mt-1 text-text-muted">套用：{module.application}</p>
        </div>)}</div>
      </div>}
      {value.fieldsToConfirm.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">生成图片或发布前需补充确认：{value.fieldsToConfirm.join('、')}</div>}
    </div>
  );
}

export function BenchmarkVideoPreview({ kickoff, embedded = false }: { kickoff: VideoKickoff | null; embedded?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playRequestRef = useRef(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const video = kickoff?.video;
  const declaredAspectRatio = Number(video?.aspectRatio || kickoff?.generatedVideo?.aspectRatio)
    || (video?.width && video?.height ? video.width / video.height : 0)
    || (kickoff?.generatedVideo?.width && kickoff?.generatedVideo?.height ? kickoff.generatedVideo.width / kickoff.generatedVideo.height : 0);
  const [mediaAspectRatio, setMediaAspectRatio] = useState(declaredAspectRatio || 9 / 16);
  const isImageReference = video?.contentFormat === 'image';
  const poster = video?.thumbnail || video?.aiAnalysis?.materialPoster || kickoff?.generatedVideo?.poster || '';
  const rawUrl = video?.videoUrl || video?.aiAnalysis?.materialUrl || kickoff?.generatedVideo?.url || '';
  const apiUrl = rawUrl.replace(/\/media(?=\?|$)/, '/media-url');

  useEffect(() => {
    playRequestRef.current += 1;
    const element = videoRef.current;
    if (element) { element.pause(); element.removeAttribute('src'); delete element.dataset.sourceUrl; element.load(); }
    setPlaybackUrl(''); setPlaying(false); setPlaybackError(''); setMediaAspectRatio(declaredAspectRatio || 9 / 16);
  }, [apiUrl]);

  const ensurePlaybackUrl = async () => {
    if (playbackUrl) return playbackUrl;
    if (!apiUrl) return '';
    if (!apiUrl.includes('/api/overseas/videos/')) { setPlaybackUrl(apiUrl); return apiUrl; }
    if (loading) return '';
    setLoading(true);
    try {
      const response = await fetch(apiUrl, { headers: authHeader(), credentials: 'same-origin' });
      if (!response.ok) return '';
      const next = String(((await response.json()) as { url?: string }).url || '');
      setPlaybackUrl(next);
      return next;
    } finally { setLoading(false); }
  };

  const play = async () => {
    const requestId = ++playRequestRef.current;
    setPlaybackError('');
    const url = await ensurePlaybackUrl();
    if (requestId !== playRequestRef.current) return;
    if (!url) { setPlaybackError('视频文件暂不可用，可点击右上角“原站”查看'); return; }
    const element = videoRef.current;
    if (!element) return;
    try {
      const usedUrl = await playVideoWithAuthenticatedFallback(element, url);
      if (requestId !== playRequestRef.current) return;
      if (usedUrl !== playbackUrl) setPlaybackUrl(usedUrl);
      setPlaybackError(''); setPlaying(true);
    } catch (error: unknown) {
      if (requestId !== playRequestRef.current) return;
      setPlaying(false);
      const message = error instanceof Error ? error.message : String(error || '');
      if (error instanceof DOMException && error.name === 'AbortError' && /interrupted by a new load/i.test(message)) return;
      setPlaybackError(message ? `视频加载失败：${message}` : '视频加载或解码失败，可点击右上角“原站”查看');
    }
  };
  const togglePlayback = () => {
    if (videoRef.current && !videoRef.current.paused) { videoRef.current.pause(); setPlaying(false); }
    else void play();
  };
  const metadata = (element: HTMLVideoElement) => {
    if (element.videoWidth > 0 && element.videoHeight > 0) setMediaAspectRatio(element.videoWidth / element.videoHeight);
  };
  const videoElement = (className: string) => <video ref={videoRef} poster={poster || undefined} muted playsInline loop preload="metadata" className={className}
    onLoadedMetadata={event => metadata(event.currentTarget)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
    onError={() => { setPlaying(false); setPlaybackError('视频加载或解码失败，可点击右上角“原站”查看'); }} />;
  const playbackLayers = <>
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-transparent">{!playing && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"><Play size={18} fill="currentColor" /></span>}</div>
    {loading && <span className="absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[9px] text-white">加载中…</span>}
    {playbackError && <span className="absolute inset-x-3 bottom-3 rounded-md bg-black/70 px-3 py-2 text-center text-[10px] leading-4 text-white">{playbackError}</span>}
  </>;

  if (embedded) return <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
    {video?.sourceUrl && <a href={video.sourceUrl} target="_blank" rel="noreferrer" className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">原站 <ExternalLink size={11} /></a>}
    {!video ? <div className="flex flex-col items-center justify-center px-8 text-center text-white/65"><Film size={28} className="opacity-50" /><p className="mt-3 text-xs font-bold">尚未载入对标内容</p></div>
      : isImageReference ? poster ? <img src={poster} alt="竞品图文首图" className="h-full w-full object-contain" /> : <ImageIcon size={32} className="text-white/35" />
      : <div className="group relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden bg-black" onClick={togglePlayback}>{videoElement('h-full w-full object-contain')}{playbackLayers}</div>}
  </div>;

  return <aside className="sticky top-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="min-w-0"><p className="text-sm font-black text-text-primary">{isImageReference ? '对标图文' : '对标视频'}</p><p className="mt-0.5 truncate text-[10px] text-text-muted">{video?.platform || '尚未载入'} · {isImageReference ? '完整轮播证据' : '悬浮播放'}</p></div>
      {video?.sourceUrl && <a href={video.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-accent">原站 <ExternalLink size={11} /></a>}
    </div>
    {video ? <div className="p-4">
      {isImageReference ? <div className="relative mx-auto aspect-[4/5] max-h-[600px] overflow-hidden rounded-xl bg-surface-2">{poster ? <img src={poster} alt="竞品图文首图" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-text-muted"><ImageIcon size={28} className="opacity-35" /></div>}<span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">首图参考</span></div>
        : <div className="flex max-h-[600px] items-center justify-center overflow-hidden"><div className="group relative max-h-full max-w-full cursor-pointer overflow-hidden rounded-xl bg-black" style={{ aspectRatio: mediaAspectRatio, width: mediaAspectRatio >= 1 ? '100%' : 'auto', height: mediaAspectRatio < 1 ? '100%' : 'auto' }} onClick={togglePlayback}>{videoElement('h-full w-full object-contain')}{playbackLayers}</div></div>}
      <p className="mt-3 line-clamp-2 text-xs font-bold leading-relaxed text-text-primary">{video.title || kickoff?.referenceAnalysis?.title || '未命名对标视频'}</p>
      <p className="mt-1 text-[10px] text-text-muted">{isImageReference ? `${video.aiAnalysis?.imageEvidence?.observedFacts?.length || 0} 张逐图证据已带入，只复用可见布局与信息模块` : `${video.duration ? `${video.duration}s · ` : ''}点击视频播放或暂停`}</p>
    </div> : <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center"><Film size={28} className="text-text-muted opacity-35" /><p className="mt-3 text-xs font-bold text-text-secondary">尚未载入对标内容</p><p className="mt-1 text-[10px] leading-relaxed text-text-muted">从灵感中心选择视频或图文并发起创作后，将在这里显示。</p></div>}
  </aside>;
}

export function VariationChipEditor({ label, hint, value, suggestions, onChange }: { label: string; hint: string; value: string; suggestions: string[]; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  const items = value.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
  const commit = (candidate = draft) => {
    const additions = candidate.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
    if (!additions.length) return;
    onChange([...new Set([...items, ...additions])].join('，'));
    setDraft('');
  };
  const remove = (item: string) => onChange(items.filter(current => current !== item).join('，'));
  return <div className="rounded-xl border border-border bg-surface p-3.5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-text-primary">{label}</p><p className="mt-0.5 text-[10px] text-text-muted">{hint}</p></div><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{items.length || 0} 个</span></div>
    <div className="mt-2.5 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2 p-1.5 focus-within:border-accent">
      {items.map(item => <span key={item} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text-primary shadow-sm">{item}<button type="button" onClick={() => remove(item)} className="text-text-muted hover:text-red-500" aria-label={`删除${item}`}><X size={11} /></button></span>)}
      <input value={draft} onChange={event => { const next = event.target.value; if (/[，,\n]$/.test(next)) commit(next); else setDraft(next); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Backspace' && !draft && items.length) remove(items[items.length - 1]!); }}
        onBlur={() => commit()} placeholder={items.length ? '继续添加…' : '输入后按回车添加'} className="min-w-28 flex-1 bg-transparent px-1 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted" />
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-[10px] text-text-muted">快捷添加</span>{suggestions.filter(item => !items.includes(item)).slice(0, 4).map(item => <button key={item} type="button" onMouseDown={event => event.preventDefault()} onClick={() => commit(item)} className="rounded-md bg-surface-2 px-2 py-1 text-[10px] text-text-secondary transition hover:bg-accent/10 hover:text-accent">+ {item}</button>)}</div>
  </div>;
}
