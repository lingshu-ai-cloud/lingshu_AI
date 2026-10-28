import AssistantWorkBookmark from './AssistantWorkBookmark';
import GuidedCreationChoices from './GuidedCreationChoices';
import ContentCreationChoices from './ContentCreationChoices';
import { useCreationMode } from '../../lib/creationMode';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowLeft, X } from 'lucide-react';
import type { AgentAction, Page } from '../../App';
import { isLegacyUnboundOperationNotice } from '../../lib/assistantOperationNotice';
import { lsMotion } from '../../lib/designTokens';
import type { AssistantQuickExecution } from '../../lib/assistantQuickEntries';
import type { AssistantProductionContext } from '../../lib/assistantProductionDecision';
import { useAssistantStore, type AgentThreadState, type OrbitAgentId } from '../../stores/assistantStore';
import KnowledgeIntakePanel, { type AppliedProfile } from '../enterprise/KnowledgeIntakePanel';
import AssistantComposer from './AssistantComposer';
import { useAssistantPromptQueue } from './useAssistantPromptQueue';
import AssistantMascot from './AssistantMascot';
import { assistantFollowUpSuggestion } from '../../lib/assistantFollowUp';
import AssistantConversationBubbles from './AssistantConversationBubbles';
import AssistantCustomerTodoView from './AssistantCustomerTodoView';
import AssistantHomeScenes from './AssistantHomeScenes';
import AssistantWeeklyActions from './AssistantWeeklyActions';
import { contextForOrbit, type AssistantContext } from './globalAssistantRuntime';
import type { useAssistantDecisionDialog } from './useAssistantDecisionDialog';
import type { useAssistantQuickExecution } from './useAssistantQuickExecution';
import type { useAssistantSend } from './useAssistantSend';
import { mergeAssistantHomePrompt, type AssistantHomeBounds, type AssistantHomePendingSubmission } from './useAssistantHomeAnchor';
import type { useContentTaskIntake } from './useContentTaskIntake';
import type { AssistantWeeklyPlanExperience } from './useAssistantWeeklyPlanExperience';


type StoreActions = ReturnType<typeof useAssistantStore.getState>;
type Props = {
  conversationControls?: import('react').ReactNode;
  conversationLocked?: boolean;
  page: Page;
  inlineHome: boolean;
  inlineHomeBounds: AssistantHomeBounds | null;
  pageContext: AssistantContext;
  currentPageAgent: OrbitAgentId;
  activeAgent: OrbitAgentId;
  activeThread: AgentThreadState;
  mode: 'breathing' | 'chat';
  panelView: 'todo' | 'chat';
  assistantTool: 'knowledge-intake' | null;
  viewport: { width: number; height: number };
  reduceMotion: boolean;
  productionDecisionContext: AssistantProductionContext | null;
  decisionFeedRevision: number;
  persistenceScopeKey: string;
  welcomeBubbleVisible: boolean;
  loading: boolean;
  fileGenerating: boolean;
  replyStreaming: boolean;
  attachmentUploading: boolean;
  attachmentError: string;
  pendingAttachments: File[];
  weeklyActionBusy: boolean;
  weeklyPlanKickoffAvailable: boolean;
  weeklyPlanExperience: AssistantWeeklyPlanExperience;
  pipelineEntries: AssistantQuickExecution[];
  pendingCount: number;
  contentIntake: ReturnType<typeof useContentTaskIntake>;
  messageScrollRef: RefObject<HTMLDivElement | null>;
  assistantInputRef: RefObject<HTMLTextAreaElement | null>;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
  closeAssistant: () => void;
  returnToConversation: () => void;
  openDecisionDialog: ReturnType<typeof useAssistantDecisionDialog>['openDecisionDialog'];
  handleDecisionFeedChange: ReturnType<typeof useAssistantDecisionDialog>['handleDecisionFeedChange'];
  openWeeklyPlanFromAssistant: () => void;
  send: ReturnType<typeof useAssistantSend>['send'];
  sendComposerMessage: ReturnType<typeof useAssistantSend>['sendComposerMessage'];
  runQuickExecution: ReturnType<typeof useAssistantQuickExecution>;
  setAssistantTool: Dispatch<SetStateAction<'knowledge-intake' | null>>;
  setScrollPosition: StoreActions['setScrollPosition'];
  setFollowingLatest: StoreActions['setFollowingLatest'];
  focusTaskCard: StoreActions['focusTaskCard'];
  setMessages: StoreActions['setMessages'];
  setDraftInput: StoreActions['setDraftInput'];
  setPendingHomeSubmission: (submission: AssistantHomePendingSubmission | null) => void;
  setDecisionFeedRevision: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<'breathing' | 'chat'>>;
  setWeeklyActionBusy: Dispatch<SetStateAction<boolean>>;
  setPendingAttachments: Dispatch<SetStateAction<File[]>>;
  setAttachmentError: Dispatch<SetStateAction<string>>;
  persistThread: (agent: OrbitAgentId) => void;
};

