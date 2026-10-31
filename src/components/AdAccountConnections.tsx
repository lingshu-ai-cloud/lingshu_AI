import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Link2 } from 'lucide-react';
import { platformAdsApi, platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import type { PlatformAdResource, PlatformAdResourceLevel, PlatformAdResourceSyncResult } from '../../shared/platformAdResources';
import './adAccountConnections.css';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import AdMetaConnectionGuide from './AdMetaConnectionGuide';
import { AdAccountDirectoryContext } from '../lib/adAccountDirectoryContext';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader } from '../lib/auth';
import { type AdAuthorization } from './AdAuthorizationHealth';

export type AdConnection = { id: string; provider: string; accountId: string; name: string; currency: string; status: string; authorization?: AdAuthorization; businessName?: string; accountStatus?: number | null; updatedAt?: string; timezoneName?: string; timezoneOffsetHoursUtc?: number | null; defaultPage?: { id: string; name: string; verifiedAt: string } | null };
type Provider = 'meta' | 'tiktok' | 'google';
type Capability = { provider: string; configured: boolean; oauthConfigured?: boolean; oauthReadiness?: { missing: string[] } };
type Connections = { items: AdConnection[]; capabilities: Capability[] };
type Campaign = { id: string; name: string; effective_status?: string; status?: string };
const platforms = {
  meta: { name: 'Meta', channels: 'Reels 与视频广告', account: 'Meta 广告账户 ID', example: 'act_123456789', help: '在 Meta 广告管理工具中查看广告账户 ID，可带 act_ 前缀。', token: '由有广告管理权限的管理员提供该账户的访问令牌。', scope: '网站访问、视频观看、消息会话、即时表单和独立站询盘；托管与审批需在计划中另行设置授权。' },
  tiktok: { name: 'TikTok', channels: '短视频广告', account: 'TikTok 广告主 ID', example: '1234567890123456789', help: '在 TikTok 广告管理平台查看广告主 ID（Advertiser ID），请勿填写个人账号。', token: '由管理员提供已获该广告主授权的 Marketing API 访问令牌。', scope: '已有授权帖子的视频观看广告，可人工创建与启停；暂不支持托管与审批。' },
  google: { name: 'Google Ads', channels: '视频与转化广告', account: 'Google Ads 客户 ID', example: '123-456-7890', help: '在 Google Ads 账户中查看 10 位客户 ID，可包含短横线；不是登录邮箱。', token: '由管理员提供有权访问该客户账户的 Google OAuth 访问令牌。令牌过期后需重新连接。', scope: '使用现有资产创建 Demand Gen 转化广告，可人工创建与启停；暂不支持托管与审批。' },
};

