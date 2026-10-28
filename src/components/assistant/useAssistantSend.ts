import { upsertAssistantWork } from '../../../shared/contracts/assistantWork';
import { businessSceneFollowup, defaultBusinessPeriod, isBusinessScene, type BusinessSceneSelection } from '../../../shared/contracts/assistantBusinessScene';
import { requestCreationReply } from './contentCreationRequest';
import { assistantScenarioIntake } from '../../lib/assistantScenarioIntake';
import type { CreationTurn } from '../../../shared/contracts/contentCreationDialogue';
import { useCreationMode } from '../../lib/creationMode';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { App as AntApp } from 'antd';
import type { AgentType, AssistantReferenceMedia, Message, Page } from '../../App';
import { authHeader, getToken } from '../../lib/auth';
import { sameAssistantRequestIdentity } from '../../lib/assistantRequestLifecycle';
import { executeAssistantAction } from '../../lib/assistantActionRequest';
import { selectAssistantConversationContext } from '../../lib/assistantConversationContext';
import { AssistantRequestTimeoutError, streamAssistantReply } from '../../lib/assistantChatStream';
import { appendAssistantStreamFailure } from '../../lib/assistantStreamCompletion';
import type { AssistantJournalScope } from '../../lib/assistantThreadJournal';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';
import { studioApi } from '../../lib/studioApi';
import type { AssistantActionRequest, AssistantActionResponse } from '../../../shared/contracts/assistantActions';
import { assistantFileIntent } from '../../../shared/assistantFileIntent';
import { confirmedTaskPortal } from '../../../shared/contracts/assistantTaskPortal';
import { assistantSourceFollowUp } from '../../lib/assistantFollowUp';
import { confirmedAssistantNavigation } from '../../lib/assistantNavigationPortal';
import { focusedNaturalLanguageActionId, focusedNaturalLanguageActionInput,
  isWeeklyPlanKickoffRequest } from './assistantActionProjection';
import { assistantAttachmentKind } from './AssistantComposer';
import { buildAssistantChatMessages, type UploadedAssistantAttachment } from './assistantChatPrompt';
import { assistantProductionIntent, assistantCreationPortal } from './assistantProductionIntake';
import { assistantImageReplicationPortal } from './assistantImageReplicationIntent';
import { assistantImageRevisionTarget, ASSISTANT_IMAGE_REVISION_EVENT } from '../../lib/assistantImageRevision';
import { ASSISTANT_HOME_PROMPTS, assistantReplyPresentationForPromptId, assistantReplyPresentationForText, isAssistantHomeQuickTaskText } from '../../lib/assistantHomeQuickPrompts';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { weeklyTaskReply } from '../contentCreationHomeReplies';
import { runAssistantProductionRequest } from './assistantProductionRequest';
import type { useContentTaskIntake } from './useContentTaskIntake';
import type { AssistantHomePendingSubmission } from './useAssistantHomeAnchor';
import { agentForOrbit, compactText, contextForOrbit, loadLiveIntegrationFacts,
  mergeConsecutiveAssistant, PRIMARY_ASSISTANT_THREAD, responseErrorMessage,
  type AssistantContext } from './globalAssistantRuntime';

