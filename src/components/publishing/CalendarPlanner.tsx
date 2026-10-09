import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Drawer, Input, Modal, Select, Tag } from 'antd';
import { CalendarDays, Plus } from 'lucide-react';
import { authApi, authHeader } from '../../lib/auth';
import { buildMarketingEvents, MARKET_OPTIONS, timeZoneOffsetHours, type MarketId } from './marketingCalendar';
import { ContentQueuePanel, type PendingPlacement } from './ContentQueuePanel';
import { resolvePendingDrop, type PublishDeliveryMode } from './schedulePolicy';
import PublishingReceiptRecovery from './PublishingReceiptRecovery';
import { LsCalendar, type LsCalendarEvent } from '../ui/LsCalendar';
import { calendarDateTimeValue, calendarDayKey, calendarInstant, calendarPublishStatus, canMoveCalendarPost } from '../../lib/calendarModel';
import type { CopyAuditRecord } from '../../lib/publishQueueState';

export type CalendarPost = {
  id: string;
  platform: string;
  title: string;
  description?: string;
  publishedAt: string;
  status: 'scheduled' | 'published' | string;
  coverUrl?: string;
  videoUrl?: string;
  duration?: number;
  contentId?: string;
  firstComment?: string;
  videoPath?: string;
  videoPreviewUrl?: string;
  trackWaLink?: boolean;
  targetAccountIds?: string[];
  targetAccountLabels?: string[];
  publishError?: string;
  publishAttempts?: number;
  nextPublishAttemptAt?: string;
  inquiries: number;
  isRecycle?: boolean;
  platformPostId?: string;
  scheduleLocked?: boolean;
  workflowRunId?: string;
  workflowTaskId?: string;
  workflowTaskKey?: string;
  enterpriseFactVersion?: string;
  copyAudit?: CopyAuditRecord;
};

export type PendingPublishContent = {
  id: string;
  title: string;
  description?: string;
  sourceProjectId?: string;
  sourcePlatform?: string;
  platforms?: string[];
  deliveryMode?: PublishDeliveryMode;
  scheduledAt?: string;
  status?: string;
};


type BestTimeResponse = { weekday: number; scores: number[]; source?: string; confidence?: string; utcOffset?: number | null };
type EnterpriseProfileLite = { company?: { mainMarkets?: string }; strategy?: { focusMarkets?: string } };
function marketIdFromEnterprise(value: string): MarketId {
  const candidates = value.split(/[、,，/；;\s]+/).map(item => item.trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (/北美|美国|加拿大|墨西哥/i.test(candidate)) return 'north-america';
    if (/欧洲|欧盟|德国|法国|英国|意大利|西班牙|荷兰|波兰/i.test(candidate)) return 'europe';
    if (/中东|沙特|阿联酋|迪拜|卡塔尔|科威特|阿曼|巴林/i.test(candidate)) return 'middle-east';
    if (/东南亚|印尼|印度尼西亚|新加坡|马来西亚|泰国|越南|菲律宾/i.test(candidate)) return 'southeast-asia';
    if (/中亚|哈萨克斯坦|乌兹别克斯坦|吉尔吉斯斯坦|塔吉克斯坦|土库曼斯坦/i.test(candidate)) return 'central-asia';
    if (/南亚|印度|巴基斯坦|孟加拉|斯里兰卡|尼泊尔/i.test(candidate)) return 'south-asia';
    if (/东亚|日本|韩国|蒙古/i.test(candidate)) return 'east-asia';
    if (/拉美|拉丁美洲|巴西|阿根廷|智利|哥伦比亚|秘鲁/i.test(candidate)) return 'latin-america';
    if (/非洲|南非|尼日利亚|埃及|肯尼亚|摩洛哥/i.test(candidate)) return 'africa';
    if (/大洋洲|澳大利亚|新西兰/i.test(candidate)) return 'oceania';
    if (/俄罗斯|独联体|俄语区/i.test(candidate)) return 'cis';
  }
  return 'global';
}


