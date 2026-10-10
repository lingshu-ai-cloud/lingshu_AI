import { useState, useEffect } from 'react';
import {
  Loader2,
  MessageSquare,
  Eye,
  ThumbsUp,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import { closeOAuthPopup, navigateOAuthPopup, prepareOAuthPopup, readOAuthStartResponse } from '../lib/oauthPopup';
import { SocialPlatformIcon } from './SocialPlatformIcon';

interface YouTubeAccount {
  id: string;
  channelId: string;
  channelTitle: string;
  customUrl?: string;
  thumbnailUrl?: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  status: 'connected' | 'error' | 'expired';
  connectedAt?: string;
  lastSyncAt?: string;
}

interface OAuthStatus {
  configured: boolean;
  redirectUri: string;
  scopes: string[];
  manualConnectEnabled?: boolean;
}

interface OAuthWindowMessage {
  source?: string;
  type?: string;
  status?: 'success' | 'error';
  accountId?: string;
  channelTitle?: string;
  message?: string;
}

interface ManualOAuthValues {
  refreshToken: string;
}

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  duration: string;
}

interface YouTubeComment {
  id: string;
  authorName: string;
  authorProfileImageUrl?: string;
  textDisplay: string;
  likeCount: number;
  publishedAt: string;
  videoId: string;
}

type SocialPlatform = 'tiktok' | 'instagram' | 'facebook';

interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  providerAccountId: string;
  title: string;
  handle?: string;
  avatarUrl?: string;
  parentPageName?: string;
  followerCount: number;
  videoCount: number;
  viewCount: number;
  likeCount: number;
  status: 'connected' | 'error' | 'expired';
  connectedAt?: string;
  lastSyncAt?: string;
}

interface SocialOAuthStatus {
  configured: boolean;
  redirectUri: string;
  scopes: string[];
  manualConnectEnabled?: boolean;
}

interface SocialOAuthWindowMessage {
  source?: string;
  type?: string;
  platform?: SocialPlatform;
  status?: 'success' | 'error';
  message?: string;
}

interface ManualSocialValues {
  accessToken: string;
  refreshToken: string;
  providerAccountId: string;
  parentPageId: string;
}

const compactNumber = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function channelUrl(account: YouTubeAccount) {
  return `https://www.youtube.com/channel/${account.channelId}`;
}

function externalAccountUrl(account: { platform: string; providerAccountId: string; handle?: string }) {
  if (account.platform === 'youtube') return `https://www.youtube.com/channel/${account.providerAccountId}`;
  if (account.platform === 'facebook') return `https://www.facebook.com/${account.providerAccountId}`;
  if (account.platform === 'instagram') {
    const handle = account.handle?.replace(/^@/, '').trim();
    return handle ? `https://www.instagram.com/${handle}/` : '';
  }
  if (account.platform === 'tiktok') {
    const handle = account.handle?.replace(/^@/, '').trim();
    return handle ? `https://www.tiktok.com/@${handle}` : '';
  }
  return '';
}

function statusLabel(status: YouTubeAccount['status']) {
  if (status === 'connected') return '已连接';
  if (status === 'expired') return '授权过期';
  return '连接异常';
}

function statusClass(status: YouTubeAccount['status']) {
  if (status === 'connected') return 'text-accent bg-accent-glow';
  if (status === 'expired') return 'text-insight-action bg-insight-soft';
  return 'text-red bg-red/5';
}

