import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, Hand, ShieldCheck } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import { customerSalesDisplay } from '../../lib/customerSalesState';
import type { CustomerProfile, NextBestActionDecision, SalesConversationState } from '../../types/customer';

const INTENT_LABEL: Record<string, string> = {
  product_discovery: '产品发现', requirements_clarification: '需求澄清', capability_validation: '能力验证', sample_request: '样品', quotation_request: '询价', price_negotiation: '价格谈判', payment_delivery: '付款/交期', complaint_claim: '投诉/索赔', human_contact_request: '要求人工',
};
const EVIDENCE_LABEL: Record<string, string> = {
  quantity: '采购数量', target_market: '目标市场', key_event_timing: '关键时间', budget_status: '预算状态', decision_maker: '决策人', pain_point: '核心痛点', business_goal: '业务目标', decision_criteria: '决策标准', competition: '竞争情况', 'requirements.certification': '买家认证要求',
};
const ARTIFACT_LABEL: Record<string, string> = {
  catalog: '目录', specification: '规格文件', sample: '样品', quotation: '报价', pi: 'PI', purchase_order: 'PO', contract: '合同', payment_proof: '付款凭证', logistics: '物流文件', claim: '索赔文件',
};

function mockSalesState(customer: CustomerProfile): SalesConversationState {
  const now = new Date().toISOString();
  const display = customerSalesDisplay(customer);
  const buyerEvents = customer.timeline.filter(event => event.actor === 'buyer');
  const sourceEventIds = buyerEvents.slice(-3).map(event => event.id);
  const fields: SalesConversationState['dealEvidence']['fields'] = {};
  const dimensions = customer.bant ? [
    ['budget_status', customer.bant.budget], ['decision_maker', customer.bant.authority], ['business_goal', customer.bant.need], ['key_event_timing', customer.bant.timing],
  ] as const : [];
  dimensions.forEach(([key, dimension]) => {
    if (!dimension.evidence.length) return;
    fields[key] = { value: dimension.evidence[0], status: dimension.status === 'confirmed' ? 'verified' : 'claimed', confidence: Math.min(1, dimension.score / 25), sourceEventIds: sourceEventIds.length ? sourceEventIds : [`mock:${customer.id}:${key}`], valueRole: 'buyer_statement', updatedAt: now };
  });
  return {
    schemaVersion: 1,
    lifecycle: { stage: display.lifecycleStage, ...(customer.stage === 'won' ? { outcome: 'won' as const } : {}), enteredAt: now, lastProgressedAt: now },
    engagement: { status: display.engagementStatus, lastActivityAt: customer.lastActiveAt || Date.now(), updatedAt: now },
    intents: { active: customer.intentSignals.slice(0, 5).map((_, index) => ({ type: ['requirements_clarification', 'capability_validation', 'quotation_request', 'human_contact_request', 'payment_delivery'][index], confidence: 0.8, sourceEventIds, updatedAt: now })), updatedAt: now },
    dealEvidence: { fields, updatedAt: now },
    knowledge: { state: 'missing', referenceIds: [], updatedAt: now },
    authorityRisk: { riskLevel: customer.handlingMode === 'human_needed' ? 'L4' : 'L2', executionMode: customer.handlingMode === 'human_needed' ? 'mandatory_handoff' : 'ai_draft', reasons: [], updatedAt: now },
    artifacts: { items: [], updatedAt: now },
    channelOwnership: { channel: 'whatsapp', owner: { type: customer.handlingMode === 'human_needed' ? 'unassigned' : 'ai' }, handoffStatus: customer.handlingMode === 'human_needed' ? 'requested' : 'none', updatedAt: now },
    revision: 0, appliedEventIds: [], updatedAt: now,
  };
}

