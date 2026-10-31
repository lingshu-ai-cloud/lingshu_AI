import { useEffect, useState } from 'react';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader } from '../lib/auth';
import { platformAdsRequest } from '../lib/platformAds';
import type { AdDirectoryAccount } from '../../shared/adAccountDirectory';
import type { MetaBusinessOverview } from '../../shared/metaBusinessOverview';
import { adReportPeriodQuery, type AdReportPeriod } from '../../shared/adReportPeriod';
type AccountSpend = Pick<MetaBusinessOverview, 'source' | 'accountId' | 'currency' | 'timezone' | 'window' | 'reportedAt' | 'totals'>;

/** The account-wide figure is never summed from the visible page of plans. */
export default function AdAccountSpendSummary({ account, refresh, days = 7 }: { account?: AdDirectoryAccount; refresh: number; days?: AdReportPeriod }) {
  const [result, setResult] = useState<{ key: string; data?: AccountSpend; failed?: boolean }>({ key: '' });
  const [identity, setIdentity] = useState(authHeader().Authorization || '');
  const key = account ? `${identity}:${account.connectionId}:${account.accountId}:${days}` : '';
  useEffect(() => {
    const changed = () => setIdentity(authHeader().Authorization || '');
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
  }, []);
  useEffect(() => {
    if (!identity || !account || account.provider !== 'meta') return;
    const controller = new AbortController();
    setResult({ key });
    platformAdsRequest<AccountSpend>(`/connections/${encodeURIComponent(account.connectionId)}/spend/${encodeURIComponent(account.accountId)}?${adReportPeriodQuery(days)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted && (authHeader().Authorization || '') === identity) setResult({ key, data }); })
      .catch(() => { if (!controller.signal.aborted && (authHeader().Authorization || '') === identity) setResult({ key, failed: true }); });
    return () => controller.abort();
  }, [key, refresh]);
  if (!account || account.provider !== 'meta') return null;
  const data = result.key === key && (authHeader().Authorization || '') === identity ? result.data : undefined;
  const value = data?.accountId === account.accountId && data.currency === account.currency ? data.totals?.spend : null;
  const readAt = data?.reportedAt && Number.isFinite(Date.parse(data.reportedAt)) ? new Date(data.reportedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  return <p className="ads-account-spend" role="status">{account.name} · 账户{typeof days === 'string' ? days : `近${days}天`}广告消耗：{typeof value === 'number' && Number.isFinite(value) ? `${data!.currency} ${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : result.key === key && result.failed ? '读取失败' : data ? '暂无数据' : '读取中…'}{data && `（${data.window.since} 至 ${data.window.until}，账户时区 ${data.timezone}）`}{readAt && ` · 读取于 ${readAt}`} · 包含账户内所有广告，与充值和结算扣款不同</p>;
}
