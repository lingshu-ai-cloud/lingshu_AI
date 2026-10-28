import { useMemo } from 'react';
import { Alert, Button, Descriptions, Modal, Steps, Tag } from 'antd';
import { ArrowRight, CalendarRange, Check, Loader2, Sparkles } from 'lucide-react';
import type { AssistantWeeklyPlanExperience } from './useAssistantWeeklyPlanExperience';

const money = (value: number) => `¥${value.toFixed(2)}`;

export function AssistantWeeklyPlanCard({ experience }: { experience: AssistantWeeklyPlanExperience }) {
  const goal = experience.proposal?.goal;
  if (!goal) return null;
  return <div className="ls-assistant-summary-bubble-enter flex items-start gap-2" data-assistant-bubble="weekly-plan-proposal">
    <button type="button" onClick={experience.open} className="assistant-weekly-plan-card group w-full rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-haspopup="dialog">
      <span className="flex items-start justify-between gap-3"><span><span className="text-xs font-semibold text-accent">本周运营计划</span><strong className="mt-1 block text-sm text-text-primary">{goal.title}</strong></span><ArrowRight size={17} className="mt-1 text-text-muted group-hover:text-accent"/></span>
      <span className="mt-3 grid grid-cols-3 gap-2 text-xs text-text-secondary"><span>{goal.contentPlatforms.length} 个平台</span><span>{goal.videoPlans?.length || 0} 条内容</span><span>{goal.startsAt.slice(5)}—{goal.endsAt.slice(5)}</span></span>
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
    <Alert type="warning" showIcon title={`还缺 ${gap.missingCount} 条爆款视频`} description={`本周需要 ${gap.requiredCount} 条独立、可用于制作的参考。周任务尚未确立，也未开始生产。`}/>
    <p className="text-text-secondary">导入或采集后，视频仍需完成逐镜分析与复核，才能绑定到计划。</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={experience.busy} onClick={() => experience.openReferenceLibrary('inspiration')}>手动录入爆款视频</Button>
      <Button type="primary" loading={experience.busy} onClick={() => void experience.collectReferencesNow()}>立即采集一批</Button>
      <Button disabled={experience.busy} onClick={() => void experience.retryReferenceCheck()}>重新核验周计划</Button>
    </div>
    {experience.referenceMessage && <Alert type="info" showIcon title={experience.referenceMessage} />}
  </section>;
}

