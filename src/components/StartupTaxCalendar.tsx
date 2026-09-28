import { useMemo } from 'react';
import { CalendarDays, Check, CheckCircle2, CircleAlert, Clock3, ExternalLink } from 'lucide-react';
import type { StartupHubSnapshot, StartupTaxRecord } from '../../shared/startupHub';
import type { StartupHubActions } from '../lib/startupHubUi';

interface Props {
  snapshot: StartupHubSnapshot;
  actions: StartupHubActions;
  saving: boolean;
}

const TAX_STATUS: Record<StartupTaxRecord['status'], string> = {
  draft: '待准备',
  preparing: '资料准备中',
  ready: '待申报',
  filed: '已申报',
  paid: '已完成',
};

function dayDistance(value: string) {
  const deadline = new Date(`${value}T23:59:59`).getTime();
  return Math.ceil((deadline - Date.now()) / 86_400_000);
}

function deadlineState(value: string, complete: boolean) {
  if (complete) return { label: '本组已完成', className: 'bg-[#e8f2eb] text-accent' };
  const days = dayDistance(value);
  if (days < 0) return { label: `已逾期 ${Math.abs(days)} 天`, className: 'bg-red-50 text-red-700' };
  if (days === 0) return { label: '今天截止', className: 'bg-red-50 text-red-700' };
  if (days <= 7) return { label: `${days} 天后截止`, className: 'bg-[#fff4e8] text-[#a6572a]' };
  return { label: `${days} 天后截止`, className: 'bg-[#f2f3f1] text-text-muted' };
}

