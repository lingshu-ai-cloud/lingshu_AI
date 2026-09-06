import { Fragment } from 'react';
import { FileText, Settings2 } from 'lucide-react';
import type { DigitalEmployeeOverview, DigitalEmployeeDeepLink } from '../lib/digitalEmployees';
import type { PackageTask } from '../lib/weeklyPackage';
import { calendarDay, dayLabel, evidenceDay, ganttDays, ganttRecordRange, ganttSpan } from '../lib/weeklyGantt';
import { groupedWeeklyExecutionNodes, nodeDeepLink, nodeState } from './WeeklyExecutionNodes';

export default function WeeklyPackageGantt({ data, onOpen, onDetails, onConfigure }: {
  data: DigitalEmployeeOverview;
  onOpen: (link: DigitalEmployeeDeepLink) => void;
  onDetails: (taskId: string) => void;
  onConfigure: (task: PackageTask) => void;
}) {
  const days = ganttDays(data.goal?.startsAt, data.goal?.endsAt);
  const groups = groupedWeeklyExecutionNodes(data);
  const allNodes = groups.flatMap(group => group.nodes);
  const today = evidenceDay(new Date().toISOString());
  if (!days.length) return <p className="border-y border-border py-6 text-center text-sm text-text-muted">请先设置有效的经营周期，再查看甘特图。</p>;
  const rowGrid = { gridTemplateColumns: '280px minmax(0, 1fr)' };
  const dayGrid = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  return <div>
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-5 rounded-sm border border-dashed border-text-muted"/>计划窗口</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-5 rounded-sm bg-accent"/>执行记录</span><span className="ml-auto">按天 · 北京时间</span></div>
    <div role="region" aria-label="经营包甘特图" tabIndex={0} className="max-h-[760px] overflow-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25">
      <div style={{ minWidth: Math.max(760, 280 + days.length * 64) }}>
        <div className="sticky top-0 z-30 grid border-b border-border bg-white" style={rowGrid}>
          <div className="sticky left-0 z-10 flex items-center border-r border-border bg-white px-3 text-xs font-semibold text-text-secondary">任务节点</div>
          <div className="grid" style={dayGrid}>{days.map(day => <div key={day} className={`border-r border-border py-2 text-center text-xs last:border-0 ${day === today ? 'bg-[#eff7f1] font-semibold text-accent' : 'text-text-secondary'}`}><div>{dayLabel(day).slice(5).replace('-', '/')}</div><div className="mt-0.5 text-[10px]">{day === today ? '今天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(day * 86400000).getUTCDay()]}</div></div>)}</div>
        </div>
        {groups.map(group => {
          const configs = [...new Map(group.nodes.flatMap(node => node.packageTask ? [[node.packageTask.templateId, node.packageTask] as const] : [])).values()];
          return <Fragment key={group.id}>
            <div className="grid border-b border-border bg-surface-2" style={rowGrid}>
              <h3 className="sticky left-0 z-20 bg-surface-2 px-3 py-1.5 text-xs font-bold text-text-primary">{group.title}<span className="ml-2 font-normal text-text-muted">{group.nodes.filter(node => node.runtime?.status === 'succeeded').length}/{group.nodes.length}</span></h3>
              <div className="flex items-center justify-end gap-3 pr-3">{configs.map(task => <button key={task.templateId} type="button" onClick={() => onConfigure(task)} title={`配置${task.title}`} aria-label={`配置${task.title}`} className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent"><Settings2 size={11}/>{configs.length > 1 ? task.title : '配置'}</button>)}</div>
            </div>
            {group.nodes.map(({ key, planned, runtime, packageTask, number }) => {
              const title = runtime?.title || planned?.title || key;
              const state = nodeState(runtime);
              const link = nodeDeepLink(planned, runtime, data.run?.id || '');
              const due = calendarDay(packageTask?.dueAt) ?? days[days.length - 1];
              const plan = ganttSpan(days[0], due, days);
              const record = ganttRecordRange(runtime, data.events || []);
              const actual = record && ganttSpan(record.start, record.end, days);
              const dependencies = (runtime?.depends_on || planned?.dependsOn || []).map(id => allNodes.find(node => node.key === id || node.runtime?.id === id)).filter(Boolean).map(node => node!.runtime?.title || node!.planned?.title);
              const evidence = record ? `${record.label}：${dayLabel(record.start)}${record.start === record.end ? '' : ` 至 ${dayLabel(record.end)}`}${actual ? '' : '（周期外）'}` : '暂无执行时间记录';
              const tooltip = `${title} · ${state.label}\n计划窗口：${data.goal?.startsAt} 至 ${dayLabel(due)}\n${evidence}${dependencies.length ? `\n前置：${dependencies.join('、')}` : ''}`;
              const color = runtime?.status === 'succeeded' ? 'bg-accent' : runtime?.status === 'failed' || (runtime?.output?.waitState as {requiresAttention?: boolean} | undefined)?.requiresAttention ? 'bg-red' : runtime?.status === 'running' ? 'bg-[#4ea77a]' : runtime?.status === 'waiting_approval' ? 'bg-amber' : 'bg-text-muted';
              return <div key={key} data-node-key={key} className="group grid border-b border-border last:border-0 hover:bg-surface-2/50" style={rowGrid}>
                <div className="sticky left-0 z-20 flex items-center border-r border-border bg-white pl-3 pr-2">
                  <button type="button" onClick={() => onOpen(link)} title={tooltip} aria-label={`${number}. ${title}，打开业务页面`} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"><span className="text-text-muted">{String(number).padStart(2, '0')}</span><span className="truncate font-medium text-text-primary">{title}</span></button>
                  {runtime && <button type="button" onClick={() => onDetails(runtime.id)} title="执行详情" aria-label={`执行详情：${title}`} className="ml-1 shrink-0 rounded-sm p-1 text-text-muted hover:text-accent"><FileText size={13}/></button>}
                </div>
                <div className="relative min-h-10">
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid" style={dayGrid}>{days.map(day => <div key={day} className={`border-r border-border last:border-0 ${day === today ? 'bg-[#eff7f1]/60' : ''}`}/>)}</div>
                  {plan && <button type="button" onClick={() => onOpen(link)} aria-label={`计划窗口：${title}`} title={tooltip} style={{ left: `${plan.left}%`, width: `${plan.width}%` }} className="absolute inset-y-2 rounded-sm border border-dashed border-border-bright bg-surface-2/60 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"><span className="absolute inset-x-2 top-0.5 truncate text-[10px] text-text-secondary">{state.label}</span></button>}
                  {actual && <button type="button" onClick={() => onOpen(link)} aria-label={`执行记录：${title}`} title={tooltip} style={{ left: `${actual.left}%`, width: `${actual.width}%` }} className={`absolute bottom-2 h-1.5 rounded-sm ${color} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25`}/>}
                  {!plan && <span className="absolute left-2 top-3 text-[10px] text-text-muted">截止时间在周期外</span>}
                </div>
              </div>;
            })}
          </Fragment>;
        })}
      </div>
    </div>
  </div>;
}
