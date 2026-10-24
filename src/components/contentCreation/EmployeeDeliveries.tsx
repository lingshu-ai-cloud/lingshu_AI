import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Modal, Table, Tag } from 'antd';
import { ArrowDown, ArrowUp, Play } from 'lucide-react';
import { dispatchDigitalEmployeeDeepLink, type DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { employeeVideoDeliveries, nextEmployeeVideoIndex, type EmployeeVideoDelivery } from '../../lib/employeeDeliveries';
import { AuthenticatedVideo } from '../inspiration/InspirationMedia';
import { LsMediaStateFrame } from '../ui/LsExperiencePrimitives';

function DeliveryMedia({ item, preview = false }: { item: EmployeeVideoDelivery; preview?: boolean }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = container.current;
    return () => {
      media?.querySelectorAll('video').forEach(video => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
    };
  }, []);
  return <div ref={container} className={preview ? 'relative h-full w-full' : 'relative h-20 w-14 shrink-0 overflow-hidden rounded-md'}>
    <LsMediaStateFrame state={state} label={state === 'error' ? '成片暂不可播' : '正在加载成片'} className="h-full w-full bg-surface-2">
      <AuthenticatedVideo key={`${item.url}:${attempt}`} apiUrl={item.url} controls={preview} autoPlay={preview} loadOnMount previewFrame={!preview} preload="metadata"
        className={preview ? 'h-full w-full object-contain' : 'pointer-events-none h-full w-full object-cover'}
        onReady={() => setState('ready')} onError={() => setState('error')} />
    </LsMediaStateFrame>
    {preview && state === 'error' && <Button className="absolute bottom-6 left-1/2 -translate-x-1/2" onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>重新加载</Button>}
  </div>;
}

function DeliveryFeed({ items, initialId, onClose }: { items: EmployeeVideoDelivery[]; initialId: string; onClose: () => void }) {
  const [id, setId] = useState(initialId);
  const index = items.findIndex(item => item.id === id);
  const current = items[index];
  const lastWheel = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const mediaRegion = useRef<HTMLDivElement>(null);
  const move = (direction: number) => {
    const next = nextEmployeeVideoIndex(index, direction, items.length);
    if (items[next]) setId(items[next].id);
  };
  useEffect(() => { mediaRegion.current?.focus(); }, []);
  return <Modal open width={960} title="成片阅览" footer={null} onCancel={onClose} destroyOnHidden>
    {current ? <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div ref={mediaRegion} tabIndex={0} role="region" aria-label="成片播放区，向上或向下滑动切换视频" className="h-[58vh] min-h-64 overflow-hidden rounded-xl bg-surface-2 outline-offset-4" style={{ touchAction: 'pan-x' }}
          onWheel={event => {
            if (Math.abs(event.deltaY) < 35 || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || Date.now() - lastWheel.current < 650) return;
            lastWheel.current = Date.now(); move(event.deltaY);
          }}
          onTouchStart={event => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; }}
          onTouchEnd={event => {
            const point = event.changedTouches[0], start = touch.current; touch.current = null;
            if (point && start && Math.abs(start.y - point.clientY) > 65 && Math.abs(start.y - point.clientY) > Math.abs(start.x - point.clientX)) move(start.y - point.clientY);
          }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) return;
            event.preventDefault(); move(['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1);
          }}>
          <DeliveryMedia key={`${current.id}:${current.url}`} item={current} preview />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button icon={<ArrowUp size={15} />} disabled={index === 0} onClick={() => move(-1)}>上一条</Button>
          <span role="status" aria-live="polite" className="text-xs text-text-secondary">{index + 1} / {items.length}{index === items.length - 1 ? ' · 已到最后一条' : ''}</span>
          <Button icon={<ArrowDown size={15} />} disabled={index === items.length - 1} onClick={() => move(1)}>下一条</Button>
        </div>
      </div>
      <div className="max-h-[65vh] min-w-0 space-y-4 overflow-y-auto break-words" aria-label="成片详情">
        <h3 className="text-lg font-semibold text-text-primary">{current.title}</h3>
        <p className="text-sm text-text-secondary">{current.subject}</p>
        <DeliveryStatus item={current} />
        {current.reason && <Alert showIcon type="warning" title={current.reason} />}
        <p className="text-sm text-text-secondary">{current.delivery.effect || '发布状态尚未核验'}</p>
        <p className="text-xs text-text-muted">成片预览不代表已验收或已发布。需要调整或验收时，进入原成片项目处理。</p>
        {current.delivery.link && <Button onClick={() => { dispatchDigitalEmployeeDeepLink(current.delivery.link!); onClose(); }}>查看成片项目</Button>}
      </div>
    </div> : <Empty description="当前成片已变化，请关闭后重新选择。" />}
  </Modal>;
}

function DeliveryStatus({ item }: { item: EmployeeVideoDelivery }) {
  return <div className="flex flex-wrap gap-1"><Tag color={item.status === '质检失败样片' ? 'error' : item.approved ? 'success' : item.needsReview ? 'warning' : 'default'}>{item.status === '质检失败样片' ? item.status : item.approved ? '已验收' : item.needsReview ? '待人工验收' : item.status}</Tag></div>;
}

export default function EmployeeDeliveries({ data }: { data: DigitalEmployeeOverview }) {
  const items = useMemo(() => employeeVideoDeliveries(data), [data]);
  const [selected, setSelected] = useState<{ scope: string; id: string } | null>(null);
  const scope = JSON.stringify([data.goal?.id, data.plan?.id, data.run?.id]);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const close = () => setSelected(null);
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, close);
    window.addEventListener('storage', close);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, close); window.removeEventListener('storage', close); };
  }, []);
  const close = () => { setSelected(null); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); };
  return <section aria-label="数字员工成片预览" className="mt-6 min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-text-primary">成片预览</h2><span className="text-sm text-text-secondary">本周 {items.length} 条已生成视频</span></div>
    {data.deliveryNotice && <Alert type="warning" showIcon title={data.deliveryNotice} />}
    {items.length ? <Table<EmployeeVideoDelivery> rowKey="id" dataSource={items} pagination={false} size="middle" tableLayout="fixed" columns={[
      { title: '视频', key: 'video', width: 86, render: (_, item) => <button type="button" className="relative block rounded-md outline-offset-4" aria-label={`阅览成片：${item.title}`} onClick={event => { trigger.current = event.currentTarget; setSelected({ scope, id: item.id }); }}><DeliveryMedia key={`${item.id}:${item.url}`} item={item} /><span className="pointer-events-none absolute inset-0 flex items-center justify-center"><Play size={20} className="text-white drop-shadow" /></span></button> },
      { title: '内容', key: 'title', render: (_, item) => <div className="min-w-0 break-words"><p className="font-medium text-text-primary">{item.title}</p><p className="mt-1 text-xs text-text-secondary">{item.subject}</p>{item.reason && <p className="mt-1 text-xs text-warning">{item.reason}</p>}<div className="mt-2 sm:hidden"><DeliveryStatus item={item} /></div></div> },
      { title: '验收状态', key: 'status', width: 170, responsive: ['sm'], render: (_, item) => <DeliveryStatus item={item} /> },
      { title: '成片更新（北京时间）', key: 'time', width: 175, responsive: ['lg'], render: (_, item) => Number.isFinite(Date.parse(item.updatedAt)) ? new Date(item.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚未记录' },
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周还没有可预览的成片，数字员工生成视频后会在这里展示。" />}
    {selected?.scope === scope && <DeliveryFeed key={scope} items={items} initialId={selected.id} onClose={close} />}
  </section>;
}
