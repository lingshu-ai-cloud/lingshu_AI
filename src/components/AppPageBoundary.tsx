import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { Page } from '../pageRegistry';

export function PageLoading() {
  return <div className="flex h-full min-h-0 items-center justify-center bg-white"><Loader2 size={20} className="animate-spin text-text-muted" /></div>;
}
function isChunkLoadError(error: unknown): boolean {
  const text = String(error instanceof Error ? `${error.name} ${error.message}` : error || '').toLowerCase();
  return text.includes('failed to fetch dynamically imported module') || text.includes('loading chunk') || text.includes('chunkloaderror') || text.includes('importing a module script failed');
}
export class PageErrorBoundary extends Component<{ page: Page; onNavigateHome: () => void; children: ReactNode }, { error: Error | null; resetKey: Page }> {
  state = { error: null as Error | null, resetKey: this.props.page };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { page: Page }, state: { error: Error | null; resetKey: Page }) { return props.page !== state.resetKey ? { error: null, resetKey: props.page } : null; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info);
    if (!isChunkLoadError(error)) return;
    const retryKey = `ow_chunk_retry:${this.props.page}`;
    try { if (sessionStorage.getItem(retryKey)) return; sessionStorage.setItem(retryKey, '1'); window.location.reload(); } catch { window.location.reload(); }
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="flex h-full min-h-0 items-center justify-center bg-white px-6"><div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm"><p className="text-sm font-bold text-text-primary">页面加载异常</p><p className="mt-2 text-sm leading-relaxed text-text-muted">当前页面资源没有正确加载，请重新加载页面；如果仍然异常，可以先返回首页继续使用。</p><div className="mt-5 flex items-center justify-center gap-2"><button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-semibold">重新加载</button><button type="button" onClick={this.props.onNavigateHome} className="px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-text-secondary">返回首页</button></div></div></div>;
  }
}
