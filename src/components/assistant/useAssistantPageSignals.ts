import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Page } from '../../App';
import { assistantDecisionApi } from '../../lib/assistantDecisionApi';
import { WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import { contextIdentifier, DEFAULT_CONTEXT, pageKey, type AssistantContext } from './globalAssistantRuntime';

/** Only the visible page may replace the assistant's live business context. */
export function useAssistantPageContextSignal(
  page: Page,
  setLiveContext: Dispatch<SetStateAction<AssistantContext | null>>,
): void {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AssistantContext>>).detail;
      if (!detail?.agent || !detail.label || !detail.summary) return;
      // Activity keeps visited pages mounted. Every emitter must identify its
      // page so a hidden page can never replace the active business context.
      const sourcePage = contextIdentifier(detail.sourcePage, 80);
      if (!sourcePage || sourcePage !== pageKey(page)) return;
      setLiveContext({
        agent: detail.agent,
        label: detail.label,
        summary: detail.summary,
        suggestions: detail.suggestions?.length ? detail.suggestions : DEFAULT_CONTEXT[pageKey(page)]?.suggestions ?? DEFAULT_CONTEXT.strategy.suggestions,
        pendingCount: typeof detail.pendingCount === 'number' ? detail.pendingCount : undefined,
        todoItems: Array.isArray(detail.todoItems) ? detail.todoItems : undefined,
        sourcePage,
        goalId: contextIdentifier(detail.goalId),
        planId: contextIdentifier(detail.planId),
        runId: contextIdentifier(detail.runId),
        taskId: contextIdentifier(detail.taskId),
        contentId: contextIdentifier(detail.contentId),
        viewKey: contextIdentifier(detail.viewKey, 80),
        workflowStage: detail.workflowStage,
      });
    };
    window.addEventListener('lingshu-assistant-context', handler);
    return () => window.removeEventListener('lingshu-assistant-context', handler);
  }, [page, setLiveContext]);
}

/** Keep the launcher badge fresh while closed without polling execution logs. */
export function useAssistantDecisionCount(input: {
  mode: 'breathing' | 'chat';
  page: Page;
  goalId?: string;
  persistenceScopeKey: string;
  suppressForRightSidebar: boolean;
  setDecisionTotal: Dispatch<SetStateAction<number | null>>;
}): void {
  const { mode, page, goalId, persistenceScopeKey, suppressForRightSidebar, setDecisionTotal } = input;
  useEffect(() => {
    if (mode === 'chat' || suppressForRightSidebar) return;
    let controller: AbortController | null = null;
    let disposed = false;
    const refreshDecisionCount = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      void assistantDecisionApi.feed({
        page,
        goalId,
        signal: controller.signal,
      }).then(feed => {
        if (!disposed) setDecisionTotal(Math.max(0, feed.total));
      }).catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // The launcher keeps the last verified count. Errors are shown only
        // when the user opens the decision surface; no execution log is emitted.
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshDecisionCount();
    };
    const refreshAfterWeeklyWorkChange = () => refreshDecisionCount();
    refreshDecisionCount();
    const interval = window.setInterval(refreshDecisionCount, 30_000);
    window.addEventListener('focus', refreshDecisionCount);
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, refreshAfterWeeklyWorkChange);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshDecisionCount);
      window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, refreshAfterWeeklyWorkChange);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [mode, page, goalId, persistenceScopeKey, suppressForRightSidebar, setDecisionTotal]);
}
