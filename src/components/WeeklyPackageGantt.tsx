import { Button, Select } from 'antd';
import { useState } from 'react';
import type { DigitalEmployeeOverview, DigitalEmployeeDeepLink } from '../lib/digitalEmployees';
import type { PackageTask } from '../lib/weeklyPackage';
import { calendarDay, dayLabel, ganttDays, ganttRecordRange } from '../lib/weeklyGantt';
import { groupedWeeklyExecutionNodes, nodeDeepLink, nodeState } from './WeeklyExecutionNodes';
import { LsCalendar, type LsCalendarEvent } from './ui/LsCalendar';

const agentLabels = { orchestrator: '经营 Agent', business: '经营 Agent', director: '编导 Agent', content: '内容 Agent', customer: '客服 Agent' };

export default function WeeklyPackageGantt({ data, onOpen, onDetails, onConfigure }: {
  data: DigitalEmployeeOverview;
  onOpen: (link: DigitalEmployeeDeepLink) => void;
  onDetails: (taskId: string) => void;
  onConfigure: (task: PackageTask) => void;
}) {
  const [groupId, setGroupId] = useState('all');
  const days = ganttDays(data.goal?.startsAt, data.goal?.endsAt);
  const groups = groupedWeeklyExecutionNodes(data);
  const allNodes = groups.flatMap(group => group.nodes);
  if (!days.length) return <p className="border-y border-border py-6 text-center text-sm text-text-muted">请先设置有效的经营周期，再查看工作排期。</p>;
  const events: LsCalendarEvent[] = groups.filter(group => groupId === 'all' || group.id === groupId).flatMap(group => group.nodes.map(node => {
    const { key, planned, runtime, packageTask } = node;
    const due = calendarDay(packageTask?.dueAt) ?? days[days.length - 1];
    const record = ganttRecordRange(runtime, data.events || []);
    const state = nodeState(runtime);
    const requiresAttention = (runtime?.output?.waitState as { requiresAttention?: boolean } | undefined)?.requiresAttention;
    return {
      id: key, title: runtime?.title || planned?.title || key,
      start: dayLabel(due), allDay: true, timeZone: 'Asia/Shanghai',
      eventType: 'agent_task',
      status: runtime?.status === 'failed' ? 'failed' : requiresAttention || ['waiting_approval', 'waiting_human', 'handed_off'].includes(runtime?.status || '') ? 'needs_action' : runtime?.status === 'succeeded' ? 'done' : runtime?.status === 'running' ? 'working' : 'planned',
      statusLabel: state.label, ownerAgent: agentLabels[runtime?.agent_role || planned?.agentRole || 'business'], sourceId: runtime?.id,
      description: record ? `${record.label}：${dayLabel(record.start)} 至 ${dayLabel(record.end)}` : '暂无执行时间记录',
      data: node,
    };
  }));
  return <div aria-label="经营包工作排期">
    <p className="mb-3 text-xs text-text-secondary">按计划截止日期查看节点；详情保留计划窗口、真实执行记录、前置依赖与业务入口。</p>
    <LsCalendar label="经营包工作排期" events={events} initialDate={data.goal?.startsAt} date={data.goal?.startsAt} initialView="listWeek" filters={<Select aria-label="工作阶段" value={groupId} onChange={setGroupId} style={{ minWidth: 140 }} options={[{ label: '全部工作阶段', value: 'all' }, ...groups.map(group => ({ label: group.title, value: group.id }))]}/>} renderDetails={(event, closeDetails) => {
      const { planned, runtime, packageTask } = event.data as typeof allNodes[number];
      const link = nodeDeepLink(planned, runtime, data.run?.id || '', data.deliveries);
      const dependencies = (runtime?.depends_on || planned?.dependsOn || []).map(id => allNodes.find(node => node.key === id || node.runtime?.id === id)).filter(Boolean).map(node => node!.runtime?.title || node!.planned?.title);
      const record = ganttRecordRange(runtime, data.events || []);
      return <div className="space-y-4">
        <dl className="ls-calendar-details"><div><dt>计划窗口</dt><dd>{data.goal?.startsAt} 至 {event.start}</dd></div><div><dt>执行记录</dt><dd>{record ? `${record.label}：${dayLabel(record.start)} 至 ${dayLabel(record.end)}` : '暂无执行时间记录'}</dd></div><div><dt>前置依赖</dt><dd>{dependencies.join('、') || '无前置节点'}</dd></div>{runtime?.blocked_reason && <div><dt>阻塞原因</dt><dd>{runtime.blocked_reason}</dd></div>}</dl>
        <div className="flex flex-wrap gap-2"><Button type="primary" onClick={() => { closeDetails(); onOpen(link); }}>打开业务页面</Button>{runtime && <Button onClick={() => { closeDetails(); onDetails(runtime.id); }}>执行详情</Button>}{packageTask && <Button onClick={() => { closeDetails(); onConfigure(packageTask); }}>配置任务</Button>}</div>
      </div>;
    }}/>
  </div>;
}
