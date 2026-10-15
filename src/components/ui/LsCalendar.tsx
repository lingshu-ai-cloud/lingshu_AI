import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Drawer, Input, Segmented, Spin, Tag } from 'antd';
import { ChevronLeft, ChevronRight, ImageOff, RefreshCw, UserRound, CircleAlert, CircleCheck } from 'lucide-react';
import FullCalendar, { type CalendarRef, type DatesSetInfo, type EventInput } from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import listPlugin from '@fullcalendar/react/list';
import multiMonthPlugin from '@fullcalendar/react/multimonth';
import interactionPlugin from '@fullcalendar/react/interaction';
import themePlugin from '@fullcalendar/react/themes/classic';
import zhLocale from '@fullcalendar/react/locales/zh-cn';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import { calendarDateTimeValue, calendarDayKey, calendarInstant, calendarMovedInstant, calendarStatusLabels, type LsCalendarEvent, type LsCalendarIdentity } from '../../lib/calendarModel';
import { authHeader } from '../../lib/auth';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { SocialPlatformIcon, socialBrandLabel } from '../SocialPlatformIcon';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from './AgentRoleIcon';
import { LsMediaStateFrame } from './LsExperiencePrimitives';
import './calendar.css';

export { calendarDayKey, type LsCalendarEvent } from '../../lib/calendarModel';
export type LsCalendarView = 'dayGridMonth' | 'dayGridWeek' | 'dayGridDay' | 'timeGridWeek' | 'timeGridDay' | 'listWeek' | 'multiMonthYear';
type Props = {
  events: LsCalendarEvent[];
  label: string;
  initialDate?: string;
  initialView?: LsCalendarView;
  view?: LsCalendarView;
  firstDay?: number;
  eventCardMode?: 'compact' | 'media';
  visualVariant?: 'default' | 'agent';
  narrowView?: LsCalendarView;
  /** Keep week/day navigation on date columns when events have no verified time. */
  dateOnly?: boolean;
  taskBoard?: boolean;
  /** Render every event in date-only week/day views; month/year keep native overflow. */
  showAllEvents?: boolean;
  density?: 'default' | 'compact';
  flush?: boolean;
  date?: string;
  timeZone?: string;
  loading?: boolean;
  timeGridHeight?: number | string;
  collapseEmptyTimeRanges?: boolean;
  fixedHeight?: number | string;
  primaryAction?: ReactNode;
  filters?: ReactNode;
  onRefresh?: () => void;
  onDatesSet?: (info: DatesSetInfo) => void;
  onDateClick?: (date: string, allDay: boolean) => void;
  /** Return true only when the caller handled navigation and the details drawer should stay closed. */
  onEventClick?: (event: LsCalendarEvent) => boolean | void;
  onExternalDrop?: (pendingId: string, day: string) => void;
  onMoveEvent?: (event: LsCalendarEvent, start: string) => Promise<void>;
  detailsTitle?: string;
  onDetailsClose?:()=>void;
  detailsMedia?: 'large' | 'compact';
  detailsLayout?: 'standard' | 'custom';
  workspaceMode?: 'bounded' | 'expanded';
  renderDetails?: (event: LsCalendarEvent, closeDetails: () => void) => ReactNode;
};

function calendarEventClickConsumed(event: LsCalendarEvent, handler?: (event: LsCalendarEvent) => boolean | void) {
  return handler?.(event) === true;
}

const THUMBNAIL_TIMEOUT_MS = 4_000;
const protectedThumbnailCache = new Map<string, Promise<Blob | null>>();

function loadProtectedThumbnail(src: string, refresh = false): Promise<Blob | null> {
  if (refresh) protectedThumbnailCache.delete(src);
  const cached = protectedThumbnailCache.get(src);
  if (cached) return cached;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
  const request = fetch(src, { headers: authHeader(), signal: controller.signal })
    .then(response => {
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('thumbnail_unavailable');
      return response.blob();
    })
    .catch(() => null)
    .then(blob => {
      // Do not make a transient timeout sticky. Cold thumbnail recovery may
      // still be persisting the source cover when the first request expires.
      if (!blob) protectedThumbnailCache.delete(src);
      return blob;
    })
    .finally(() => window.clearTimeout(timeout));
  protectedThumbnailCache.set(src, request);
  return request;
}

