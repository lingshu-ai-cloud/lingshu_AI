import { MessageCircleQuestion, Zap } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import {
  assistantQuickEntriesForPage,
  type AssistantQuickExecution,
  type AssistantQuickQuestion,
} from '../../lib/assistantQuickEntries';

type Props = {
  page: Page;
  disabled?: boolean;
  executions?: readonly AssistantQuickExecution[];
  onQuestion: (entry: AssistantQuickQuestion) => void;
  onExecute: (entry: AssistantQuickExecution) => void;
};

/** Mixed page-specific questions and executions shown directly above the composer. */
export default function AssistantQuickEntries({ page, disabled = false, executions = [], onQuestion, onExecute }: Props) {
  const entries = [...assistantQuickEntriesForPage(page), ...executions];
  if (!entries.length) return null;

  return (
    <div
      className="shrink-0 border-t border-border/60 bg-surface px-3 pb-2 pt-2"
      data-assistant-surface="page-quick-entries"
      data-assistant-page={page}
      role="group"
      aria-label="当前页面快捷问答与执行"
    >
      <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              onClick={() => execution ? onExecute(entry) : onQuestion(entry)}
              className={`ls-type-label-medium inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${execution
                ? 'border-accent/35 bg-accent/10 font-semibold text-accent hover:border-accent/60 hover:bg-accent/15'
                : 'border-border bg-surface-2 text-text-secondary hover:border-accent/30 hover:text-text-primary'}`}
              aria-label={`${execution ? entry.operation === 'open' || entry.id === 'business-create-week-plan' ? '查看任务' : '快捷执行' : '快捷提问'}：${entry.label}`}
              title={execution ? entry.disabledReason || (entry.confirmation !== 'none' ? '执行前会展示确认信息' : undefined) : undefined}
            >
              {execution ? <Zap size={12} aria-hidden="true" /> : <MessageCircleQuestion size={12} aria-hidden="true" />}
              <span>{entry.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
