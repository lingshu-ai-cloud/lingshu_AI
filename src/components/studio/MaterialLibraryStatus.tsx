import { useEffect, useState } from 'react';
import { getMaterialLibraryState, type MaterialLibraryState } from '../../lib/studioApi';
export default function MaterialLibraryStatus({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [state, setState] = useState<MaterialLibraryState | null>(getMaterialLibraryState);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setState((event as CustomEvent<MaterialLibraryState>).detail);
    window.addEventListener('lingshu:material-library-status', update);
    return () => window.removeEventListener('lingshu:material-library-status', update);
  }, []);
  useEffect(() => {
    if (!state?.items?.some(item => ['pending', 'analyzing'].includes(item.segmentAnalysisStatus || ''))) return;
    const timer = window.setTimeout(() => { void onRetry().catch(() => {}); }, 5000);
    return () => window.clearTimeout(timer);
  }, [state, onRetry]);
  if (!state || state.status === 'ready') return null;
  return <div role="alert" className="my-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    <p className="font-semibold">{state.status === 'partial' ? '部分素材来源暂时不可用' : '素材库连接异常'}</p>
    {state.sources.filter(source => source.state !== 'ready').map(source => <p key={source.source} className="mt-1">{source.message}</p>)}
    <p className="mt-1 text-xs">{state.status === 'partial' ? '已读取的素材仍可使用，未读取的来源不会被当作空库。' : '当前列表可能不是最新状态，请恢复连接后重试。'}</p>
    <button type="button" disabled={busy} className="mt-2 rounded border border-amber-400 px-3 py-1 font-semibold disabled:opacity-50" onClick={async () => { setBusy(true); try { await onRetry(); } catch {} finally { setBusy(false); } }}>{busy ? '正在重试…' : '重新连接'}</button>
  </div>;
}
