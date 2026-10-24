import {hasLocalCustomerProfileResult, localCustomerProfileUnassessed} from '../../../shared/contracts/localCustomerProfile';
import { CustomerProfileTags } from './CustomerProfileTags';
import { customerFollowupStatus } from './customerTagPresentation';
import { Avatar, Button, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { AlertTriangle, BrainCircuit, ChevronDown } from 'lucide-react';
import { useAgentProductionAction } from '../../lib/agentProductionSession';
import { authHeader } from '../../lib/auth';
import { buildPrioritySuggestion, type PrioritySuggestion } from '../../lib/customerPriority';
import type { CustomerProfile, HandlingMode } from '../../types/customer';
import type { ConversationDraftIntent } from './conversationTiming';
import { STAGE_LABEL, customerDisplayName } from './conversionPresentation';
import { LiveLocalTime } from './LiveLocalTime';
import { sourceLabel } from './SourceIcon';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';
import { isSuggestionDismissed, suggestionDismissKey } from './customerSuggestionDismissal';

type DraftIntent = ConversationDraftIntent;

function fallbackHandoffSummary(customer: CustomerProfile): string {
  return [
    `客户想要：${customer.summary}`,
    `当前进展：${customer.nextStep}`,
    `需要人工原因：${customer.handlingReason}`,
  ].join('\n');
}

async function requestHandoffSummary(customer: CustomerProfile): Promise<string> {
  try {
    const resp = await fetch('/api/overseas/agents/conversion/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        customerId: customer.id,
        timeline: customer.timeline.slice(-20),
        product: customer.outboundProduct,
        internalProduct: customer.product,
        language: customer.language,
        stage: STAGE_LABEL[customer.stage],
        handlingReason: customer.handlingReason,
        customerSummary: customer.summary,
        nextStep: customer.nextStep,
        intent: 'handoff_summary',
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data?.draft === 'string' && data.draft.trim()) return data.draft.trim();
    }
  } catch {
    // Local fallback keeps the handoff context available.
  }
  return fallbackHandoffSummary(customer);
}

function intentLevelLabel(customer: CustomerProfile) {
  if (localCustomerProfileUnassessed(customer)) return '意向待评估';
  if (customer.bant?.band === 'black') return '信息待核实';
  if (customer.bant?.level === 'hot' || customer.intentScore >= 90) return '高价值商机';
  if (customer.bant?.level === 'qualified' || customer.intentScore >= 75) return '值得重点跟进';
  return '继续了解需求';
}

