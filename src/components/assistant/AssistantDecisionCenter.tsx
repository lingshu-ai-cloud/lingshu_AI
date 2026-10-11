import { Alert, App, Button, Divider, Popconfirm, Skeleton, Tag, Input } from 'antd';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  FileInput,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantDecisionApiError,
  assistantDecisionApi,
  type AssistantDecisionAction,
  type AssistantDecisionActionId,
  type AssistantDecisionActionResponse,
  type AssistantDecisionCard,
  type AssistantDecisionDeepLink,
  type AssistantDecisionFeed,
  type AssistantDecisionKind,
} from '../../lib/assistantDecisionApi';
import {
  WEEKLY_WORK_UPDATED_EVENT,
  notifyWeeklyWorkUpdated,
  type WeeklyWorkUpdatedDetail,
} from '../../lib/weeklyWorkEvents';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { normalizeAssistantDecisionExecutionReceipt } from '../../../shared/contracts/assistantDecisionCenter';
import { LsBrandAction } from '../ui/LsExperiencePrimitives';
import './assistantDecisionCenter.css';

const kindMeta: Record<AssistantDecisionKind, {
  label: string;
  icon: typeof CalendarCheck2;
  tone: 'warning' | 'info' | 'danger' | 'success';
}> = {
  plan_start: { label: '开始计划', icon: CalendarCheck2, tone: 'warning' },
  plan_adjustment: { label: '计划调整', icon: CalendarRange, tone: 'warning' },
  external_approval: { label: '对外审批', icon: Send, tone: 'warning' },
  content_approval: { label: '内容审批', icon: ShieldCheck, tone: 'info' },
  input_required: { label: '需要处理', icon: FileInput, tone: 'danger' },
  next_step: { label: '页面下一步', icon: ArrowRight, tone: 'info' },
};

const actionIcon: Partial<Record<AssistantDecisionActionId, typeof ArrowRight>> = {
  approve_and_start: CalendarCheck2,
  adjust_plan: CalendarRange,
  approve: CheckCircle2,
  reject: RefreshCw,
  take_over: UserRoundCheck,
  open_workspace: ArrowRight,
};

export type AssistantDecisionClient = typeof assistantDecisionApi;

export type AssistantDecisionCenterVariant = 'summary' | 'detail';

export type AssistantDecisionActionResult = {
  action: AssistantDecisionAction;
  card: AssistantDecisionCard;
  response: AssistantDecisionActionResponse;
};

export type AssistantDecisionCenterProps = {
  page: string;
  active?: boolean;
  goalId?: string;
  onOpenChat: () => void;
  onOpenDetail?: (trigger?: HTMLButtonElement | null) => void;
  onNavigate?: (link?: AssistantDecisionDeepLink) => void;
  onFeedChange?: (feed: AssistantDecisionFeed) => void;
  onActionResult?: (result: AssistantDecisionActionResult) => void;
  variant?: AssistantDecisionCenterVariant;
  showHeading?: boolean;
  className?: string;
  client?: AssistantDecisionClient;
};

const STALE_DECISION_CODES = new Set([
  'stale_decision',
  'assistant_decision_changed',
  'assistant_decision_not_pending',
]);

type ExecutionFeedback = {
  kind: 'success' | 'info' | 'warning' | 'error';
  title: string;
  detail: string;
};

type StartReconciliation = {
  card: AssistantDecisionCard;
  action: AssistantDecisionAction;
  deadline: number;
};