export function AssistantWeeklyPlanOverlay({ experience, reduceMotion }: { experience: AssistantWeeklyPlanExperience; reduceMotion: boolean }) {
  const data = experience.proposal;
  const goal = data?.goal || experience.draft;
  const pack = data?.plan?.businessPackage;
  const taskRows = useMemo(() => pack?.tasks || [], [pack]);
  const videoPlans = goal?.videoPlans || [];
  const budget = pack?.operatingContext?.budget;
  const productionMin = Number(budget?.productionMinCny ?? pack?.directorPlan?.productionBudgetMin ?? 0);
  const productionMax = Number(budget?.productionMaxCny ?? pack?.directorPlan?.productionBudgetMax ?? pack?.directorPlan?.productionBudget ?? 0);
  const paidMedia = Number(budget?.paidMediaCny || 0);
  const totalMin = Number(budget?.totalMinCny ?? productionMin + paidMedia);
  const totalMax = Number(budget?.totalMaxCny ?? productionMax + paidMedia);
  const isBudget = experience.stage === 'budget';
  return <>
    <Modal open={experience.modalOpen} onCancel={experience.close} width={820}
      title={<span className="flex items-center gap-2"><CalendarRange size={18} className="text-accent"/>制定本周运营计划</span>}
      footer={[
        <Button key="cancel" onClick={experience.close} disabled={experience.busy}>{experience.weeklyPlanOperating ? '关闭' : '暂不处理'}</Button>,
        isBudget
          ? <Button key="confirm-budget" type="primary" onClick={() => void experience.confirm()} disabled={!data?.goal || !pack || experience.weeklyPlanOperating} loading={experience.busy} icon={!experience.busy ? <Check size={15}/> : undefined}>{experience.weeklyPlanOperating ? '周计划正在运行' : '确认预算并开始运营'}</Button>
          : <Button key="confirm-plan" type="primary" onClick={() => void experience.confirmPlan()} disabled={!experience.draft} loading={experience.busy} icon={!experience.busy ? <ArrowRight size={15}/> : undefined}>确认方案，查看预算</Button>,
      ]}
      destroyOnHidden mask={{ closable: !experience.busy }}>
      <Steps className="mb-5" current={isBudget ? 1 : 0} responsive={false} items={[{ title: '确认执行方案' }, { title: '确认预算并启动' }]}/>
      {experience.error && <Alert className="mb-4" type="warning" showIcon title={isBudget ? '周计划尚未启动' : '方案尚未保存'} description={experience.error}/>}
      {goal ? <div className="space-y-5" data-weekly-plan-modal={isBudget ? 'budget' : 'plan'}>
        <div className="rounded-xl bg-surface-2 p-4"><p className="text-xs font-semibold text-accent">{isBudget ? '已确认方案' : '计划草案'}</p><h3 className="mt-1 text-lg font-semibold text-text-primary">{goal.title}</h3><p className="mt-2 text-sm leading-6 text-text-secondary">{goal.objective}</p></div>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
          { key: 'cycle', label: '运行周期', children: `${goal.startsAt} 至 ${goal.endsAt}` },
          { key: 'scope', label: '目标市场', children: goal.scope || '按企业默认市场' },
          { key: 'platforms', label: '运营平台', children: goal.contentPlatforms.map(item => <Tag key={item}>{item}</Tag>) },
          { key: 'outputs', label: '内容安排', children: `${videoPlans.length || pack?.operatingContext?.outputs.count || 0} 条` },
        ]}/>
        {!isBudget && <section><h3 className="text-sm font-semibold text-text-primary">本周内容方向</h3><ol className="mt-3 divide-y divide-border rounded-xl border border-border">{videoPlans.map((plan, index) => <li key={plan.contentId || `${plan.platform}-${index}`} className="flex items-start justify-between gap-3 px-4 py-3"><span><strong className="text-sm text-text-primary">{plan.theme}</strong><span className="mt-1 block text-xs text-text-secondary">{plan.productName || '按企业产品资料'} · {plan.duration} 秒</span></span><Tag>{plan.platform}</Tag></li>)}</ol></section>}
        {isBudget && <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="预算二次确认">
            <div className="rounded-lg border border-border bg-surface-2 p-4"><p className="text-xs text-text-muted">内容制作</p><strong className="mt-2 block text-base text-text-primary">{money(productionMin)}–{money(productionMax)}</strong></div>
            <div className="rounded-lg border border-border bg-surface-2 p-4"><p className="text-xs text-text-muted">投流计划</p><strong className="mt-2 block text-base text-text-primary">{money(paidMedia)}</strong></div>
            <div className="rounded-lg border border-accent bg-surface p-4"><p className="text-xs text-text-muted">合计预算范围</p><strong className="mt-2 block text-base text-accent">{money(totalMin)}–{money(totalMax)}</strong></div>
          </section>
          <section><h3 className="text-sm font-semibold text-text-primary">本周全部任务</h3><ol className="mt-3 divide-y divide-border rounded-xl border border-border">{taskRows.map((task, index) => <li key={`${task.templateId}-${index}`} className="flex items-start justify-between gap-3 px-4 py-3"><span><strong className="text-sm text-text-primary">{task.title}</strong><span className="mt-1 block text-xs text-text-secondary">{task.notes || '按计划执行并保留可核验回执'}</span></span><Tag>{task.dueAt.slice(5)}</Tag></li>)}</ol></section>
        </>}
        <Alert type="info" showIcon title={experience.weeklyPlanOperating ? '本周计划已经开始运行，可关闭弹窗继续查看进度。' : isBudget ? '只有点击“确认预算并开始运营”后，数字员工才会正式执行。' : '这一步只确认方案；确认后才会生成并展示预算，不会启动任务。'}/>
      </div> : <div className="grid min-h-48 place-items-center text-text-muted"><Loader2 className="animate-spin"/></div>}
    </Modal>
    {experience.celebrating && <div className={`assistant-weekly-plan-celebration ${reduceMotion ? 'is-reduced' : ''}`} aria-live="polite"><span className="sr-only">周计划已开始运行</span>{!reduceMotion && Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties}/>) }<div className="assistant-weekly-plan-collapse"><Sparkles size={18}/>周计划已开始运行</div></div>}
  </>;
}
