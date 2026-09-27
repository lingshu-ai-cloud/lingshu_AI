import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resumeOrCreateInspirationTask } from '../lib/socialInspirationTask';
import { monitoringReviewCandidate } from '../lib/socialMonitoringReview';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Video,
} from 'lucide-react';
import type { Page } from '../App';
import { PAGE_REGISTRY } from '../pageRegistry';
import {
  getSocialChannelCapabilities,
  getSocialMonitorOverview,
  requestSocialMonitorSync,
  type MonitoredContent,
  type SocialChannelCapability,
  type SocialChannelId,
  type SocialMonitorOverview,
} from '../lib/socialChannels';

const CHANNEL_LABELS: Record<string, string> = {
  douyin_cn: '国内抖音',
  tiktok_global: 'TikTok 国际版',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
};

const CAPABILITY_LABELS: Record<string, string> = {
  publication_package: '发布包',
  assisted_browser_publish: '浏览器辅助',
  official_publish: '官方发布',
  content_list: '账号内容',
  content_metrics: '视频数据',
  account_metrics: '账号数据',
};

const METRIC_LABELS: Record<string, string> = {
  views: '播放',
  viewCount: '播放',
  likes: '点赞',
  likeCount: '点赞',
  comments: '评论',
  commentCount: '评论',
  shares: '分享',
  shareCount: '分享',
  saves: '收藏',
  favoriteCount: '收藏',
  completionRate: '完播率',
};

