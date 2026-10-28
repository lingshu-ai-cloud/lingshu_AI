import { useEffect, useRef, useState } from 'react';
import type { AssistantWork } from '../../../shared/contracts/assistantWork';

/** Generic thinking updates do not claim an unreported backend step. */
export function startWaitingProgress(add: () => void, schedule = setInterval, cancel = clearInterval) {
  const timer = schedule(add, 2000);
  return () => cancel(timer);
}

/** Public task activity only. A timer never invents another backend phase. */
export function thinkingActivity(events: AssistantWork[], update = 0): string {
  const active = events.filter(event => event.status === 'running').at(-1);
  if (!active) return '思考中';
  const activity = `${active.detail} ${active.label}`;
  const choices = active.id === 'sources' ? ['联网调查中', '检索公开资料中', '核对公开来源中']
    : /核验|引用|校验/u.test(activity) ? ['核验资料依据中', '核对引用中', '继续核验中']
    : /计算|同比|复算/u.test(activity) ? ['核对数据中', '计算与比对中', '继续核对数据中']
    : /检索|联网|搜索/u.test(activity) ? ['联网调查中', '检索公开资料中', '继续检索中']
    : /读取|提取|抽取/u.test(activity) ? ['读取资料中', '整理资料中', '继续读取资料中']
    : /分析|结论|报告|整理/u.test(activity) ? ['分析资料中', '梳理关键变化中', '整理分析中']
    : ['思考中'];
  return choices[update % choices.length];
}

export function AssistantWaitingProgress({ events = [] }: { events?: AssistantWork[] }) {
  const [entries, setEntries] = useState<Array<{ id: number; text: string }>>([]);
  const currentEvents = useRef(events);
  currentEvents.current = events;
  const updates = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    return startWaitingProgress(() => {
      const id = ++updates.current;
      const text = thinkingActivity(currentEvents.current, id - 1);
      setEntries(value => [...value, { id, text }].slice(-8));
    });
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries, events]);
  return <details open className="min-w-0 text-sm text-text-secondary" aria-label="思考过程">
    <summary className="cursor-pointer">思考过程</summary>
    <ol ref={listRef} role="status" aria-live="polite" className="mt-2 max-h-48 space-y-1 overflow-y-auto border-l border-border pl-3">
      {events.map(event => <li key={event.id}><strong>{event.label}</strong>{event.detail ? `：${event.detail}` : ''}</li>)}
      {!entries.length && <li>{thinkingActivity(events)}<span aria-hidden="true">…</span></li>}
      {entries.map((entry, index) => <li key={`thinking-${entry.id}`}>{entry.text}{index === entries.length - 1 && <span aria-hidden="true">…</span>}</li>)}
    </ol>
  </details>;
}
