import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Drawer, Input, Segmented, Spin, Tag } from 'antd';
import { ChevronLeft, ChevronRight, ImageOff, RefreshCw } from 'lucide-react';
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
import { calendarDateTimeValue, calendarDayKey, calendarInstant, calendarMovedInstant, calendarStatusLabels, type LsCalendarEvent } from '../../lib/calendarModel';
import { SocialPlatformIcon, socialBrandLabel } from '../SocialPlatformIcon';
import './calendar.css';

export { calendarDayKey, type LsCalendarEvent } from '../../lib/calendarModel';
export type LsCalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek' | 'multiMonthYear';
type Props = {
  events: LsCalendarEvent[];
  label: string;
  initialDate?: string;
  initialView?: LsCalendarView;
  date?: string;
  timeZone?: string;
  loading?: boolean;
  primaryAction?: ReactNode;
  filters?: ReactNode;
  onRefresh?: () => void;
  onDatesSet?: (info: DatesSetInfo) => void;
  onDateClick?: (date: string, allDay: boolean) => void;
  onExternalDrop?: (pendingId: string, day: string) => void;
  onMoveEvent?: (event: LsCalendarEvent, start: string) => Promise<void>;
  renderDetails?: (event: LsCalendarEvent, closeDetails: () => void) => ReactNode;
};

function CalendarThumbnail({ src, title, large = false }: { src?: string; title: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <div className={large ? 'ls-calendar-media' : 'ls-calendar-thumb'}>
    {src && !failed ? <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)}/> : <span><ImageOff size={large ? 24 : 16}/>{large && <span>{failed ? '媒体加载失败' : '暂无缩略图'}</span>}</span>}
    {large && failed && <Button size="small" onClick={() => setFailed(false)}>重新加载</Button>}
  </div>;
}

