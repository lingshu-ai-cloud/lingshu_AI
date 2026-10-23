import type { MetaAccountHistory } from '../../shared/metaAccountHistory.js';
import { META_PERFORMANCE_FIELDS, metaAccountDate, metaDateRange } from '../../shared/metaPerformance.js';
import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { normalizeMetaPerformance } from './metaPerformance.js';
import { creativeReadCache } from './creativeReadCache.js';

type Reader = Pick<MetaAdsAdapter, 'request'>;
const cached = creativeReadCache<MetaAccountHistory>(60_000);
/** GET only: does not import ads as local plans, create bindings, or change billing. */
export async function readMetaAccountHistory(accountId: string, adapter: Reader): Promise<MetaAccountHistory> {
  const account = await adapter.request(`act_${accountId}`, { fields: 'id,name,currency,timezone_name,amount_spent' });
  if (String(account.id) !== `act_${accountId}` || !/^[A-Z]{3}$/.test(account.currency || '') || !account.timezone_name) throw new AdProviderError('Meta 账户归属或币种未核验', 'INVALID_RESPONSE');
  const today = metaAccountDate(account.timezone_name);
  let prepay: boolean | null = null, billingError = '';
  try {
    const billing = await adapter.request(`act_${accountId}`, { fields: 'id,is_prepay_account' });
    if (String(billing.id) !== `act_${accountId}`) throw new Error('account mismatch');
    prepay = typeof billing.is_prepay_account === 'boolean' ? billing.is_prepay_account : null;
  } catch { billingError = '付款类型暂不可读，请到 Meta 账单页核对；不影响历史报告。'; }
  const fields = [...new Set(['account_id', 'account_currency', 'campaign_id', 'campaign_name', 'ad_id', 'ad_name', 'date_start', 'date_stop', ...Object.values(META_PERFORMANCE_FIELDS).map(f => f.field)])].join(',');
  const items: MetaAccountHistory['items'] = [], seen = new Set<string>(), cursors = new Set<string>();
  let after: string | undefined, complete = false;
  for (let page = 0; page < 10; page++) {
    const response = await adapter.request(`act_${accountId}/insights`, { fields, level: 'ad', date_preset: 'maximum', time_increment: 'all_days',
      action_report_time: 'impression', use_unified_attribution_setting: true,
      filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }], limit: 100, after });
    if (!Array.isArray(response.data) || response.data.length > 100) throw new AdProviderError('Meta 历史报告格式异常', 'INVALID_RESPONSE');
    for (const row of response.data) {
      const metrics = normalizeMetaPerformance(row), id = String(row.ad_id || '');
      if (String(row.account_id) !== accountId || row.account_currency !== account.currency || !/^\d+$/.test(id) || !/^\d+$/.test(String(row.campaign_id || '')) || seen.has(id)
        || !metaDateRange(String(row.date_start), String(row.date_start)).length || !metaDateRange(String(row.date_stop), String(row.date_stop)).length
        || row.date_start > row.date_stop || row.date_stop > today || metrics.spend == null || metrics.spend <= 0) throw new AdProviderError('Meta 历史报告归属、日期或花费不一致', 'INVALID_RESPONSE');
      seen.add(id); items.push({ adId: id, adName: String(row.ad_name || id), campaignId: String(row.campaign_id), campaignName: String(row.campaign_name || row.campaign_id), since: row.date_start, until: row.date_stop, metrics });
    }
    if (!response.paging?.next) { complete = true; break; }
    // Never follow provider-returned URLs, which may contain credentials.
    const next = response.paging?.cursors?.after;
    if (typeof next !== 'string' || !next || next.length > 4096 || cursors.has(next)) throw new AdProviderError('Meta 分页无法继续，历史范围未核验', 'INVALID_RESPONSE');
    cursors.add(next); after = next;
  }
  const amount = typeof account.amount_spent === 'string' && /^\d+$/.test(account.amount_spent) ? BigInt(account.amount_spent) : null;
  return { source: 'provider', accountId, accountName: String(account.name || accountId), currency: account.currency, timezone: account.timezone_name,
    reportedAt: new Date().toISOString(), scope: 'maximum', complete, hasAccountSpend: amount === null ? null : amount > 0n,
    billing: { prepay, settingsUrl: 'https://business.facebook.com/billing_hub/payment_settings', ...(billingError ? { error: billingError } : {}) }, items };
}
export async function getMetaAccountHistory(tenantId: string, connectionId: string) {
  return cached(tenantId, connectionId, async () => {
    const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
    if (connection.provider !== 'meta') throw new AdProviderError('仅支持 Meta 账户历史报告', 'NOT_SUPPORTED');
    return readMetaAccountHistory(connection.accountId, new MetaAdsAdapter(accessToken));
  });
}