function ProviderLogos({ provider }: { provider: Provider }) {
  if (provider === 'meta') return <span className="inline-flex items-center gap-1"><SocialPlatformIcon platform="facebook" size={23}/><SocialPlatformIcon platform="instagram" size={23}/></span>;
  if (provider === 'google') return <SocialPlatformIcon platform="youtube" size={25}/>;
  return <SocialPlatformIcon platform="tiktok" size={25}/>;
}
const accountNotice = (account: AdConnection, live?: { accountStatus: number | null; checkedAt?: string }) => {
  if (live?.accountStatus != null && live.accountStatus !== 1) return '账户受限，请检查';
  if (account.status !== 'connected' && !live) return '账户待检查';
  if (account.provider !== 'meta') return '暂无账户提醒';
  const authorization = account.authorization;
  const dates = [authorization?.expiresAt, authorization?.dataAccessExpiresAt].filter((value): value is string => !!value).map(value => Date.parse(value));
  if (authorization?.status === 'revoked') return '授权已撤销';
  if (dates.some(date => !Number.isFinite(date))) return '授权待检查';
  if (dates.some(date => date <= Date.now())) return '授权已到期';
  if (authorization?.status === 'healthy' && dates.some(date => date <= Date.now() + 7 * 86400_000)) return '授权即将到期';
  if (account.authorization?.status === 'healthy' && (!live || live.accountStatus !== 1 || !account.authorization.checkedAt || !Number.isFinite(Date.parse(account.authorization.checkedAt)) || Date.now() - Date.parse(account.authorization.checkedAt) > 24 * 3600_000)) return '待检查';
  return ({ healthy: '付款待核验', expiring: '授权即将到期', expired: '授权已到期', revoked: '授权已撤销', missing_permissions: '授权权限不足', unknown: '授权待检查' } as const)[account.authorization?.status || 'unknown'];
};
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
  const [provider, setProvider] = useState<Provider>(initialProvider === 'meta' ? initialProvider : 'meta');
  const directory = useContext(AdAccountDirectoryContext);
  const [data, setData] = useState<Connections>({ items: [], capabilities: [] });
  const [liveStatus, setLiveStatus] = useState<Record<string, { accountStatus: number | null; checkedAt?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [success, setSuccess] = useState<AdConnection | null>(null);
  const [campaigns, setCampaigns] = useState<{ connection: AdConnection; items: Campaign[]; hasMore?: boolean } | null>(null);
  const [resources, setResources] = useState<{ connection: AdConnection; level: PlatformAdResourceLevel; items: PlatformAdResource[]; hasMore: boolean } | null>(null);
  const [lastSync, setLastSync] = useState<PlatformAdResourceSyncResult | null>(null);
  const [reauthorize, setReauthorize] = useState<{ id: string; name: string; attempt: number } | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0), statusGeneration = useRef(0);
  const renderGeneration = generation.current;
  const successRef = useRef<HTMLDivElement>(null);
  const platform = platforms[provider];
  const capability = data.capabilities.find(item => item.provider === provider);
  const official = provider === 'meta' && capability?.oauthConfigured === true;
  const canCreate = success && (success.currency === 'USD' || (success.provider === 'meta' && success.currency === 'CNY'));
  const accounts = data.items.filter(item => item.provider === provider);
  useEffect(() => { if (reauthorize) guideRef.current?.focus(); }, [reauthorize]);
  useEffect(() => { if (success) successRef.current?.focus(); }, [success]);
  useEffect(() => () => { generation.current += 1; }, []);
  const refreshLiveStatus = async (items: AdConnection[], current: number) => {
    const statusRun = ++statusGeneration.current;
    if (current === generation.current) setLiveStatus({});
    await Promise.all(items.filter(item => item.provider === 'meta').map(async item => {
      try {
        const status = await platformAdsRequest<{ accountStatus: number; checkedAt: string }>(`/connections/${encodeURIComponent(item.id)}/live-status`);
        if (current === generation.current && statusRun === statusGeneration.current) setLiveStatus(value => ({ ...value, [item.id]: status }));
      } catch { /* Failed reads stay unknown rather than appearing healthy. */ }
    }));
  };
  const load = async () => {
    setLoading(true); setLoadError('');
    const current = generation.current;
    try {
      const result = await platformAdsRequest<Connections>('/connections');
      if (current !== generation.current) return;
      setData(result);
      void refreshLiveStatus(result.items, current);
    } catch (e) { if (current === generation.current) setLoadError(errorMessage(e)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => {
    if (!data.items.length) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshLiveStatus(data.items, generation.current); }, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshLiveStatus(data.items, generation.current); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [data.items]);
  useEffect(() => {
    const changed = () => { generation.current++; setData({ items: [], capabilities: [] }); setLiveStatus({}); setSuccess(null); setCampaigns(null); setResources(null); setLastSync(null); setReauthorize(null); setToken(''); setAccountId(''); setBusy(false); setError(''); void load(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
    void load();
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
  }, []);
  const switchProvider = (next: Provider) => {
    if (busy || next === provider) return;
    generation.current += 1;
    setProvider(next); setAccountId(''); setToken('');
    setReauthorize(null); setSuccess(null); setCampaigns(null); setResources(null); setLastSync(null); setError('');
  };
  const run = async (operation: (current: number) => Promise<void>) => {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { await operation(current); } catch (e) { if (current === generation.current) setError(errorMessage(e)); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const connected = (connection: AdConnection, current: number) => {
    if (current !== generation.current) return;
    directory?.refresh();
    statusGeneration.current++;
    setLiveStatus(value => { const next = { ...value }; delete next[connection.id]; return next; });
    setData(current => ({ ...current, items: [connection, ...current.items.filter(item => item.id !== connection.id)] }));
    setToken(''); setAccountId(''); setReauthorize(null); setSuccess(connection); setCampaigns(null); setResources(null); setLastSync(null);
  };
  const showResources = async (connection: AdConnection, level: PlatformAdResourceLevel) => {
    const current = generation.current;
    const result = await platformAdsApi.listResources(connection.id, level);
    if (current !== generation.current) return;
    setResources({ connection, level, items: result.items, hasMore: result.hasMore });
  };
  const syncResources = async (connection: AdConnection) => {
    if (connection.provider !== 'meta') throw new Error('账户结构同步首版仅支持 Meta。');
    const current = generation.current;
    const result = await platformAdsApi.syncResources(connection.id);
    if (current !== generation.current) return;
    setLastSync(result);
    await showResources(connection, 'campaign');
  };
  const syncAndView = (connection: AdConnection) => run(async current => {
    setResources(null); setCampaigns(null); setLastSync(null);
    const result = await platformAdsRequest<{ items: Campaign[]; hasMore?: boolean }>(`/connections/${encodeURIComponent(connection.id)}/campaigns`);
    if (current !== generation.current) return;
    setCampaigns({ connection, ...result });
    if (connection.provider === 'meta') {
      if (connection.status !== 'connected' || !connection.timezoneName) throw new Error('平台计划已读取；账户受限或时区未核验，暂无法同步广告组和广告。');
      await syncResources(connection);
    }
  });
  const checkAuthorization = (account: AdConnection) => run(async () => {
    const current = generation.current;
    try {
      const result = await platformAdsRequest<{ connection: AdConnection }>(`/connections/${encodeURIComponent(account.id)}/authorization/check`, { method: 'POST' });
      if (current !== generation.current) return;
      setData(value => ({ ...value, items: value.items.map(item => item.id === account.id ? result.connection : item) }));
      directory?.refresh();
    } catch (e) { throw new Error(`本次授权检查未完成，保留上次检查结果。${errorMessage(e)}`); }
  });
  const connect = (event: FormEvent) => {
    event.preventDefault();
    void run(async current => {
      const id = normalizeAdAccountId(provider, accountId);
      if (!token.trim()) throw new Error('请输入访问令牌。');
      const result = await platformAdsRequest<{ connection: AdConnection }>('/connections', { method: 'POST', body: JSON.stringify({ provider, accountId: id, accessToken: token.trim() }) });
      connected(result.connection, current);
    });
  };

  return <div className="ad-connect">
    <p className="ads-muted">先选择广告平台，再连接对应账户。广告账户连接与社媒发布授权独立。</p>
    <div className="ad-connect-platforms" role="group" aria-label="选择广告平台">
      {(Object.keys(platforms) as Provider[]).map(key => <button type="button" key={key} aria-pressed={provider === key} disabled={busy || loading || key !== 'meta'} onClick={() => switchProvider(key)} className={provider === key ? 'selected' : ''}>
        <span className={`ad-platform-mark ${key}`} aria-hidden="true"><ProviderLogos provider={key}/></span><strong className="sr-only">{platforms[key].name}</strong><small>{key === 'meta' ? platforms[key].channels : '未开放'}</small>
      </button>)}
    </div>
    {loading ? <p role="status">正在读取账户与连接方式…</p> : loadError ? <div role="alert"><p>{loadError}</p><button className="ads-button" onClick={() => void load()}>重新加载</button></div> : <>
      {provider !== 'meta' && <ol className="ad-connect-steps" aria-label="连接进度"><li className="done">1 选择平台</li><li className={!success ? 'current' : 'done'}>2 验证账户</li><li className={success ? 'current' : ''}>3 连接完成</li></ol>}
      {error && <p role="alert" className="ads-operation-error">{error}</p>}
      {success ? <div className="ad-connect-success" ref={successRef} tabIndex={-1}>
        <CheckCircle2 size={28} aria-hidden="true" /><h3>{success.status === 'connected' ? '广告账户已连接' : '账户已保存，使用受限'}</h3>
        <p><strong>{success.name}</strong></p><p>{platform.name} · {success.accountId} · {success.currency}{success.timezoneName ? ` · ${success.timezoneName}` : ' · 账户时区待平台返回'}</p>
        {success.defaultPage && <p>已选主页：{success.defaultPage.name} · 后续投放仍会重新核验权限。</p>}
        <p>{success.status === 'connected' ? '连接不会启动广告。创建计划后，仍需完成素材、预算和投放检查。' : '平台返回账户受限状态，请在广告平台处理账户问题后重新验证。'}</p>
        {!canCreate && <p>该账户币种暂不支持在灵枢创建计划，可查看和导入已有平台计划。</p>}
        <div className="ads-actions">{success.status === 'connected' && onContinue && <button className="ads-button primary" disabled={!canCreate} onClick={() => onContinue(success)}>{continueLabel}</button>}<button className="ads-button" onClick={() => setSuccess(null)}>管理或连接其他账户</button></div>
      </div> : provider === 'meta' ? <div ref={guideRef} tabIndex={-1}>{reauthorize && <p role="status">重新授权：{reauthorize.name}。请在 Meta 选择原广告账户，历史计划和数据会保留。</p>}<AdMetaConnectionGuide key={`${authHeader().Authorization || ''}:${reauthorize?.attempt || 0}`} configured={official} missing={capability?.oauthReadiness?.missing} targetAccountId={data.items.find(item => item.id === reauthorize?.id)?.accountId} onConnected={connection => connected(connection, renderGeneration)}/></div> : <section className="ad-connect-method" aria-label={`连接 ${platform.name}`}>
        <h3>连接 {platform.name}</h3><p className="ads-muted">{platform.scope}</p>
        {!capability?.configured ? <p role="status" className="ad-connect-note">该平台连接暂不可用，请联系管理员完成配置后重试。你仍可查看下方已保存的账户。</p> : <>
          <form className="ads-form-fields" onSubmit={connect} autoComplete="off">
            <p className="ad-connect-note">当前使用访问令牌连接，请准备对应账户 ID 和有权访问该账户的令牌。</p>
            <label>{platform.account}<input required name={`${provider}-ad-account-id`} autoComplete="off" spellCheck={false} value={accountId} disabled={busy} onChange={e => setAccountId(e.target.value)} placeholder={platform.example} aria-describedby="ad-account-help" /></label>
            <small id="ad-account-help" className="ads-muted">{platform.help}</small>
            <label>{platform.name} 访问令牌<input required name={`${provider}-ad-access-token`} type="password" autoComplete="new-password" spellCheck={false} maxLength={10000} value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>
            <details className="ad-connect-help"><summary>如何准备访问令牌？</summary><p>{platform.token}</p><p>没有令牌时，请联系负责该广告账户的管理员协助连接。</p></details>
            <button className="ads-button primary" disabled={busy || !accountId.trim() || !token.trim()}>{busy ? '正在验证账户…' : `验证并连接 ${platform.name}`}</button>
          </form>
        </>}
      </section>}
      <section className="ad-connected-accounts" aria-label={`${platform.name} 已保存账户`}><h3><Link2 size={17} /> {platform.name} 已保存账户 <span>{accounts.length}</span></h3>
        {!accounts.length ? <p className="ads-muted">尚未连接 {platform.name} 广告账户。连接后可读取平台计划。</p> : accounts.map(account => <article className="ad-saved-account" key={account.id} aria-label={`${account.name} 广告账户`}>
          <header className="ad-saved-account-header"><strong>{account.name}</strong><span className="ad-saved-account-status">{account.status === 'connected' ? '已连接' : '使用受限，需处理'}</span></header>
          <dl className="ad-saved-account-facts"><div><dt>账户 ID</dt><dd>{account.accountId}</dd></div><div><dt>结算币种</dt><dd>{account.currency}</dd></div><div><dt>账户时区</dt><dd>{account.timezoneName || '待核验'}</dd></div></dl>
          <dl className="ad-saved-account-facts ad-account-health"><div><dt>账户余额</dt><dd>暂不可获取</dd></div><div><dt>账户提醒</dt><dd role="status">{accountNotice(account, liveStatus[account.id])}</dd></div></dl>
          <div className="ad-saved-account-actions"><button className="ads-button" disabled={busy} onClick={() => syncAndView(account)}>{busy ? '同步中…' : '同步并查看平台计划'}</button></div>
          <details className="ad-connect-help ad-saved-account-maintenance"><summary>连接与账户维护</summary>
            <div className="ad-saved-account-maintenance-items">
              {account.provider === 'meta' && <><div><button className="ads-text-button" disabled={busy} onClick={() => void checkAuthorization(account)}>检查连接是否可用</button><p>核对当前凭证是否过期、撤销或缺少权限，不要求重新登录。</p></div><div><button className="ads-text-button" disabled={busy || !official} title={!official ? '请联系管理员恢复 Meta 官方授权配置' : undefined} onClick={() => { setSuccess(null); setReauthorize(current => ({ id: account.id, name: account.name, attempt: (current?.attempt || 0) + 1 })); }}>重新登录 Meta</button><p>前往 Meta 登录并重新确认此账户的访问权限。</p></div></>}
              <div><button className="ads-text-button" disabled={busy} onClick={() => void run(async current => { const result = await platformAdsRequest<{ connection: AdConnection }>(`/connections/${encodeURIComponent(account.id)}/verify`, { method: 'POST' }); connected(result.connection, current); })}>更新账户名称、币种和时区</button><p>重新读取平台账户信息，更新本地保存的资料。</p></div>
            </div>
          </details>
        </article>)}
      </section>
      {resources && <section className="ad-connect-campaigns"><h3>{resources.connection.name} 的已同步计划与广告</h3><p className="ads-muted">数据来自 Meta API，同步只读取平台数据，不修改或启动广告。金额按 {resources.connection.currency}，日期边界按 {resources.connection.timezoneName}。</p>{lastSync && <p role="status">同步完成：计划 {lastSync.counts.campaign}、广告组 {lastSync.counts.adset}、广告 {lastSync.counts.ad}。</p>}<div className="ads-actions">{([['campaign', '计划'], ['adset', '广告组'], ['ad', '广告']] as const).map(([level, label]) => <button key={level} className={resources.level === level ? 'ads-button primary' : 'ads-button'} disabled={busy} onClick={() => void run(() => showResources(resources.connection, level))}>{label}</button>)}</div>{!resources.items.length && <p role="status">当前层级暂无已同步对象。</p>}{resources.items.map(item => <div className="ads-account-option" key={item.id}><div><strong>{item.name || `未命名${item.level}`}</strong><small>{item.providerResourceId} · {item.effectiveStatus || item.configuredStatus || '状态待核验'}</small></div></div>)}{resources.hasMore && <p className="ads-muted">当前仅展示前 200 条，请通过 Meta 广告管理工具核对完整范围。</p>}</section>}
      {campaigns && <section className="ad-connect-campaigns"><h3>{campaigns.connection.name} 的平台计划</h3><p className="ads-muted">同步后可在这里查看平台计划；要在计划管理中查看已有计划的消耗，请选择“导入为只读计划”。查看及导入不会修改平台广告。</p>{!campaigns.items.length && <p role="status">该账户暂无可读取的投放计划。</p>}{campaigns.items.map(campaign => <div className="ads-account-option" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.id} · {({ ACTIVE: '已启用', ENABLE: '已启用', ENABLED: '已启用', PAUSED: '已暂停', DISABLE: '已停用', DELETED: '已删除' } as Record<string, string>)[campaign.effective_status || campaign.status || ''] || '状态待核验'}</small></div>{onTaskImported && <button className="ads-button" disabled={busy} onClick={() => void run(async current => { const result = await platformAdsRequest<{ task: PlatformAdTask }>(`/connections/${encodeURIComponent(campaigns.connection.id)}/import`, { method: 'POST', body: JSON.stringify({ campaignId: campaign.id }) }); if (current === generation.current) onTaskImported(result.task); })}>导入为只读计划</button>}</div>)}{campaigns.hasMore && <p className="ads-muted">当前仅展示首批计划，更多计划请前往广告平台查看。</p>}</section>}
    </>}
    <p className="ad-connect-footer">凭证经验证后加密保存。连接账户不会创建或启动广告。</p>
  </div>;
}
