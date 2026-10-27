import { useEffect, useState } from 'react';
import { platformAdsRequest } from '../../lib/platformAds';
import type { AdAccountDirectory, AdDirectoryAccount } from '../../../shared/adAccountDirectory';
import type { MetaBusinessOverview } from '../../../shared/metaBusinessOverview';
export function useMetaBusinessOverview(identity: string, disabled: boolean) {
  const [accounts, setAccounts] = useState<AdDirectoryAccount[]>([]);
  const [selected, setSelected] = useState('');
  const [days, setDays] = useState(7);
  const [revision, setRevision] = useState(0);
  const [directoryError, setDirectoryError] = useState('');
  const [directoryWarnings, setDirectoryWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ scope: string; report?: MetaBusinessOverview; error?: string }>({ scope: '' });
  useEffect(() => {
    if (disabled) return;
    const abort = new AbortController(); setDirectoryError('');
    void platformAdsRequest<AdAccountDirectory>('/account-directory', { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setAccounts(value.items.filter(item => item.provider === 'meta')); setDirectoryWarnings(value.warnings); }
    }).catch(error => { if (!abort.signal.aborted) setDirectoryError(error instanceof Error ? error.message : '授权账户暂不可读'); });
    return () => abort.abort();
  }, [identity, disabled, revision]);
  const account = selected ? accounts.find(item => item.key === selected) : accounts[0];
  const scope = `${identity}:${account?.key || ''}:${days}:${revision}`;
  useEffect(() => {
    if (disabled || !account) { setLoading(false); return; }
    const abort = new AbortController(); setLoading(true);
    const path = `/connections/${encodeURIComponent(account.connectionId)}/overview/${encodeURIComponent(account.accountId)}?days=${days}`;
    void platformAdsRequest<MetaBusinessOverview>(path, { signal: abort.signal }).then(report => {
      if (!abort.signal.aborted) setResult({ scope, report });
    }).catch(error => { if (!abort.signal.aborted) setResult({ scope, error: error instanceof Error ? error.message : 'Meta 报告暂不可用' }); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [scope, disabled]);
  return { accounts, account, select: setSelected, days, setDays, loading, refresh: () => setRevision(value => value + 1), report: result.scope === scope ? result.report : undefined,
    error: directoryError || (selected && !account ? '所选账户已不在授权目录中，请重新选择。' : '') || (result.scope === scope ? result.error : ''), warnings: directoryWarnings };
}
