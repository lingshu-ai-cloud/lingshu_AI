import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Empty, Select, Space, Steps } from 'antd';
import { platformAdsRequest } from '../lib/platformAds';
import { authHeader } from '../lib/auth';
import type { AdConnection } from './AdAccountConnections';
type Account = { id: string; name: string; currency: string; accountStatus: number | null; timezoneName: string };
type Page = { id: string; name: string };
type Session = { sessionId: string; url: string; status: string; accounts: Account[] };
type Progress = { session: Session; accountId: string; pageId: string; step: number; expires: number };
// Only keep short-lived, non-secret progress in memory, scoped to the signed-in user.
const progress = new Map<string, Progress>();
const message = (e: unknown) => e instanceof Error ? e.message : '连接失败，请重试';
export default function AdMetaConnectionGuide({ configured, missing = [], onConnected }: {
  configured: boolean; missing?: string[]; onConnected: (connection: AdConnection) => void;
}) {
  const scope = authHeader().Authorization || '';
  const saved = progress.get(scope), initial = saved && saved.expires > Date.now() ? saved : undefined;
  const [session, setSession] = useState<Session | null>(initial?.session || null);
  const [step, setStep] = useState(initial?.step || 0), [accountId, setAccount] = useState(initial?.accountId || ''), [pageId, setPage] = useState(initial?.pageId || '');
  const [pages, setPages] = useState<Page[]>([]), [pagesLoaded, setPagesLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const alive = useRef(true), generation = useRef(0), pollBusy = useRef(false);
  const expires = useRef(initial?.expires || 0);
  const account = session?.accounts.find(a => a.id === accountId), page = pages.find(p => p.id === pageId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    for (const [key, value] of progress) if (key !== scope || value.expires <= Date.now()) progress.delete(key);
    if (session && expires.current > Date.now()) progress.set(scope, { session, accountId, pageId, step, expires: expires.current });
  }, [scope, session, accountId, pageId, step]);
  const start = async () => {
    if (busy) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    const run = ++generation.current;
    setBusy(true); setError(''); setPopupBlocked(!popup); setPages([]); setPagesLoaded(false); setAccount(''); setPage(''); setStep(0); setSession(null); progress.delete(scope);
    try {
      const result = await platformAdsRequest<{ sessionId: string; url: string }>('/oauth/meta/start', { method: 'POST' });
      if (!alive.current || generation.current !== run) { popup?.close(); return; }
      const url = new URL(result.url);
      if (url.origin !== 'https://www.facebook.com' || !url.pathname.endsWith('/dialog/oauth')) throw new Error('官方授权地址无效，请联系管理员');
      expires.current = Date.now() + 10 * 60_000;
      setSession({ ...result, status: 'pending', accounts: [] });
      if (popup) popup.location.href = result.url;
    } catch (e) { popup?.close(); if (alive.current && generation.current === run) setError(message(e)); }
    finally { if (alive.current && generation.current === run) setBusy(false); }
  };
  useEffect(() => {
    if (!session || !['pending', 'exchanging'].includes(session.status)) return;
    const abort = new AbortController();
    const check = async () => {
      if (pollBusy.current || document.hidden) return;
      pollBusy.current = true;
      try {
        const result = await platformAdsRequest<Pick<Session, 'status' | 'accounts'>>(`/oauth/meta/${session.sessionId}/accounts`, { signal: abort.signal });
        if (!abort.signal.aborted) { setSession(s => s?.sessionId === session.sessionId ? { ...s, ...result } : s); if (result.status === 'ready') { setStep(1); setError(''); } }
      } catch (e) { if (!abort.signal.aborted) { setError(message(e)); setSession(s => s ? { ...s, status: 'failed' } : s); } }
      finally { pollBusy.current = false; }
    };
    const timer = window.setInterval(() => void check(), 3000);
    window.addEventListener('focus', check);
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener('focus', check); };
  }, [session?.sessionId, session?.status]);
  useEffect(() => {
    setPages([]); setPagesLoaded(false); setError('');
    if (!accountId || session?.status !== 'ready') return;
    const abort = new AbortController(); setBusy(true);
    platformAdsRequest<{ items: Page[] }>(`/oauth/meta/${session.sessionId}/pages?accountId=${encodeURIComponent(accountId)}`, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) { setPages(result.items); setPagesLoaded(true); setPage(id => result.items.some(p => p.id === id) ? id : ''); } })
      .catch(e => { if (!abort.signal.aborted) setError(message(e)); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [accountId, session?.sessionId, session?.status, refresh]);
  const connect = async () => {
    if (!session || !account || !page || busy) return;
    setBusy(true); setError('');
    try {
      const result = await platformAdsRequest<{ connection: AdConnection }>(`/oauth/meta/${session.sessionId}/connect`, { method: 'POST', body: JSON.stringify({ accountId, pageId }) });
      progress.delete(scope);
      if (alive.current) onConnected(result.connection);
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section aria-label="Meta 官方绑定引导">
    <Steps size="small" responsive current={step} items={['登录 Facebook', '选择广告账户', '选择主页', '确认连接'].map(title => ({ title }))}/>
    <div className="ads-form-fields">
      {error && <Alert type="error" showIcon title={error} description="已选择内容会保留；请重试读取，授权过期时重新登录。不会创建或启用广告。"/>}
      {step === 0 && <>
        <h3>用谁的 Facebook 账号授权？</h3>
        <p>登录有权管理目标广告账户和主页的个人账号。个人账号负责授权，广告账户负责预算与报表，主页是广告展示的品牌身份。</p>
        <p>密码和验证码只在 Meta 官方页面输入，灵枢不会索取。请在授权页确认登录人和允许访问的资产；账号不对时，在 Meta 页面切换账号。</p>
        {!configured ? <><Alert type="warning" showIcon title="官方登录暂未就绪，请联系系统管理员" description="需要管理员补齐现有 Meta 应用配置。你不需要复制令牌、新建 Facebook 账号或 Meta 应用；已连接账户仍可使用。"/><Button type="primary" disabled>前往 Meta 官方授权</Button></> : <>
          {session && ['pending', 'exchanging'].includes(session.status) ? <><Alert type="info" showIcon title="等待你在 Meta 页面完成授权" description="完成后返回这里，系统会自动读取账户。关闭授权窗口不会连接新账户。"/>{popupBlocked && <Alert type="warning" title="浏览器拦截了弹窗，请点击下方打开授权页。"/>}<Space wrap><Button href={session.url} target="_blank" rel="noopener noreferrer">打开 Meta 授权页</Button><Button disabled={busy} onClick={() => void start()}>重新开始授权</Button></Space></>
            : <><Button type="primary" loading={busy} onClick={() => void start()}>前往 Meta 官方授权</Button>{session?.status === 'failed' && <Button onClick={() => { setError(''); setSession(s => s ? { ...s, status: 'pending' } : s); }}>重试检查授权结果</Button>}{session?.status === 'cancelled' && <Alert type="info" title="你已取消授权，可以重新开始。"/>}</>}
        </>}
      </>}
      {step === 1 && <>
        <h3>选择要连接的广告账户</h3><p>按账户名称、币种和时区核对。这不是新建广告账户，也不会充值或扣费。</p>
        {!session?.accounts.length && <Empty description="当前身份没有返回广告账户。请确认账号正确，并请企业管理员分配账户访问权限后重新授权。"/>}
        <Select aria-label="选择 Meta 广告账户" showSearch optionFilterProp="label" value={accountId || undefined} placeholder="请选择广告账户" disabled={busy} onChange={id => { setAccount(id); setPage(''); }} options={session?.accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency} · ${a.timezoneName || '时区未返回'} · ${a.id}${a.accountStatus !== 1 ? '（账户受限或状态未知）' : ''}`, disabled: a.accountStatus !== 1 }))}/>
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
      <Collapse ghost items={[{ key: 'help', label: '绑定帮助与管理员检查', children: <><p>看不到账户：确认 Facebook 登录人正确、企业已分配广告账户权限，并在授权时选择了目标资产。看不到主页：核对主页广告权限和账户推广关系。新个人账号受应用开发模式或权限审核限制时，需要现有应用管理员处理。</p><p>绑定不会自动批准投放。每份计划仍要单独选择素材、检查预算、完成投放前核验。</p>{!configured && <p>管理员配置缺项：{missing.length ? missing.join('、') : '现有应用配置格式或回调地址不符合要求'}。回调地址必须与现有 Meta 应用后台登记完全一致，密钥只在服务端配置。</p>}</> }]}/>
    </div>
  </section>;
}
