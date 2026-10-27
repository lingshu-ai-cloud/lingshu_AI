import { useMemo } from 'react';
import { Alert, Button, Descriptions, Modal, Tag } from 'antd';
import { ArrowRight, CalendarRange, Check, Loader2, Sparkles } from 'lucide-react';
import type { AssistantWeeklyPlanExperience } from './useAssistantWeeklyPlanExperience';

export function AssistantWeeklyPlanCard({ experience }: { experience: AssistantWeeklyPlanExperience }) {
  const goal = experience.proposal?.goal;
  if (!goal) return null;
  return <div className="ls-assistant-summary-bubble-enter flex items-start gap-2" data-assistant-bubble="weekly-plan-proposal">
    <button type="button" onClick={experience.open} className="assistant-weekly-plan-card group w-full rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-haspopup="dialog">
      <span className="flex items-start justify-between gap-3"><span><span className="text-xs font-semibold text-accent">本周运营计划</span><strong className="mt-1 block text-sm text-text-primary">{goal.title}</strong></span><ArrowRight size={17} className="mt-1 text-text-muted group-hover:text-accent"/></span>
      <span className="mt-3 grid grid-cols-3 gap-2 text-xs text-text-secondary"><span>{goal.contentPlatforms.length} 个平台</span><span>{goal.videoPlans?.length || 0} 条内容</span><span>{goal.startsAt.slice(5)}—{goal.endsAt.slice(5)}</span></span>
      <span className="mt-3 block text-xs text-text-muted">点击查看完整计划并确认运行</span>
    </button>
  </div>;
}

export function AssistantWeeklyPlanOverlay({ experience, reduceMotion }: { experience: AssistantWeeklyPlanExperience; reduceMotion: boolean }) {
  const data = experience.proposal;
  const goal = data?.goal;
  const pack = data?.plan?.businessPackage;
  const taskRows = useMemo(() => pack?.tasks || [], [pack]);
  return <>
    <Modal open={experience.modalOpen} onCancel={experience.close} width={820} title={<span className="flex items-center gap-2"><CalendarRange size={18} className="text-accent"/>确认本周运营计划</span>}
      footer={[<Button key="cancel" onClick={experience.close} disabled={experience.busy}>{experience.weeklyPlanOperating ? '关闭' : '暂不开始'}</Button>, <Button key="confirm" type="primary" onClick={() => void experience.confirm()} disabled={!goal || !pack || experience.weeklyPlanOperating} loading={experience.busy} icon={!experience.busy ? <Check size={15}/> : undefined}>{experience.weeklyPlanOperating ? '周计划正在运行' : '确认无误，开始运行'}</Button>]}
      destroyOnHidden mask={{ closable: !experience.busy }}>
      {experience.error && <Alert className="mb-4" type="warning" showIcon title="周计划尚未启动" description={experience.error}/>}
      {goal && pack ? <div className="space-y-5" data-weekly-plan-modal="details">
        <div className="rounded-xl bg-surface-2 p-4"><p className="text-xs font-semibold text-accent">计划概览</p><h3 className="mt-1 text-lg font-semibold text-text-primary">{goal.title}</h3><p className="mt-2 text-sm leading-6 text-text-secondary">{goal.objective}</p></div>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
          { key: 'cycle', label: '运行周期', children: `${goal.startsAt} 至 ${goal.endsAt}` },
          { key: 'scope', label: '目标市场', children: goal.scope || '按企业默认市场' },
          { key: 'platforms', label: '运营平台', children: goal.contentPlatforms.map(item => <Tag key={item}>{item}</Tag>) },
          { key: 'outputs', label: '内容安排', children: `${goal.videoPlans?.length || pack.operatingContext?.outputs.count || 0} 条` },
        ]}/>
        <section><h3 className="text-sm font-semibold text-text-primary">本周全部任务</h3><ol className="mt-3 divide-y divide-border rounded-xl border border-border">{taskRows.map((task, index) => <li key={`${task.templateId}-${index}`} className="flex items-start justify-between gap-3 px-4 py-3"><span><strong className="text-sm text-text-primary">{task.title}</strong><span className="mt-1 block text-xs text-text-secondary">{task.notes || '按计划执行并保留可核验回执'}</span></span><Tag>{task.dueAt.slice(5)}</Tag></li>)}</ol></section>
        <Alert type="info" showIcon title={experience.weeklyPlanOperating ? '本周计划已经开始运行，可关闭弹窗继续查看进度。' : '只有点击“确认无误，开始运行”后，数字员工才会正式执行；启动结果以真实运行回执为准。'}/>
      </div> : <div className="grid min-h-48 place-items-center text-text-muted"><Loader2 className="animate-spin"/></div>}
    </Modal>
    {experience.celebrating && <div className={`assistant-weekly-plan-celebration ${reduceMotion ? 'is-reduced' : ''}`} aria-live="polite"><span className="sr-only">周计划已开始运行</span>{!reduceMotion && Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties}/>) }<div className="assistant-weekly-plan-collapse"><Sparkles size={18}/>周计划已开始运行</div></div>}
  </>;
}
