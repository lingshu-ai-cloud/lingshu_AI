import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Modal } from 'antd';
import { Check, Upload } from 'lucide-react';
import type { ImageReplicationReference } from '../../lib/imageReplicationDraft';
import { ReviewImage } from './socialImageWorkbenchPresentation';

/** Same reference-selection interaction as the video scene: cards, selection, batches, explicit confirmation. */
export default function ImageReplicationReferencePicker({ items, reference, disabled, unavailable, onSelect, onConfirm, onUpload, onReload }: {
  items: ImageReplicationReference[]; reference: ImageReplicationReference | null; disabled: boolean;
  onSelect: (value: ImageReplicationReference | null) => void;
  unavailable: boolean; onConfirm: () => void; onUpload: () => void; onReload: () => void;
}) {
  const gallery = useRef<HTMLDivElement>(null);
  const [batchSize, setBatchSize] = useState(4);
  const [page, setPage] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [attempt, setAttempt] = useState(0);
  const referenceItem = items.find(item => item.url === reference?.url);
  const referenceReady = Boolean(reference?.url) && (!referenceItem || availability[referenceItem.url] === true);
  useEffect(() => {
    const element = gallery.current;
    if (!element) return;
    const measure = () => setBatchSize(Math.max(1, Math.ceil(element.clientWidth / 124)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pageCount = Math.max(1, Math.ceil(items.length / batchSize));
  const currentPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    const index = items.findIndex(item => item.url === reference?.url);
    if (index >= 0) setPage(Math.floor(index / batchSize));
  }, [reference?.url, batchSize, items]);
  const visible = items.slice(currentPage * batchSize, (currentPage + 1) * batchSize);
  return <section className="min-w-0 space-y-3" aria-label="选择参考图片">
    <div><strong className="text-sm text-text-primary">先选一张已采集对标图文</strong>
      <p className="mt-1 text-xs text-text-secondary">来自图文采集库的最近100条记录，保留原帖来源；点击图片选择。</p></div>
    <div ref={gallery} role="group" aria-label="参考图片卡片" className="flex min-w-0 items-center gap-3 overflow-x-auto px-1.5 py-2.5">
      {visible.map(item => <button type="button" key={item.url} aria-label={`选择参考图片：${item.title}`}
        aria-pressed={reference?.url === item.url} title={item.title} disabled={disabled || !item.url || availability[item.url] !== true}
        onClick={() => onSelect(item)}
        className={`relative w-28 min-w-28 shrink-0 overflow-hidden rounded-lg border text-left transition-transform duration-[var(--ls-motion-standard)] motion-safe:hover:scale-105 motion-safe:focus-visible:scale-105 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${reference?.url === item.url ? 'border-accent ring-2 ring-accent' : 'border-border'}`}>
        <div className="h-24 overflow-hidden bg-surface-2"><ReviewImage key={`${item.url}:${attempt}`} src={item.url} alt={item.title}
          onAvailability={ready => setAvailability(previous => previous[item.url] === ready ? previous : { ...previous, [item.url]: ready })}/></div>
        {reference?.url === item.url && <span className="absolute right-1 top-1 rounded-full bg-surface p-1 text-accent" aria-hidden="true"><Check size={12}/></span>}
      </button>)}
    </div>
    {!disabled && !unavailable && !items.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已采集的对标图文，请先在灵感中心采集，或上传参考图"/>}
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">
      <Button disabled={disabled || pageCount < 2} onClick={() => { onSelect(null); setPage((currentPage + 1) % pageCount); gallery.current?.scrollTo({ left: 0 }); }}>换一批</Button>
      <Button disabled={disabled} icon={<Upload size={16}/>} onClick={onUpload}>上传参考图</Button></div>
      <Button type="primary" disabled={disabled || !referenceReady} onClick={onConfirm}>选择该参考图</Button></div>
    <Button type="link" size="small" disabled={disabled} onClick={onReload}>刷新已采集图文</Button>
    {visible.some(item => availability[item.url] === false) && <div className="flex items-center gap-2 text-xs text-text-secondary" role="status">
      <span>部分图片暂不可用，请选择其他图片或上传参考图。</span>
      <Button size="small" disabled={disabled} onClick={() => { setAvailability({}); setAttempt(value => value + 1); }}>重新加载图片</Button></div>}
    <p className="text-xs text-text-secondary" role="status">{items.length ? `${currentPage + 1} / ${pageCount}` : '0 / 0'}</p>
    {reference?.sourceUrl && <p className="text-xs text-text-secondary">{reference.platform} · 已采集图文 <a className="text-accent" href={reference.sourceUrl} target="_blank" rel="noreferrer">查看原帖</a></p>}
    {reference?.caption && <p className="line-clamp-2 text-xs text-text-secondary" dir="auto">原帖配文：{reference.caption}</p>}
    {reference && <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm text-text-secondary" title={reference.title}>{`已选：${reference.title}`}</span>
      <Button type="link" size="small" onClick={() => setPreviewOpen(true)}>预览大图</Button></div>}
    <Modal open={previewOpen && Boolean(reference)} title={reference?.title} width={720} onCancel={() => setPreviewOpen(false)}
      footer={<Button onClick={() => setPreviewOpen(false)}>关闭预览</Button>}>
      {previewOpen && reference && <div className="h-[min(60vh,32rem)]"><ReviewImage key={reference.url} src={reference.url} alt={`已选参考图：${reference.title}`}/></div>}
    </Modal>
  </section>;
}
