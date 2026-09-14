import { AlertTriangle, ArrowRight, Bot, CircleDollarSign, Clock3, Coins, FileCheck2 } from 'lucide-react';
import type { StarterAgentRole, StarterAgentUsage, StarterProductionSiteId } from '../../lib/starterWorkspace';

const ROLE_META: Record<StarterAgentRole, { responsibility: string; accent: string; soft: string }> = {
  orchestrator: { responsibility: '统筹与验收', accent: '#117f51', soft: '#edf7f1' },
  content: { responsibility: '内容与质检', accent: '#3b6f9c', soft: '#eef5fb' },
  traffic: { responsibility: '发布与归因', accent: '#7a5aa6', soft: '#f5f0fb' },
  sales: { responsibility: '询盘与报价', accent: '#a45a3b', soft: '#fff3e7' },
};

const STATUS_LABEL: Record<StarterAgentUsage['status'], string> = {
  idle: '空闲',
  running: '运行中',
  waiting_user: '等待你',
  blocked: '能力待接通',
  error: '异常',
  completed: '已完成',
  paused: '已暂停',
  unknown: '状态待同步',
};

const ANOMALY_LABEL: Record<string, string> = {
  usage_cost_unknown: '成本数据尚未完整结算',
  usage_ledger_record_invalid: '有用量记录未通过校验，已停止汇总',
  usage_reservation_negative: '预算预留记录异常，已停止估算',
  starter_198_usage_actual_cost_exceeds_reservation: '实际成本高于任务预留，后续任务已暂停准入',
  starter_198_usage_cycle_stale: '任务跨计费周期完成，成本已记入并标记复核',
  starter_198_usage_terminal_projection_unavailable: '成本已落账，但预算投影暂时无法核对',
  starter_198_budget_exhausted: '本轮预算已用尽，新的付费任务不会启动',
  usage_anomaly_unknown: '有内部用量记录需要交付团队核对',
};

const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatTokenCount(value: number | null): string {
  return value === null ? '待同步' : integerFormatter.format(value);
}

export function formatCny(value: number | null): string {
  return value === null ? '待同步' : `¥${moneyFormatter.format(value)}`;
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-black/[0.06] bg-white/80 px-2.5 py-2">
      <p className="text-[10px] font-medium text-text-muted">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-bold text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

interface Props {
  agent: StarterAgentUsage;
  onOpenSite?: (site: StarterProductionSiteId) => void;
}

export default function AgentUsageCard({ agent, onOpenSite }: Props) {
  const meta = ROLE_META[agent.role];
  const budgetTotal = agent.budgetCny.total;
  const budgetCommitted = agent.budgetCny.used === null || agent.budgetCny.reserved === null
    ? null
    : agent.budgetCny.used + agent.budgetCny.reserved;
  const budgetPercent = budgetTotal && budgetCommitted !== null
    ? Math.min(100, Math.max(0, budgetCommitted / budgetTotal * 100))
    : null;

  return (
    <article
      aria-label={`${agent.displayName}状态`}
      className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_6px_24px_rgba(23,61,49,0.04)]"
    >
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4" style={{ background: meta.soft }}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm" style={{ color: meta.accent }}>
            <Bot size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-text-primary">{agent.displayName}</h3>
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{meta.responsibility} · {agent.stage}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white bg-white/80 px-2 py-1 text-[10px] font-semibold" style={{ color: meta.accent }}>
          {STATUS_LABEL[agent.status]}
        </span>
      </div>

      <div className="space-y-4 p-4">
        <section aria-label="Token 消耗">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-text-secondary"><Coins size={13} aria-hidden="true" />Token 消耗</p>
            <p className="font-mono text-xs font-bold" style={{ color: meta.accent }}>总计 {formatTokenCount(agent.tokens.total)}</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Metric label="Input" value={formatTokenCount(agent.tokens.input)} mono />
            <Metric label="Output" value={formatTokenCount(agent.tokens.output)} mono />
            <Metric label="Cache" value={formatTokenCount(agent.tokens.cache)} mono />
          </div>
        </section>

        <section aria-label="人民币成本">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-text-secondary"><CircleDollarSign size={13} aria-hidden="true" />人民币成本</p>
          <div className="grid grid-cols-3 gap-1.5">
            <Metric label="预估" value={formatCny(agent.costCny.estimated)} />
            <Metric label="预留" value={formatCny(agent.costCny.reserved)} />
            <Metric label="结算" value={agent.costCny.settled === null && agent.costCny.settlementStatus === 'pending' ? '待结算' : formatCny(agent.costCny.settled)} />
          </div>
          {agent.costCny.settlementStatus === 'pending' && (
            <p className="mt-1.5 text-[10px] text-text-muted">成本正在结算{agent.costCny.updatedAt ? ` · 更新于 ${new Date(agent.costCny.updatedAt).toLocaleString('zh-CN')}` : ''}</p>
          )}
        </section>

        <section aria-label="预算">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-text-secondary">本轮预算</span>
            <span className="font-semibold text-text-primary">已用 {formatCny(agent.budgetCny.used)} · 剩余 {formatCny(agent.budgetCny.remaining)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            {budgetPercent !== null && <div className="h-full rounded-full" style={{ width: `${budgetPercent}%`, background: meta.accent }} />}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-muted">
            <span>总额 {formatCny(agent.budgetCny.total)}</span>
            <span>预留 {formatCny(agent.budgetCny.reserved)}</span>
          </div>
          {agent.budgetCny.projectedOverrun === true && <p className="mt-1.5 text-[10px] font-semibold text-red-700">预计将超出本轮预算</p>}
        </section>

        <section className="rounded-lg bg-surface-2 px-3 py-2.5" aria-label="产出">
          <div className="flex items-start gap-2">
            <FileCheck2 size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-text-secondary">产出：{formatTokenCount(agent.outputs.completed)} 份完成 · {formatTokenCount(agent.outputs.usable)} 份可用 · {formatTokenCount(agent.outputs.awaitingDecision)} 份待决策</p>
              {agent.outputs.summary && <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{agent.outputs.summary}</p>}
            </div>
          </div>
        </section>

        {agent.anomalies.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="leading-relaxed">{ANOMALY_LABEL[agent.anomalies[0]] || agent.anomalies[0]}{agent.anomalies.length > 1 ? `（另有 ${agent.anomalies.length - 1} 项）` : ''}</p>
          </div>
        )}

        {agent.waits.count > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] text-blue-900">
            <Clock3 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="leading-relaxed">等待 {agent.waits.count} 项{agent.waits.reasons[0] ? `：${agent.waits.reasons[0]}` : ''}</p>
          </div>
        )}

        {agent.productionSite && onOpenSite && (
          <button
            type="button"
            onClick={() => onOpenSite(agent.productionSite!)}
            className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
          >
            查看 Agent 生产现场 <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}
