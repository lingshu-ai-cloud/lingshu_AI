import { listAdExecutions } from './execution.js';
import { getPlatformAdTask } from './tasks.js';
import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { safeMetaIssueText } from './metaIssueText.js';

/** Status-only fallback when creative/audit details cannot be read. Never writes to Meta. */
export async function getCreatedMetaDelivery(tenantId: string, taskId: string) {
  const task = await getPlatformAdTask(tenantId, taskId);
  if (!task) throw new AdProviderError('未找到投放任务', 'NOT_FOUND');
  if (task.creationSource === 'platform_import') throw new AdProviderError('此计划需要读取导入状态', 'INVALID_INPUT');
  const receipts = await listAdExecutions(tenantId, taskId);
  if (receipts.some(item => ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(item.status))) throw new AdProviderError('存在待核对的投放操作', 'RECONCILIATION_REQUIRED');
  const creates = receipts.filter(item => item.action === 'create' && item.status === 'VERIFIED');
  if (!creates.length || creates.length > 20) throw new AdProviderError('平台资源尚未完整核验', 'METRICS_NOT_READY');
  const states: string[] = [], messages: string[] = []; let accountStatus = 1, issues: boolean | null = false;
  for (const receipt of creates) {
    const ids = (receipt.result || {}) as Record<string, unknown>;
    const campaignId = String(ids.campaignId || ''), adsetId = String(ids.adsetId || ''), adId = String(ids.adId || '');
    if (![campaignId, adsetId, adId].every(id => /^\d+$/.test(id)) || receipt.resourceId !== campaignId) throw new AdProviderError('平台资源标识不完整', 'RESOURCE_MISMATCH');
    const { connection, accessToken } = await getConnectionCredential(tenantId, receipt.connectionId);
    if (connection.provider !== 'meta' || connection.currency !== task.currency) throw new AdProviderError('广告账户或币种不匹配', 'ACCOUNT_MISMATCH');
    const adapter = new MetaAdsAdapter(accessToken), accountId = connection.accountId.replace(/^act_/, '');
    const [account, campaign, adset, ad] = await Promise.all([
      adapter.account(accountId), adapter.request(campaignId, { fields: 'id,account_id,effective_status' }),
      adapter.request(adsetId, { fields: 'id,account_id,campaign_id,effective_status' }), adapter.request(adId, { fields: 'id,account_id,adset_id,effective_status,issues_info' }),
    ]);
    if (String(account.account_id || account.id || '').replace(/^act_/, '') !== accountId || account.currency !== task.currency || [campaign, adset, ad].some((row, i) => String(row.id) !== [campaignId, adsetId, adId][i] || String(row.account_id) !== accountId) || String(adset.campaign_id) !== campaignId || String(ad.adset_id) !== adsetId) throw new AdProviderError('平台账户或广告层级不匹配', 'RESOURCE_MISMATCH');
    if (!Number.isInteger(account.account_status)) throw new AdProviderError('平台账户状态未返回', 'INVALID_RESPONSE');
    if (accountStatus === 1 && account.account_status !== 1) accountStatus = account.account_status;
    const statuses = [campaign, adset, ad].map(row => typeof row.effective_status === 'string' ? row.effective_status : '');
    states.push(statuses.find(value => value && value !== 'ACTIVE') || (statuses.every(value => value === 'ACTIVE') ? 'ACTIVE' : 'UNKNOWN'));
    if (!Array.isArray(ad.issues_info)) { if (issues !== true) issues = null; }
    else if (ad.issues_info.length) {
      issues = true;
      for (const issue of ad.issues_info) { const message = safeMetaIssueText(issue?.error_summary); if (message && !messages.includes(message) && messages.length < 3) messages.push(message); }
    }
  }
  return { effectiveStatus: new Set(states).size === 1 ? states[0] : 'MULTIPLE', accountStatus, adIssues: issues, issueMessages: messages };
}
