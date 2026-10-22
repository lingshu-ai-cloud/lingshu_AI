import { useCallback, useRef, useState } from 'react';
import type { AssistantDecisionDeepLink, AssistantDecisionFeed } from '../../../shared/contracts/assistantDecisionCenter';
import { assistantDecisionExecutionFeedback, type AssistantDecisionActionResult } from './AssistantDecisionCenter';
import type { AssistantDecisionDialog as AssistantDecisionDialogState } from './AssistantDecisionDialog';
import { PRIMARY_ASSISTANT_THREAD } from './globalAssistantRuntime';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';

type StoreActions = ReturnType<typeof useAssistantStore.getState>;
type DecisionDialogInput = {
  launcherButtonRef: { current: HTMLAnchorElement | HTMLButtonElement | null };
  setMessages: StoreActions['setMessages'];
  setFollowingLatest: StoreActions['setFollowingLatest'];
  persistThread: (agent: OrbitAgentId) => void;
  onSessionRefresh?: () => void;
};

/** Owns external decision detail state, one-time receipts, and focus restoration. */
export function useAssistantDecisionDialog(input: DecisionDialogInput) {
  const { launcherButtonRef, setMessages, setFollowingLatest, persistThread, onSessionRefresh } = input;
  const [decisionDialog, setDecisionDialog] = useState<AssistantDecisionDialogState>(null);
  const [decisionFeedRevision, setDecisionFeedRevision] = useState(0);
  const [decisionTotal, setDecisionTotal] = useState<number | null>(null);
  const decisionDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const decisionDialogKindRef = useRef<Exclude<AssistantDecisionDialogState, null>['kind'] | null>(null);
  const decisionDialogRestoreFocusRef = useRef(true);
  const handledDecisionResultsRef = useRef(new Set<string>());

  const handleDecisionFeedChange = useCallback((feed: AssistantDecisionFeed) => {
    setDecisionTotal(Math.max(0, feed.total));
  }, []);

  const openDecisionDialog = useCallback((
    dialog: Exclude<AssistantDecisionDialogState, null>,
    trigger?: HTMLButtonElement | null,
  ) => {
    decisionDialogTriggerRef.current = trigger ?? null;
    decisionDialogKindRef.current = dialog.kind;
    decisionDialogRestoreFocusRef.current = true;
    setDecisionDialog(dialog);
  }, []);

  const closeDecisionDialog = useCallback(() => {
    decisionDialogRestoreFocusRef.current = true;
    setDecisionDialog(null);
    // Refresh only after closing, avoiding a duplicate authoritative detail request.
    setDecisionFeedRevision(revision => revision + 1);
  }, []);

  const closeDecisionDialogForNavigation = useCallback((_link?: AssistantDecisionDeepLink) => {
    // Navigation replaces the trigger's page context; do not steal focus back.
    decisionDialogRestoreFocusRef.current = false;
    setDecisionDialog(null);
  }, []);

  const handleDecisionDialogFeedChange = useCallback((feed: AssistantDecisionFeed) => {
    handleDecisionFeedChange(feed);
  }, [handleDecisionFeedChange]);

  const handleDecisionActionResult = useCallback((result: AssistantDecisionActionResult) => {
    if (result.action.id !== 'approve_and_start' || !result.response.execution) return;
    const execution = result.response.execution;
    if (execution.goalId !== result.card.subject.id) return;
    const resultKey = `${execution.runId}:${execution.status}`;
    if (handledDecisionResultsRef.current.has(resultKey)) return;
    handledDecisionResultsRef.current.add(resultKey);
    const feedback = assistantDecisionExecutionFeedback(execution);
    const current = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
    setMessages(PRIMARY_ASSISTANT_THREAD, [
      ...current,
      { role: 'assistant', content: `**${feedback.title}**\n\n${feedback.detail}` },
    ]);
    setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
    setDecisionTotal(Math.max(0, result.response.total));
    closeDecisionDialog();
    persistThread(PRIMARY_ASSISTANT_THREAD);
    onSessionRefresh?.();
  }, [closeDecisionDialog, onSessionRefresh, persistThread, setFollowingLatest, setMessages]);

  const restoreDecisionDialogFocus = useCallback(() => {
    const shouldRestoreFocus = decisionDialogRestoreFocusRef.current;
    const originalTrigger = decisionDialogTriggerRef.current;
    const triggerKind = decisionDialogKindRef.current;
    decisionDialogRestoreFocusRef.current = true;
    decisionDialogTriggerRef.current = null;
    decisionDialogKindRef.current = null;
    if (!shouldRestoreFocus) return;
    window.requestAnimationFrame(() => {
      if (originalTrigger?.isConnected) {
        originalTrigger.focus();
        return;
      }
      // Closing refreshes the summary, so focus its current semantic peer.
      const summaryScope = triggerKind === 'feed'
        ? '[data-assistant-summary="decision-feed"]'
        : '[data-assistant-summary="task-card"]';
      const replacement = document.querySelector<HTMLButtonElement>(
        `#global-assistant-panel ${summaryScope} .assistant-decision-summary`,
      );
      if (replacement) replacement.focus();
      else if (document.getElementById('global-assistant-panel')) document.getElementById('global-assistant-panel')?.focus();
      else launcherButtonRef.current?.focus();
    });
  }, [launcherButtonRef]);

  return {
    decisionDialog, setDecisionDialog, decisionFeedRevision, setDecisionFeedRevision,
    decisionTotal, setDecisionTotal, decisionDialogRestoreFocusRef,
    handleDecisionFeedChange, openDecisionDialog, closeDecisionDialog,
    closeDecisionDialogForNavigation, handleDecisionDialogFeedChange,
    handleDecisionActionResult, restoreDecisionDialogFocus,
  };
}