/** The existing single-column assistant surface, without its data lifecycle. */
export default function AssistantConversationPanel(props: Props) {
  const { inlineHome, inlineHomeBounds, page, pageContext, currentPageAgent, activeAgent, activeThread, mode, panelView,
    assistantTool, viewport, reduceMotion, productionDecisionContext, decisionFeedRevision,
    persistenceScopeKey, welcomeBubbleVisible, loading, fileGenerating, replyStreaming,
    attachmentUploading, attachmentError, pendingAttachments, weeklyActionBusy,
    weeklyPlanKickoffAvailable, weeklyPlanExperience, pendingCount, contentIntake,
    messageScrollRef, assistantInputRef, onAction, onSessionRefresh, closeAssistant,
    returnToConversation, openDecisionDialog, handleDecisionFeedChange,
    openWeeklyPlanFromAssistant, send, sendComposerMessage,
    setAssistantTool, setScrollPosition, setFollowingLatest, focusTaskCard, setMessages,
    setDraftInput, setPendingHomeSubmission, setDecisionFeedRevision, setMode, setWeeklyActionBusy,
    setPendingAttachments, setAttachmentError, persistThread } = props;
  const generationBusy = loading || replyStreaming || fileGenerating;
  const queue = useAssistantPromptQueue({ scope: `${persistenceScopeKey}:${activeThread.conversationKey || activeAgent}:${activeThread.conversationResetVersion || 0}`, busy: generationBusy, blocked: Boolean(props.conversationLocked || activeThread.deletedAt || attachmentUploading || contentIntake.busy || weeklyActionBusy), agent: currentPageAgent, send });
  const creationMode = useCreationMode();
  const compactHome = Boolean(inlineHome && (activeThread.creationDraft || activeThread.messages.length || loading));
  const creationReply = [...activeThread.messages].reverse().find(message => message.creation)?.creation;
  const activeContext = contextForOrbit(currentPageAgent, pageContext);
  const focusedCardCandidate = activeThread.focusedTaskId
    ? activeThread.taskCards[activeThread.focusedTaskId] ?? null
    : null;
  const focusedTaskCard = isLegacyUnboundOperationNotice(focusedCardCandidate) ? null : focusedCardCandidate;
  const todoItems = pageContext.todoItems ?? [];
  const orderedTodoItems = [...todoItems.filter(item => !item.completed), ...todoItems.filter(item => item.completed)];
  const isCustomerTodoView = panelView === 'todo' && pageContext.agent === 'conversion';
  const panelTitle = assistantTool === 'knowledge-intake' ? '灵小枢 · 快速采集' : isCustomerTodoView ? '今日待办' : '灵小枢';
  const panelSubtitle = assistantTool === 'knowledge-intake' ? '当前：智能客服规范' : isCustomerTodoView ? '当前：我的客户' : `当前：${activeContext.label}`;
  const assistantUsesMobileClearance = viewport.width < 768
    && (page === 'conversion' || page === 'smartAssets' || page === 'digitalEmployees');
  const assistantPanelHeight = Math.max(120, Math.min(720, viewport.height - (assistantUsesMobileClearance ? 160 : 96)));
  const assistantPanelWidth = Math.min(assistantTool === 'knowledge-intake' ? 560 : 420, viewport.width - 32);
  const fadeTransition = { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.enter) / 1000, ease: lsMotion.ease.enter };
  const fadeExit = { opacity: 0, transition: { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.exit) / 1000, ease: lsMotion.ease.exit } };
  const spatialTransition = reduceMotion ? { duration: 0 } : { ...lsMotion.spring.standard, opacity: fadeTransition };

  return <AnimatePresence>
    {(mode === 'chat' || assistantTool === 'knowledge-intake' || inlineHomeBounds) && (
      <motion.section
        data-global-assistant="panel"
        id="global-assistant-panel"
        role="dialog"
        aria-modal="false"

        aria-labelledby="global-assistant-panel-title"
        aria-describedby="global-assistant-panel-description"
        tabIndex={-1}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        animate={mode === 'chat' || inlineHomeBounds ? { opacity: 1, y: 0 } : { opacity: 0, y: reduceMotion ? 0 : 8 }}
        exit={{ y: reduceMotion ? 0 : 8, opacity: 0, transition: { ...spatialTransition, opacity: fadeExit.transition } }}
        transition={spatialTransition}
        className={`ls-assistant-panel absolute bottom-14 right-0 z-10 flex max-h-[calc(100dvh-env(safe-area-inset-bottom)-96px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden border border-border bg-surface outline-none ${assistantTool === 'knowledge-intake' ? 'w-[560px]' : 'w-[420px]'} ${mode === 'chat' || inlineHomeBounds ? 'pointer-events-auto visible' : 'pointer-events-none invisible'}`}
        style={{ height: inlineHomeBounds?.height ?? assistantPanelHeight, width: inlineHomeBounds?.width ?? assistantPanelWidth, maxWidth: inlineHomeBounds ? '100%' : 'calc(100vw - 32px)' }}
        data-assistant-view="conversation"
      >
        {!inlineHome && <AssistantWorkBookmark/>}
        {inlineHome && <div className="sr-only"><h2 id="global-assistant-panel-title">灵小枢创作对话</h2><p id="global-assistant-panel-description">描述创作需求，或添加图片、视频和音频参考。</p></div>}
        {inlineHome && <div className="flex shrink-0 justify-end px-3 pt-1" data-assistant-conversation-controls>{props.conversationControls}</div>}
        {activeThread.deletedAt && <p role="status" className="px-4 text-sm text-text-secondary">这条会话已删除，请从会话管理中新建会话。</p>}
        {!inlineHome && <header className="ls-assistant-panel__header flex shrink-0 items-center justify-between border-b border-border bg-surface">
          <div className="ls-assistant-panel__identity">
            <button type="button" onClick={() => {
              if (assistantTool === 'knowledge-intake') { setAssistantTool(null); returnToConversation(); }
              else if (panelView !== 'chat') returnToConversation();
              else closeAssistant();
            }}
              className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={assistantTool === 'knowledge-intake' || panelView !== 'chat' ? '返回灵小枢对话' : '收起灵小枢对话'}
              title={assistantTool === 'knowledge-intake' || panelView !== 'chat' ? '返回灵小枢对话' : '收起灵小枢对话'}>
              <ArrowLeft size={16} />
            </button>
            <AssistantMascot size="sm" interactive reduceMotion={reduceMotion} />
            <div className="min-w-0">
              <p id="global-assistant-panel-title" className="ls-type-title-small truncate text-text-primary">{panelTitle}</p>
              <p id="global-assistant-panel-description" className="ls-type-body-small truncate text-text-muted">{panelSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {props.conversationControls}
            <button type="button" onClick={closeAssistant} className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" title="关闭窗口（任务继续）" aria-label="关闭灵枢助手窗口，任务继续运行">
              <X size={15} />
            </button>
          </div>
        </header>}

        {assistantTool === 'knowledge-intake' ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-3">
            <KnowledgeIntakePanel mode="center" compact onApplied={(profile: AppliedProfile) => {
              window.dispatchEvent(new CustomEvent('lingshu:knowledge-intake-applied', { detail: { profile } }));
              onSessionRefresh?.();
            }} />
          </div>
        ) : isCustomerTodoView ? (
          <AssistantCustomerTodoView items={orderedTodoItems} pendingCount={pendingCount}
            onBack={returnToConversation} onSelect={id => {
              window.dispatchEvent(new CustomEvent('lingshu:select-customer', { detail: { id } }));
              returnToConversation();
            }} />
        ) : (
          <>
            <div ref={messageScrollRef} data-assistant-surface="conversation" hidden={inlineHome && !activeThread.creationDraft && !activeThread.messages.length && !loading} className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
              onScroll={event => {
                const scroller = event.currentTarget;
                setScrollPosition(activeAgent, scroller.scrollTop);
                setFollowingLatest(activeAgent, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24);
              }}>
              {inlineHome && activeThread.creationDraft && !activeThread.creationDraft.guided && !activeThread.messages.length && !loading && <div className="creator-conversation-intro flex items-start gap-2" data-assistant-bubble="reference-question" role="group" aria-label="灵小枢提问">
                <AssistantMascot size="xs" reduceMotion={reduceMotion} />
                <div className="ls-messenger-bubble ls-messenger-bubble--inbound">
                  <p className="font-semibold text-text-primary">想用这条参考视频创作什么？</p>
                  <p className="mt-2 text-text-secondary">告诉我产品和想借鉴的内容，我们从产品、分镜到口播逐步确认。参考视频只用于结构参考，素材与授权会单独核验。</p>
                </div>
              </div>}
              <AssistantConversationBubbles inlineHome={inlineHome}
                page={page} goalId={pageContext.goalId} productionContext={productionDecisionContext}
                decisionFeedRevision={decisionFeedRevision}
                decisionFeedKey={`${persistenceScopeKey}:${page}:${pageContext.goalId || 'latest'}:summary:${decisionFeedRevision}`}
                decisionFeedActive={mode === 'chat' && panelView === 'chat'}
                onOpenChat={returnToConversation}
                onOpenFeedDetail={trigger => openDecisionDialog({ kind: 'feed' }, trigger)}
                onFeedChange={handleDecisionFeedChange}
                welcomeBubbleVisible={welcomeBubbleVisible} activeAgentLabel="灵小枢"
                reduceMotion={reduceMotion}
                messages={activeThread.messages} onAction={onAction}
                onSuggest={suggestion => {
                  setDraftInput(activeAgent, suggestion);
                  window.requestAnimationFrame(() => {
                    assistantInputRef.current?.focus();
                    assistantInputRef.current?.setSelectionRange(suggestion.length, suggestion.length);
                  });
                }}
                contentIntakeNode={contentIntake.node} loading={loading} replyStreaming={replyStreaming} focusedTaskCard={focusedTaskCard}
                onOpenTaskDetail={(trigger, taskId) => {
                  focusTaskCard(activeAgent, taskId);
                  openDecisionDialog({ kind: 'task', taskId }, trigger);
                }}
                weeklyPlanKickoffAvailable={weeklyPlanKickoffAvailable}
                onOpenWeeklyPlan={openWeeklyPlanFromAssistant}
                weeklyPlanExperience={weeklyPlanExperience}
              />
              {inlineHome && creationMode === 'free' && activeThread.creationDraft?.guided && <GuidedCreationChoices key={activeThread.creationDraft.referenceId} reply={creationReply}/>}
              {inlineHome && creationMode === 'free' && !activeThread.creationDraft?.guided && creationReply && <ContentCreationChoices reply={creationReply} busy={loading || replyStreaming}
                send={send} onNavigateEvidence={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration', inspirationReference: { referenceId: creationReply.selection.referenceId, title: creationReply.referenceTitle } } }))}/>}
            </div>

            {!activeThread.isFollowingLatest && (
              <div className="flex shrink-0 justify-center border-t border-border/60 bg-surface px-3 py-1.5">
                <button type="button" onClick={() => {
                  const scroller = messageScrollRef.current;
                  if (scroller) scroller.scrollTop = scroller.scrollHeight;
                  setFollowingLatest(activeAgent, true);
                  setScrollPosition(activeAgent, scroller?.scrollHeight ?? activeThread.scrollPosition);
                }} className="ls-type-label-small inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="回到最新消息">
                  <ArrowDown size={12} /> 回到最新消息
                </button>
              </div>
            )}

            {!inlineHome && !contentIntake.active && <AssistantHomeScenes
              key={persistenceScopeKey} variant="sidebar" sessionScope={persistenceScopeKey} agent={activeAgent}
              disabled={loading || fileGenerating || attachmentUploading}
              onNavigate={target => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: target } }))}
              onPrompt={detail => {
                if (loading || fileGenerating || attachmentUploading) return;
                if (detail.submit && detail.submitOptions?.companyReport) {
                  void send(detail.prompt, currentPageAgent, undefined, [], undefined, { ...detail.submitOptions, preserveDraft: true });
                  return;
                }
                const draft = mergeAssistantHomePrompt(useAssistantStore.getState().threads[activeAgent].draftInput, detail.prompt, detail.mode);
                setDraftInput(activeAgent, draft);
                setPendingHomeSubmission(detail.submitOptions ? { agent: activeAgent, draft, submitOptions: detail.submitOptions } : null);
                assistantInputRef.current?.focus();
              }}
            />}

            {!inlineHome && <AssistantWeeklyActions page={page} scopeKey={persistenceScopeKey}
              disabled={loading || attachmentUploading} onBusyChange={setWeeklyActionBusy}
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
            />}
            {queue.entries.length > 0 && <div aria-label="排队中的提示词" className="flex max-h-28 shrink-0 flex-col gap-1 overflow-y-auto px-4 pb-2" role="status">
              {queue.paused && <div className="text-xs text-text-secondary">已暂停，核对上一条回复后 <button type="button" onClick={queue.resume} className="text-accent underline">继续发送</button></div>}
              {queue.entries.map((entry, index) => <div key={entry.id} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
                <span className="shrink-0 text-accent">排队 {index + 1}</span><span className="min-w-0 flex-1 truncate" title={entry.text}>{entry.text}</span>
                <button type="button" aria-label={`移除排队提示词：${entry.text}`} onClick={() => queue.remove(entry.id)} className="rounded p-1 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><X size={12}/></button>
              </div>)}
            </div>}
            <AssistantComposer variant={inlineHome ? 'home' : 'default'} compact={compactHome} ref={assistantInputRef} draft={activeThread.draftInput} files={pendingAttachments}
              suggestion={!loading && !replyStreaming && !fileGenerating && !activeThread.creationDraft && !contentIntake.active ? assistantFollowUpSuggestion(activeThread.messages) : ''}
              disabled={props.conversationLocked || Boolean(activeThread.deletedAt) || contentIntake.busy || weeklyActionBusy}
              uploading={attachmentUploading} error={attachmentError}
              onDraftChange={value => setDraftInput(activeAgent, value)}
              onFilesChange={files => { setPendingAttachments(files); if (!files.length) setAttachmentError(''); }}
              onValidationError={setAttachmentError} onSubmit={() => {
                if (!queue.shouldQueue(generationBusy)) { void sendComposerMessage(); return; }
                if (pendingAttachments.length) { setAttachmentError('请等待当前回复及排队提示词处理完成后再发送附件，草稿和附件已保留。'); return; }
                const text = activeThread.draftInput.trim();
                if (text && queue.enqueue(text)) { setDraftInput(activeAgent, ''); setPendingHomeSubmission(null); setAttachmentError(''); } else if (text) setAttachmentError('暂时无法保存排队提示词，请稍后重试；草稿已保留。');
              }}
            />
          </>
        )}
      </motion.section>
    )}
  </AnimatePresence>;
}