export function YouTubeConnectionPanel({ compact = false }: { compact?: boolean }) {
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualValues, setManualValues] = useState<ManualOAuthValues>({
    refreshToken: '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadConnectionState = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, accountsRes] = await Promise.all([
        fetch('/api/overseas/youtube/oauth/status', { headers: authHeader() }),
        fetch('/api/overseas/youtube/accounts', { headers: authHeader() }),
      ]);
      const statusData = await statusRes.json().catch(() => ({})) as OAuthStatus & { error?: string };
      const accountsData = await accountsRes.json().catch(() => ({})) as { items?: YouTubeAccount[]; error?: string };
      if (!statusRes.ok) throw new Error(statusData.error || '无法读取 YouTube 授权配置');
      if (!accountsRes.ok) throw new Error(accountsData.error || '无法读取 YouTube 账号');
      setOauthStatus(statusData);
      setAccounts(accountsData.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取 YouTube 连接状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnectionState();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<OAuthWindowMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== 'overseas-workbench' || data.type !== 'youtube-oauth') return;
      setConnecting(false);
      if (data.status === 'success') {
        setNotice(data.channelTitle ? `${data.channelTitle} 已连接成功` : 'YouTube 已连接成功');
        setError('');
        void loadConnectionState();
      } else {
        setError(data.message || 'YouTube 授权没有完成');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startOAuth = async () => {
    const popup = prepareOAuthPopup('youtube-oauth', 'width=580,height=720,menubar=no,toolbar=no,location=yes,status=no');
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/youtube/oauth/start', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const data = await readOAuthStartResponse(r, 'YouTube');
      navigateOAuthPopup(popup, data.url);
    } catch (e) {
      closeOAuthPopup(popup);
      setConnecting(false);
      setError(e instanceof Error ? e.message : 'YouTube 授权启动失败');
    }
  };

  const disconnectAccount = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      const r = await fetch(`/api/overseas/youtube/accounts/${id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error || '断开 YouTube 失败');
      setAccounts(prev => prev.filter(a => a.id !== id));
      setNotice('YouTube 账号已断开');
    } catch (e) {
      setError(e instanceof Error ? e.message : '断开 YouTube 失败');
    } finally {
      setDeletingId(null);
    }
  };

  const connectManually = async () => {
    if (!manualValues.refreshToken.trim()) {
      setError('请填写 Refresh Token');
      return;
    }

    setManualSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/youtube/connect', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: manualValues.refreshToken.trim(),
        }),
      });
      const data = await r.json().catch(() => ({})) as { channelTitle?: string; error?: string };
      if (!r.ok) throw new Error(data.error || 'YouTube 手动接入失败');

      setNotice(data.channelTitle ? `${data.channelTitle} 已连接成功` : 'YouTube 已连接成功');
      setManualValues({ refreshToken: '' });
      setManualOpen(false);
      await loadConnectionState();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'YouTube 手动接入失败');
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <section className={`flex h-full min-h-[360px] flex-col rounded-lg border border-border bg-white ${compact ? 'p-4' : 'p-4 sm:p-5'}`}>
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
            <SocialPlatformIcon platform="youtube" size={24} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">YouTube 一键授权</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              登录您的 YouTube 账号并允许授权后，AI 生成的视频即可直接发布到该频道。
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-start gap-2 sm:justify-end">
          <button
            onClick={() => void loadConnectionState()}
            disabled={loading}
            title="刷新"
            aria-label="刷新 YouTube 连接状态"
            className="rounded-md border border-border p-2 text-text-muted hover:border-border-bright hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => void startOAuth()}
            disabled={connecting || loading}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <SocialPlatformIcon platform="youtube" size={17} />}
            {accounts.length > 0 ? '重新连接' : '连接 YouTube'}
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className="mt-4 flex items-start gap-2 border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs text-accent">
          <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 border-l-2 border-red bg-red/5 px-3 py-2 text-xs text-red">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {oauthStatus?.manualConnectEnabled && (
      <div className="mt-4 border-t border-border pt-4">
        <button
          onClick={() => setManualOpen(v => !v)}
          className="text-xs font-semibold text-text-muted hover:text-text-primary"
          aria-expanded={manualOpen}
        >
          {manualOpen ? '收起手动接入' : '手动接入'}
        </button>

        {manualOpen && (
          <div className="mt-3 grid gap-3 border-y border-border bg-surface-2 p-3">
            <p className="text-xs leading-relaxed text-text-muted">
              适用于已完成授权但需要手动补充频道凭据的场景。请按服务顾问提供的信息填写。
            </p>
            <div className="grid gap-2 md:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-text-secondary">
                Refresh Token
                <input
                  type="password"
                  value={manualValues.refreshToken}
                  onChange={e => setManualValues(v => ({ ...v, refreshToken: e.target.value }))}
                  placeholder="1//..."
                  className="ui-field !rounded-md !text-xs"
                />
              </label>
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={() => void connectManually()}
                disabled={manualSaving}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-dim disabled:opacity-50"
              >
                {manualSaving && <Loader2 size={12} className="animate-spin" />}
                保存并连接
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {loading ? (
        <div className="mt-auto flex min-h-[104px] items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" /> 正在读取 YouTube 连接状态...
        </div>
      ) : accounts.length > 0 ? (
        <div className="mt-auto grid gap-3" style={{ gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {accounts.map(account => (
            <div key={account.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                {account.thumbnailUrl ? (
                  <img src={account.thumbnailUrl} alt={account.channelTitle} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
                    <SocialPlatformIcon platform="youtube" size={22} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{account.channelTitle}</p>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex-shrink-0 ${statusClass(account.status)}`}>
                      {statusLabel(account.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">{account.channelId}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <p className="text-xs font-semibold text-text-primary">{compactNumber.format(account.subscriberCount || 0)}</p>
                      <p className="text-[10px] text-text-muted">订阅</p>
                    </div>
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <p className="text-xs font-semibold text-text-primary">{compactNumber.format(account.videoCount || 0)}</p>
                      <p className="text-[10px] text-text-muted">视频</p>
                    </div>
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <p className="text-xs font-semibold text-text-primary">{compactNumber.format(account.viewCount || 0)}</p>
                      <p className="text-[10px] text-text-muted">播放</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <a
                  href={channelUrl(account)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-border-bright hover:text-text-primary"
                >
                  <ExternalLink size={12} /> 打开频道
                </a>
                <button
                  onClick={() => void disconnectAccount(account.id)}
                  disabled={deletingId === account.id}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:border-red hover:text-red disabled:opacity-50"
                >
                  {deletingId === account.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  断开
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-auto rounded-md border border-dashed border-border px-4 py-5 text-center">
          <SocialPlatformIcon platform="youtube" size={32} className="mx-auto mb-2 opacity-35" />
          <p className="text-sm font-medium text-text-secondary">还没有连接 YouTube 频道</p>
          <p className="mt-1 text-xs text-text-muted">连接后，我的社媒里的 AI 生成视频可以一键发布到 YouTube。</p>
        </div>
      )}
    </section>
  );
}

