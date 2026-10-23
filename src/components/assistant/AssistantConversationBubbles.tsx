import type { ReactNode } from 'react';
import { Button } from 'antd';
import { ArrowRight, Bot, CalendarRange, Loader2 } from 'lucide-react';
import type { AgentAction, Message, Page } from '../../App';
import type { AssistantProductionContext } from '../../lib/assistantProductionDecision';
import type { AssistantTaskCard } from '../../stores/assistantStore';
import type { AssistantDecisionFeed } from '../../../shared/contracts/assistantDecisionCenter';
import { assistantWantsDetailedReply } from '../../../shared/assistantReadableReply';
import AgentReply from '../AgentReply';
import AssistantDecisionCenter from './AssistantDecisionCenter';
import { taskStatusLabel } from './AssistantDecisionDialog';
import { assistantBubbleStyle } from './globalAssistantRuntime';

interface Props {
  inlineHome?: boolean;
  page: Page;
  goalId?: string;
  productionContext: AssistantProductionContext | null;
  decisionFeedRevision: number;
  decisionFeedKey: string;
  decisionFeedActive: boolean;
  onOpenChat: () => void;
  onOpenFeedDetail: (trigger?: HTMLButtonElement | null) => void;
  onFeedChange: (feed: AssistantDecisionFeed) => void;
  welcomeBubbleVisible: boolean;
  activeAgentLabel: string;
  messages: Message[];
  onAction?: AgentAction;
  onSuggest: (suggestion: string) => void;
  contentIntakeNode: ReactNode;
  loading: boolean;
  focusedTaskCard: AssistantTaskCard | null;
  onOpenTaskDetail: (trigger: HTMLButtonElement, taskId: string) => void;
  weeklyPlanKickoffAvailable: boolean;
  onOpenWeeklyPlan: () => void;
}

/** The conversation's visual sequence; all mutations remain in the parent. */
export default function AssistantConversationBubbles(props: Props) {
  const { inlineHome, page, goalId, productionContext, decisionFeedRevision, decisionFeedKey,
    decisionFeedActive, onOpenChat, onOpenFeedDetail, onFeedChange,
    welcomeBubbleVisible, activeAgentLabel, messages, onAction, onSuggest,
    contentIntakeNode, loading, focusedTaskCard, onOpenTaskDetail,
    weeklyPlanKickoffAvailable, onOpenWeeklyPlan } = props;
  return (
    <div className="space-y-4">
      {!inlineHome && <div key={`decision-feed-${decisionFeedRevision}`}
        className="ls-assistant-summary-bubble-enter pl-9"
        data-assistant-bubble="decision-summary" data-assistant-summary="decision-feed"
        style={assistantBubbleStyle(0)}>
        <AssistantDecisionCenter
          page={page} goalId={goalId} productionContext={productionContext}
          key={decisionFeedKey} active={decisionFeedActive}
          onOpenChat={onOpenChat} onOpenDetail={onOpenFeedDetail}
          onFeedChange={onFeedChange} variant="summary"
        />
      </div>}

      {welcomeBubbleVisible && !inlineHome && !messages.length && (
        <div data-assistant-bubble="welcome"
          className="ls-assistant-bubble-enter flex items-start gap-2"
          style={assistantBubbleStyle(0)}>
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>
          <div className="ls-messenger-bubble ls-messenger-bubble--inbound">
            <p className="font-semibold text-text-primary">我是{activeAgentLabel}</p>
            <p className="mt-1 text-text-secondary">我会结合当前页面上下文继续帮你处理。</p>
          </div>
        </div>
      )}

      {messages.map((msg, index) => (
        <div key={`${msg.role}-${index}`} data-assistant-bubble={msg.role}
          className={`ls-assistant-bubble-enter flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}
          style={assistantBubbleStyle(index + (welcomeBubbleVisible ? 1 : 0))}>
          {msg.role === 'assistant' && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>}
          <div className={msg.role === 'user'
            ? 'ls-messenger-bubble ls-messenger-bubble--outbound whitespace-pre-line'
            : 'ls-messenger-bubble ls-messenger-bubble--inbound'}>
            {msg.role === 'assistant'
              ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction}
                detailExpanded={assistantWantsDetailedReply(messages.slice(0, index).reverse().find(message => message.role === 'user')?.content || '')}
                onSuggest={onSuggest} /> : <span className="opacity-40">...</span>)
              : msg.content}
          </div>
        </div>
      ))}

      {contentIntakeNode}

      {loading && (
        <div data-assistant-bubble="loading" className="ls-assistant-bubble-enter flex gap-2"
          style={assistantBubbleStyle(messages.length + (welcomeBubbleVisible ? 1 : 0))}>
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Loader2 size={13} className="motion-safe:animate-spin" /></div>
          <div className="ls-messenger-bubble ls-messenger-bubble--inbound text-text-muted">思考中...</div>
        </div>
      )}

      {focusedTaskCard && (
        <div key={`task-${focusedTaskCard.taskId}`}
          className="ls-assistant-summary-bubble-enter flex items-start gap-2"
          data-assistant-bubble="task-summary" data-assistant-summary="task-card"
          style={assistantBubbleStyle(messages.length + (welcomeBubbleVisible ? 2 : 1))}>
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>
          <button type="button" className="assistant-decision-summary min-w-0 flex-1"
            onClick={event => onOpenTaskDetail(event.currentTarget, focusedTaskCard.taskId)}
            aria-label={`查看任务详情：${focusedTaskCard.title}`}>
            <span className="assistant-decision-summary__icon" aria-hidden="true"><Bot size={18} /></span>
            <span className="assistant-decision-summary__content">
              <span className="assistant-decision-summary__eyebrow">
                <span>{focusedTaskCard.status === 'approval' || focusedTaskCard.status === 'needs_input' ? '待你决定' : '灵小枢已整理'}</span>
                <span>{taskStatusLabel(focusedTaskCard)}</span>
              </span>
              <strong>{focusedTaskCard.title}</strong>
              <span className="assistant-decision-summary__description">{focusedTaskCard.conclusion}</span>
            </span>
            <ArrowRight className="assistant-decision-summary__arrow" size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {weeklyPlanKickoffAvailable && !inlineHome && (
        <div className="ls-assistant-summary-bubble-enter flex items-start gap-2"
          data-assistant-bubble="weekly-plan-kickoff"
          style={assistantBubbleStyle(messages.length + (welcomeBubbleVisible ? 3 : 2))}>
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>
          <div className="ls-messenger-bubble ls-messenger-bubble--inbound min-w-0 flex-1">
            <p className="font-semibold text-text-primary">先制定本周计划</p>
            <p className="mt-1 text-text-secondary">我会先整理本周目标、平台、产量、预算和排期给你预览。你确认后，数字员工才会开始生产。</p>
            <Button type="primary" className="mt-3" icon={<CalendarRange size={14} />}
              onClick={onOpenWeeklyPlan}>制定周计划</Button>
          </div>
        </div>
      )}
    </div>
  );
}
