import type { RunEvent, StreamConnectionPhase, WorkflowTask } from '../../lib/digitalEmployees';

export const statusLabel: Record<string, string> = {
  draft: '待确认', active: '运行中', paused: '已暂停', completed: '已完成', cancelled: '已取消',
  planning: '规划中', running: '执行中', waiting_approval: '待审批', waiting_human: '人工接管',
  succeeded: '已完成', failed: '失败', pending: '待执行', handed_off: '已接管', approved: '已批准',
  approved_with_changes: '修改后批准', rejected: '已驳回', returned: '已交还', processed: '已处理',
  taken_over: '已接管', expired: '已过期', idle: '空闲',
  skipped: '已明确跳过', completed_with_skips: '完成但含跳过', completed_with_failures: '完成但含失败',
};

export const statusTone: Record<string, string> = {
  succeeded: 'border-emerald-200 bg-emerald-50 text-emerald-700', completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700', approved_with_changes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  processed: 'border-emerald-200 bg-emerald-50 text-emerald-700', running: 'border-blue-200 bg-blue-50 text-blue-700',
  active: 'border-blue-200 bg-blue-50 text-blue-700', planning: 'border-blue-200 bg-blue-50 text-blue-700',
  pending: 'border-slate-200 bg-white text-slate-600', waiting_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  expired: 'border-red-200 bg-red-50 text-red-700', waiting_human: 'border-violet-200 bg-violet-50 text-violet-700',
  handed_off: 'border-violet-200 bg-violet-50 text-violet-700', taken_over: 'border-violet-200 bg-violet-50 text-violet-700',
  failed: 'border-red-200 bg-red-50 text-red-700', rejected: 'border-red-200 bg-red-50 text-red-700',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600', paused: 'border-slate-200 bg-slate-100 text-slate-600',
  skipped: 'border-amber-200 bg-amber-50 text-amber-700', completed_with_skips: 'border-amber-200 bg-amber-50 text-amber-700',
  completed_with_failures: 'border-red-200 bg-red-50 text-red-700',
};

export const agentLabel: Record<string, string> = {
  planner: '计划 Agent', knowledge: '知识 Agent', content: '内容 Agent', risk: '风险 Agent',
  channel: '渠道 Agent', review: '复盘 Agent',
};

export const autonomyLabel: Record<string, string> = {
  suggest: '建议', collaborate: '协同', managed: '托管', automatic: '自动',
};

export const businessEventLabel: Record<string, string> = {
  'plan.generated': '本周执行计划已生成', 'workflow.started': '数字员工已开始执行',
  'task.started': '任务已开始', 'task.completed': '产出物已就绪', 'task.failed': '任务执行失败',
  'task.retry_scheduled': '任务已安排重试', 'approval.requested': '有一项动作等待你处理',
  'approval.decided': '审批已处理', 'approval.expired': '审批已过期', 'handoff.started': '任务已人工接管',
  'handoff.returned': '任务已交还数字员工', 'workflow.completed': '本周工作流已完成',
  'workflow.failed': '本周工作流未完成', 'workflow.paused': '运行已暂停', 'workflow.resumed': '运行已恢复',
  'workflow.cancelled': '运行已取消', 'publish.not_executed': '真实发布未执行',
  'publish.succeeded': '渠道已确认发布', 'metrics.observed': '经营指标已回写',
};

export const workItemTypeLabel: Record<string, string> = {
  approval: '审批', failure: '失败处理', information: '补充信息', handoff: '人工接管', timeout: '超时处理',
  publishing_reconciliation: '发布对账',
};

export const riskLabel: Record<string, string> = { critical: '极高风险', high: '高风险', medium: '中风险', low: '低风险', unknown: '风险待确认' };

export function presentEvent(type: string, fallback: string): string {
  return businessEventLabel[type] || fallback || '运行状态已更新';
}

export function outputSummary(task: WorkflowTask): string {
  if (typeof task.output.summary === 'string') return task.output.summary;
  if (task.task_key === 'context_readiness') return `已确认企业事实与 ${Array.isArray(task.output.constraints) ? task.output.constraints.length : 0} 条行动边界`;
  if (task.task_key === 'goal_decomposition') return `已绑定指标 ${String(task.output.successMetric || '')} 并形成执行检查点`;
  if (task.task_key === 'content_execution_pack') return `已形成 ${Array.isArray(task.output.themes) ? task.output.themes.length : 0} 个内容主题；正文保存在原业务模块`;
  if (task.task_key === 'schedule_activation') {
    const executed = task.output.executed === true || task.output.status === 'published';
    return executed ? '渠道已返回真实执行回执' : '尚无真实渠道回执，未记为发布成功';
  }
  if (task.status === 'waiting_approval') return task.blocked_reason;
  if (task.status === 'failed') return task.error_detail || task.blocked_reason || '执行失败，等待处理';
  return task.status === 'succeeded' ? '任务结果已持久化并写入事件流' : task.blocked_reason || '';
}

export function formatDateTime(value?: string): string {
  if (!value) return '未指定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function connectionPresentation(phase: StreamConnectionPhase): { label: string; tone: string; dot: string } {
  if (phase === 'idle') return { label: '事件已归档', tone: 'text-slate-600 bg-slate-50 border-slate-200', dot: 'bg-slate-400' };
  if (phase === 'connected') return { label: '实时已连接', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' };
  if (phase === 'connecting') return { label: '正在连接', tone: 'text-blue-700 bg-blue-50 border-blue-200', dot: 'bg-blue-500 animate-pulse' };
  if (phase === 'reconnecting') return { label: '断线补偿中', tone: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500 animate-pulse' };
  return { label: '实时连接中断', tone: 'text-red-700 bg-red-50 border-red-200', dot: 'bg-red-500' };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeLink(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^(https?:\/\/|\/)/.test(value) && !value.startsWith('//') ? value : '';
}

export interface ArtifactReference {
  key: string;
  label: string;
  type: string;
  id: string;
  version: string;
  href: string;
}

export function extractArtifactReferences(output: Record<string, unknown>): ArtifactReference[] {
  const candidates: unknown[] = [];
  for (const key of ['artifact', 'artifactReference', 'artifact_reference']) if (output[key]) candidates.push(output[key]);
  if (output.studioProject) candidates.push({ ...record(output.studioProject), type: 'Studio 草稿' });
  if (output.script) candidates.push({ ...record(output.script), type: '脚本记录' });
  if (Array.isArray(output.artifacts)) candidates.push(...output.artifacts);
  const fallbackId = output.studioProjectId || output.recordId || output.external_record_id;
  if (fallbackId) candidates.push({ id: fallbackId, type: output.artifactType || '正式记录', href: output.deepLink || output.deep_link });
  return candidates.map((candidate, index) => {
    const item = record(candidate);
    const id = String(item.id || item.recordId || item.referenceId || '');
    const type = String(item.type || item.artifactType || '产出物');
    return {
      key: `${type}:${id || index}`,
      label: String(item.label || item.title || `${type}${id ? ` · ${id}` : ''}`),
      type,
      id,
      version: String(item.version || item.contentVersion || ''),
      href: safeLink(item.href || item.deepLink || item.deep_link || item.url),
    };
  });
}

export function eventTechnicalDetail(event: RunEvent): Record<string, unknown> {
  return { id: event.id, type: event.type, sequence: event.sequence, runId: event.run_id, taskId: event.task_id, level: event.level, payload: event.payload };
}
