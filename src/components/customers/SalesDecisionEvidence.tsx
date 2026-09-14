import { useState } from 'react';
import { AlertTriangle, BookOpenCheck, ChevronDown, ShieldCheck, Target } from 'lucide-react';

export interface SalesDecisionMeta {
  knowledgeMiss?: boolean;
  missReason?: string;
  replyConfidence?: { level?: string; score?: number; reason?: string };
  strategies?: Array<{ id?: string; scenario?: string; confidence?: number; reason?: string }>;
  evidence?: string[];
  handoffRequired?: boolean;
  safeToSendBeforeHandoff?: boolean;
  handlingReason?: string;
  decision?: {
    schemaVersion?: number;
    execution?: 'none' | 'remind' | 'draft' | 'auto_send' | 'human_required';
    handoff?: { required?: boolean; reason?: string; safeBridgeAllowed?: boolean };
    knowledge?: { ready?: boolean; miss?: boolean; safetyMode?: string };
    safety?: { issues?: string[] };
    explanations?: Array<{ summary?: string; detail?: string; evidence?: string[] }>;
  };
}

export interface SalesDecisionViewModel {
  status: 'handoff' | 'review' | 'grounded';
  statusLabel: string;
  confidenceLabel: string | null;
  confidenceReason: string | null;
  knowledgeLabel: string;
  knowledgeReason: string | null;
  executionLabel: string;
  strategies: Array<{ id: string; title: string; reason: string | null }>;
  evidence: string[];
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function confidencePercent(score: unknown): number | null {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(Math.min(100, value <= 1 ? value * 100 : value));
}

export function buildSalesDecisionViewModel(meta: SalesDecisionMeta): SalesDecisionViewModel {
  const handoffRequired = meta.decision?.handoff?.required ?? meta.handoffRequired ?? false;
  const knowledgeMiss = meta.decision?.knowledge?.miss ?? meta.knowledgeMiss ?? false;
  const safeBridgeAllowed = meta.decision?.handoff?.safeBridgeAllowed ?? meta.safeToSendBeforeHandoff ?? false;
  const status = handoffRequired ? 'handoff' : knowledgeMiss ? 'review' : 'grounded';
  const confidence = confidencePercent(meta.replyConfidence?.score);
  const level = clean(meta.replyConfidence?.level);
  const strategies = (meta.strategies ?? [])
    .map((strategy, index) => ({
      id: clean(strategy.id) || `strategy-${index + 1}`,
      title: clean(strategy.scenario) || clean(strategy.id) || `销售策略 ${index + 1}`,
      reason: clean(strategy.reason) || null,
    }))
    .filter((strategy, index, list) => list.findIndex(item => item.id === strategy.id) === index);
  const decisionEvidence = (meta.decision?.explanations ?? []).flatMap(item => [item.summary, item.detail, ...(item.evidence ?? [])]);
  const evidence = [...new Set([...(meta.evidence ?? []), ...decisionEvidence].map(clean).filter(Boolean))];

  return {
    status,
    statusLabel: status === 'handoff' ? '需要人工确认' : status === 'review' ? '知识待核实' : '依据已就绪',
    confidenceLabel: confidence === null && !level ? null : `${confidence === null ? '' : `${confidence}% · `}${level || '置信度'}`,
    confidenceReason: clean(meta.replyConfidence?.reason) || null,
    knowledgeLabel: knowledgeMiss ? '企业知识未覆盖' : evidence.length ? `引用 ${evidence.length} 条判断依据` : '未返回具体企业依据',
    knowledgeReason: clean(meta.missReason) || null,
    executionLabel: handoffRequired
      ? safeBridgeAllowed
        ? '可先发送安全承接话术，具体承诺仍需人工确认'
        : '不得自动发送，需人工确认后回复'
      : meta.decision?.execution === 'auto_send'
        ? '已满足低风险自动回复条件，可进入自动发送流程'
        : '可按当前客服权限进入发送流程',
    strategies,
    evidence,
  };
}

export function SalesDecisionEvidence({ meta }: { meta: SalesDecisionMeta | null }) {
  const [open, setOpen] = useState(false);
  if (!meta) return null;
  const view = buildSalesDecisionViewModel(meta);
  const tone = view.status === 'handoff'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : view.status === 'review'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <section data-sales-decision-evidence className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ShieldCheck size={16} className="shrink-0 text-cyan-700" />
          <span className="text-xs font-black text-slate-800">销售判断依据</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${tone}`}>{view.statusLabel}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] font-bold text-slate-500">
          {view.confidenceLabel && <span>{view.confidenceLabel}</span>}
          <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-xs">
          <div className={`rounded-xl border px-3 py-2 ${tone}`}>
            <div className="flex items-center gap-1.5 font-black"><AlertTriangle size={13} />发送边界</div>
            <p className="mt-1 leading-5">{view.executionLabel}</p>
            {meta.handlingReason && <p className="mt-1 leading-5 opacity-80">原因：{meta.handlingReason}</p>}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 font-black text-slate-700"><BookOpenCheck size={13} />事实依据</div>
              <p className="mt-1.5 font-semibold text-slate-600">{view.knowledgeLabel}</p>
              {view.knowledgeReason && <p className="mt-1 leading-5 text-amber-700">{view.knowledgeReason}</p>}
              {view.evidence.length > 0 && (
                <ul className="mt-2 space-y-1 text-slate-600">
                  {view.evidence.map((item, index) => <li key={`${item}-${index}`} className="leading-5">• {item}</li>)}
                </ul>
              )}
            </div>

            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 font-black text-slate-700"><Target size={13} />销售策略</div>
              {view.strategies.length ? (
                <ul className="mt-1.5 space-y-2">
                  {view.strategies.map(strategy => (
                    <li key={strategy.id} className="text-slate-600">
                      <p className="font-bold text-slate-700">{strategy.title}</p>
                      {strategy.reason && <p className="mt-0.5 leading-5">{strategy.reason}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1.5 text-slate-500">本轮未返回专项销售策略</p>}
            </div>
          </div>

          {view.confidenceReason && (
            <p className="rounded-xl bg-cyan-50 px-3 py-2 leading-5 text-cyan-800">
              <span className="font-black">置信度说明：</span>{view.confidenceReason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