export function assistantDecisionExecutionFeedback(
  execution: NonNullable<AssistantDecisionActionResponse['execution']>,
): ExecutionFeedback {
  const taskLabel = `${execution.taskCount} 项任务`;
  if (execution.status === 'succeeded') {
    return { kind: 'success', title: '本周任务已完成', detail: `${taskLabel}已完成，可返回智能经营查看结果。` };
  }
  if (execution.status === 'failed') {
    return { kind: 'error', title: '本周任务已启动，但运行失败', detail: `已创建${taskLabel}；请返回智能经营查看实际失败原因并处理。` };
  }
  if (execution.status === 'cancelled') {
    return { kind: 'warning', title: '本周任务已启动，随后被取消', detail: `已创建${taskLabel}；请返回智能经营核对取消原因和下一步。` };
  }
  if (execution.status === 'paused') {
    return { kind: 'warning', title: '本周任务已启动，目前已暂停', detail: `已创建${taskLabel}；恢复后会从当前进度继续。` };
  }
  if (execution.status.startsWith('waiting_')) {
    return { kind: 'info', title: '本周任务已启动，正在等待下一条件', detail: `已创建${taskLabel}；可在智能经营查看当前等待事项。` };
  }
  if (['initializing', 'planning', 'queued'].includes(execution.status)) {
    return { kind: 'info', title: '本周任务已启动，正在排队准备', detail: `已创建${taskLabel}，数字员工会按计划进入生产。` };
  }
  return { kind: 'success', title: '本周任务已启动', detail: `${taskLabel}正在运行，可在智能经营查看真实进度。` };
}

function dispatchDeepLink(link?: AssistantDecisionDeepLink): void {
  if (!link || typeof window === 'undefined') return;
  const detail = {
    ...link,
    ...(link.runId ? { workflowRunId: link.runId } : {}),
    ...(link.taskId ? { workflowTaskId: link.taskId } : {}),
  };
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail }));
}

function factTone(tone: AssistantDecisionCard['facts'][number]['tone']): string {
  return tone ? `is-${tone}` : 'is-default';
}

function decisionLabel(card: AssistantDecisionCard): string {
  if (card.kind === 'input_required') {
    return card.facts.some(fact => fact.tone === 'danger' || fact.value.includes('失败')) ? '需要处理' : '补充输入';
  }
  if (card.kind !== 'external_approval') return kindMeta[card.kind].label;
  const context = [card.title, card.summary, ...card.facts.flatMap(fact => [fact.label, fact.value])].join(' ').toLowerCase();
  if (/(quote|报价|价格|承诺)/.test(context)) return '报价审批';
  if (/(publish|发布|排期)/.test(context)) return '发布审批';
  if (/(send|发送|触达|消息|跟进)/.test(context)) return '发送审批';
  return kindMeta[card.kind].label;
}

function selectPrimaryDecision(feed: AssistantDecisionFeed | null): AssistantDecisionCard | null {
  return feed?.items[0] || null;
}

export function assistantDecisionSummaryTitle(card: AssistantDecisionCard): string {
  if (card.kind === 'plan_start' || card.kind === 'plan_adjustment') return '请确认本周的内容计划';
  return card.title;
}

function DecisionSummary({
  card,
  total,
  onOpenDetail,
}: {
  card: AssistantDecisionCard;
  total: number;
  onOpenDetail?: (trigger?: HTMLButtonElement | null) => void;
}) {
  const Icon = kindMeta[card.kind].icon;
  const title = assistantDecisionSummaryTitle(card);
  return (
    <button
      type="button"
      className="assistant-decision-summary"
      onClick={event => onOpenDetail?.(event.currentTarget)}
      aria-label={`查看待办详情：${title}`}
    >
      <span className="assistant-decision-summary__icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="assistant-decision-summary__content">
        <span className="assistant-decision-summary__eyebrow">
          <span>待你决定</span>
          {total > 1 ? <span>共 {total} 项</span> : null}
        </span>
        <strong>{title}</strong>
        <span className="assistant-decision-summary__description">{card.summary}</span>
      </span>
      <ArrowRight className="assistant-decision-summary__arrow" size={18} aria-hidden="true" />
    </button>
  );
}

