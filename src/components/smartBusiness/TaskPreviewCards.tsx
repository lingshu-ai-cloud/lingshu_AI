import { Button } from 'antd';
import { useEffect, useState } from 'react';
import type { ContentQueueItem } from '../../lib/digitalEmployees';
import type { Page } from '../../pageRegistry';
import type { VideoCreationPlan, VideoPreproductionPreview } from '../../lib/videoCreationPlan';
import { LsMediaStateFrame, LsProgressiveMedia, type LsMediaState } from '../ui/LsExperiencePrimitives';

type Platform = VideoCreationPlan['platform'];

export type WeeklyInspirationReference = {
  referenceId: string;
  sourceUrl: string;
  title: string;
  platform: Platform;
  thumbnailUrl: string;
  duration: number;
  benchmarkAnalysis?: VideoCreationPlan['benchmarkAnalysis'];
};

function videoPlanFamilyKey(plan: VideoCreationPlan) {
  return plan.contentFamilyId || plan.masterContentId || plan.contentId || '';
}

export function referencePlanForPublication(plans: VideoCreationPlan[], plan: VideoCreationPlan) {
  const explicitMaster = plan.masterContentId ? plans.find(candidate => candidate.contentId === plan.masterContentId) : undefined;
  if (explicitMaster) return explicitMaster;
  const familyKey = videoPlanFamilyKey(plan);
  if (!familyKey) return plan;
  return plans.find(candidate => videoPlanFamilyKey(candidate) === familyKey && candidate.productionRole === 'master')
    || plans.find(candidate => videoPlanFamilyKey(candidate) === familyKey)
    || plan;
}

export function inspirationReferenceForPlan(plan: VideoCreationPlan): WeeklyInspirationReference | null {
  const referenceId = String(plan.referenceId || plan.preproduction?.benchmark.referenceId || '').trim();
  const sourceUrl = String(plan.preproduction?.benchmark.sourceUrl || plan.planningEvidence?.referenceSourceUrl || '').trim();
  if (!referenceId && !sourceUrl) return null;
  return {
    referenceId,
    sourceUrl,
    title: String(plan.planningEvidence?.referenceTitle || plan.preproduction?.benchmark.title || plan.theme || '').trim(),
    platform: plan.platform,
    thumbnailUrl: String(plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || '').trim(),
    duration: Math.max(0, Number(plan.duration || 0)),
    benchmarkAnalysis: plan.benchmarkAnalysis,
  };
}

export function inspirationReferenceNavigationDetail(reference: WeeklyInspirationReference, contentItemId?: string) {
  return {
    page: 'socialInspiration' as const,
    view: 'inspiration' as const,
    businessRef: { referenceId: reference.referenceId },
    inspirationReference: reference,
    ...(contentItemId ? { contentItemId } : {}),
  };
}

function openTaskPreviewPage(item: ContentQueueItem, target: 'benchmark' | 'materials', onNavigate?: (page: Page) => void) {
  const pendingShoot = item.preproduction?.materials.pendingShootTaskIds[0];
  const benchmarkReference: WeeklyInspirationReference = {
    referenceId: String(item.preproduction?.benchmark.referenceId || item.referenceId || '').trim(),
    sourceUrl: String(item.preproduction?.benchmark.sourceUrl || '').trim(),
    title: String(item.preproduction?.benchmark.title || item.referenceTitle || item.title || '').trim(),
    platform: item.platform,
    thumbnailUrl: String(item.preproduction?.benchmark.thumbnailUrl || '').trim(),
    duration: Math.max(0, Number(item.outputSummary.durationSeconds || 0)),
  };
  const detail = target === 'benchmark'
    ? inspirationReferenceNavigationDetail(benchmarkReference, item.id)
    : pendingShoot
      ? { page: 'socialInspiration', view: 'shooting', shootingTaskId: pendingShoot, contentItemId: item.id }
      : { page: 'enterprise', view: 'products', productName: item.productName, materialIds: item.preproduction?.materials.items.map(material => material.id) || [], contentItemId: item.id };
  if (typeof window === 'undefined') {
    onNavigate?.(detail.page as Page);
    return;
  }
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail }));
}

type StoryboardSupplyStep = NonNullable<VideoPreproductionPreview['materials']['storyboard']>[number];
type PreviewMaterial = VideoPreproductionPreview['materials']['items'][number];

function PreproductionVideo({ src, label }: { src: string; label: string }) {
  const [state, setState] = useState<LsMediaState>('loading');
  useEffect(() => setState('loading'), [src]);
  return <LsMediaStateFrame state={state} label={state === 'error' ? '视频预览加载失败' : '正在加载视频预览'} className="h-full w-full">
    <video src={`${src}#t=0.1`} aria-label={label} muted preload="metadata" onLoadedData={() => setState('ready')} onError={() => setState('error')} className="h-full w-full object-cover" />
  </LsMediaStateFrame>;
}

