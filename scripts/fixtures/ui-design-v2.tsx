// Browser-only acceptance fixture. Not imported by the application or production build.
import React from 'react';
import { createRoot } from 'react-dom/client';
import LingshuProvider from '../../src/components/ui/LingshuProvider';
import LsPageHeader from '../../src/components/ui/LsPageHeader';
import { LsCalendar } from '../../src/components/ui/LsCalendar';
import LsDataChart from '../../src/components/ui/LsDataChart';
import AccountSettingsModal from '../../src/components/AccountSettingsModal';
import type { LsCalendarEvent } from '../../src/lib/calendarModel';
import '../../src/index.css';
import '../../src/styles/design-system.css';

function Harness() {
  const [open, setOpen] = React.useState(false);
  const [events, setEvents] = React.useState<LsCalendarEvent[]>([{ id: 'qa-video', title: '新品生产流程｜质量追踪与交付', start: '2026-10-09T09:00:00+08:00', end: '2026-10-09T10:00:00+08:00', status: 'queued', eventType: 'content', timeZone: 'Asia/Shanghai', editable: true, platform: 'tiktok', accountName: '设计验收账号', ownerAgent: '内容 Agent' }]);
  return <LingshuProvider><main className="ls-screen">
    <LsPageHeader title="数字员工工作排期" description="隔离 UI 验收数据，不连接任何真实账号。" extra={<button className="btn-ghost" onClick={() => setOpen(true)}>账号设置</button>} />
    <section className="ls-section !p-0"><LsCalendar label="工作排期" events={events} initialDate="2026-10-09" initialView="timeGridWeek" onMoveEvent={async (event, start) => setEvents(items => items.map(item => item.id === event.id ? { ...item, start } : item))} /></section>
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <LsDataChart title="账号发布数量" kind="bar" labels={['TikTok', 'YouTube', 'Instagram', 'Facebook']} series={[{ label: '发布版本', values: [5, 4, 5, 4] }]} unit=" 条" demo />
      <LsDataChart title="发布表现趋势" kind="line" labels={['周一', '周二', '周三', '周四', '周五']} series={[{ label: '播放量', values: [20, 35, null, 42, 60] }, { label: '互动数', values: [5, 7, null, 10, 15] }]} demo />
    </div>
    <AccountSettingsModal open={open} onClose={() => setOpen(false)} canManageEmployees />
  </main></LingshuProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
