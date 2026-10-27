import type { BusinessSceneSelection } from '../../shared/contracts/assistantBusinessScene';
import { isUnboundOperationError } from '../lib/assistantOperationNotice';
import { appendProductionReceipt } from '../lib/assistantProductionPortal';
import { executeAssistantAction } from '../lib/assistantActionRequest';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreationMode } from '../lib/creationMode';
import { App as AntApp } from 'antd';
import type { AgentAction, AgentType, AssistantReferenceMedia, Message, Page } from '../App';
import { authHeader, getToken } from '../lib/auth';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import {
  assistantRunControl,
  shouldNotifyAssistant,
  type OrbitAgentId,
  useAssistantStore,
} from '../stores/assistantStore';
import AssistantConversationPanel from './assistant/AssistantConversationPanel';
import AssistantFloatingReminders from './assistant/AssistantFloatingReminders';
import AssistantLauncher from './assistant/AssistantLauncher';
import { actionCardToTaskCard, actionResponseCardId, notificationReasonFromResponse, responseWithoutCrossObjectActions } from './assistant/assistantActionProjection';
import { useContentTaskIntake } from './assistant/useContentTaskIntake';
import { useAssistantThreadSaveQueue } from './assistant/useAssistantThreadSaveQueue';
import { useAssistantConversationManagement } from './assistant/useAssistantConversationManagement';
import { useAssistantThreadHydration } from './assistant/useAssistantThreadHydration';
import type { UploadedAssistantAttachment } from './assistant/assistantChatPrompt';
import { useAssistantFeatureGuides } from './assistant/useAssistantFeatureGuides';
import { useAssistantNotifications } from './assistant/useAssistantNotifications';
import { useAssistantSend } from './assistant/useAssistantSend';
import { useAssistantQuickExecution } from './assistant/useAssistantQuickExecution';
import { useAssistantTaskCardActions } from './assistant/useAssistantTaskCardActions';
import { useAssistantDecisionDialog } from './assistant/useAssistantDecisionDialog';
import { useAssistantPanelControls } from './assistant/useAssistantPanelControls';
import { ASSISTANT_HOME_ACTIVITY_EVENT, useAssistantHomeAnchor, useAssistantHomeInteraction, useAssistantHomeMode } from './assistant/useAssistantHomeAnchor';
import { useAssistantLauncherRetraction } from './assistant/useAssistantLauncherRetraction';
import { useAssistantDecisionCount, useAssistantPageContextSignal } from './assistant/useAssistantPageSignals';
import { useAssistantContentTaskCard } from './assistant/useAssistantContentTaskCard';
import type { AssistantQuickExecution } from '../lib/assistantQuickEntries';
import AssistantDecisionDialog from './assistant/AssistantDecisionDialog';
import {
  ASSISTANT_PRODUCTION_CONTEXT_EVENT,
  type AssistantProductionContext,
  type AssistantProductionContextEventDetail,
} from '../lib/assistantProductionDecision';
import { WEEKLY_WORK_UPDATED_EVENT } from '../lib/weeklyWorkEvents';
import { socialContentApi } from '../lib/socialContentApi';
import { readSocialContentNavigationTaskId, SOCIAL_CONTENT_NAVIGATION_EVENT } from '../lib/socialContentContext';
import { SOCIAL_CONTENT_TASK_REFRESH_EVENT } from '../lib/socialContentTaskRefresh';
import type { AssistantJournalScope } from '../lib/assistantThreadJournal';
import type { AssistantActionRequest, AssistantActionResponse } from '../../shared/contracts/assistantActions';
import {
  CURRENT_STATUS_TASK_ID,
  DEFAULT_CONTEXT,
  PRIMARY_ASSISTANT_THREAD,
  WORKFLOW_MUTATION_ACTIONS,
  assistantPersistenceCanRun,
  mergeConsecutiveAssistant,
  orbitIdForAgent,
  orbitIdForPage,
  pageKey,
  type AssistantContext, type AssistantThreadSaveQueue,
} from './assistant/globalAssistantRuntime';

type AssistantTool = 'knowledge-intake';
const ASSISTANT_CONVERSATION_WELCOME_SEEN_KEY = 'lingshu-assistant-conversation-welcome-seen-v1';

const ASSISTANT_UI_WATCHDOG_TIMEOUT_MS = 25_000;

type AssistantPanelView = 'todo' | 'chat';