type StoreActions = ReturnType<typeof useAssistantStore.getState>;
type AppServices = ReturnType<typeof AntApp.useApp>;
type AssistantSendInput = {
  page: Page;
  pageContext: AssistantContext;
  currentPageAgent: OrbitAgentId;
  enterpriseContext: string;
  loading: boolean;
  fileGenerating: boolean;
  replyStreaming: boolean;
  contentIntake: ReturnType<typeof useContentTaskIntake>;
  uiMessage: AppServices['message'];
  persistenceFenceRef: { current: { scopeKey: string; active: boolean } };
  stablePersistenceScope: AssistantJournalScope;
  assistantAtomicMutationRef: { current: boolean };
  waitForInFlightThreadSave: (agentId: OrbitAgentId) => Promise<void>;
  pendingMapFileRef: { current: boolean };
  abortRef: { current: AbortController | null };
  openAgent: (agent: OrbitAgentId, view: 'chat') => void;
  presentActionResponse: (agent: OrbitAgentId, request: AssistantActionRequest, response: AssistantActionResponse) => void;
  setMessages: StoreActions['setMessages'];
  setDraftInput: StoreActions['setDraftInput'];
  setFollowingLatest: StoreActions['setFollowingLatest'];
  upsertTaskCard: StoreActions['upsertTaskCard'];
  focusTaskCard: StoreActions['focusTaskCard'];
  hydrateThread: StoreActions['hydrateThread'];
  setLoading: Dispatch<SetStateAction<boolean>>;
  setFileGenerating: Dispatch<SetStateAction<boolean>>;
  setReplyStreaming: Dispatch<SetStateAction<boolean>>;
  setPipelineRefresh: Dispatch<SetStateAction<number>>;
  persistThread: (agent: OrbitAgentId) => void;
  onSessionRefresh?: () => void;
  requestId: () => string;
  activeAgent: OrbitAgentId;
  draftInput: string;
  pendingAttachments: File[];
  attachmentUploading: boolean;
  uploadedAttachmentCacheRef: { current: WeakMap<File, UploadedAssistantAttachment> };
  setAttachmentError: Dispatch<SetStateAction<string>>;
  setAttachmentUploading: Dispatch<SetStateAction<boolean>>;
  setPendingAttachments: Dispatch<SetStateAction<File[]>>;
  prepareWeeklyPlan: () => Promise<string>;
  weeklyPlanGuidanceActive: boolean;
  answerWeeklyPlan: (value: string) => Promise<string | null>;
  pendingHomeSubmissionRef: { current: AssistantHomePendingSubmission | null };
};

const API_PATH: Record<AgentType, string> = {
  strategy: '/api/overseas/strategy/chat',
  traffic: '/api/overseas/agents/traffic/chat',
  conversion: '/api/overseas/agents/conversion/chat',
  retention: '/api/overseas/agents/retention/chat',
};

