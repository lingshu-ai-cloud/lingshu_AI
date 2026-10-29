import { Alert, Button, Modal } from 'antd';
import { ArrowRight, CalendarRange, Check, Sparkles } from 'lucide-react';
import type { AssistantWeeklyPlanExperience } from './useAssistantWeeklyPlanExperience';
import WeeklyPlanFlow from '../socialContent/WeeklyPlanFlow';

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
  const data = experience.proposal;
  const pack = data?.plan?.businessPackage;
  const referencePlans = pack?.tasks.find(task => task.templateId === 'production')?.videoPlans
    ?.filter(plan => plan.route === 'clone' && plan.productionRole !== 'platform_adaptation') || [];
  const imageReferences = pack?.mixedContentSlots?.filter(slot => slot.kind === 'image' && slot.productionRole === 'original') || [];
  return <>
    <Modal open={experience.modalOpen} onCancel={experience.close} width={820}
      title={<span className="flex items-center gap-2"><CalendarRange size={18} className="text-accent"/>制定本周运营计划</span>}
      footer={[
        ...(experience.referenceMessage ? [<p key="reference-status" role="status" aria-live="polite" className="mb-3 text-left text-sm text-text-secondary">{experience.referenceMessage}</p>] : []),
        <Button key="cancel" onClick={experience.close} disabled={experience.busy}>{experience.weeklyPlanOperating ? '关闭' : '暂不处理'}</Button>,
        <Button key="confirm-plan" type="primary" onClick={() => void experience.confirm()} disabled={experience.busy || !data?.goal || !pack || experience.weeklyPlanOperating || (!experience.factsSyncRequired && (Boolean(experience.referenceGap) || referencePlans.some(plan => !plan.referenceId) || imageReferences.some(slot => !slot.referenceId)))} loading={experience.busy && !experience.collectingReferences} icon={!experience.busy && !experience.weeklyPlanOperating ? <Check size={15}/> : undefined}>{experience.collectingReferences ? '正在采集参考' : experience.weeklyPlanOperating ? experience.weeklyPlanExecutionLabel : experience.factsSyncRequired ? '同步周计划' : '确认周计划并开始运营'}</Button>,
      ]}
      destroyOnHidden mask={{ closable: !experience.busy }}>
      {experience.error && <Alert className="mb-4" type="warning" showIcon title="周计划尚未启动" description={experience.error}/>}
      {experience.notice && <Alert className="mb-4" type="info" showIcon title={experience.factsSyncRequired ? '周计划待同步' : '周计划已更新'} description={experience.notice}/>}
      {experience.referenceGap && <div className="mb-4"><AssistantWeeklyReferenceChoices experience={experience}/></div>}
      <div data-weekly-plan-modal="confirmation"><WeeklyPlanFlow data={data} draft={experience.draft} showTitle/></div>
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
