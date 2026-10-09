import { Button, Checkbox, Input, Modal, Upload as AntUpload } from 'antd';
import { useState } from 'react';
import { Check, Upload } from 'lucide-react';
import { StoryboardFirstFrame } from './StoryboardFirstFrame';
type LibraryItem = { id: string; name: string; type: string; url: string; folder?: string; analysisStatus?: string };
export default function ShotMaterialLibraryDialog({ items, shotTitle, selectedId, busy, error, onClose, onSelect, onUpload, salesShotCount = 0 }: {
  items: LibraryItem[]; shotTitle: string; selectedId?: string; busy?: boolean; error?: string; salesShotCount?: number;
  onClose: () => void; onSelect: (id: string, allSales: boolean) => void; onUpload: (files: FileList | null, allSales: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [allSales, setAllSales] = useState(false);
  const visible = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));
  return <Modal open title="企业素材库" width={840} onCancel={onClose} keyboard={!busy} closable={!busy} mask={{ closable: false }}
    footer={<Button onClick={onClose} disabled={busy}>完成</Button>} styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
      <p className="mb-4 text-sm text-text-secondary">{shotTitle} · 选择后填入当前分镜</p>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input allowClear aria-label="搜索企业素材" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索企业素材" className="min-w-40 flex-1" />
        <AntUpload accept="video/*,image/*" disabled={busy} showUploadList={false} beforeUpload={file => { const transfer = new DataTransfer(); transfer.items.add(file); onUpload(transfer.files, allSales); return false; }}>
          <Button type="primary" loading={busy} icon={<Upload size={16}/>}>上传企业素材</Button>
        </AntUpload>
      </div>
      {salesShotCount > 0 && <Checkbox checked={allSales} onChange={event => setAllSales(event.target.checked)}>应用到全部 {salesShotCount} 个未锁定销售人物分镜</Checkbox>}
      {error && <p role="alert" className="px-4 pt-3 text-xs text-red-700">{error}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4">{visible.map(item => { const selected = item.id === selectedId; return <button key={item.id} type="button" disabled={busy} aria-pressed={selected} onClick={() => onSelect(item.id, allSales)} className={`relative rounded-lg border p-2 text-left ${selected ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-100' : 'border-border'}`}><StoryboardFirstFrame source={item.type === 'video' ? item.url : undefined} imageUrl={item.type === 'image' ? item.url : undefined} time={0} label={item.name} className="aspect-video w-full"/>{selected && <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white" aria-label="当前已选"><Check size={14}/></span>}<span className="mt-2 block truncate text-xs font-bold">{item.name}</span><span className="mt-1 flex items-center justify-between gap-1 text-[9px] text-text-muted"><span className="truncate">{item.folder || '企业素材'}</span>{item.analysisStatus && <span className={item.analysisStatus === 'completed' ? 'text-emerald-700' : item.analysisStatus === 'failed' ? 'text-red-600' : 'text-amber-700'}>{item.analysisStatus === 'completed' ? '已分析' : item.analysisStatus === 'failed' ? '分析失败' : '分析中'}</span>}</span></button>; })}{!visible.length && <p className="col-span-full py-8 text-center text-sm text-text-muted">暂无企业素材，可先上传视频或图片。</p>}</div>
  </Modal>;
}