const SOCIAL_META: Record<SocialPlatform, {
  label: string;
  description: string;
  envHint: string;
  color: string;
  bg: string;
}> = {
  tiktok: {
    label: 'TikTok',
    description: '连接 TikTok 后可读取账号视频数据，并通过 Content Posting API 发布短视频。',
    envHint: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET',
    color: '#111827',
    bg: '#eef2ff',
  },
  instagram: {
    label: 'Instagram',
    description: '连接 Instagram 专业账号后，可读取账号与媒体基本信息，并由用户确认后发布内容。',
    envHint: 'INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET',
    color: '#c13584',
    bg: '#fdf2f8',
  },
  facebook: {
    label: 'Facebook',
    description: '连接 Facebook Page 后可读取主页与内容基本信息，并由用户确认后发布视频。',
    envHint: 'META_SOCIAL_APP_ID / META_SOCIAL_APP_SECRET',
    color: '#1877f2',
    bg: '#eff6ff',
  },
};

const emptyManualSocialValues: ManualSocialValues = {
  accessToken: '',
  refreshToken: '',
  providerAccountId: '',
  parentPageId: '',
};

const SOCIAL_MANUAL_COPY: Record<SocialPlatform, {
  tokenLabel: string;
  tokenPlaceholder: string;
  accountLabel: string;
  accountPlaceholder: string;
  pageLabel?: string;
  pagePlaceholder?: string;
  helper: string;
}> = {
  tiktok: {
    tokenLabel: 'Access Token',
    tokenPlaceholder: 'act....',
    accountLabel: 'Open ID（可选）',
    accountPlaceholder: '系统会自动识别，可不填',
    pageLabel: 'Refresh Token（可选）',
    pagePlaceholder: '用于后续刷新授权',
    helper: '适用于已完成 TikTok 授权但需要手动补充账号凭据的场景。系统会先读取账号资料，成功后才保存。',
  },
  instagram: {
    tokenLabel: 'Meta Access Token',
    tokenPlaceholder: 'User Token 或 Page Token',
    accountLabel: 'Facebook Page ID（可选）',
    accountPlaceholder: '不填则自动识别',
    helper: '填一个未过期的 Meta Access Token 即可；系统会自动查找 Facebook Page 和已绑定的 Instagram 专业账号。',
  },
  facebook: {
    tokenLabel: 'Meta Access Token',
    tokenPlaceholder: 'User Token 或 Page Token',
    accountLabel: 'Facebook Page ID（可选）',
    accountPlaceholder: '不填则自动识别',
    helper: '填一个未过期的 Meta Access Token 即可；系统会自动查找并连接可管理的 Facebook Page。',
  },
};