/** Sends one scoped assistant turn; the parent still owns identity and conversation state. */
export function useAssistantSend(input: AssistantSendInput) {
  const { page, pageContext, currentPageAgent, enterpriseContext, loading, fileGenerating,
    replyStreaming, contentIntake, uiMessage, persistenceFenceRef, stablePersistenceScope,
    assistantAtomicMutationRef, waitForInFlightThreadSave, pendingMapFileRef, abortRef, openAgent, presentActionResponse,
    setMessages, setDraftInput, setFollowingLatest, upsertTaskCard, focusTaskCard, hydrateThread, setLoading,
    setFileGenerating, setReplyStreaming,
    setPipelineRefresh, persistThread, onSessionRefresh, requestId,
    activeAgent, draftInput, pendingAttachments, attachmentUploading,
    uploadedAttachmentCacheRef, setAttachmentError, setAttachmentUploading, setPendingAttachments,
    prepareWeeklyPlan, weeklyPlanGuidanceActive, answerWeeklyPlan, pendingHomeSubmissionRef } = input;
  const creationMode = useCreationMode();
  const send = useCallback(async (
    text: string,
    routeAgent = currentPageAgent,
    forcedContext?: AssistantContext,
    uploadedAttachments: UploadedAssistantAttachment[] = [],
    creationActionOrReference?: CreationTurn['action'] | AssistantReferenceMedia,
    options: { preserveDraft?: boolean; companyReport?: boolean; businessScene?: BusinessSceneSelection } = {},
  ) => {
    if (!persistenceFenceRef.current.active) return;
    const creationAction = typeof creationActionOrReference === 'string' ? creationActionOrReference : undefined;
    const referenceMedia = typeof creationActionOrReference === 'object' ? creationActionOrReference : undefined;
    const userText = text.trim();
    const quickScene = ASSISTANT_HOME_PROMPTS.find(entry => entry.prompt === userText && isBusinessScene(entry.id));
    if (!options.businessScene && quickScene && isBusinessScene(quickScene.id) && quickScene.id !== 'CO-07') {
      const sceneId = quickScene.id;
      const thread = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
      if (loading || fileGenerating || replyStreaming) return;
      if (['CS-01', 'CS-02', 'CS-03', 'CS-07', 'CS-09', 'AD-01', 'AD-06', 'AD-02'].includes(sceneId)) {
        const customer = sceneId.startsWith('CS-');
        const lastScope = [...thread.messages].reverse().find(message => customer ? message.businessScene?.customerId : message.businessScene?.adTaskId)?.businessScene;
        const preferredId = customer ? lastScope?.customerId : lastScope?.adTaskId;
        setMessages(PRIMARY_ASSISTANT_THREAD, [...thread.messages, { role: 'user', content: userText }, { role: 'assistant',
          content: sceneId === 'CS-01' ? '下面是今天优先跟进的客户。点击去跟进，将打开客户会话并准备推荐回复。' : sceneId === 'AD-02' ? '我们逐项确认账户、素材、目标、市场和预算，最后由你点击创建计划。' : customer ? preferredId ? '你还想再看看这位客户的其他信息吗？也可以换一位。' : '你想先关注谁？' : '你想查看哪条投放计划？我会分析近一周的数据。',
          businessScenePrompt: { sceneId, ...(preferredId ? { preferredId } : {}) } }]);
        if (!options.preserveDraft) setDraftInput(PRIMARY_ASSISTANT_THREAD, '');
        setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true); openAgent(routeAgent, 'chat'); persistThread(PRIMARY_ASSISTANT_THREAD); return;
      }
      options = { ...options, businessScene: { sceneId, ...defaultBusinessPeriod(sceneId) } };
    }
    options = { ...options, businessScene: options.businessScene || (!uploadedAttachments.length && !creationActionOrReference && !options.companyReport ? businessSceneFollowup(userText, useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages.at(-1)) : undefined) };
    if ((!userText && !uploadedAttachments.length) || loading || fileGenerating || replyStreaming || assistantAtomicMutationRef.current || useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].deletedAt) return;
    const creationDraft = options.companyReport || options.businessScene ? null : useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].creationDraft;
    if (page === 'strategy' && creationMode === 'free' && creationDraft && !uploadedAttachments.length && (creationAction || !creationDraft.evidenceVersion || !useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages.some(message => message.creation?.selection.referenceId === creationDraft.referenceId))) {
      const requestFence = persistenceFenceRef.current;
      const token = getToken();
      const controller = new AbortController();
      const selection = creationDraft;
      const current = () => requestFence.active && persistenceFenceRef.current === requestFence
        && sameAssistantRequestIdentity(token, getToken(), stablePersistenceScope)
        && useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].creationDraft === selection;
      if (!current()) return;
      abortRef.current?.abort(); abortRef.current = controller;
      const store = useAssistantStore.getState();
      store.setMessages(PRIMARY_ASSISTANT_THREAD, [...store.threads[PRIMARY_ASSISTANT_THREAD].messages, { role: 'user', content: userText }]);
      setLoading(true); openAgent(routeAgent, 'chat');
      try {
        const applied = await requestCreationReply({ turn: { action: creationAction || 'start', selection, instruction: userText }, controller, isCurrent: current, persist: () => persistThread(PRIMARY_ASSISTANT_THREAD) });
        if (applied && !controller.signal.aborted && sameAssistantRequestIdentity(token, getToken(), stablePersistenceScope)) setDraftInput(PRIMARY_ASSISTANT_THREAD, '');
      } catch (error) {
        if (current() && !controller.signal.aborted) {
          const thread = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
          setMessages(PRIMARY_ASSISTANT_THREAD, [...thread.messages, { role: 'assistant', content: error instanceof Error ? error.message : '推荐失败，请重试。' }]);
        }
      } finally {
        if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
        if (requestFence.active && persistenceFenceRef.current === requestFence) persistThread(PRIMARY_ASSISTANT_THREAD);
      }
      return;
    }
    if (contentIntake.active && !options.companyReport && !options.businessScene) {
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
    const responseMode = options.businessScene || isAssistantHomeQuickTaskText(visibleText) ? 'quick_task' : undefined;
    const replyPresentation = responseMode
      ? assistantReplyPresentationForText(visibleText) || (options.businessScene ? assistantReplyPresentationForPromptId(options.businessScene.sceneId) : undefined)
      : undefined;

    const threadAgent = PRIMARY_ASSISTANT_THREAD;
    const thread = useAssistantStore.getState().threads[threadAgent];
    const context = forcedContext ?? contextForOrbit(routeAgent, pageContext);
    const strategyRequest = agentForOrbit(routeAgent) === 'strategy';
    const enterpriseBrief = compactText(enterpriseContext);
    const conversationContext = selectAssistantConversationContext(mergeConsecutiveAssistant(thread.messages));
    const historyForApi = conversationContext.messages;
    const nextVisible = [...mergeConsecutiveAssistant(thread.messages), {
      role: 'user' as const,
      content: visibleMessage,
      ...(referenceMedia ? { referenceMedia } : {}),
    }];

    if (!uploadedAttachments.length && !creationActionOrReference && !options.companyReport
      && userText === ASSISTANT_HOME_PROMPTS.find(entry => entry.id === 'OP-CALENDAR')?.prompt) {
      setLoading(true);
      setMessages(threadAgent, nextVisible);
      openAgent(routeAgent, 'chat');
      try {
        const overview = await digitalEmployeeApi.overview();
        const readiness = overview.goal
          ? await digitalEmployeeApi.weeklyProductionReadiness(overview.goal.id).catch(() => null) : null;
        if (currentScope()) setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: weeklyTaskReply(overview, readiness) }]);
      } catch {
        if (currentScope()) setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: '当前周计划暂时读取不到，生产状态不能确认。请稍后重试，我不会因此启动或修改任务。' }]);
      } finally {
        clearLoadingForCurrentInstance();
        if (currentScope()) {
          setFollowingLatest(threadAgent, true);
          if (!options.preserveDraft) setDraftInput(threadAgent, '');
          persistThread(threadAgent);
        }
      }
      return;
    }

    const clarifiedDiagram = pendingMapFileRef.current && /(?:业务|路线图|思维导图|流程图|战略)/u.test(visibleText);
    const fileIntent = assistantFileIntent(visibleText) || (clarifiedDiagram ? { format: 'jpg' as const, diagram: true, needsMapScope: false } : null);
    const lastMessage = thread.messages.at(-1);
    const imageRevisionId = page === 'strategy' && !uploadedAttachments.length && !options.businessScene && !options.companyReport
      ? assistantImageRevisionTarget(thread.messages, visibleText) : null;
    if (imageRevisionId) {
      const event = new CustomEvent(ASSISTANT_IMAGE_REVISION_EVENT, { cancelable: true, detail: { taskId: imageRevisionId, instruction: visibleText } });
      window.dispatchEvent(event);
      if (event.defaultPrevented) {
        setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: '已收到修改意见。' }]);
        if (!options.preserveDraft) setDraftInput(threadAgent, '');
        setFollowingLatest(threadAgent, true); persistThread(threadAgent); return;
      }
    }
    const imagePortal = !options.businessScene && !fileIntent && !creationAction ? assistantImageReplicationPortal(visibleText, uploadedAttachments) : null;
    const scene = !options.businessScene && !imagePortal && ['strategy','socialInspiration'].includes(page) && !creationDraft && !uploadedAttachments.length && !fileIntent && !creationAction ? assistantScenarioIntake(visibleText) : null;
    if (scene) {
      setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: scene.scenario === 'weekly_calendar' ? '发布日历在内容创作中，点击下方卡片即可打开。' : scene.scenario === 'hook_first' ? '先选一个开场片段，再确认产品和内容方向。' : scene.scenario === 'content_task' ? '先确认产品、内容方向和预计发布时间。' : '先确定活动信息，再安排要准备的内容。', creationPortal: scene }]);
      setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true);
      openAgent(routeAgent, 'chat'); persistThread(threadAgent);
      return;
    }
    if (!options.businessScene && !imagePortal && page === 'strategy' && !creationDraft && !uploadedAttachments.length && !fileIntent
      && /(?:借鉴|复刻).{0,12}爆款|爆款复刻/u.test(visibleText)
      && !/(?:取消|不要|先别|如何|怎么)/u.test(visibleText)) {
      setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: '先选一条想借鉴的对标视频，再确定产品和周发布安排。',
        creationPortal: { kind: 'content_creation', id: `replication-${requestId()}`, scenario: 'viral_replication',
          title: '爆款复刻', objective: visibleText.slice(0, 1000), requestedOutputCount: 1,
          outputType: 'video', platforms: [], aspectRatio: null, targetDurationSeconds: null } }]);
      setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true);
      openAgent(routeAgent, 'chat'); persistThread(threadAgent);
      return;
    }
    const navigation = !options.businessScene && !creationDraft && !uploadedAttachments.length && !fileIntent && !creationAction ? confirmedAssistantNavigation(visibleText, lastMessage) : null;
    if (navigation) {
      setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: `点击下方入口前往${navigation.title}。` }]);
      setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true);
      openAgent(routeAgent, 'chat'); persistThread(threadAgent);
      return;
    }
    const sourceReply = !options.businessScene && !creationDraft && !uploadedAttachments.length && !fileIntent && !creationAction ? assistantSourceFollowUp(visibleText, lastMessage) : null;
    if (sourceReply) {
      setMessages(threadAgent, [...nextVisible, sourceReply]);
      setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true);
      openAgent(routeAgent, 'chat'); persistThread(threadAgent);
      return;
    }
    const taskPortal = !options.businessScene && !creationDraft && !uploadedAttachments.length && !fileIntent && !creationAction
      && lastMessage?.role === 'assistant' ? confirmedTaskPortal(lastMessage.taskPortal, visibleText) : null;
    if (taskPortal) {
      setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: '点击下方入口继续处理这条任务。', taskPortal }]);
      setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true);
      openAgent(routeAgent, 'chat'); persistThread(threadAgent);
      return;
    }
    const portal = imagePortal || (!options.businessScene && !creationDraft && !uploadedAttachments.length && !fileIntent && !creationAction
      && !['smartAssets', 'socialInspiration'].includes(page) ? assistantCreationPortal(visibleText) : null);
    if (portal) {
      setMessages(threadAgent, [...nextVisible, { role: 'assistant',
        content: imagePortal ? '先确认参考图和企业产品，其他要求可以补充；确认后我来完成图片和配文。' : '创作需求已带入下方入口。\n\n总体结论：点击「内容创作」，确认产品和数量后继续制作。', creationPortal: portal }]);
      setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true);
      openAgent(routeAgent, 'chat'); persistThread(threadAgent);
      return;
    }
    const productionIntent = (page === 'strategy' && creationMode === 'free' && creationDraft) || uploadedAttachments.length || fileIntent ? null : assistantProductionIntent(visibleText);
    if (productionIntent && !['smartAssets', 'socialInspiration'].includes(page)) {
      assistantAtomicMutationRef.current = true;
      setLoading(true);
      openAgent(routeAgent, 'chat');
      try {
        await runAssistantProductionRequest({
          productionIntent, requestMessage: visibleMessage, threadAgent, expectedThreadVersion: thread.version, currentScope,
          waitForInFlightThreadSave,
          setLoading, upsertTaskCard, focusTaskCard, hydrateThread, setMessages, persistThread,
          onSessionRefresh,
          refreshPipeline: () => setPipelineRefresh(value => value + 1),
        });
      } finally {
        assistantAtomicMutationRef.current = false;
      }
      if (currentScope()) {
        setDraftInput(threadAgent, ''); setFollowingLatest(threadAgent, true); persistThread(threadAgent);
      }
      return;
    }
    setMessages(threadAgent, nextVisible);
    if (!options.preserveDraft) setDraftInput(threadAgent, '');
    setFollowingLatest(threadAgent, true);
    setLoading(true);
    openAgent(routeAgent, 'chat');

    if (fileIntent?.needsMapScope) {
      pendingMapFileRef.current = true;
      setMessages(threadAgent, [...nextVisible, { role: 'assistant', content: '你需要的是业务路线图，还是地理地图？业务路线图可以导出 JPG；地理地图还需要明确地区、标注内容和可靠地图来源，不能用文字示意图冒充真实地图。' }]);
      setLoading(false); persistThread(threadAgent); return;
    }
    pendingMapFileRef.current = false;
    if (productionIntent && ['smartAssets', 'socialInspiration'].includes(page)) {
      setLoading(false);
      contentIntake.start(productionIntent.objective, productionIntent);
      return;
    }
    const focusedCard = thread.focusedTaskId ? thread.taskCards[thread.focusedTaskId] ?? null : null;
    // Attachments deliberately bypass the deterministic action router. The
    // router accepts only server-signed business object/version inputs; a
    // newly uploaded material must never be guessed into those parameters.
    const focusedMutationActionId = options.businessScene || uploadedAttachments.length || fileIntent ? undefined : focusedNaturalLanguageActionId(visibleText);
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
      setMessages(threadAgent, [...current, { role: 'assistant', ...(options.businessScene ? { businessScene: options.businessScene } : {}), content: fileIntent ? `正在整理并生成 ${fileIntent.format.toUpperCase()} 文件…` : '' }]);
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
            ...(options.businessScene ? { businessScene: options.businessScene } : {}),
            ...(page === 'strategy' && creationMode === 'free' && creationDraft ? { creationSelection: creationDraft } : {}),
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
            ...(responseMode ? { responseMode } : {}),
            ...(replyPresentation ? { replyPresentation } : {}),
          } : {}),
        },
        controller,
        fileIntent,
        fileTitle: visibleText.replace(/^(?:请|帮我|生成|导出|制作|给我|想要)+/u, '').trim().slice(0, 100) || '会话文档',
        isCurrent: currentScope,
        onStart: ensureAssistant,
        onText: text => patchAssistant(msg => ({ ...msg, content: msg.content + text })),
        onSources: sources => patchAssistant(msg => ({ ...msg, sources })),
        onCompanyReport: (report, text) => patchAssistant(msg => ({ ...msg, content: text, companyReport: report })),
        onCompanyReportProgress: phase => patchAssistant(msg => ({ ...msg, content: `正在${phase}…` })),
        onAnalysisWork: work => patchAssistant(msg => ({ ...msg, analysisWork: upsertAssistantWork(msg.analysisWork || [], work) })),
        onAnalysisComplete: () => patchAssistant(msg => ({ ...msg, analysisComplete: true })),
        onTaskPortal: taskPortal => patchAssistant(msg => ({ ...msg, taskPortal })),
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
      if (assistantStarted) patchAssistant(msg => ({ ...msg, analysisComplete: false, analysisWork: msg.analysisWork?.map(e => e.status === 'running' ? { ...e, status: 'failed', detail: message.slice(0, 500) } : e), taskPortal: undefined, content: fileIntent ? `文件未生成：${message}` : msg.content ? appendAssistantStreamFailure(msg.content, message) : message }));
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
  }, [creationMode, assistantAtomicMutationRef, waitForInFlightThreadSave, replyStreaming, fileGenerating, contentIntake, currentPageAgent, enterpriseContext, executeAssistantAction, focusTaskCard, hydrateThread, loading, uiMessage, onSessionRefresh, openAgent, page, pageContext, persistThread, presentActionResponse, setDraftInput, setFollowingLatest, setMessages, upsertTaskCard, stablePersistenceScope]);

  const sendWeeklyPlanGuidanceAnswer = useCallback(async (value: string, visibleLabel = value) => {
    if (loading || !weeklyPlanGuidanceActive) return;
    const current = useAssistantStore.getState().threads[activeAgent].messages;
    setDraftInput(activeAgent, '');
    setMessages(activeAgent, [...current, { role: 'user', content: visibleLabel.trim() }]);
    setFollowingLatest(activeAgent, true);
    setLoading(true);
    try {
      const reply = await answerWeeklyPlan(value);
      if (reply) {
        const latest = useAssistantStore.getState().threads[activeAgent].messages;
        setMessages(activeAgent, [...latest, { role: 'assistant', content: reply }]);
      }
    } catch (cause) {
      const latest = useAssistantStore.getState().threads[activeAgent].messages;
      setMessages(activeAgent, [...latest, { role: 'assistant', content: cause instanceof Error ? cause.message : '周计划信息暂时无法保存。' }]);
    } finally { setLoading(false); persistThread(activeAgent); }
  }, [activeAgent, answerWeeklyPlan, loading, persistThread, setDraftInput, setFollowingLatest, setLoading, setMessages, weeklyPlanGuidanceActive]);

  const sendComposerMessage = useCallback(async () => {
    if (loading || attachmentUploading) return;
    const draft = draftInput;
    const files = [...pendingAttachments];
    if (!draft.trim() && !files.length) return;
    if (contentIntake.active) {
      if (files.length) { setAttachmentError('请先完成或取消当前任务问答，再发送附件。'); return; }
      void send(draft); return;
    }
    if (!files.length && weeklyPlanGuidanceActive) {
      await sendWeeklyPlanGuidanceAnswer(draft);
      return;
    }
    if (!files.length && isWeeklyPlanKickoffRequest(draft)) {
      const current = useAssistantStore.getState().threads[activeAgent].messages;
      setDraftInput(activeAgent, '');
      setMessages(activeAgent, [...current, { role: 'user', content: draft.trim() }]);
      setFollowingLatest(activeAgent, true);
      setLoading(true);
      try {
        const summary = await prepareWeeklyPlan();
        const latest = useAssistantStore.getState().threads[activeAgent].messages;
        setMessages(activeAgent, [...latest, { role: 'assistant', content: summary }]);
      } catch (cause) {
        const latest = useAssistantStore.getState().threads[activeAgent].messages;
        setMessages(activeAgent, [...latest, { role: 'assistant', content: cause instanceof Error ? cause.message : '周计划生成失败，请稍后重试。' }]);
      } finally { setLoading(false); persistThread(activeAgent); }
      return;
    }
    if (!files.length) {
      const pending = pendingHomeSubmissionRef.current;
      pendingHomeSubmissionRef.current = null;
      const submitOptions = pending?.agent === activeAgent && pending.draft === draft ? pending.submitOptions : undefined;
      void send(draft, currentPageAgent, undefined, [], undefined, submitOptions);
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
  }, [activeAgent, contentIntake.active, currentPageAgent, draftInput, attachmentUploading, loading, pendingAttachments,
    pendingHomeSubmissionRef, persistThread, prepareWeeklyPlan, send, sendWeeklyPlanGuidanceAnswer, setAttachmentError,
    setAttachmentUploading, setDraftInput, setFollowingLatest, setLoading, setMessages, setPendingAttachments,
    weeklyPlanGuidanceActive]);

  return { send, sendComposerMessage, sendWeeklyPlanGuidanceAnswer };
}
