import { useState } from 'react';
import { studioApi } from '../../lib/studioApi';
export default function MaterialAnalysisStatus({ material, onRefresh }: { material: {
  id: string; type: string; scope?: string; usage?: string; segmentAnalysisStatus?: string; segmentAnalysisError?: string; segments?: Array<{id:string;start:number;end:number;action?:string;needsReview?: boolean}>;
}, onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  if (material.type === 'audio') return null;
  const status = material.segmentAnalysisStatus;
  const pending = status === 'pending' || status === 'analyzing';
  return <div className="mt-1 text-[11px]" onClick={event => event.stopPropagation()}>
    <p className={status === 'failed' ? 'text-red-600' : 'text-text-muted'}>{status === 'completed' ? (material.segments?.some(segment => segment.needsReview) ? '分析完成 · 含待复核片段' : '素材分析完成') : status === 'analyzing' ? '正在识别画面与可用片段…' : status === 'pending' ? '等待分析…' : status === 'failed' ? '分析失败' : '尚未分析'}</p>
    {(error || material.segmentAnalysisError) && <p role="alert" className="mt-1 text-red-600">{error || material.segmentAnalysisError}</p>}
    {!!material.segments?.length && <>
      <button type="button" className="mt-1 font-semibold text-accent" onClick={event => {event.preventDefault();setExpanded(!expanded);}}>{expanded ? '收起片段' : `查看 ${material.segments.length} 个可用区间`}</button>
      {expanded && <div className="mt-2 space-y-2">{material.segments.map(segment => <div key={segment.id} className="rounded border border-border p-2">
        <p>{segment.start.toFixed(1)}–{segment.end.toFixed(1)} 秒 · {segment.action || '可见画面'}</p>
        {segment.needsReview && material.scope !== 'shared' && <button type="button" disabled={busy} className="mt-1 text-accent" onClick={async event => {
          event.preventDefault();setBusy(true);setError('');
          try {const result=await studioApi.updateMaterialSegment(material.id,segment.id,{manualConfirmed:true});if(!result.ok)throw Error(result.error || '复核保存失败');await onRefresh();}
          catch(err){setError(err instanceof Error?err.message:'复核保存失败');}finally{setBusy(false);}
        }}>已查看原片，确认此区间</button>}
      </div>)}</div>}
    </>}
    {!pending && status !== 'completed' && material.scope !== 'shared' && material.usage !== 'reference_only' && <button type="button" disabled={busy} className="mt-1 font-semibold text-accent disabled:opacity-50" onClick={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try { const result = await studioApi.startMaterialAnalysis(material.id, status === 'failed'); if (!result.ok) throw Error(result.error || '无法启动分析'); await onRefresh(); }
      catch (err) { setError(err instanceof Error ? err.message : '无法启动分析'); }
      finally { setBusy(false); }
    }}>{busy ? '正在提交…' : status === 'failed' ? '重试分析' : '分析素材'}</button>}
  </div>;
}