function startOfDay(date: Date): Date { return calendarInstant(calendarDayKey(date)); }
function addDays(date: Date, days: number): Date { return new Date(date.getTime() + days * 86_400_000); }
function iso(date: Date): string { return date.toISOString(); }
function calendarErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  return !message || /request_failed|load_failed|failed to fetch|network/i.test(message) ? '日历数据暂时无法刷新，已保留当前排期，请重试。' : message;
}
function statusLabel(item: CalendarPost): string {
  const labels: Record<string, string> = { needs_attention: '结果待核对', finalize_pending: '回执已收 · 待回写', published: '已发布', scheduled: item.scheduleLocked ? '定点排期 · 已锁定' : '已排期', publishing: '正在发布', failed: '发布失败', partial: '部分发布', awaiting_manual_publish: '待人工发布', awaiting_reapproval: '内容变更 · 待重审' };
  return labels[item.status] || (item.platformPostId ? '已发布' : item.status || '草稿');
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'request_failed');
  return data as T;
}

export function CalendarPlanner({ onCreate, onOpenPost, pendingItems = [], onOpenPending, onSchedulePending, refreshKey = 0 }: {
  onCreate?: (date: Date) => void;
  onOpenPost?: (post: CalendarPost) => void;
  pendingItems?: PendingPublishContent[];
  onOpenPending?: (id: string) => void;
  onSchedulePending?: (id: string, scheduledAt: Date) => Promise<number>;
  refreshKey?: number;
}) {
  const { message } = App.useApp();
  const [demoMode, setDemoMode] = useState(() => import.meta.env.DEV && (new URLSearchParams(window.location.search).get('mockCalendar') === '1' || window.sessionStorage.getItem('lingshu:calendar-demo') === '1'));
  const [canEditSchedule, setCanEditSchedule] = useState(false);
  const [mode, setMode] = useState('timeGridWeek');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [visibleRange, setVisibleRange] = useState(() => ({ from: addDays(startOfDay(new Date()), -7), to: addDays(startOfDay(new Date()), 7) }));
  const [items, setItems] = useState<CalendarPost[]>([]);
  const [scores, setScores] = useState<Record<number, number[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [interactionMessage, setInteractionMessage] = useState('');
  const [scoreSource, setScoreSource] = useState('平台参考');
  const selectedPlatform = 'tiktok';
  const [platformFilter, setPlatformFilter] = useState('all');
  const [selectedMarket, setSelectedMarket] = useState<MarketId>('global');
  const [enterpriseMarketLabel, setEnterpriseMarketLabel] = useState('综合市场');
  const [pendingId, setPendingId] = useState<string>();
  const [pendingTimeSelection, setPendingTimeSelection] = useState<{ id: string; title: string; day: string; time: string } | null>(null);
  const [pendingTimeSaving, setPendingTimeSaving] = useState(false);
  const [recoveryPost, setRecoveryPost] = useState<CalendarPost | null>(null);
  const calendarRequestRef = useRef<AbortController | null>(null);
  const market = MARKET_OPTIONS.find(option => option.id === selectedMarket) ?? MARKET_OPTIONS[0];
  const utcOffset = useMemo(() => timeZoneOffsetHours(market.timeZone, selectedDate), [market.timeZone, selectedDate]);
  const days = useMemo(() => Array.from({ length: Math.max(1, Math.min(371, Math.ceil((visibleRange.to.getTime() - visibleRange.from.getTime()) / 86_400_000))) }, (_, index) => addDays(visibleRange.from, index)), [visibleRange]);
  const range = useMemo(() => {
    const queueFrom = startOfDay(new Date()), queueTo = addDays(queueFrom, 35);
    return { from: visibleRange.from < queueFrom ? visibleRange.from : queueFrom, to: visibleRange.to > queueTo ? visibleRange.to : queueTo };
  }, [visibleRange]);

  useEffect(() => {
    let active = true;
    void authApi.me().then(session => { if (active) setCanEditSchedule(Boolean(session && !session.supportAccess && ['super_admin', 'admin', 'social_operator'].includes(session.user.role))); }).catch(() => undefined);
    void api<EnterpriseProfileLite>('/api/overseas/enterprise/profile').then(profile => {
      if (!active) return;
      const configuredMarket = profile.strategy?.focusMarkets?.trim() || profile.company?.mainMarkets?.trim();
      if (configuredMarket) { setEnterpriseMarketLabel(configuredMarket); setSelectedMarket(marketIdFromEnterprise(configuredMarket)); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.sessionStorage.setItem('lingshu:calendar-demo', demoMode ? '1' : '0');
    const url = new URL(window.location.href);
    if (demoMode) url.searchParams.set('mockCalendar', '1'); else url.searchParams.delete('mockCalendar');
    window.history.replaceState(window.history.state, '', url);
  }, [demoMode]);

  const load = async (silent = false) => {
    if (demoMode) {
      calendarRequestRef.current?.abort();
      calendarRequestRef.current = null;
      const titles = ['30 秒认识灵枢数字员工', '从一条灵感到多平台成片', '工厂产品细节与应用展示', '采购常见问题：交付与定制', '客户案例：一周内容运营流程', '幕后揭秘：脚本如何变成视频', '本周精选与下周预告'];
      const cadence = [
        { platform: 'tiktok', weekdays: [1, 2, 3, 4, 5], hour: 8, account: '灵枢 · 北美品牌号' },
        { platform: 'facebook', weekdays: [1, 2, 3, 4, 5], hour: 10, account: '灵枢 · 品牌主页' },
        { platform: 'youtube', weekdays: [2, 4, 6], hour: 20, account: '灵枢 · 官方频道' },
        { platform: 'instagram', weekdays: [1, 3, 5], hour: 14, account: '灵枢 · 产品展示号' },
      ];
      setItems(days.flatMap((day, index) => cadence.filter(entry => entry.weekdays.includes(new Date(`${calendarDayKey(day)}T12:00:00Z`).getUTCDay())).map(entry => {
        const date = calendarInstant(`${calendarDayKey(day)}T${String(entry.hour).padStart(2, '0')}:${entry.platform === 'instagram' ? '30' : '00'}`);
        return { id: `demo-calendar-${index}-${entry.platform}`, title: titles[(index + cadence.indexOf(entry)) % titles.length], platform: entry.platform, publishedAt: date.toISOString(), status: 'scheduled', scheduleLocked: entry.platform === 'youtube', description: '演示内容：展示产品价值、应用场景与明确的咨询入口。此数据仅用于页面预览。', targetAccountLabels: [entry.account], duration: 30 + index * 5, inquiries: 0 };
      })));
      setError(''); setLoading(false);
      return;
    }
    if (calendarRequestRef.current) {
      if (silent) return;
      calendarRequestRef.current.abort();
    }
    const controller = new AbortController();
    calendarRequestRef.current = controller;
    let timedOut = false;
    const isCurrent = () => calendarRequestRef.current === controller;
    const canCommit = () => isCurrent() && !controller.signal.aborted;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    if (!silent) {
      setLoading(true);
      setError('');
    }
    // Recommendations are optional: they must not prevent real posts from loading.
    const calendarLoad = api<{ items: CalendarPost[] }>(`/api/overseas/publishing/calendar?from=${encodeURIComponent(iso(range.from))}&to=${encodeURIComponent(iso(range.to))}`, { signal: controller.signal })
      .then(calendar => {
        if (!canCommit()) return;
        setItems(calendar.items || []);
        setError('');
      })
      .catch(loadError => {
        if (!isCurrent() || (controller.signal.aborted && !timedOut)) return;
        setError(timedOut ? '日历读取超时，请稍后重试' : calendarErrorMessage(loadError));
      });
    const scoreLoad = Promise.all([0, 1, 2, 3, 4, 5, 6].map(weekday =>
      api<BestTimeResponse>(
        `/api/overseas/publishing/best-time?platform=${encodeURIComponent(selectedPlatform)}&weekday=${weekday}&utcOffset=${encodeURIComponent(String(utcOffset))}`,
        { signal: controller.signal },
      ),
    )).then(scoreRows => {
      if (!canCommit()) return;
      setScores(Object.fromEntries(scoreRows.map(row => [row.weekday, row.scores])));
      setScoreSource(scoreRows.some(row => row.source === 'account_history') ? '账号真实数据' : '平台参考');
    }).catch(() => {
      if (!isCurrent() || (controller.signal.aborted && !timedOut)) return;
      setScores({});
      setScoreSource('平台参考');
    });
    try {
      await Promise.all([calendarLoad, scoreLoad]);
    } finally {
      window.clearTimeout(timeout);
      if (isCurrent()) {
        calendarRequestRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('lingshu:agent-business-refresh', refresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('lingshu:agent-business-refresh', refresh);
      const controller = calendarRequestRef.current;
      calendarRequestRef.current = null;
      controller?.abort();
    };
  }, [range.from.toISOString(), range.to.toISOString(), mode, selectedPlatform, utcOffset, refreshKey, demoMode]);

  const itemsByDay = useMemo(() => {
    const groups: Record<string, CalendarPost[]> = {};
    for (const item of items) { const key = calendarDayKey(item.publishedAt); groups[key] = [...(groups[key] || []), item]; }
    return groups;
  }, [items]);
  const selectedKey = calendarDayKey(selectedDate);
  const selectedScores = scores[new Date(`${selectedKey}T12:00:00Z`).getUTCDay()] || [];
  const selectedBestHour = selectedScores.length ? selectedScores.reduce((best, score, hour, all) => score > all[best] ? hour : best, 0) : null;
  const marketingEvents = useMemo(() => buildMarketingEvents(anchor).filter(event => event.date.startsWith(calendarDayKey(anchor).slice(0, 7))), [anchor]);
  const events: LsCalendarEvent[] = items.filter(item => platformFilter === 'all' || item.platform === platformFilter).map(post => ({
    id: post.id, title: post.title, start: post.publishedAt, timeZone: 'Asia/Shanghai', eventType: 'publish',
    status: calendarPublishStatus(post), statusLabel: statusLabel(post), platform: post.platform,
    accountId: post.targetAccountIds?.[0], accountName: post.targetAccountLabels?.join('、'),
    thumbnailUrl: post.coverUrl, ownerAgent: '经营 Agent', sourceId: post.contentId, description: post.description,
    editable: canMoveCalendarPost(post, canEditSchedule && !demoMode), data: post,
  }));
  const reschedule = async (event: LsCalendarEvent, scheduledAt: string) => {
    const current = items.find(item => item.id === event.id);
    if (!current || !canMoveCalendarPost(current, canEditSchedule && !demoMode)) throw new Error('此内容的排期不可调整。');
    if (new Date(scheduledAt).getTime() <= Date.now()) throw new Error('新的发布时间必须晚于当前时间。');
    const data = await api<{ item: CalendarPost }>(`/api/overseas/publishing/calendar/${encodeURIComponent(event.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledAt }) });
    setItems(previous => previous.map(item => item.id === event.id ? data.item : item));
    setInteractionMessage('排期已更新，发布时间以服务器保存结果为准。');
  };
  const placePendingContent = async (id: string, scheduledAt: Date) => {
    if (!canEditSchedule || demoMode || !onSchedulePending) throw new Error('当前无法修改排期。');
    await onSchedulePending(id, scheduledAt);
    setSelectedDate(startOfDay(scheduledAt));
  };
  const arrangePendingContent = async (placements: PendingPlacement[]) => {
    let completed = 0;
    const failures: string[] = [];
    for (const placement of placements) {
      try { await placePendingContent(placement.id, placement.scheduledAt); completed += 1; }
      catch (arrangeError) { failures.push(arrangeError instanceof Error ? arrangeError.message : '排期失败'); }
    }
    await load();
    setInteractionMessage(failures.length ? `已排入 ${completed} 条，${failures.length} 条需要重新检查。` : `已按当前发布节奏排入 ${completed} 条视频。`);
    if (failures.length) throw new Error(failures[0]);
  };
  const schedulePendingOnDay = async (id: string, day: string) => {
    if (!canEditSchedule || demoMode) return;
    const pending = pendingItems.find(item => item.id === id);
    if (!pending) return;
    const resolution = resolvePendingDrop(pending, calendarInstant(day));
    if (resolution.kind === 'blocked') { setInteractionMessage(resolution.message); return; }
    if (resolution.kind === 'needs-time') {
      setPendingTimeSelection({ id, title: pending.title, day, time: selectedBestHour === null ? '20:00' : `${String(selectedBestHour).padStart(2, '0')}:00` });
      return;
    }
    try { await placePendingContent(id, resolution.scheduledAt); await load(); setInteractionMessage('已按原定点时间安排发布，锁定时间保持不变。'); }
    catch (scheduleError) { setInteractionMessage(scheduleError instanceof Error ? scheduleError.message : '排期失败，请重试'); }
  };
  const confirmPendingTime = async () => {
    if (!pendingTimeSelection) return;
    setPendingTimeSaving(true);
    try {
      const date = calendarInstant(`${pendingTimeSelection.day}T${pendingTimeSelection.time}`);
      if (date.getTime() <= Date.now()) throw new Error('计划发布时间必须晚于当前时间。');
      await placePendingContent(pendingTimeSelection.id, date); await load();
      setInteractionMessage(`已安排到 ${calendarDateTimeValue(date).replace('T', ' ')}（北京时间）。`);
      setPendingTimeSelection(null);
    } catch (scheduleError) { void message.error(scheduleError instanceof Error ? scheduleError.message : '排期失败，请重试'); }
    finally { setPendingTimeSaving(false); }
  };

  return <div className="space-y-4" data-lingshu-guide="content-planner">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold text-text-primary"><CalendarDays size={19}/>内容排产工作台</h2><p className="mt-1 text-sm text-text-secondary">排期、发布状态与平台回执 · 目标市场：{enterpriseMarketLabel}</p></div>{import.meta.env.DEV && <Button onClick={() => setDemoMode(value => !value)}>{demoMode ? '退出演示数据' : '预览演示数据'}</Button>}</header>
    {demoMode && <Alert type="info" showIcon title="模拟数据 · 仅供页面预览，不会提交发布" description="TikTok / Facebook 各 5 条/周 · YouTube / Instagram 各 3 条/周"/>}
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>}/>}
    {interactionMessage && <div role="status"><Alert type="info" showIcon closable title={interactionMessage} onClose={() => setInteractionMessage('')}/></div>}
    <section data-lingshu-guide="content-calendar" className="rounded-lg border border-border bg-white">
      <LsCalendar label="内容发布日历" events={events} initialView="timeGridWeek" loading={loading} onRefresh={() => void load()} onMoveEvent={canEditSchedule && !demoMode ? reschedule : undefined}
        primaryAction={onCreate && canEditSchedule && !demoMode ? <Button type="primary" icon={<Plus size={15}/>} onClick={() => onCreate(selectedDate)}>添加内容</Button> : undefined}
        filters={<Select aria-label="筛选平台" value={platformFilter} onChange={setPlatformFilter} style={{ minWidth: 116 }} options={[{ value: 'all', label: '全部平台' }, ...['tiktok', 'facebook', 'youtube', 'instagram'].map(value => ({ value, label: value === 'youtube' ? 'YouTube' : value === 'tiktok' ? 'TikTok' : value === 'facebook' ? 'Facebook' : 'Instagram' }))]}/>}
        onDatesSet={info => { setVisibleRange(previous => previous.from.getTime() === info.start.getTime() && previous.to.getTime() === info.end.getTime() ? previous : { from: info.start, to: info.end }); setMode(info.view.type); setAnchor(previous => calendarDayKey(previous) === calendarDayKey(info.view.currentStart) ? previous : new Date(`${calendarDayKey(info.view.currentStart)}T12:00:00`)); }}
        onDateClick={date => setSelectedDate(calendarInstant(date.slice(0, 10)))}
        onExternalDrop={canEditSchedule && !demoMode ? (id, day) => void schedulePendingOnDay(id, day) : undefined}
        renderDetails={(event, closeDetails) => {
          const post = event.data as CalendarPost;
          return <div className="space-y-4">
            {post.id.startsWith('demo-calendar-') && <Alert type="info" title="模拟数据 · 不会实际发布"/>}
            {post.videoPreviewUrl || post.videoUrl ? <video src={post.videoPreviewUrl || post.videoUrl} poster={post.coverUrl} controls playsInline className="w-full rounded-lg"/> : null}
            <dl className="ls-calendar-details"><div><dt>成片时长</dt><dd>{post.duration ? `${Math.round(post.duration)} 秒` : '暂无时长'}</dd></div><div><dt>询盘</dt><dd>{post.inquiries || 0} 条</dd></div>{post.firstComment && <div><dt>首评</dt><dd>{post.firstComment}</dd></div>}{post.platformPostId && <div><dt>平台回执</dt><dd>{post.platformPostId}</dd></div>}{post.nextPublishAttemptAt && <div><dt>下次重试</dt><dd>{calendarDateTimeValue(post.nextPublishAttemptAt).replace('T', ' ')} 北京时间</dd></div>}</dl>
            {post.publishError && <Alert type="error" title="发布异常" description={post.publishError}/>}
            {!post.id.startsWith('demo-calendar-') && <div className="flex flex-wrap gap-2">{post.status === 'needs_attention' ? <Button type="primary" onClick={() => { closeDetails(); setRecoveryPost(post); }}>核对平台发布回执</Button> : onOpenPost && <Button type="primary" onClick={() => { closeDetails(); onOpenPost(post); }}>打开完整发布详情</Button>}</div>}
          </div>;
        }}/>
    </section>
    <section data-lingshu-guide="publishing-tide" className="rounded-lg border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-text-primary">发布节奏与节庆</h3><p className="mt-1 text-xs text-text-secondary">{scoreSource} {scoreSource !== '账号真实数据' && '· 非账号实测'} · 目标市场 {market.timeZoneLabel}（{market.timeZone}）</p></div><label className="text-xs text-text-secondary">查看日期<Input className="mt-1" type="date" aria-label="查看发布建议的日期" value={selectedKey} onChange={event => { if (event.target.value) setSelectedDate(calendarInstant(event.target.value)); }}/></label></div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><span>{selectedKey} · {itemsByDay[selectedKey]?.length || 0} 条已排期</span><Tag>{selectedBestHour === null ? '暂无可用推荐时段' : `建议北京时间 ${String(selectedBestHour).padStart(2, '0')}:00`}</Tag></div>
      <details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-sm text-text-secondary">本月电商节庆 · {marketingEvents.length} 项</summary><ul className="mt-3 space-y-3">{marketingEvents.map(event => <li key={event.id} className="border-b border-border pb-3 text-sm"><div className="flex flex-wrap items-center gap-2"><strong className="font-semibold text-text-primary">{event.name}</strong><span className="text-text-secondary">{event.date}</span></div><p className="mt-1 text-text-secondary">{event.note}</p><p className="mt-1 text-xs text-text-muted">来源：{event.source}</p></li>)}</ul></details>
    </section>
    {pendingItems.length > 0 && canEditSchedule && !demoMode && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4"><label className="min-w-56 flex-1 text-xs text-text-secondary">为待发布内容选择日期<Select className="mt-1 w-full" aria-label="待排期内容" placeholder="选择内容" value={pendingId} onChange={setPendingId} options={pendingItems.map(item => ({ value: item.id, label: item.title }))}/></label><Input type="date" aria-label="待发布内容的排期日期" style={{ width: 180 }} value={selectedKey} onChange={event => { if (event.target.value) setSelectedDate(calendarInstant(event.target.value)); }}/><Button disabled={!pendingId} onClick={() => pendingId && void schedulePendingOnDay(pendingId, selectedKey)}>安排到所选日期</Button></div>}
    <ContentQueuePanel selectedPlatform={selectedPlatform} selectedMarket={selectedMarket} marketLabel={enterpriseMarketLabel} marketTimeZone={market.timeZone} utcOffset={utcOffset} posts={demoMode ? [] : items} pendingItems={pendingItems} onOpenPending={onOpenPending} canEdit={canEditSchedule && !demoMode} onArrangePending={canEditSchedule && !demoMode ? arrangePendingContent : undefined}/>
    <Modal title="选择具体发布时间" open={Boolean(pendingTimeSelection)} onCancel={() => { if (!pendingTimeSaving) setPendingTimeSelection(null); }} onOk={() => void confirmPendingTime()} confirmLoading={pendingTimeSaving} okText="确认时间" cancelText="取消" destroyOnHidden>
      {pendingTimeSelection && <div className="space-y-4"><p>{pendingTimeSelection.title}</p><p className="text-sm text-text-secondary">{pendingTimeSelection.day} · 北京时间（Asia/Shanghai）</p><label className="block text-sm text-text-secondary">发布时间<Input autoFocus type="time" value={pendingTimeSelection.time} onChange={event => setPendingTimeSelection(previous => previous ? { ...previous, time: event.target.value } : previous)}/></label><p className="text-xs text-text-secondary">定点内容遵循已锁定时间；时间待定内容需要选择未来时间。</p></div>}
    </Modal>
    <Drawer title="核对平台发布回执" open={Boolean(recoveryPost)} onClose={() => setRecoveryPost(null)} size={520} destroyOnHidden>{recoveryPost && <div className="space-y-4"><h3 className="text-base font-semibold">{recoveryPost.title}</h3><PublishingReceiptRecovery postId={recoveryPost.id} onRecovered={() => load(true)}/></div>}</Drawer>
  </div>;
}
