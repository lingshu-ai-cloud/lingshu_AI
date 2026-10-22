import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Page } from '../../App';
import { executeAssistantAction } from '../../lib/assistantActionRequest';
import { type AssistantTaskCard, type OrbitAgentId } from '../../stores/assistantStore';
import type { AssistantActionRequest, AssistantActionResponse } from '../../../shared/contracts/assistantActions';
import type { assistantRunControl } from '../../stores/assistantStore';
import type { useAssistantSend } from './useAssistantSend';

type TaskCardActionInput = {
  activeAgent: OrbitAgentId;
  currentPageAgent: OrbitAgentId;
  page: Page;
  focusedRunControl: ReturnType<typeof assistantRunControl>;
  loading: boolean;
  abortRef: { current: AbortController | null };
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPanelView: (view: 'chat') => void;
  setMode: (mode: 'breathing') => void;
  send: ReturnType<typeof useAssistantSend>['send'];
  presentActionResponse: (agent: OrbitAgentId, request: AssistantActionRequest, response: AssistantActionResponse) => void;
  persistThread: (agent: OrbitAgentId) => void;
  closeDecisionDialog: () => void;
  closeDecisionDialogForNavigation: () => void;
  onSessionRefresh?: () => void;
  requestId: () => string;
};

/** Preserves signed task-card actions and run control while the panel owns UI state. */
export function useAssistantTaskCardActions(input: TaskCardActionInput) {
  const { activeAgent, currentPageAgent, page, focusedRunControl, loading, abortRef,
    setLoading, setPanelView, setMode, send, presentActionResponse, persistThread,
    closeDecisionDialog, closeDecisionDialogForNavigation, onSessionRefresh, requestId } = input;
  const handleTaskCardAction = useCallback(async (
    card: AssistantTaskCard,
    action: NonNullable<AssistantTaskCard['primaryAction']>,
  ) => {
    if (action.disabled) return;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-action', {
      detail: { agentId: activeAgent, taskId: card.taskId, actionId: action.id },
    }));
    if (action.actionId) {
      const parameters = action.parameters;
      const request: AssistantActionRequest = {
        source: 'button',
        requestId: requestId(),
        actionId: action.actionId,
        page,
        target: action.target,
        ...(parameters ? { parameters } : {}),
      };
      setLoading(true);
      const response = await executeAssistantAction(activeAgent, request);
      setLoading(false);
      if (response) {
        presentActionResponse(activeAgent, request, response);
        persistThread(activeAgent);
        onSessionRefresh?.();
        closeDecisionDialog();
      }
      return;
    }
    if (action.prompt) {
      setPanelView('chat');
      closeDecisionDialog();
      void send(action.prompt, currentPageAgent);
      return;
    }
    if (action.href) {
      closeDecisionDialogForNavigation();
      const destination = new URL(action.href, window.location.href);
      const productionTaskId = destination.searchParams.get('socialContentTaskId');
      if (destination.origin === window.location.origin && destination.pathname === '/'
        && destination.searchParams.get('page') === 'smartAssets'
        && productionTaskId && /^[a-z0-9:_-]{1,200}$/i.test(productionTaskId)) {
        setMode('breathing');
        window.dispatchEvent(new CustomEvent('lingshu:navigate', {
          detail: { page: 'smartAssets', socialContentTaskId: productionTaskId, socialContentPage: 'smartAssets', directStudio: true },
        }));
        return;
      }
      window.location.assign(action.href);
    }
  }, [activeAgent, closeDecisionDialog, closeDecisionDialogForNavigation, currentPageAgent, onSessionRefresh, page, persistThread, presentActionResponse, send]);

  const toggleTaskPaused = useCallback(async () => {
    if (!focusedRunControl || loading) return;
    const paused = focusedRunControl.actionId === 'pause_task';
    const request: AssistantActionRequest = {
      source: 'button',
      requestId: requestId(),
      actionId: focusedRunControl.actionId,
      page,
      target: focusedRunControl.target,
    };
    setLoading(true);
    const response = await executeAssistantAction(activeAgent, request);
    setLoading(false);
    if (!response) return;
    presentActionResponse(activeAgent, request, response);
    const accepted = response.status === 'accepted' || response.status === 'completed';
    if (!accepted) {
      persistThread(activeAgent);
      return;
    }
    if (paused) abortRef.current?.abort();
    window.dispatchEvent(new CustomEvent('lingshu-assistant-task-control', {
      detail: { agentId: activeAgent, taskId: focusedRunControl.target.objectId, paused },
    }));
    persistThread(activeAgent);
    onSessionRefresh?.();
  }, [activeAgent, focusedRunControl, loading, onSessionRefresh, page, persistThread, presentActionResponse]);

  return { handleTaskCardAction, toggleTaskPaused };
}
