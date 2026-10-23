import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { App as AntApp } from 'antd';
import type { AgentType, Message, Page } from '../../App';
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
import { focusedNaturalLanguageActionId, focusedNaturalLanguageActionInput,
  isWeeklyPlanKickoffRequest } from './assistantActionProjection';
import { assistantAttachmentKind } from './AssistantComposer';
import { buildAssistantChatMessages, type UploadedAssistantAttachment } from './assistantChatPrompt';
import { assistantProductionIntent } from './assistantProductionIntake';
import { runAssistantProductionRequest } from './assistantProductionRequest';
import type { useContentTaskIntake } from './useContentTaskIntake';
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
  weeklyPlanKickoffAvailable: boolean;
  uploadedAttachmentCacheRef: { current: WeakMap<File, UploadedAssistantAttachment> };
  setAttachmentError: Dispatch<SetStateAction<string>>;
  setAttachmentUploading: Dispatch<SetStateAction<boolean>>;
  setPendingAttachments: Dispatch<SetStateAction<File[]>>;
  openWeeklyPlanFromAssistant: () => void;
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
    pendingMapFileRef, abortRef, openAgent, presentActionResponse,
    setMessages, setDraftInput, setFollowingLatest, upsertTaskCard, focusTaskCard, hydrateThread, setLoading,
    setFileGenerating, setReplyStreaming,
    setPipelineRefresh, persistThread, onSessionRefresh, requestId,
    activeAgent, draftInput, pendingAttachments, attachmentUploading, weeklyPlanKickoffAvailable,
    uploadedAttachmentCacheRef, setAttachmentError, setAttachmentUploading, setPendingAttachments,
    openWeeklyPlanFromAssistant } = input;
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
        productionIntent, threadAgent, expectedThreadVersion: thread.version, currentScope,
        setLoading, upsertTaskCard, focusTaskCard, hydrateThread, setMessages, persistThread,
        onSessionRefresh,
        refreshPipeline: () => setPipelineRefresh(value => value + 1),
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
  }, [replyStreaming, fileGenerating, contentIntake, currentPageAgent, enterpriseContext, executeAssistantAction, focusTaskCard, hydrateThread, loading, uiMessage, onSessionRefresh, openAgent, page, pageContext, persistThread, presentActionResponse, setDraftInput, setFollowingLatest, setMessages, upsertTaskCard, stablePersistenceScope]);

  const sendComposerMessage = useCallback(async () => {
    if (loading || attachmentUploading) return;
    const draft = draftInput;
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
  }, [contentIntake.active, activeAgent, draftInput, attachmentUploading, currentPageAgent, loading, openWeeklyPlanFromAssistant, pendingAttachments, persistThread, send, setDraftInput, setFollowingLatest, setMessages, weeklyPlanKickoffAvailable]);

  return { send, sendComposerMessage };
}
