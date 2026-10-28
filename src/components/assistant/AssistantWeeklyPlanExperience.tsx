import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Tag } from 'antd';
import { ArrowDown, ArrowRight, CalendarRange, Check, Clapperboard, Loader2, Sparkles } from 'lucide-react';
import type { AssistantWeeklyPlanExperience } from './useAssistantWeeklyPlanExperience';
import { ThumbnailImage } from '../inspiration/InspirationMedia';
import { SocialPlatformIcon, socialBrandLabel } from '../SocialPlatformIcon';
import { balancedWeeklyPublishSlots } from '../../../shared/contracts/weeklyPublishSchedule';
import { estimateWeeklyMixedProduction } from '../../../shared/contracts/weeklyMixedContentPlan';

const money = (value: number) => `¥${value.toFixed(2)}`;

export function AssistantWeeklyPlanCard({ experience }: { experience: AssistantWeeklyPlanExperience }) {
  const goal = experience.proposal?.goal;
  if (!goal) return null;
  return <div className="ls-assistant-summary-bubble-enter flex items-start gap-2" data-assistant-bubble="weekly-plan-proposal">
    <button type="button" onClick={experience.open} className="assistant-weekly-plan-card group w-full rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-haspopup="dialog">
      <span className="flex items-start justify-between gap-3"><span><span className="text-xs font-semibold text-accent">本周运营计划</span><strong className="mt-1 block text-sm text-text-primary">{goal.title}</strong></span><ArrowRight size={17} className="mt-1 text-text-muted group-hover:text-accent"/></span>
      <span className="mt-3 grid grid-cols-3 gap-2 text-xs text-text-secondary"><span>{goal.contentPlatforms.length} 个平台</span><span>{experience.proposal?.plan?.businessPackage?.mixedContentSlots?.length || goal.videoPlans?.length || 0} 个发布位</span><span>{goal.startsAt.slice(5)}—{goal.endsAt.slice(5)}</span></span>
      <span className="mt-3 block text-xs text-text-muted">点击查看完整计划与预算确认状态</span>
    </button>
  </div>;
}

export function AssistantWeeklyObjectiveChoices({ experience, busy, onSelect, onCustom }: {
  experience: AssistantWeeklyPlanExperience;
  busy: boolean;
  onSelect: (value: string, label: string) => void;
  onCustom: () => void;
}) {
  if (!experience.objectiveChoices.length) return null;
  return <div className="ls-assistant-bubble-enter grid gap-2 pl-7" role="group" aria-label="选择本周经营目标" data-assistant-weekly-objective-choices>
    {experience.objectiveChoices.map((choice, index) => <Button key={choice.value}
      type={choice.recommended ? 'primary' : 'default'} block disabled={busy}
      className="!h-auto min-h-11 !justify-start whitespace-normal !px-3 !py-2.5 !text-left"
      aria-label={`${choice.recommended ? '推荐目标' : `目标 ${index + 1}`}：${choice.label}`}
      onClick={() => onSelect(choice.value, choice.label)}>
      <span className="flex w-full items-start gap-2"><span className="shrink-0 font-semibold">{choice.recommended ? '推荐' : index + 1}</span><span className="min-w-0 leading-5">{choice.label}</span></span>
    </Button>)}
    <Button block disabled={busy} className="min-h-11" onClick={onCustom}>自定义目标</Button>
  </div>;
}

export function AssistantWeeklyReferenceChoices({ experience }: { experience: AssistantWeeklyPlanExperience }) {
  const gap = experience.referenceGap;
  if (!gap) return null;
  return <section className="ls-assistant-bubble-enter ml-7 space-y-3 rounded-xl border border-border bg-surface p-4 text-sm text-text-primary" aria-label="周任务缺少爆款参考" role="status">
    <Alert type="warning" showIcon title={`还缺 ${gap.videoMissingCount} 条爆款视频、${gap.imageMissingCount} 条爆款图文参考`} description={`本周需要 ${gap.requiredCount} 条独立参考；缺口补齐前不会启动生产。`}/>
    <p className="text-text-secondary">视频需完成逐镜分析，图文需完成图片与配文分析，才能绑定到计划。</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={experience.busy} onClick={() => experience.openReferenceLibrary('inspiration')}>手动录入爆款参考</Button>
      <Button type="primary" loading={experience.busy} onClick={() => void experience.collectReferencesNow()}>立即采集一批</Button>
      <Button disabled={experience.busy} onClick={() => void experience.retryReferenceCheck()}>重新匹配并核验</Button>
    </div>
    {experience.referenceMessage && <Alert type="info" showIcon title={experience.referenceMessage} />}
  </section>;
}

