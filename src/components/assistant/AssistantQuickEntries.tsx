import { ArrowRight, MessageCircleQuestion, Zap } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import { WEEKLY_ACTION_LABELS } from './AssistantWeeklyActions';
import type { WeeklyAssistantAction } from '../../lib/assistantWeeklyActionsApi';
import {
  assistantQuickEntriesForPage,
  type AssistantQuickExecution,
  type AssistantQuickQuestion,
} from '../../lib/assistantQuickEntries';

type Props = {
  page: Page;
  disabled?: boolean;
  emptyConversation?: boolean;
  executions?: readonly AssistantQuickExecution[];
  onQuestion: (entry: AssistantQuickQuestion) => void;
  onExecute: (entry: AssistantQuickExecution) => void;
  weeklyActions?: readonly WeeklyAssistantAction[];
  onWeeklyAction?: (action: WeeklyAssistantAction) => void;
};

/** Mixed page-specific questions and executions shown directly above the composer. */
export default function AssistantQuickEntries({ page, disabled = false, emptyConversation = false, executions = [], onQuestion, onExecute, weeklyActions = [], onWeeklyAction }: Props) {
  const entries = [...assistantQuickEntriesForPage(page), ...executions];
  if (!entries.length && !weeklyActions.length) return null;

  return (
    <div
      className="ls-assistant-quick-entries shrink-0 border-t border-border/60 px-3 pb-2 pt-2"
      data-assistant-surface="page-quick-entries"
      data-assistant-page={page}
      data-empty-conversation={emptyConversation ? 'true' : undefined}
      role="group"
      aria-label="当前页面快捷问答与执行"
    >
      <div className="ls-assistant-quick-entries__list flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-empty-conversation={emptyConversation ? 'true' : undefined}>
        {entries.map(entry => {
          const execution = entry.kind === 'execute';
          return (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              data-assistant-quick-kind={entry.kind}
              data-assistant-quick-id={entry.id}
              data-assistant-confirmation={execution ? entry.confirmation : undefined}
              data-empty-conversation={emptyConversation ? 'true' : undefined}
              onClick={() => execution ? onExecute(entry) : onQuestion(entry)}
              className={`ls-assistant-quick-entry ls-type-label-medium inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${execution
                ? 'border-accent/35 bg-accent/10 font-semibold text-accent hover:border-accent/60 hover:bg-accent/15'
                : 'border-border bg-surface-2 text-text-secondary hover:border-accent/30 hover:text-text-primary'}`}
              aria-label={`${execution ? entry.operation === 'open' || entry.id === 'business-create-week-plan' ? '查看任务' : '快捷执行' : '快捷提问'}：${entry.label}`}
              title={execution ? entry.disabledReason || (entry.confirmation !== 'none' ? '执行前会展示确认信息' : undefined) : undefined}
            >
              {execution ? <Zap size={12} aria-hidden="true" /> : <MessageCircleQuestion size={12} aria-hidden="true" />}
              <span>{entry.label}</span>
              {emptyConversation && <ArrowRight className="ls-assistant-quick-entry__arrow" size={15} aria-hidden="true" />}
            </button>
          );
        })}
        {weeklyActions.map(action => <button key={`weekly-${action}`} type="button" disabled={disabled} data-assistant-quick-kind="execute" data-assistant-quick-id={`weekly-${action}`} onClick={() => onWeeklyAction?.(action)} className="ls-assistant-quick-entry ls-type-label-medium inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-accent/35 bg-accent/10 px-3 py-1.5 text-left font-semibold text-accent transition-colors hover:border-accent/60 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label={`快捷执行：${WEEKLY_ACTION_LABELS[action]}`}><Zap size={12} aria-hidden="true"/><span>{WEEKLY_ACTION_LABELS[action]}</span></button>)}
      </div>
    </div>
  );
}
