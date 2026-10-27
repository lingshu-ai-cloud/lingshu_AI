import { Alert, Button, Skeleton } from 'antd';
import { CalendarRange, ChevronRight } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { authHeader } from '../../lib/auth';
import { digitalEmployeeApi, type DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import type { Page } from '../../pageRegistry';
import './assistantWorkBookmark.css';

const ConnectedAgentCalendar = lazy(() => import('../smartBusiness/ConnectedAgentCalendar'));
const DigitalEmployeeHomeWork = lazy(() => import('../DigitalEmployeeHomeWork'));

export function AssistantWorkSchedule({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, refresh);
  }, []);
  useEffect(() => {
    let active = true;
    const identity = authHeader().Authorization;
    setLoading(true);
    setError('');
    void digitalEmployeeApi.overview().then(result => {
      if (active && identity === authHeader().Authorization) setOverview(result);
    }).catch(cause => {
      if (active && identity === authHeader().Authorization) setError(cause instanceof Error ? cause.message : '工作数据读取失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <div className="assistant-work-content">
    <section aria-label="Agent 日历排期" className="assistant-work-calendar">
      <header className="assistant-work-section-title"><CalendarRange size={18}/><h3>Agent 日历排期</h3></header>
      <Suspense fallback={<Skeleton active paragraph={{ rows: 6 }}/> }><ConnectedAgentCalendar/></Suspense>
    </section>
    <section aria-label="数字员工正在推进的工作" className="assistant-work-records">
      <header className="assistant-work-section-title"><h3>数字员工正在推进的工作</h3></header>
      {error && <Alert type="warning" showIcon title="工作数据暂不可用" description={error} action={<Button size="small" onClick={() => setRevision(value => value + 1)}>重试</Button>}/>}
      {loading ? <Skeleton active paragraph={{ rows: 3 }}/> : <Suspense fallback={<Skeleton active/>}><DigitalEmployeeHomeWork data={overview} onNavigate={onNavigate}/></Suspense>}
    </section>
  </div>;
}

/** The bookmark expands its owning conversation; it does not open a second dialog. */
export default function AssistantWorkBookmark({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return <button type="button" className="assistant-work-bookmark" aria-label={expanded ? '收起本周智能体任务' : '打开本周智能体任务'} aria-expanded={expanded} aria-controls="assistant-work-schedule" onClick={onToggle}>
    <CalendarRange size={17} aria-hidden="true"/>
    <span>本周智能体任务</span>
    <ChevronRight size={14} aria-hidden="true"/>
  </button>;
}