export function SocialConnectionPanel({ platform }: { platform: SocialPlatform }) {
  const meta = SOCIAL_META[platform];
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [status, setStatus] = useState<SocialOAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualValues, setManualValues] = useState<ManualSocialValues>(emptyManualSocialValues);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const manualCopy = SOCIAL_MANUAL_COPY[platform];
  const loadState = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, accountsRes] = await Promise.all([
        fetch(`/api/overseas/social/oauth/${platform}/status`, { headers: authHeader() }),
        fetch(`/api/overseas/social/accounts?platform=${platform}`, { headers: authHeader() }),
      ]);
      const statusData = await statusRes.json().catch(() => ({})) as SocialOAuthStatus & { error?: string };
      const accountsData = await accountsRes.json().catch(() => ({})) as { items?: SocialAccount[]; error?: string };
      if (!statusRes.ok) throw new Error(statusData.error || `无法读取 ${meta.label} 授权配置`);
      if (!accountsRes.ok) throw new Error(accountsData.error || `无法读取 ${meta.label} 账号`);
      setStatus(statusData);
      setAccounts(accountsData.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : `读取 ${meta.label} 连接状态失败`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadState(); }, [platform]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<SocialOAuthWindowMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== 'overseas-workbench' || data.type !== 'social-oauth' || data.platform !== platform) return;
      setConnecting(false);
      if (data.status === 'success') {
        setNotice(`${meta.label} 已连接成功`);
        setError('');
        void loadState();
      } else {
        setError(data.message || `${meta.label} 授权没有完成`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [platform]);

  const startOAuth = async () => {
    const popup = prepareOAuthPopup(`${platform}-oauth`, 'width=620,height=760,menubar=no,toolbar=no,location=yes,status=no');
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/overseas/social/oauth/${platform}/start`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const data = await readOAuthStartResponse(r, meta.label);
      navigateOAuthPopup(popup, data.url);
    } catch (e) {
      closeOAuthPopup(popup);
      setConnecting(false);
      setError(e instanceof Error ? e.message : `${meta.label} 授权启动失败`);
    }
  };

  const disconnect = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      const r = await fetch(`/api/overseas/social/accounts/${id}`, { method: 'DELETE', headers: authHeader() });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error || `断开 ${meta.label} 失败`);
      setAccounts(prev => prev.filter(a => a.id !== id));
      setNotice(`${meta.label} 账号已断开`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `断开 ${meta.label} 失败`);
    } finally {
      setDeletingId(null);
    }
  };

  const connectManually = async () => {
    const accessToken = manualValues.accessToken.trim();
    const providerAccountId = manualValues.providerAccountId.trim();
    const parentPageId = manualValues.parentPageId.trim();

    if (!accessToken) {
      setError(`请填写 ${manualCopy.tokenLabel}`);
      return;
    }

    setManualSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/social/connect/manual', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          accessToken,
          refreshToken: manualValues.refreshToken.trim(),
          providerAccountId,
          parentPageId,
        }),
      });
      const data = await r.json().catch(() => ({})) as { account?: SocialAccount; error?: string };
      if (!r.ok) throw new Error(data.error || `${meta.label} 手动接入失败`);
      setNotice(data.account?.title ? `${data.account.title} 已连接成功` : `${meta.label} 已连接成功`);
      setManualValues(emptyManualSocialValues);
      setManualOpen(false);
      await loadState();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${meta.label} 手动接入失败`);
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-[360px] flex-col rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg, color: meta.color }}>
            <SocialPlatformIcon platform={platform} size={24} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate whitespace-nowrap text-sm font-semibold text-text-primary">{meta.label} 授权</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted sm:min-h-[72px]">{meta.description}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-start gap-2 sm:justify-end">
          <button type="button" onClick={() => void loadState()} disabled={loading} title="刷新" aria-label={`刷新 ${meta.label} 连接状态`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-text-muted hover:border-border-bright hover:bg-surface-2 hover:text-text-primary disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={() => void startOAuth()} disabled={connecting || loading}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50 sm:w-[156px] sm:flex-none">
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <SocialPlatformIcon platform={platform} size={17} />}
            {accounts.length > 0 ? '重新连接' : `连接 ${meta.label}`}
          </button>
        </div>
      </div>

      <div className="mt-4 min-h-[132px]">
        {notice && (
          <div role="status" className="mb-3 flex items-start gap-2 border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs text-accent">
            <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="mb-3 flex items-start gap-2 border-l-2 border-red bg-red/5 px-3 py-2 text-xs text-red">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {status?.manualConnectEnabled && (
      <div className="mt-4 border-t border-border pt-4">
        <button
          onClick={() => setManualOpen(v => !v)}
          className="text-xs font-semibold text-text-muted hover:text-text-primary"
          aria-expanded={manualOpen}
        >
          {manualOpen ? '收起手动接入' : '手动接入'}
        </button>

        {manualOpen && (
          <div className="mt-3 grid gap-3 border-y border-border bg-surface-2 p-3">
            <p className="text-xs leading-relaxed text-text-muted">{manualCopy.helper}</p>
            <div className={`grid gap-2 ${manualCopy.pageLabel ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              <label className="grid gap-1 text-xs font-semibold text-text-secondary">
                {manualCopy.tokenLabel}
                <input
                  type="password"
                  value={manualValues.accessToken}
                  onChange={e => setManualValues(v => ({ ...v, accessToken: e.target.value }))}
                  placeholder={manualCopy.tokenPlaceholder}
                  className="ui-field !rounded-md !text-xs"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-text-secondary">
                {manualCopy.accountLabel}
                <input
                  value={manualValues.providerAccountId}
                  onChange={e => setManualValues(v => ({ ...v, providerAccountId: e.target.value }))}
                  placeholder={manualCopy.accountPlaceholder}
                  className="ui-field !rounded-md !text-xs"
                />
              </label>
              {manualCopy.pageLabel && (
                <label className="grid gap-1 text-xs font-semibold text-text-secondary">
                  {manualCopy.pageLabel}
                  <input
                    type={platform === 'tiktok' ? 'password' : 'text'}
                    value={platform === 'tiktok' ? manualValues.refreshToken : manualValues.parentPageId}
                    onChange={e => setManualValues(v => platform === 'tiktok'
                      ? { ...v, refreshToken: e.target.value }
                      : { ...v, parentPageId: e.target.value })}
                    placeholder={manualCopy.pagePlaceholder}
                    className="ui-field !rounded-md !text-xs"
                  />
                </label>
              )}
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={() => void connectManually()}
                disabled={manualSaving}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-dim disabled:opacity-50"
              >
                {manualSaving && <Loader2 size={12} className="animate-spin" />}
                保存并连接
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {loading ? (
        <div className="mt-auto flex min-h-[104px] items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" /> 正在读取 {meta.label} 连接状态...
        </div>
      ) : accounts.length > 0 ? (
        <div className="mt-auto grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {accounts.map(account => (
            <div key={account.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt={account.title} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg, color: meta.color }}>
                    <SocialPlatformIcon platform={platform} size={22} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{account.title}</p>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex-shrink-0 ${statusClass(account.status)}`}>
                      {statusLabel(account.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">{account.handle || account.providerAccountId}</p>
                  {account.parentPageName && <p className="mt-0.5 truncate text-[11px] text-text-muted">Page: {account.parentPageName}</p>}
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {externalAccountUrl(account) && (
                  <a
                    href={externalAccountUrl(account)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-border-bright hover:text-text-primary"
                  >
                    <ExternalLink size={12} /> 打开主页
                  </a>
                )}
                <button onClick={() => void disconnect(account.id)} disabled={deletingId === account.id}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:border-red hover:text-red disabled:opacity-50">
                  {deletingId === account.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  断开
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-auto rounded-md border border-dashed border-border px-4 py-5 text-center">
          <SocialPlatformIcon platform={platform} size={32} className="mx-auto mb-2 opacity-35" />
          <p className="text-sm font-medium text-text-secondary">还没有连接 {meta.label} 账号</p>
          <p className="mt-1 text-xs text-text-muted">连接后会出现在「频道总览」和「一键发布」里。</p>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN');
}

function platformTone(platform: string) {
  if (platform === 'youtube') return { background: '#fff1f2', color: '#dc2626' };
  if (platform === 'tiktok') return { background: '#eef2ff', color: '#111827' };
  if (platform === 'facebook') return { background: '#eff6ff', color: '#1877f2' };
  return { background: '#fdf2f8', color: '#be185d' };
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeader() });
  const data = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

export function ChannelOverview() {
  type OverviewPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  const [platform, setPlatform] = useState<OverviewPlatform>('youtube');
  type OverviewAccount = {
    id: string;
    platform: OverviewPlatform;
    providerAccountId: string;
    title: string;
    handle?: string;
    avatarUrl?: string;
    followerCount: number;
    videoCount: number;
    viewCount: number;
    likeCount: number;
    status: 'connected' | 'error' | 'expired';
    parentPageName?: string;
  };
  type OverviewVideo = YouTubeVideo & { permalinkUrl?: string };
  const [accounts, setAccounts] = useState<OverviewAccount[]>([]);
  const [counts, setCounts] = useState<Record<OverviewPlatform, number>>({ youtube: 0, tiktok: 0, instagram: 0, facebook: 0 });
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [videos, setVideos] = useState<OverviewVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [comments, setComments] = useState<YouTubeComment[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [videosLoading, setVideosLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null;
  const selectedVideo = videos.find(v => v.id === selectedVideoId) ?? null;

  const currentPlatform = platform as OverviewPlatform;
  const commentsEnabled = currentPlatform !== 'facebook' && currentPlatform !== 'instagram';
  const accountUrl = (account: OverviewAccount) => externalAccountUrl(account);
  const mapYouTube = (a: YouTubeAccount): OverviewAccount => ({
    id: a.id,
    platform: 'youtube',
    providerAccountId: a.channelId,
    title: a.channelTitle,
    handle: a.channelTitle,
    avatarUrl: a.thumbnailUrl,
    followerCount: a.subscriberCount,
    videoCount: a.videoCount,
    viewCount: a.viewCount,
    likeCount: 0,
    status: a.status,
  });
  const loadPlatformAccounts = async (target: OverviewPlatform) => {
    if (target === 'youtube') {
      const data = await fetchJson<{ items?: YouTubeAccount[] }>('/api/overseas/youtube/accounts');
      return (data.items ?? []).filter(a => a.status === 'connected').map(mapYouTube);
    }
    const data = await fetchJson<{ items?: SocialAccount[] }>(`/api/overseas/social/accounts?platform=${target}`);
    return (data.items ?? []).filter(a => a.status === 'connected').map((a): OverviewAccount => ({
      id: a.id,
      platform: a.platform,
      providerAccountId: a.providerAccountId,
      title: a.title,
      handle: a.handle,
      avatarUrl: a.avatarUrl,
      followerCount: a.followerCount,
      videoCount: a.videoCount,
      viewCount: a.viewCount,
      likeCount: a.likeCount,
      status: a.status,
      parentPageName: a.parentPageName,
    }));
  };

  const loadCounts = async () => {
    const platforms: OverviewPlatform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];
    const results = await Promise.allSettled(platforms.map(loadPlatformAccounts));
    const next = { youtube: 0, tiktok: 0, instagram: 0, facebook: 0 };
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[platforms[index]] = result.value.length;
    });
    setCounts(next);
    if (next[currentPlatform] === 0) {
      const firstConnected = platforms.find(item => next[item] > 0);
      if (firstConnected) setPlatform(firstConnected);
    }
  };

  const loadAccounts = async (target: OverviewPlatform = currentPlatform) => {
    setAccountsLoading(true);
    setError('');
    try {
      const connected = await loadPlatformAccounts(target);
      setAccounts(connected);
      setSelectedAccountId(connected[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取频道账号');
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    void loadCounts();
  }, []);

  useEffect(() => {
    setSelectedAccountId('');
    setVideos([]);
    setComments([]);
    void loadAccounts(currentPlatform);
  }, [platform]);

  useEffect(() => {
    if (!selectedAccountId) {
      setVideos([]);
      setSelectedVideoId('');
      setComments([]);
      return;
    }
    setVideosLoading(true);
    setError('');
    const url = currentPlatform === 'youtube'
      ? `/api/overseas/youtube/accounts/${selectedAccountId}/videos?maxResults=50`
      : `/api/overseas/social/accounts/${selectedAccountId}/videos?maxResults=50`;
    fetchJson<{ videos?: OverviewVideo[] }>(url)
      .then(data => {
        const list = data.videos ?? [];
        setVideos(list);
        setSelectedVideoId(list[0]?.id || '');
      })
      .catch(e => setError(e instanceof Error ? e.message : '无法读取视频列表'))
      .finally(() => setVideosLoading(false));
  }, [selectedAccountId, currentPlatform]);

  useEffect(() => {
    if (!commentsEnabled) {
      setComments([]);
      setCommentsLoading(false);
      return;
    }
    if (!selectedAccountId || !selectedVideoId) {
      setComments([]);
      return;
    }
    setCommentsLoading(true);
    setError('');
    const url = currentPlatform === 'youtube'
      ? `/api/overseas/youtube/accounts/${selectedAccountId}/video/${selectedVideoId}/comments?maxResults=50`
      : `/api/overseas/social/accounts/${selectedAccountId}/video/${selectedVideoId}/comments?maxResults=50`;
    fetchJson<{ comments?: YouTubeComment[] }>(url)
      .then(data => setComments(data.comments ?? []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [selectedAccountId, selectedVideoId, currentPlatform, commentsEnabled]);

  const platforms = [
    { id: 'youtube' as const, label: 'YouTube', count: counts.youtube },
    { id: 'tiktok' as const, label: 'TikTok', count: counts.tiktok },
    { id: 'instagram' as const, label: 'Instagram', count: counts.instagram },
    { id: 'facebook' as const, label: 'Facebook', count: counts.facebook },
  ];

  return (
    <div className="flex h-full flex-col gap-4 sm:gap-5">
      <div className="flex items-center justify-between gap-3 border-b border-border">
        <div className="flex min-w-0 gap-5 overflow-x-auto overflow-y-hidden" role="tablist" aria-label="频道平台">
          {platforms.map(p => (
            <button key={p.id} type="button" onClick={() => setPlatform(p.id)} role="tab" aria-selected={platform === p.id}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-3 pt-1 text-xs font-semibold transition-colors ${platform === p.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:border-border-bright hover:text-text-primary'}`}>
              <SocialPlatformIcon platform={p.id} size={18} /><span className="sr-only">{p.label}</span>{p.count > 0 ? <span>{p.count}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { void loadCounts(); void loadAccounts(currentPlatform); }} disabled={accountsLoading}
          title="刷新频道总览"
          aria-label="刷新频道总览"
          className="mb-2 rounded-md border border-border bg-white p-2 text-text-muted transition-colors hover:border-border-bright hover:text-text-primary disabled:opacity-50">
          <RefreshCw size={14} className={accountsLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red/20 bg-red/5 px-3 py-2 text-xs text-red">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {accountsLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" /> 正在读取频道账号...
        </div>
      ) : accounts.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border bg-surface-2 px-5 py-12">
          <div className="max-w-sm text-center">
            <SocialPlatformIcon platform={currentPlatform} size={38} className="mx-auto mb-2 opacity-35" />
            <p className="text-sm font-semibold text-text-primary">还没有已授权的 {platforms.find(p => p.id === currentPlatform)?.label} 账号</p>
            <p className="mt-1 text-xs text-text-muted">请先在「账号配置 - 一键授权」连接账号。</p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-5">
          <aside className="min-h-0 overflow-y-auto rounded-lg border border-border bg-white p-3" aria-label="频道账号">
            <p className="px-1 pb-2 text-xs font-semibold text-text-secondary">账号</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {accounts.map(account => (
                <button key={account.id} type="button" onClick={() => setSelectedAccountId(account.id)} aria-pressed={selectedAccountId === account.id}
                  className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${selectedAccountId === account.id ? 'border-accent/35 bg-accent-glow' : 'border-border bg-white hover:border-border-bright hover:bg-surface-2'}`}>
                  {account.avatarUrl ? (
                    <img src={account.avatarUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md" style={platformTone(account.platform)} aria-hidden="true">
                      <SocialPlatformIcon platform={account.platform} size={20} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-primary">{account.title}</span>
                    <span className="block truncate text-[11px] text-text-muted">{account.handle || account.providerAccountId}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 min-h-0 flex flex-col gap-4">
            {selectedAccount && (
              <div className="rounded-lg border border-border bg-white p-4">
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{selectedAccount.title}</p>
                    <p className="mt-1 truncate text-xs text-text-muted">{selectedAccount.handle || selectedAccount.providerAccountId}</p>
                    {selectedAccount.parentPageName && <p className="mt-1 truncate text-xs text-text-muted">Page: {selectedAccount.parentPageName}</p>}
                  </div>
                  {accountUrl(selectedAccount) && <a href={accountUrl(selectedAccount)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-border-bright hover:text-text-primary">
                    <ExternalLink size={12} /> {selectedAccount.platform === 'youtube' ? '打开频道' : '打开主页'}
                  </a>}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-md border border-border bg-surface-2 px-2 py-2 sm:px-3">
                    <p className="text-base font-bold text-text-primary">{compactNumber.format(selectedAccount.followerCount || 0)}</p>
                    <p className="text-[11px] text-text-muted">{selectedAccount.platform === 'youtube' ? '订阅' : '粉丝'}</p>
                  </div>
                  <div className="rounded-md border border-border bg-surface-2 px-2 py-2 sm:px-3">
                    <p className="text-base font-bold text-text-primary">{compactNumber.format(selectedAccount.videoCount || 0)}</p>
                    <p className="text-[11px] text-text-muted">视频</p>
                  </div>
                  <div className="rounded-md border border-border bg-surface-2 px-2 py-2 sm:px-3">
                    <p className="text-base font-bold text-text-primary">{compactNumber.format(selectedAccount.viewCount || 0)}</p>
                    <p className="text-[11px] text-text-muted">播放</p>
                  </div>
                </div>
              </div>
            )}

            <div className={`grid min-h-0 flex-1 gap-4 ${commentsEnabled ? 'xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]' : ''}`}>
              <section className="min-h-0 overflow-y-auto rounded-lg border border-border bg-white p-3" aria-labelledby="channel-videos-heading">
                <div className="flex items-center justify-between px-1 pb-3">
                  <p id="channel-videos-heading" className="text-xs font-semibold text-text-secondary">视频</p>
                  {videos.length > 0 && <span className="text-[11px] text-text-muted">最近 {videos.length} 条</span>}
                </div>
                {videosLoading ? (
                  <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> 正在读取视频...
                  </div>
                ) : videos.length === 0 ? (
                  <div className="py-16 text-center text-sm text-text-muted">暂无视频</div>
                ) : (
                  <div className="space-y-2">
                    {videos.map(video => (
                      <button key={video.id} type="button" onClick={() => setSelectedVideoId(video.id)} aria-pressed={selectedVideoId === video.id}
                        className={`flex w-full gap-3 rounded-md border p-2 text-left transition-colors ${selectedVideoId === video.id ? 'border-accent/35 bg-accent-glow' : 'border-border bg-white hover:border-border-bright hover:bg-surface-2'}`}>
                        <img src={video.thumbnailUrl} alt="" className="h-14 w-20 flex-shrink-0 rounded object-cover bg-surface-2 sm:w-24" />
                        <span className="min-w-0 flex-1">
                          <span className="block line-clamp-2 text-sm font-semibold text-text-primary">{video.title}</span>
                          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                            <span className="inline-flex items-center gap-1"><Eye size={11} />{typeof video.viewCount === 'number' ? compactNumber.format(video.viewCount) : '暂无数据'}</span>
                            <span className="inline-flex items-center gap-1"><MessageSquare size={11} />{typeof video.commentCount === 'number' ? compactNumber.format(video.commentCount) : '暂无数据'}</span>
                            <span>{formatDate(video.publishedAt)}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {commentsEnabled && <section className="min-h-0 overflow-y-auto rounded-lg border border-border bg-white p-3" aria-labelledby="channel-comments-heading">
                <div className="px-1 pb-3">
                  <p id="channel-comments-heading" className="text-xs font-semibold text-text-secondary">评论</p>
                  {selectedVideo && <p className="mt-1 line-clamp-1 text-[11px] text-text-muted">{selectedVideo.title}</p>}
                </div>
                {commentsLoading ? (
                  <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> 正在读取评论...
                  </div>
                ) : !selectedVideo ? (
                  <div className="py-16 text-center text-sm text-text-muted">请选择视频</div>
                ) : comments.length === 0 ? (
                  <div className="py-16 text-center text-sm text-text-muted">暂无评论</div>
                ) : (
                  <div className="space-y-3">
                    {comments.map(comment => (
                      <article key={comment.id} className="rounded-md border border-border bg-surface-2/40 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          {comment.authorProfileImageUrl ? (
                            <img src={comment.authorProfileImageUrl} alt="" className="h-7 w-7 flex-shrink-0 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-glow text-xs font-semibold text-accent" aria-hidden="true">
                              {comment.authorName?.[0] ?? '?'}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-text-primary">{comment.authorName}</p>
                            <p className="text-[10px] text-text-muted">{formatDate(comment.publishedAt)}</p>
                          </div>
                          {comment.likeCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-text-muted">
                              <ThumbsUp size={10} /> {comment.likeCount}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-text-secondary">{comment.textDisplay}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

export function YouTubeContent() {
  return <ChannelOverview />;
}

// ── Full standalone page ───────────────────────────────────────────────────────
export default function YouTubeIntegrationPage() {
  return (
    <div className="flex h-full flex-col bg-ink">
      <div className="border-b border-border bg-white px-4 py-4 sm:px-6">
        <h1 className="text-xl font-semibold text-text-primary">频道总览</h1>
        <p className="mt-0.5 text-sm text-text-muted">多个平台账号及已授权内容数据</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <ChannelOverview />
      </div>
    </div>
  );
}
