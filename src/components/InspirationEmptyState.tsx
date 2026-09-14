import { Download, Film } from 'lucide-react';

export default function InspirationEmptyState({ state, contentFormat, search, localMaterialCount, onReset, onOpenLibrary }: {
  state: 'no-data' | 'no-match';
  contentFormat: 'video' | 'image';
  search: string;
  localMaterialCount: number;
  onReset: () => void;
  onOpenLibrary: () => void;
}) {
  return <div className="min-h-72 rounded-xl border border-dashed border-border bg-surface flex flex-col items-center justify-center gap-3 text-center px-6">
    <div className="w-11 h-11 rounded-xl bg-surface-2 border border-border flex items-center justify-center text-text-muted"><Download size={18} /></div>
    <div>{state === 'no-data' ? <>
      <p className="text-sm font-semibold text-text-primary">暂无真实{contentFormat === 'image' ? '图文' : '视频'}数据</p>
      <p className="text-xs text-text-muted mt-1">请通过「定时任务」采集公开{contentFormat === 'image' ? '图文' : '视频'}，或从对标账号导入真实内容。</p>
    </> : <>
      <p className="text-sm font-semibold text-text-primary">没有匹配{search.trim() ? `“${search.trim()}”` : '当前筛选条件'}的结果</p>
      <p className="text-xs text-text-muted mt-1">已有数据未丢失，可清除搜索或重置筛选后继续查看。</p>
      <button type="button" onClick={onReset} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-bold text-accent hover:border-accent">清除搜索并重置筛选</button>
    </>}</div>
    {state === 'no-data' && localMaterialCount > 0 && <button type="button" onClick={onOpenLibrary} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white"><Film size={15} />查看 {localMaterialCount} 条素材</button>}
  </div>;
}