function PreproductionMedia({ url, type, label, placeholder, placeholderTone = 'text-amber-700' }: { url: string; type: PreviewMaterial['type']; label: string; placeholder: string; placeholderTone?: string }) {
  if (url && type === 'video') return <PreproductionVideo src={url} label={label}/>;
  return <LsMediaStateFrame state="ready" className="h-full w-full">
    {url ? <LsProgressiveMedia src={url} alt={label} preview={false} rootClassName="block h-full w-full" className="!h-full !w-full object-cover"/>
      : <span className={`flex h-full w-full items-center justify-center px-2 text-center text-xs font-semibold ${placeholderTone}`}>{placeholder}</span>}
  </LsMediaStateFrame>;
}

function StoryboardSupplyStepCard({ step, matched }: { step: StoryboardSupplyStep; matched?: PreviewMaterial }) {
  const systemPlanned = step.status === 'system_planned';
  const ready = step.status === 'ready';
  const previewUrl = step.materialPreviewUrl || step.referenceFirstFrameUrl;
  const placeholder = systemPlanned ? '系统选路' : step.status === 'pending_shoot' ? '待拍' : step.status === 'needs_authorization' ? '待授权' : '待补素材';
  const stateLabel = ready ? '已匹配' : systemPlanned ? '系统生产计划' : step.status === 'pending_shoot' ? '待拍' : step.status === 'needs_authorization' ? '待授权' : '待匹配';
  return <div className={`w-44 overflow-hidden rounded-lg border bg-white ${ready ? 'border-emerald-200' : systemPlanned ? 'border-blue-200' : 'border-amber-200'}`}>
    <div className="aspect-video overflow-hidden bg-slate-100"><PreproductionMedia url={previewUrl} type={matched?.type === 'video' && step.materialPreviewUrl ? 'video' : 'image'} label={`${step.materialLabel}首帧`} placeholder={placeholder} placeholderTone={systemPlanned ? 'text-blue-700' : 'text-amber-700'}/></div>
    <div className="px-3 py-2"><p className="truncate text-xs font-semibold text-slate-700">{step.materialLabel}</p><p className={`mt-1 truncate text-xs ${systemPlanned ? 'font-semibold text-blue-700' : 'text-slate-500'}`}>{step.shotIds.length} 镜 · {stateLabel}</p>{systemPlanned && step.supplyRoute ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-blue-700" title={step.supplyRoute}>路线：{step.supplyRoute}</p> : null}{systemPlanned && step.supplyNote ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500" title={step.supplyNote}>{step.supplyNote}</p> : null}</div>
  </div>;
}

