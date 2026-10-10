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
  type AssistantDecisionCard,
  type AssistantDecisionDeepLink,
  type AssistantDecisionFeed,
  type AssistantDecisionKind,
} from '../../lib/assistantDecisionApi';
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

export type AssistantDecisionCenterProps = {
  page: string;
  active?: boolean;
  goalId?: string;
  onOpenChat: () => void;
  onOpenDetail?: () => void;
  onFeedChange?: (feed: AssistantDecisionFeed) => void;
  variant?: AssistantDecisionCenterVariant;
  className?: string;
  client?: AssistantDecisionClient;
};

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
  onOpenDetail?: () => void;
}) {
  const Icon = kindMeta[card.kind].icon;
  const title = assistantDecisionSummaryTitle(card);
  return (
    <button
      type="button"
      className="assistant-decision-summary"
      onClick={onOpenDetail}
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
  onFeedChange,
  variant = 'detail',
  className = '',
  client = assistantDecisionApi,
}: AssistantDecisionCenterProps) {
  const { message } = App.useApp();
  const [feed, setFeed] = useState<AssistantDecisionFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState<AssistantDecisionActionId | null>(null);
  const cardRegion = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const actionPending = useRef(false);
  const first = useMemo(() => selectPrimaryDecision(feed), [feed]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const next = await client.feed({ page, goalId, signal });
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setFeed(next);
    } catch (reason) {
      if (signal?.aborted || sequence !== requestSequence.current || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      setError(reason instanceof Error ? reason.message : '待办加载失败，请重试');
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current) setLoading(false);
    }
  }, [client, goalId, page]);

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

  useEffect(() => { setNote(''); }, [first?.id]);
  useEffect(() => {
    if (feed) onFeedChange?.(feed);
  }, [feed, onFeedChange]);

  const act = useCallback(async (action: AssistantDecisionAction) => {
    if (!first || actionPending.current) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setError('');
    setBusyAction(action.id);
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
      setFeed(next);
      setNote('');
      if (action.mode === 'navigate' || next.outcome === 'navigation_required') dispatchDeepLink(first.deepLink);
      else void message.success(next.outcome === 'already_completed' ? '这项待办已经处理' : '已完成，正在显示下一项');
      window.requestAnimationFrame(() => cardRegion.current?.focus());
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof AssistantDecisionApiError && reason.status === 409) {
        void message.info(reason.message);
        await load();
      } else {
        setError(reason instanceof Error ? reason.message : '操作失败，请重试');
      }
    } finally {
      actionPending.current = false;
      if (!controller.signal.aborted) setBusyAction(null);
    }
  }, [busyAction, client, first, goalId, load, message, note, page]);

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
      aria-labelledby="assistant-decision-center-title"
      data-assistant-decision-variant="detail"
    >
      <div className="assistant-decision-center__title-row">
        <h2 id="assistant-decision-center-title">待你决定</h2>
        {feed?.total ? <span aria-label={`共有 ${feed.total} 项待办`}>{feed.total}</span> : null}
      </div>

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
            busyAction={busyAction || (loading ? first.actions[0].id : null)}
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
