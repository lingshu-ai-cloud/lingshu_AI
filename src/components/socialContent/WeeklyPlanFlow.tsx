import { useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Tag } from 'antd';
import { ArrowDown, ArrowRight, Check, Clapperboard, Loader2 } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { GoalDraft } from '../../lib/defaultWeeklyGoal';
import { ThumbnailImage } from '../inspiration/InspirationMedia';
import { SocialPlatformIcon, socialBrandLabel } from '../SocialPlatformIcon';
import { weeklyDistributionPlatforms, weeklyDistributionPreview } from '../../lib/weeklyDistributionPreview';
import { estimateWeeklyMixedProduction } from '../../../shared/contracts/weeklyMixedContentPlan';

const money = (value: number) => `¥${value.toFixed(2)}`;

export default function WeeklyPlanFlow({ data, draft, showTitle = false }: { data: DigitalEmployeeOverview | null; draft?: GoalDraft | null; showTitle?: boolean }) {
  const [productionPage, setProductionPage] = useState(0);
  const [distributionPage, setDistributionPage] = useState(0);
  const goal = data?.goal || draft;
  const pack = data?.plan?.businessPackage;
  const taskRows = useMemo(() => pack?.tasks || [], [pack]);
  const collectionTasks = taskRows.flatMap(task => task.templateId === 'readiness' ? [task] : task.templateId === 'director' ? [
    { ...task, title: '采集并筛选爆款参考', notes: '核对参考来源、素材可用性与产品匹配度。' },
    { ...task, title: '逐条分析爆款结构', notes: '核验视频逐镜分析或图文视觉与配文分析。' },
    { ...task, title: '编写适配脚本', notes: '将已核验参考转为本周产品的创作脚本。' },
    { ...task, title: '完成镜头分镜', notes: '拆出镜头、素材需求与制作交接。' },
  ] : []);
  const productionTasks = taskRows.filter(task => task.templateId === 'production');
  const referencePlans = useMemo(() => pack?.tasks.find(task => task.templateId === 'production')?.videoPlans
    ?.filter(plan => plan.route === 'clone' && plan.productionRole !== 'platform_adaptation') || [], [pack]);
  const imageReferences = useMemo(() => pack?.mixedContentSlots?.filter(slot => slot.kind === 'image' && slot.productionRole === 'original') || [], [pack]);
  useEffect(() => { setProductionPage(0); setDistributionPage(0); }, [pack?.revision]);
  const productionReferences = [
    ...referencePlans.map((plan, index) => {
      const title = plan.planningEvidence?.referenceTitle || `爆款视频 ${index + 1}`;
      const thumbnail = plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || '';
      return { key: plan.contentId || `video-${index}`, label: `参考视频 ${index + 1}`, title, thumbnail, platform: plan.platform };
    }),
    ...imageReferences.map((slot, index) => ({ key: slot.slotId, label: `参考图文 ${index + 1}`,
      title: slot.referenceTitle || '图文参考待匹配',
      thumbnail: slot.referenceThumbnailUrl || (slot.referenceId
        ? `/api/overseas/videos/${encodeURIComponent(slot.referenceId)}/thumbnail` : ''), platform: slot.platform })),
  ];
  const referencesPerPage = 3;
  const productionPageCount = Math.max(1, Math.ceil(productionReferences.length / referencesPerPage));
  const visibleProductionPage = Math.min(productionPage, productionPageCount - 1);
  const visibleProductionReferences = productionReferences.slice(visibleProductionPage * referencesPerPage, (visibleProductionPage + 1) * referencesPerPage);
  const mixedSlots = pack?.mixedContentSlots || [];
  const originalVideoSlots = mixedSlots.filter(slot => slot.kind === 'video' && slot.productionRole === 'original');
  const distributionRows = weeklyDistributionPreview(pack, goal?.startsAt || '', goal?.endsAt || '');
  const distributionPageCount = Math.max(1, Math.ceil(distributionRows.length / referencesPerPage));
  const visibleDistributionPage = Math.min(distributionPage, distributionPageCount - 1);
  const visibleDistributionRows = distributionRows.slice(visibleDistributionPage * referencesPerPage, (visibleDistributionPage + 1) * referencesPerPage);
  const publicationCount = mixedSlots.length || pack?.operatingContext?.outputs.count || 0;
  const facebookPublications = pack?.mixedContentSlots?.filter(slot => slot.platform === 'facebook').length || 0;
  const linkedinPublications = pack?.mixedContentSlots?.filter(slot => slot.platform === 'linkedin').length || 0;
  // Display-only first-pass estimate. Adaptations reuse originals; retries and
  // unconfirmed paid-media plans are deliberately not presented as actual spend.
  const plannedVideoSeconds = referencePlans.reduce((total, plan) => total + Math.max(0, Number(plan.duration) || 0), 0);
  const estimate = estimateWeeklyMixedProduction(mixedSlots, plannedVideoSeconds && originalVideoSlots.length
    ? { videoGeneratedSeconds: plannedVideoSeconds / originalVideoSlots.length } : {});
  const videoEstimate = estimate.videoOriginals * estimate.unitVideoMinCny;
  const imageEstimate = Math.max(0, estimate.minCny - videoEstimate);
  if (!goal) return <div className="grid min-h-48 place-items-center text-text-muted"><Loader2 className="animate-spin"/></div>;
  return (
    <div className="space-y-5" data-weekly-plan-flow>
        {showTitle && <div className="rounded-xl bg-surface-2 p-4"><h3 className="text-lg font-semibold text-text-primary">{goal.title}</h3></div>}
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
          { key: 'cycle', label: '运行周期', children: `${goal.startsAt} 至 ${goal.endsAt}` },
          { key: 'scope', label: '目标市场', children: goal.scope || '按企业默认市场' },
          { key: 'platforms', label: '运营平台', children: weeklyDistributionPlatforms.map(item => <Tag key={item}>{item === 'facebook' ? 'Facebook' : '领英'}</Tag>) },
          { key: 'outputs', label: '暂定发布计划', children: <span>{publicationCount} 个发布位</span> },
          ...(pack?.mixedContentSlots?.length ? [{ key: 'distribution', label: '平台分配', children: `Facebook ${facebookPublications} 条 · 领英 ${linkedinPublications} 条` }] : []),
        ]}/>
        <section className="grid gap-3 sm:grid-cols-3" aria-label="本周预计成本">
          <div className="rounded-lg border border-border bg-surface-2 p-4"><p className="text-xs text-text-muted">预计视频制作</p><strong className="mt-2 block text-base text-text-primary">{money(videoEstimate)}</strong></div>
          <div className="rounded-lg border border-border bg-surface-2 p-4"><p className="text-xs text-text-muted">预计图文制作</p><strong className="mt-2 block text-base text-text-primary">{money(imageEstimate)}</strong></div>
          <div className="rounded-lg border border-accent bg-surface p-4"><p className="text-xs text-text-muted">预计内容制作合计</p><strong className="mt-2 block text-base text-accent">{money(estimate.minCny)}</strong></div>
        </section>
        <section aria-label="本周任务流程" className="grid items-stretch gap-4 md:grid-cols-3">
          {([
            { title: '采集', tasks: collectionTasks },
            { title: '生产', tasks: productionTasks },
            { title: '分发', tasks: [] },
          ] as const).map((phase, phaseIndex) => <div key={phase.title} className="relative flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface p-3">
            <h3 className="flex min-h-12 items-center justify-center bg-accent/10 px-6 text-sm font-semibold text-accent" style={{ clipPath: phaseIndex === 0 ? 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)' : 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)' }}>{phase.title}</h3>
            <ol className="mt-4 flex-1 space-y-1">
              {phase.tasks.map((task, index) => <li key={`${task.templateId}-${index}`} className="space-y-1"><div className="flex min-h-20 items-start gap-2 rounded-lg border border-border bg-surface-2 p-3"><Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true"/><span className="min-w-0"><strong className="block text-xs font-semibold text-text-primary">{task.title}</strong><span className="mt-1 block text-xs text-text-secondary">{task.notes || '按计划执行并保留回执'}</span></span></div><ArrowDown size={14} className="mx-auto text-text-muted" aria-hidden="true"/></li>)}
              {phase.title === '生产' && visibleProductionReferences.map((reference, index) => <li key={reference.key} className="space-y-1"><div className="flex h-20 items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface-2 p-2"><span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-surface text-text-muted">{reference.thumbnail ? <ThumbnailImage src={reference.thumbnail} platform={reference.platform} title={reference.title} className="h-full w-full object-cover"/> : <Clapperboard size={18} aria-hidden="true"/>}</span><span className="min-w-0 flex-1 overflow-hidden"><span className="block text-xs text-text-muted">{reference.label}</span><strong className="mt-1 block line-clamp-2 break-all text-xs text-text-primary" title={reference.title}>{reference.title}</strong></span></div>{index < visibleProductionReferences.length - 1 && <ArrowDown size={14} className="mx-auto text-text-muted" aria-hidden="true"/>}</li>)}
              {phase.title === '分发' && visibleDistributionRows.map((row, index) => <li key={row.key} className="space-y-1">
                <div className="flex min-h-24 items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
                  <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-surface text-text-muted">
                    {row.thumbnail ? <ThumbnailImage src={row.thumbnail} platform={row.platform} title={row.title} className="h-full w-full object-cover"/> : <span className="grid justify-items-center gap-1 text-center text-[10px]"><Clapperboard size={18} aria-hidden="true"/>缩略图待绑定</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs text-text-muted"><SocialPlatformIcon platform={row.platform} size={15}/>{row.platform === 'linkedin' ? '领英' : socialBrandLabel(row.platform)} · {row.kind === 'video' ? '视频' : '图文'}</span>
                    <strong className="mt-1 block line-clamp-2 break-all text-xs text-text-primary" title={row.title}>{row.title}</strong>
                    <span className="mt-2 block text-xs text-text-secondary">计划发布日期：{row.date || '待排期'}</span>
                  </span>
                </div>
                {index < visibleDistributionRows.length - 1 && <ArrowDown size={14} className="mx-auto text-text-muted" aria-hidden="true"/>}
              </li>)}
            </ol>
            {phase.title === '生产' && productionReferences.length > referencesPerPage && <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-secondary"><span>独立制作 {visibleProductionPage * referencesPerPage + 1}–{Math.min((visibleProductionPage + 1) * referencesPerPage, productionReferences.length)} / {productionReferences.length}</span><div className="flex gap-1"><Button size="small" disabled={visibleProductionPage === 0} onClick={() => setProductionPage(value => Math.max(0, value - 1))}>上一组</Button><Button size="small" disabled={visibleProductionPage >= productionPageCount - 1} onClick={() => setProductionPage(value => Math.min(productionPageCount - 1, value + 1))}>下一组</Button></div></div>}
            {phase.title === '分发' && distributionRows.length > referencesPerPage && <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-secondary"><span>发布位 {visibleDistributionPage * referencesPerPage + 1}–{Math.min((visibleDistributionPage + 1) * referencesPerPage, distributionRows.length)} / {distributionRows.length}</span><div className="flex gap-1"><Button size="small" disabled={visibleDistributionPage === 0} onClick={() => setDistributionPage(value => Math.max(0, value - 1))}>上一组</Button><Button size="small" disabled={visibleDistributionPage >= distributionPageCount - 1} onClick={() => setDistributionPage(value => Math.min(distributionPageCount - 1, value + 1))}>下一组</Button></div></div>}
            {phaseIndex < 2 && <span className="absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 text-accent md:block" aria-hidden="true"><ArrowRight size={17}/></span>}
          </div>)}
        </section>
    </div>
  );
}
