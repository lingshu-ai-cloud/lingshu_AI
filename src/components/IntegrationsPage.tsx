import { Component, type ErrorInfo, type ReactNode } from 'react';
import { PlugZap } from 'lucide-react';
import ChannelsPage from './ChannelsPage';

class IntegrationTabBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[IntegrationsPage]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-white px-6">
        <div className="w-full max-w-md rounded-xl border border-gray-100 bg-gray-50 p-5 text-center">
          <p className="text-sm font-semibold text-gray-900">当前模块暂时无法显示</p>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            这不会影响其他页面。请刷新后重试账号授权配置。
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col h-full bg-white">
      <header className="flex min-h-[68px] flex-shrink-0 items-center justify-between border-b border-border px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center text-accent">
            <PlugZap size={13} />
          </div>
          <div><h1 className="text-lg font-semibold text-text-primary">集成中心</h1><p className="mt-0.5 hidden text-[11px] text-text-muted sm:block">连接业务渠道并检查授权状态</p></div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <IntegrationTabBoundary>
          <ChannelsPage />
        </IntegrationTabBoundary>
      </div>
    </div>
  );
}
