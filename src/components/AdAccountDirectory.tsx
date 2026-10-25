import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Select, Space } from 'antd';
import type { AdAccountDirectory } from '../../shared/adAccountDirectory';
import { platformAdsRequest } from '../lib/platformAds';
import { authHeader } from '../lib/auth';
import { AdAccountDirectoryContext as Context } from '../lib/adAccountDirectoryContext';
import './metaPerformance.css';
export function AdAccountDirectoryProvider({ children, onOpenCreative, enabled = true }: { children: ReactNode; onOpenCreative: () => void; enabled?: boolean }) {
  const [directory, setDirectory] = useState<AdAccountDirectory>({ items: [], warnings: [] }), [key, setKey] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [generation, setGeneration] = useState(0), [adId, setAdId] = useState('');
  const scope = authHeader().Authorization || '';
  const [loadedScope, setLoadedScope] = useState('');
  const visible = loadedScope === scope ? directory : { items: [], warnings: [] };
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    if (loadedScope !== scope) { setKey(''); setAdId(''); }
    const abort = new AbortController(); setLoading(true); setError('');
    platformAdsRequest<AdAccountDirectory>('/account-directory', { signal: abort.signal }).then(v => { if (!abort.signal.aborted) { setDirectory(v); setLoadedScope(scope); } })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '账户目录读取失败'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [generation, enabled, scope]);
  const selected = key ? visible.items.find(i => i.key === key) : visible.items.find(i => i.provider === 'meta');
  return <Context.Provider value={{ items: visible.items, selected, loading, error: error || (key && !selected && !loading ? '所选账户已不在授权目录中，请重新选择；不会自动切到其他账户。' : ''), warnings: visible.warnings,
    select: next => { setKey(next); setAdId(''); }, refresh: () => setGeneration(v => v + 1), adId,
    openCreative: id => { setAdId(id); onOpenCreative(); } }}>{children}</Context.Provider>;
}
export function useAdAccountDirectory() {
  const context = useContext(Context);
  if (!context) throw new Error('投放账户目录上下文缺失');
  return context;
}
export function AdDirectorySelect({ disabled = false }: { disabled?: boolean }) {
  const directory = useAdAccountDirectory();
  return <div className="ads-account-directory-select">
    <Space wrap className="ads-account-directory-controls">
    <Select aria-label="统一广告账户" style={{ width: 280, maxWidth: '100%' }} disabled={disabled} loading={directory.loading} value={directory.selected?.key} onChange={directory.select}
      options={directory.items.filter(i => i.provider === 'meta').map(i => ({ value: i.key, label: `${i.name} · ${i.currency}` }))} placeholder="选择已授权的 Meta 账户"/>
    <Button disabled={disabled} loading={directory.loading} onClick={directory.refresh}>刷新授权账户</Button>
    </Space>
    {directory.error && <Alert type="error" showIcon title={directory.error}/>}
    {directory.warnings.map(w => <Alert key={w} type="warning" showIcon title={w}/>)}
  </div>;
}
