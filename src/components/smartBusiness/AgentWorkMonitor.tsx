import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Table, Tag, type TableColumnsType } from 'antd';
import type { AgentStatus, ContentQueueItem, ContentQueueStep, PlanTask, WorkflowTask } from '../../lib/digitalEmployees';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';

type AgentRole = 'business' | 'director' | 'content' | 'customer';
type AgentMonitorStatus = 'working' | 'needs_action' | 'queued' | 'standby';

const agents: Array<{ role: AgentRole; name: string; scope: string }> = [
  { role: 'business', name: '经营 Agent', scope: '经营计划与排期' },
  { role: 'director', name: '编导 Agent', scope: '脚本、分镜与验收' },
  { role: 'content', name: '内容 Agent', scope: '素材、制作与质检' },
  { role: 'customer', name: '客服 Agent', scope: '询盘整理与跟进' },
];

export type AgentWorkAssignment = {
  id: string;
  taskId: string;
  contentItemId: string;
  taskTitle: string;
  accountLabel: string;
  stepLabel: string;
  estimatedMinutes: number;
  actualStartedAt: string | null;
  elapsedMinutes: number | null;
  updatedAt: string;
  blockedReason: string;
  openable: boolean;
};

export type AgentWorkMonitorRow = {
  role: AgentRole;
  name: string;
  scope: string;
  status: AgentMonitorStatus;
  assignments: AgentWorkAssignment[];
  nextAssignment: AgentWorkAssignment | null;
  queuedCount: number;
  reportedCurrentTask: string | null;
};

function validTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assignment(item: ContentQueueItem, step: ContentQueueStep, now: number): AgentWorkAssignment {
  const startedAt = validTimestamp(step.actualStartedAt);
  return {
    id: `${item.id}:${step.key}`,
    taskId: item.taskId,
    contentItemId: item.id,
    taskTitle: item.title,
    accountLabel: item.accountLabel || '仅制作',
    stepLabel: step.label,
    estimatedMinutes: Number.isFinite(step.estimatedMinutes) && step.estimatedMinutes > 0 ? step.estimatedMinutes : 0,
    actualStartedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    elapsedMinutes: startedAt === null || startedAt > now ? null : Math.max(0, Math.floor((now - startedAt) / 60_000)),
    updatedAt: item.updatedAt,
    blockedReason: item.status === 'blocked' ? item.reason : '',
    openable: true,
  };
}

function matchesAgent(step: ContentQueueStep, name: string): boolean {
  return step.responsibleAgent.includes(name);
}

type AgentWorkMonitorSources = {
  workflowTasks?: WorkflowTask[];
  planTasks?: PlanTask[];
  agentStatuses?: AgentStatus[];
};

const activeWorkflowStatuses = new Set(['running', 'active', 'planning', 'waiting_external']);
const queuedWorkflowStatuses = new Set(['pending', 'queued', 'planned', 'waiting_approval']);

function roleMatches(role: WorkflowTask['agent_role'] | AgentStatus['role'], agent: AgentRole): boolean {
  return role === agent || agent === 'business' && role === 'orchestrator';
}

function workflowAssignment(task: WorkflowTask, expectedMinutes: number): AgentWorkAssignment {
  return {
    id: `workflow:${task.id}`,
    taskId: task.id,
    contentItemId: '',
    taskTitle: task.title,
    accountLabel: '数字员工任务',
    stepLabel: task.description || task.kind,
    estimatedMinutes: Number.isFinite(expectedMinutes) && expectedMinutes > 0 ? expectedMinutes : 0,
    actualStartedAt: null,
    elapsedMinutes: null,
    updatedAt: task.updated_at,
    blockedReason: task.blocked_reason,
    openable: false,
  };
}

