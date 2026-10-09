import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';

/** Explain an observed admission refusal without changing its code or execution state. */
export function weeklyProductionAdmissionMessage(code: string, detail: SocialContentTaskDetail | null, fallback: string): string {
  if (code === 'social_content_execution_director_review_required') {
    const review = detail?.agentWorkflow?.executionPlanReview;
    const issues = review?.requiredRevision.length ? review.requiredRevision : review?.failedCriteria ?? [];
    const observed = [...new Set(issues.filter(issue => typeof issue === 'string' && issue.trim()).map(issue => issue.trim()))];
    return `编导执行方案尚未通过核验，请进入原内容任务处理${observed.length ? `：${observed.join('；')}` : '参考分镜、镜头证据与可执行方案'}。`;
  }
  const messages: Record<string, string> = {
    social_content_execution_rights_required: '参考或素材权利尚未核验，请在原内容任务补齐授权依据。',
    social_content_execution_facts_required: '企业事实依据尚未核验，请在原内容任务补齐对应事实。',
    social_content_execution_budget_required: '执行方案超出预算，请在原内容任务调整方案或确认预算。',
    social_content_execution_goal_degraded: '当前执行方案未达到经营目标，请由编导与经营 Agent 修订方案。',
    weekly_reference_source_missing: '冻结参考来源尚未绑定，请在原内容任务核对参考视频。',
    weekly_reference_version_changed: '参考来源版本发生变化，请核对原冻结参考并明确修订。',
  };
  return messages[code] ?? fallback;
}
