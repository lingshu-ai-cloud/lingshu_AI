import { useState, useEffect } from 'react';
import {
  Loader2,
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

type SocialPlatform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin';

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

function externalAccountUrl(account: { platform: string; providerAccountId: string; handle?: string; parentPageName?: string }) {
  if (account.platform === 'youtube') return `https://www.youtube.com/channel/${account.providerAccountId}`;
  if (account.platform === 'facebook') return `https://www.facebook.com/${account.providerAccountId}`;
  if (account.platform === 'linkedin') return account.parentPageName ? `https://www.linkedin.com/company/${account.providerAccountId}` : '';
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
  linkedin: {
    label: 'LinkedIn',
    description: '连接个人账号后可发布 MP4 视频；企业主页发布仅在已获 LinkedIn 组织权限时启用。',
    envHint: 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET',
    color: '#0A66C2',
    bg: '#EFF6FF',
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
  linkedin: {
    tokenLabel: 'Access Token',
    tokenPlaceholder: '请通过 OAuth 连接',
    accountLabel: 'LinkedIn Member ID',
    accountPlaceholder: '请通过 OAuth 自动识别',
    helper: 'LinkedIn 不开放手动凭证接入，请使用上方 OAuth 授权，系统会核验真实账号与发布权限。',
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

      {status?.manualConnectEnabled && platform !== 'linkedin' && (
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

export { ChannelOverview, YouTubeContent, default } from './ChannelOverview';
