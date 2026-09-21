import { ArrowRight, FileText, Settings2 } from 'lucide-react';
import { buildTaskDeepLink, type DigitalEmployeeOverview, type DigitalEmployeeDeepLink, type PlanTask, type WorkflowTask } from '../lib/digitalEmployees';
import type { DeliveryResource } from '../lib/delivery';
import { TASK_TEMPLATES, type PackageTask } from '../lib/weeklyPackage';
import { taskWaitLabels, type TaskWaitState } from '../lib/taskExecutionState';

const nodeGroups = [
  { id: 'preparation', title: '经营准备', keys: ['context_readiness', 'goal_decomposition'] },
  { id: 'director', title: '内容编导', keys: ['scheduled_source_collection', 'viral_analysis', 'content_mode_routing'] },
  { id: 'production', title: '内容生产', keys: ['content_production', 'content_quality_gate'] },
  { id: 'publishing', title: '内容发布', keys: ['content_release_approval', 'publishing_calendar', 'platform_publish'] },
  { id: 'customers', title: '客户经营', keys: ['customer_attribution', 'customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'] },
  { id: 'review', title: '经营复盘', keys: ['weekly_review'] },
];
const pageLabels: Record<string, string> = {
  enterprise: '企业知识库', accountManagement: '账号管理', scheduled: '定时任务',
  socialInspiration: '灵感中心', scriptLibrary: '脚本库', conversion: '客户工作台',
};
export function weeklyExecutionNodes(data: DigitalEmployeeOverview) {
  // Runtime nodes are authoritative after start; include planned nodes before start.
  const keys = [...new Set([...(data.plan?.tasks.map(t => t.key) || []), ...data.tasks.map(t => t.task_key)])];
  return keys.map(key => ({
    key,
    planned: data.plan?.tasks.find(t => t.key === key),
    runtime: data.tasks.find(t => t.task_key === key),
    packageTask: data.plan?.businessPackage?.tasks.find(t =>
      (TASK_TEMPLATES.find(template => template.id === t.templateId)?.keys as readonly string[] | undefined)?.includes(key)),
  })).sort((a, b) => (a.runtime?.sequence ?? a.planned?.sequence ?? Infinity) - (b.runtime?.sequence ?? b.planned?.sequence ?? Infinity));
}
export function nodeDeepLink(planned: PlanTask | undefined, runtime: WorkflowTask | undefined, runId: string, deliveries: DeliveryResource[] = []): DigitalEmployeeDeepLink {
  if (runtime) {
    const link = buildTaskDeepLink(runtime, planned, runId || runtime.run_id);
    if (runtime.task_key !== 'content_quality_gate' || link.businessRef.entityId) return link;
    const project = deliveries.find(item => item.id.startsWith('studio_project:') && item.taskIds.includes(runtime.id));
    if (!project) return link;
    const entityId = project.id.slice('studio_project:'.length);
    return {
      ...link,
      studioPanel: 'projects',
      businessRef: {
        ...link.businessRef,
        entityId,
        deliveryId: project.id,
        resources: [{ type: 'studio_project', id: entityId }],
      },
    };
  }
  return {
    page: planned?.destination || 'digitalEmployees', view: planned?.destinationView,
    runId, taskId: '', businessRef: {
      taskKey: planned?.key || '', preview: true, businessDomain: planned?.businessDomain,
      capabilityKey: planned?.capabilityKey, statusSource: planned?.statusSource,
    },
  };
}
export function nodeState(task?: WorkflowTask) {
  const neutral = 'bg-surface-2 text-text-secondary';
  if (!task) return { label: '未启动', tone: neutral };
  if (task.status === 'failed' && task.blocked_reason) return { label: '待人工处理', tone: 'bg-amber-dim text-amber' };
  if (task.status === 'failed') return { label: '执行失败', tone: 'bg-surface-2 text-red' };
  if (task.output?.dataStatus === 'no_data') return { label: '暂无数据', tone: neutral };
  if (task.output?.dataStatus === 'not_required') return { label: '本轮无需执行', tone: neutral };
  if (task.status === 'succeeded') return { label: '已完成', tone: 'bg-[#eff7f1] text-accent' };
  if (task.status === 'running') return { label: '执行中', tone: 'bg-[#eff7f1] text-accent' };
  if (task.status === 'waiting_approval') return { label: '待审批', tone: 'bg-amber-dim text-amber' };
  const waitState = task.output?.waitState as TaskWaitState | undefined;
  const labels: Record<string, string> = { pending: '待执行', skipped: '已跳过', cancelled: '已取消', paused: '已暂停', waiting_human: '待人工处理', handed_off: '人工接管', waiting_external: '等待业务结果' };
  return { label: task.status === 'waiting_external' && waitState ? taskWaitLabels[waitState.kind] || labels[task.status] : labels[task.status] || '状态待确认', tone: neutral };
}