function CalendarThumbnail({ src, title, large = false, card = false, compact = false }: { src?: string; title: string; large?: boolean; card?: boolean; compact?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const [loadedSource, setLoadedSource] = useState<string | undefined>();
  const [resolvedSource, setResolvedSource] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    setFailedSource(undefined);
    setLoadedSource(undefined);
    setResolvedSource('');
    if (!src) return;
    let protectedSource = '';
    try {
      const absolute = new URL(src, window.location.href);
      protectedSource = absolute.origin === window.location.origin && absolute.pathname.startsWith('/api/')
        ? `${absolute.pathname}${absolute.search}`
        : '';
    } catch {
      setFailedSource(src);
      return;
    }
    const direct = !protectedSource;
    if (direct) {
      setResolvedSource(src);
      return;
    }
    let disposed = false;
    let objectUrl = '';
    let retryTimer = 0;
    void loadProtectedThumbnail(protectedSource, retryKey > 0)
      .then(blob => {
        if (disposed) return;
        if (!blob) {
          if (retryKey === 0) retryTimer = window.setTimeout(() => setRetryKey(value => value + 1), 1_200);
          else setFailedSource(src);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setResolvedSource(objectUrl);
      });
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, retryKey]);
  const failed = Boolean(src && failedSource === src);
  const ready = Boolean(resolvedSource && loadedSource === resolvedSource);
  const loading = Boolean(src && !failed && !ready);
  const mediaState = failed || !src ? 'error' : ready ? 'ready' : 'loading';
  return <div className={compact ? 'ls-calendar-detail-thumb' : large ? 'ls-calendar-media' : card ? 'ls-calendar-card-media' : 'ls-calendar-thumb'}>
    <LsMediaStateFrame state={mediaState} label={loading ? '正在加载封面' : failed ? '封面暂不可用' : !src ? '暂无封面' : undefined}>
      {resolvedSource && !failed ? <img src={resolvedSource} alt={title} loading={card ? 'eager' : 'lazy'} decoding="async" className={ready ? 'is-ready' : undefined} onLoad={() => setLoadedSource(resolvedSource)} onError={() => setFailedSource(src)}/> : null}
      {!src && <ImageOff size={large || card ? 24 : 16} aria-hidden="true"/>}
    </LsMediaStateFrame>
    {large && failed && <Button size="small" onClick={() => setRetryKey(value => value + 1)}>重新加载</Button>}
  </div>;
}

const humanIdentity = { color: '#BE123C', tint: '#FFF1F2' };

function CalendarIdentityMark({ identity }: { identity: LsCalendarIdentity }) {
  if (identity.kind === 'platform') {
    return <span className="ls-calendar-event-identity" role="img" aria-label={`${socialBrandLabel(identity.platform)} 平台`}><SocialPlatformIcon platform={identity.platform} size={21}/></span>;
  }
  if (identity.role === 'human') {
    return <span className="ls-calendar-event-identity" role="img" aria-label="人工处理" style={{ color: humanIdentity.color, backgroundColor: humanIdentity.tint, borderColor: humanIdentity.color }}><UserRound size={18}/></span>;
  }
  const role = identity.role as AgentVisualRole;
  return <span className="ls-calendar-event-identity" style={{ backgroundColor: AGENT_ROLE_PALETTE[role].tint, borderColor: AGENT_ROLE_PALETTE[role].color }}><AgentRoleIcon role={role} size="sm" label="负责 Agent"/></span>;
}