function dateTime(value?: string) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function metricValue(key: string, value: number | null) {
  if (value === null || value === undefined) return '暂无数据';
  if (/rate/i.test(key)) return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function sourceLabel(value?: string) {
  if (value === 'official_api') return '官方接口';
  if (value === 'assisted_browser') return '浏览器辅助';
  if (value === 'public_page') return '公开页面';
  if (value === 'manual' || value === 'manual_import') return '人工提供';
  return value || '来源未知';
}

function capabilityTone(item: SocialChannelCapability) {
  if (item.status === 'available') return 'border-emerald-200 bg-emerald-50';
  if (item.status === 'unsupported') return 'border-slate-200 bg-slate-50';
  return 'border-amber-200 bg-amber-50';
}

function ContentRow({ item, onReview, busy }: { item: MonitoredContent; onReview: (item: MonitoredContent) => void; busy: boolean }) {
  const metrics = Object.entries(item.metrics || {}).slice(0, 5);
  let reviewUnavailable = '';
  try { monitoringReviewCandidate(item); } catch (error) { reviewUnavailable = error instanceof Error ? error.message : '暂无可用反馈'; }
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Video size={16} /></span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-black text-text-primary">{item.title || '未命名内容'}</p>
            <p className="mt-1 text-[11px] text-text-muted">{CHANNEL_LABELS[item.channelId] || item.channelId}{item.accountId ? ` · ${item.accountId}` : ''} · {dateTime(item.publishedAt)}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {metrics.length ? metrics.map(([key, value]) => (
            <span key={key} className="text-xs"><strong className="text-text-primary">{metricValue(key, value)}</strong><span className="ml-1 text-text-muted">{METRIC_LABELS[key] || key}</span></span>
          )) : <span className="text-xs text-text-muted">平台尚未返回指标</span>}
        </div>
      </td>
      <td className="px-4 py-4 text-xs text-text-secondary">
        <p className="font-bold">{sourceLabel(item.source)}</p>
        <p className="mt-1 text-text-muted">采集：{dateTime(item.capturedAt)}</p>
        <p className="mt-1 text-text-muted">{item.freshness === 'fresh' ? '近期数据' : item.freshness === 'stale' ? '数据已过期，请同步' : '新鲜度待核实'}</p>
      </td>
      <td className="px-4 py-4 text-right">
        {item.platformUrl ? <a href={item.platformUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-accent">查看原内容<ExternalLink size={12} /></a> : <span className="text-xs text-text-muted">未登记链接</span>}
        <button type="button" disabled={busy || Boolean(reviewUnavailable)} title={reviewUnavailable || '关联原内容与真实数据，进入同一制作流程'} onClick={() => onReview(item)} className="mt-2 block ml-auto rounded-lg border border-border px-3 py-2 text-xs font-bold text-accent disabled:opacity-40">{busy ? '正在衔接…' : '基于反馈再创作'}</button>
      </td>
    </tr>
  );
}

export default function SocialMonitoringPage({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const reviewLock = useRef(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState('all');
  const [capabilities, setCapabilities] = useState<SocialChannelCapability[]>([]);
  const [overview, setOverview] = useState<SocialMonitorOverview | null>(null);
  const [channelFilter, setChannelFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextCapabilities, nextOverview] = await Promise.all([
        getSocialChannelCapabilities(),
        getSocialMonitorOverview(),
      ]);
      setCapabilities(nextCapabilities);
      setOverview(nextOverview);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取社媒监控数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const channelAccounts = useMemo(() => (overview?.connections ?? []).filter(item => channelFilter === 'all' || item.channelId === channelFilter), [overview, channelFilter]);
  const filteredContents = useMemo(() => (overview?.contents ?? []).filter(item => (
    (channelFilter === 'all' || item.channelId === channelFilter)
    && (accountFilter === 'all' || `${item.channelId}:${item.accountId}` === accountFilter)
  )), [overview, channelFilter, accountFilter]);

  useEffect(() => { setAccountFilter('all'); }, [channelFilter]);
  const syncTarget = useMemo(() => accountFilter !== 'all'
    ? channelAccounts.find(item => item.id === accountFilter) ?? null
    : channelAccounts.length === 1 ? channelAccounts[0] : null, [channelAccounts, accountFilter]);

  const review = async (item: MonitoredContent) => {
    if (reviewLock.current) return;
    reviewLock.current = true;
    setReviewingId(item.id);
    setError('');
    setNotice('');
    try {
      const result = await resumeOrCreateInspirationTask(monitoringReviewCandidate(item));
      if (result.warning) {
        setNotice(`任务已保留，${result.warning}`);
      }
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
        page: 'smartAssets', socialContentPage: 'smartAssets', socialContentTaskId: result.task.taskId,
      } }));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '反馈创作未能启动');
    } finally {
      reviewLock.current = false;
      setReviewingId(null);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      if (!syncTarget) throw new Error('请先选择一个已经产生同步记录的渠道账号。');
      const result = await requestSocialMonitorSync(syncTarget.channelId as SocialChannelId, syncTarget.id.slice(syncTarget.channelId.length + 1));
      setNotice(result.message || (result.status === 'queued' ? '同步任务已进入队列。' : '同步任务已提交。'));
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-surface-2 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold text-accent">发布后的真实反馈</p>
            <h1 className="mt-1 text-2xl font-black text-text-primary">{PAGE_REGISTRY.socialMonitoring.canonicalTitle}</h1>
            <p className="mt-1 text-sm text-text-muted">每个数字都标明来源和采集时间；平台没有返回时保留“暂无数据”。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate?.('traffic')} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary">去发布<ArrowRight size={14} /></button>
            <button type="button" onClick={() => void sync()} disabled={syncing || loading || !syncTarget} title={syncTarget ? '同步当前渠道账号' : '请选择要同步的具体账号'} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-black text-white disabled:opacity-50">{syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}立即同步</button>
          </div>
        </header>

        {(error || notice) && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {loading && !capabilities.length ? Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl border border-border bg-white" />) : capabilities.map(item => (
            <button key={item.channelId} type="button" onClick={() => setChannelFilter(current => current === item.channelId ? 'all' : item.channelId)} className={`rounded-2xl border p-4 text-left transition-shadow hover:shadow-sm ${capabilityTone(item)} ${channelFilter === item.channelId ? 'ring-2 ring-accent/30' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-text-primary">{item.label || CHANNEL_LABELS[item.channelId]}</p>
                {item.status === 'available' ? <CheckCircle2 size={17} className="text-emerald-700" /> : <AlertCircle size={17} className="text-amber-700" />}
              </div>
              <p className="mt-2 min-h-8 text-[11px] leading-4 text-text-muted">{item.reason || (item.status === 'available' ? '当前租户可使用已验收能力' : '需要完成配置、授权或平台审核')}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {Object.entries(item.capabilities || {}).map(([key, enabled]) => <span key={key} className={`rounded-full px-2 py-1 text-[9px] font-bold ${enabled ? 'bg-white text-emerald-800' : 'bg-white/60 text-slate-400'}`}>{CAPABILITY_LABELS[key] || key}</span>)}
              </div>
            </button>
          ))}
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white p-4"><div className="flex items-center gap-2 text-text-muted"><BarChart3 size={16} /><span className="text-xs font-bold">已监控内容</span></div><p className="mt-3 text-2xl font-black text-text-primary">{overview?.contents.length ?? 0}</p></div>
          <div className="rounded-2xl border border-border bg-white p-4"><div className="flex items-center gap-2 text-text-muted"><ShieldCheck size={16} /><span className="text-xs font-bold">可用连接</span></div><p className="mt-3 text-2xl font-black text-text-primary">{overview?.connections.filter(item => item.status === 'connected' || item.status === 'available').length ?? 0}</p></div>
          <div className="rounded-2xl border border-border bg-white p-4"><div className="flex items-center gap-2 text-text-muted"><Clock3 size={16} /><span className="text-xs font-bold">最近成功同步</span></div><p className="mt-3 text-sm font-black text-text-primary">{dateTime(overview?.lastSyncAt)}</p></div>
        </section>

        {overview?.reason && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">{overview.reason}</div>}

        <section className="overflow-hidden rounded-2xl border border-border bg-white">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-sm font-black text-text-primary">账号内容与视频数据</h2><p className="mt-1 text-xs text-text-muted">官方接口、浏览器辅助、公开页面与人工数据不会无标记混写。</p></div>
            <select value={channelFilter} onChange={event => setChannelFilter(event.target.value)} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary outline-none focus:border-accent">
              <option value="all">全部平台</option>
              {capabilities.map(item => <option key={item.channelId} value={item.channelId}>{item.label || CHANNEL_LABELS[item.channelId]}</option>)}
            </select>
            <select aria-label="筛选账号" value={accountFilter} onChange={event => setAccountFilter(event.target.value)} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">
              <option value="all">全部账号</option>
              {channelAccounts.map(item => <option key={item.id} value={item.id}>{CHANNEL_LABELS[item.channelId]} · {item.displayName || item.id}</option>)}
            </select>
          </div>
          {loading ? <div className="flex items-center justify-center gap-2 p-16 text-sm text-text-muted"><Loader2 size={18} className="animate-spin" />正在读取真实数据</div> : filteredContents.length === 0 ? (
            <div className="p-14 text-center"><Video size={30} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-black text-text-primary">没有可展示的内容数据</p><p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-text-muted">可以先登记发布后的公开链接；如需完整账号作品和稳定指标，需要在平台官方页面完成授权。</p><div className="mt-4 flex justify-center gap-2"><button type="button" onClick={() => onNavigate?.('traffic')} className="rounded-xl bg-accent px-4 py-2 text-xs font-black text-white">去发布与登记</button><button type="button" onClick={() => onNavigate?.('accountManagement')} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-black text-text-secondary">渠道设置</button></div></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead className="bg-slate-50 text-left text-[11px] font-bold text-text-muted"><tr><th className="px-4 py-3">内容</th><th className="px-4 py-3">数据</th><th className="px-4 py-3">来源与新鲜度</th><th className="px-4 py-3 text-right">内容与优化</th></tr></thead><tbody>{filteredContents.map(item => <ContentRow key={item.id} item={item} onReview={item => void review(item)} busy={reviewingId !== null} />)}</tbody></table></div>
          )}
        </section>
      </div>
    </main>
  );
}
