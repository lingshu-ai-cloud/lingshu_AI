import { useMemo } from 'react';
import { Alert, Button, Select } from 'antd';
import { Check, ExternalLink } from 'lucide-react';
import type { StartupHubSnapshot, StartupTaxRecord } from '../../shared/startupHub';
import type { StartupHubActions } from '../lib/startupHubUi';
import { LsCalendar, calendarDayKey, type LsCalendarEvent } from './ui/LsCalendar';

interface Props { snapshot: StartupHubSnapshot; actions: StartupHubActions; saving: boolean }
type DatedTaxRecord = StartupTaxRecord & { dueDate: string };
const TAX_STATUS: Record<StartupTaxRecord['status'], string> = { draft: '待准备', preparing: '资料准备中', ready: '待申报', filed: '已申报', paid: '已完成' };
function dayDistance(value: string) { return Math.ceil((new Date(`${value}T23:59:59+08:00`).getTime() - Date.now()) / 86_400_000); }
function formattedDeadline(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T12:00:00+08:00`)); }

export default function StartupTaxCalendar({ snapshot, actions, saving }: Props) {
  const records = useMemo(() => snapshot.taxRecords.filter((record): record is DatedTaxRecord => typeof record.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) && Number.isFinite(Date.parse(record.dueDate))).sort((left, right) => left.dueDate.localeCompare(right.dueDate)), [snapshot.taxRecords]);
  const pending = records.filter(record => !['filed', 'paid'].includes(record.status));
  const next = pending.find(record => dayDistance(record.dueDate) >= 0) || pending[0];
  const setupTasks = snapshot.tasks.filter(task => task.area === '税务助手' && task.status === 'open').sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'));
  const events: LsCalendarEvent[] = records.map(record => {
    const complete = ['filed', 'paid'].includes(record.status);
    const days = dayDistance(record.dueDate);
    return {
      id: record.id, title: record.title, start: record.dueDate, allDay: true, timeZone: 'Asia/Shanghai',
      eventType: 'follow_up', status: complete ? 'done' : days < 0 ? 'failed' : days <= 7 ? 'needs_action' : record.status === 'preparing' ? 'working' : 'planned',
      statusLabel: `${TAX_STATUS[record.status]}${!complete && days < 0 ? ' · 已逾期' : ''}`,
      description: `所属期：${record.period}`, sourceId: record.id, data: record,
    };
  });
  return <div>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2 p-5">
      <div><h3 className="text-xl font-semibold text-text-primary">税务申报日历</h3><p className="mt-2 max-w-2xl text-sm text-text-secondary">按税费种认定的截止日期准备资料与申报；点击事项更新状态、查看准备说明。</p></div>
      {next && <div className="border-l border-border pl-4"><p className="text-xs text-text-secondary">下一待完成申报</p><p className="mt-1 text-lg font-semibold text-text-primary">{next.dueDate}</p><p className="mt-1 text-xs text-text-secondary">{pending.length} 项待完成{dayDistance(next.dueDate) < 0 ? ' · 含逾期事项' : ''}</p></div>}
    </header>
    <LsCalendar label="税务申报日历" events={events} initialDate={next?.dueDate || records[0]?.dueDate || calendarDayKey(new Date())} initialView="dayGridMonth" loading={saving} renderDetails={event => {
      const record = event.data as DatedTaxRecord;
      return <div className="space-y-4">
        <dl className="ls-calendar-details"><div><dt>所属期</dt><dd>{record.period}</dd></div><div><dt>申报截止</dt><dd>{formattedDeadline(record.dueDate)}</dd></div><div><dt>准备说明</dt><dd className="whitespace-pre-wrap">{record.notes || '暂无补充说明'}</dd></div></dl>
        <label className="block text-sm text-text-secondary">申报状态<Select className="mt-2 w-full" aria-label={`${record.title}的申报状态`} value={record.status} onChange={value => void actions.update('taxRecords', record.id, { status: value })} disabled={saving} options={Object.entries(TAX_STATUS).map(([value, label]) => ({ value: value as StartupTaxRecord['status'], label }))}/></label>
      </div>;
    }}/>
    {!records.length && <div className="px-5 pb-5"><Alert showIcon type="info" title="暂时没有可显示的申报日期" description="请先根据电子税务局的税费种认定建立公司税务日历。"/></div>}
    {setupTasks.length > 0 && <section className="border-t border-border bg-surface-2 p-5">
      <h4 className="text-base font-semibold text-text-primary">首次办税与账户准备</h4><p className="mt-1 text-xs text-text-secondary">这些事项属于公司与税务准备，不会进入协作中心。</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{setupTasks.map(task => <div key={task.id} className="flex items-start gap-3 rounded-lg border border-border bg-white p-3">
        <Button aria-label={`完成：${task.title}`} size="small" icon={<Check size={14}/>} onClick={() => void actions.update('tasks', task.id, { status: 'completed' })} disabled={saving}/>
        <div><p className="text-sm font-medium text-text-primary">{task.title}</p><p className="mt-1 text-xs text-text-secondary">{task.dueDate ? `截止 ${task.dueDate}` : '未设截止日期'}</p></div>
      </div>)}</div>
    </section>}
    <footer className="space-y-3 border-t border-border p-5">
      <p className="text-xs leading-5 text-text-secondary">日历依据当前电子税务局税费种信息和官方征期整理；税务机关调整、企业资格变化或新增税种时，需要同步更新。</p>
      <div className="flex flex-wrap gap-2"><Button type="primary" href="https://etax.zhejiang.chinatax.gov.cn/" target="_blank" rel="noreferrer" icon={<ExternalLink size={14}/>}>进入浙江电子税务局</Button><Button href="https://zhejiang.chinatax.gov.cn/" target="_blank" rel="noreferrer" icon={<ExternalLink size={14}/>}>查看浙江税务通知</Button></div>
    </footer>
  </div>;
}
