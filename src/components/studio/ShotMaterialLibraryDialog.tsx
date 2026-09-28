import { useState } from 'react';
import { Check, X, Upload } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { StoryboardFirstFrame } from './StoryboardFirstFrame';
type LibraryItem = { id: string; name: string; type: string; url: string; folder?: string; analysisStatus?: string };
export default function ShotMaterialLibraryDialog({ items, shotTitle, selectedId, busy, error, onClose, onSelect, onUpload, salesShotCount = 0 }: {
  items: LibraryItem[]; shotTitle: string; selectedId?: string; busy?: boolean; error?: string; salesShotCount?: number;
  onClose: () => void; onSelect: (id: string, allSales: boolean) => void; onUpload: (files: FileList | null, allSales: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [allSales, setAllSales] = useState(false);
  const ref = useModalFocus<HTMLDivElement>({ open: true, onClose: () => { if (!busy) onClose(); }, closeOnEscape: !busy });
  const visible = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4" onClick={() => { if (!busy) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="企业素材库" onClick={event => event.stopPropagation()} className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-lg font-black">企业素材库</h2><p className="mt-1 text-xs text-text-muted">{shotTitle} · 选择后填入当前分镜</p></div><button type="button" aria-label="关闭企业素材库" disabled={busy} onClick={onClose}><X size={20}/></button></header>
      <div className="flex gap-3 border-b border-border p-4"><input aria-label="搜索企业素材" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索企业素材" className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm"/><label className={`inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white ${busy ? 'opacity-50' : 'cursor-pointer'}`}><Upload size={16}/>{busy ? '上传中…' : '上传企业素材'}<input aria-label="上传企业素材" type="file" accept="video/*,image/*" disabled={busy} className="sr-only" onChange={event => { onUpload(event.target.files, allSales); event.target.value = ''; }}/></label></div>
      {salesShotCount > 0 && <label className="px-4 pt-3 text-xs"><input type="checkbox" checked={allSales} onChange={event => setAllSales(event.target.checked)} className="mr-2"/>应用到全部 {salesShotCount} 个未锁定销售人物分镜</label>}
      {error && <p role="alert" className="px-4 pt-3 text-xs text-red-700">{error}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4">{visible.map(item => { const selected = item.id === selectedId; return <button key={item.id} type="button" disabled={busy} aria-pressed={selected} onClick={() => onSelect(item.id, allSales)} className={`relative rounded-xl border p-2 text-left ${selected ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-100' : 'border-border'}`}><StoryboardFirstFrame source={item.type === 'video' ? item.url : undefined} imageUrl={item.type === 'image' ? item.url : undefined} time={0} label={item.name} className="aspect-video w-full"/>{selected && <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white" aria-label="当前已选"><Check size={14}/></span>}<span className="mt-2 block truncate text-xs font-bold">{item.name}</span><span className="mt-1 flex items-center justify-between gap-1 text-[9px] text-text-muted"><span className="truncate">{item.folder || '企业素材'}</span>{item.analysisStatus && <span className={item.analysisStatus === 'completed' ? 'text-emerald-700' : item.analysisStatus === 'failed' ? 'text-red-600' : 'text-amber-700'}>{item.analysisStatus === 'completed' ? '已分析' : item.analysisStatus === 'failed' ? '分析失败' : '分析中'}</span>}</span></button>; })}{!visible.length && <p className="col-span-full py-8 text-center text-sm text-text-muted">暂无企业素材，可先上传视频或图片。</p>}</div>
    </div>
  </div>;
}
