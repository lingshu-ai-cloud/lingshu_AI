import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';

const reasonLabels: Record<string, string> = {
  reference_analysis_pending: '参考视频正在分析，完成后将自动继续制作。',
  reference_analysis_retry_exhausted: '参考分析多次未完成，请检查视频链接或分析服务后恢复任务。',
  social_content_execution_facts_required: '需要补充可核验的企业或产品事实。',
  social_content_execution_rights_required: '需要补充参考或素材使用授权。',
  social_content_execution_budget_required: '当前方案超出已授权制作预算。',
};
function reason(value: string | null): string {
  if (!value) return '请查看任务条件与服务状态。';
  return reasonLabels[value] || (/[\u4e00-\u9fff]/.test(value) ? value : '当前执行条件未满足，请查看任务条件与服务状态。');
}
export default function SocialManagedExecutionNotice({ task }: { task: SocialContentTaskDetail | null }) {
  if (!task?.managedExecution || task.status === 'paused') return null;
  const { reference, publishing } = task.managedExecution;
  const messages: string[] = [];
  if (reference?.status === 'queued' && ['draft', 'needs_input', 'plan_review'].includes(task.status)) messages.push('参考内容正在分析，完成后会自动继续，无需重复操作。');
  else if (reference?.status === 'blocked' && ['needs_input', 'attention'].includes(task.status)) messages.push(`参考分析待处理：${reason(reference.reason)}`);
  if (publishing?.status === 'scheduled') messages.push('发布已经安排，系统正在等待平台结果。');
  else if (publishing?.status === 'blocked') messages.push(`成片已保留，发布尚未完成：${reason(publishing.reason)}${publishing.retryExhausted ? '自动重试已达上限。' : '系统会在后台重新检查，期间不会重复制作。'}`);
  if (!messages.length) return null;
  return <div role="status" className="mb-4 space-y-1 rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs leading-5 text-text-secondary">
    {messages.map(message => <p key={message}>{message}</p>)}
  </div>;
}
