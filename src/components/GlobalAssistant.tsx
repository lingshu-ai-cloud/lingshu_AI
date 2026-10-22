import { isLegacyUnboundOperationNotice, isUnboundOperationError } from '../lib/assistantOperationNotice';
import { sameAssistantRequestIdentity } from '../lib/assistantRequestLifecycle';
import { executeAssistantAction } from '../lib/assistantActionRequest';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { App as AntApp, Button, Input } from 'antd';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowDown,
  Bot,
  X,
} from 'lucide-react';
import type { AgentAction, AgentType, Message, Page } from '../App';
import { authHeader, getToken } from '../lib/auth';
import { lsMotion } from '../lib/designTokens';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { selectAssistantConversationContext } from '../lib/assistantConversationContext';
import {
  assistantRunControl,
  shouldNotifyAssistant,
  type AssistantTaskCard,
  type AgentThreadState,
  type OrbitAgentId,
  useAssistantStore,
} from '../stores/assistantStore';
import AssistantComposer, { assistantAttachmentKind } from './assistant/AssistantComposer';
import AssistantConversationBubbles from './assistant/AssistantConversationBubbles';
import AssistantFloatingReminders from './assistant/AssistantFloatingReminders';
import AssistantLauncher from './assistant/AssistantLauncher';
import { actionCardToTaskCard, actionResponseCardId, focusedNaturalLanguageActionId, focusedNaturalLanguageActionInput, isWeeklyPlanKickoffRequest, notificationReasonFromResponse, responseWithoutCrossObjectActions } from './assistant/assistantActionProjection';
import AssistantQuickEntries from './assistant/AssistantQuickEntries';
import AssistantCustomerTodoView from './assistant/AssistantCustomerTodoView';
import { useContentTaskIntake } from './assistant/useContentTaskIntake';
import { useAssistantThreadSaveQueue } from './assistant/useAssistantThreadSaveQueue';
import { useAssistantThreadHydration } from './assistant/useAssistantThreadHydration';
import { buildAssistantChatMessages, type UploadedAssistantAttachment } from './assistant/assistantChatPrompt';
import { useAssistantFeatureGuides } from './assistant/useAssistantFeatureGuides';
import { useAssistantNotifications } from './assistant/useAssistantNotifications';
import { assistantProductionIntent } from './assistant/assistantProductionIntake';
import { runAssistantProductionRequest } from './assistant/assistantProductionRequest';
import { assistantFileIntent } from '../../shared/assistantFileIntent';
import { AssistantRequestTimeoutError, streamAssistantReply } from '../lib/assistantChatStream';
import { appendAssistantStreamFailure } from '../lib/assistantStreamCompletion';
import type { AssistantQuickExecution } from '../lib/assistantQuickEntries';
import AssistantWeeklyActions from './assistant/AssistantWeeklyActions';
import {
  assistantDecisionExecutionFeedback,
  type AssistantDecisionActionResult,
} from './assistant/AssistantDecisionCenter';
import AssistantDecisionDialog, { type AssistantDecisionDialog as AssistantDecisionDialogState } from './assistant/AssistantDecisionDialog';
import type { AssistantDecisionDeepLink, AssistantDecisionFeed } from '../../shared/contracts/assistantDecisionCenter';
import { assistantDecisionApi } from '../lib/assistantDecisionApi';
import {
  ASSISTANT_PRODUCTION_CONTEXT_EVENT,
  type AssistantProductionContext,
  type AssistantProductionContextEventDetail,
} from '../lib/assistantProductionDecision';
import { WEEKLY_WORK_UPDATED_EVENT } from '../lib/weeklyWorkEvents';
import KnowledgeIntakePanel, { type AppliedProfile } from './enterprise/KnowledgeIntakePanel';
import { studioApi } from '../lib/studioApi';
import { socialContentApi } from '../lib/socialContentApi';
import { readSocialContentNavigationTaskId, SOCIAL_CONTENT_NAVIGATION_EVENT } from '../lib/socialContentContext';
import { SOCIAL_CONTENT_TASK_REFRESH_EVENT } from '../lib/socialContentTaskRefresh';
import type { AssistantJournalScope } from '../lib/assistantThreadJournal';
import type {
  AssistantActionRequest,
  AssistantActionResponse,
} from '../../shared/contracts/assistantActions';
import {
  CURRENT_STATUS_TASK_ID,
  DEFAULT_CONTEXT,
  PRIMARY_ASSISTANT_THREAD,
  WORKFLOW_MUTATION_ACTIONS,
  agentForOrbit,
  assistantPersistenceCanRun,
  compactText,
  contextForOrbit,
  contextIdentifier,
  loadLiveIntegrationFacts,
  mergeConsecutiveAssistant,
  orbitIdForAgent,
  orbitIdForPage,
  pageKey,
  responseErrorMessage,
  type AssistantContext,
  type AssistantThreadSaveQueue,
} from './assistant/globalAssistantRuntime';

type AssistantTool = 'knowledge-intake';

const ASSISTANT_CONVERSATION_WELCOME_SEEN_KEY = 'lingshu-assistant-conversation-welcome-seen-v1';
const ASSISTANT_LAUNCHER_RETRACTED_KEY = 'lingshu-assistant-launcher-retracted-v1';

function readLauncherRetractedPreference() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ASSISTANT_LAUNCHER_RETRACTED_KEY) === 'true';
  } catch {
    return false;
  }
}