/** Standard plugins only: all calendar pages share the same events, timezone and accessible detail path. */
export function LsCalendar({ events, label, initialDate, initialView = 'dayGridMonth', date, timeZone = 'Asia/Shanghai', loading, primaryAction, filters, onRefresh, onDatesSet, onDateClick, onExternalDrop, onMoveEvent, renderDetails }: Props) {
  const calendarRef = useRef<CalendarRef>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const { modal, message } = App.useApp();
  const [view, setView] = useState<LsCalendarView>(() => typeof window !== 'undefined' && window.innerWidth < 640 ? 'listWeek' : initialView);
  const [title, setTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find(event => event.id === selectedId);
  const [moveValue, setMoveValue] = useState('');
  const moveInputId = useId();
  const [moving, setMoving] = useState(false);
  const previousWidth = useRef<boolean | undefined>(undefined);
  const moveRef = useRef(onMoveEvent);
  moveRef.current = onMoveEvent;

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
        calendarRef.current?.getApi().changeView('listWeek');
        setView('listWeek');
      }
      previousWidth.current = narrow;
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);
  const inputs = useMemo<EventInput[]>(() => events.map(event => ({
    id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay,
    startEditable: Boolean(event.editable && onMoveEvent), durationEditable: false,
    interactive: true, extendedProps: { item: event },
  })), [events, Boolean(onMoveEvent)]);

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
  return <div className="ls-calendar" ref={hostRef} aria-label={label}>
    <div className="ls-calendar-toolbar">
      {primaryAction}
      <Button onClick={() => calendarRef.current?.getApi().today()}>今天</Button>
      <div className="ls-calendar-navigation"><Button aria-label="上一周期" icon={<ChevronLeft size={16}/>} onClick={() => calendarRef.current?.getApi().prev()}/><Button aria-label="下一周期" icon={<ChevronRight size={16}/>} onClick={() => calendarRef.current?.getApi().next()}/></div>
      <h3 aria-live="polite">{title}</h3>
      <Segmented aria-label="日历视图" value={view} options={[{ label: '月', value: 'dayGridMonth' }, { label: '周', value: 'timeGridWeek' }, { label: '日', value: 'timeGridDay' }, { label: '列表', value: 'listWeek' }, { label: '全年', value: 'multiMonthYear' }]} onChange={value => { setView(value as LsCalendarView); calendarRef.current?.getApi().changeView(value); }}/>
      {filters}
      {onRefresh && <Button aria-label="刷新日历" icon={<RefreshCw size={15}/>} onClick={onRefresh} loading={loading}/>}
    </div>
    <div className="ls-calendar-meta"><span>{timeZone === 'Asia/Shanghai' ? '北京时间 · Asia/Shanghai' : `时区：${timeZone}`}</span><span role="status">{loading ? <><Spin size="small"/> 正在同步，保留当前排期</> : `已加载 ${events.length} 项排期`}</span></div>
    <div className="ls-calendar-surface" onDragOver={event => { if (onExternalDrop && event.dataTransfer.types.includes('application/x-lingshu-pending-content')) event.preventDefault(); }} onDrop={event => {
      if (!onExternalDrop) return;
      const pendingId = event.dataTransfer.getData('application/x-lingshu-pending-content');
      const day = (event.target as HTMLElement).closest<HTMLElement>('[data-calendar-date]')?.dataset.calendarDate;
      if (pendingId && day) { event.preventDefault(); onExternalDrop(pendingId, day); }
    }}>
      <FullCalendar ref={calendarRef} plugins={[themePlugin, dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]} locale={zhLocale} timeZone={timeZone} firstDay={1} initialView={view} initialDate={initialDate || undefined}
        // In v7 either height="auto" or contentHeight="auto" disables the internal
        // time scroller. Bound only time views; month/list/year remain content-sized.
        headerToolbar={false} contentHeight={view.startsWith('timeGrid') ? 'clamp(320px, 65dvh, 720px)' : 'auto'} events={inputs} editable={Boolean(onMoveEvent)} eventDurationEditable={false} eventInteractive dayMaxEvents={3} nowIndicator
        allDayText="当天事项" noEventsText="当前周期没有排期" slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime="08:00:00" scrollTimeReset eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        eventMinHeight={24} eventShortHeight={68} columnEventInnerClass="ls-calendar-time-inner"
        datesSet={info => { setTitle(info.view.title); setView(info.view.type as LsCalendarView); onDatesSet?.(info); }}
        dateClick={info => onDateClick?.(info.dateStr, info.allDay)}
        dayCellClass={info => [info.isToday ? 'ls-calendar-today' : '', [0, 6].includes(info.dow) ? 'ls-calendar-weekend' : ''].join(' ')}
        dayCellDidMount={info => { info.el.dataset.calendarDate = calendarDayKey(info.date, timeZone); }}
        dayLaneDidMount={info => { info.el.dataset.calendarDate = calendarDayKey(info.date, timeZone); }}
        eventClass={info => `ls-calendar-event ls-calendar-event-${(info.event.extendedProps.item as LsCalendarEvent).status}`}
        eventContent={info => {
          const item = info.event.extendedProps.item as LsCalendarEvent;
          if (info.view.type.startsWith('timeGrid') && info.event.allDay) {
            return <div className="ls-calendar-event-content ls-calendar-event-content-all-day">
              <CalendarThumbnail src={item.thumbnailUrl} title={item.title}/>
              <div className="ls-calendar-event-copy"><div className="ls-calendar-event-meta">{item.platform && <SocialPlatformIcon platform={item.platform} size={13}/>}<span>{item.accountName || item.ownerAgent || '待绑定账号'}</span></div><strong>{item.title}</strong></div>
            </div>;
          }
          if (info.view.type.startsWith('timeGrid') && !info.event.allDay) {
            // v7 measures each rendered segment before setting isShort, including
            // clipped multi-day events. Only sufficiently tall slots get media.
            return <div className={`ls-calendar-event-content ls-calendar-event-content-timed${info.isShort ? ' is-short' : ''}`}>
              <CalendarThumbnail src={item.thumbnailUrl} title={item.title}/>
              <div className="ls-calendar-event-copy">
                {!info.isShort && <div className="ls-calendar-event-meta">{item.platform && <SocialPlatformIcon platform={item.platform} size={13}/>}<span>{item.accountName || item.ownerAgent || '待绑定账号'}</span></div>}
                <strong>{item.title}</strong><span className="ls-calendar-event-time">{info.timeText}</span>
              </div>
            </div>;
          }
          const showMedia = info.view.type !== 'dayGridMonth' && info.view.type !== 'multiMonthYear';
          return <div className="ls-calendar-event-content">
            {showMedia && <CalendarThumbnail src={item.thumbnailUrl} title={item.title}/>}
            <div className="ls-calendar-event-copy"><div className="ls-calendar-event-meta">{item.platform && <SocialPlatformIcon platform={item.platform} size={13}/>}<span>{item.accountName || item.ownerAgent || info.timeText}</span></div><strong>{item.title}</strong><span>{info.timeText && `${info.timeText} · `}{item.statusLabel || calendarStatusLabels[item.status]}</span></div>
          </div>;
        }}
        eventClick={info => { info.jsEvent.preventDefault(); setSelectedId(info.event.id); }}
        eventDidMount={info => { const item = info.event.extendedProps.item as LsCalendarEvent; info.el.setAttribute('aria-label', `${item.title}，${info.timeText}，${item.accountName || item.ownerAgent || ''}，${item.statusLabel || calendarStatusLabels[item.status]}，查看详情`); }}
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
    <Drawer title="排期详情" open={Boolean(selected)} onClose={() => setSelectedId(null)} size={520} destroyOnHidden>
      {selected && <div className="space-y-5">
        {['content', 'publish', 'shooting'].includes(selected.eventType) && <CalendarThumbnail src={selected.thumbnailUrl} title={selected.title} large/>}
        <div><Tag>{selected.statusLabel || calendarStatusLabels[selected.status]}</Tag><h3 className="mt-3 text-lg font-semibold text-text-primary">{selected.title}</h3>{selected.description && <p className="mt-2 text-sm text-text-secondary">{selected.description}</p>}</div>
        <dl className="ls-calendar-details">
          <div><dt>交付时间</dt><dd>{selected.allDay ? selected.start.slice(0, 10) : new Date(selected.start).toLocaleString('zh-CN', { timeZone: selected.timeZone })} · {selected.timeZone}</dd></div>
          {selected.platform && <div><dt>平台账号</dt><dd className="flex items-center gap-2"><SocialPlatformIcon platform={selected.platform} size={16}/>{socialBrandLabel(selected.platform)} · {selected.accountName || '待绑定账号'}</dd></div>}
          {selected.ownerAgent && <div><dt>责任 Agent</dt><dd>{selected.ownerAgent}</dd></div>}
          {selected.costEstimate !== undefined && <div><dt>预计成本</dt><dd>¥{selected.costEstimate.toFixed(2)}</dd></div>}
        </dl>
        {renderDetails?.(selected, () => setSelectedId(null))}
        {selected.editable && onMoveEvent && <div className="space-y-3 border-t border-border pt-4"><label className="block text-sm text-text-secondary" htmlFor={moveInputId}>移动到日期 / 时间（{selected.timeZone}）</label><Input id={moveInputId} type="datetime-local" value={moveValue} onChange={event => setMoveValue(event.target.value)}/><Button loading={moving} onClick={async () => { setMoving(true); try { await move(selected, calendarInstant(moveValue, selected.timeZone).toISOString()); void message.success('排期已更新'); } catch (error) { void message.error(error instanceof Error ? error.message : '排期更新失败'); } finally { setMoving(false); } }}>确认移动</Button><Alert type="info" title="跨日调整需要再次确认；已锁定或发布中的内容不可移动。"/></div>}
      </div>}
    </Drawer>
  </div>;
}