export function projectAgentWorkMonitor(items: ContentQueueItem[], now = Date.now(), sources: AgentWorkMonitorSources = {}): AgentWorkMonitorRow[] {
  return agents.map(agent => {
    const contentActive = items.flatMap(item => item.steps
      .filter(step => step.state === 'active' && matchesAgent(step, agent.name))
      .map(step => assignment(item, step, now)));
    const contentQueued = items.flatMap(item => item.steps
      .filter(step => step.state === 'pending' && matchesAgent(step, agent.name))
      .map(step => assignment(item, step, now)));
    const planByKey = new Map((sources.planTasks ?? []).map(task => [task.key, task.expectedMinutes]));
    const workflow = (sources.workflowTasks ?? []).filter(task => roleMatches(task.agent_role, agent.role));
    const active = [...contentActive, ...workflow.filter(task => activeWorkflowStatuses.has(task.status)).map(task => workflowAssignment(task, planByKey.get(task.task_key) ?? 0))];
    const queued = [...contentQueued, ...workflow.filter(task => queuedWorkflowStatuses.has(task.status)).map(task => workflowAssignment(task, planByKey.get(task.task_key) ?? 0))];
    active.sort((left, right) => (validTimestamp(right.actualStartedAt) ?? validTimestamp(right.updatedAt) ?? 0) - (validTimestamp(left.actualStartedAt) ?? validTimestamp(left.updatedAt) ?? 0));
    const reported = sources.agentStatuses?.find(item => roleMatches(item.role, agent.role));
    const reportedWorking = Boolean(reported && activeWorkflowStatuses.has(reported.status));
    const status: AgentMonitorStatus = active.some(item => item.blockedReason)
      ? 'needs_action'
      : active.length > 0 || reportedWorking
        ? 'working'
        : queued.length > 0
          ? 'queued'
          : 'standby';
    return {
      ...agent,
      status,
      assignments: active,
      nextAssignment: queued[0] ?? null,
      queuedCount: queued.length,
      reportedCurrentTask: reportedWorking && reported?.currentTask ? reported.currentTask : null,
    };
  });
}

function durationLabel(minutes: number, approximate = false): string {
  const prefix = approximate ? '约 ' : '';
  if (minutes < 1) return `${prefix}不足 1 分钟`;
  if (minutes < 60) return `${prefix}${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${prefix}${hours} 小时${remainder ? ` ${remainder} 分钟` : ''}`;
}

