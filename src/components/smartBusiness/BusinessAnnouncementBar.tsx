import { Button, Empty, Modal, Tag } from 'antd';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StartupAnnouncement } from '../../../shared/startupHub';
import { createStartupHubApi } from '../../lib/startupHubApi';

const api = createStartupHubApi();
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
};

export default function BusinessAnnouncementBar() {
  const [items, setItems] = useState<StartupAnnouncement[]>([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [allOpen, setAllOpen] = useState(false);
  const [selected, setSelected] = useState<StartupAnnouncement | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus('loading');
    api.snapshot().then(snapshot => {
      if (!active) return;
      setItems([...snapshot.announcements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setIndex(0);
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [revision]);
  const current = items[index];
  return <>
    <section aria-label="公告" className="mb-4 flex min-h-14 min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border bg-white px-5 py-2">
      <h2 className="shrink-0 text-base font-semibold text-text-primary">公告</h2>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="text" size="small" aria-label="上一条公告" disabled={items.length < 2} icon={<ChevronLeft size={16}/>} onClick={() => setIndex(value => (value - 1 + items.length) % items.length)}/>
        <span className="min-w-9 text-center text-sm tabular-nums text-text-secondary">{items.length ? `${index + 1}/${items.length}` : '0/0'}</span>
        <Button type="text" size="small" aria-label="下一条公告" disabled={items.length < 2} icon={<ChevronRight size={16}/>} onClick={() => setIndex(value => (value + 1) % items.length)}/>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 border-l border-border pl-3">
        {current ? <><Tag color="blue">{current.priority === 'urgent' ? '紧急公告' : current.priority === 'important' ? '重要公告' : '团队公告'}</Tag><button type="button" className="min-w-0 truncate text-left text-sm text-text-primary hover:text-accent" onClick={() => setSelected(current)}>{current.title}</button><span className="hidden shrink-0 text-sm text-text-muted sm:block">{dateLabel(current.createdAt)}</span></> : <span className="text-sm text-text-muted">{status === 'loading' ? '正在加载公告…' : status === 'error' ? '公告暂时无法读取' : '暂无公告'}</span>}
        {status === 'error' && <Button type="link" size="small" onClick={() => setRevision(value => value + 1)}>重试</Button>}
      </div>
      <Button type="text" className="shrink-0" onClick={() => setAllOpen(true)}>全部公告 <ChevronRight size={14}/></Button>
    </section>
    <Modal title="全部公告" open={allOpen} footer={null} onCancel={() => setAllOpen(false)}>
      {items.length ? <div className="divide-y divide-border">{items.map(item => <button type="button" key={item.id} className="block w-full py-4 text-left" onClick={() => setSelected(item)}><strong className="block text-sm font-medium text-text-primary">{item.title}</strong><span className="mt-1 block text-xs text-text-muted">{dateLabel(item.createdAt)} · {item.audience}</span></button>)}</div> : <Empty description={status === 'error' ? '公告暂时无法读取' : status === 'loading' ? '正在加载公告…' : '暂无公告'}/>}
    </Modal>
    <Modal title={selected?.title} open={Boolean(selected)} footer={null} onCancel={() => setSelected(null)}>
      {selected && <><p className="mb-4 text-xs text-text-muted">{dateLabel(selected.createdAt)} · {selected.audience}</p><p className="whitespace-pre-wrap text-sm leading-7 text-text-primary">{selected.body}</p></>}
    </Modal>
  </>;
}
