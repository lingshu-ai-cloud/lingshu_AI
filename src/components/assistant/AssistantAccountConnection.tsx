import { useEffect, useRef, useState } from 'react';
import { Button, Select } from 'antd';
import { CONNECTION_PLATFORMS, CONNECTION_LABELS, type ConnectionPlatform } from '../../../shared/assistantAccountConnection';
import { authHeader, getToken, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { closeOAuthPopup, navigateOAuthPopup, prepareOAuthPopup, readOAuthStartResponse } from '../../lib/oauthPopup';

type Account = { id: string; title?: string; channelTitle?: string; handle?: string; status: string };
export const connectionEndpoints = (platform: ConnectionPlatform) => ({
  status: platform === 'youtube' ? '/api/overseas/youtube/oauth/status' : `/api/overseas/social/oauth/${platform}/status`,
  accounts: platform === 'youtube' ? '/api/overseas/youtube/accounts' : `/api/overseas/social/accounts?platform=${platform}`,
  start: platform === 'youtube' ? '/api/overseas/youtube/oauth/start' : `/api/overseas/social/oauth/${platform}/start`,
});
/** The platform callback persists verified identities using the existing tenant-scoped OAuth service. */
export default function AssistantAccountConnection({ platform: initial }: { platform?: ConnectionPlatform }) {
  const [platform, setPlatform] = useState<ConnectionPlatform | undefined>(initial);
  const [configured, setConfigured] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const popup = useRef<Window | null>(null);
  const generation = useRef(0);
  const [sessionToken] = useState(getToken);
  const [sessionValid, setSessionValid] = useState(true);
  useEffect(() => {
    const changed = () => { if (getToken() !== sessionToken) { generation.current++; closeOAuthPopup(popup.current); setSessionValid(false); setAccounts([]); setConfigured(false); } };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
  }, [sessionToken]);
  useEffect(() => {
    const controller = new AbortController(), version = ++generation.current;
    setConfigured(false); setAccounts([]); setError(''); setConnecting(false);
    closeOAuthPopup(popup.current); popup.current = null;
    if (!platform) return () => controller.abort();
    const current = () => !controller.signal.aborted && version === generation.current && getToken() === sessionToken;
    setLoading(true);
    const endpoints = connectionEndpoints(platform);
    void Promise.all([endpoints.status, endpoints.accounts].map(async url => {
      const response = await fetch(url, { headers: authHeader(), signal: controller.signal });
      if (!response.ok) throw new Error('账号连接状态读取失败，请重试。');
      return response.json();
    })).then(([status, result]) => {
      if (!current()) return;
      setConfigured(status.configured === true);
      setAccounts(Array.isArray(result.items) ? result.items.filter((item: Account) => item && typeof item.id === 'string' && item.status === 'connected') : []);
    }).catch(() => { if (current()) setError('账号连接状态读取失败，请重试。'); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [platform, revision, sessionToken]);
  useEffect(() => {
    if (!connecting || !platform) return;
    const refreshVerifiedState = () => { setConnecting(false); refresh(value => value + 1); };
    const callback = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== window.location.origin || event.source !== popup.current || data?.source !== 'overseas-workbench') return;
      const matches = platform === 'youtube' ? data.type === 'youtube-oauth' : data.type === 'social-oauth' && data.platform === platform;
      if (matches) refreshVerifiedState(); // Never trust a message as proof of connection: reread the server.
    };
    const timer = window.setInterval(() => { if (popup.current?.closed) refreshVerifiedState(); }, 1500);
    window.addEventListener('message', callback);
    return () => { window.clearInterval(timer); window.removeEventListener('message', callback); };
  }, [connecting, platform]);
  useEffect(() => () => closeOAuthPopup(popup.current), []);
  const start = async () => {
    if (!platform || !configured || connecting || getToken() !== sessionToken) return;
    const version = generation.current;
    popup.current = prepareOAuthPopup(`${platform}-oauth`, 'width=620,height=760,menubar=no,toolbar=no,location=yes,status=no');
    if (!popup.current) { setError('请允许此站点打开授权窗口，然后重试。'); return; }
    setConnecting(true); setError('');
    try {
      const response = await fetch(connectionEndpoints(platform).start, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }) });
      const data = await readOAuthStartResponse(response, CONNECTION_LABELS[platform]);
      if (version !== generation.current || getToken() !== sessionToken) { closeOAuthPopup(popup.current); return; }
      navigateOAuthPopup(popup.current, data.url);
    } catch (error) {
      closeOAuthPopup(popup.current);
      if (version === generation.current && getToken() === sessionToken) { setConnecting(false); setError(error instanceof Error ? error.message : '授权启动失败，请重试。'); }
    }
  };
  if (!sessionValid) return <p role="status" className="mt-3 text-sm text-text-secondary">会话已变更，请重新发送账号连接请求。</p>;
  return <section className="mt-3 rounded-xl border border-border bg-surface p-4" aria-label="在对话中连接账号">
    <div className="flex flex-wrap items-center gap-3">
      <Select aria-label="选择账号平台" value={platform} placeholder="选择平台" disabled={connecting} style={{ minWidth: 150 }}
        options={CONNECTION_PLATFORMS.map(value => ({ value, label: CONNECTION_LABELS[value] }))} onChange={setPlatform}/>
      {platform && <Button type="primary" loading={loading || connecting} disabled={!configured} onClick={() => void start()}>连接并授权 {CONNECTION_LABELS[platform]}</Button>}
      {platform && !connecting && <Button type="text" onClick={() => refresh(value => value + 1)}>刷新状态</Button>}
    </div>
    {connecting && <p role="status" className="mt-3 text-sm text-text-secondary">请在官方授权窗口完成账号选择与授权。</p>}
    {!loading && platform && !configured && !error && <p role="status" className="mt-3 text-sm text-text-secondary">{CONNECTION_LABELS[platform]} 平台应用尚未配置，需要管理员补齐应用配置后才能授权。</p>}
    {error && <p role="alert" className="mt-3 text-sm text-text-secondary">{error}</p>}
    {accounts.length > 0 && <ul className="mt-3 space-y-1 text-sm text-text-primary" aria-label="已连接账号">{accounts.map(account => <li key={account.id}>{account.channelTitle || account.title || account.handle || CONNECTION_LABELS[platform!]} · 已连接</li>)}</ul>}
  </section>;
}
