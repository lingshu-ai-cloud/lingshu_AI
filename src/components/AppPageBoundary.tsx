import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
    try {
      const lastAttempt = Number(sessionStorage.getItem(retryKey) || 0);
      if (Date.now() - lastAttempt < 30_000) return;
      sessionStorage.setItem(retryKey, String(Date.now()));
      window.location.reload();
    } catch {
      // Do not reload without a session guard; the visible fallback remains usable.
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="flex h-full min-h-0 items-center justify-center bg-white px-6"><div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm"><p className="text-sm font-bold text-text-primary">页面加载异常</p><p className="mt-2 text-sm leading-relaxed text-text-muted">当前页面资源没有正确加载，请重新加载页面；如果仍然异常，可以先返回首页继续使用。</p><div className="mt-5 flex items-center justify-center gap-2"><button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-semibold">重新加载</button><button type="button" onClick={this.props.onNavigateHome} className="px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-text-secondary">返回首页</button></div></div></div>;
  }
}

type WorkspaceBoundaryState = {
  error: Error | null;
  resetKey: string;
  retryKey: number;
};

/** Keep a failed lazy workspace or tab from replacing the whole application shell. */
export class WorkspaceErrorBoundary extends Component<{
  resetKey: string;
  label?: string;
  children: ReactNode;
}, WorkspaceBoundaryState> {
  state: WorkspaceBoundaryState = { error: null, resetKey: this.props.resetKey, retryKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: WorkspaceBoundaryState,
  ): Partial<WorkspaceBoundaryState> | null {
    return props.resetKey === state.resetKey
      ? null
      : { error: null, resetKey: props.resetKey, retryKey: 0 };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WorkspaceErrorBoundary]', error, info);
  }

  private retry = () => {
    this.setState(state => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (!this.state.error) {
      return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
    }
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center bg-white px-5">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <AlertTriangle size={24} className="mx-auto text-amber-600" />
          <p className="mt-3 text-sm font-bold text-text-primary">{this.props.label || '当前页面'}显示失败</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">其他页面仍可继续使用。你可以重试当前页面，或切换到其他 TAB 后再返回。</p>
          <button type="button" onClick={this.retry} className="mt-5 rounded-lg bg-text-primary px-4 py-2 text-sm font-semibold text-white">重试当前页面</button>
        </div>
      </div>
    );
  }
}

/** Last-resort guard for errors thrown outside the page slot (for example a sidebar lazy chunk). */
export class AppCrashBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppCrashBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface-2 px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 text-center shadow-sm">
          <AlertTriangle size={26} className="mx-auto text-amber-600" />
          <p className="mt-3 text-base font-bold text-text-primary">页面刚刚遇到异常</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">你的登录状态和已保存内容不会被清除。重新加载即可恢复应用。</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-text-primary px-4 py-2 text-sm font-semibold text-white">重新加载</button>
        </div>
      </div>
    );
  }
}
