import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Tag } from 'antd';
import { authHeader } from '../../lib/auth';
import type { MarketId } from './marketingCalendar';
import type { CalendarPost, PendingPublishContent } from './CalendarPlanner';
import { PlatformBadge } from './PlatformBadge';

type RhythmPreset = 'light' | 'standard' | 'high';

type PostingSchedule = {
  id?: string;
  platform: string;
  market: MarketId;
  timeZone: string;
  utcOffset: number;
  preset: RhythmPreset;
  slots: Array<{ weekday: number; time: string }>;
};

export type PendingPlacement = { id: string; scheduledAt: Date };

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const PRESETS: Array<{
  id: RhythmPreset;
  label: string;
  summary: string;
  weekdays: number[];
}> = [
  { id: 'light', label: '轻度', summary: '每周 3 条', weekdays: [1, 3, 5] },
  { id: 'standard', label: '标准', summary: '每周 5 条', weekdays: [1, 2, 3, 4, 5] },
  { id: 'high', label: '高频', summary: '每天 1 条', weekdays: [0, 1, 2, 3, 4, 5, 6] },
];

function presetSlots(preset: RhythmPreset): Array<{ weekday: number; time: string }> {
  const selected = PRESETS.find(item => item.id === preset) ?? PRESETS[1];
  return selected.weekdays.map(weekday => ({ weekday, time: '20:00' }));
}

function timeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number);
  return {
    hour: Math.max(0, Math.min(23, hour || 0)),
    minute: Math.max(0, Math.min(59, minute || 0)),
  };
}

function targetToday(timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

function instantForTargetSlot(day: Date, time: string, utcOffset: number): Date {
  const { hour, minute } = timeParts(time);
  const utc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute) - utcOffset * 3_600_000;
  return new Date(utc);
}

function upcomingSlots(schedule: PostingSchedule, limit = 40): Array<{ id: string; scheduledAt: Date }> {
  const now = new Date();
  const start = targetToday(schedule.timeZone);
  const slots: Array<{ id: string; scheduledAt: Date }> = [];
  for (let offset = 0; offset < 56 && slots.length < limit; offset += 1) {
    const targetDay = new Date(start);
    targetDay.setDate(targetDay.getDate() + offset);
    for (const slot of schedule.slots.filter(item => item.weekday === targetDay.getDay())) {
      const scheduledAt = instantForTargetSlot(targetDay, slot.time, schedule.utcOffset);
      if (scheduledAt.getTime() <= now.getTime() + 30 * 60_000) continue;
      slots.push({ id: `slot-${scheduledAt.toISOString()}`, scheduledAt });
    }
  }
  return slots.sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime()).slice(0, limit);
}

function isSameSlot(left: Date, right: Date): boolean {
  return Math.abs(left.getTime() - right.getTime()) < 45 * 60_000;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'request_failed');
  return data as T;
}