/** Standard plugins only: all calendar pages share the same events, timezone and accessible detail path. */
export function LsCalendar({ events, label, initialDate, initialView = 'dayGridMonth', view: controlledView, firstDay = 1, eventCardMode = 'compact', visualVariant = 'default', narrowView = 'listWeek', dateOnly = false, taskBoard = false, showAllEvents = false, density = 'default', flush = false, date, timeZone = 'Asia/Shanghai', loading, timeGridHeight = 'clamp(320px, calc(100dvh - 280px), 720px)', collapseEmptyTimeRanges = false, fixedHeight, primaryAction, filters, onRefresh, onDatesSet, onDateClick, onEventClick, onExternalDrop, onMoveEvent, detailsTitle = '排期详情', onDetailsClose, detailsMedia = 'large', detailsLayout = 'standard', workspaceMode = 'bounded', renderDetails }: Props) {
  const calendarRef = useRef<CalendarRef>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const revealObserverRef = useRef<IntersectionObserver | null>(null);
  const revealedEventIdsRef = useRef(new Set<string>());
  const mountedEventElementsRef = useRef(new Set<HTMLElement>());
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const reducedMotion = usePrefersReducedMotion();
  const { modal, message } = App.useApp();
  const [view, setView] = useState<LsCalendarView>(() => typeof window !== 'undefined' && window.innerWidth < 640 ? narrowView : initialView);
  const [title, setTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find(event => event.id === selectedId);
  const [moveValue, setMoveValue] = useState('');
  const moveInputId = useId();
  const [moving, setMoving] = useState(false);
  const previousWidth = useRef<boolean | undefined>(undefined);
  const weekView: LsCalendarView = dateOnly || eventCardMode === 'media' ? 'dayGridWeek' : 'timeGridWeek';
  const dayView: LsCalendarView = dateOnly || eventCardMode === 'media' ? 'dayGridDay' : 'timeGridDay';
  const moveRef = useRef(onMoveEvent);
  moveRef.current = onMoveEvent;
  const compact = density === 'compact';

  useEffect(() => {
    if (controlledView) { setView(controlledView); const api=calendarRef.current?.getApi(); if(api&&api.view.type!==controlledView)api.changeView(controlledView); }
  }, [controlledView]);
  useEffect(() => {
    if (date) calendarRef.current?.getApi().gotoDate(date);
  }, [date]);
  useEffect(() => {
    if (!selected) return;
    setMoveValue(selected.allDay ? `${selected.start.slice(0, 10)}T09:00` : calendarDateTimeValue(selected.start, selected.timeZone));
  }, [selected?.id, selected?.start, selected?.timeZone]);
  useEffect(() => {
    if (!hostRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0) return;
      const narrow = entry.contentRect.width < 640;
      if (narrow && !previousWidth.current) {
        calendarRef.current?.getApi().changeView(narrowView);
        setView(narrowView);
      } else if (!narrow && previousWidth.current) {
        const restored = controlledView || initialView;
        calendarRef.current?.getApi().changeView(restored);
        setView(restored);
      }
      previousWidth.current = narrow;
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [controlledView, initialView, narrowView]);
  useEffect(() => {
    if (!reducedMotion) return;
    revealObserverRef.current?.disconnect();
    revealObserverRef.current = null;
    mountedEventElementsRef.current.forEach(element => {
      const eventId = element.dataset.calendarRevealId;
      if (eventId) revealedEventIdsRef.current.add(eventId);
      element.classList.add('is-revealed');
    });
  }, [reducedMotion]);
  useEffect(() => () => {
    revealObserverRef.current?.disconnect();
    revealObserverRef.current = null;
    mountedEventElementsRef.current.clear();
  }, []);
  const inputs = useMemo<EventInput[]>(() => {
    const ordered = [...events].sort((left, right) => {
      const leftInstant = new Date(left.start).getTime();
      const rightInstant = new Date(right.start).getTime();
      const startOrder = Number.isFinite(leftInstant) && Number.isFinite(rightInstant)
        ? leftInstant - rightInstant
        : left.start.localeCompare(right.start);
      return startOrder || left.id.localeCompare(right.id);
    });
    // FullCalendar normally solves overlapping timed events by splitting the
    // day column horizontally. Agent cards need their key task line to keep
    // the whole column width, so feed FullCalendar non-overlapping visual
    // instants while keeping the authoritative event in `extendedProps.item`.
    // Card copy, details and persistence therefore continue to use the real
    // schedule, while simultaneous cards are laid out one below another.
    const visualCursorByDay = new Map<string, number>();
    return ordered.map(event => {
      const actualStart = new Date(event.start).getTime();
      const actualEnd = event.end ? new Date(event.end).getTime() : Number.NaN;
      const isVerticalTimedCard = Boolean(!taskBoard && event.cardLines && !event.allDay && Number.isFinite(actualStart));
      const dayKey = event.start.slice(0, 10);
      const visualCursor = visualCursorByDay.get(dayKey) ?? Number.NEGATIVE_INFINITY;
      const visualStart = isVerticalTimedCard ? Math.max(actualStart, visualCursor) : actualStart;
      // Agent cards keep a complete three-row hour slot. The authoritative
      // start/end remain on `extendedProps.item` for copy, details and moves;
      // longer estimates do not stretch the visual card beyond one hour.
      const visualDuration = event.cardLines ? 60 * 60_000
        : Number.isFinite(actualEnd) && actualEnd > actualStart
          ? Math.max(actualEnd - actualStart, 30 * 60_000)
          : 30 * 60_000;
      if (isVerticalTimedCard) visualCursorByDay.set(dayKey, visualStart + visualDuration);
      const visualEnd = visualStart + visualDuration;
      return {
      id: event.id,
      title: event.title,
      start: isVerticalTimedCard ? new Date(visualStart).toISOString() : event.start,
      end: isVerticalTimedCard ? new Date(visualEnd).toISOString() : event.end,
      allDay: event.allDay,
      startEditable: Boolean(event.editable && onMoveEvent), durationEditable: false,
      interactive: true, extendedProps: { item: event, isVerticalTimedCard, taskOrder: events.indexOf(event) },
      };
    });
  }, [events, Boolean(onMoveEvent), taskBoard]);
  const occupiedTimeSlots = useMemo(() => {
    if (!collapseEmptyTimeRanges) return new Set<string>();
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const minuteOfDay = (value: Date) => {
      const parts = formatter.formatToParts(value);
      const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
      const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
      return hour * 60 + minute;
    };
    const slots = new Set<string>();
    for (const input of inputs) {
      if (input.allDay || !input.start) continue;
      const start = new Date(String(input.start));
      const end = input.end ? new Date(String(input.end)) : new Date(start.getTime() + 30 * 60_000);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      const first = Math.floor(minuteOfDay(start) / 30) * 30;
      const last = Math.max(first + 30, Math.ceil(minuteOfDay(end) / 30) * 30);
      for (let minute = first; minute < last; minute += 30) slots.add(String(minute));
    }
    return slots;
  }, [collapseEmptyTimeRanges, inputs, timeZone]);
  const slotClassNames = (date: Date) => collapseEmptyTimeRanges && !occupiedTimeSlots.has(String(date.getHours() * 60 + date.getMinutes())) ? 'ls-calendar-slot-collapsed' : '';

  const move = async (event: LsCalendarEvent, newStart: string) => {
    if (!event.editable || !moveRef.current) throw new Error('当前事件不允许调整排期');
    const next = new Date(newStart);
    if (!Number.isFinite(next.getTime())) throw new Error('请选择有效时间');
    const crossesDay = calendarDayKey(event.start, event.timeZone) !== calendarDayKey(next, event.timeZone);
    if (crossesDay || event.status === 'working') {
      const confirmed = await new Promise<boolean>(resolve => modal.confirm({
        title: '确认调整排期',
        zIndex: 2000,
        content: `${event.title}将移动到 ${next.toLocaleString('zh-CN', { timeZone: event.timeZone })}（${event.timeZone}）。${event.status === 'working' ? '该任务已进入执行，请确认相关安排。' : '此变更跨越日期，请确认发布安排。'}`,
        okText: '确认调整', cancelText: '取消', onOk: () => resolve(true), onCancel: () => resolve(false),
      }));
      if (!confirmed) throw new Error('已取消排期调整');
    }
    await moveRef.current(event, next.toISOString());
  };
  const revealEventElement = (element: HTMLElement) => {
    const eventId = element.dataset.calendarRevealId;
    if (eventId) revealedEventIdsRef.current.add(eventId);
    element.classList.add('is-revealed');
    revealObserverRef.current?.unobserve(element);
  };
  const showDateOnlyTimeRail = !taskBoard && (dateOnly || eventCardMode === 'media') && ['dayGridWeek', 'dayGridDay'].includes(view);
return <div className={`ls-calendar ls-calendar-view-${view}${taskBoard ? ' ls-calendar-task-board' : ''}${visualVariant === 'agent' ? ' ls-calendar-agent-view' : ''}${eventCardMode === 'media' ? ' ls-calendar-media-cards' : ''}${compact ? ' ls-calendar-compact' : ''}${flush ? ' ls-calendar-flush' : ''}${workspaceMode === 'expanded' ? ' ls-calendar-expanded' : ''}`} ref={hostRef} aria-label={label} onFocusCapture={event => {
    const eventElement = (event.target as HTMLElement).closest<HTMLElement>('.ls-calendar-event-reveal');
    if (eventElement) revealEventElement(eventElement);
  }}>
    <div className="ls-calendar-toolbar">
      {primaryAction}
      <Button size={compact ? 'small' : 'middle'} onClick={() => calendarRef.current?.getApi().today()}>今天</Button>
      <div className="ls-calendar-navigation"><Button size={compact ? 'small' : 'middle'} aria-label="上一周期" icon={<ChevronLeft size={16}/>} onClick={() => calendarRef.current?.getApi().prev()}/><Button size={compact ? 'small' : 'middle'} aria-label="下一周期" icon={<ChevronRight size={16}/>} onClick={() => calendarRef.current?.getApi().next()}/></div>
      <h3 aria-live="polite">{title}</h3>
      {compact && <div className="ls-calendar-inline-meta"><span title={timeZone}>{timeZone === 'Asia/Shanghai' ? '北京时间' : timeZone}</span><span role="status">{loading ? <><Spin size="small"/> 同步中</> : `${events.length} 项`}</span></div>}
      <Segmented size={compact ? 'small' : 'middle'} aria-label="日历视图" value={view} options={[{ label: '月', value: 'dayGridMonth' }, { label: '周', value: weekView }, { label: '日', value: dayView }, { label: '列表', value: 'listWeek' }, { label: '全年', value: 'multiMonthYear' }]} onChange={value => { setView(value as LsCalendarView); calendarRef.current?.getApi().changeView(value); }}/>
      {filters}
      {onRefresh && <Button size={compact ? 'small' : 'middle'} aria-label="刷新日历" icon={<RefreshCw size={15}/>} onClick={onRefresh} loading={loading}/>}
    </div>
    {!compact && <div className="ls-calendar-meta"><span>{timeZone === 'Asia/Shanghai' ? '北京时间 · Asia/Shanghai' : `时区：${timeZone}`}</span><span role="status">{loading ? <><Spin size="small"/> 正在同步，保留当前排期</> : `已加载 ${events.length} 项排期`}</span></div>}
    <div className={`ls-calendar-workspace${showDateOnlyTimeRail ? ' has-date-only-time-rail' : ''}`}>
      {showDateOnlyTimeRail && <aside className="ls-calendar-date-only-time-rail" aria-label="排期时间：全天，具体时刻待定" title="当前计划只有发布日期，具体发布时间待确认"><span>时间</span><strong>全天</strong><small>待定</small></aside>}
      <div className="ls-calendar-surface" onDragOver={event => { if (onExternalDrop && event.dataTransfer.types.includes('application/x-lingshu-pending-content')) event.preventDefault(); }} onDrop={event => {
        if (!onExternalDrop) return;
        const pendingId = event.dataTransfer.getData('application/x-lingshu-pending-content');
        const day = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-date]')?.dataset.calendarDate;
        if (pendingId && day) { event.preventDefault(); onExternalDrop(pendingId, day); }
      }}>
      <FullCalendar ref={calendarRef} plugins={[themePlugin, dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]} locale={zhLocale} timeZone={timeZone} firstDay={firstDay} initialView={view} initialDate={initialDate || undefined}
        // Every view shares a bounded FullCalendar content window. FullCalendar
        // owns the sole internal scroller; the surrounding page stays stable.
headerToolbar={false} contentHeight={fixedHeight === 'auto' && showAllEvents && !['dayGridWeek', 'dayGridDay'].includes(view) ? timeGridHeight : fixedHeight ?? timeGridHeight} events={inputs} eventOrder={taskBoard ? 'taskOrder' : 'start,id'} eventOrderStrict slotEventOverlap={false} editable={Boolean(onMoveEvent)} eventDurationEditable={false} eventInteractive dayMaxEvents={taskBoard || (showAllEvents || eventCardMode === 'media') && ['dayGridWeek', 'dayGridDay'].includes(view) ? false : 3} nowIndicator expandRows={!taskBoard} tableHeaderSticky
        allDaySlot={eventCardMode === 'media' ? false : inputs.some(event => event.allDay)} noEventsText="当前周期没有排期" slotMinTime="08:00:00" slotMaxTime="22:00:00" slotDuration="00:30:00" slotHeaderInterval="02:00:00" scrollTime="08:00:00" scrollTimeReset slotHeaderFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }} eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        slotLaneClass={(info: {date: Date}) => slotClassNames(info.date)}
        eventMinHeight={24} eventShortHeight={68} columnEventInnerClass="ls-calendar-time-inner"
        datesSet={info => { setTitle(info.view.title); setView(info.view.type as LsCalendarView); onDatesSet?.(info); }}
        dateClick={info => onDateClick?.(info.dateStr, info.allDay)}
        dayCellClass={info => [info.isToday ? 'ls-calendar-today' : '', [0, 6].includes(info.dow) ? 'ls-calendar-weekend' : ''].join(' ')}
        dayCellDidMount={info => { info.el.dataset.calendarDate = calendarDayKey(info.date, timeZone); }}
        dayLaneDidMount={info => { info.el.dataset.calendarDate = calendarDayKey(info.date, timeZone); }}
        eventClass={info => { const item = info.event.extendedProps.item as LsCalendarEvent; const aggregateGroup = item.data && typeof item.data === 'object' && (item.data as {kind?: string}).kind === 'aggregate' ? (item.data as {group?: string}).group : ''; return `ls-calendar-event ls-calendar-event-${item.status}${taskBoard && item.identity?.kind === 'agent' ? ` ls-calendar-agent-${item.identity.role}` : ''} ls-calendar-event-reveal${item.cardLines ? ' ls-calendar-event-three-row' : ''}${item.planPlaceholder ? ' ls-calendar-event-placeholder' : ''}${aggregateGroup ? ` ls-calendar-event-aggregate ls-calendar-event-aggregate-${aggregateGroup}` : ''}${reducedMotion || revealedEventIdsRef.current.has(info.event.id) ? ' is-revealed' : ''}`; }}
        eventContent={info => {
          const item = info.event.extendedProps.item as LsCalendarEvent;
          if (taskBoard && item.cardLines) return <div className="ls-calendar-event-content ls-calendar-task-board-card"><span className="ls-calendar-event-row ls-calendar-event-row-owner" title={item.cardLines[0]}>{item.cardLines[0]}</span><strong className="ls-calendar-event-row ls-calendar-event-row-title" title={item.title}>{item.title}</strong><span className="ls-calendar-event-row ls-calendar-event-row-state" title={item.cardLines[2]}>{item.cardLines[2]}</span>{['needs_action','failed'].includes(item.status)?<span className="ls-calendar-task-status-mark is-missing" aria-label="缺少执行条件"><CircleAlert size={17}/></span>:item.status==='done'?<span className="ls-calendar-task-status-mark is-complete" aria-label="已完成交付"><CircleCheck size={17}/></span>:null}</div>;
          if (info.view.type.startsWith('timeGrid') && info.event.allDay) {
            return <div className="ls-calendar-event-content ls-calendar-event-content-all-day">
              {item.identity ? <CalendarIdentityMark identity={item.identity}/> : <CalendarThumbnail src={item.thumbnailUrl} title={item.title}/>}
              <div className="ls-calendar-event-copy"><div className="ls-calendar-event-meta">{item.platform && item.identity?.kind !== 'platform' && <SocialPlatformIcon platform={item.platform} size={13}/>}<span>{item.accountName || item.ownerAgent || '待绑定账号'}</span></div><strong>{item.title}</strong></div>
            </div>;
          }
          if (info.view.type.startsWith('timeGrid') && !info.event.allDay) {
            if (item.cardLines) return <div className="ls-calendar-event-content ls-calendar-event-content-three-row">
              <span className="ls-calendar-event-row ls-calendar-event-row-owner" title={item.cardLines[0]}>{item.cardLines[0]}</span>
              <strong className="ls-calendar-event-row ls-calendar-event-row-title" title={item.cardLines[1]}>{item.cardLines[1]}</strong>
              <span className="ls-calendar-event-row ls-calendar-event-row-state" title={item.cardLines[2]}>{item.cardLines[2]}</span>
              {item.status === 'done' && !item.planPlaceholder ? <span className="ls-calendar-event-completed-check" aria-label="已完成">✓</span> : null}
            </div>;
            // v7 measures each rendered segment before setting isShort, including
            // clipped multi-day events. Only sufficiently tall slots get media.
            return <div className={`ls-calendar-event-content ls-calendar-event-content-timed${info.isShort ? ' is-short' : ''}`}>
              {item.identity ? <CalendarIdentityMark identity={item.identity}/> : <CalendarThumbnail src={item.thumbnailUrl} title={item.title}/>}
              <div className="ls-calendar-event-copy">
                {!info.isShort && <div className="ls-calendar-event-meta">{item.platform && item.identity?.kind !== 'platform' && <SocialPlatformIcon platform={item.platform} size={13}/>}<span>{item.accountName || item.ownerAgent || '待绑定账号'}</span></div>}
                <strong>{item.title}</strong><span className="ls-calendar-event-time">{info.timeText}</span>
              </div>
            </div>;
          }
          if (eventCardMode === 'media' && !['dayGridMonth', 'multiMonthYear', 'listWeek'].includes(info.view.type)) {
            return <div className="ls-calendar-event-content ls-calendar-event-content-media">
              <div className="ls-calendar-event-poster">
                <CalendarThumbnail src={item.thumbnailUrl} title={item.title} card/>
                <span className="ls-calendar-event-platform-badge" title={item.accountName || item.ownerAgent || '待绑定账号'}>{item.platform && <SocialPlatformIcon platform={item.platform} size={12}/>}<span>{item.accountName || item.ownerAgent || '待绑定账号'}</span></span>
                {item.status !== 'planned' && <span className="ls-calendar-event-status-badge">{item.statusLabel || calendarStatusLabels[item.status]}</span>}
              </div>
              <div className="ls-calendar-event-copy">
                <strong title={item.title}>{item.title}</strong>
                {!compact && item.description && <span className="ls-calendar-event-summary">{item.description}</span>}
              </div>
            </div>;
          }
          const showMedia = info.view.type !== 'dayGridMonth' && info.view.type !== 'multiMonthYear';
          return <div className="ls-calendar-event-content">
            {showMedia && (item.identity ? <CalendarIdentityMark identity={item.identity}/> : <CalendarThumbnail src={item.thumbnailUrl} title={item.title}/>)}
            <div className="ls-calendar-event-copy"><div className="ls-calendar-event-meta">{item.platform && item.identity?.kind !== 'platform' && <SocialPlatformIcon platform={item.platform} size={13}/>}<span>{item.accountName || item.ownerAgent || info.timeText}</span></div><strong>{item.title}</strong>{(item.eventType !== 'publish' || item.status !== 'planned') && <span>{info.timeText && `${info.timeText} · `}{item.statusLabel || calendarStatusLabels[item.status]}</span>}</div>
          </div>;
        }}
        eventClick={info => {
          info.jsEvent.preventDefault();
          const item = info.event.extendedProps.item as LsCalendarEvent;
          if (calendarEventClickConsumed(item, onEventClick)) {
            setSelectedId(null);
            return;
          }
          setSelectedId(info.event.id);
        }}
        eventDidMount={info => {
          const item = info.event.extendedProps.item as LsCalendarEvent;
          const element = info.el as HTMLElement;
          if (info.event.extendedProps.isVerticalTimedCard && !info.event.allDay) {
            const harness = element.closest<HTMLElement>('.fc-timegrid-event-harness');
            if (harness) {
              harness.classList.add('ls-calendar-time-vertical-flow');
              // FullCalendar writes physical `left`/`right` values inline when
              // it detects simultaneous events. Logical inset CSS alone does
              // not reliably win that positioning calculation, which leaves
              // the cards split into narrow columns. Reset the physical
              // coordinates on the harness itself so every card owns the full
              // day column. The event input already uses presentation-only
              // non-overlapping instants, while `item` keeps the real time.
              harness.style.setProperty('left', '2px', 'important');
              harness.style.setProperty('right', '2px', 'important');
              harness.style.setProperty('width', 'auto', 'important');
            }
          }
          element.dataset.calendarRevealId = info.event.id;
          const accessibleTime = item.cardLines?.[2] || info.timeText || (item.allDay ? '全天，具体时刻待定' : '');
          element.setAttribute('aria-label', `${item.title}，${accessibleTime}，${item.accountName || item.ownerAgent || ''}，${item.statusLabel || calendarStatusLabels[item.status]}，查看详情`);
          mountedEventElementsRef.current.add(element);
          if (reducedMotion || info.isMirror || revealedEventIdsRef.current.has(info.event.id) || typeof IntersectionObserver === 'undefined') {
            revealEventElement(element);
            return;
          }
          if (!revealObserverRef.current) {
            revealObserverRef.current = new IntersectionObserver(entries => {
              entries.forEach(entry => {
                if (entry.isIntersecting) revealEventElement(entry.target as HTMLElement);
              });
            }, { threshold: 0.08 });
          }
          revealObserverRef.current.observe(element);
        }}
        eventWillUnmount={info => {
          const element = info.el as HTMLElement;
          revealObserverRef.current?.unobserve(element);
          mountedEventElementsRef.current.delete(element);
        }}
        eventDrop={info => {
          const item = eventsRef.current.find(event => event.id === info.event.id);
          const droppedStart = info.event.start?.toISOString();
          const droppedAllDay = info.event.allDay;
          // Keep the authoritative event in place until confirmation and the server response.
          info.revert();
          if (item && droppedStart) {
            const save = async () => move(item, calendarMovedInstant(item, droppedStart, droppedAllDay));
            void save().catch(error => { void message.error(error instanceof Error ? error.message : '调整失败，原排期已保留'); });
          }
        }}/>
      </div>
    </div>
    <Drawer title={detailsTitle} open={Boolean(selected)} onClose={() => {onDetailsClose?.();setSelectedId(null);}} size={520} destroyOnHidden>
      {selected && <div className="space-y-5">
        {detailsLayout === 'standard' && <><div className={detailsMedia === 'compact' ? 'flex items-start gap-4' : 'space-y-4'}>
          {['content', 'publish', 'shooting'].includes(selected.eventType) && <CalendarThumbnail src={selected.thumbnailUrl} title={selected.title} large={detailsMedia === 'large'} compact={detailsMedia === 'compact'}/>}
          <div className="min-w-0"><Tag>{selected.statusLabel || calendarStatusLabels[selected.status]}</Tag><h3 className="mt-3 ls-type-title-medium text-text-primary">{selected.title}</h3>{selected.description && <p className="mt-2 ls-type-body-medium text-text-secondary">{selected.description}</p>}</div>
        </div>
        <dl className="ls-calendar-details">
          <div><dt>交付时间</dt><dd>{selected.allDay ? selected.start.slice(0, 10) : new Date(selected.start).toLocaleString('zh-CN', { timeZone: selected.timeZone })} · {selected.timeZone}</dd></div>
          {selected.platform && <div><dt>平台账号</dt><dd className="flex items-center gap-2"><SocialPlatformIcon platform={selected.platform} size={16}/>{socialBrandLabel(selected.platform)} · {selected.accountName || '待绑定账号'}</dd></div>}
          {selected.ownerAgent && <div><dt>责任 Agent</dt><dd>{selected.ownerAgent}</dd></div>}
          {selected.costEstimate !== undefined && <div><dt>预计成本</dt><dd>¥{selected.costEstimate.toFixed(2)}</dd></div>}
        </dl></>}
        {renderDetails?.(selected, () => setSelectedId(null))}
        {selected.editable && onMoveEvent && <div className="space-y-3 border-t border-border pt-4"><label className="block text-sm text-text-secondary" htmlFor={moveInputId}>移动到日期 / 时间（{selected.timeZone}）</label><Input id={moveInputId} type="datetime-local" value={moveValue} onChange={event => setMoveValue(event.target.value)}/><Button loading={moving} onClick={async () => { setMoving(true); try { await move(selected, calendarInstant(moveValue, selected.timeZone).toISOString()); void message.success('排期已更新'); } catch (error) { void message.error(error instanceof Error ? error.message : '排期更新失败'); } finally { setMoving(false); } }}>确认移动</Button><Alert type="info" title="跨日调整需要再次确认；已锁定或发布中的内容不可移动。"/></div>}
      </div>}
    </Drawer>
  </div>;
}