function timestampLabel(value: string): string {
  const parsed = validTimestamp(value);
  return parsed === null ? '暂无回执时间' : new Date(parsed).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

const statusPresentation: Record<AgentMonitorStatus, { label: string; color?: string }> = {
  working: { label: '执行中', color: 'processing' },
  needs_action: { label: '等待处理', color: 'warning' },
  queued: { label: '排队中', color: 'blue' },
  standby: { label: '待命' },
};

export default function AgentWorkMonitor({ items, workflowTasks, planTasks, agentStatuses, onOpenTask }: { items: ContentQueueItem[]; workflowTasks?: WorkflowTask[]; planTasks?: PlanTask[]; agentStatuses?: AgentStatus[]; onOpenTask?: (taskId: string, contentItemId: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const rows = useMemo(() => projectAgentWorkMonitor(items, now, { workflowTasks, planTasks, agentStatuses }), [agentStatuses, items, now, planTasks, workflowTasks]);
  const latestUpdate = items.map(item => validTimestamp(item.updatedAt)).filter((value): value is number => value !== null).sort((left, right) => right - left)[0];

  const taskLink = (item: AgentWorkAssignment) => onOpenTask && item.openable
    ? <Button type="link" className="!h-auto !whitespace-normal !p-0 text-left !text-sm !font-semibold" onClick={() => onOpenTask(item.taskId, item.contentItemId)}>{item.taskTitle}</Button>
    : <strong className="text-sm font-semibold text-text-primary">{item.taskTitle}</strong>;

  const columns: TableColumnsType<AgentWorkMonitorRow> = [
    {
      title: '数字员工', dataIndex: 'name', width: 150,
      render: (_, row) => <div className="min-w-0"><strong className="block text-sm text-text-primary">{row.name}</strong><span className="mt-1 block text-xs text-text-muted">{row.scope}</span></div>,
    },
    {
      title: '状态', dataIndex: 'status', width: 108,
      render: (status: AgentMonitorStatus) => <Tag color={statusPresentation[status].color}>{statusPresentation[status].label}</Tag>,
    },
    {
      title: '当前工作', key: 'work', width: 330,
      render: (_, row) => row.assignments.length > 0
        ? <div className="space-y-3">{row.assignments.map(item => <div key={item.id} className="min-w-0">
            {taskLink(item)}
            <p className="mt-1 text-xs leading-5 text-text-secondary">{item.stepLabel} · {item.accountLabel}</p>
            {item.blockedReason && <p className="mt-1 text-xs leading-5 text-amber-800">{item.blockedReason}</p>}
          </div>)}</div>
        : row.reportedCurrentTask
          ? <div><strong className="text-sm font-semibold text-text-primary">{row.reportedCurrentTask}</strong><p className="mt-1 text-xs leading-5 text-text-secondary">实时状态回执未包含可展开的内容节点</p></div>
        : row.nextAssignment
          ? <div className="min-w-0">{taskLink(row.nextAssignment)}<p className="mt-1 text-xs leading-5 text-text-secondary">下一节点：{row.nextAssignment.stepLabel} · 共 {row.queuedCount} 个待执行节点</p></div>
          : <p className="text-sm text-text-secondary">待命 · 当前没有可核验的执行节点</p>,
    },
    {
      title: '工时轨道', key: 'timeline',
      render: (_, row) => row.assignments.length > 0
        ? <div className="space-y-3" aria-label={`${row.name}当前工时轨道`}>{row.assignments.map(item => {
            const hasElapsed = item.elapsedMinutes !== null;
            const percent = hasElapsed && item.estimatedMinutes > 0 ? Math.min(100, Math.round(item.elapsedMinutes! / item.estimatedMinutes * 100)) : null;
            return <div key={item.id} className="min-w-[300px] rounded-md border border-border bg-surface-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-text-primary">{hasElapsed ? `已耗时 ${durationLabel(item.elapsedMinutes!)}` : '开始时间暂无回执'}</span>
                <span className="shrink-0 text-text-secondary">预计 {item.estimatedMinutes > 0 ? durationLabel(item.estimatedMinutes, true) : '待估'}</span>
              </div>
              {percent !== null
                ? <LsGradientProgress className="mt-2" aria-label={`${row.name}${item.stepLabel}工时进度`} percent={percent} showInfo={false} size="small" status={item.blockedReason ? 'exception' : 'active'}/>
                : <div className="mt-2 flex items-center gap-2 text-xs text-text-muted"><Spin size="small"/><span>{item.stepLabel}</span></div>}
              <p className="mt-1.5 text-xs text-text-muted">{item.actualStartedAt ? `实际开始 ${timestampLabel(item.actualStartedAt)}` : `最近执行回执 ${timestampLabel(item.updatedAt)}`}</p>
            </div>;
          })}</div>
        : row.reportedCurrentTask
          ? <div className="min-w-[300px] rounded-md border border-border bg-surface-2 px-3 py-2.5"><div className="flex items-center gap-2 text-xs text-text-secondary"><Spin size="small"/><span>当前节点执行中</span></div><p className="mt-1.5 text-xs text-text-muted">开始时间与预计时长暂无回执</p></div>
        : row.nextAssignment
          ? <div className="min-w-[300px] rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs text-text-secondary"><span className="font-medium text-text-primary">尚未开始</span><span className="ml-3">预计 {row.nextAssignment.estimatedMinutes > 0 ? durationLabel(row.nextAssignment.estimatedMinutes, true) : '待估'}</span><p className="mt-1.5 text-text-muted">等待前置节点完成，不显示虚构进度</p></div>
          : <div className="min-w-[300px] border-y border-dashed border-border py-3 text-xs text-text-muted">暂无任务时间轴</div>,
    },
  ];

  return <section className="border-t border-border bg-white px-4 py-5" aria-labelledby="agent-work-monitor-title">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 id="agent-work-monitor-title" className="text-base font-semibold text-text-primary">数字员工实时工作监控</h3>
      <p className="text-xs text-text-muted">北京时间 · {latestUpdate ? `最近回执 ${timestampLabel(new Date(latestUpdate).toISOString())}` : '暂无任务回执'}</p>
    </header>
    <Table<AgentWorkMonitorRow>
      aria-label="四个数字员工实时工作甘特监控"
      columns={columns}
      dataSource={rows}
      rowKey="role"
      pagination={false}
      size="small"
      scroll={{ x: 920 }}
    />
  </section>;
}