export function TaskPreviewCards({ item, onNavigate, onGenerateDetails }: { item: ContentQueueItem; onNavigate?: (page: Page) => void; onGenerateDetails?: () => void }) {
  const preview = item.preproduction;
  if (!preview) return <div className="mt-4 grid gap-3 lg:grid-cols-2">
    {[{ label: '爆款视频预览', note: '生成后展示真实参考、开头钩子和分镜结构。', tone: 'border-violet-200 bg-violet-50/45' }, { label: '素材组合预览', note: '生成后展示每个镜头将使用的素材，以及缺素材或待拍卡点。', tone: 'border-blue-100 bg-blue-50/40' }].map((card, index) => <article key={card.label} className={`rounded-lg border border-dashed p-4 ${card.tone}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-900">{card.label}</p><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-500">步骤 2 生成</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{card.note}</p>{index === 0 && onGenerateDetails && <Button htmlType="button" onClick={onGenerateDetails} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">生成两项详细预览</Button>}</article>)}
  </div>;
  const { benchmark, materials } = preview;
  const unresolvedStatuses = new Set<StoryboardSupplyStep['status']>(['missing', 'pending_shoot', 'needs_authorization']);
  const hasUnresolvedMaterial = materials.items.some(material => unresolvedStatuses.has(material.status)) || materials.storyboard?.some(step => unresolvedStatuses.has(step.status)) === true;
  const blocked = materials.status !== 'ready' || !preview.readiness.canStart || hasUnresolvedMaterial;
  const blockerText = [...preview.readiness.blockers, ...materials.blockers].filter(Boolean).slice(0, 3).join('；') || '仍有素材或授权项未完成，暂时不能开始制作。';
  const effectLabel = preview.confidence.effectLevel === 'medium' ? '中' : preview.confidence.effectLevel === 'low' ? '低' : '数据不足';
  return <div className="mt-4 grid gap-3 lg:grid-cols-2">
    <article className="overflow-hidden rounded-lg border border-violet-100 bg-violet-50/45"><div className="grid min-h-36 grid-cols-[112px_minmax(0,1fr)]"><div className="relative overflow-hidden bg-slate-900"><PreproductionMedia url={benchmark.thumbnailUrl} type="image" label="爆款参考缩略图" placeholder="暂无可核验缩略图" placeholderTone="text-white/70"/><span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">爆款视频预览</span></div><div className="min-w-0 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${benchmark.status === 'ready' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{benchmark.status === 'ready' ? '真实参考已绑定' : benchmark.status === 'not_applicable' ? '产品原创' : '缺少参考'}</span><span className="text-xs font-semibold text-slate-500">效果置信度：{effectLabel}</span></div><h4 className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-900">{benchmark.title || item.title}</h4><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{benchmark.hook || '当前没有可核验的爆款参考，不生成虚构预览。'}</p><p className="mt-2 truncate text-xs text-violet-700">{[benchmark.account, benchmark.views && `播放 ${benchmark.views}`].filter(Boolean).join(' · ') || '以编导分镜结构为准'}</p></div></div>{benchmark.shotSummary.length > 0 && <div className="border-t border-violet-100 px-4 py-3"><p className="line-clamp-2 text-xs leading-5 text-slate-600">{benchmark.shotSummary.slice(0, 3).join(' · ')}</p></div>}<Button htmlType="button" onClick={() => openTaskPreviewPage(item, 'benchmark', onNavigate)} className="!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between border-t border-violet-100 bg-white/70 px-4 py-2.5 text-xs font-semibold text-violet-700"><span>{benchmark.status === 'ready' ? '打开对应爆款分析' : '打开爆款灵感库'}</span><span>→</span></Button></article>
    <article className={`overflow-hidden rounded-lg border ${blocked ? 'border-amber-200 bg-amber-50/55' : 'border-zinc-200 bg-white'}`}><div className="p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">素材组合预览</p><span className={`rounded-full px-2 py-1 text-xs font-semibold ${blocked ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{blocked ? '任务不能开始' : '制作输入已锁定'}</span></div>
      {Boolean(materials.storyboard?.length) && <div className="mt-3"><p className="mb-2 text-xs font-semibold text-slate-500">按爆款结构连接的成片首帧</p><div className="flex items-stretch gap-2 overflow-x-auto pb-1">{materials.storyboard!.map((step, index) => { const matched = materials.items.find(material => material.id === step.materialId); return <div key={`${step.materialType}-${step.shotIds.join('-')}`} className="flex shrink-0 items-center gap-2"><StoryboardSupplyStepCard step={step} matched={matched}/>{index < materials.storyboard!.length - 1 && <span className="text-xs font-semibold text-emerald-500">→</span>}</div>; })}</div></div>}
      {!materials.storyboard?.length && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{materials.items.slice(0, 3).map(material => { const placeholder = material.status === 'system_planned' ? '系统生产计划' : material.status === 'pending_shoot' ? '待拍' : material.status === 'needs_authorization' ? '待授权' : '待补素材'; return <div key={material.id} className="min-w-0"><div className={`aspect-video overflow-hidden rounded-lg border ${material.status === 'ready' ? 'border-emerald-100 bg-white' : material.status === 'system_planned' ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-100'}`}><PreproductionMedia url={material.previewUrl} type={material.type} label={`${material.name}预览`} placeholder={placeholder} placeholderTone={material.status === 'system_planned' ? 'text-blue-700' : 'text-amber-700'}/></div><p className="mt-1 truncate text-xs font-semibold text-slate-600">{material.name}</p></div>; })}{!materials.items.length && <div className="sm:col-span-3 flex min-h-16 items-center justify-center rounded-lg border border-dashed border-amber-200 bg-white/70 px-3 text-xs font-semibold text-amber-700">还没有可用素材</div>}</div>}
      {blocked ? <div role="alert" className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">{blockerText}</div> : <p className="mt-3 text-xs leading-5 text-emerald-700">素材、授权和预算检查已通过，可以进入制作。</p>}</div><Button htmlType="button" onClick={() => openTaskPreviewPage(item, 'materials', onNavigate)} className={`!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between border-t bg-white/70 px-4 py-2.5 text-xs font-semibold ${blocked ? 'border-amber-200 text-amber-800' : 'border-emerald-100 text-emerald-700'}`}><span>{materials.pendingShootTaskIds.length ? '打开对应待拍任务' : '打开产品资料与素材入口'}</span><span>→</span></Button></article>
    <div className="lg:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500"><span>按时完成率：{preview.confidence.onTimeRate === null ? '暂无历史样本' : `${preview.confidence.onTimeRate}%`}</span><span>内容效果置信度：{effectLabel}</span><span>说明：匹配度不是爆款成功率，发布前不展示虚构概率。</span></div>
  </div>;
}