const ASSISTANT_ACTION_TIMEOUT_MS = 12_000;
const ASSISTANT_UI_WATCHDOG_TIMEOUT_MS = 25_000;
const ASSISTANT_CLOSED_CONVERSATION_TTL_MS = 5 * 60 * 1000;

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

const API_PATH: Record<AgentType, string> = {
  strategy: '/api/overseas/strategy/chat',
  traffic: '/api/overseas/agents/traffic/chat',
  conversion: '/api/overseas/agents/conversion/chat',
  retention: '/api/overseas/agents/retention/chat',
};

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
  const fadeTransition = { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.enter) / 1000, ease: lsMotion.ease.enter };
  const fadeExit = { opacity: 0, transition: { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.exit) / 1000, ease: lsMotion.ease.exit } };
  const spatialTransition = reduceMotion ? { duration: 0 } : { ...lsMotion.spring.standard, opacity: fadeTransition };
  const [mode, setMode] = useState<'breathing' | 'chat'>('breathing');
  const [launcherRetracted, setLauncherRetracted] = useState(readLauncherRetractedPreference);
  const [panelView, setPanelView] = useState<AssistantPanelView>('chat');
  const [decisionDialog, setDecisionDialog] = useState<AssistantDecisionDialogState>(null);
  const [decisionFeedRevision, setDecisionFeedRevision] = useState(0);
  const [decisionTotal, setDecisionTotal] = useState<number | null>(null);
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
  const decisionDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const decisionDialogKindRef = useRef<Exclude<AssistantDecisionDialogState, null>['kind'] | null>(null);
  const decisionDialogRestoreFocusRef = useRef(true);
  const handledDecisionResultsRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());
  const conversationPageRef = useRef(page);
  const assistantClosedRef = useRef<{ page: Page; at: number } | null>(null);
  const assistantThreadSaveQueuesRef = useRef(new Map<OrbitAgentId, AssistantThreadSaveQueue>());
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

  const persistLauncherRetraction = useCallback((retracted: boolean) => {
    setLauncherRetracted(retracted);
    try {
      window.localStorage.setItem(ASSISTANT_LAUNCHER_RETRACTED_KEY, String(retracted));
    } catch {
      // The explicit control remains usable when storage is unavailable.
    }
  }, []);

  const retractLauncher = useCallback(() => {
    persistLauncherRetraction(true);
    window.requestAnimationFrame(() => edgeLauncherButtonRef.current?.focus());
  }, [persistLauncherRetraction]);

  const restoreLauncher = useCallback(() => {
    persistLauncherRetraction(false);
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus());
  }, [persistLauncherRetraction]);

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
  const activeContext = useMemo(() => contextForOrbit(currentPageAgent, pageContext), [currentPageAgent, pageContext]);
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
  const focusedCardCandidate = activeThread.focusedTaskId
    ? activeThread.taskCards[activeThread.focusedTaskId] ?? null
    : null;
  const focusedTaskCard = isLegacyUnboundOperationNotice(focusedCardCandidate) ? null : focusedCardCandidate;
  const dialogTaskCard = decisionDialog?.kind === 'task'
    ? activeThread.taskCards[decisionDialog.taskId] ?? null
    : null;
  const focusedRunControl = assistantRunControl(dialogTaskCard);
  const todoItems = pageContext.todoItems ?? [];
  const activeTodoItems = todoItems.filter(item => !item.completed);
  const completedTodoItems = todoItems.filter(item => item.completed);
  const orderedTodoItems = [...activeTodoItems, ...completedTodoItems];
  const pendingCount = todoItems.length ? activeTodoItems.length : Math.max(0, Number(pageContext.pendingCount ?? 0));
  const activeAgentLabel = '灵小枢';
  const isCustomerTodoView = panelView === 'todo' && pageContext.agent === 'conversion';
  const panelTitle = assistantTool === 'knowledge-intake'
    ? '灵小枢 · 快速采集'
    : isCustomerTodoView ? '今日待办' : activeAgentLabel;
  const panelSubtitle = assistantTool === 'knowledge-intake'
    ? '当前：智能客服规范'
    : isCustomerTodoView ? '当前：我的客户' : `当前：${activeContext.label}`;
  const assistantUsesMobileClearance = viewport.width < 768
    && (page === 'conversion' || page === 'smartAssets' || page === 'digitalEmployees');
  const assistantPanelHeight = Math.max(120, Math.min(720, viewport.height - (assistantUsesMobileClearance ? 160 : 96)));
  const assistantPanelWidth = Math.min(assistantTool === 'knowledge-intake' ? 560 : 420, viewport.width - 32);

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
        { role: 'assistant', content: '本次连接在 25 秒内没有返回，已停止等待。模型服务已配置，但当前本地对话链路没有及时响应，请重新发送。' },
      ]);
      setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
    }, ASSISTANT_UI_WATCHDOG_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [loading, setFollowingLatest, setMessages]);

  const persistThread = useAssistantThreadSaveQueue({
    stablePersistenceScope, persistenceFenceRef, assistantThreadSaveQueuesRef,
    hydrateThread, setPersistenceMetadata,
  });

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
    const closed = assistantClosedRef.current;
    if (
      closed
      && closed.page === page
      && Date.now() - closed.at >= ASSISTANT_CLOSED_CONVERSATION_TTL_MS
    ) resetTransientConversation();
    assistantClosedRef.current = null;
    openAgent(currentPageAgent, 'chat');
  }, [currentPageAgent, openAgent, page, resetTransientConversation]);

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
    // The conversation summary owns an independent request. Refresh it only
    // after the external dialog closes so opening a detail does not immediately
    // remount the trigger or duplicate the authoritative detail request.
    setDecisionFeedRevision(revision => revision + 1);
  }, []);

  const closeDecisionDialogForNavigation = useCallback((_link?: AssistantDecisionDeepLink) => {
    // Navigation replaces the trigger's page context. Close the external
    // detail immediately, but do not move focus back into the page being left.
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
      // Closing refreshes the authoritative summary, so the original trigger
      // may have been replaced. Restore focus to its current semantic peer.
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
  }, []);

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
      setMessages(PRIMARY_ASSISTANT_THREAD, [...messages, { role: 'assistant', content }]);
      upsertTaskCard(PRIMARY_ASSISTANT_THREAD, { taskId: `social-content:${taskId}`, title: response.task.brief.title, conclusion: content,
        status: response.receipt.status === 'producing' ? 'running' : ['completed', 'delivered', 'published'].includes(response.receipt.status) ? 'completed' : response.receipt.status === 'paused' ? 'paused' : 'needs_input', notificationReason: 'routine',
        primaryAction: { id: `open-${taskId}`, label: '查看生产任务', href: `/?page=smartAssets&socialContentTaskId=${encodeURIComponent(taskId)}` } });
      persistThread(PRIMARY_ASSISTANT_THREAD);
      window.dispatchEvent(new CustomEvent(WEEKLY_WORK_UPDATED_EVENT));
      void onSessionRefresh?.(); setPipelineRefresh(value => value + 1);
    },
    onFinish: taskId => {
      setMode('breathing');
      window.dispatchEvent(new CustomEvent('lingshu:navigate', {
        detail: { page: 'smartAssets', socialContentTaskId: taskId, socialContentPage: 'smartAssets', directStudio: true },
      }));
    },
  });

  const send = useCallback(async (
    text: string,
    routeAgent = currentPageAgent,
    forcedContext?: AssistantContext,
    uploadedAttachments: UploadedAssistantAttachment[] = [],
  ) => {
    const userText = text.trim();
    if ((!userText && !uploadedAttachments.length) || loading || fileGenerating || replyStreaming) return;
    if (contentIntake.active) {
      if (uploadedAttachments.length) { void uiMessage.warning('请先完成或取消当前任务问答，再发送附件。'); return; }
      contentIntake.answer(userText);
      setDraftInput(PRIMARY_ASSISTANT_THREAD, '');
      return;
    }
    const requestToken = getToken();
    const requestFence = persistenceFenceRef.current;
    const currentInstance = () => (
      requestFence.active
      && persistenceFenceRef.current === requestFence
      && sameAssistantRequestIdentity(requestToken, getToken(), stablePersistenceScope)
    );
    // The fence is bound to tenantId + userId and is invalidated when the
    // authenticated scope changes. A same-user local-preview token rotation
    // must not discard an in-flight answer or leave its UI state unresolved.
    const currentScope = currentInstance;
    const clearLoadingForCurrentInstance = () => {
      if (currentInstance()) setLoading(false);
    };
    const visibleText = userText || '请基于这次附件继续处理。';
    const visibleAttachmentSummary = uploadedAttachments.length
      ? `\n\n附件（已保存到我的素材）：${uploadedAttachments.map(item => item.name).join('、')}`
      : '';
    const visibleMessage = `${visibleText}${visibleAttachmentSummary}`;

    const threadAgent = PRIMARY_ASSISTANT_THREAD;
    const thread = useAssistantStore.getState().threads[threadAgent];
    const context = forcedContext ?? contextForOrbit(routeAgent, pageContext);
    const strategyRequest = agentForOrbit(routeAgent) === 'strategy';
    const enterpriseBrief = compactText(enterpriseContext);
    const conversationContext = selectAssistantConversationContext(mergeConsecutiveAssistant(thread.messages));
    const historyForApi = conversationContext.messages;
    const nextVisible = [...mergeConsecutiveAssistant(thread.messages), { role: 'user' as const, content: visibleMessage }];
    setMessages(threadAgent, nextVisible);
    setDraftInput(threadAgent, '');
    setFollowingLatest(threadAgent, true);
    setLoading(true);
    openAgent(routeAgent, 'chat');

    const clarifiedDiagram = pendingMapFileRef.current && /(?:业务|路线图|思维导图|流程图|战略)/u.test(visibleText);
    const fileIntent = assistantFileIntent(visibleText) || (clarifiedDiagram ? { format: 'jpg' as const, diagram: true, needsMapScope: false } : null);
    if (fileIntent?.needsMapScope) {
      pendingMapFileRef.current = true;
      setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: '你需要的是业务路线图，还是地理地图？业务路线图可以导出 JPG；地理地图还需要明确地区、标注内容和可靠地图来源，不能用文字示意图冒充真实地图。' }]);
      setLoading(false); persistThread(threadAgent); return;
    }
    pendingMapFileRef.current = false;
    const productionIntent = uploadedAttachments.length || fileIntent ? null : assistantProductionIntent(visibleText);
    if (productionIntent && ['smartAssets', 'socialInspiration'].includes(page)) {
      setLoading(false);
      contentIntake.start(productionIntent.objective, productionIntent);
      return;
    }
    if (productionIntent) {
      await runAssistantProductionRequest({
        productionIntent, threadAgent, currentScope, pipelineModalOpenRef,
        modal, uiMessage, setLoading, upsertTaskCard, setMessages, persistThread,
        onSessionRefresh,
        refreshPipeline: () => setPipelineRefresh(value => value + 1),
        closeForNavigation: () => {
          setAssistantTool(null);
          setPanelView('chat');
          setWelcomeBubbleVisible(false);
          setMode('breathing');
        },
        requestId,
      });
      return;
    }

    const focusedCard = thread.focusedTaskId ? thread.taskCards[thread.focusedTaskId] ?? null : null;
    // Attachments deliberately bypass the deterministic action router. The
    // router accepts only server-signed business object/version inputs; a
    // newly uploaded material must never be guessed into those parameters.
    const focusedMutationActionId = uploadedAttachments.length || fileIntent ? undefined : focusedNaturalLanguageActionId(visibleText);
    const focusedActionInput = focusedMutationActionId
      ? focusedNaturalLanguageActionInput(focusedCard, focusedMutationActionId)
      : undefined;
    const signedFocusedMutationActionId = focusedActionInput ? focusedMutationActionId : undefined;

    const deterministicRequest: AssistantActionRequest = {
      source: 'natural_language',
      requestId: requestId(),
      text: visibleText,
      page,
      ...(signedFocusedMutationActionId ? { actionId: signedFocusedMutationActionId } : {}),
      ...(focusedActionInput ?? {}),
    };
    // Ordinary conversation must reach the chat model directly. Reserve the
    // deterministic router for an operation that the UI can bind to exactly
    // one server-authored card, object id and expected version. Routing every
    // sentence first can misclassify harmless wording as an unsigned mutation
    // and prevent the Qwen request from starting.
    const actionResponse = signedFocusedMutationActionId
      ? await executeAssistantAction(
        threadAgent,
        deterministicRequest,
        { deterministicActionId: signedFocusedMutationActionId },
      )
      : null;
    if (!currentScope()) {
      clearLoadingForCurrentInstance();
      return;
    }
    if (actionResponse && actionResponse.status !== 'delegated' && actionResponse.status !== 'not_handled') {
      presentActionResponse(threadAgent, deterministicRequest, actionResponse);
      setLoading(false);
      persistThread(threadAgent);
      onSessionRefresh?.();
      return;
    }

    const liveIntegrationFacts = strategyRequest ? '' : await loadLiveIntegrationFacts();
    if (!currentScope()) {
      clearLoadingForCurrentInstance();
      return;
    }
    const apiMessages = buildAssistantChatMessages({
      historyForApi, conversationContext, strategyRequest, visibleText, context,
      enterpriseBrief, liveIntegrationFacts, uploadedAttachments, fileIntent, now: new Date(),
    });

    let assistantStarted = false;
    setReplyStreaming(true);
    let fileMessageIndex = -1;
    if (fileIntent) setFileGenerating(true);
    const ensureAssistant = () => {
      if (!currentScope()) return;
      if (assistantStarted) return;
      assistantStarted = true;
      const current = useAssistantStore.getState().threads[threadAgent].messages;
      fileMessageIndex = current.length;
      setMessages(threadAgent, [...current, { role: 'assistant', content: fileIntent ? `正在整理并生成 ${fileIntent.format.toUpperCase()} 文件…` : '' }]);
      setLoading(false);
    };
    const patchAssistant = (patch: (msg: Message) => Message) => {
      if (!currentScope()) return;
      ensureAssistant();
      if (!assistantStarted) return;
      const current = [...useAssistantStore.getState().threads[threadAgent].messages];
      const index = fileMessageIndex;
      if (index < 0 || current[index]?.role !== 'assistant') return;
      current[index] = patch(current[index]);
      setMessages(threadAgent, current);
    };

    let chatTimedOut = false;
    const controller = new AbortController();
    try {
      abortRef.current?.abort();
      abortRef.current = controller;
      await streamAssistantReply({
        endpoint: API_PATH[agentForOrbit(routeAgent)],
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: {
          messages: apiMessages,
          deepThinking: false,
          ...(strategyRequest ? {
            userQuestion: visibleText,
            pageContext: {
              label: context.label,
              summary: compactText(context.summary, 2000),
              goalId: context.goalId,
              planId: context.planId,
              runId: context.runId,
              taskId: context.taskId,
              contentId: context.contentId,
              viewKey: context.viewKey,
            },
            conversationContext: {
              omittedTurns: conversationContext.omittedTurns,
              retainedUserInstructions: conversationContext.retainedUserInstructions,
            },
          } : {}),
        },
        controller,
        fileIntent,
        fileTitle: visibleText.replace(/^(?:请|帮我|生成|导出|制作|给我|想要)+/u, '').trim().slice(0, 100) || '会话文档',
        isCurrent: currentScope,
        onStart: ensureAssistant,
        onText: text => patchAssistant(msg => ({ ...msg, content: msg.content + text })),
        onSources: sources => patchAssistant(msg => ({ ...msg, sources })),
        onFileReady: content => patchAssistant(msg => ({ ...msg, content })),
        onTimeout: () => { chatTimedOut = true; },
        responseErrorMessage,
      });
    } catch (err: any) {
      if (!currentScope()) return;
      const message = err instanceof AssistantRequestTimeoutError || chatTimedOut
        ? `${err instanceof Error ? err.message : '这次回答等待超时。'} 请重新发送。`
        : err?.name === 'AbortError'
          ? '这次响应已停止。'
        : (err?.message || '请求失败，请稍后重试。');
      if (assistantStarted) patchAssistant(msg => ({ ...msg, content: fileIntent ? `文件未生成：${message}` : msg.content ? appendAssistantStreamFailure(msg.content, message) : message }));
      else setMessages(threadAgent, [...useAssistantStore.getState().threads[threadAgent].messages, { role: 'assistant', content: message }]);
    } finally {
      controller.abort();
      if (abortRef.current === controller) {
        setLoading(false);
        setFileGenerating(false);
        setReplyStreaming(false);
        abortRef.current = null;
      }
      if (currentScope()) {
        persistThread(threadAgent);
        onSessionRefresh?.();
      }
    }
  }, [replyStreaming, fileGenerating, contentIntake, currentPageAgent, enterpriseContext, executeAssistantAction, loading, modal, uiMessage, onSessionRefresh, openAgent, page, pageContext, persistThread, presentActionResponse, setDraftInput, setFollowingLatest, setMessages, upsertTaskCard, stablePersistenceScope]);

  const sendComposerMessage = useCallback(async () => {
    if (loading || attachmentUploading) return;
    const draft = activeThread.draftInput;
    const files = [...pendingAttachments];
    if (!draft.trim() && !files.length) return;
    if (contentIntake.active) {
      if (files.length) { setAttachmentError('请先完成或取消当前任务问答，再发送附件。'); return; }
      void send(draft); return;
    }
    if (!files.length && weeklyPlanKickoffAvailable && isWeeklyPlanKickoffRequest(draft)) {
      const current = useAssistantStore.getState().threads[activeAgent].messages;
      setDraftInput(activeAgent, '');
      setMessages(activeAgent, [
        ...current,
        { role: 'user', content: draft.trim() },
        { role: 'assistant', content: '可以。我先为你生成一份可预览的周计划；你核对平台、产量、预算和排期并确认后，数字员工才会开始生产。' },
      ]);
      setFollowingLatest(activeAgent, true);
      persistThread(activeAgent);
      openWeeklyPlanFromAssistant();
      return;
    }
    if (!files.length) {
      void send(draft);
      return;
    }

    setAttachmentError('');
    setAttachmentUploading(true);
    try {
      const uploaded: UploadedAssistantAttachment[] = [];
      for (const file of files) {
        const cached = uploadedAttachmentCacheRef.current.get(file);
        if (cached) {
          uploaded.push(cached);
          continue;
        }
        const kind = assistantAttachmentKind(file);
        if (!kind) throw new Error(`${file.name} 不是可上传的图片、视频或音频。`);
        const result = await studioApi.uploadMaterialFile(file, {
          folder: 'assistant',
          type: kind,
          sourceType: 'assistant-chat',
        });
        if (!result.ok || !result.material?.id) {
          throw new Error(result.error || `${file.name} 上传失败，请重试。`);
        }
        const attachment: UploadedAssistantAttachment = {
          name: file.name,
          size: file.size,
          kind,
          materialId: result.material.id,
          ...(result.material.url ? { materialUrl: result.material.url } : {}),
        };
        uploadedAttachmentCacheRef.current.set(file, attachment);
        uploaded.push(attachment);
      }
      setPendingAttachments([]);
      setAttachmentUploading(false);
      void send(draft, currentPageAgent, undefined, uploaded);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件上传失败，请重试。');
      setAttachmentUploading(false);
    }
  }, [contentIntake.active, activeAgent, activeThread.draftInput, attachmentUploading, currentPageAgent, loading, openWeeklyPlanFromAssistant, pendingAttachments, persistThread, send, setDraftInput, setFollowingLatest, setMessages, weeklyPlanKickoffAvailable]);

  const runQuickExecution = useCallback(async function executeEntry(entry: AssistantQuickExecution, confirmations = 0, executionRequestId = `quick-${requestId()}`, fence = persistenceFenceRef.current) {
    if (loading || fileGenerating || pipelineInFlightRef.current) return;
    const currentScope = () => fence.active && persistenceFenceRef.current === fence;
    if (entry.id === 'business-create-week-plan') { openWeeklyPlanFromAssistant(); return; }
    const openTask = (taskId: string) => {
      setMode('breathing');
      window.dispatchEvent(new CustomEvent('lingshu:navigate', {
        detail: { page: 'smartAssets', socialContentTaskId: taskId, socialContentPage: 'smartAssets', directStudio: true },
      }));
    };
    const recordReceipt = (content: string, taskId?: string, status?: string) => {
      const messages = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
      setMessages(PRIMARY_ASSISTANT_THREAD, [...messages, { role: 'assistant', content }]);
      if (taskId) {
        upsertTaskCard(PRIMARY_ASSISTANT_THREAD, { taskId: `social-content:${taskId}`, title: '内容周任务', conclusion: content,
          status: status === 'producing' ? 'running' : ['completed', 'delivered', 'published'].includes(status || '') ? 'completed' : status === 'paused' ? 'paused' : 'needs_input', notificationReason: 'routine',
          primaryAction: { id: `open-${taskId}`, label: '查看生产任务', href: `/?page=smartAssets&socialContentTaskId=${encodeURIComponent(taskId)}` } });
      }
      persistThread(PRIMARY_ASSISTANT_THREAD);
      window.dispatchEvent(new CustomEvent(WEEKLY_WORK_UPDATED_EVENT));
      void onSessionRefresh?.();
      setPipelineRefresh(value => value + 1);
    };
    if (entry.operation === 'create') {
      contentIntake.start();
      return;
    }
    if (!entry.taskId || !entry.expectedVersion) return;
    if (entry.operation === 'open') { openTask(entry.taskId); return; }
    if (entry.operation === 'revise' && entry.artifactId) {
      if (pipelineModalOpenRef.current) return;
      pipelineModalOpenRef.current = true;
      let note = '';
      modal.confirm({ title: '修改当前交付物',
        content: <label className="block">修改要求<Input.TextArea rows={4} onChange={event => { note = event.target.value; }} /></label>,
        okText: '提交返工', cancelText: '取消',
        afterClose: () => { pipelineModalOpenRef.current = false; },
        onOk: async () => {
          if (!note.trim()) { void uiMessage.error('请填写具体修改要求。'); throw new Error('请填写具体修改要求。'); }
          if (!currentScope() || pipelineInFlightRef.current) return;
          pipelineInFlightRef.current = true;
          try {
            const response = await socialContentApi.reviseAssistantAction(entry.taskId!, entry.artifactId!, entry.expectedVersion!, note.trim(), executionRequestId);
            if (!currentScope()) return;
            recordReceipt(response.receipt.blockedReason === 'weekly_revision_scope_confirmation_required'
              ? '修改要求已记录到原周任务，请在生产页面确认返工范围与预算后继续。'
              : '修改要求已提交原周任务，返工交付物将回收到该任务。', response.receipt.taskId, response.receipt.status);
            openTask(response.receipt.taskId);
          } catch (error) { if (currentScope()) { recordReceipt(error instanceof Error ? error.message : '修改未提交，请重试。'); void uiMessage.error(error instanceof Error ? error.message : '修改未提交，请重试。'); } throw error; }
          finally { pipelineInFlightRef.current = false; }
        },
      });
      return;
    }
    if (!confirmations) {
      if (pipelineModalOpenRef.current) return;
      pipelineModalOpenRef.current = true;
      modal.confirm({ title: entry.label, content: '推进当前任务的生产流程，保留原周任务和已有交付物。',
        afterClose: () => { pipelineModalOpenRef.current = false; },
        okText: '确认执行', cancelText: '取消', onOk: () => executeEntry(entry, 1, executionRequestId, fence) });
      return;
    }
    if (!currentScope()) return;
    pipelineInFlightRef.current = true;
    setLoading(true);
    try {
      const response = await socialContentApi.startAssistantAction(entry.taskId, entry.expectedVersion, executionRequestId);
      if (!currentScope()) return;
      recordReceipt(`「${response.task.brief.title}」：${response.receipt.blockedReason ? '暂未进入生产，请在任务中查看原因。' : '已读取真实生产状态，结果回收到原周任务。'}`, response.receipt.taskId, response.receipt.status);
      openTask(response.receipt.taskId);
    } catch (error) {
      if (currentScope()) recordReceipt(error instanceof Error ? error.message : '生产未启动，请重试。');
    } finally { pipelineInFlightRef.current = false; if (currentScope()) { setLoading(false); setPipelineRefresh(value => value + 1); } }
  }, [fileGenerating, contentIntake, loading, modal, uiMessage, onSessionRefresh, openWeeklyPlanFromAssistant, persistThread, setMessages, upsertTaskCard]);

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
  }, [activeAgent, closeDecisionDialog, closeDecisionDialogForNavigation, currentPageAgent, executeAssistantAction, onSessionRefresh, page, persistThread, presentActionResponse, send]);

  const assistantThreadHydrated = useAssistantThreadHydration({
    page, stablePersistenceScope, persistThread, hydrateThread,
    executeAssistantAction, upsertTaskCard, focusTaskCard, requestId,
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
  }, [page]);

  useEffect(() => {
    setWeeklyPlanPromptDismissed(false);
  }, [normalizedPage, pageContext.workflowStage]);

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
        goalId: pageContext.goalId,
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
  }, [mode, page, pageContext.goalId, persistenceScopeKey, suppressForRightSidebar]);

  const { performance, performanceHidden, setPerformanceHidden, performanceMessage,
    speechBubble, setSpeechBubble } = useAssistantNotifications({
    mode, setMode, primaryEntry, compactMode, focusTaskCard, setUnreadCount, upsertTaskCard,
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; assistantText?: string; context?: Partial<AssistantContext>; tool?: AssistantTool }>).detail;
      let targetContext = pageContext;
      if (detail?.context?.agent && detail.context.label && detail.context.summary) {
        targetContext = {
          agent: detail.context.agent,
          label: detail.context.label,
          summary: detail.context.summary,
          suggestions: detail.context.suggestions?.length ? detail.context.suggestions : pageContext.suggestions,
          pendingCount: typeof detail.context.pendingCount === 'number' ? detail.context.pendingCount : pageContext.pendingCount,
          todoItems: Array.isArray(detail.context.todoItems) ? detail.context.todoItems : pageContext.todoItems,
        };
        setLiveContext(targetContext);
      }
      const routeAgent = orbitIdForAgent(targetContext.agent, currentPageAgent);
      openAgent(routeAgent, 'chat');
      if (detail?.tool === 'knowledge-intake') setAssistantTool('knowledge-intake');
      const assistantText = detail?.assistantText?.trim();
      if (assistantText) {
        const current = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
        setMessages(PRIMARY_ASSISTANT_THREAD, [...current, { role: 'assistant', content: assistantText }]);
      }
      const text = detail?.text?.trim();
      if (text) window.setTimeout(() => void send(text, routeAgent, targetContext), 0);
    };
    window.addEventListener('lingshu-assistant-open', handler);
    return () => window.removeEventListener('lingshu-assistant-open', handler);
  }, [currentPageAgent, openAgent, pageContext, send]);

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

    // Ordinary navigation starts a fresh, page-local conversation. Saved
    // conversations and explicit task kickoffs carry their own content across
    // navigation and are therefore exempt from this transient reset.
    if (restore || kickoff) return;
    assistantClosedRef.current = null;
    resetTransientConversation();
    focusTaskCard(PRIMARY_ASSISTANT_THREAD, null);
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
    if (mode !== 'chat') return;
    const timer = window.setTimeout(() => persistThread(activeAgent), 500);
    return () => window.clearTimeout(timer);
  }, [activeAgent, activeThread.draftInput, activeThread.focusedTaskId, activeThread.isFollowingLatest, activeThread.messages, activeThread.paused, activeThread.scrollPosition, activeThread.taskCards, activeThread.unreadCount, mode, persistThread]);

  const closeAssistant = useCallback(() => {
    persistThread(activeAgent);
    assistantClosedRef.current = { page, at: Date.now() };
    setAssistantTool(null);
    setPanelView('chat');
    setDecisionDialog(null);
    setWelcomeBubbleVisible(false);
    setMode('breathing');
    window.requestAnimationFrame(() => {
      if (launcherRetracted) edgeLauncherButtonRef.current?.focus();
      else launcherButtonRef.current?.focus();
    });
  }, [activeAgent, launcherRetracted, page, persistThread]);

  const returnToConversation = useCallback(() => {
    const thread = useAssistantStore.getState().threads[activeAgent];
    setPanelView('chat');
    window.requestAnimationFrame(() => {
      const scroller = messageScrollRef.current;
      if (!scroller) return;
      if (!thread.isFollowingLatest) scroller.scrollTop = thread.scrollPosition;
      else scroller.scrollTop = scroller.scrollHeight;
    });
  }, [activeAgent]);

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
  }, [activeAgent, executeAssistantAction, focusedRunControl, loading, onSessionRefresh, page, persistThread, presentActionResponse]);

  const handleLauncherClick = () => {
    if (mode === 'chat') {
      closeAssistant();
      return;
    }
    if (assistantTool === 'knowledge-intake') {
      setMode('chat');
      return;
    }
    openCurrentPageAgent();
  };

  useEffect(() => {
    if (mode !== 'chat' && assistantTool !== 'knowledge-intake') return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || decisionDialog) return;
      closeAssistant();
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [assistantTool, closeAssistant, decisionDialog, mode]);

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (suppressForRightSidebar) return null;

  return (
    <div
      data-global-assistant="root"
      className={`fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[75] md:bottom-5 ${launcherRetracted && mode === 'breathing' ? 'right-0 md:right-0' : 'right-4 md:right-5'}`}
    >
      <AssistantFloatingReminders
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
      />

      <AnimatePresence>
        {(mode === 'chat' || assistantTool === 'knowledge-intake') && (
          <motion.section
            data-global-assistant="panel"
            id="global-assistant-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby="global-assistant-panel-title"
            aria-describedby="global-assistant-panel-description"
            tabIndex={-1}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={mode === 'chat' ? { opacity: 1, y: 0 } : { opacity: 0, y: reduceMotion ? 0 : 8 }}
            exit={{ y: reduceMotion ? 0 : 8, opacity: 0, transition: { ...spatialTransition, opacity: fadeExit.transition } }}
            transition={spatialTransition}
            className={`absolute bottom-14 right-0 z-10 flex max-h-[calc(100dvh-env(safe-area-inset-bottom)-96px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl outline-none ${assistantTool === 'knowledge-intake' ? 'w-[560px]' : 'w-[420px]'} ${mode === 'chat' ? 'pointer-events-auto visible' : 'pointer-events-none invisible'}`}
            style={{
              height: assistantPanelHeight,
              width: assistantPanelWidth,
              maxWidth: 'calc(100vw - 32px)',
            }}
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-gradient-to-r from-blue-50 via-violet-50 to-pink-50 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (assistantTool === 'knowledge-intake') {
                      setAssistantTool(null);
                      returnToConversation();
                    } else if (panelView !== 'chat') returnToConversation();
                    else closeAssistant();
                  }}
                  className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={assistantTool === 'knowledge-intake' || panelView !== 'chat' ? '返回灵小枢对话' : '收起灵小枢对话'}
                  title={assistantTool === 'knowledge-intake' || panelView !== 'chat' ? '返回灵小枢对话' : '收起灵小枢对话'}
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p id="global-assistant-panel-title" className="ls-type-title-small truncate text-text-primary">{panelTitle}</p>
                  <p id="global-assistant-panel-description" className="ls-type-body-small truncate text-text-muted">{panelSubtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={closeAssistant} className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" title="关闭窗口（任务继续）" aria-label="关闭灵枢助手窗口，任务继续运行">
                  <X size={15} />
                </button>
              </div>
            </header>

            {assistantTool === 'knowledge-intake' ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-3">
                <KnowledgeIntakePanel
                  mode="center"
                  compact
                  onApplied={(profile: AppliedProfile) => {
                    window.dispatchEvent(new CustomEvent('lingshu:knowledge-intake-applied', { detail: { profile } }));
                    onSessionRefresh?.();
                  }}
                />
              </div>
            ) : isCustomerTodoView ? (
              <AssistantCustomerTodoView items={orderedTodoItems} pendingCount={pendingCount}
                onBack={returnToConversation} onSelect={id => {
                  window.dispatchEvent(new CustomEvent('lingshu:select-customer', { detail: { id } }));
                  returnToConversation();
                }} />
            ) : (
              <>
                <div
                  ref={messageScrollRef}
                  data-assistant-surface="conversation"
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                  onScroll={event => {
                    const scroller = event.currentTarget;
                    setScrollPosition(activeAgent, scroller.scrollTop);
                    setFollowingLatest(
                      activeAgent,
                      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24,
                    );
                  }}
                >
                  <AssistantConversationBubbles
                    page={page}
                    goalId={pageContext.goalId}
                    productionContext={productionDecisionContext}
                    decisionFeedRevision={decisionFeedRevision}
                    decisionFeedKey={`${persistenceScopeKey}:${page}:${pageContext.goalId || 'latest'}:summary:${decisionFeedRevision}`}
                    decisionFeedActive={mode === 'chat' && panelView === 'chat'}
                    onOpenChat={returnToConversation}
                    onOpenFeedDetail={trigger => openDecisionDialog({ kind: 'feed' }, trigger)}
                    onFeedChange={handleDecisionFeedChange}
                    welcomeBubbleVisible={welcomeBubbleVisible}
                    activeAgentLabel={activeAgentLabel}
                    messages={activeThread.messages}
                    onAction={onAction}
                    onSuggest={suggestion => void send(suggestion, currentPageAgent)}
                    contentIntakeNode={contentIntake.node}
                    loading={loading}
                    focusedTaskCard={focusedTaskCard}
                    onOpenTaskDetail={(trigger, taskId) => {
                      focusTaskCard(activeAgent, taskId);
                      openDecisionDialog({ kind: 'task', taskId }, trigger);
                    }}
                    weeklyPlanKickoffAvailable={weeklyPlanKickoffAvailable}
                    onOpenWeeklyPlan={openWeeklyPlanFromAssistant}
                  />
                </div>

                {!activeThread.isFollowingLatest && (
                  <div className="flex shrink-0 justify-center border-t border-border/60 bg-surface px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const scroller = messageScrollRef.current;
                        if (scroller) scroller.scrollTop = scroller.scrollHeight;
                        setFollowingLatest(activeAgent, true);
                        setScrollPosition(activeAgent, scroller?.scrollHeight ?? activeThread.scrollPosition);
                      }}
                      className="ls-type-label-small inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label="回到最新消息"
                    >
                      <ArrowDown size={12} /> 回到最新消息
                    </button>
                  </div>
                )}

                {!contentIntake.active && <AssistantQuickEntries
                  page={page}
                  executions={[
                    ...(page === 'digitalEmployees' ? [{ id: 'business-create-week-plan', kind: 'execute' as const,
                      label: weeklyPlanKickoffAvailable ? '制定本周计划' : '查看当前周计划', prompt: '打开当前周计划', confirmation: 'none' as const }] : []),
                    ...(['smartAssets', 'socialInspiration'].includes(page) ? [{ id: 'content-create-single', kind: 'execute' as const,
                      label: '新建单条内容任务', prompt: '填写产品和内容目标', confirmation: 'preview' as const, operation: 'create' as const }] : []),
                    ...pipelineEntries,
                  ]}
                  disabled={loading || fileGenerating || attachmentUploading}
                  onQuestion={entry => void send(entry.prompt, currentPageAgent)}
                  onExecute={entry => void runQuickExecution(entry)}
                />}

                <AssistantWeeklyActions
                  page={page}
                  scopeKey={persistenceScopeKey}
                  disabled={loading || attachmentUploading}
                  onBusyChange={setWeeklyActionBusy}
                  onReceipt={receipt => {
                    const thread = useAssistantStore.getState().threads[activeAgent];
                    setMessages(activeAgent, [...thread.messages, { role: 'assistant', content: receipt.message }]);
                    persistThread(activeAgent);
                    setDecisionFeedRevision(value => value + 1);
                    onSessionRefresh?.();
                    window.dispatchEvent(new CustomEvent('lingshu:weekly-tasks-updated', { detail: { programId: receipt.programId, packageId: receipt.packageId, packageVersion: receipt.packageVersion } }));
                    const navigation = receipt.navigation;
                    if (navigation?.href && /^\/\?page=(?:smartAssets|digitalEmployees|traffic)(?:&|$)/.test(navigation.href)) {
                      setMode('breathing');
                      window.location.assign(navigation.href);
                    } else if (navigation?.page && ['smartAssets', 'digitalEmployees', 'traffic'].includes(navigation.page)) {
                      setMode('breathing');
                      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: navigation }));
                    }
                  }}
                />
                <AssistantComposer
                  ref={assistantInputRef}
                  draft={activeThread.draftInput}
                  files={pendingAttachments}
                  disabled={loading || replyStreaming || fileGenerating || contentIntake.busy || weeklyActionBusy}
                  uploading={attachmentUploading}
                  error={attachmentError}
                  onDraftChange={value => setDraftInput(activeAgent, value)}
                  onFilesChange={files => {
                    setPendingAttachments(files);
                    if (!files.length) setAttachmentError('');
                  }}
                  onValidationError={setAttachmentError}
                  onSubmit={() => void sendComposerMessage()}
                />
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

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
      />

      <AssistantLauncher
        retracted={launcherRetracted}
        chatOpen={mode === 'chat'}
        badgeCount={decisionTotal ?? pendingCount}
        launcherButtonRef={launcherButtonRef}
        edgeLauncherButtonRef={edgeLauncherButtonRef}
        onLauncherClick={handleLauncherClick}
        onRetract={retractLauncher}
        onRestore={restoreLauncher}
      />
    </div>
  );
}