export function ContentQueuePanel({
  selectedPlatform,
  selectedMarket,
  marketLabel,
  marketTimeZone,
  utcOffset,
  posts,
  pendingItems,
  onOpenPending,
  onArrangePending,
  compact = false,
  canEdit = true,
}: {
  selectedPlatform: string;
  selectedMarket: MarketId;
  marketLabel: string;
  marketTimeZone: string;
  utcOffset: number;
  posts: CalendarPost[];
  pendingItems: PendingPublishContent[];
  onOpenPending?: (id: string) => void;
  onArrangePending?: (placements: PendingPlacement[]) => Promise<void>;
  compact?: boolean;
  canEdit?: boolean;
}) {
  const [schedule, setSchedule] = useState<PostingSchedule>({
    platform: selectedPlatform,
    market: selectedMarket,
    timeZone: marketTimeZone,
    utcOffset,
    preset: 'standard',
    slots: presetSlots('standard'),
  });
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [message, setMessage] = useState('');
  const [queueExpanded, setQueueExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setScheduleLoading(true);
    api<{ item: { id?: string; preset?: RhythmPreset; slots?: Array<{ weekday: number; time: string }> } }>(
      `/api/overseas/publishing/posting-schedule?platform=${encodeURIComponent(selectedPlatform)}`,
    )
      .then(({ item }) => {
        if (!active) return;
        const preset = item.preset === 'light' || item.preset === 'high' ? item.preset : 'standard';
        setSchedule({
          id: item.id,
          platform: selectedPlatform,
          market: selectedMarket,
          timeZone: marketTimeZone,
          utcOffset,
          preset,
          slots: Array.isArray(item.slots) && item.slots.length ? item.slots : presetSlots(preset),
        });
      })
      .catch(() => {
        if (!active) return;
        setSchedule({
          platform: selectedPlatform,
          market: selectedMarket,
          timeZone: marketTimeZone,
          utcOffset,
          preset: 'standard',
          slots: presetSlots('standard'),
        });
      })
      .finally(() => {
        if (active) setScheduleLoading(false);
      });
    return () => { active = false; };
  }, [selectedPlatform]);

  useEffect(() => {
    setSchedule(previous => ({
      ...previous,
      platform: selectedPlatform,
      market: selectedMarket,
      timeZone: marketTimeZone,
      utcOffset,
    }));
  }, [marketTimeZone, selectedMarket, selectedPlatform, utcOffset]);

  const futurePosts = useMemo(
    () => posts.filter(post => Date.parse(post.publishedAt) > Date.now() - 30 * 60_000),
    [posts],
  );
  const openSlots = useMemo(
    () => upcomingSlots(schedule).filter(slot => !futurePosts.some(post => isSameSlot(new Date(post.publishedAt), slot.scheduledAt))),
    [futurePosts, schedule],
  );
  const arrangeableItems = useMemo(
    () => pendingItems.filter(item => item.deliveryMode === 'flexible'),
    [pendingItems],
  );
  const draggableItems = pendingItems.filter(item => (
    item.deliveryMode === 'flexible' ||
    (item.deliveryMode === 'schedule' && Boolean(item.scheduledAt && Number.isFinite(Date.parse(item.scheduledAt))))
  ));

  const savePreset = async (preset: RhythmPreset) => {
    if (!canEdit) return;
    const previousSchedule = schedule;
    const next: PostingSchedule = {
      ...schedule,
      platform: selectedPlatform,
      market: selectedMarket,
      timeZone: marketTimeZone,
      utcOffset,
      preset,
      slots: presetSlots(preset),
    };
    setSchedule(next);
    setScheduleSaving(true);
    setMessage('');
    try {
      const data = await api<{ item: { id?: string } }>('/api/overseas/publishing/posting-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedPlatform,
          market: selectedMarket,
          timeZone: marketTimeZone,
          utcOffset,
          preset,
          slots: next.slots,
        }),
      });
      setSchedule(previous => ({ ...previous, id: data.item.id }));
      setMessage('发布节奏已保存');
    } catch {
      setSchedule(previousSchedule);
      setMessage('保存失败，已恢复原发布节奏，请重试');
    } finally {
      setScheduleSaving(false);
    }
  };

  const arrangeWithAi = async () => {
    if (!canEdit) return;
    const placements = arrangeableItems.slice(0, openSlots.length).map((item, index) => ({
      id: item.id,
      scheduledAt: openSlots[index].scheduledAt,
    }));
    if (!placements.length || !onArrangePending) return;
    setArranging(true);
    setMessage('');
    try {
      await onArrangePending(placements);
      setMessage(`已排布 ${placements.length} 条视频`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '自动排布失败');
    } finally {
      setArranging(false);
    }
  };

  return <div className={`grid items-start gap-4 ${compact ? '' : 'lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
    <section data-lingshu-guide="publishing-rhythm" className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-base font-semibold text-text-primary">发布节奏</h3><p className="mt-1 text-xs text-text-secondary">{marketLabel} · {marketTimeZone}</p></div>
        <Button data-lingshu-guide="ai-layout" size="small" onClick={() => void arrangeWithAi()} loading={arranging} disabled={!canEdit || !onArrangePending || scheduleLoading || scheduleSaving || arrangeableItems.length === 0 || openSlots.length === 0}>按节奏排布</Button>
      </div>
      <Segmented className="mt-4" block aria-label="发布频率" value={schedule.preset} disabled={!canEdit || scheduleLoading || scheduleSaving || arranging} onChange={value => void savePreset(value as RhythmPreset)} options={PRESETS.map(preset => ({ value: preset.id, label: <div className="py-1 text-sm">{preset.label}<span className="block text-xs text-text-secondary">{preset.summary}</span></div> }))}/>
      <div className="mt-3 flex flex-wrap gap-1">{schedule.slots.map(slot => <Tag key={`${slot.weekday}-${slot.time}`}>{WEEKDAY_LABELS[slot.weekday]} {slot.time}</Tag>)}</div>
      {message && <div className="mt-3" role="status"><Alert type="info" title={message}/></div>}
    </section>
    <section data-lingshu-guide="future-queue" className="overflow-hidden rounded-lg border border-border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><div><h3 className="text-base font-semibold text-text-primary">待发布内容</h3><p className="mt-1 text-xs text-text-secondary">{pendingItems.length} 条 · {draggableItems.length} 条可排入日历</p></div>{pendingItems.length > 0 && <Button size="small" onClick={() => setQueueExpanded(previous => !previous)} aria-expanded={queueExpanded}>{queueExpanded ? '收起' : '展开'}</Button>}</header>
      <div aria-label="待发布内容列表" className={`grid gap-3 p-4 ${queueExpanded ? 'max-h-[480px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] overflow-y-auto' : 'auto-cols-[240px] grid-flow-col overflow-x-auto'}`}>
        {pendingItems.length === 0 ? <div className="col-span-full py-6 text-center"><p className="text-sm text-text-primary">还没有待发布视频</p><p className="mt-1 text-xs text-text-secondary">视频编辑完成并保存后，会出现在这里</p></div> : pendingItems.map(item => {
          const fixedDate = item.scheduledAt ? new Date(item.scheduledAt) : null;
          const hasFixedDate = Boolean(fixedDate && Number.isFinite(fixedDate.getTime()));
          const isFlexible = item.deliveryMode === 'flexible', isFixed = item.deliveryMode === 'schedule';
          const canDrag = canEdit && (isFlexible || (isFixed && hasFixedDate));
          const platforms = item.platforms?.length ? item.platforms : [item.sourcePlatform || selectedPlatform];
          return <button key={item.id} type="button" draggable={canDrag} onDragStart={event => { if (!canDrag) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-lingshu-pending-content', item.id); event.dataTransfer.setData('text/plain', item.title); }} onClick={() => onOpenPending?.(item.id)} className="flex min-h-36 min-w-0 flex-col gap-3 rounded-lg border border-border bg-white p-3 text-left hover:border-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent" title={canDrag ? '拖入日历或使用上方日期控件安排时间；点击编辑内容' : '点击编辑内容'}>
            <span className="flex items-center justify-between gap-2"><span className="flex gap-1">{platforms.slice(0, 3).map(platform => <PlatformBadge key={platform} platform={platform} compact/>)}</span><span className="text-xs text-text-secondary">{isFixed ? '定点排期' : isFlexible ? '时间待定' : '立即发布'}</span></span>
            <span className="line-clamp-2 text-sm font-medium text-text-primary">{item.title || '待填写标题的视频'}</span>
            {queueExpanded && item.description && <span className="line-clamp-2 text-xs text-text-secondary">{item.description}</span>}
            <span className="mt-auto text-xs text-text-secondary">{isFixed && hasFixedDate ? `锁定 ${fixedDate!.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 北京时间` : isFlexible ? '安排日期后选择具体时间' : '确认后发布'}</span>
          </button>;
        })}
      </div>
    </section>
  </div>;
}