function nodeProgress(task?: WorkflowTask): string {
  if (!task) return '等待任务包启动';
  if (task.blocked_reason) return task.blocked_reason;
  const output = task.output || {};
  const proof = output.proof as { value?: unknown; status?: unknown } | undefined;
  if (proof?.value !== undefined) return `当前结果：${String(proof.value)}${proof.status === 'pending' ? '，仍待补齐' : ''}`;
  if (typeof output.blockedReason === 'string' && output.blockedReason) return output.blockedReason;
  if (task.status === 'succeeded') return '结果已保存，可打开查看依据和产物';
  if (task.status === 'running') return '正在处理，已有结果会持续写回';
  return '打开可查看输入、执行记录和下一步';
}

export function groupedWeeklyExecutionNodes(data: DigitalEmployeeOverview) {
  const nodes = weeklyExecutionNodes(data).map((node, index) => ({ ...node, number: index + 1 }));
  const groups = nodeGroups.map(group => ({ ...group, nodes: nodes.filter(node => group.keys.includes(node.key)) }));
  // Keep newly introduced or legacy nodes visible even before a grouping is assigned.
  const ungrouped = nodes.filter(node => !nodeGroups.some(group => group.keys.includes(node.key)));
  if (ungrouped.length) groups.push({ id: 'other', title: '其他任务', keys: [], nodes: ungrouped });
  return groups.filter(group => group.nodes.length > 0);
}

export default function WeeklyExecutionNodes({ data, onOpen, onDetails, onConfigure }: {
  data: DigitalEmployeeOverview;
  onOpen: (link: DigitalEmployeeDeepLink) => void;
  onDetails: (taskId: string) => void;
  onConfigure: (task: PackageTask) => void;
}) {
  const groups = groupedWeeklyExecutionNodes(data);
  return <div aria-label="经营包执行节点" className="space-y-4">
    {groups.filter(group => group.nodes.length > 0).map(group => {
      const completed = group.nodes.filter(node => node.runtime?.status === 'succeeded').length;
      const configurations = [...new Map(group.nodes.flatMap(node => node.packageTask ? [[node.packageTask.templateId, node.packageTask] as const] : [])).values()];
      return <section key={group.id} aria-labelledby={`node-group-${group.id}`}>
        <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id={`node-group-${group.id}`} className="text-sm font-bold text-text-primary">{group.title}</h3>
          <span className="text-xs tabular-nums text-text-muted">{completed}/{group.nodes.length} 已完成</span>
          <div className="ml-auto flex items-center gap-3">{configurations.map(task => <button key={task.templateId} type="button" onClick={() => onConfigure(task)} aria-label={`配置${task.title}`} title={`配置${task.title}`} className="inline-flex items-center gap-1 rounded-md text-xs text-text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"><Settings2 size={12}/><span>{configurations.length > 1 ? task.title : '配置'}</span></button>)}</div>
        </header>
        <ol aria-label={`${group.title}节点`} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {group.nodes.map(({ key, planned, runtime, number }) => {
            const state = nodeState(runtime);
            const link = nodeDeepLink(planned, runtime, data.run?.id || '', data.deliveries);
            const destination = link.page === 'digitalEmployees' ? key === 'weekly_review' ? '本周复盘' : '目标与执行计划'
              : link.page === 'smartAssets' ? link.view === 'publish' ? '内容发布' : '内容创作' : pageLabels[link.page] || '业务页面';
            const title = runtime?.title || planned?.title || key;
            return <li key={key} value={number} data-node-key={key} className="relative rounded-md border border-border bg-surface transition-colors hover:border-border-bright">
              <button type="button" aria-label={`${number}. ${title}，前往${destination}`} onClick={() => onOpen(link)} className="group h-full w-full rounded-md p-3 text-left hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/25">
                <div className="flex items-start gap-2"><span className="pt-0.5 text-xs font-semibold tabular-nums text-text-muted">{String(number).padStart(2, '0')}</span><h4 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-text-primary">{title}</h4><ArrowRight size={14} className="mt-0.5 shrink-0 text-text-muted group-hover:text-accent"/></div>
                <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 ${runtime ? 'pr-6' : ''}`}><span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${state.tone}`}>{state.label}</span><span className="text-xs text-text-secondary">{destination}</span></div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">{nodeProgress(runtime)}</p>
              </button>
              {runtime && <button type="button" onClick={() => onDetails(runtime.id)} aria-label={`执行详情：${title}`} title="执行详情" className="absolute bottom-3 right-2 rounded-sm p-0.5 text-text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"><FileText size={14}/></button>}
            </li>;
          })}
        </ol>
      </section>;
    })}
  </div>;
}
