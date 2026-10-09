import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';

type MessengerPage = {
  id: string;
  providerAccountId: string;
  title: string;
  status: string;
  messengerSubscribed?: boolean;
  messengerSubscriptionError?: string;
};

export default function MessengerConnectionPanel() {
  const [pages, setPages] = useState<MessengerPage[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const oauthPopup = useRef<Window | null>(null);
  const oauthOrigin = useRef(window.location.origin);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [statusResponse, accountsResponse] = await Promise.all([
        fetch('/api/overseas/social/oauth/facebook/status', { headers: authHeader() }),
        fetch('/api/overseas/social/accounts?platform=facebook', { headers: authHeader() }),
      ]);
      const status = await statusResponse.json();
      const accounts = await accountsResponse.json();
      if (!statusResponse.ok || !accountsResponse.ok) throw new Error(status.error || accounts.error || '读取 Messenger 连接状态失败');
      setConfigured(Boolean(status.configured));
      setPages(Array.isArray(accounts.items) ? accounts.items : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取 Messenger 连接状态失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== oauthOrigin.current || event.source !== oauthPopup.current || event.data?.type !== 'social-oauth' || event.data?.platform !== 'facebook') return;
      setConnecting(false);
      if (event.data.status === 'success') void load();
      else setError(event.data.message || 'Messenger 授权未完成');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  const connect = async () => {
    setConnecting(true); setError('');
    const popup = window.open('', `messenger-oauth-${Date.now()}`, 'width=620,height=760,menubar=no,toolbar=no,location=yes,status=no');
    oauthPopup.current = popup;
    try {
      const response = await fetch('/api/overseas/social/oauth/facebook/start', {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}`, purpose: 'messenger' }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Messenger 授权地址生成失败');
      oauthOrigin.current = new URL(data.redirectUri, window.location.origin).origin;
      if (popup) popup.location.replace(data.url); else window.location.assign(data.url);
    } catch (reason) {
      popup?.close(); setConnecting(false);
      setError(reason instanceof Error ? reason.message : 'Messenger 授权启动失败');
    }
  };

  const connected = pages.some(page => page.status === 'connected' && page.messengerSubscribed);
  return <section className="flex min-h-[360px] flex-col rounded-lg border border-border bg-white p-4 sm:p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50"><SocialPlatformIcon platform="messenger" size={24}/></span><div><h2 className="text-sm font-semibold text-text-primary">Messenger 主页消息接入</h2><p className="mt-1 text-xs leading-relaxed text-text-muted">使用个人 Facebook 账号授权你管理的公共主页。客户发给该主页的新消息会进入“我的会话”，可直接回复；个人账号与好友之间的私人聊天不会同步。</p></div></div>
      <div className="flex shrink-0 gap-2"><button type="button" aria-label="刷新 Messenger 状态" onClick={() => void load()} className="rounded-md border border-border p-2 text-text-muted"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/></button><button type="button" onClick={() => void connect()} disabled={loading || connecting || !configured} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-45">{connecting ? <Loader2 size={15} className="animate-spin"/> : <SocialPlatformIcon platform="messenger" size={17}/>} {connected ? '重新授权主页' : '连接 Facebook 主页'}</button></div>
    </div>
    {error && <p role="alert" className="mt-4 flex items-start gap-2 border-l-2 border-red bg-red/5 px-3 py-2 text-xs text-red"><AlertCircle size={14}/>{error}</p>}
    {!configured && !loading && <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">请先在上方填写 Meta App ID、App Secret 和 Webhook Verify Token。</p>}
    <div className="mt-auto space-y-2 pt-5">{pages.map(page => <div key={page.id} className="rounded-md border border-border px-3 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-text-primary">{page.title}</p><p className="mt-1 text-[10px] text-text-muted">Page ID: {page.providerAccountId}</p></div><span className={`inline-flex items-center gap-1 text-[10px] font-bold ${page.messengerSubscribed ? 'text-accent' : 'text-amber-700'}`}>{page.messengerSubscribed && <CheckCircle2 size={12}/>} {page.messengerSubscribed ? '主页收发已连接' : '等待主页消息权限'}</span></div>{page.messengerSubscriptionError && <p className="mt-2 text-[10px] leading-4 text-amber-700">{page.messengerSubscriptionError}</p>}</div>)}{!loading && !pages.length && <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-text-muted">尚未连接 Facebook Page。</div>}</div>
  </section>;
}