export function AssistantWeeklyPlanOverlay({ experience, reduceMotion }: { experience: AssistantWeeklyPlanExperience; reduceMotion: boolean }) {
  const [productionPage, setProductionPage] = useState(0);
  const [distributionPage, setDistributionPage] = useState(0);
  const data = experience.proposal;
  const goal = data?.goal || experience.draft;
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
  const planBySlotId = new Map(originalVideoSlots.map((slot, index) => [slot.slotId, referencePlans[index]] as const));
  const recommendedSlots = balancedWeeklyPublishSlots(goal?.startsAt || '', goal?.endsAt || '', mixedSlots.map(slot => `${slot.platform}:${slot.accountId}`));
  const distributionRows = mixedSlots.map((slot, index) => {
    const source = mixedSlots.find(item => item.slotId === slot.originalSlotId) || slot;
    const plan = source.kind === 'video' ? planBySlotId.get(source.slotId) : undefined;
    const title = source.kind === 'video' ? plan?.planningEvidence?.referenceTitle || '参考视频待核验' : source.referenceTitle || '参考图文待核验';
    const plannedAt = slot.productionRole === 'original' && source.kind === 'video'
      ? plan?.plannedPublishAt || plan?.plannedPublishDate || '' : '';
    const suggestion = plannedAt || recommendedSlots[index]?.scheduledAt || '';
    const time = /^\d{4}-\d{2}-\d{2}$/.test(suggestion) ? `${suggestion.slice(5)} · 时刻待定`
      : suggestion ? `${suggestion.slice(5, 10)} ${suggestion.slice(11, 16)} 北京时间` : '发布时间待排期';
    const sourceOrdinal = source.kind === 'video'
      ? originalVideoSlots.findIndex(item => item.slotId === source.slotId) + 1
      : imageReferences.findIndex(item => item.slotId === source.slotId) + 1;
    return { key: slot.slotId, kind: source.kind, platform: slot.platform, title, time,
      sourceLabel: `参考${source.kind === 'video' ? '视频' : '图文'} ${sourceOrdinal > 0 ? sourceOrdinal : '待核验'}`,
      reused: slot.productionRole === 'adaptation' };
  });
  const distributionPageCount = Math.max(1, Math.ceil(distributionRows.length / referencesPerPage));
  const visibleDistributionPage = Math.min(distributionPage, distributionPageCount - 1);
  const visibleDistributionRows = distributionRows.slice(visibleDistributionPage * referencesPerPage, (visibleDistributionPage + 1) * referencesPerPage);
  const publicationCount = mixedSlots.length || pack?.operatingContext?.outputs.count || 0;
  const adaptationCount = mixedSlots.filter(slot => slot.productionRole === 'adaptation').length;
  const facebookPublications = pack?.mixedContentSlots?.filter(slot => slot.platform === 'facebook').length || 0;
  const linkedinPublications = pack?.mixedContentSlots?.filter(slot => slot.platform === 'linkedin').length || 0;
  // Display-only first-pass estimate. Adaptations reuse originals; retries and
  // unconfirmed paid-media plans are deliberately not presented as actual spend.
  const plannedVideoSeconds = referencePlans.reduce((total, plan) => total + Math.max(0, Number(plan.duration) || 0), 0);
  const estimate = estimateWeeklyMixedProduction(mixedSlots, plannedVideoSeconds && originalVideoSlots.length
    ? { videoGeneratedSeconds: plannedVideoSeconds / originalVideoSlots.length } : {});
  const videoEstimate = estimate.videoOriginals * estimate.unitVideoMinCny;
  const imageEstimate = Math.max(0, estimate.minCny - videoEstimate);
  return <>
    <Modal open={experience.modalOpen} onCancel={experience.close} width={820}
      title={<span className="flex items-center gap-2"><CalendarRange size={18} className="text-accent"/>制定本周运营计划</span>}
      footer={[
        <Button key="cancel" onClick={experience.close} disabled={experience.busy}>{experience.weeklyPlanOperating ? '关闭' : '暂不处理'}</Button>,
        <Button key="confirm-plan" type="primary" onClick={() => void experience.confirm()} disabled={!data?.goal || !pack || experience.weeklyPlanOperating || (!experience.factsSyncRequired && (Boolean(experience.referenceGap) || referencePlans.some(plan => !plan.referenceId) || imageReferences.some(slot => !slot.referenceId)))} loading={experience.busy} icon={!experience.busy ? <Check size={15}/> : undefined}>{experience.weeklyPlanOperating ? '周计划正在运行' : experience.factsSyncRequired ? '同步周计划' : '确认周计划并开始运营'}</Button>,
      ]}
      destroyOnHidden mask={{ closable: !experience.busy }}>
      {experience.error && <Alert className="mb-4" type="warning" showIcon title="周计划尚未启动" description={experience.error}/>}
      {experience.notice && <Alert className="mb-4" type="info" showIcon title={experience.factsSyncRequired ? '周计划待同步' : '周计划已更新'} description={experience.notice}/>}
      {experience.referenceGap && <div className="mb-4"><AssistantWeeklyReferenceChoices experience={experience}/></div>}
      {goal ? <div className="space-y-5" data-weekly-plan-modal="confirmation">
        <div className="rounded-xl bg-surface-2 p-4"><h3 className="text-lg font-semibold text-text-primary">{goal.title}</h3></div>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
          { key: 'cycle', label: '运行周期', children: `${goal.startsAt} 至 ${goal.endsAt}` },
          { key: 'scope', label: '目标市场', children: goal.scope || '按企业默认市场' },
          { key: 'platforms', label: '运营平台', children: goal.contentPlatforms.map(item => <Tag key={item}>{item}</Tag>) },
          { key: 'outputs', label: '暂定发布计划', children: <span>{publicationCount} 个发布位<span className="block text-xs text-text-muted">独立制作 {estimate.videoOriginals + estimate.imageOriginals} 条（视频 {estimate.videoOriginals}、图文 {estimate.imageOriginals}）；跨平台复用 {adaptationCount} 条</span></span> },
          ...(pack?.mixedContentSlots?.length ? [{ key: 'distribution', label: '平台分配', children: `Facebook ${facebookPublications} 条 · LinkedIn ${linkedinPublications} 条` }] : []),
        ]}/>
        <section className="grid gap-3 sm:grid-cols-3" aria-label="本周预计成本">
          <div className="rounded-lg border border-border bg-surface-2 p-4"><p className="text-xs text-text-muted">预计视频制作</p><strong className="mt-2 block text-base text-text-primary">{money(videoEstimate)}</strong><span className="mt-1 block text-xs text-text-muted">{estimate.videoOriginals} 条独立视频，按计划时长与低价模式首轮生成估算</span></div>
          <div className="rounded-lg border border-border bg-surface-2 p-4"><p className="text-xs text-text-muted">预计图文制作</p><strong className="mt-2 block text-base text-text-primary">{money(imageEstimate)}</strong><span className="mt-1 block text-xs text-text-muted">{estimate.imageOriginals} 条独立图文；平台适配不重复生成</span></div>
          <div className="rounded-lg border border-accent bg-surface p-4"><p className="text-xs text-text-muted">预计内容制作合计</p><strong className="mt-2 block text-base text-accent">{money(estimate.minCny)}</strong><span className="mt-1 block text-xs text-text-muted">仅供参考，不是实付金额或生产门槛</span></div>
        </section>
        <section aria-label="本周任务流程" className="grid items-stretch gap-4 md:grid-cols-3">
          {([
            { title: '采集', tasks: collectionTasks },
            { title: '生产', tasks: productionTasks },
            { title: '分发', tasks: [] },
          ] as const).map((phase, phaseIndex) => <div key={phase.title} className="relative flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface p-3">
            <h3 className="flex min-h-12 items-center justify-center bg-accent/10 px-6 text-sm font-semibold text-accent" style={{ clipPath: phaseIndex === 0 ? 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)' : 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)' }}>{phase.title}</h3>
            {phase.title === '生产' && <p className="mt-3 text-xs text-text-secondary">共 {productionReferences.length} 条独立制作；每页显示最多 {referencesPerPage} 条，翻页可查看全部。</p>}
            <ol className="mt-4 flex-1 space-y-1">
              {phase.tasks.map((task, index) => <li key={`${task.templateId}-${index}`} className="space-y-1"><div className="flex min-h-20 items-start gap-2 rounded-lg border border-border bg-surface-2 p-3"><Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true"/><span className="min-w-0"><strong className="block text-xs font-semibold text-text-primary">{task.title}</strong><span className="mt-1 block text-xs text-text-secondary">{task.notes || '按计划执行并保留回执'}</span></span></div><ArrowDown size={14} className="mx-auto text-text-muted" aria-hidden="true"/></li>)}
              {phase.title === '生产' && visibleProductionReferences.map((reference, index) => <li key={reference.key} className="space-y-1"><div className="flex h-20 items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface-2 p-2"><span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-surface text-text-muted">{reference.thumbnail ? <ThumbnailImage src={reference.thumbnail} platform={reference.platform} title={reference.title} className="h-full w-full object-cover"/> : <Clapperboard size={18} aria-hidden="true"/>}</span><span className="min-w-0 flex-1 overflow-hidden"><span className="block text-xs text-text-muted">{reference.label}</span><strong className="mt-1 block line-clamp-2 break-all text-xs text-text-primary" title={reference.title}>{reference.title}</strong></span></div>{index < visibleProductionReferences.length - 1 && <ArrowDown size={14} className="mx-auto text-text-muted" aria-hidden="true"/>}</li>)}
              {phase.title === '分发' && visibleDistributionRows.map((row, index) => <li key={row.key} className="space-y-1"><div className="min-h-20 rounded-lg border border-border bg-surface-2 p-3" title={row.title}><span className="flex items-center gap-2 text-xs font-semibold text-text-primary"><SocialPlatformIcon platform={row.platform} size={17}/>计划发往 {socialBrandLabel(row.platform)} · {row.kind === 'video' ? '视频' : '图文'}{row.reused ? '适配' : ''}</span><span className="mt-2 block text-xs text-text-muted">来源{row.sourceLabel}</span><span className="mt-1 block text-xs text-text-secondary">推荐 {row.time}</span></div>{index < visibleDistributionRows.length - 1 && <ArrowDown size={14} className="mx-auto text-text-muted" aria-hidden="true"/>}</li>)}
            </ol>
            {phase.title === '生产' && productionReferences.length > referencesPerPage && <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-secondary"><span>独立制作 {visibleProductionPage * referencesPerPage + 1}–{Math.min((visibleProductionPage + 1) * referencesPerPage, productionReferences.length)} / {productionReferences.length}</span><div className="flex gap-1"><Button size="small" disabled={visibleProductionPage === 0} onClick={() => setProductionPage(value => Math.max(0, value - 1))}>上一组</Button><Button size="small" disabled={visibleProductionPage >= productionPageCount - 1} onClick={() => setProductionPage(value => Math.min(productionPageCount - 1, value + 1))}>下一组</Button></div></div>}
            {phase.title === '分发' && distributionRows.length > referencesPerPage && <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-secondary"><span>发布位 {visibleDistributionPage * referencesPerPage + 1}–{Math.min((visibleDistributionPage + 1) * referencesPerPage, distributionRows.length)} / {distributionRows.length}</span><div className="flex gap-1"><Button size="small" disabled={visibleDistributionPage === 0} onClick={() => setDistributionPage(value => Math.max(0, value - 1))}>上一组</Button><Button size="small" disabled={visibleDistributionPage >= distributionPageCount - 1} onClick={() => setDistributionPage(value => Math.min(distributionPageCount - 1, value + 1))}>下一组</Button></div></div>}
            {phaseIndex < 2 && <span className="absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 text-accent md:block" aria-hidden="true"><ArrowRight size={17}/></span>}
          </div>)}
        </section>
      </div> : <div className="grid min-h-48 place-items-center text-text-muted"><Loader2 className="animate-spin"/></div>}
    </Modal>
    <Modal open={experience.overBudgetConfirmationOpen} onCancel={experience.cancelOverBudgetConfirmation}
      title="确认超预算制作" okText="仍要继续生产" okButtonProps={{ loading: experience.busy }}
      cancelText="暂不生产" cancelButtonProps={{ disabled: experience.busy }}
      onOk={() => void experience.confirm()} mask={{ closable: false }} closable={!experience.busy}>
      <p className="text-sm leading-6 text-text-primary">{experience.overBudgetConfirmationCount} 条成片的最高费用预留超过 ¥0.70/秒。该预留包含逐镜生成及重做额度，不是实际扣费；若继续，实际费用以供应商回执为准。</p>
    </Modal>
    {experience.celebrating && <div className={`assistant-weekly-plan-celebration ${reduceMotion ? 'is-reduced' : ''}`} aria-live="polite"><span className="sr-only">周计划已开始运行</span>{!reduceMotion && Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties}/>) }<div className="assistant-weekly-plan-collapse"><Sparkles size={18}/>周计划已开始运行</div></div>}
  </>;
}
