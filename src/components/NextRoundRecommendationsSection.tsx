import { ArrowRight, ArrowUpRight, Hash, ImageOff, Radar, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BusinessDestination, WeeklyReviewSummary } from '../lib/digitalEmployees';
import { buildNextRoundRecommendationCards, type NextRoundRecommendationCard, type NextRoundRecommendationKind } from '../lib/nextRoundRecommendations';
import { authHeader } from '../lib/auth';
import { LsMediaStateFrame, LsProgressiveMedia } from './ui/LsExperiencePrimitives';

const icons: Record<NextRoundRecommendationKind, typeof RefreshCw> = { inherit: RefreshCw, tags: Hash, trends: Radar };
const statusTone = { ready: 'bg-emerald-50 text-emerald-700', watch: 'bg-blue-50 text-blue-700', waiting: 'bg-zinc-100 text-zinc-600' };
const tagTone = {
  hot: 'border-amber-200 bg-amber-50 text-amber-800',
  new: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  dropped: 'border-zinc-200 bg-zinc-100 text-zinc-500 line-through',
  published: 'border-blue-200 bg-blue-50 text-blue-700',
};

function CoverImage({ sources, alt }: { sources: Array<string | undefined>; alt: string }) {
  const candidates = useMemo(() => [...new Set(sources.map(value => String(value || '').trim()).filter(Boolean))], [sources.join('|')]);
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => setIndex(0), [candidates.join('|')]);
  const src = candidates[index];
  useEffect(() => {
    setResolved(''); setReady(false);
    if (!src) return;
    const url = new URL(src, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) { setResolved(src); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    let active = true;
    let objectUrl = '';
    void fetch(src, { headers: authHeader(), signal: controller.signal }).then(async response => {
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('cover_unavailable');
      const blob = await response.blob();
      if (active) { objectUrl = URL.createObjectURL(blob); setResolved(objectUrl); }
    }).catch(() => { if (active) setIndex(current => current + 1); }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return <LsMediaStateFrame state={!src ? 'error' : ready ? 'ready' : 'loading'} label={!src ? '暂无可用封面' : undefined} className="h-full w-full">
    {resolved && <LsProgressiveMedia src={resolved} alt={alt} preview={false} width="100%" height="100%" style={{ objectFit: 'contain' }} onLoad={() => setReady(true)} onError={() => setIndex(current => current + 1)}/>}
  </LsMediaStateFrame>;
}

function ContentInheritanceVisual({ card }: { card: NextRoundRecommendationCard }) {
  const media = <div className="relative aspect-video overflow-hidden rounded-lg bg-zinc-50">
    <CoverImage sources={[card.thumbnailUrl, card.sourceContentId ? `/api/overseas/videos/${encodeURIComponent(card.sourceContentId)}/thumbnail` : undefined]} alt={card.conclusion}/>
    <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-semibold text-white">{card.links[0]?.meta || '本期优秀内容'}</span>
    <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-10 text-xs font-semibold leading-5 text-white">{card.conclusion}</span>
  </div>;
  return <div className="space-y-3">
    {card.links[0] ? <a href={card.links[0].url} target="_blank" rel="noreferrer noopener" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{media}</a> : media}
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3"><p className="text-xs font-semibold text-blue-700">首镜钩子</p><p className="mt-1 text-sm font-semibold leading-5 text-text-primary">{card.hook || '等待真实内容分析补齐钩子'}</p></div>
    <div><p className="mb-2 text-xs font-semibold text-text-muted">内容框架</p><div className="flex flex-wrap items-center gap-1.5">{(card.framework?.length ? card.framework : ['等待结构分析']).slice(0, 5).map((step, index) => <span key={`${step}-${index}`} className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-violet-50 px-2 py-1.5 text-xs font-medium text-violet-800"><b className="text-violet-500">{index + 1}</b>{step}</span>)}</div></div>
  </div>;
}

function TagVisual({ card }: { card: NextRoundRecommendationCard }) {
  return <div className="space-y-4">
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3"><p className="text-xs font-semibold text-blue-700">变化判断</p><p className="mt-1 text-base font-semibold text-text-primary">{card.changeSummary}</p></div>
    <div><p className="mb-2 text-xs font-semibold text-text-muted">可验证卖点候选</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{(card.sellingPoints?.length ? card.sellingPoints : ['等待行业 Tag 形成卖点候选']).map((point, index) => <div key={point} className="rounded-lg border border-zinc-200 bg-white p-2.5"><span className="text-xs font-semibold text-violet-600">0{index + 1}</span><p className="mt-1 text-xs font-semibold leading-5 text-text-primary">{point}</p></div>)}</div></div>
    {card.tagGroups?.map(group => <div key={group.label} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2"><span className="pt-1 text-xs font-semibold text-text-muted">{group.label}</span><div className="flex flex-wrap gap-1.5">{group.tags.map(tag => <span key={`${group.label}-${tag}`} className={`rounded-full border px-2 py-1 text-xs font-semibold ${tagTone[group.tone]}`}>#{tag}</span>)}</div></div>)}
  </div>;
}

function TrendVisual({ card }: { card: NextRoundRecommendationCard }) {
  return <div className="space-y-3">
    <div className="rounded-lg border border-violet-100 bg-violet-50/70 p-3"><p className="text-xs font-semibold text-violet-700">行业变化</p><p className="mt-1 text-sm font-semibold leading-5 text-text-primary">{card.changeSummary}</p></div>
    {card.sellingPoints?.length ? <div><p className="mb-2 text-xs font-semibold text-text-muted">本轮信号集中卖点</p><div className="flex flex-wrap gap-1.5">{card.sellingPoints.map(point => <span key={point} className="rounded-full bg-accent px-2.5 py-1.5 text-xs font-semibold text-white">{point}</span>)}</div></div> : null}
    <div className="space-y-2">{card.signals?.length ? card.signals.map(signal => <a key={signal.id} href={signal.sourceUrl || undefined} target="_blank" rel="noreferrer noopener" className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)_16px] items-center gap-3 rounded-lg border border-border p-2.5 transition hover:border-blue-300 hover:bg-blue-50/30"><span className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-zinc-100"><CoverImage sources={[signal.thumbnailUrl, signal.id ? `/api/overseas/videos/${encodeURIComponent(signal.id)}/thumbnail` : undefined]} alt={signal.title}/></span><span className="min-w-0"><strong className="line-clamp-2 text-xs leading-5 text-text-primary">{signal.title}</strong><span className="mt-0.5 block truncate text-xs text-text-muted">{signal.platform || '社媒'} · {signal.summary}</span></span><ArrowUpRight size={14} className="text-text-muted"/></a>) : <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-text-muted">等待可追溯行业信号</div>}</div>
  </div>;
}

export default function NextRoundRecommendationsSection({ summary, industryTrends, onOpen }: { summary?: WeeklyReviewSummary; industryTrends?: import('../lib/digitalEmployees').NextRoundRecommendations['industryTrends']; onOpen: (page: BusinessDestination, view?: 'create' | 'publish') => void }) {
  const cards = buildNextRoundRecommendationCards(summary, industryTrends);
  return <section aria-label="下一轮建议" className="rounded-lg border border-border bg-white p-5 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-text-primary">下一轮建议</h2></div>
    <div className="grid gap-4 lg:grid-cols-3">{cards.map(card => {
      const Icon = icons[card.kind];
      const target = card.kind === 'inherit' ? 'smartAssets' : 'socialInspiration';
      const actionLabel = card.kind === 'inherit' ? '进入内容制作' : card.kind === 'tags' ? '查看 Tag 与采集范围' : '查看灵感中心';
      return <article key={card.kind} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-white"><div className="flex items-start gap-3 border-b border-border p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Icon size={19}/></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-[0.14em] text-text-muted">{card.index}</p><h3 className="mt-0.5 text-base font-semibold text-text-primary">{card.title}</h3></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusTone[card.status]}`}>{card.statusLabel}</span></div><div className="flex-1 p-4">{card.kind === 'inherit' ? <ContentInheritanceVisual card={card}/> : card.kind === 'tags' ? <TagVisual card={card}/> : <TrendVisual card={card}/>}</div><div className="border-t border-border bg-zinc-50/70 p-4"><div className="mb-3 flex items-start gap-2 text-xs leading-4 text-text-secondary"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-blue-600"/><span>{card.systemActions.slice(0, 2).join('；') || '等待真实数据后生成下一步'}</span></div><button type="button" onClick={() => onOpen(target, card.kind === 'inherit' ? 'create' : undefined)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-xs font-semibold text-text-primary transition hover:border-blue-300 hover:text-blue-700">{actionLabel}<ArrowRight size={14}/></button></div></article>;
    })}</div>
  </section>;
}
