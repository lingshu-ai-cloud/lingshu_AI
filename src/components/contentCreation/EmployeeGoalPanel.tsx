import { Button, Empty, Tag } from 'antd';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { weeklyWorkStatus } from '../../lib/weeklyWorkStatus';

export default function EmployeeGoalPanel({ data, onOpenExecution, onPlan }: {
  data: DigitalEmployeeOverview | null;
  onOpenExecution: () => void;
  onPlan: () => void;
}) {
  const goal = data?.goal;
  const status = data ? weeklyWorkStatus(data) : null;
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' }) : '日期待确认';
  };
  return <section aria-label="本周内容目标" className="rounded-2xl border border-border bg-white p-5 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-text-primary">本周内容目标</h3>
      {goal && <Tag color={status?.phase === 'blocked' ? 'warning' : status?.phase === 'running' ? 'processing' : undefined}>{status?.title || '状态待同步'}</Tag>}
    </header>
    {goal ? <div className="mt-5 space-y-3">
      <p className="flex items-center gap-2 text-sm text-text-secondary"><CalendarDays size={15}/>{date(goal.startsAt)} — {date(goal.endsAt)} · 北京时间</p>
      <h4 className="text-xl font-semibold text-text-primary">{goal.title}</h4>
      <p className="whitespace-pre-wrap text-sm leading-6 text-text-secondary">{goal.objective || '目标说明待完善'}</p>
      {Number.isFinite(goal.target) && goal.metric && <p className="text-sm text-text-primary">{goal.metric === 'approved_content_packages' ? '本周计划成片' : /^[a-z_]+$/.test(goal.metric) ? '本周目标' : goal.metric}：{goal.target.toLocaleString('zh-CN')}{goal.unit}</p>}
      <p className="whitespace-pre-wrap text-sm leading-6 text-text-secondary">{data?.plan?.strategy || '周目标已记录，内容计划尚未生成。'}</p>
      {goal.contentPlatforms.length > 0 && <div className="flex flex-wrap gap-2" aria-label="目标平台">{goal.contentPlatforms.map(platform => <Tag key={platform}>{platform}</Tag>)}</div>}
    </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有本周内容目标，在下方告诉灵小枢你希望完成什么。"/>}
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-xs leading-5 text-text-muted">{goal ? '按周计划自动推进；需要你确认或补充的事项会显示在对应视频中。' : '制定目标后，可在这里查看计划与执行情况。'}</p>
      {goal ? <Button className="ml-auto" type="primary" icon={<ArrowRight size={15}/>} onClick={onOpenExecution}>查看数字员工执行现场</Button>
        : <Button className="ml-auto" type="primary" onClick={onPlan}>制定本周内容目标</Button>}
    </footer>
  </section>;
}
