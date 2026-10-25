import type { OperatingContext } from './operatingContext.js';
import { assistantTaskPortalSchema, type AssistantTaskPortal } from '../../shared/contracts/assistantTaskPortal.js';

const STATUS: Record<string, string> = { blocked: '已阻塞，等待处理', pending: '等待处理', running: '执行中',
  draft: '草稿，等待补充制作信息', plan_review: '等待方案确认', needs_input: '等待补充资料', attention: '需要处理',
  queued: '排队中', completed: '已完成', succeeded: '已完成', failed: '执行失败', cancelled: '已取消', paused: '已暂停' };
function normalized(value: string): string { return value.replace(/[\s‘’“”「」『』'"：:]/gu, ''); }
function text(value: unknown): string { return typeof value === 'string' ? value.replace(/[\r\n`*<>\[\]]/gu, ' ').slice(0, 180) : ''; }

/** Render a named task's existing read projection. No new reads or action execution. */
export function answerNamedTaskStatus(question: string, context?: OperatingContext): string | null {
  return namedTaskStatusReply(question, context)?.text ?? null;
}

export function namedTaskStatusReply(question: string, context?: OperatingContext): { text: string; taskPortal?: AssistantTaskPortal } | null {
  if (!context || !/任务|进度|状态|卡在|卡住|阻塞/u.test(question)
    || /建议|方案|执行|重试|暂停|取消|删除|审批|确认通过|为什么|原因分析/u.test(question.replace(/不要执行(?:任何)?(?:操作)?/gu, ''))) return null;
  const candidates = context.sources.filter(source => source.state === 'available' && ['workflow_tasks', 'starter_social_content_tasks'].includes(source.collection))
    .flatMap(source => source.records.map(record => ({ ...record, collection: source.collection, facts: source.collection === 'starter_social_content_tasks'
      ? { ...record.facts, title: (record.facts.brief as Record<string, unknown> | undefined)?.title, requestedOutputCount: (record.facts.brief as Record<string, unknown> | undefined)?.requestedOutputCount } : record.facts }))).filter(record => {
      const title = text(record.facts.title);
      const short = title.split(/[：:]/u).at(-1) ?? '';
      return short.length >= 4 && normalized(question).includes(normalized(short));
    });
  if (candidates.length !== 1) return candidates.length > 1
    ? { text: '找到多条同名任务。\n\n总体结论：请补充所在模块或完整任务名称。' } : null;
  const facts = candidates[0].facts, statusKey = text(facts.status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  const title = text(facts.title), reason = text(facts.blocked_reason);
  const lines = [`“${title}”：**${status || '状态暂未查到'}**。`];
  if (typeof facts.requestedOutputCount === 'number' && Number.isSafeInteger(facts.requestedOutputCount) && facts.requestedOutputCount > 0) lines.push(`计划数量：${facts.requestedOutputCount}条。`);
  if (/多少.*完成|完成.*多少|已完成|完成数量|完成了几/u.test(question)) lines.push('已完成数量：暂未查到。');
  if (reason) lines.push(`阻塞原因：${reason}。`);
  const nextStep: Record<string, string> = {
    draft: '请在内容创作页补充制作信息。', plan_review: '请在内容创作页确认方案。',
    needs_input: '请打开任务补充所需资料。', blocked: reason ? `请先处理“${reason}”。` : '请打开任务查看阻塞详情。',
    failed: '请打开任务查看失败原因。', attention: '请打开任务查看待处理事项。',
    pending: '任务等待处理。', queued: '任务正在排队。', running: '任务正在执行。',
    completed: '任务已完成。', succeeded: '任务已完成。', cancelled: '任务已取消。', paused: '任务已暂停。',
  };
  lines.push(`总体结论：${nextStep[statusKey] && Object.hasOwn(nextStep, statusKey) ? nextStep[statusKey] : '请打开任务核对当前状态。'}`);
  const portal = candidates[0].collection === 'starter_social_content_tasks' ? assistantTaskPortalSchema.safeParse({
    kind: 'content_task', taskId: facts.task_id, title, phase: 'offered',
    action: statusKey === 'plan_review' ? 'review_plan' : ['draft', 'needs_input'].includes(statusKey) ? 'complete_brief' : 'view_task',
  }) : null;
  if (portal?.success) lines.push(portal.data.action === 'review_plan' ? '是否前往内容创作页确认这条任务的方案？'
    : portal.data.action === 'complete_brief' ? '是否前往内容创作页补充这条任务的制作信息？' : '是否前往内容创作页查看这条任务？');
  return { text: lines.join('\n\n'), ...(portal?.success ? { taskPortal: portal.data } : {}) };
}