function CustomerIntentActionPanel({
  customer,
  onModeChange,
  onToast,
  onGenerateDraft,
  onFocusReply,
  onViewDraft,
  onCompleteTodo,
  customerServiceEnabled,
  autoReplyReady,
  hasReplyReady,
}: {
  customer: CustomerProfile;
  onModeChange: (mode: HandlingMode) => void;
  onToast: (message: string) => void;
  onGenerateDraft: (instruction: string, intent?: DraftIntent) => Promise<void> | void;
  onFocusReply: () => void;
  onViewDraft: () => void;
  onCompleteTodo: () => void;
  customerServiceEnabled: boolean;
  autoReplyReady: boolean;
  hasReplyReady: boolean;
}) {
  const agentProduction = useAgentProductionAction('customer');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [dismissTick, setDismissTick] = useState(0);
  const [handoffSummary, setHandoffSummary] = useState('');
  const [isPrimaryLoading, setIsPrimaryLoading] = useState(false);
  const rawSuggestion = buildPrioritySuggestion(customer);
  const actionableSuggestion: PrioritySuggestion = ['draft_review', 'blocked_auto'].includes(rawSuggestion.suggestionType) && !hasReplyReady
    ? { ...rawSuggestion, headline: '生成回复建议', reason: '已开启建议模式，点击后会根据客户最新消息生成草稿' }
    : rawSuggestion;
  const dismissed = actionableSuggestion.suggestionType !== 'none' && isSuggestionDismissed(customer.id, actionableSuggestion.suggestionType);
  const suggestion: PrioritySuggestion = dismissed
    ? {
      customerId: customer.id,
      suggestionType: 'none',
      headline: '今日任务已完成',
      reason: '已暂不处理，24 小时内不再提醒',
      evidence: ['已按你的选择静默 24 小时'],
      priorityScore: 0,
      tone: 'green',
    }
    : actionableSuggestion;
  const spinStageLabel = {
    situation: '了解现状',
    problem: '识别问题',
    implication: '确认影响',
    need_payoff: '推进决策',
  } as const;
  const communicationStage = customer.spinGuidance
    ? spinStageLabel[customer.spinGuidance.stage]
    : customer.progressionGoal?.label || STAGE_LABEL[customer.stage];
  const communicationSummary = customer.spinGuidance?.statement
    || customer.progressionGoal?.reason
    || customer.summary;
  const nextMove = customer.spinGuidance?.question
    || customer.progressionGoal?.question
    || customer.nextStep;
  const evidenceItems = Array.from(new Set([
    ...suggestion.evidence,
    ...(customer.bant?.evidence || []),
  ])).slice(0, 10);

  const switchMode = (mode: HandlingMode, message: string) => {
    onModeChange(mode);
    onToast(message);
  };

  useEffect(() => {
    setEvidenceOpen(false);
    setHandoffSummary('');
  }, [customer.id, suggestion.suggestionType]);

  useEffect(() => {
    if (!evidenceOpen || suggestion.suggestionType !== 'handoff' || handoffSummary) return;
    let alive = true;
    void requestHandoffSummary(customer).then(summary => {
      if (alive) setHandoffSummary(summary);
    });
    return () => {
      alive = false;
    };
  }, [customer, evidenceOpen, handoffSummary, suggestion.suggestionType]);

  const dismissSuggestion = () => {
    localStorage.setItem(suggestionDismissKey(customer.id, suggestion.suggestionType), String(Date.now() + 24 * 60 * 60 * 1000));
    onCompleteTodo();
    setDismissTick(value => value + 1);
    onToast('已暂不处理，24 小时内不再提醒');
  };

  void dismissTick;

  const primaryAction = async () => {
    if (suggestion.suggestionType === 'call') {
      if (isPrimaryLoading) return;
      setIsPrimaryLoading(true);
      try {
        await onGenerateDraft('生成一条主动触达草稿，语气自然，不承诺价格、折扣、付款条款或交期。', 'reactivate');
      } finally {
        setIsPrimaryLoading(false);
      }
      return;
    }
    if (suggestion.suggestionType === 'handoff') {
      onFocusReply();
      onToast('已聚焦回复框');
      return;
    }
    if (suggestion.suggestionType === 'draft_review' || suggestion.suggestionType === 'blocked_auto') {
      if (hasReplyReady) onViewDraft();
      else await onGenerateDraft('', 'reply');
      return;
    }
    if (suggestion.suggestionType === 'touch') {
      if (isPrimaryLoading) return;
      setIsPrimaryLoading(true);
      try {
        await onGenerateDraft('生成一条主动触达草稿，语气自然，不承诺价格、折扣、付款条款或交期。', 'reactivate');
      } finally {
        setIsPrimaryLoading(false);
      }
      return;
    }
  };

  const secondaryAction = () => {
    if (suggestion.suggestionType === 'call') {
      dismissSuggestion();
      return;
    }
    if (suggestion.suggestionType === 'handoff') {
      if (!customerServiceEnabled) {
        onToast('先开启智能客服，开启后只会给建议');
        return;
      }
      switchMode(autoReplyReady ? 'ai_auto' : 'ai_draft', autoReplyReady ? '已交回 AI 接待' : '已改为 AI 只给建议');
      return;
    }
    if (suggestion.suggestionType === 'draft_review' || suggestion.suggestionType === 'blocked_auto') {
      dismissSuggestion();
      return;
    }
    if (suggestion.suggestionType === 'touch') {
      dismissSuggestion();
    }
  };

  const primaryLabel: Record<PrioritySuggestion['suggestionType'], string> = {
    call: '生成触达草稿',
    handoff: '打开回复',
    draft_review: hasReplyReady ? '查看草稿' : '生成建议',
    touch: '生成触达草稿',
    blocked_auto: hasReplyReady ? '查看草稿' : '生成建议',
    none: '知道了',
  };
  const secondaryLabel: Record<PrioritySuggestion['suggestionType'], string> = {
    call: '暂不处理',
    handoff: !customerServiceEnabled ? '先开启客服' : autoReplyReady ? '交回 AI' : '改为 AI 建议',
    draft_review: '忽略此条',
    touch: '暂不处理',
    blocked_auto: '忽略此条',
    none: '',
  };

  return (
    <section data-testid="ai-intent-action-panel" className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
        <div>
          <p className="text-xs font-bold text-text-primary">AI 回复</p>
          <p className="mt-0.5 text-[10px] text-text-muted">沟通阶段与下一步推进建议</p>
        </div>
        <span className="shrink-0 border-l-2 border-accent bg-accent-glow px-2 py-1 text-[10px] font-bold text-accent">
          {intentLevelLabel(customer)}{!localCustomerProfileUnassessed(customer) && ` · ${customer.intentScore}`}
        </span>
      </div>
      <div className="p-3">
      <div className="border-b border-border pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">当前沟通阶段</p>
          <p className="text-[11px] font-bold text-text-primary">{communicationStage}</p>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-secondary">{communicationSummary}</p>
      </div>
      <div className="pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-accent">下一步推进建议</p>
          <p className="text-[11px] font-bold text-text-primary">{suggestion.headline}</p>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-secondary">{nextMove || suggestion.reason}</p>
      </div>
      {!!customer.intentSignals.length && (
        <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
          {customer.intentSignals.slice(0, 6).map(signal => (
            <span key={signal} className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-text-secondary">{signal}</span>
          ))}
        </div>
      )}
      {(suggestion.suggestionType !== 'none' || agentProduction.action) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button type="primary" htmlType="button" data-agent-action={window.__agentProductionTarget?.customerId === customer.id && !['customer_segmentation', 'followup_batch_draft'].includes(window.__agentProductionTarget?.link.businessRef.taskKey || '') ? 'customer-primary' : undefined} onClick={() => void (agentProduction.active ? agentProduction.execute().catch(error => onToast(error.message)) : primaryAction())} disabled={agentProduction.active ? !agentProduction.action || agentProduction.busy : isPrimaryLoading} className="!h-auto min-h-9 !whitespace-normal rounded-md bg-accent px-3 py-1.5 text-[11px] font-bold text-white hover:bg-accent-dim disabled:cursor-wait disabled:opacity-70">
            {agentProduction.busy || isPrimaryLoading ? '草稿生成中…' : agentProduction.action?.label || primaryLabel[suggestion.suggestionType]}
          </Button>
          {secondaryLabel[suggestion.suggestionType] && (
            <Button htmlType="button" onClick={secondaryAction} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
              {secondaryLabel[suggestion.suggestionType]}
            </Button>
          )}
        </div>
      )}
      {!!evidenceItems.length && (
        <Button htmlType="button" onClick={() => setEvidenceOpen(open => !open)} className="!h-auto min-h-9 !whitespace-normal !justify-start mt-2.5 flex w-full items-center justify-between border-t border-border pt-2.5 text-left text-[11px] font-bold text-text-secondary">
          查看 AI 判断依据
          <ChevronDown size={14} className={`transition-transform ${evidenceOpen ? 'rotate-180' : ''}`} />
        </Button>
      )}
      {evidenceOpen && (
        <div className="mt-2 border-l-2 border-border-bright bg-surface-2 px-3 py-3 text-[11px] leading-5">
          {suggestion.suggestionType === 'handoff' && (
            <div className="mb-2 whitespace-pre-line rounded-lg bg-surface px-3 py-2 text-text-secondary">
              {handoffSummary || '正在整理交接摘要...'}
            </div>
          )}
          <div className="space-y-1.5">
            {evidenceItems.map(item => (
              <p key={item} className="flex gap-2 text-text-secondary"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" />{item.replace(/\s[+-]\d+$/, '')}</p>
            ))}
          </div>
        </div>
      )}
      {customer.handlingMode === 'ai_auto' && suggestion.suggestionType === 'none' && (
        <Button htmlType="button" onClick={() => switchMode('human_needed', '已转为你亲自接手')} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-bold text-text-primary hover:bg-surface-2">
          转我接手
        </Button>
      )}
      </div>
    </section>
  );
}