function mockNextAction(customer: CustomerProfile): NextBestActionDecision {
  const human = customer.handlingMode === 'human_needed';
  return {
    type: human ? 'request_human_takeover' : 'answer_and_clarify',
    headline: human ? '等待负责人接管' : customer.progressionGoal?.label || '回答并推进一步',
    rationale: human ? customer.handlingReason : customer.progressionGoal?.reason || customer.summary,
    primaryAction: human ? '查看证据后确认人工接管' : customer.progressionGoal?.question || customer.nextStep,
    answerFirst: true,
    missingConditions: [],
    sourceEventIds: customer.timeline.filter(event => event.actor === 'buyer').slice(-3).map(event => event.id),
    executionMode: human ? 'mandatory_handoff' : 'ai_draft',
  };
}

export function SalesStatePanel({ customer, onStateChange, onToast }: {
  customer: CustomerProfile;
  onStateChange: (state: SalesConversationState) => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<SalesConversationState>(() => customer.salesState || mockSalesState(customer));
  const [busy, setBusy] = useState('');
  const [nextAction, setNextAction] = useState(customer.nextBestAction || mockNextAction(customer));
  const [windowState, setWindowState] = useState(customer.whatsappWindow);
  const [handoffPackage, setHandoffPackage] = useState<any>(null);
  const viewedHandoffRef = useRef('');
  const evidence = useMemo(() => Object.entries(state.dealEvidence.fields).filter(([, field]) => field.value !== undefined).slice(0, 8), [state]);

  const acceptState = (value: any) => {
    const next = value?.state as SalesConversationState | undefined;
    if (next) { setState(next); onStateChange(next); }
    if (value?.nextBestAction) setNextAction(value.nextBestAction);
    if (value?.whatsappWindow) setWindowState(value.whatsappWindow);
    if (value?.handoffPackage) setHandoffPackage(value.handoffPackage);
    const responseState = value?.state as SalesConversationState | undefined;
    if (!customer.isMock && value?.handoffPackage && responseState?.channelOwnership.handoffStatus === 'requested') {
      const viewKey = `${customer.id}:${responseState.revision}`;
      if (viewedHandoffRef.current !== viewKey) {
        viewedHandoffRef.current = viewKey;
        void fetch('/api/overseas/sales-operations/pilot/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ id: `handoff-viewed:${viewKey}`, customerId: customer.id, type: 'handoff_viewed' }),
        }).catch(() => {});
      }
    }
  };

  useEffect(() => {
    setState(customer.salesState || mockSalesState(customer));
    setNextAction(customer.nextBestAction || mockNextAction(customer));
    setWindowState(customer.whatsappWindow);
    if (customer.isMock) return;
    let alive = true;
    fetch(`/api/overseas/sales-operations/customers/${encodeURIComponent(customer.id)}/state`, { headers: authHeader() })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (alive && value) acceptState(value); })
      .catch(() => {});
    return () => { alive = false; };
  }, [customer.id]);

  const post = async (path: string, body: Record<string, unknown> = {}) => {
    if (customer.isMock) { onToast('模拟客户只展示状态，真实客户可执行确认和审批'); return null; }
    setBusy(path);
    try {
      const response = await fetch(`/api/overseas/sales-operations/customers/${encodeURIComponent(customer.id)}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.missingConditions?.join('、') || value.error || '操作失败');
      acceptState(value);
      const refreshed = await fetch(`/api/overseas/sales-operations/customers/${encodeURIComponent(customer.id)}/state`, { headers: authHeader() }).then(result => result.ok ? result.json() : null).catch(() => null);
      if (refreshed) acceptState(refreshed);
      return value;
    } catch (error) {
      onToast(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally { setBusy(''); }
  };

  const createQuote = async () => {
    const latestQuote = state.artifacts.items.filter(item => item.type === 'quotation').sort((a, b) => b.version - a.version)[0];
    const value = await post('/artifacts', { type: 'quotation', title: `报价草稿 · ${customer.name}`, externalRef: `internal-draft:${customer.id}:${Date.now()}`, supersedesId: latestQuote?.id });
    if (value) onToast(latestQuote ? `报价 V${latestQuote.version + 1} 已创建，旧版本记录保留` : '报价 V1 已创建，发送前必须审批');
  };

  const recordPurchaseOrder = async () => {
    const value = await post('/artifacts', {
      type: 'purchase_order',
      title: `采购单 · ${customer.name}`,
      externalRef: `manual-po-record:${customer.id}:${Date.now()}`,
      received: true,
    });
    if (value) onToast('采购单已登记为买方成交证据');
  };

  const correctEvidence = async (key: string, currentValue: unknown) => {
    const value = window.prompt(`纠正“${EVIDENCE_LABEL[key] || key}”`, String(currentValue ?? ''));
    if (value === null || !value.trim() || value.trim() === String(currentValue ?? '').trim()) return;
    const result = await post(`/evidence/${encodeURIComponent(key)}/confirm`, { value: value.trim() });
    if (result) onToast('证据已人工纠正并保留修改历史');
  };

  const artifacts = state.artifacts.items.slice().reverse().slice(0, 6);
  return (
    <section data-testid="sales-state-panel" className="rounded-2xl border border-border bg-white shadow-sm">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-2 px-3.5 py-3 text-left">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700"><ShieldCheck size={14} /></span>
        <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-text-primary">交易状态与证据</span><span className="mt-0.5 block text-[10px] text-text-muted">意图、证据、文档和会话归属</span></span>
        <ChevronDown size={14} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-3 border-t border-border px-3.5 py-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">知识：{state.knowledge.state === 'grounded_static' || state.knowledge.state === 'grounded_dynamic' ? '有依据' : state.knowledge.state === 'ambiguous' ? '有歧义' : '待补充'}</span>
          <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${state.authorityRisk.riskLevel === 'L4' ? 'bg-red-100 text-red-700' : state.authorityRisk.riskLevel === 'L3' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>权限风险：{state.authorityRisk.riskLevel}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">归属：{state.channelOwnership.owner.type === 'ai' ? 'AI' : state.channelOwnership.owner.type === 'human' ? '人工' : '待分配'}</span>
        </div>
        {nextAction && <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-3">
          <p className="text-[10px] font-bold text-cyan-700">下一最佳动作</p>
          <p className="mt-1 text-[11px] font-bold text-text-primary">{nextAction.headline}</p>
          <p className="mt-1 text-[10px] leading-4 text-text-secondary">{nextAction.primaryAction}</p>
          {!!nextAction.missingConditions.length && <p className="mt-1 text-[10px] text-amber-700">缺少：{nextAction.missingConditions.slice(0, 3).join('、')}</p>}
        </div>}

        <div>
          <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">当前意图</p><span className="text-[10px] text-text-muted">多标签</span></div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{state.intents.active.length ? state.intents.active.slice(0, 6).map(intent => <span key={intent.type} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{INTENT_LABEL[intent.type] || intent.type} · {Math.round(intent.confidence * 100)}%</span>) : <span className="text-[10px] text-text-muted">等待客户表达</span>}</div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">交易证据</p><span className="text-[10px] text-text-muted">值 + 来源 + 状态</span></div>
          <div className="mt-2 space-y-1.5">{evidence.length ? evidence.map(([key, field]) => <div key={key} className="rounded-lg bg-slate-50 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-bold text-text-primary">{EVIDENCE_LABEL[key] || key}</p><p className="mt-0.5 line-clamp-2 text-[10px] text-text-secondary">{String(field.value)}</p></div><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${field.status === 'verified' ? 'bg-emerald-100 text-emerald-700' : field.status === 'conflicting' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{field.status === 'verified' ? '已确认' : field.status === 'conflicting' ? '有冲突' : '客户表述'}</span></div>
            <div className="mt-1 flex items-center justify-between"><span className="text-[9px] text-text-muted">{field.valueRole === 'buyer_requirement' ? '买家要求，不代表卖家能力' : `来源 ${field.sourceEventIds.length} 条 · 历史 ${field.history?.length || 1} 次`}</span><span className="flex gap-2">{field.status !== 'verified' && <button type="button" disabled={Boolean(busy)} onClick={() => void post(`/evidence/${encodeURIComponent(key)}/confirm`)} className="text-[9px] font-bold text-cyan-700">确认</button>}<button type="button" disabled={Boolean(busy)} onClick={() => void correctEvidence(key, field.value)} className="text-[9px] font-bold text-slate-500">纠正</button></span></div>
          </div>) : <p className="text-[10px] text-text-muted">暂无可追溯证据</p>}</div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">商务文档</p><div className="flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void recordPurchaseOrder()} className="text-[10px] font-bold text-emerald-700">+ 登记 PO</button><button type="button" disabled={Boolean(busy)} onClick={() => void createQuote()} className="text-[10px] font-bold text-cyan-700">+ 报价草稿</button></div></div>
          <div className="mt-2 space-y-1.5">{artifacts.length ? artifacts.map(item => <div key={item.id} className="rounded-lg border border-slate-200 px-2.5 py-2">
            <div className="flex items-center gap-2"><FileText size={11} className="text-slate-500"/><span className="min-w-0 flex-1 truncate text-[10px] font-bold text-text-primary">{ARTIFACT_LABEL[item.type] || item.type} V{item.version}</span><span className="text-[9px] text-text-muted">{item.status === 'accepted' ? '已接收' : item.status === 'sent' ? '已发送' : item.approvalStatus === 'approved' ? '已审批' : item.approvalStatus === 'pending' ? '待审批' : '草稿'}</span></div>
            {item.status !== 'sent' && item.status !== 'accepted' && <div className="mt-1.5 flex gap-2">{item.approvalStatus === 'pending' && <button type="button" onClick={() => void post(`/artifacts/${item.id}/approve`)} className="text-[9px] font-bold text-cyan-700">审批通过</button>}{(item.approvalStatus === 'approved' || item.approvalStatus === 'not_required') && <button type="button" onClick={() => void post(`/artifacts/${item.id}/send`, { deliveryEvidence: `manual-record:${Date.now()}` })} className="text-[9px] font-bold text-emerald-700">记录已发送</button>}</div>}
          </div>) : <p className="text-[10px] text-text-muted">尚未创建商机级文档</p>}</div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-2"><Hand size={12} className="text-slate-500"/><p className="flex-1 text-[10px] font-bold text-text-primary">{state.channelOwnership.handoffStatus === 'accepted' ? '人工处理中' : state.channelOwnership.handoffStatus === 'requested' ? '等待人工接管' : 'AI 辅助接待'}</p><span className="text-[9px] text-text-muted">{windowState?.status === 'open' ? '24h 窗口内' : windowState?.status === 'closed' ? '需模板' : '窗口未知'}</span></div>
          <div className="mt-2 flex gap-2">{state.channelOwnership.handoffStatus === 'none' || state.channelOwnership.handoffStatus === 'resolved' ? <button type="button" onClick={() => void post('/handoff', { action: 'request' })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[9px] font-bold text-slate-600">请求人工</button> : <><button type="button" onClick={() => void post('/handoff', { action: 'accept' })} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[9px] font-bold text-white">确认接管</button><button type="button" onClick={() => void post('/handoff', { action: 'return_to_ai' })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[9px] font-bold text-slate-600">交还 AI</button></>}</div>
          {handoffPackage && state.channelOwnership.handoffStatus !== 'none' && <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[9px] leading-4 text-slate-600"><p className="font-bold text-slate-700">结构化交接包</p><p>意图 {handoffPackage.activeIntents?.length || 0} · 证据 {handoffPackage.verifiedEvidence?.length || 0} · 文档 {handoffPackage.artifacts?.length || 0} · 风险 {handoffPackage.risk?.riskLevel || 'L1'}</p><p className="mt-0.5 line-clamp-2">客户问题：{handoffPackage.customerQuestion || '等待补充'}</p></div>}
        </div>
        {state.dealEvidence.fields['requirements.certification'] && <p className="flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[9px] leading-4 text-amber-700"><Check size={10} className="mt-0.5 shrink-0"/>认证字段记录为买家要求，未写入企业能力。</p>}
      </div>}
    </section>
  );
}