function DecisionCard({
  card,
  total,
  busyAction,
  note,
  onNoteChange,
  onAction,
}: {
  card: AssistantDecisionCard;
  total: number;
  busyAction: AssistantDecisionActionId | null;
  note: string;
  onNoteChange: (value: string) => void;
  onAction: (action: AssistantDecisionAction) => void;
}) {
  const meta = kindMeta[card.kind];
  const label = decisionLabel(card);
  const Icon = meta.icon;
  const noteRequired = card.actions.some(action => action.requiresNote);
  const primary = card.actions.find(action => action.emphasis === 'primary') || card.actions[0];
  const secondary = card.actions.filter(action => action !== primary);
  return (
    <article className="assistant-decision-card" aria-labelledby={`assistant-decision-title-${card.id}`}>
      <header className="assistant-decision-card__header">
        <span className={`assistant-decision-card__icon is-${meta.tone}`} aria-hidden="true"><Icon size={19} /></span>
        <div className="assistant-decision-card__heading">
          <div className="assistant-decision-card__eyebrow">
            <Tag className="assistant-decision-card__kind" color={meta.tone === 'info' ? 'processing' : meta.tone === 'danger' ? 'error' : meta.tone}>{label}</Tag>
            {total > 1 ? <span className="assistant-decision-card__queue">优先处理 · 共 {total} 项</span> : null}
          </div>
          <h3 id={`assistant-decision-title-${card.id}`}>{card.title}</h3>
          <p>{card.summary}</p>
        </div>
      </header>

      {card.facts.length ? (
        <dl className="assistant-decision-card__facts">
          {card.facts.map((fact, index) => (
            <div key={`${fact.label}:${index}`} className={factTone(fact.tone)}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {noteRequired ? (
        <div className="assistant-decision-card__note">
          <label htmlFor={`assistant-decision-note-${card.id}`}>处理意见</label>
          <Input.TextArea
            id={`assistant-decision-note-${card.id}`}
            value={note}
            onChange={event => onNoteChange(event.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={500}
            placeholder="退回修改时请填写具体原因"
          />
        </div>
      ) : null}

      <Divider className="assistant-decision-card__divider" />
      <footer className="assistant-decision-card__actions">
        <div className="assistant-decision-card__secondary-actions">
          {secondary.map(action => {
            const ActionIcon = actionIcon[action.id];
            const button = (
              <Button
                className="assistant-decision-card__action"
                key={action.id}
                danger={action.emphasis === 'danger'}
                disabled={Boolean(busyAction) || (action.requiresNote && !note.trim())}
                loading={busyAction === action.id}
                icon={ActionIcon ? <ActionIcon size={15} /> : undefined}
                onClick={() => action.id !== 'reject' && onAction(action)}
              >
                {action.label}
              </Button>
            );
            return action.id === 'reject' ? (
              <Popconfirm
                key={action.id}
                title="确认退回修改？"
                description="已完成的结果会保留，相关工作将等待修改。"
                okText="确认退回"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                disabled={Boolean(busyAction) || (action.requiresNote && !note.trim())}
                onConfirm={() => onAction(action)}
              >
                {button}
              </Popconfirm>
            ) : button;
          })}
        </div>
        <LsBrandAction
          className="assistant-decision-card__action"
          loading={busyAction === primary.id}
          disabled={Boolean(busyAction) || (primary.requiresNote && !note.trim())}
          icon={actionIcon[primary.id] ? (() => {
            const PrimaryIcon = actionIcon[primary.id]!;
            return <PrimaryIcon size={15} />;
          })() : undefined}
          onClick={() => onAction(primary)}
        >
          {primary.label}
        </LsBrandAction>
      </footer>
    </article>
  );
}

export default function AssistantDecisionCenter({
  page,
  active = true,
  goalId,
  onOpenChat,
  onOpenDetail,
  onNavigate,
  onFeedChange,
  onActionResult,
  variant = 'detail',
  showHeading = true,
  className = '',
  client = assistantDecisionApi,
}: AssistantDecisionCenterProps) {
  const { message } = App.useApp();
  const [feed, setFeed] = useState<AssistantDecisionFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState<AssistantDecisionActionId | null>(null);
  const [startReconciliation, setStartReconciliation] = useState<StartReconciliation | null>(null);
  const cardRegion = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const actionPending = useRef(false);
  const reconciliationInFlight = useRef(false);
  const reconciliationAttempts = useRef(0);
  const mounted = useRef(true);
  const feedRef = useRef<AssistantDecisionFeed | null>(null);
  const first = useMemo(() => selectPrimaryDecision(feed), [feed]);

  const load = useCallback(async (signal?: AbortSignal, preserveError = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    if (!preserveError) setError('');
    try {
      const next = await client.feed({ page, goalId, signal });
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setFeed(next);
    } catch (reason) {
      if (signal?.aborted || sequence !== requestSequence.current || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      if (!preserveError) setError(reason instanceof Error ? reason.message : '待办加载失败，请重试');
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current) setLoading(false);
    }
  }, [client, goalId, page]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      requestSequence.current += 1;
      controller.abort();
      actionController.current?.abort();
    };
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const refreshAfterWeeklyWorkChange = (event: Event) => {
      const detail = (event as CustomEvent<WeeklyWorkUpdatedDetail>).detail;
      if (!detail?.goalId || (goalId && detail.goalId !== goalId)) return;
      // The action owner already holds the authoritative command response.
      // Other mounted summaries/details refresh from the persisted feed.
      if (detail.source === 'assistant' && actionPending.current) return;
      void load();
    };
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, refreshAfterWeeklyWorkChange);
    return () => window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, refreshAfterWeeklyWorkChange);
  }, [active, goalId, load]);

  useEffect(() => {
    if (!active || variant !== 'summary') return;
    const refreshVisibleFeed = () => {
      if (document.visibilityState === 'hidden' || actionPending.current) return;
      void load(undefined, true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshVisibleFeed();
    };
    const interval = window.setInterval(refreshVisibleFeed, 15_000);
    window.addEventListener('focus', refreshVisibleFeed);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisibleFeed);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active, load, variant]);

  useEffect(() => { setNote(''); }, [first?.id]);
  useEffect(() => { feedRef.current = feed; }, [feed]);
  useEffect(() => {
    if (feed) onFeedChange?.(feed);
  }, [feed, onFeedChange]);

  const reconcileWeeklyStart = useCallback(async (pending: StartReconciliation) => {
    if (reconciliationInFlight.current || Date.now() >= pending.deadline || reconciliationAttempts.current >= 8) {
      if (Date.now() >= pending.deadline || reconciliationAttempts.current >= 8) {
        setStartReconciliation(null);
        setError('启动结果仍未确认，请前往智能经营查看周任务状态；请勿重复提交。');
      }
      return;
    }
    reconciliationInFlight.current = true;
    reconciliationAttempts.current += 1;
    try {
      const overview = await digitalEmployeeApi.overview(pending.card.subject.id);
      if (!mounted.current) return;
      const run = overview.run;
      const execution = normalizeAssistantDecisionExecutionReceipt(run ? {
        goalId: run.goal_id,
        runId: run.id,
        status: run.status,
        taskCount: overview.tasks.filter(task => task.run_id === run.id).length,
        startedAt: run.started_at,
      } : undefined);
      if (!execution || execution.goalId !== pending.card.subject.id) {
        await load(undefined, true);
        return;
      }
      let latestFeed: AssistantDecisionFeed;
      try {
        latestFeed = await client.feed({ page, goalId });
      } catch {
        const current = feedRef.current;
        latestFeed = current ? {
          ...current,
          items: current.items.filter(item => item.id !== pending.card.id),
          total: Math.max(0, current.total - (current.items.some(item => item.id === pending.card.id) ? 1 : 0)),
          generatedAt: new Date().toISOString(),
        } : {
          items: [],
          total: 0,
          generatedAt: new Date().toISOString(),
          page: page as AssistantDecisionFeed['page'],
        };
      }
      if (!mounted.current) return;
      const response: AssistantDecisionActionResponse = {
        ...latestFeed,
        ok: true,
        outcome: 'completed',
        execution,
      };
      requestSequence.current += 1;
      setLoading(false);
      setFeed(latestFeed);
      setError('');
      setStartReconciliation(null);
      const feedback = assistantDecisionExecutionFeedback(execution);
      void message.open({
        key: `assistant-decision:${pending.card.id}`,
        type: feedback.kind,
        content: feedback.title,
        duration: feedback.kind === 'error' ? 6 : 4,
      });
      notifyWeeklyWorkUpdated({ source: 'assistant', goalId: execution.goalId, execution });
      onActionResult?.({ action: pending.action, card: pending.card, response });
    } catch {
      // The original action may still be committing. Keep the pending card and
      // bounded reconciliation active without replacing its uncertainty text.
    } finally {
      reconciliationInFlight.current = false;
    }
  }, [client, goalId, load, message, onActionResult, page]);

  useEffect(() => {
    if (!active || !startReconciliation) return;
    const reconcileIfVisible = () => {
      if (document.visibilityState === 'hidden' || actionPending.current) return;
      void reconcileWeeklyStart(startReconciliation);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') reconcileIfVisible();
    };
    const firstCheck = window.setTimeout(reconcileIfVisible, 0);
    const interval = window.setInterval(reconcileIfVisible, 15_000);
    window.addEventListener('focus', reconcileIfVisible);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
      window.removeEventListener('focus', reconcileIfVisible);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active, reconcileWeeklyStart, startReconciliation]);

  const act = useCallback(async (action: AssistantDecisionAction) => {
    if (!first || actionPending.current || startReconciliation) return;
    actionPending.current = true;
    requestSequence.current += 1;
    setLoading(false);
    const controller = new AbortController();
    actionController.current = controller;
    setError('');
    setBusyAction(action.id);
    const feedbackKey = `assistant-decision:${first.id}`;
    if (action.id === 'approve_and_start') {
      void message.loading({ key: feedbackKey, content: '正在核验计划并创建本周任务…', duration: 0 });
    }
    try {
      const next = await client.execute({
        cardId: first.id,
        actionId: action.id,
        expectedVersion: first.subject.version,
        page,
        goalId,
        note,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (action.id === 'approve_and_start'
        && (!next.execution || next.execution.goalId !== first.subject.id)) {
        throw new AssistantDecisionApiError(
          '启动结果尚未确认，请刷新查看真实运行状态',
          502,
          'plan_start_unconfirmed',
        );
      }
      requestSequence.current += 1;
      setLoading(false);
      setFeed(next);
      setNote('');
      if (action.mode === 'navigate' || next.outcome === 'navigation_required') {
        onNavigate?.(first.deepLink);
        dispatchDeepLink(first.deepLink);
      } else {
        if (action.id === 'approve_and_start' && next.execution) {
          const feedback = assistantDecisionExecutionFeedback(next.execution);
          void message.open({ key: feedbackKey, type: feedback.kind, content: feedback.title, duration: feedback.kind === 'error' ? 6 : 4 });
          notifyWeeklyWorkUpdated({ source: 'assistant', goalId: next.execution.goalId, execution: next.execution });
        } else {
          void message.success(next.outcome === 'already_completed' ? '这项待办已经处理' : '已完成，正在显示下一项');
        }
        onActionResult?.({ action, card: first, response: next });
        window.requestAnimationFrame(() => cardRegion.current?.focus());
      }
    } catch (reason) {
      if (controller.signal.aborted) {
        if (action.id === 'approve_and_start') message.destroy(feedbackKey);
        return;
      }
      const staleDecision = reason instanceof AssistantDecisionApiError
        && reason.status === 409
        && STALE_DECISION_CODES.has(reason.code);
      if (staleDecision) {
        void message.info(reason.message);
        await load();
      } else {
        const failure = reason instanceof Error ? reason.message : '操作失败，请重试';
        const shouldReconcile = action.id === 'approve_and_start'
          && (reason instanceof TypeError
            || (reason instanceof AssistantDecisionApiError
              && (reason.status >= 500
                || reason.code === 'decision_timeout'
                || reason.code === 'plan_start_unconfirmed')));
        const visibleFailure = shouldReconcile
          ? `${failure}；结果尚未确认，正在核对真实运行状态，请勿重复提交。`
          : failure;
        setError(visibleFailure);
        if (action.id === 'approve_and_start') {
          void message.open({
            key: feedbackKey,
            type: shouldReconcile ? 'warning' : 'error',
            content: visibleFailure,
            duration: shouldReconcile ? 5 : 6,
          });
        }
        if (shouldReconcile) {
          reconciliationAttempts.current = 0;
          setStartReconciliation({ card: first, action, deadline: Date.now() + 120_000 });
        }
        if (reason instanceof AssistantDecisionApiError && reason.status === 409) {
          await load(undefined, true);
        }
      }
    } finally {
      actionPending.current = false;
      if (!controller.signal.aborted) setBusyAction(null);
    }
  }, [client, first, goalId, load, message, note, onActionResult, onNavigate, page, startReconciliation]);

  if (variant === 'summary') {
    if (!first && !error) return null;
    return (
      <section
        className={`assistant-decision-center assistant-decision-center--summary ${className}`.trim()}
        aria-label="待你决定"
        data-assistant-decision-variant="summary"
      >
        {error ? (
          <Alert
            className="assistant-decision-center__error assistant-decision-center__error--summary"
            type="error"
            showIcon
            message={error}
            action={<Button disabled={loading} onClick={() => void load()} icon={<RefreshCw size={14} />}>重新加载</Button>}
          />
        ) : first ? (
          <DecisionSummary card={first} total={feed?.total || 1} onOpenDetail={onOpenDetail} />
        ) : null}
      </section>
    );
  }

  return (
    <section
      className={`assistant-decision-center ${className}`.trim()}
      aria-labelledby={showHeading ? 'assistant-decision-center-title' : undefined}
      aria-label={showHeading ? undefined : '待你决定详情'}
      data-assistant-decision-variant="detail"
    >
      {showHeading ? (
        <div className="assistant-decision-center__title-row">
          <h2 id="assistant-decision-center-title">待你决定</h2>
          {feed?.total ? <span aria-label={`共有 ${feed.total} 项待办`}>{feed.total}</span> : null}
        </div>
      ) : null}

      {error ? (
        <Alert
          className="assistant-decision-center__error"
          type="error"
          showIcon
          message={error}
          action={<Button disabled={loading || Boolean(busyAction)} onClick={() => void load()} icon={<RefreshCw size={14} />}>重新加载</Button>}
        />
      ) : null}

      <div ref={cardRegion} tabIndex={-1} className="assistant-decision-center__card-region" aria-live="polite">
        {loading && !feed ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
        {first ? (
          <DecisionCard
            card={first}
            total={feed?.total || 1}
            busyAction={busyAction || ((loading || startReconciliation) ? first.actions[0].id : null)}
            note={note}
            onNoteChange={setNote}
            onAction={action => void act(action)}
          />
        ) : null}
        {!loading && !first && !error ? (
          <div className="assistant-decision-center__empty">
            <CheckCircle2 size={24} aria-hidden="true" />
            <h3>当前没有需要审批的事项</h3>
            <Button className="assistant-decision-card__action" icon={<MessageCircle size={16} />} onClick={onOpenChat}>问灵小枢</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