function CustomerInsightDisclosure({ customer }: { customer: CustomerProfile }) {
  const [open, setOpen] = useState(false);
  const scenario = customer.simulation;
  const humanEditedEvents = customer.timeline.filter(event => event.audit?.editedByHuman).length;
  const humanEditCount = Math.max(humanEditedEvents, scenario?.humanEditCount || 0);
  const aiHandledCount = customer.timeline.filter(event => (
    event.actor === 'ai'
    || Boolean(event.audit?.originalDraft)
    || Boolean(event.audit?.memoryApplied?.length)
  )).length;
  const memoryRecords = Array.from(new Set([
    ...(scenario?.memoryApplied || []),
    ...customer.timeline.flatMap(event => event.audit?.memoryApplied || []),
  ]));

  useEffect(() => setOpen(false), [customer.id]);

  return (
    <section data-testid="customer-insight-disclosure" className="rounded-lg border border-border bg-surface">
      <Button
        htmlType="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="!h-auto min-h-11 !justify-start flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
          <BrainCircuit size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center justify-between gap-2"><span className="whitespace-nowrap text-xs font-semibold text-text-primary">AI 判断</span><span className="shrink-0 text-xs font-semibold text-accent">{localCustomerProfileUnassessed(customer) ? '意向待评估' : `意向 ${customer.intentScore}`}</span></span>
          {scenario?.warning && <span data-testid="large-order-warning-tag" aria-label={`${scenario.warning.title}：${scenario.warning.reason}`} title={scenario.warning.reason} className="inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"><AlertTriangle size={11} className="shrink-0" />大单预警</span>}
        </span>
        <ChevronDown size={14} className={`mt-1 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="font-semibold text-text-secondary">成交意向</span><span className="font-semibold text-accent">{localCustomerProfileUnassessed(customer) ? '待评估' : `${customer.intentScore}%`}</span></div>
            {!localCustomerProfileUnassessed(customer) && <LsGradientProgress percent={customer.intentScore} showInfo={false} size="small" />}
          </div>
          {scenario?.warning && <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{scenario.warning.reason}</span></div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-[10px] font-semibold text-text-muted">商机重点</p>
              <p className="mt-1 text-xs font-semibold text-text-primary">{intentLevelLabel(customer)}</p>
              <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-text-secondary">{customer.summary}</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-[10px] font-semibold text-text-muted">下一步</p>
              <p className="mt-1 line-clamp-2 text-xs font-semibold text-text-primary">{scenario?.checkpoint || STAGE_LABEL[customer.stage]}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-secondary">{scenario?.goal || customer.nextStep}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-surface py-2 text-center">
            <span><strong className="block text-sm text-text-primary">{aiHandledCount}</strong><small className="text-[9px] text-text-muted">AI 参与</small></span>
            <span><strong className="block text-sm text-text-primary">{humanEditCount}</strong><small className="text-[9px] text-text-muted">人工优化</small></span>
            <span><strong className="block text-sm text-text-primary">{memoryRecords.length}</strong><small className="text-[9px] text-text-muted">学习记录</small></span>
          </div>
          {!!memoryRecords.length && <details className="text-[10px] text-text-secondary"><summary className="cursor-pointer font-semibold">查看学习要点</summary><div className="mt-2 flex flex-wrap gap-1.5">{memoryRecords.slice(0, 6).map(item => <span key={item} className="rounded-md border border-border px-2 py-1">{item}</span>)}</div></details>}
        </div>
      )}
    </section>
  );
}

export function CustomerInfoRail({
  customer,
  onCustomerPatch,
  onGenerateDraft,
  onHandlingModeChange,
  onToast,
  onFocusReply,
  onViewDraft,
  onCompleteTodo,
  customerServiceEnabled,
  autoReplyReady,
  hasReplyReady,
}: {
  customer: CustomerProfile | null;
  onCustomerPatch: (patch: Partial<CustomerProfile>) => void;
  onGenerateDraft: (instruction: string, intent?: DraftIntent) => Promise<void> | void;
  onHandlingModeChange: (mode: HandlingMode) => void;
  onToast: (message: string) => void;
  onFocusReply: () => void;
  onViewDraft: () => void;
  onCompleteTodo: () => void;
  customerServiceEnabled: boolean;
  autoReplyReady: boolean;
  hasReplyReady: boolean;
}) {
  if (!customer) {
    return (
      <aside className="flex h-full w-full lg:w-64 shrink-0 items-center justify-center border-l border-border bg-surface-2 px-6 text-center xl:w-[272px] 2xl:w-72">
        <p className="text-xs font-bold text-text-muted">未选择客户</p>
      </aside>
    );
  }

  return (
    <aside data-testid="customer-info-rail" className="min-h-0 w-full shrink-0 self-stretch overflow-y-auto overscroll-contain border-l border-border bg-surface-2 [scrollbar-gutter:stable] lg:w-72 xl:w-[320px] 2xl:w-[336px]">
      <section aria-label="客户信息" className="space-y-2 border-b border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <Avatar size={32} className="!shrink-0 !bg-accent-glow !text-accent">{customer.avatar || customer.name.slice(0, 1)}</Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-sm font-semibold leading-5 text-text-primary" title={customerDisplayName(customer)}>{customerDisplayName(customer)}</h2>
            <p className="truncate text-xs text-text-muted">{customer.countryName || '—'} · {customer.language || '—'} · <LiveLocalTime timeZone={customer.timeZone}/></p>
          </div>
        </div>
        <dl data-testid="customer-profile-facts" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-text-muted">跟进</dt><dd><span aria-label="跟进状态" className="rounded bg-accent-glow px-1.5 py-0.5 font-medium text-accent">{customerFollowupStatus(customer)}</span></dd>
          <dt className="text-text-muted">评估</dt><dd className="text-text-secondary">{customer.estimatedValue === '待报价' ? '金额待评估' : customer.estimatedValue || '金额待评估'} · {localCustomerProfileUnassessed(customer) ? '意向待评估' : `意向 ${customer.intentScore}`}</dd>
          <dt className="text-text-muted">需求</dt><dd className="truncate text-text-secondary" title={customer.product}>{customer.product || '待了解'}</dd>
          <dt className="text-text-muted">归因</dt><dd className="truncate text-text-secondary" title={customer.sourcePostTitle}>{customer.sourcePostPlatform || sourceLabel(customer.source)}{customer.sourcePostTitle ? ` · ${customer.sourcePostTitle}` : ''}{customer.sourceTrackCode ? ` · ${customer.sourceTrackCode}` : ''}</dd>
        </dl>
        <CustomerProfileTags key={customer.id} customer={customer} onUpdated={onCustomerPatch} />
        <details className="text-xs text-text-secondary"><summary className="cursor-pointer text-text-muted">客户画像与跟进依据</summary><p className="mt-2 leading-5">{customer.summary}</p><p className="mt-1 leading-5">下一步：{customer.nextStep}</p>{customer.profileAnalysisStatus && <p aria-label="画像分析记录" className="mt-1 leading-5 text-text-muted" title={customer.profileAnalysisErrorCode || undefined}>画像分析：{{pending:'等待分析',analyzing:'后台更新中',succeeded:'已更新',failed:'更新失败',disabled:'未启用分析'}[customer.profileAnalysisStatus]}{hasLocalCustomerProfileResult(customer) && customer.profileAnalysisStatus !== 'succeeded' ? ' · 保留上次结果' : ''}{customer.profileAnalysisUpdatedAt ? ` · ${new Date(customer.profileAnalysisUpdatedAt).toLocaleString('zh-CN')}` : ''}</p>}<CustomerInsightDisclosure customer={customer} /></details>
      </section>
      <div className="p-3">
        <CustomerIntentActionPanel customer={customer} onModeChange={onHandlingModeChange} onToast={onToast} onGenerateDraft={onGenerateDraft} onFocusReply={onFocusReply} onViewDraft={onViewDraft} onCompleteTodo={onCompleteTodo} customerServiceEnabled={customerServiceEnabled} autoReplyReady={autoReplyReady} hasReplyReady={hasReplyReady} />
      </div>
    </aside>
  );
}
