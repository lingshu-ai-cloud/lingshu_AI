import type { AssistantActionId } from '../../shared/contracts/assistantActions';
import type { Page } from '../pageRegistry';

/** Product surfaces included in the first desktop quick-entry rollout. */
export const ASSISTANT_QUICK_ENTRY_PAGES = [
  'digitalEmployees',
  'socialInspiration',
  'smartAssets',
  'traffic',
  'conversion',
  'enterprise',
  'plugins',
] as const satisfies readonly Page[];

export type AssistantQuickEntryPage = typeof ASSISTANT_QUICK_ENTRY_PAGES[number];
export type AssistantQuickEntryKind = 'question' | 'execution';
export type AssistantExecutionConfirmation = 'none' | 'summary' | 'double';
export type AssistantAnswerSource = 'page_context' | 'enterprise_knowledge' | 'external_search';

export type AssistantQuickEntry = {
  id: string;
  pageId: AssistantQuickEntryPage;
  label: string;
  kind: AssistantQuickEntryKind;
  prompt: string;
  /** Questions are sent to the answer pipeline; execution uses a signed action. */
  actionId?: AssistantActionId;
  confirmationTier: AssistantExecutionConfirmation;
  /** Mutation entries must materialize in the real weekly calendar. */
  createsWeeklyTask: boolean;
  /** Existing product destination; never a synthetic assistant-only page. */
  productionPage?: Page;
};

export type AssistantDecisionItem = {
  id: string;
  title: string;
  status: 'needs_input' | 'approval_required' | 'blocked';
  href?: string;
};

export type AssistantPageQuickEntryConfig = {
  pageId: AssistantQuickEntryPage;
  entries: readonly AssistantQuickEntry[];
};

export type AssistantAnswerContext = {
  page: AssistantQuickEntryPage;
  pageContext: Record<string, unknown>;
  internalKnowledge: readonly { id: string; title: string; excerpt: string }[];
  externalSearch: {
    enabled: boolean;
    reason?: 'trend' | 'market' | 'platform_policy' | 'competitor' | 'fresh_fact';
    query?: string;
  };
  sourcePriority: readonly AssistantAnswerSource[];
};

export const ASSISTANT_ANSWER_SOURCE_PRIORITY = [
  'page_context',
  'enterprise_knowledge',
  'external_search',
] as const satisfies readonly AssistantAnswerSource[];

/** External retrieval augments timely facts; it never overrides enterprise facts. */
export function buildAssistantAnswerContext(input: Omit<AssistantAnswerContext, 'sourcePriority'>): AssistantAnswerContext {
  return { ...input, sourcePriority: ASSISTANT_ANSWER_SOURCE_PRIORITY };
}
/** No real decision means no card and no empty placeholder. */
export function visibleAssistantDecision(items: readonly AssistantDecisionItem[]): AssistantDecisionItem | null {
  return items.find(item => item.status === 'needs_input' || item.status === 'approval_required' || item.status === 'blocked') ?? null;
}

export function validateAssistantQuickEntryConfig(config: AssistantPageQuickEntryConfig): string[] {
  const errors: string[] = [];
  if (config.entries.length < 4 || config.entries.length > 5) errors.push('entry_count');
  const executions = config.entries.filter(entry => entry.kind === 'execution');
  if (executions.length < 2 || executions.length > 3) errors.push('execution_count');
  if (new Set(config.entries.map(entry => entry.id)).size !== config.entries.length) errors.push('duplicate_id');
  for (const entry of config.entries) {
    if (!entry.id.trim() || !entry.label.trim() || !entry.prompt.trim()) errors.push(`empty:${entry.id}`);
    if (entry.kind === 'question') {
      if (entry.pageId !== config.pageId) errors.push(`page_mismatch:${entry.id}`);
      if (entry.actionId || entry.confirmationTier !== 'none' || entry.createsWeeklyTask) errors.push(`question_contract:${entry.id}`);
      continue;
    }
    if (entry.pageId !== config.pageId) errors.push(`page_mismatch:${entry.id}`);
    if (entry.actionId !== 'start_task') errors.push(`execution_action:${entry.id}`);
    if (entry.confirmationTier === 'none') errors.push(`execution_confirmation:${entry.id}`);
    if (!entry.createsWeeklyTask || !entry.productionPage) errors.push(`execution_pipeline:${entry.id}`);
  }
  return errors;
}
