import type { PlatformAdTask } from './platformAds';
import type { PlanOperatingData } from '../components/useAdPlanOperatingData';
import { managedDecisionView } from './adManagedSummary';
export function planLiveEntries(task: PlatformAdTask, data?: PlanOperatingData) {
  const audit = data?.audit;
  return audit && audit.taskId === task.id && audit.taskVersion === task.version && !audit.truncated && !audit.pendingCount ? audit.entries : [];
}
export function planStatusText(task: PlatformAdTask, data?: PlanOperatingData) {
  const entries = planLiveEntries(task, data);
  if (data?.errors.includes('平台状态与预算读取失败')) return '平台状态读取失败';
  if (data?.audit?.pendingCount) return '执行结果待核对';
  if (!entries.length) return task.status === 'draft' ? '草稿' : '状态待回传';
  const states = [...new Set(entries.map(e => e.adEffectiveStatus || 'UNKNOWN'))];
  if (states.length !== 1) return '多组投放状态';
  return ({ ACTIVE: '投放中', PAUSED: '已暂停', CAMPAIGN_PAUSED: '系列已暂停', ADSET_PAUSED: '广告组已暂停', PENDING_REVIEW: '审核中', DISAPPROVED: '审核未通过', IN_PROCESS: '平台处理中', WITH_ISSUES: '投放异常', DELETED: '已删除', ARCHIVED: '已归档' } as Record<string, string>)[states[0]] || `平台：${states[0]}`;
}
export function planAdvice(task: PlatformAdTask, data?: PlanOperatingData) {
  const run = [...(data?.runs || [])].sort((a, b) => (Date.parse(String(b.createdAt)) || 0) - (Date.parse(String(a.createdAt)) || 0))[0];
  const view = run && managedDecisionView(run);
  if (view) return { text: String(view.decision.reason || '查看最近决策'), detail: `${view.currency} ${view.before} → ${view.after} · ${String(run?.status || '状态未返回')}`, time: String(run?.createdAt || '') };
  if (run) return { text: String(run.reason || '最近观察暂无调整建议'), detail: String(run.status || ''), time: String(run.createdAt || '') };
  if (data?.errors.includes('AI 记录读取失败')) return { text: 'AI 建议读取失败', detail: '请刷新重试', time: '' };
  if (task.proposal) return { text: task.proposal.rationale, detail: '创建时建议，非实时决策', time: task.proposal.generatedAt };
  return { text: data?.runs ? '暂无 AI 调整建议' : 'AI 建议待回传', detail: '', time: '' };
}
