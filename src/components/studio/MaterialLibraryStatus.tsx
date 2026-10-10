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
  // A partial source must not interrupt the working library when usable items
  // have already been returned. Only a complete read failure needs an alert.
  if (!state || state.status !== 'unavailable') return null;
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
    <p className="font-semibold">素材库暂时未更新</p>
    {state.sources.filter(source => source.state !== 'ready').map(source => <p key={source.source} className="mt-1">{source.message}</p>)}
    <p className="mt-1 text-[11px]">已保留上次成功读取的素材，可稍后重试。</p>
    <button type="button" disabled={busy} className="mt-2 rounded border border-amber-400 px-3 py-1 font-semibold disabled:opacity-50" onClick={async () => { setBusy(true); try { await onRetry(); } catch {} finally { setBusy(false); } }}>{busy ? '正在重试…' : '重新连接'}</button>
  </div>;
}
