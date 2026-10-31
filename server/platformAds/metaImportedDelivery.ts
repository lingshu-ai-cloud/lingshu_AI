import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { getPlatformAdTask } from './tasks.js';
import { listAdImports, type AdImport } from './imports.js';
import { getConnectionCredential } from './connections.js';
import { safeMetaIssueText } from './metaIssueText.js';

export function importedMetaMetricResource(taskId: string, tenantId: string, imports: AdImport[]) {
  const matches = imports.filter(item => item.tenant_id === tenantId && item.taskId === taskId && item.status === 'IMPORTED' && item.provider === 'meta');
  if (matches.length !== 1 || !/^\d+$/.test(matches[0]?.campaignId || '') || !matches[0]?.connectionId) throw new AdProviderError('导入计划的平台关联不完整，请重新核对', 'METRICS_NOT_READY');
  return matches[0];
}

export async function getImportedMetaDelivery(tenantId: string, taskId: string) {
  const task = await getPlatformAdTask(tenantId, taskId);
  if (!task) throw new AdProviderError('未找到投放任务', 'NOT_FOUND');
  if (task.creationSource !== 'platform_import') throw new AdProviderError('此计划并非平台导入', 'INVALID_INPUT');
  const mapping = importedMetaMetricResource(taskId, tenantId, await listAdImports(tenantId, taskId));
  const { connection, accessToken } = await getConnectionCredential(tenantId, mapping.connectionId);
  if (connection.provider !== 'meta' || connection.accountId.replace(/^act_/, '') !== mapping.accountId.replace(/^act_/, '') || connection.currency !== task.currency) throw new AdProviderError('导入计划账户或币种不匹配', 'ACCOUNT_MISMATCH');
  const adapter = new MetaAdsAdapter(accessToken), accountId = connection.accountId.replace(/^act_/, '');
  const [campaign, account] = await Promise.all([adapter.request(mapping.campaignId, { fields: 'id,account_id,effective_status' }), adapter.account(accountId)]);
  if (String(campaign.id) !== mapping.campaignId || String(campaign.account_id) !== accountId || String(account.account_id || account.id).replace(/^act_/, '') !== accountId || account.currency !== task.currency) throw new AdProviderError('平台账户或广告系列归属不匹配', 'ACCOUNT_MISMATCH');
  const adIssues = await readImportedAdIssues(adapter, accountId, mapping.campaignId).catch(error => {
    console.warn('[platform-ads:imported-delivery-read-failed]', { taskId, campaignId: mapping.campaignId, code: error instanceof AdProviderError ? error.code : 'UNKNOWN' });
    return { found: null, messages: [] };
  });
  return { effectiveStatus: String(campaign.effective_status || ''), accountStatus: Number.isInteger(account.account_status) ? account.account_status : null, adIssues: adIssues.found, issueMessages: adIssues.messages };
}

/** Read only; a missing or incomplete ad-level response never proves healthy delivery. */
export async function readImportedAdIssues(adapter: Pick<MetaAdsAdapter, 'request'>, accountId: string, campaignId: string): Promise<{ found: boolean | null; messages: string[] }> {
  if (!/^\d+$/.test(accountId) || !/^\d+$/.test(campaignId)) throw new AdProviderError('广告资源标识无效', 'INVALID_INPUT');
  const seen = new Set<string>(), cursors = new Set<string>();
  let after: string | undefined, incomplete = false;
  for (let page = 0; page < 5; page++) {
    const response = await adapter.request(`${campaignId}/ads`, { fields: 'id,account_id,campaign_id,issues_info', limit: 100, after });
    if (!Array.isArray(response.data) || response.data.length > 100) throw new AdProviderError('广告状态返回不完整', 'INVALID_RESPONSE');
    const messages: string[] = [];
    let found = false;
    for (const ad of response.data) {
      const id = String(ad?.id || '');
      if (!/^\d+$/.test(id) || seen.has(id) || String(ad.account_id) !== accountId || String(ad.campaign_id) !== campaignId) throw new AdProviderError('广告归属无法核验', 'INVALID_RESPONSE');
      seen.add(id);
      if (Array.isArray(ad.issues_info)) {
        found ||= ad.issues_info.length > 0;
        for (const issue of ad.issues_info) {
          const message = safeMetaIssueText(issue?.error_summary);
          if (message && !messages.includes(message) && messages.length < 3) messages.push(message);
        }
      }
      else incomplete = true;
    }
    if (found) return { found: true, messages };
    if (!response.paging?.next) return { found: seen.size && !incomplete ? false : null, messages: [] };
    const next = response.paging?.cursors?.after;
    if (typeof next !== 'string' || !next || next.length > 4096 || cursors.has(next)) throw new AdProviderError('广告状态分页不完整', 'INVALID_RESPONSE');
    cursors.add(next); after = next;
  }
  return { found: null, messages: [] };
}
