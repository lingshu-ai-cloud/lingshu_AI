import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, ChevronRight, Loader2, RefreshCcw, X } from 'lucide-react';
import type { Page } from '../App';
import { PAGE_REGISTRY } from '../pageRegistry';
import type { AgentNotification, AgentNotificationList } from '../../shared/contracts/agentNotification';
import { agentNotificationsApi } from '../lib/agentNotifications';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

const EMPTY: AgentNotificationList = { items: [], unreadCount: 0, latestAt: null };
const TYPE_LABEL: Record<AgentNotification['type'], string> = {
  scope_changed: '发现范围调整', weekly_package_adjusted: '周任务调整',
  critical_business_change: '关键经营信息变化', authorization_required: '需要授权',
};

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export default function AgentNotificationBell({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [feed, setFeed] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(open, areaRef, () => setOpen(false));

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setFeed(await agentNotificationsApi.list()); setError(''); }
    catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : '消息读取失败'); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 10_000);
    const onVisible = () => { if (!document.hidden) void refresh(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [refresh]);

  const markRead = async (item: AgentNotification) => {
    if (item.readAt) return;
    const now = new Date().toISOString();
    setFeed(current => ({ ...current, unreadCount: Math.max(0, current.unreadCount - 1), items: current.items.map(row => row.id === item.id ? { ...row, readAt: now } : row) }));
    try { await agentNotificationsApi.read(item.id); } catch { void refresh(true); }
  };

  const openAction = (item: AgentNotification) => {
    void markRead(item);
    const page = item.action?.page;
    if (page && Object.hasOwn(PAGE_REGISTRY, page)) onNavigate(page as Page);
    else if (item.action?.href?.startsWith('/')) window.location.assign(item.action.href);
    setOpen(false);
  };

  const markAll = async () => {
    const now = new Date().toISOString();
    setFeed(current => ({ ...current, unreadCount: 0, items: current.items.map(item => ({ ...item, readAt: item.readAt || now })) }));
    try { await agentNotificationsApi.readAll(); } catch { void refresh(true); }
  };

  return (
    <div ref={areaRef} className="absolute right-4 top-2 z-50">
      <button type="button" aria-label={`消息中心，${feed.unreadCount} 条未读`} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(value => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white text-text-secondary shadow-sm transition hover:bg-surface-2 hover:text-text-primary">
        <Bell size={18} />
        {feed.unreadCount > 0 && <span className="absolute -right-2 -top-2 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white" aria-hidden="true">{feed.unreadCount > 99 ? '99+' : feed.unreadCount}</span>}
      </button>
      {open && (
        <section role="dialog" aria-label="Agent 消息中心" className="absolute right-0 mt-2 flex max-h-[min(620px,calc(100dvh-70px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div><h2 className="text-sm font-bold text-text-primary">最新动态</h2><p className="mt-0.5 text-[10px] text-text-muted">Agent 调整、经营变化与授权提醒</p></div>
            <div className="flex items-center gap-1">
              {feed.unreadCount > 0 && <button type="button" onClick={() => void markAll()} title="全部标为已读" className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-accent"><CheckCheck size={15} /></button>}
              <button type="button" onClick={() => void refresh()} title="刷新" className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary"><RefreshCcw size={14} /></button>
              <button type="button" onClick={() => setOpen(false)} title="关闭" className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={15} /></button>
            </div>
          </header>
          <div className="min-h-0 overflow-y-auto">
            {loading ? <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-text-muted"><Loader2 size={15} className="animate-spin" />读取最新动态</div>
              : error ? <div className="px-5 py-10 text-center"><p className="text-xs font-semibold text-red-700">{error}</p><button type="button" onClick={() => void refresh()} className="mt-3 text-xs font-bold text-accent">重试</button></div>
              : feed.items.length === 0 ? <div className="px-5 py-12 text-center"><Bell size={24} className="mx-auto text-text-muted" /><p className="mt-3 text-sm font-semibold text-text-secondary">暂无最新动态</p><p className="mt-1 text-xs text-text-muted">Agent 的重要调整会出现在这里</p></div>
              : feed.items.map(item => (
                <button key={item.id} type="button" onClick={() => openAction(item)} className={`flex w-full gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-surface-2 ${item.readAt ? 'bg-white' : 'bg-red-50/40'}`}>
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : item.severity === 'critical' ? 'bg-red-600' : 'bg-accent'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold text-text-muted">{TYPE_LABEL[item.type]} · {item.sourceAgent}</span><time className="shrink-0 text-[10px] text-text-muted">{relativeTime(item.createdAt)}</time></span>
                    <span className="mt-1 block text-sm font-bold text-text-primary">{item.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-text-secondary">{item.summary}</span>
                    {item.changes.length > 0 && <span className="mt-2 block rounded-lg bg-surface-2 px-2.5 py-2 text-[10px] text-text-secondary">{item.changes.slice(0, 2).map(change => `${change.label}：${String(change.before ?? '未设置')} → ${String(change.after ?? '未设置')}`).join('；')}</span>}
                  </span>
                  {item.action && <ChevronRight size={14} className="mt-6 shrink-0 text-text-muted" />}
                </button>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

