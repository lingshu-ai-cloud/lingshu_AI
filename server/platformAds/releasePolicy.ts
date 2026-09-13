import { AdProviderError } from './metaAdapter.js';

export function adReleasePolicy(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.PLATFORM_ADS_RELEASE_MODE;
  const mode = configured === undefined || configured === ''
    ? env.NODE_ENV === 'production' ? 'disabled' : 'full'
    : ['disabled', 'paused_only', 'full'].includes(configured) ? configured : 'disabled';
  return {
    mode,
    allowedActions: mode === 'full' ? ['create', 'activate', 'pause', 'resume', 'adjust_budget'] : mode === 'paused_only' ? ['create', 'pause'] : [],
    executionProviders: mode === 'full' ? ['meta', 'tiktok', 'google'] : mode === 'paused_only' ? ['meta'] : [],
    reason: mode === 'disabled' ? '平台执行尚未开放；可保存方案和查看数据。' : mode === 'paused_only' ? '当前仅开放 Meta 暂停创建及暂停操作；启用、恢复、调预算与自动优化未开放。' : '执行仍须满足账户权限、审批及预算授权。',
  };
}

export function assertAdReleaseAction(provider: string, action: string) {
  const policy = adReleasePolicy();
  if (!policy.executionProviders.includes(provider) || !policy.allowedActions.includes(action)) {
    throw new AdProviderError(policy.reason, 'RELEASE_RESTRICTED');
  }
}
