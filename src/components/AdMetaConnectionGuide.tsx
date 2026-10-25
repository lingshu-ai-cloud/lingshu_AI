import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Select, Space, Steps } from 'antd';
import { platformAdsRequest } from '../lib/platformAds';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader } from '../lib/auth';
import type { AdConnection } from './AdAccountConnections';
type Account = { id: string; name: string; currency: string; accountStatus: number | null; timezoneName: string };
type Page = { id: string; name: string };
type Session = { sessionId: string; url?: string; status: string; accounts: Account[]; expiresAt?: string };
const officialUrl = (value: string) => {
  const url = new URL(value);
  return url.origin === 'https://www.facebook.com' && url.pathname.endsWith('/dialog/oauth');
};
const message = (e: unknown) => e instanceof Error ? e.message : '连接失败，请重试';
export default function AdMetaConnectionGuide({ configured, targetAccountId, onConnected }: {
  configured: boolean; missing?: string[]; targetAccountId?: string; onConnected: (connection: AdConnection) => void;
}) {
  const [scope, setScope] = useState(authHeader().Authorization || '');
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState(0), [accountId, setAccount] = useState(''), [pageId, setPage] = useState('');
  const [restoring, setRestoring] = useState(configured), [restoreAttempt, setRestoreAttempt] = useState(0);
  const [pages, setPages] = useState<Page[]>([]), [pagesLoaded, setPagesLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const alive = useRef(true), generation = useRef(0), pollBusy = useRef(false);
  const availableAccounts = session?.accounts.filter(a => !targetAccountId || a.id.replace(/^act_/, '') === targetAccountId.replace(/^act_/, '')) || [];
  const account = availableAccounts.find(a => a.id === accountId), page = pages.find(p => p.id === pageId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    const changed = () => { generation.current++; setScope(authHeader().Authorization || ''); setSession(null); setStep(0); setAccount(''); setPage(''); setPages([]); setError(''); setBusy(false); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
  }, []);
  useEffect(() => {
    if (!configured || !scope) { setRestoring(false); return; }
    const abort = new AbortController(), run = ++generation.current;
    setRestoring(true); setError('');
    platformAdsRequest<{ session: Session | null }>('/oauth/meta/current', { signal: abort.signal })
      .then(result => {
        if (abort.signal.aborted || generation.current !== run) return;
        setSession(result.session); setStep(result.session?.status === 'ready' ? 1 : 0);
      })
      .catch(e => { if (!abort.signal.aborted && generation.current === run) setError(message(e)); })
      .finally(() => { if (!abort.signal.aborted && generation.current === run) setRestoring(false); });
    return () => abort.abort();
  }, [scope, configured, restoreAttempt]);
  useEffect(() => {
    if (targetAccountId && session?.status === 'ready') {
      const target = session.accounts.find(a => a.id.replace(/^act_/, '') === targetAccountId.replace(/^act_/, '') && a.accountStatus === 1);
      setAccount(target?.id || ''); setPage('');
    }
  }, [targetAccountId, session?.sessionId, session?.status]);
  const cancel = async () => {
    if (!session || busy) return;
    const run = ++generation.current; setBusy(true); setError('');
    try {
      await platformAdsRequest(`/oauth/meta/${session.sessionId}/cancel`, { method: 'POST' });
      if (alive.current && generation.current === run) { setSession(null); setStep(0); setAccount(''); setPage(''); setPages([]); }
    } catch (e) { if (alive.current && generation.current === run) setError(message(e)); }
    finally { if (alive.current && generation.current === run) setBusy(false); }
  };
  const start = async () => {
    if (busy || restoring || authHeader().Authorization !== scope) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    const run = ++generation.current;
    setBusy(true); setError(''); setPopupBlocked(!popup); setPages([]); setPagesLoaded(false); setAccount(''); setPage(''); setStep(0); setSession(null);
    try {
      const result = await platformAdsRequest<{ sessionId: string; url: string }>('/oauth/meta/start', { method: 'POST' });
      if (!alive.current || generation.current !== run) { popup?.close(); return; }
      if (!officialUrl(result.url)) throw new Error('官方授权地址无效，请联系管理员');
      setSession({ ...result, status: 'pending', accounts: [] });
      if (popup) popup.location.href = result.url;
    } catch (e) { popup?.close(); if (alive.current && generation.current === run) setError(message(e)); }
    finally { if (alive.current && generation.current === run) setBusy(false); }
  };
  useEffect(() => {
    if (!session || !['pending', 'exchanging'].includes(session.status)) return;
    const abort = new AbortController(), run = generation.current;
    const check = async () => {
      if (pollBusy.current || document.hidden) return;
      pollBusy.current = true;
      try {
        const result = await platformAdsRequest<Pick<Session, 'status' | 'accounts'>>(`/oauth/meta/${session.sessionId}/accounts`, { signal: abort.signal });
        if (!abort.signal.aborted && authHeader().Authorization === scope && generation.current === run) { setSession(s => s?.sessionId === session.sessionId ? { ...s, ...result } : s); if (result.status === 'ready') { setStep(1); setError(''); } }
      } catch (e) { if (!abort.signal.aborted && authHeader().Authorization === scope && generation.current === run) { setError(message(e)); setSession(s => s ? { ...s, status: 'failed' } : s); } }
      finally { pollBusy.current = false; }
    };
    const timer = window.setInterval(() => void check(), 3000);
    window.addEventListener('focus', check);
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener('focus', check); };
  }, [session?.sessionId, session?.status]);
  useEffect(() => {
    setPages([]); setPagesLoaded(false); setError('');
    if (!accountId || session?.status !== 'ready') return;
    const abort = new AbortController(), run = generation.current; setBusy(true);
    platformAdsRequest<{ items: Page[] }>(`/oauth/meta/${session.sessionId}/pages?accountId=${encodeURIComponent(accountId)}`, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted && authHeader().Authorization === scope && generation.current === run) { setPages(result.items); setPagesLoaded(true); setPage(id => result.items.some(p => p.id === id) ? id : ''); } })
      .catch(e => { if (!abort.signal.aborted && authHeader().Authorization === scope && generation.current === run) setError(message(e)); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [accountId, session?.sessionId, session?.status, refresh]);
  const connect = async () => {
    if (!session || !account || !page || busy || authHeader().Authorization !== scope) return;
    const run = generation.current; setBusy(true); setError('');
    try {
      const result = await platformAdsRequest<{ connection: AdConnection }>(`/oauth/meta/${session.sessionId}/connect`, { method: 'POST', body: JSON.stringify({ accountId, pageId }) });
      if (alive.current && authHeader().Authorization === scope && generation.current === run) onConnected(result.connection);
    } catch (e) { if (alive.current && authHeader().Authorization === scope && generation.current === run) setError(message(e)); }
    finally { if (alive.current && authHeader().Authorization === scope && generation.current === run) setBusy(false); }
  };
  return <section aria-label="Meta 官方绑定引导">
    <Steps size="small" responsive current={step} items={['登录 Facebook', '选择广告账户', '选择主页', '确认连接'].map(title => ({ title }))}/>
    <div className="ads-form-fields">
      {error && <Alert type="error" showIcon title={error} description="请重试当前步骤，或重新开始 Meta 授权。已保存账户和历史数据不会删除。"/>}
      {restoring && <p role="status">正在恢复授权进度…</p>}
      {error && !session && <Button disabled={restoring} onClick={() => setRestoreAttempt(v => v + 1)}>重新读取授权进度</Button>}
      {!restoring && step === 0 && <>
        <h3>{configured ? '用谁的 Facebook 账号授权？' : 'Meta 账户连接'}</h3>
        {!configured ? <><p role="status">官方授权暂不可用，请联系管理员恢复配置。已保存账户和历史数据仍可查看。</p><Button type="primary" disabled title="官方授权未配置，请联系管理员">前往 Meta 官方授权</Button></> : <>
          {session && ['pending', 'exchanging'].includes(session.status) ? <><Alert type="info" showIcon title="等待你在 Meta 页面完成授权" description="完成后返回这里，系统会自动读取账户。授权窗口已关闭时可重新开始。"/>{popupBlocked && <Alert type="warning" title="浏览器拦截了弹窗，请点击下方打开授权页。"/>}<Space wrap>{session.url && officialUrl(session.url) && <Button href={session.url} target="_blank" rel="noopener noreferrer">打开 Meta 授权页</Button>}<Button disabled={busy} onClick={() => void start()}>重新开始授权</Button></Space></>
            : <><Button type="primary" loading={busy} onClick={() => void start()}>前往 Meta 官方授权</Button>{session?.status === 'failed' && <Button onClick={() => { setError(''); setSession(s => s ? { ...s, status: 'pending' } : s); }}>重试检查授权结果</Button>}{session?.status === 'cancelled' && <Alert type="info" title="你已取消授权，可以重新开始。"/>}</>}
        </>}
      </>}
      {step === 1 && <>
        <h3>选择要连接的广告账户</h3><p>按账户名称、币种和时区核对。这不是新建广告账户，也不会充值或扣费。</p>
        {!availableAccounts.length && <Empty description={targetAccountId ? '本次授权未返回原广告账户，请更换有该账户权限的 Facebook 账号重新授权。' : '当前身份没有返回广告账户。请确认账号正确，并请企业管理员分配账户访问权限后重新授权。'}/>}
        <Select aria-label="选择 Meta 广告账户" showSearch optionFilterProp="label" value={accountId || undefined} placeholder="请选择广告账户" disabled={busy} onChange={id => { setAccount(id); setPage(''); }} options={availableAccounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency} · ${a.timezoneName || '时区未返回'} · ${a.id}${a.accountStatus !== 1 ? '（账户受限或状态未知）' : ''}`, disabled: a.accountStatus !== 1 }))}/>
        <Space wrap><Button disabled={busy} onClick={() => void start()}>换一个 Facebook 账号授权</Button><Button type="primary" disabled={!account || account.accountStatus !== 1} loading={busy} onClick={() => setStep(2)}>下一步：选择主页</Button></Space>
      </>}
      {step === 2 && <>
        <h3>选择广告展示的 Facebook 主页</h3><p>只展示当前身份有广告权限、且所选广告账户允许推广的主页。不自动建立新的平台资产关系。</p>
        <Select aria-label="选择 Facebook 主页" showSearch optionFilterProp="label" loading={busy} disabled={busy} value={pageId || undefined} placeholder="请选择已授权主页" onChange={setPage} options={pages.map(p => ({ value: p.id, label: `${p.name} · ${p.id}` }))}/>
        {pagesLoaded && !pages.length && <Alert type="warning" showIcon title="没有符合条件的主页" description="有广告账户权限不代表有主页权限。请让企业管理员核对主页的广告任务权限及该账户的推广关系，再重新授权；系统不会代替你分配权限。"/>}
        <Space wrap><Button disabled={busy} onClick={() => setStep(1)}>上一步</Button><Button disabled={busy} onClick={() => setRefresh(v => v + 1)}>重新读取主页</Button><Button type="primary" disabled={!page || busy} onClick={() => setStep(3)}>下一步：确认连接</Button></Space>
      </>}
      {step === 3 && <>
        <h3>确认账户与主页</h3><Descriptions column={1} items={[{ key: 'account', label: '广告账户', children: account?.name }, { key: 'currency', label: '币种 / 时区', children: `${account?.currency} / ${account?.timezoneName || '未返回'}` }, { key: 'page', label: 'Facebook 主页', children: page?.name || '正在重新核对主页，请稍候' }]}/>
        <Alert type="info" showIcon title="只保存连接，不进行投放" description="系统会再次核对权限并加密保存凭证和主页选择，不上传素材、不创建广告、不修改预算或账单。"/>
        <Space><Button disabled={busy} onClick={() => setStep(2)}>上一步</Button><Button type="primary" disabled={!page || !account} loading={busy} onClick={() => void connect()}>确认连接账户与主页</Button></Space>
      </>}
      {session && ['pending', 'exchanging', 'ready'].includes(session.status) && <Button disabled={busy || restoring} onClick={() => void cancel()}>取消本次连接</Button>}
    </div>
  </section>;
}
