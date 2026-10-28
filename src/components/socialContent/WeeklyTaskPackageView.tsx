import { Empty, Table, Tag, type TableColumnsType } from 'antd';
import type { DigitalEmployeeOverview, PlanTask, WorkflowTask } from '../../lib/digitalEmployees';

type WeeklyTaskRow = {
  key: string;
  sequence: number;
  title: string;
  description: string;
  agentRole: PlanTask['agentRole'];
  domain: string;
  dependencies: string[];
  status: string;
  blockedReason: string;
};

const agentLabels: Record<PlanTask['agentRole'], string> = {
  orchestrator: '灵小枢',
  business: '经营 Agent',
  director: '编导 Agent',
  content: '内容 Agent',
  customer: '客服 Agent',
};

const domainLabels: Record<string, string> = {
  foundation: '经营准备',
  content: '内容策划与制作',
  publishing: '发布运营',
  customer: '客户承接',
  review: '经营复盘',
};

const statusLabels: Record<string, string> = {
  waiting: '等待中', pending: '待开始', queued: '已排队', running: '执行中', processing: '执行中',
  waiting_approval: '待确认', waiting_human: '待处理', handed_off: '已交接', paused: '已暂停',
  completed: '已完成', succeeded: '已完成', skipped: '已跳过', failed: '执行失败', blocked: '已阻塞', cancelled: '已取消',
};

function statusColor(status: string) {
  if (['completed', 'succeeded'].includes(status)) return 'success';
  if (['running', 'processing'].includes(status)) return 'processing';
  if (['failed', 'blocked'].includes(status)) return 'error';
  if (['waiting_approval', 'waiting_human', 'paused', 'handed_off'].includes(status)) return 'warning';
  return 'default';
}

function realTaskFor(planTask: PlanTask, runtimeTasks: WorkflowTask[]) {
  return runtimeTasks.find(task => task.task_key === planTask.key);
}

export default function WeeklyTaskPackageView({ data }: { data: DigitalEmployeeOverview }) {
  const goal = data.goal;
  const plan = data.plan;
  if (!goal || !plan) return <Empty description="当前没有已建立的周计划任务"/>;
  const titleByKey = new Map(plan.tasks.map(task => [task.key, task.title]));
  const rows: WeeklyTaskRow[] = plan.tasks.map(task => {
    const runtime = realTaskFor(task, data.tasks);
    return {
      key: task.key,
      sequence: task.sequence,
      title: task.title,
      description: task.description,
      agentRole: task.agentRole,
      domain: task.businessDomain || 'foundation',
      dependencies: task.dependsOn.map(key => titleByKey.get(key) || key),
      status: runtime?.status || (data.run ? 'queued' : 'pending'),
      blockedReason: runtime?.blocked_reason || '',
    };
  });
  const completed = rows.filter(row => ['completed', 'succeeded'].includes(row.status)).length;
  const blocked = rows.filter(row => ['blocked', 'failed', 'waiting_human'].includes(row.status)).length;
  const columns: TableColumnsType<WeeklyTaskRow> = [
    { title: '顺序', dataIndex: 'sequence', width: 68, render: value => <span className="font-semibold text-text-secondary">{value}</span> },
    { title: '周计划任务', dataIndex: 'title', width: 290, render: (_, row) => <div><strong className="text-text-primary">{row.title}</strong><p className="mt-1 text-xs leading-5 text-text-muted">{row.description}</p></div> },
    { title: '阶段', dataIndex: 'domain', width: 135, render: value => domainLabels[value] || value },
    { title: '负责 Agent', dataIndex: 'agentRole', width: 130, render: value => agentLabels[value as PlanTask['agentRole']] },
    { title: '依赖', dataIndex: 'dependencies', width: 230, render: value => (value as string[]).length ? (value as string[]).join(' → ') : '无前置任务' },
    { title: '真实状态', dataIndex: 'status', width: 130, render: (_, row) => <div><Tag color={statusColor(row.status)}>{statusLabels[row.status] || row.status}</Tag>{row.blockedReason && <p className="mt-1 text-xs text-error">{row.blockedReason}</p>}</div> },
  ];
  const packageTasks = plan.businessPackage?.tasks || [];
  return <section aria-label="真正的周计划任务" className="space-y-5">
    <header className="rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold text-accent">当前周计划</p><h3 className="mt-1 text-lg font-semibold text-text-primary">{goal.title}</h3><p className="mt-2 text-sm leading-6 text-text-secondary">{goal.objective}</p></div>
        <Tag color={data.run?.status === 'running' ? 'processing' : goal.status === 'completed' ? 'success' : 'warning'}>{data.run?.status === 'running' ? '执行中' : goal.status === 'completed' ? '已完成' : '待确认'}</Tag>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><div><dt className="text-text-muted">周期</dt><dd className="mt-1 font-medium">{goal.startsAt} 至 {goal.endsAt}</dd></div><div><dt className="text-text-muted">全部任务</dt><dd className="mt-1 font-medium">{rows.length} 项</dd></div><div><dt className="text-text-muted">已完成</dt><dd className="mt-1 font-medium">{completed} 项</dd></div><div><dt className="text-text-muted">需处理</dt><dd className="mt-1 font-medium">{blocked} 项</dd></div></dl>
    </header>
    {packageTasks.length > 0 && <section><h3 className="mb-3 text-sm font-semibold text-text-primary">周任务包工作流</h3><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{packageTasks.map(task => <article key={task.templateId} className="rounded-xl border border-border bg-surface p-4"><div className="flex items-start justify-between gap-3"><strong className="text-sm text-text-primary">{task.title}</strong><Tag>{task.dueAt}</Tag></div><p className="mt-2 text-xs leading-5 text-text-secondary">{task.notes || '按周计划顺序推进并保留真实回执。'}</p><p className="mt-3 text-xs text-text-muted">{task.ownerName || 'Agent 执行'}{task.videoPlans?.length ? ` · ${task.videoPlans.length} 条内容安排` : ''}</p></article>)}</div></section>}
    <section><h3 className="mb-3 text-sm font-semibold text-text-primary">全部计划阶段与真实状态</h3><Table<WeeklyTaskRow> rowKey="key" columns={columns} dataSource={rows} pagination={false} size="middle" scroll={{ x: 1080 }}/></section>
  </section>;
}
