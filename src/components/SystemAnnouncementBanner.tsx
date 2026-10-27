import { Alert } from 'antd';
import { CalendarClock, Megaphone } from 'lucide-react';
import type { SystemAnnouncement } from '../../shared/systemAnnouncement';

function displayMaintenanceWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const zoneFormatter = new Intl.DateTimeFormat('zh-CN', { timeZoneName: 'short' });
  const startDate = dateFormatter.format(start);
  const endDate = dateFormatter.format(end);
  const zone = zoneFormatter.formatToParts(start).find(part => part.type === 'timeZoneName')?.value;
  const endLabel = startDate === endDate ? timeFormatter.format(end) : `${endDate} ${timeFormatter.format(end)}`;
  return `${startDate} ${timeFormatter.format(start)}–${endLabel}${zone ? ` · ${zone}` : ''}`;
}

export default function SystemAnnouncementBanner({ announcement }: { announcement: SystemAnnouncement }) {
  const maintenanceWindow = displayMaintenanceWindow(announcement.maintenanceStartsAt, announcement.maintenanceEndsAt);
  return (
    <div data-testid="system-announcement-shell" className="relative z-10 shrink-0 px-3 pt-3 sm:px-6 sm:pt-4">
      <Alert
        showIcon
        role="status"
        aria-label="系统公告"
        icon={<span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-700"><Megaphone size={18} aria-hidden="true" /></span>}
        type="warning"
        title={<div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
            <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold tracking-wide text-amber-700">服务公告</span>
            <strong className="min-w-0 flex-1 text-sm font-semibold text-text-primary sm:truncate">{announcement.title}</strong>
          </div>
          <p className="min-w-0 flex-1 text-xs font-normal leading-5 text-text-secondary sm:border-l sm:border-border sm:pl-3">{announcement.message}</p>
          <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[11px] font-semibold leading-4 text-amber-800 sm:shrink-0 sm:whitespace-nowrap">
            <CalendarClock size={13} className="shrink-0" aria-hidden="true" />
            <span className="break-words">{maintenanceWindow}</span>
          </span>
        </div>}
        className="mx-auto max-w-[1440px] !items-start !overflow-hidden !rounded-[22px] !border !border-border !bg-surface !px-3 !py-3 shadow-[0_12px_36px_rgba(15,23,42,0.08)] sm:!items-center sm:!px-4 [&_.ant-alert-content]:!min-w-0 [&_.ant-alert-content]:!flex-1 [&_.ant-alert-icon]:!hidden sm:[&_.ant-alert-icon]:!mr-3 sm:[&_.ant-alert-icon]:!mt-0 sm:[&_.ant-alert-icon]:!flex"
      />
    </div>
  );
}
