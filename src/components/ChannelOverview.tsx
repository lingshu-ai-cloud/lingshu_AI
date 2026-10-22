import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Eye, ThumbsUp, CheckCircle, AlertCircle, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';

interface YouTubeAccount {
  id: string; channelId: string; channelTitle: string; customUrl?: string; thumbnailUrl?: string;
  subscriberCount: number; videoCount: number; viewCount: number;
  status: 'connected' | 'error' | 'expired'; connectedAt?: string; lastSyncAt?: string;
}
interface YouTubeVideo {
  id: string; title: string; description: string; publishedAt: string; thumbnailUrl: string;
  viewCount?: number; likeCount?: number; commentCount?: number; duration: string;
}
interface YouTubeComment {
  id: string; authorName: string; authorProfileImageUrl?: string; textDisplay: string;
  likeCount: number; publishedAt: string; videoId: string;
}
interface SocialAccount {
  id: string;
  platform: 'tiktok' | 'instagram' | 'facebook' | 'linkedin';
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
const compactNumber = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
function externalAccountUrl(account: { platform: string; providerAccountId: string; handle?: string; parentPageName?: string }) {
  if (account.platform === 'youtube') return `https://www.youtube.com/channel/${account.providerAccountId}`;
  if (account.platform === 'facebook') return `https://www.facebook.com/${account.providerAccountId}`;
  if (account.platform === 'linkedin') return account.parentPageName ? `https://www.linkedin.com/company/${account.providerAccountId}` : '';
  if (account.platform === 'instagram') { const handle = account.handle?.replace(/^@/, '').trim(); return handle ? `https://www.instagram.com/${handle}/` : ''; }
  if (account.platform === 'tiktok') { const handle = account.handle?.replace(/^@/, '').trim(); return handle ? `https://www.tiktok.com/@${handle}` : ''; }
  return '';
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
  type OverviewPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'linkedin';
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
  const [counts, setCounts] = useState<Record<OverviewPlatform, number>>({ youtube: 0, tiktok: 0, instagram: 0, facebook: 0, linkedin: 0 });
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
  const commentsEnabled = currentPlatform !== 'facebook' && currentPlatform !== 'instagram' && currentPlatform !== 'linkedin';
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
    const platforms: OverviewPlatform[] = ['youtube', 'tiktok', 'instagram', 'facebook', 'linkedin'];
    const results = await Promise.allSettled(platforms.map(loadPlatformAccounts));
    const next: Record<OverviewPlatform, number> = { youtube: 0, tiktok: 0, instagram: 0, facebook: 0, linkedin: 0 };
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
    let cancelled = false;
    const loadVideos = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const data = await fetchJson<{ videos?: OverviewVideo[] }>(url);
          if (cancelled) return;
          const list = data.videos ?? [];
          setVideos(list);
          setSelectedVideoId(list[0]?.id || '');
          setVideosLoading(false);
          return;
        } catch (reason) {
          lastError = reason;
          if (attempt === 0) await new Promise(resolve => window.setTimeout(resolve, 500));
        }
      }
      if (!cancelled) {
        setError(lastError instanceof Error ? lastError.message : '无法读取视频列表');
        setVideosLoading(false);
      }
    };
    void loadVideos();
    return () => { cancelled = true; };
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
