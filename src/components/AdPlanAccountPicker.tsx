import { useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import { AdDirectorySelect, useAdAccountDirectory } from './AdAccountDirectory';
import { platformAdsRequest } from '../lib/platformAds';
export default function AdPlanAccountPicker({ currency, value, onChange, onCurrencyChange }: { currency: string; value?: string; onChange: (id: string) => void; onCurrencyChange?: (currency: 'USD' | 'CNY') => void }) {
  const directory = useAdAccountDirectory(), account = directory.selected;
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState('');
  const confirm = async () => {
    if (!account || !['USD', 'CNY'].includes(account.currency) || account.currency !== currency && !onCurrencyChange) return;
    setBusy(true); setError('');
    try {
      const result = await platformAdsRequest<{ connection: { id: string } }>(`/connections/${encodeURIComponent(account.connectionId)}/use-granted-account`, { method: 'POST', body: JSON.stringify({ accountId: account.accountId }) });
      if (account.currency !== currency) onCurrencyChange?.(account.currency as 'USD' | 'CNY');
      onChange(result.connection.id); setConfirmed(account.name); directory.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '账户选择未保存'); } finally { setBusy(false); }
  };
  const saved = directory.items.find(i => i.localConnectionId === value);
  return <section aria-label="草稿广告账户"><h3>广告账户</h3><AdDirectorySelect disabled={busy}/>
    <Space wrap><Button disabled={!account || !['USD', 'CNY'].includes(account.currency) || account.currency !== currency && !onCurrencyChange} loading={busy} onClick={() => void confirm()}>{account && account.currency !== currency && onCurrencyChange ? `使用 ${account.currency} 账户（金额不换算）` : '用于此草稿'}</Button>
      {value && <><Tag>草稿账户：{saved?.name || confirmed || '已保存，待核对'}</Tag><Button disabled={busy} onClick={() => { onChange(''); setConfirmed(''); }}>清除草稿账户</Button></>}
    </Space>
    {account && !['USD', 'CNY'].includes(account.currency) ? <Alert type="warning" showIcon title={`当前创编仅支持 USD / CNY，${account.currency} 账户可查看历史数据，暂不能用于此草稿。`}/> : account && account.currency !== currency && !onCurrencyChange && <Alert type="warning" showIcon title={`账户使用 ${account.currency}，已保存草稿不能更换币种，请选择同币种账户或新建草稿。`}/>}
    {error && <Alert type="error" showIcon title={error}/>}
  </section>;
}
