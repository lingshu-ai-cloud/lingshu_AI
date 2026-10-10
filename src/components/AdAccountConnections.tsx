import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ExternalLink, Link2 } from 'lucide-react';
import { platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import './adAccountConnections.css';
import { SocialPlatformIcon } from './SocialPlatformIcon';

export type AdConnection = { id: string; provider: string; accountId: string; name: string; currency: string; status: string };
type Provider = 'meta' | 'tiktok' | 'google';
type Capability = { provider: string; configured: boolean; oauthConfigured?: boolean };
type Connections = { items: AdConnection[]; capabilities: Capability[] };
type OAuth = { sessionId: string; url: string; status: string; accounts: Array<{ id: string; name: string; currency: string }> };
type Campaign = { id: string; name: string; effective_status?: string; status?: string };
const platforms = {
  meta: { name: 'Meta', channels: 'Reels 与视频广告', account: 'Meta 广告账户 ID', example: 'act_123456789', help: '在 Meta 广告管理工具中查看广告账户 ID，可带 act_ 前缀。', token: '由有广告管理权限的管理员提供该账户的访问令牌。', scope: '网站引流与视频观看；托管与审批需在计划中另行设置授权。' },
  tiktok: { name: 'TikTok', channels: '短视频广告', account: 'TikTok 广告主 ID', example: '1234567890123456789', help: '在 TikTok 广告管理平台查看广告主 ID（Advertiser ID），请勿填写个人账号。', token: '由管理员提供已获该广告主授权的 Marketing API 访问令牌。', scope: '已有授权帖子的视频观看广告，可人工创建与启停；暂不支持托管与审批。' },
  google: { name: 'Google Ads', channels: '视频与转化广告', account: 'Google Ads 客户 ID', example: '123-456-7890', help: '在 Google Ads 账户中查看 10 位客户 ID，可包含短横线；不是登录邮箱。', token: '由管理员提供有权访问该客户账户的 Google OAuth 访问令牌。令牌过期后需重新连接。', scope: '使用现有资产创建 Demand Gen 转化广告，可人工创建与启停；暂不支持托管与审批。' },
};

function ProviderLogos({ provider }: { provider: Provider }) {
  if (provider === 'meta') return <span className="inline-flex items-center gap-1"><SocialPlatformIcon platform="facebook" size={23}/><SocialPlatformIcon platform="instagram" size={23}/></span>;
  if (provider === 'google') return <SocialPlatformIcon platform="youtube" size={25}/>;
  return <SocialPlatformIcon platform="tiktok" size={25}/>;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试';
export function normalizeAdAccountId(provider: Provider, value: string) {
  const trimmed = value.trim();
  const normalized = provider === 'google' ? trimmed.replace(/-/g, '') : trimmed;
  if (!(provider === 'google' ? /^\d{10}$/ : provider === 'meta' ? /^(act_)?\d+$/ : /^\d+$/).test(normalized)) {
    throw new Error(provider === 'google' ? '请输入 10 位 Google Ads 客户 ID，不是邮箱。' : `请输入有效的${platforms[provider].account}，仅支持${provider === 'meta' ? '数字或 act_ 加数字' : '数字'}。`);
  }
  return normalized;
}

export default function AdAccountConnections({ onTaskImported, onContinue, initialProvider = 'meta', continueLabel = '继续创建投放计划' }: {
  onTaskImported?: (task: PlatformAdTask) => void;
  onContinue?: (connection: AdConnection) => void;
  initialProvider?: Provider;
  continueLabel?: string;
}) {
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [data, setData] = useState<Connections>({ items: [], capabilities: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [oauth, setOAuth] = useState<OAuth | null>(null);
  const [checking, setChecking] = useState(false);
  const [oauthError, setOAuthError] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [success, setSuccess] = useState<AdConnection | null>(null);
  const [campaigns, setCampaigns] = useState<{ connection: AdConnection; items: Campaign[]; hasMore?: boolean } | null>(null);
  const generation = useRef(0);
  const checkInFlight = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);
  const platform = platforms[provider];
  const capability = data.capabilities.find(item => item.provider === provider);
  const official = provider === 'meta' && capability?.oauthConfigured === true;
  const canCreate = success && (success.currency === 'USD' || (success.provider === 'meta' && success.currency === 'CNY'));
  const accounts = data.items.filter(item => item.provider === provider);
  useEffect(() => { if (success) successRef.current?.focus(); }, [success]);
  useEffect(() => () => { generation.current += 1; }, []);
  const load = async () => {
    setLoading(true); setLoadError('');
    const current = generation.current;
    try { const result = await platformAdsRequest<Connections>('/connections'); if (current === generation.current) setData(result); }
    catch (e) { if (current === generation.current) setLoadError(errorMessage(e)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const switchProvider = (next: Provider) => {
    if (busy || next === provider) return;
    generation.current += 1;
    setProvider(next); setAccountId(''); setToken(''); setOAuth(null); setOAuthError('');
    setSelectedAccount(''); setManual(false); setSuccess(null); setCampaigns(null); setError(''); setChecking(false);
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { await operation(); } catch (e) { if (current === generation.current) setError(errorMessage(e)); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const connected = (connection: AdConnection) => {
    setData(current => ({ ...current, items: [connection, ...current.items.filter(item => item.id !== connection.id)] }));
    setToken(''); setAccountId(''); setOAuth(null); setSuccess(connection); setCampaigns(null);
  };
  const connect = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const id = normalizeAdAccountId(provider, accountId);
      if (!token.trim()) throw new Error('请输入访问令牌。');
      const result = await platformAdsRequest<{ connection: AdConnection }>('/connections', { method: 'POST', body: JSON.stringify({ provider, accountId: id, accessToken: token.trim() }) });
      connected(result.connection);
    });
  };
  const startOAuth = () => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    generation.current += 1;
    setOAuth(null); setOAuthError(''); setSelectedAccount('');
    void run(async () => {
      try {
        const result = await platformAdsRequest<{ url: string; sessionId: string }>('/oauth/meta/start', { method: 'POST' });
        setOAuth({ ...result, status: 'pending', accounts: [] });
        if (popup) popup.location.href = result.url;
      } catch (e) { popup?.close(); throw e; }
    });
  };
  const checkOAuth = async () => {
    if (!oauth || checkInFlight.current) return;
    const current = generation.current;
    const sessionId = oauth.sessionId;
    checkInFlight.current = true; setChecking(true);
    try {
      const result = await platformAdsRequest<Pick<OAuth, 'status' | 'accounts'>>(`/oauth/meta/${encodeURIComponent(sessionId)}/accounts`);
      if (current !== generation.current) return;
      setOAuth(previous => previous?.sessionId === sessionId ? { ...previous, ...result } : previous);
      setOAuthError('');
    } catch (e) { if (current === generation.current) setOAuthError(errorMessage(e)); }
    finally { checkInFlight.current = false; if (current === generation.current) setChecking(false); }
  };
  useEffect(() => {
    if (!oauth || !['pending', 'exchanging'].includes(oauth.status) || oauthError) return;
    const timer = window.setInterval(() => { if (!document.hidden) void checkOAuth(); }, 3000);
    const focus = () => { void checkOAuth(); };
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [oauth?.sessionId, oauth?.status, oauthError]);

  return <div className="ad-connect">
    <p className="ads-muted">先选择广告平台，再连接对应账户。广告账户连接与社媒发布授权独立。</p>
    <div className="ad-connect-platforms" role="group" aria-label="选择广告平台">
      {(Object.keys(platforms) as Provider[]).map(key => <button type="button" key={key} aria-pressed={provider === key} disabled={busy || loading} onClick={() => switchProvider(key)} className={provider === key ? 'selected' : ''}>
        <span className={`ad-platform-mark ${key}`} aria-hidden="true"><ProviderLogos provider={key}/></span><strong className="sr-only">{platforms[key].name}</strong><small>{platforms[key].channels}</small>
      </button>)}
    </div>
    {loading ? <p role="status">正在读取账户与连接方式…</p> : loadError ? <div role="alert"><p>{loadError}</p><button className="ads-button" onClick={() => void load()}>重新加载</button></div> : <>
      <ol className="ad-connect-steps" aria-label="连接进度"><li className="done">1 选择平台</li><li className={!success ? 'current' : 'done'}>2 验证账户</li><li className={success ? 'current' : ''}>3 连接完成</li></ol>
      {error && <p role="alert" className="ads-operation-error">{error}</p>}
      {success ? <div className="ad-connect-success" ref={successRef} tabIndex={-1}>
        <CheckCircle2 size={28} aria-hidden="true" /><h3>{success.status === 'connected' ? '广告账户已连接' : '账户已保存，使用受限'}</h3>
        <p><strong>{success.name}</strong></p><p>{platform.name} · {success.accountId} · {success.currency}</p>
        <p>{success.status === 'connected' ? '连接不会启动广告。创建计划后，仍需完成素材、预算和投放检查。' : '平台返回账户受限状态，请在广告平台处理账户问题后重新验证。'}</p>
        {!canCreate && <p>该账户币种暂不支持在灵枢创建计划，可查看和导入已有平台计划。</p>}
        <div className="ads-actions">{success.status === 'connected' && onContinue && <button className="ads-button primary" disabled={!canCreate} onClick={() => onContinue(success)}>{continueLabel}</button>}<button className="ads-button" onClick={() => { setSuccess(null); setManual(false); }}>管理或连接其他账户</button></div>
      </div> : <section className="ad-connect-method" aria-label={`连接 ${platform.name}`}>
        <h3>连接 {platform.name}</h3><p className="ads-muted">{platform.scope}</p>
        {!capability?.configured ? <p role="status" className="ad-connect-note">该平台连接暂不可用，请联系管理员完成配置后重试。你仍可查看下方已保存的账户。</p> : <>
          {official && <div className="ad-connect-oauth">
            {!oauth ? <><p>推荐使用官方授权，无需复制访问令牌。</p><button className="ads-button primary" disabled={busy} onClick={startOAuth}>前往 Meta 官方授权 <ExternalLink size={15} /></button></> : <>
              <p role="status">{oauth.status === 'ready' ? oauth.accounts.length ? '授权完成，请选择要连接的广告账户。' : '授权已完成，但未找到可用广告账户。请确认所授权身份有广告账户访问权限。' : oauth.status === 'failed' ? '授权未完成，请重新授权。' : '等待你完成 Meta 授权，返回后将自动检查结果。'}</p>
              {oauthError && <p role="alert" className="ads-operation-error">{oauthError}</p>}
              <div className="ads-actions">{['pending', 'exchanging'].includes(oauth.status) && <><a className="ads-button" href={oauth.url} target="_blank" rel="noopener noreferrer">打开 Meta 授权页 <ExternalLink size={14} /></a><button className="ads-button" disabled={checking || busy} onClick={() => void checkOAuth()}>{checking ? '检查中…' : '检查授权结果'}</button></>}<button className="ads-text-button" disabled={busy || checking} onClick={startOAuth}>重新授权</button></div>
              {oauth.status === 'ready' && oauth.accounts.length > 0 && <div className="ads-form-fields"><label>选择 Meta 广告账户<select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} disabled={busy}><option value="">请选择账户</option>{oauth.accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.id} · {account.currency}</option>)}</select></label><button className="ads-button primary" disabled={busy || !selectedAccount} onClick={() => void run(async () => { const result = await platformAdsRequest<{ connection: AdConnection }>(`/oauth/meta/${encodeURIComponent(oauth.sessionId)}/connect`, { method: 'POST', body: JSON.stringify({ accountId: selectedAccount }) }); connected(result.connection); })}>{busy ? '连接中…' : '连接所选账户'}</button></div>}
            </>}
            <button className="ads-text-button ad-connect-manual-toggle" disabled={busy} aria-expanded={manual} onClick={() => { setManual(!manual); setToken(''); setError(''); }}>{manual ? '收起手动连接' : '高级选项：使用访问令牌连接'}</button>
          </div>}
          {(!official || manual) && <form className="ads-form-fields" onSubmit={connect} autoComplete="off">
            <p className="ad-connect-note">{official ? '适用于由管理员提供令牌的账户。' : '当前使用访问令牌连接，请准备对应账户 ID 和有权访问该账户的令牌。'}</p>
            <label>{platform.account}<input required name={`${provider}-ad-account-id`} autoComplete="off" spellCheck={false} value={accountId} disabled={busy} onChange={e => setAccountId(e.target.value)} placeholder={platform.example} aria-describedby="ad-account-help" /></label>
            <small id="ad-account-help" className="ads-muted">{platform.help}</small>
            <label>{platform.name} 访问令牌<input required name={`${provider}-ad-access-token`} type="password" autoComplete="new-password" spellCheck={false} maxLength={10000} value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>
            <details className="ad-connect-help"><summary>如何准备访问令牌？</summary><p>{platform.token}</p><p>没有令牌时，请联系负责该广告账户的管理员协助连接。</p></details>
            <button className="ads-button primary" disabled={busy || !accountId.trim() || !token.trim()}>{busy ? '正在验证账户…' : `验证并连接 ${platform.name}`}</button>
          </form>}
        </>}
      </section>}
      <section className="ad-connected-accounts" aria-label={`${platform.name} 已保存账户`}><h3><Link2 size={17} /> {platform.name} 已保存账户 <span>{accounts.length}</span></h3>
        {!accounts.length ? <p className="ads-muted">尚未连接 {platform.name} 广告账户。连接后可读取平台计划。</p> : accounts.map(account => <div className="ads-account-option" key={account.id}><div><strong>{account.name}</strong><small>{account.accountId} · {account.currency} · {account.status === 'connected' ? '已连接' : '使用受限，需处理'}</small></div><button className="ads-button" disabled={busy} onClick={() => void run(async () => { setCampaigns(null); const result = await platformAdsRequest<{ items: Campaign[]; hasMore?: boolean }>(`/connections/${encodeURIComponent(account.id)}/campaigns`); setCampaigns({ connection: account, ...result }); })}>查看平台计划</button><button className="ads-text-button" disabled={busy} onClick={() => void run(async () => { const result = await platformAdsRequest<{ connection: AdConnection }>(`/connections/${encodeURIComponent(account.id)}/verify`, { method: 'POST' }); connected(result.connection); })}>重新验证</button></div>)}
      </section>
      {campaigns && <section className="ad-connect-campaigns"><h3>{campaigns.connection.name} 的平台计划</h3><p className="ads-muted">查看及导入不会修改平台广告。</p>{!campaigns.items.length && <p role="status">该账户暂无可读取的投放计划。</p>}{campaigns.items.map(campaign => <div className="ads-account-option" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.id} · {({ ACTIVE: '已启用', ENABLE: '已启用', ENABLED: '已启用', PAUSED: '已暂停', DISABLE: '已停用', DELETED: '已删除' } as Record<string, string>)[campaign.effective_status || campaign.status || ''] || '状态待核验'}</small></div>{onTaskImported && <button className="ads-button" disabled={busy} onClick={() => void run(async () => { const result = await platformAdsRequest<{ task: PlatformAdTask }>(`/connections/${encodeURIComponent(campaigns.connection.id)}/import`, { method: 'POST', body: JSON.stringify({ campaignId: campaign.id }) }); onTaskImported(result.task); })}>导入为只读计划</button>}</div>)}{campaigns.hasMore && <p className="ads-muted">当前仅展示首批计划，更多计划请前往广告平台查看。</p>}</section>}
    </>}
    <p className="ad-connect-footer">凭证经验证后加密保存。连接账户不会创建或启动广告。</p>
  </div>;
}
