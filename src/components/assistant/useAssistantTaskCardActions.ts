import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Page } from '../../App';
import { executeAssistantAction } from '../../lib/assistantActionRequest';
import { useAssistantStore, type AssistantTaskCard, type OrbitAgentId } from '../../stores/assistantStore';
import type { AssistantActionRequest, AssistantActionResponse } from '../../../shared/contracts/assistantActions';
import type { assistantRunControl } from '../../stores/assistantStore';
import type { useAssistantSend } from './useAssistantSend';
import type { ContentTaskArtifactCard, ContentProductionTaskCard } from '../../../shared/contracts/assistantContentTaskCard';
import { socialContentApi } from '../../lib/socialContentApi';
import { projectContentProductionTaskCard } from '../../../shared/contracts/assistantContentTaskCard';
import { contentTaskCardToAssistantCard } from '../../lib/assistantContentTaskProjection';
import type { ContentTaskActionResult } from './AssistantContentTaskDetail';

type StoreActions = ReturnType<typeof useAssistantStore.getState>;

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
  upsertTaskCard: StoreActions['upsertTaskCard'];
  closeDecisionDialog: () => void;
  closeDecisionDialogForNavigation: () => void;
  onSessionRefresh?: () => void;
  requestId: () => string;
};

/** Preserves signed task-card actions and run control while the panel owns UI state. */
export function useAssistantTaskCardActions(input: TaskCardActionInput) {
  const { activeAgent, currentPageAgent, page, focusedRunControl, loading, abortRef,
    setLoading, setPanelView, setMode, send, presentActionResponse, persistThread,
    closeDecisionDialog, closeDecisionDialogForNavigation, onSessionRefresh, requestId, upsertTaskCard } = input;
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

  const persistContentTask = useCallback((task: Parameters<typeof projectContentProductionTaskCard>[0]) => {
    upsertTaskCard(activeAgent, contentTaskCardToAssistantCard(projectContentProductionTaskCard(task)));
    persistThread(activeAgent);
    onSessionRefresh?.();
  }, [activeAgent, onSessionRefresh, persistThread, upsertTaskCard]);

  const handleContentArtifactDecision = useCallback(async (
    card: ContentProductionTaskCard,
    artifact: ContentTaskArtifactCard,
    decision: 'approved' | 'changes_requested',
    note: string,
  ): Promise<ContentTaskActionResult> => {
    const authoritative = card.artifacts?.find(item => item.artifactId === artifact.artifactId);
    if (!authoritative || authoritative.version !== artifact.version || authoritative.status !== 'review_required') {
      return { ok: false, message: '产物版本已更新，请等待状态刷新后再操作。' };
    }
    if (decision === 'changes_requested' && !note.trim()) return { ok: false, message: '请先说明需要修改的地方。' };
    setLoading(true);
    try {
      const result = await socialContentApi.decideArtifact(card.contentTaskId, artifact.artifactId, {
        expectedVersion: artifact.version, decision, ...(note.trim() ? { note: note.trim() } : {}),
      }, requestId());
      persistContentTask(result.task);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '产物决定未保存，请刷新后重试。' };
    } finally { setLoading(false); }
  }, [persistContentTask, requestId, setLoading]);

  const handleContentDeliveryCreate = useCallback(async (card: ContentProductionTaskCard): Promise<ContentTaskActionResult> => {
    const artifacts = (card.artifacts ?? []).filter(item => item.status === 'approved');
    if (!artifacts.length || (card.artifacts ?? []).some(item => item.status === 'review_required')) {
      return { ok: false, message: '请先完成全部候选版本的验收。' };
    }
    setLoading(true);
    try {
      const result = await socialContentApi.createDeliveryPackage(card.contentTaskId, {
        expectedTaskVersion: card.cardVersion, artifactIds: artifacts.map(item => item.artifactId),
      }, requestId());
      persistContentTask(result.task);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '交付包未生成，请刷新状态后重试。' };
    } finally { setLoading(false); }
  }, [persistContentTask, requestId, setLoading]);

  const handleContentDeliveryDownload = useCallback(async (href: string): Promise<ContentTaskActionResult> => {
    setLoading(true);
    try {
      await socialContentApi.downloadPackage(href);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '交付包下载失败，请重试。' };
    } finally { setLoading(false); }
  }, [setLoading]);

  return { handleTaskCardAction, toggleTaskPaused, handleContentArtifactDecision, handleContentDeliveryCreate, handleContentDeliveryDownload };
}