interface Props {
  page: Page;
  persistenceScope: AssistantJournalScope;
  primaryEntry?: boolean;
  compactMode?: boolean;
  restore?: { agent: AgentType; messages: Message[]; key: string } | null;
  kickoff?: { agent: AgentType; text: string; key: string } | null;
  suppressForRightSidebar?: boolean;
  onKickoffConsumed?: () => void;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function GlobalAssistant({
  page,
  persistenceScope,
  primaryEntry = false,
  compactMode = false,
  restore,
  kickoff,
  suppressForRightSidebar = false,
  onKickoffConsumed,
  onAction,
  onSessionRefresh,
}: Props) {
  const { modal, message: uiMessage } = AntApp.useApp();
  const reduceMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<'breathing' | 'chat'>('breathing');
  const inlineHome = page === 'strategy';
  const creationMode = useCreationMode();
  const inlineHomeBounds = useAssistantHomeAnchor(inlineHome);
  const [panelView, setPanelView] = useState<AssistantPanelView>('chat');
  const [productionDecisionContext, setProductionDecisionContext] = useState<AssistantProductionContext | null>(null);
  const activeAgent = PRIMARY_ASSISTANT_THREAD;
  const [assistantTool, setAssistantTool] = useState<AssistantTool | null>(null);
  const [liveContext, setLiveContext] = useState<AssistantContext | null>(null);
  const { featureGuide, setFeatureGuide, enterpriseGuideSeen } = useAssistantFeatureGuides({ page, compactMode, mode });
  const [enterpriseContext, setEnterpriseContext] = useState('');
  const [weeklyPlanPromptDismissed, setWeeklyPlanPromptDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [weeklyActionBusy, setWeeklyActionBusy] = useState(false);
  const [welcomeBubbleVisible, setWelcomeBubbleVisible] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement>(null);
  const launcherButtonRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const edgeLauncherButtonRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const { launcherRetracted, retractLauncher, restoreLauncher } = useAssistantLauncherRetraction(launcherButtonRef, edgeLauncherButtonRef);
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());
  const conversationPageRef = useRef(page);
  const assistantClosedRef = useRef<{ page: Page; at: number } | null>(null);
  const assistantThreadSaveQueuesRef = useRef(new Map<OrbitAgentId, AssistantThreadSaveQueue>());
  const assistantAtomicMutationRef = useRef(false);
  const uploadedAttachmentCacheRef = useRef(new WeakMap<File, UploadedAssistantAttachment>());
  const welcomeBubbleScopeRef = useRef('');
  const stablePersistenceScope = useMemo<AssistantJournalScope>(() => ({
    tenantId: persistenceScope.tenantId.trim(),
    userId: persistenceScope.userId.trim(),
  }), [persistenceScope.tenantId, persistenceScope.userId]);
  const persistenceScopeKey = `${stablePersistenceScope.tenantId}\u0000${stablePersistenceScope.userId}`;
  const welcomeBubbleStorageKey = `${ASSISTANT_CONVERSATION_WELCOME_SEEN_KEY}:${encodeURIComponent(stablePersistenceScope.tenantId)}:${encodeURIComponent(stablePersistenceScope.userId)}`;
  const persistenceFenceRef = useRef({ scopeKey: persistenceScopeKey, active: true });
  if (persistenceFenceRef.current.scopeKey !== persistenceScopeKey) {
    persistenceFenceRef.current.active = false;
    persistenceFenceRef.current = { scopeKey: persistenceScopeKey, active: true };
  }

  useEffect(() => {
    // React StrictMode deliberately runs effect setup -> cleanup -> setup in
    // development. The first cleanup deactivates its instance fence, so the
    // second setup must install a fresh active fence for the same user scope.
    // Otherwise every later chat response is mistaken for work from an
    // unmounted component and is discarded before the model request starts.
    let fence = persistenceFenceRef.current;
    if (!fence.active || fence.scopeKey !== persistenceScopeKey) {
      fence = { scopeKey: persistenceScopeKey, active: true };
      persistenceFenceRef.current = fence;
    }
    return () => {
      fence.active = false;
      persistenceFenceRef.current.active = false;
      abortRef.current?.abort();
      abortRef.current = null;
      for (const queue of assistantThreadSaveQueuesRef.current.values()) {
        queue.abortController?.abort();
        queue.abortController = null;
      }
    };
  }, [persistenceScopeKey]);

  const threads = useAssistantStore(state => state.threads);
  const setMessages = useAssistantStore(state => state.setMessages);
  const setDraftInput = useAssistantStore(state => state.setDraftInput);
  const setScrollPosition = useAssistantStore(state => state.setScrollPosition);
  const setUnreadCount = useAssistantStore(state => state.setUnreadCount);
  const setFollowingLatest = useAssistantStore(state => state.setFollowingLatest);
  const upsertTaskCard = useAssistantStore(state => state.upsertTaskCard);
  const focusTaskCard = useAssistantStore(state => state.focusTaskCard);
  const hydrateThread = useAssistantStore(state => state.hydrateThread);
  const setPersistenceMetadata = useAssistantStore(state => state.setPersistenceMetadata);

  const normalizedPage = pageKey(page);
  const pageContext = useMemo(() => (
    liveContext?.sourcePage === normalizedPage
      ? liveContext
      : DEFAULT_CONTEXT[normalizedPage] ?? DEFAULT_CONTEXT.strategy
  ), [liveContext, normalizedPage]);
  const currentPageAgent = useMemo(() => orbitIdForPage(page), [page]);
  const weeklyPlanKickoffAvailable = normalizedPage === 'digitalEmployees'
    && pageContext.workflowStage === 'unplanned';
  const [pipelineEntries, setPipelineEntries] = useState<AssistantQuickExecution[]>([]);
  const [pipelineRefresh, setPipelineRefresh] = useState(0);
  const [fileGenerating, setFileGenerating] = useState(false);
  const [replyStreaming, setReplyStreaming] = useState(false);
  const pendingMapFileRef = useRef(false);
  useEffect(() => { setFileGenerating(false); }, [persistenceScopeKey]);
  const [contentIntakeEpoch, setContentIntakeEpoch] = useState(0);
  const pipelineInFlightRef = useRef(false);
  const pipelineModalOpenRef = useRef(false);
  const [selectedProductionTaskId, setSelectedProductionTaskId] = useState('');
  useEffect(() => {
    const read = () => setSelectedProductionTaskId(readSocialContentNavigationTaskId(page, window.history.state) || '');
    read();
    window.addEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT, read);
    window.addEventListener('popstate', read);
    return () => { window.removeEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT, read); window.removeEventListener('popstate', read); };
  }, [page, persistenceScopeKey]);
  useEffect(() => {
    setPipelineEntries([]);
    if (mode !== 'chat' || !selectedProductionTaskId || !['smartAssets', 'socialInspiration'].includes(page)) return;
    let active = true;
    void socialContentApi.getAssistantActions(selectedProductionTaskId).then(({ items }) => {
      if (active) setPipelineEntries(items.filter(item => item.operation === 'open' || !item.disabledReason).map(item => ({
        ...item, kind: 'execute' as const, prompt: item.label,
        confirmation: item.operation === 'start' ? 'preview' as const : 'none' as const,
      })));
    }).catch(() => { if (active) setPipelineEntries([]); });
    return () => { active = false; };
  }, [mode, page, selectedProductionTaskId, pipelineRefresh, persistenceScopeKey]);
  useEffect(() => {
    if (mode !== 'chat' || !selectedProductionTaskId) return;
    const refresh = () => setPipelineRefresh(value => value + 1);
    window.addEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, refresh);
    const timer = window.setInterval(refresh, 15_000);
    return () => { window.removeEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, refresh); window.clearInterval(timer); };
  }, [mode, selectedProductionTaskId]);
  const openWeeklyPlanFromAssistant = useCallback(() => {
    setWeeklyPlanPromptDismissed(true);
    setMode('breathing');
    window.dispatchEvent(new CustomEvent('lingshu:open-weekly-plan', {
      detail: { source: 'assistant' },
    }));
  }, []);
  const activeThread = threads[activeAgent];
  useAssistantHomeInteraction(inlineHome, activeThread.messages.length, loading, activeAgent, setDraftInput, assistantInputRef, Boolean(activeThread.creationDraft));
  const inlineHomeActive = inlineHome && Boolean(activeThread.messages.length || loading || activeThread.creationDraft);
  useEffect(() => {
    if (!inlineHome) return;
    window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: inlineHomeActive, busy: loading || replyStreaming || fileGenerating } }));
  }, [inlineHome, inlineHomeActive, loading, replyStreaming, fileGenerating]);
  const todoItems = pageContext.todoItems ?? [];
  const activeTodoItems = todoItems.filter(item => !item.completed);
  const pendingCount = todoItems.length ? activeTodoItems.length : Math.max(0, Number(pageContext.pendingCount ?? 0));

  useEffect(() => {
    if (!loading) return;
    const timeoutId = window.setTimeout(() => {
      abortRef.current?.abort();
      abortRef.current = null;
      setLoading(false);
      const current = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
      if (current.at(-1)?.role !== 'user') return;
      setMessages(PRIMARY_ASSISTANT_THREAD, [
        ...current,
        { role: 'assistant', content: '本次连接在 25 秒内没有返回，已停止等待。当前请求没有及时响应，输入和选择仍保留，请重试。' },
      ]);
      setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
    }, ASSISTANT_UI_WATCHDOG_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [loading, setFollowingLatest, setMessages]);

  const { persistThread, waitForInFlightThreadSave } = useAssistantThreadSaveQueue({
    stablePersistenceScope, persistenceFenceRef, assistantThreadSaveQueuesRef,
    persistencePauseRef: assistantAtomicMutationRef, hydrateThread, setPersistenceMetadata,
  });
  useAssistantContentTaskCard({ active: mode === 'chat', focusedTaskId: activeThread.focusedTaskId,
    agentId: activeAgent, scopeKey: persistenceScopeKey, upsertTaskCard, persistThread });
  const {
    decisionDialog, setDecisionDialog, decisionFeedRevision, setDecisionFeedRevision,
    decisionTotal, setDecisionTotal, decisionDialogRestoreFocusRef,
    handleDecisionFeedChange, openDecisionDialog, closeDecisionDialog,
    closeDecisionDialogForNavigation, handleDecisionDialogFeedChange,
    handleDecisionActionResult, restoreDecisionDialogFocus,
  } = useAssistantDecisionDialog({
    launcherButtonRef, setMessages, setFollowingLatest, persistThread, onSessionRefresh,
  });
  const dialogTaskCard = decisionDialog?.kind === 'task'
    ? activeThread.taskCards[decisionDialog.taskId] ?? null
    : null;
  const focusedRunControl = assistantRunControl(dialogTaskCard);

  useEffect(() => {
    const retryPendingThreads = () => {
      if (!assistantPersistenceCanRun()) return;
      for (const [agentId, queue] of assistantThreadSaveQueuesRef.current) {
        if (!queue.pending || queue.running) continue;
        persistThread(agentId, 'retry');
      }
    };
    const flushPendingThreads = () => {
      const agentIds = new Set<OrbitAgentId>([
        PRIMARY_ASSISTANT_THREAD,
        ...assistantThreadSaveQueuesRef.current.keys(),
      ]);
      for (const agentId of agentIds) {
        persistThread(agentId, 'lifecycle');
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingThreads();
      else retryPendingThreads();
    };
    window.addEventListener('online', retryPendingThreads);
    window.addEventListener('pagehide', flushPendingThreads);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', retryPendingThreads);
      window.removeEventListener('pagehide', flushPendingThreads);
      document.removeEventListener('visibilitychange', handleVisibility);
      for (const queue of assistantThreadSaveQueuesRef.current.values()) {
        if (queue.retryTimer !== null) window.clearTimeout(queue.retryTimer);
        queue.retryTimer = null;
        queue.abortController?.abort();
        queue.abortController = null;
      }
    };
  }, [persistThread]);

  const revealConversationWelcomeOnce = useCallback(() => {
    const thread = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
    if (thread.messages.length) {
      setWelcomeBubbleVisible(false);
      return;
    }
    if (welcomeBubbleScopeRef.current === welcomeBubbleStorageKey) {
      setWelcomeBubbleVisible(false);
      return;
    }
    welcomeBubbleScopeRef.current = welcomeBubbleStorageKey;
    let alreadySeen = false;
    try {
      alreadySeen = window.localStorage.getItem(welcomeBubbleStorageKey) === 'true';
      if (!alreadySeen) window.localStorage.setItem(welcomeBubbleStorageKey, 'true');
    } catch {
      // Storage is optional. The in-memory scope guard still prevents repeats
      // while this assistant instance is mounted.
    }
    setWelcomeBubbleVisible(!alreadySeen);
  }, [welcomeBubbleStorageKey]);

  const resetTransientConversation = useCallback(() => {
    setFileGenerating(false); setReplyStreaming(false); setWelcomeBubbleVisible(false);
    pendingMapFileRef.current = false;
    setContentIntakeEpoch(value => value + 1);
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages(PRIMARY_ASSISTANT_THREAD, []);
    setDraftInput(PRIMARY_ASSISTANT_THREAD, '');
    setScrollPosition(PRIMARY_ASSISTANT_THREAD, 0);
    setUnreadCount(PRIMARY_ASSISTANT_THREAD, 0);
    setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
    setPendingAttachments([]);
    setAttachmentError('');
  }, [setDraftInput, setFollowingLatest, setMessages, setScrollPosition, setUnreadCount]);

  const openAgent = useCallback((routeAgent: OrbitAgentId, preferredView?: AssistantPanelView) => {
    const agentId = PRIMARY_ASSISTANT_THREAD;
    const nextView = preferredView ?? 'chat';
    void routeAgent;
    setAssistantTool(null);
    setPanelView(nextView);
    setUnreadCount(agentId, 0);
    setMode('chat');
    persistThread(agentId);
  }, [persistThread, setUnreadCount]);

  const openCurrentPageAgent = useCallback(() => {
    assistantClosedRef.current = null;
    openAgent(currentPageAgent, 'chat');
  }, [currentPageAgent, openAgent, page, resetTransientConversation]);

  const presentActionResponse = useCallback((
    agentId: OrbitAgentId,
    request: AssistantActionRequest,
    response: AssistantActionResponse,
  ) => {
    if (isUnboundOperationError(response.errorCode)) {
      // A rejected, unbound command is a one-off explanation, not a task.
      const current = useAssistantStore.getState().threads[agentId];
      setMessages(agentId, [...current.messages, {
        role: 'assistant',
        content: response.card.summary,
      }]);
      setPanelView('chat');
      setMode('chat');
      return;
    }
    const existingCards = useAssistantStore.getState().threads[agentId].taskCards;
    const stableTaskId = actionResponseCardId(request, response, existingCards);
    const displayResponse = responseWithoutCrossObjectActions(request, response);
    upsertTaskCard(agentId, actionCardToTaskCard(displayResponse.card, displayResponse, stableTaskId));
    const refreshCurrentStatus = () => {
      const mutationSucceeded = response.status === 'accepted' || response.status === 'completed';
      const workflowMutated = response.actionId !== 'delegate_to_agent'
        && WORKFLOW_MUTATION_ACTIONS.has(response.actionId);
      // The mutation endpoint deliberately returns only actions for the
      // mutated object. Always re-read status after a successful workflow
      // mutation so a newly-created next decision is fetched independently.
      if (!workflowMutated || !mutationSucceeded) return;
      const threadAfterMutation = useAssistantStore.getState().threads[agentId];
      const statusRequest: AssistantActionRequest = {
        source: 'button',
        requestId: requestId(),
        actionId: 'view_status',
        page,
      };
      void executeAssistantAction(agentId, statusRequest).then(statusResponse => {
        if (
          useAssistantStore.getState().threads[agentId] !== threadAfterMutation
          || !statusResponse
          || statusResponse.status === 'not_handled'
          || statusResponse.status === 'delegated'
          || statusResponse.status === 'failed'
          || statusResponse.status === 'stale_action'
        ) return;
        upsertTaskCard(
          agentId,
          actionCardToTaskCard(statusResponse.card, statusResponse, CURRENT_STATUS_TASK_ID),
        );
        focusTaskCard(agentId, CURRENT_STATUS_TASK_ID);
        setPanelView('chat');
        setMode('chat');
        persistThread(agentId);
      });
    };
    const notificationReason = notificationReasonFromResponse(response);
    if (!shouldNotifyAssistant(notificationReason)) {
      // This callback handles direct user actions. Keep routine success silent
      // (no unread badge or speech bubble), but keep the signed task card as a
      // summary bubble in the conversation so the user chooses when to open it.
      focusTaskCard(agentId, stableTaskId);
      setPanelView('chat');
      setMode('chat');
      refreshCurrentStatus();
      return;
    }
    focusTaskCard(agentId, stableTaskId);
    setPanelView('chat');
    setMode('chat');
    if (response.notification) {
      const current = useAssistantStore.getState().threads[agentId];
      setUnreadCount(agentId, current.unreadCount + 1);
      setSpeechBubble({ id: Date.now(), message: response.notification.message });
    }
    refreshCurrentStatus();
  }, [executeAssistantAction, focusTaskCard, page, persistThread, setMessages, setUnreadCount, upsertTaskCard]);

  const contentIntake = useContentTaskIntake({
    scopeKey: `${persistenceScopeKey}:${contentIntakeEpoch}`, page,
    append: (role, content) => {
      const messages = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
      setMessages(PRIMARY_ASSISTANT_THREAD, [...messages, { role, content }]);
      setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
      persistThread(PRIMARY_ASSISTANT_THREAD);
    },
    onReceipt: response => {
      const taskId = response.receipt.taskId;
      const content = `已创建周任务「${response.task.brief.title}」。${response.receipt.blockedReason ? '暂未进入生产，请在任务中查看所需资料或服务状态。' : response.receipt.started ? '生产已启动，交付物将回收到该任务。' : '已保存，等待生产条件。'}`;
      const messages = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
      setMessages(PRIMARY_ASSISTANT_THREAD, appendProductionReceipt(messages, content, response));
      upsertTaskCard(PRIMARY_ASSISTANT_THREAD, { taskId: `social-content:${taskId}`, title: response.task.brief.title, conclusion: content,
        status: response.receipt.status === 'producing' ? 'running' : ['completed', 'delivered', 'published'].includes(response.receipt.status) ? 'completed' : response.receipt.status === 'paused' ? 'paused' : 'needs_input', notificationReason: 'routine',
        primaryAction: { id: `open-${taskId}`, label: '查看生产任务', href: `/?page=smartAssets&socialContentTaskId=${encodeURIComponent(taskId)}` } });
      persistThread(PRIMARY_ASSISTANT_THREAD);
      window.dispatchEvent(new CustomEvent(WEEKLY_WORK_UPDATED_EVENT));
      void onSessionRefresh?.(); setPipelineRefresh(value => value + 1);
    },
    onFinish: () => { setMode('chat'); },
  });

  const { send, sendComposerMessage } = useAssistantSend({
    page, pageContext, currentPageAgent, enterpriseContext, loading, fileGenerating, replyStreaming,
    contentIntake, uiMessage, persistenceFenceRef, stablePersistenceScope, assistantAtomicMutationRef,
    waitForInFlightThreadSave,
    pendingMapFileRef, abortRef, openAgent, presentActionResponse,
    setMessages, setDraftInput, setFollowingLatest, upsertTaskCard, focusTaskCard, hydrateThread, setLoading,
    setFileGenerating, setReplyStreaming, setPipelineRefresh, persistThread, onSessionRefresh, requestId,
    activeAgent, draftInput: activeThread.draftInput, pendingAttachments, attachmentUploading,
    weeklyPlanKickoffAvailable, uploadedAttachmentCacheRef, setAttachmentError,
    setAttachmentUploading, setPendingAttachments, openWeeklyPlanFromAssistant,
  });

  const runQuickExecution = useAssistantQuickExecution({
    loading, fileGenerating, pipelineInFlightRef, pipelineModalOpenRef, persistenceFenceRef,
    openWeeklyPlanFromAssistant, contentIntake, modal, uiMessage, setMessages, upsertTaskCard,
    setMode, setLoading, setPipelineRefresh, persistThread, onSessionRefresh, requestId,
  });

  const { handleTaskCardAction, toggleTaskPaused, handleContentArtifactDecision,
    handleContentDeliveryCreate, handleContentDeliveryDownload } = useAssistantTaskCardActions({
    activeAgent, currentPageAgent, page, focusedRunControl, loading, abortRef,
    setLoading, setPanelView, setMode, send, presentActionResponse, persistThread,
    closeDecisionDialog, closeDecisionDialogForNavigation, onSessionRefresh, requestId, upsertTaskCard,
  });

  const assistantThreadHydrated = useAssistantThreadHydration({
    page, stablePersistenceScope, persistThread, hydrateThread,
    executeAssistantAction, upsertTaskCard, focusTaskCard, requestId,
  });
  const conversationControls = useAssistantConversationManagement({
    scope: stablePersistenceScope, fence: persistenceFenceRef, pause: assistantAtomicMutationRef,
    queues: assistantThreadSaveQueuesRef, abort: abortRef, wait: waitForInFlightThreadSave,
    reset: resetTransientConversation, ready: assistantThreadHydrated,
    stop: () => { setLoading(false); setReplyStreaming(false); setFileGenerating(false); },
    blocked: attachmentUploading || contentIntake.busy || weeklyActionBusy || pipelineInFlightRef.current,
  });

  useEffect(() => {
    if (!assistantThreadHydrated || mode !== 'chat' || panelView !== 'chat') return;
    revealConversationWelcomeOnce();
  }, [assistantThreadHydrated, mode, panelView, revealConversationWelcomeOnce]);

  useEffect(() => {
    let cancelled = false;
    const requestFence = persistenceFenceRef.current;
    const requestToken = getToken();
    const currentScope = () => (
      !cancelled
      && requestFence.active
      && persistenceFenceRef.current === requestFence
      && requestToken === getToken()
    );
    setEnterpriseContext('');
    fetch('/api/overseas/enterprise/context', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (currentScope() && typeof data?.context === 'string') setEnterpriseContext(data.context);
      })
      .catch(() => { if (currentScope()) setEnterpriseContext(''); });
    return () => { cancelled = true; };
  }, [persistenceScopeKey]);

  useAssistantPageContextSignal(page, setLiveContext);

  useEffect(() => { setWeeklyPlanPromptDismissed(false); }, [normalizedPage, pageContext.workflowStage]);
  useAssistantDecisionCount({ mode, page, goalId: pageContext.goalId,
    persistenceScopeKey, suppressForRightSidebar, setDecisionTotal });
  const { performance, performanceHidden, setPerformanceHidden, performanceMessage,
    speechBubble, setSpeechBubble } = useAssistantNotifications({
    mode, setMode, primaryEntry, compactMode, focusTaskCard, setUnreadCount, upsertTaskCard,
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; assistantText?: string; scriptedReply?: string; context?: Partial<AssistantContext>; tool?: AssistantTool; referenceMedia?: AssistantReferenceMedia; preserveDraft?: boolean; companyReportRequest?: { companyId: string; year: number }; businessScene?: BusinessSceneSelection }>).detail;
      let targetContext = pageContext;
      if (detail?.context?.agent && detail.context.label && detail.context.summary) {
        targetContext = {
          agent: detail.context.agent, label: detail.context.label, summary: detail.context.summary,
          suggestions: detail.context.suggestions?.length ? detail.context.suggestions : pageContext.suggestions,
          pendingCount: typeof detail.context.pendingCount === 'number' ? detail.context.pendingCount : pageContext.pendingCount,
          todoItems: Array.isArray(detail.context.todoItems) ? detail.context.todoItems : pageContext.todoItems,
          sourcePage: detail.context.sourcePage || normalizedPage, goalId: detail.context.goalId,
          planId: detail.context.planId, runId: detail.context.runId, taskId: detail.context.taskId,
          contentId: detail.context.contentId, viewKey: detail.context.viewKey,
          workflowStage: detail.context.workflowStage,
        };
        setLiveContext(targetContext);
      }
      const routeAgent = orbitIdForAgent(targetContext.agent, currentPageAgent);
      openAgent(routeAgent, 'chat');
      if (detail?.tool === 'knowledge-intake') setAssistantTool('knowledge-intake');
      const scriptedReply = detail?.scriptedReply?.trim();
      const text = detail?.text?.trim();
      if (scriptedReply && text) {
        abortRef.current?.abort(); abortRef.current = null;
        setLoading(false);
        setMessages(PRIMARY_ASSISTANT_THREAD, [{ role: 'user', content: text }, { role: 'assistant', content: scriptedReply }]);
        setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
        setDraftInput(PRIMARY_ASSISTANT_THREAD, '');
        window.setTimeout(() => persistThread(PRIMARY_ASSISTANT_THREAD), 0);
        return;
      }
      const assistantText = detail?.assistantText?.trim();
      if (assistantText) {
        const current = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
        setMessages(PRIMARY_ASSISTANT_THREAD, [...current, { role: 'assistant', content: assistantText }]);
      }
      if (text) window.setTimeout(() => void send(text, routeAgent, targetContext, [], detail?.referenceMedia, { preserveDraft: detail?.preserveDraft, companyReport: Boolean(detail?.companyReportRequest), businessScene: detail?.businessScene }), 0);
    };
    window.addEventListener('lingshu-assistant-open', handler);
    return () => window.removeEventListener('lingshu-assistant-open', handler);
  }, [currentPageAgent, normalizedPage, openAgent, pageContext, persistThread, send, setDraftInput, setFollowingLatest, setMessages]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AssistantProductionContextEventDetail>).detail;
      if (detail?.context?.view.source === 'canonical_task' && detail.context.view.project.version) {
        setProductionDecisionContext(detail.context);
        return;
      }
      if (detail?.clearProjectId) {
        setProductionDecisionContext(current => current?.view.project.id === detail.clearProjectId ? null : current);
      }
    };
    window.addEventListener(ASSISTANT_PRODUCTION_CONTEXT_EVENT, handler);
    return () => window.removeEventListener(ASSISTANT_PRODUCTION_CONTEXT_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!kickoff || handledKickoffs.current.has(kickoff.key)) return;
    handledKickoffs.current.add(kickoff.key);
    void send(kickoff.text, orbitIdForAgent(kickoff.agent, currentPageAgent));
    onKickoffConsumed?.();
  }, [currentPageAgent, kickoff, onKickoffConsumed, send]);

  useEffect(() => {
    if (!restore || handledRestores.current.has(restore.key)) return;
    handledRestores.current.add(restore.key);
    const routeAgent = orbitIdForAgent(restore.agent, currentPageAgent);
    setMessages(PRIMARY_ASSISTANT_THREAD, mergeConsecutiveAssistant(restore.messages));
    openAgent(routeAgent, 'chat');
  }, [currentPageAgent, openAgent, restore, setMessages]);

  useEffect(() => {
    if (mode !== 'chat' || panelView !== 'chat') return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = messageScrollRef.current;
      if (!scroller) return;
      if (!activeThread.isFollowingLatest) scroller.scrollTop = activeThread.scrollPosition;
      else scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAgent, mode, panelView]);

  useEffect(() => {
    if (mode !== 'chat' || panelView !== 'chat' || !activeThread.isFollowingLatest) return;
    const scroller = messageScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [activeThread.isFollowingLatest, activeThread.messages, mode, panelView]);

  useEffect(() => {
    if (mode !== 'chat') return;
    const frame = window.requestAnimationFrame(() => {
      const panel = document.getElementById('global-assistant-panel');
      panel?.focus({ preventScroll: true });
      // An absolutely positioned assistant must never scroll the app shell itself.
      // Otherwise the page surface moves up and leaves a blank strip below it.
      const appMain = panel?.closest<HTMLElement>('.app-main');
      if (appMain?.scrollTop) appMain.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    const input = assistantInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 88)}px`;
  }, [activeAgent, activeThread.draftInput, mode, panelView]);

  useEffect(() => {
    const previousPage = conversationPageRef.current;
    if (previousPage === page) return;
    conversationPageRef.current = page;

    // Navigation preserves named conversations; clearing is an explicit user action.
    assistantClosedRef.current = null;
  }, [focusTaskCard, kickoff, page, resetTransientConversation, restore]);

  useEffect(() => {
    setLiveContext(null);
    setDecisionTotal(null);
    decisionDialogRestoreFocusRef.current = false;
    setDecisionDialog(null);
  }, [page]);

  useEffect(() => {
    if (page === 'enterprise' || assistantTool !== 'knowledge-intake') return;
    setAssistantTool(null);
    setMode('breathing');
  }, [assistantTool, page]);

  useEffect(() => {
    if (mode !== 'chat' && !activeThread.creationDraft) return;
    const timer = window.setTimeout(() => persistThread(activeAgent), 500);
    return () => window.clearTimeout(timer);
  }, [activeAgent, activeThread.draftInput, activeThread.creationDraft, activeThread.focusedTaskId, activeThread.isFollowingLatest, activeThread.messages, activeThread.paused, activeThread.scrollPosition, activeThread.taskCards, activeThread.unreadCount, mode, persistThread]);

  useAssistantHomeMode(inlineHome, setMode);
  const { closeAssistant, returnToConversation, handleLauncherClick } = useAssistantPanelControls({
    activeAgent, page, inlineHome, mode, assistantTool, decisionDialog, launcherRetracted,
    assistantClosedRef, launcherButtonRef, edgeLauncherButtonRef, messageScrollRef,
    persistThread, setAssistantTool, setPanelView, setDecisionDialog,
    setWelcomeBubbleVisible, setMode, setViewport, openCurrentPageAgent,
  });

  const inlineHomeAnchor = inlineHomeBounds ? document.getElementById('content-creation-assistant-anchor') : null;
  if (suppressForRightSidebar || (inlineHome && !inlineHomeAnchor)) return null;

  const assistantRoot = (
    <div
      data-global-assistant="root"
      data-inline-home={inlineHomeAnchor ? 'true' : undefined}
      data-home-empty={inlineHome ? (inlineHomeActive ? 'false' : 'true') : undefined}
      data-home-creation-mode={inlineHomeBounds ? creationMode : undefined}
      className={inlineHomeAnchor ? 'ls-assistant-home-root absolute inset-0 z-[75]' : `fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[75] md:bottom-5 ${launcherRetracted && mode === 'breathing' ? 'right-0 md:right-0' : 'right-4 md:right-5'}`}
    >
      {!inlineHome && <AssistantFloatingReminders
        page={page}
        mode={mode}
        launcherRetracted={launcherRetracted}
        reduceMotion={reduceMotion}
        viewportWidth={viewport.width}
        performance={performance}
        performanceHidden={performanceHidden}
        performanceMessage={performanceMessage}
        onHidePerformance={() => setPerformanceHidden(true)}
        speechBubble={speechBubble}
        weeklyPlanKickoffAvailable={weeklyPlanKickoffAvailable}
        weeklyPlanPromptDismissed={weeklyPlanPromptDismissed}
        onDismissWeeklyPlanPrompt={() => setWeeklyPlanPromptDismissed(true)}
        onOpenWeeklyPlan={openWeeklyPlanFromAssistant}
        featureGuide={featureGuide}
        onDismissFeatureGuide={() => setFeatureGuide(null)}
        onOpenFeatureGuide={agent => {
          const agentId = orbitIdForAgent(agent, currentPageAgent);
          setFeatureGuide(null);
          openAgent(agentId);
        }}
        enterpriseGuideSeen={enterpriseGuideSeen}
        onOpenCurrentPageAgent={openCurrentPageAgent}
      />}

      <AssistantConversationPanel
        conversationControls={conversationControls}
        conversationLocked={assistantAtomicMutationRef.current}
        page={page} pageContext={pageContext} currentPageAgent={currentPageAgent}
        inlineHome={inlineHome} inlineHomeBounds={inlineHomeBounds}
        activeAgent={activeAgent} activeThread={activeThread} mode={mode} panelView={panelView}
        assistantTool={assistantTool} viewport={viewport} reduceMotion={reduceMotion}
        productionDecisionContext={productionDecisionContext} decisionFeedRevision={decisionFeedRevision}
        persistenceScopeKey={persistenceScopeKey} welcomeBubbleVisible={welcomeBubbleVisible}
        loading={loading} fileGenerating={fileGenerating} replyStreaming={replyStreaming}
        attachmentUploading={attachmentUploading} attachmentError={attachmentError}
        pendingAttachments={pendingAttachments} weeklyActionBusy={weeklyActionBusy}
        weeklyPlanKickoffAvailable={weeklyPlanKickoffAvailable} pipelineEntries={pipelineEntries}
        pendingCount={pendingCount} contentIntake={contentIntake}
        messageScrollRef={messageScrollRef} assistantInputRef={assistantInputRef}
        onAction={onAction} onSessionRefresh={onSessionRefresh} closeAssistant={closeAssistant}
        returnToConversation={returnToConversation} openDecisionDialog={openDecisionDialog}
        handleDecisionFeedChange={handleDecisionFeedChange}
        openWeeklyPlanFromAssistant={openWeeklyPlanFromAssistant} send={send}
        sendComposerMessage={sendComposerMessage} runQuickExecution={runQuickExecution}
        setAssistantTool={setAssistantTool} setScrollPosition={setScrollPosition}
        setFollowingLatest={setFollowingLatest} focusTaskCard={focusTaskCard}
        setMessages={setMessages} setDraftInput={setDraftInput}
        setDecisionFeedRevision={setDecisionFeedRevision} setMode={setMode}
        setWeeklyActionBusy={setWeeklyActionBusy} setPendingAttachments={setPendingAttachments}
        setAttachmentError={setAttachmentError} persistThread={persistThread}
      />

      <AssistantDecisionDialog
        decisionDialog={decisionDialog}
        dialogTaskCard={dialogTaskCard}
        focusedRunControl={focusedRunControl}
        page={page}
        goalId={pageContext.goalId}
        productionDecisionContext={productionDecisionContext}
        persistenceScopeKey={persistenceScopeKey}
        loading={loading}
        closeDecisionDialog={closeDecisionDialog}
        restoreDecisionDialogFocus={restoreDecisionDialogFocus}
        closeDecisionDialogForNavigation={closeDecisionDialogForNavigation}
        handleDecisionDialogFeedChange={handleDecisionDialogFeedChange}
        handleDecisionActionResult={handleDecisionActionResult}
        toggleTaskPaused={toggleTaskPaused}
        handleTaskCardAction={handleTaskCardAction}
        handleContentArtifactDecision={handleContentArtifactDecision}
        handleContentDeliveryCreate={handleContentDeliveryCreate}
        handleContentDeliveryDownload={handleContentDeliveryDownload}
      />

      {!inlineHome && <AssistantLauncher
        retracted={launcherRetracted}
        chatOpen={mode === 'chat'}
        badgeCount={decisionTotal ?? pendingCount}
        reduceMotion={reduceMotion}
        launcherButtonRef={launcherButtonRef}
        edgeLauncherButtonRef={edgeLauncherButtonRef}
        onLauncherClick={handleLauncherClick}
        onRetract={retractLauncher}
        onRestore={restoreLauncher}
      />}
    </div>
  );
  return inlineHomeAnchor ? createPortal(assistantRoot, inlineHomeAnchor) : assistantRoot;
}
