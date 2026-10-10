export function formatDemoQuotaError(j: any): string {
  if (j?.error === 'demo_expired') return '试用已到期，请联系服务顾问开通或延长试用。';
  if (j?.error === 'demo_token_quota_exceeded') return '今日 Token 额度已用完，请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'generation') return '今日普通生成额度已用完，脚本/封面/配音等 AI 生成请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'render') return '今日成片预览额度已用完，请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'videoGeneration') return '今日视频生成额度已用完，请明天再试或联系服务顾问开通更多额度。';
  return '今日试用额度已用完，请明天再试或联系服务顾问开通更多额度。';
}
