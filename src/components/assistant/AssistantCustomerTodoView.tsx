import { CheckCircle2 } from 'lucide-react';
import type { AssistantTodoItem } from './globalAssistantRuntime';

function todoToneClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'border-green/20 bg-green/5 text-green';
  if (tone === 'red') return 'border-red/20 bg-red/5 text-red';
  if (tone === 'amber') return 'border-amber/20 bg-amber-dim text-amber';
  if (tone === 'blue') return 'border-accent/20 bg-accent-glow text-accent';
  return 'border-border bg-surface text-text-secondary';
}

function todoDotClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'bg-green';
  if (tone === 'red') return 'bg-red';
  if (tone === 'amber') return 'bg-amber';
  if (tone === 'blue') return 'bg-accent';
  return 'bg-border-bright';
}

export default function AssistantCustomerTodoView({ items, pendingCount, onBack, onSelect }: {
  items: AssistantTodoItem[];
  pendingCount: number;
  onBack: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="space-y-3">
        <div className="border-l-2 border-amber bg-amber-dim p-4">
          <p className="ls-type-title-small text-text-primary">今日待办（{pendingCount}）</p>
          <p className="ls-type-body-medium mt-2 text-text-secondary">
            {pendingCount > 0 ? '需要你处理和确认的客户已按优先级排好。' : '今天的待办已处理完。'}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="btn-primary ls-type-label-medium mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            客户助手
          </button>
        </div>

        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${todoToneClass(item.tone, item.completed)}`}
              >
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${todoDotClass(item.tone, item.completed)}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="ls-type-title-small truncate text-text-primary">{item.name}</span>
                    {item.completed && (
                      <span className="ls-type-label-medium inline-flex shrink-0 items-center gap-1 border-l-2 border-green bg-green/5 px-2 py-0.5 text-green">
                        <CheckCircle2 size={11} /> 已完成
                      </span>
                    )}
                  </span>
                  <span className="ls-type-label-medium mt-1 block truncate opacity-80">{item.headline}</span>
                  <span className="ls-type-body-small mt-1 block line-clamp-2 text-text-secondary">{item.reason}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ls-type-body-small rounded-lg border border-border bg-surface-2 px-3 py-4 text-center text-text-muted">
            暂无今日待办
          </div>
        )}
      </div>
    </div>
  );
}
