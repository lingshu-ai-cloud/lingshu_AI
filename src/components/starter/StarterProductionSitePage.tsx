import { ArrowLeft, Eye, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
import type { Page } from '../../App';
import type { StarterProductionSiteId } from '../../lib/starterWorkspace';
import { formatCny, formatTokenCount } from './AgentUsageCard';
import { StarterProductionSiteViews } from './StarterProductionSiteViews';
import { useStarterWorkspace } from './useStarterWorkspace';

const SITE_PAGE_TITLE: Record<StarterProductionSiteId, string> = {
  inspiration: '灵感大屏',
  content: '内容制作',
  traffic: '投流／发布',
  sales: '销售／客户',
};

export default function StarterProductionSitePage({
  siteId,
  onNavigate,
}: {
  siteId: StarterProductionSiteId;
  onNavigate: (page: Page) => void;
}) {
  const state = useStarterWorkspace();
  if (state.loading && !state.workspace) {
    return <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-accent" /><span className="ml-2 text-sm text-text-muted">读取 Agent 生产现场……</span></div>;
  }
  if (!state.workspace) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm rounded-xl border border-border bg-white p-6 text-center">
          <p className="text-sm font-bold text-text-primary">{SITE_PAGE_TITLE[siteId]}暂时无法读取</p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{state.error || '请稍后重试。'}</p>
          <button type="button" onClick={() => void state.refresh()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white"><RefreshCcw size={13} />重试</button>
        </div>
      </div>
    );
  }

  const site = state.workspace.productionSites.find(item => item.id === siteId);
  if (!site) return null;
  const agent = state.workspace.agents.find(item => item.role === site.agentRole);

  return (
    <div className="h-full overflow-y-auto bg-[#f6f8f5]">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <button type="button" onClick={() => onNavigate('digitalEmployees')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary"><ArrowLeft size={14} />返回灵小枢工作台</button>
        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-accent"><Eye size={15} />Agent 生产现场 · 只读</div>
            <h1 className="mt-2 text-2xl font-bold text-text-primary">{site.title}</h1>
            <p className="mt-1.5 text-sm text-text-muted">{site.summary}</p>
          </div>
          <button type="button" onClick={() => void state.refresh()} disabled={state.refreshing} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary disabled:opacity-50"><RefreshCcw size={13} className={state.refreshing ? 'animate-spin' : ''} />刷新现场</button>
        </header>

        <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" />
          <p className="leading-relaxed">这里保留了 Agent 的工作过程、产物和证据，但不直接修改生产状态。下载、回填、补项、审批和授权请回到灵小枢的待决策或成果卡处理。</p>
        </div>

        {agent && (
          <section aria-label="Agent 用量摘要" className="mt-5 grid gap-3 rounded-xl border border-border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-[10px] font-semibold text-text-muted">当前阶段</p><p className="mt-1 text-sm font-bold text-text-primary">{agent.stage}</p></div>
            <div><p className="text-[10px] font-semibold text-text-muted">Token 总计</p><p className="mt-1 font-mono text-sm font-bold text-text-primary">{formatTokenCount(agent.tokens.total)}</p></div>
            <div><p className="text-[10px] font-semibold text-text-muted">已结算成本</p><p className="mt-1 text-sm font-bold text-text-primary">{formatCny(agent.costCny.settled)}</p></div>
            <div><p className="text-[10px] font-semibold text-text-muted">可用产物</p><p className="mt-1 text-sm font-bold text-text-primary">{formatTokenCount(agent.outputs.usable)} 份</p></div>
          </section>
        )}

        <main className="mt-6">
          <StarterProductionSiteViews site={site} />
        </main>
      </div>
    </div>
  );
}
