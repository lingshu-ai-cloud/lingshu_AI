import type { AssistantTaskCard } from '../stores/assistantStore';

// Older clients persisted this guardrail notice as if it were a real task.
// Hide only that exact unbound notice, never genuine approvals or failures.
export function isLegacyUnboundOperationNotice(card: AssistantTaskCard | null | undefined): boolean {
  return Boolean(card && card.title === '这次操作尚未执行'
    && !card.workspace && !card.primaryAction && !card.secondaryActions?.length
    && /无法安全绑定到唯一的任务和版本|没有可执行这项操作的任务卡/.test(card.conclusion));
}

export function isUnboundOperationError(code?: string): boolean {
  return code === 'assistant_mutation_requires_signed_action'
    || code === 'assistant_mutation_not_supported';
}