function formattedDeadline(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${value}T12:00:00`));
}

function dateParts(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export default function StartupTaxCalendar({ snapshot, actions, saving }: Props) {
  const deadlineGroups = useMemo(() => {
    const groups = new Map<string, StartupTaxRecord[]>();
    for (const record of snapshot.taxRecords) {
      if (!record.dueDate) continue;
      const current = groups.get(record.dueDate) || [];
      current.push(record);
      groups.set(record.dueDate, current);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, records]) => ({
        date,
        records: records.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')),
      }));
  }, [snapshot.taxRecords]);

  const pendingGroups = deadlineGroups.filter(group => group.records.some(record => !['filed', 'paid'].includes(record.status)));
  const nextGroup = pendingGroups.find(group => dayDistance(group.date) >= 0) || pendingGroups[0];
  const setupTasks = snapshot.tasks
    .filter(task => task.area === '税务助手' && task.status === 'open')
    .sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'));

  return <div>
    <div className="border-b border-border bg-[#fbfcfa] px-5 py-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex items-center gap-2 text-accent"><CalendarDays size={16} /><span className="text-[9px] font-bold tracking-[.18em]">TAX CALENDAR</span></div>
          <h3 className="mt-2 text-xl font-semibold tracking-[-.035em]">税务申报日历</h3>
          <p className="mt-2 max-w-2xl text-[10px] leading-5 text-text-muted">这里直接展示已经根据电子税务局税费种认定整理好的截止日期。你不需要再手动新建报税事项，只需按日期准备、申报，并在完成后更新状态。</p>
        </div>
        {nextGroup && (() => {
          const parts = dateParts(nextGroup.date);
          const remaining = nextGroup.records.filter(record => !['filed', 'paid'].includes(record.status)).length;
          const state = deadlineState(nextGroup.date, remaining === 0);
          return <div className="min-w-[260px] rounded-xl border border-[#f0ddcf] bg-[#fff9f4] p-4">
            <p className="text-[9px] font-semibold text-[#9a6147]">下一申报截止日</p>
            <div className="mt-2 flex items-end gap-2"><strong className="text-3xl leading-none text-[#ff6875]">{parts.month}月{parts.day}日</strong><span className="pb-0.5 text-[10px] text-text-muted">{parts.year}年</span></div>
            <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[10px] text-text-secondary">尚有 {remaining} 项待完成</span><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${state.className}`}>{state.label}</span></div>
          </div>;
        })()}
      </div>
    </div>

    {deadlineGroups.length ? <div className="divide-y divide-border">
      {deadlineGroups.map(group => {
        const parts = dateParts(group.date);
        const complete = group.records.every(record => ['filed', 'paid'].includes(record.status));
        const state = deadlineState(group.date, complete);
        return <section key={group.date} className="grid gap-4 px-5 py-5 lg:grid-cols-[150px_minmax(0,1fr)]">
          <div>
            <div className={`inline-flex min-w-[112px] flex-col border p-3 text-center ${complete ? 'border-[#386b58] bg-[#102a25]' : 'border-[#7b3942] bg-[#2b171e]'}`}>
              <span className="text-[9px] font-semibold text-text-muted">{parts.year} 年 {parts.month} 月</span>
              <strong className={`mt-1 text-4xl leading-none ${complete ? 'text-[#62d6ad]' : 'text-[#ff6875]'}`}>{parts.day}</strong>
              <span className="mt-2 text-[9px] text-text-secondary">申报截止</span>
            </div>
            <p className="mt-2 text-[9px] text-text-muted">{formattedDeadline(group.date)}</p>
            <span className={`mt-2 inline-block rounded-full px-2 py-1 text-[8px] font-semibold ${state.className}`}>{state.label}</span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-[#fbfcfa]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><p className="text-[11px] font-semibold">{group.records.length} 项税费需要在此日期前完成</p><p className="mt-1 text-[9px] text-text-muted">所属期与税种已按公司当前税费种认定整理</p></div>
              {complete ? <CheckCircle2 size={17} className="text-accent" /> : <Clock3 size={17} className="text-[#d27a38]" />}
            </div>
            <div className="divide-y divide-border">
              {group.records.map(record => <div key={record.id} className="px-4 py-3.5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-semibold">{record.title}</p><span className="rounded-full bg-[#f0f2ef] px-2 py-0.5 text-[8px] text-text-muted">{record.period}</span></div>
                    <p className="mt-1 text-[9px] text-text-muted">必须在 {formattedDeadline(group.date)} 前完成申报</p>
                  </div>
                  <select value={record.status} onChange={event => void actions.update('taxRecords', record.id, { status: event.target.value as StartupTaxRecord['status'] })} disabled={saving} className="rounded-lg border border-border bg-white px-2 py-1.5 text-[9px] font-semibold">
                    {Object.entries(TAX_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {record.notes && <details className="mt-2"><summary className="cursor-pointer text-[9px] font-semibold text-accent">查看准备说明</summary><p className="mt-2 rounded-lg bg-white px-3 py-2 text-[9px] leading-5 text-text-muted">{record.notes}</p></details>}
              </div>)}
            </div>
          </div>
        </section>;
      })}
    </div> : <div className="grid min-h-[320px] place-items-center px-6 text-center"><div><CircleAlert size={28} className="mx-auto text-text-muted" /><p className="mt-3 text-xs font-semibold">暂时没有可显示的申报日期</p><p className="mt-1 text-[10px] text-text-muted">需要先根据电子税务局的税费种认定建立公司税务日历。</p></div></div>}

    {setupTasks.length > 0 && <div className="border-t border-border bg-[#fbfcfa] p-5">
      <div className="mb-3"><h4 className="text-[11px] font-semibold">首次办税与账户准备</h4><p className="mt-1 text-[9px] text-text-muted">这些事项属于公司与税务准备，不会进入协作中心。</p></div>
      <div className="grid gap-2 md:grid-cols-2">{setupTasks.map(task => <div key={task.id} className="flex items-start gap-3 rounded-xl border border-border bg-white p-3">
        <button type="button" onClick={() => void actions.update('tasks', task.id, { status: 'completed' })} disabled={saving} className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-border-bright text-transparent hover:border-accent hover:text-accent disabled:opacity-45"><Check size={12} /></button>
        <div><p className="text-[10px] font-semibold">{task.title}</p><p className="mt-1 text-[9px] text-text-muted">{task.dueDate ? `截止 ${task.dueDate}` : '未设截止日期'}</p></div>
      </div>)}</div>
    </div>}

    <div className="grid gap-3 border-t border-border p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex gap-2 text-[9px] leading-5 text-text-muted"><CircleAlert size={13} className="mt-1 shrink-0 text-[#d27a38]" /><span>日历依据当前电子税务局税费种信息和官方征期整理；税务机关后续调整、企业资格变化或新增税种时，需要同步更新。</span></div>
      <div className="flex flex-wrap gap-2">
        <a href="https://etax.zhejiang.chinatax.gov.cn/" target="_blank" rel="noreferrer" className="btn-primary flex items-center gap-1.5 px-3 py-2 text-[9px]">进入浙江电子税务局<ExternalLink size={10} /></a>
        <a href="https://zhejiang.chinatax.gov.cn/" target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[9px]">查看浙江税务通知<ExternalLink size={10} /></a>
      </div>
    </div>
  </div>;
}
