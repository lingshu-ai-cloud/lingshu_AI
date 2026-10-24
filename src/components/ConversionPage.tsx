import { LocalCustomerSimulationLauncher } from './customers/LocalCustomerSimulation';
import { saveLocalCustomerDraft } from '../lib/localCustomerSimulation';
import CustomerReplyRecovery from './customers/CustomerReplyRecovery';
import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { ChatThread } from './customers/ConversionChatThread';
import { CustomerInfoRail } from './customers/ConversionCustomerRail';
import CustomerServiceSwitch from './customers/CustomerServiceSwitch';
import { CompactCustomerList, VIEW_META, filterCustomers, type CustomerView } from './customers/ConversionCustomerList';
import { isWaitingForHumanQuote, latestBuyerText, requestDraft, translateReplyToCustomerLanguage, type DraftResult, type MessageTemplate, type StyleMemoryPayload, type TemplatePlan } from './customers/customerReplyPreparation';
import { Alert, App, Button, Input, Modal } from "antd";
import { PAGE_REGISTRY } from "../pageRegistry";
import { useAgentProductionAction } from '../lib/agentProductionSession';
import CustomerWorkflowPanel from './CustomerWorkflowPanel';
import { useDeliveryHandoff } from "../hooks/useDeliveryHandoff";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  List,
  MessageSquare,
  UserRound,
} from 'lucide-react';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import {customerManualTakeoverApi,type CustomerManualTakeoverView} from '../lib/customerManualTakeoverApi';
import {assertSendScope,readCustomerSendScope,readCustomerSendRequest,readSendIntent,recoverSendIntent,sendIntentStorageKey,type CustomerSendIntent} from '../lib/customerSendIntent';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';
import { DailyBriefing } from './customers/DailyBriefing';
import { isOutsideWhatsAppWindow, type ConversationDraftIntent } from './customers/conversationTiming';
import { useCustomers } from '../hooks/useCustomers';
import { buildPrioritySuggestion, dailyTodoCustomers, isTodoCompleted, pendingCount } from '../lib/customerPriority';
import type { AutonomyLevel, CustomerProfile, HandlingMode } from '../types/customer';
import { updateCustomerServiceStatus, type CustomerServiceStatus } from '../lib/customerService';
import { createMessageEvent, sendCustomerOutbox } from './customers/customerConversationDelivery';
import { useConversionSessionEffects } from './customers/useConversionSessionEffects';
import { useConversionDraftEffects } from './customers/useConversionDraftEffects';
import { customerServicePresentation } from './customers/customerServicePresentation';

type DraftIntent = ConversationDraftIntent;

declare global {
  interface Window {
    __lingshuDemo?: {
      pushBuyerMessage?: (customerId: string, text: string) => void;
    };
  }
}

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
  isDemo?: boolean;
  includeMockCustomers?: boolean;
  mockCustomerScope?: string;
}


export default function ConversionPage({ onLeaveConversation: _onLeaveConversation, isDemo = false, includeMockCustomers = false, mockCustomerScope = 'admin' }: Props) {
  const { modal } = App.useApp();
  const agentProduction = useAgentProductionAction('customer');
  const [view, setView] = useState<CustomerView>(() => {
    try {
      const initialView = localStorage.getItem('lingshu:conversion:initial-view') as CustomerView | null;
      localStorage.removeItem('lingshu:conversion:initial-view');
      if (initialView && ['inbox', 'leads', 'won', 'silent'].includes(initialView)) return initialView;
    } catch { /* ignore */ }
    return 'inbox';
  });
  const { customers, updateCustomer, appendTimelineEvent, updateTimelineEvent, removeTimelineEvent } = useCustomers(0, includeMockCustomers, mockCustomerScope);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'chat' | 'profile'>('chat');
  const [savingDraft, setSavingDraft] = useState(false);
  const navigationHandoff = useDeliveryHandoff('conversion');
  const deliveryHandoff = agentProduction.active ? window.__agentProductionTarget?.link : navigationHandoff;
  const [deliveryDraft, setDeliveryDraft] = useState<{ body: string; version: number; customerId: string } | null>(null);
  const [deliveryError, setDeliveryError] = useState('');
  useEffect(()=>{let authorization=authHeader().Authorization;const clear=()=>{const next=authHeader().Authorization;if(next===authorization)return;authorization=next;setSelectedId(null);setDeliveryDraft(null);setDeliveryError('');};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,clear);window.addEventListener('storage',clear);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,clear);window.removeEventListener('storage',clear);};},[]);
  useEffect(() => {
    const ref = deliveryHandoff?.businessRef;
    setDeliveryDraft(null);
    if (!ref?.batchId || !ref.itemId) return;
    const abort = new AbortController();
    void fetch(`/api/overseas/digital-employees/followup-batches/${encodeURIComponent(String(ref.batchId))}`, { headers: authHeader(), signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error('无法加载关联草稿'); return response.json(); })
      .then(data => {
        const item = data.items?.find((entry: { id: string; customer_id: string }) => entry.id === ref.itemId && entry.customer_id === ref.entityId);
        if (!item) throw new Error('关联草稿已不可用，请返回看板刷新');
        setDeliveryDraft({ body: item.draft_body || '', version: item.draft_version || 1, customerId: item.customer_id });
      }).catch(error => { if (!abort.signal.aborted) setDeliveryError(error.message); });
    return () => abort.abort();
  }, [deliveryHandoff]);

  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('draft');
  const [customerServiceStatus, setCustomerServiceStatus] = useState<CustomerServiceStatus | null>(null);
  const [customerServiceStatusLoadFailed, setCustomerServiceStatusLoadFailed] = useState(false);
  const [customerServiceSaving, setCustomerServiceSaving] = useState(false);
  const [dailyBriefingOpen, setDailyBriefingOpen] = useState(false);
  const [draftSuggestion, setDraftSuggestion] = useState<string | null>(null);
  const [draftMeta, setDraftMeta] = useState<DraftResult | null>(null);
  useEffect(() => {
    if (!agentProduction.active) return;
    const abort = new AbortController();
    const refresh = async () => {
      const target = window.__agentProductionTarget;
      if (!target?.link.runId || !target.customerId) return;
      const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(target.link.runId)}/customer-workspace`, { headers: authHeader(), signal: abort.signal });
      if (!response.ok) return;
      const data = await response.json();
      const item = data.items?.find((row: { customer_id: string }) => row.customer_id === target.customerId);
      if (!abort.signal.aborted && item?.draft_body) setDraftSuggestion(item.draft_body);
    };
    const update = () => { void refresh().catch(() => {}); };
    update();
    window.addEventListener('lingshu:agent-business-refresh', update);
    return () => { abort.abort(); window.removeEventListener('lingshu:agent-business-refresh', update); };
  }, [agentProduction.active]);

  const [learnCandidate, setLearnCandidate] = useState<null | { buyerMessage: string; answer: string; question: string; saving?: boolean }>(null);
  const [learnDialogOpen, setLearnDialogOpen] = useState(false);
  const [input, setInput] = useState('');
  const [translatedInput, setTranslatedInput] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [pendingSendIntent,setPendingSendIntent]=useState<CustomerSendIntent|null>(null);
  const [manualHold,setManualHold]=useState<{identity:string;view:CustomerManualTakeoverView}|null>(null);
  const [manualHoldError,setManualHoldError]=useState<{identity:string;message:string}|null>(null);
  const manualHoldBusy=useRef(false);
  const [manualHoldUnknown,setManualHoldUnknown]=useState<string|null>(null);
  const preparingSendRef=useRef(false);

  const saveSendIntent=(intent:CustomerSendIntent)=>{localStorage.setItem(sendIntentStorageKey(intent.scope),JSON.stringify(intent));setPendingSendIntent(intent);};
  const translationRequestRef = useRef(0);
  const [toast, setToast] = useState<string | null>(null);
  const [undoSend, setUndoSend] = useState<null | { customerId: string; eventId: string; restoreText: string; timer: number }>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [priceRulesReady, setPriceRulesReady] = useState(true);
  const [notificationReady, setNotificationReady] = useState(true);
  const [lastDraftKey, setLastDraftKey] = useState('');
  const deepLinkConsumedRef = useRef(false);
  const filterEmptySelectionRef = useRef(false);
  const selected = useMemo(() => (
    selectedId ? customers.find(customer => customer.id === selectedId) ?? null : null
  ), [customers, selectedId]);
  useEffect(()=>{let live=true;setPendingSendIntent(null);if(selected&&!selected.isMock&&!selected.isHistorical){void readCustomerSendScope(selected.id).then(scope=>{if(live)setPendingSendIntent(readSendIntent(localStorage,scope));}).catch(()=>{});}return()=>{live=false;};},[selected?.id]);
  const manualHoldIdentity=JSON.stringify([selected?.id,selected?.source,selected?.waNumber,selected?.pageId,selected?.instagramAccountId,authHeader().Authorization]);
  const actualManualIdentity=useRef(manualHoldIdentity);actualManualIdentity.current=manualHoldIdentity;
  useEffect(()=>{let active=true;setManualHold(null);setManualHoldError(null);setManualHoldUnknown(null);if(selected&&!selected.isMock&&!selected.isHistorical){void customerManualTakeoverApi.read(selected.id).then(view=>{if(active&&actualManualIdentity.current===manualHoldIdentity)setManualHold({identity:manualHoldIdentity,view});}).catch(error=>{if(active&&actualManualIdentity.current===manualHoldIdentity)setManualHoldError({identity:manualHoldIdentity,message:error instanceof Error?error.message:'接管状态读取失败'});});}return()=>{active=false;};},[manualHoldIdentity,selected?.id]);
  const selectedLatestBuyerId = useMemo(() => (
    selected ? [...selected.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer')?.id ?? '' : ''
  ), [selected?.id, selected?.timeline]);
  const customersInActiveView = useMemo(() => filterCustomers(view, customers), [view, customers]);
  const activeView = VIEW_META[view];
  const partialAutoReplyActive = Boolean(customerServiceStatus?.autoReplyReady && autonomyLevel === 'auto');
  const customerPendingCount = useMemo(() => pendingCount(customers), [customers]);
  const customerTodoItems = useMemo(() => (
    dailyTodoCustomers(customers.filter(customer => !customer.isHistorical)).map(customer => {
      const suggestion = buildPrioritySuggestion(customer);
      const completed = isTodoCompleted(customer);
      return {
        id: customer.id,
        name: customer.name,
        product: customer.product,
        source: customer.source,
        headline: completed ? '今日任务已处理' : suggestion.headline,
        reason: completed ? '今天已处理，已放到待办底部' : suggestion.reason,
        tone: completed ? 'green' : suggestion.tone,
        completed,
      };
    })
  ), [customers]);

  const savePendingDraft = useCallback((customer: CustomerProfile, draft?: string) => {
    const pendingDraft = draft?.trim() || undefined;
    updateCustomer(customer.id, { pendingDraft });
    if (customer.isMock) {void saveLocalCustomerDraft(customer.id,pendingDraft??null).catch(error=>showToast(error.message));return;}
    void fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ pendingDraft: pendingDraft ?? null }),
    }).catch(() => {
      // 本地状态仍保留，下次后端同步时再以服务端为准。
    });
  }, [updateCustomer]);

  useConversionSessionEffects({
    customers, customersInActiveView, selectedId, deliveryHandoff, agentProductionActive: agentProduction.active,
    customerPendingCount, deepLinkConsumedRef, filterEmptySelectionRef, setSelectedId, setView, setDeliveryError,
    updateCustomer, setCustomerServiceStatus, setCustomerServiceStatusLoadFailed, setAutonomyLevel,
    setPriceRulesReady, setNotificationReady, setTemplates, setDailyBriefingOpen,
  });

  useConversionDraftEffects({
    selected, selectedId, selectedLatestBuyerId, customerServiceStatus, lastDraftKey, view, activeView,
    customerPendingCount, customerTodoItems, translationRequestRef, setDraftSuggestion, setDraftMeta,
    setLastDraftKey, setInput, setTranslatedInput, updateTimelineEvent, savePendingDraft,
  });

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? null : current), 2200);
  };

  const changeCustomerServiceEnabled = async (enabled: boolean) => {
    if (customerServiceSaving) return;
    if (!enabled && customerServiceStatus?.enabled) {
      const confirmed = await modal.confirm({ title: '关闭智能客服？', content: '关闭后，新客户消息只进入收件箱，灵小枢不再生成建议，也不会自动发送。', okText: '确认关闭', cancelText: '继续使用', icon: <AlertTriangle size={20}/> });
      if (!confirmed) return;
    }
    setCustomerServiceSaving(true);
    try {
      const status = await updateCustomerServiceStatus({ enabled });
      setCustomerServiceStatus(status);
      setCustomerServiceStatusLoadFailed(false);
      setAutonomyLevel('draft');
      setDraftSuggestion(null);
      setDraftMeta(null);
      showToast(enabled ? '智能客服已开启，当前只给建议，不会直接发送' : '智能客服已关闭');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '设置保存失败');
    } finally {
      setCustomerServiceSaving(false);
    }
  };

  const decidePartialAutoReply = async (decision: 'enabled' | 'declined') => {
    if (customerServiceSaving) return;
    setCustomerServiceSaving(true);
    try {
      const status = await updateCustomerServiceStatus({ partialAutoReplyDecision: decision });
      setCustomerServiceStatus(status);
      setAutonomyLevel(decision === 'enabled' ? 'auto' : 'draft');
      showToast(decision === 'enabled'
        ? (status.autoReplyReady ? '已开放低风险常见问答直回' : '权限已开放，知识库准备好前仍只给建议')
        : '继续保持建议模式');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '设置保存失败');
    } finally {
      setCustomerServiceSaving(false);
    }
  };

  const ensureCustomerServiceEnabled = () => {
    if (customerServiceStatus?.enabled) return true;
    showToast('先开启智能客服，开启后只会给建议，不会直接发送');
    return false;
  };

  const persistCustomerPatch = (id: string, patch: Partial<CustomerProfile>) => {
    const current = customers.find(item => item.id === id);
    if (!current || current.isHistorical) return;
    const rollback = Object.fromEntries(Object.keys(patch).map(key => [key, current[key as keyof CustomerProfile]])) as Partial<CustomerProfile>;
    updateCustomer(id, patch);
    if (current.isMock) return;
    const payload = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]));
    void fetch(`/api/overseas/customers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    }).then(async response => {
      if (response.ok) return;
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || data.error || '客户资料保存失败');
    }).catch(error => {
      updateCustomer(id, rollback);
      showToast(error instanceof Error ? error.message : '客户资料保存失败');
    });
  };

  const markTodoCompleted = (id: string) => {
    persistCustomerPatch(id, { todoCompletedAt: new Date().toISOString(), hasUnread: false });
  };

  const markSelectedTodoCompleted = () => {
    if (selected) markTodoCompleted(selected.id);
  };

  const prepareLearnCandidate = async (buyerMessage: string, answer: string) => {
    let question = buyerMessage;
    try {
      const result = await fetch('/api/overseas/enterprise/faq/learned/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ buyerMessage }),
      }).then(resp => resp.json());
      if (typeof result?.question === 'string' && result.question.trim()) question = result.question.trim();
    } catch {
      // Keep buyer message as editable fallback.
    }
    setLearnCandidate({ buyerMessage, answer, question });
    setLearnDialogOpen(false);
  };

  const saveLearnedFaq = async () => {
    if (!learnCandidate) return;
    setLearnCandidate(current => current ? { ...current, saving: true } : current);
    try {
      await fetch('/api/overseas/enterprise/faq/learned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          buyerMessage: learnCandidate.buyerMessage,
          question: learnCandidate.question,
          answer: learnCandidate.answer,
        }),
      }).then(resp => {
        if (!resp.ok) throw new Error('保存失败');
        return resp.json();
      });
      setLearnCandidate(null);
      setLearnDialogOpen(false);
      showToast('已存入知识库，待老板审批后可自动回复');
    } catch (error) {
      setLearnCandidate(current => current ? { ...current, saving: false } : current);
      showToast(error instanceof Error ? error.message : '保存失败');
    }
  };

  useEffect(() => {
    if (!isDemo) return;
    const previousDemo = window.__lingshuDemo;
    const previousPushBuyerMessage = previousDemo?.pushBuyerMessage;

    window.__lingshuDemo = {
      ...(previousDemo ?? {}),
      pushBuyerMessage: (customerId: string, text: string) => {
        const body = text.trim();
        if (!customerId || !body) return;
        const event = createMessageEvent(customerId, body, 'buyer');
        appendTimelineEvent(customerId, event);
        updateCustomer(customerId, { hasUnread: true, lastActive: '刚刚', lastActiveAt: event.timestamp });
      },
    };

    return () => {
      if (!window.__lingshuDemo) return;
      if (previousPushBuyerMessage) {
        window.__lingshuDemo.pushBuyerMessage = previousPushBuyerMessage;
        return;
      }
      delete window.__lingshuDemo.pushBuyerMessage;
      if (Object.keys(window.__lingshuDemo).length === 0) delete window.__lingshuDemo;
    };
  }, [appendTimelineEvent, isDemo, updateCustomer]);

  const updateHandlingMode = (mode: HandlingMode) => {
    if (!selected || selected.isHistorical) return;
    if (mode === 'ai_auto' && !partialAutoReplyActive) {
      if (!ensureCustomerServiceEnabled()) return;
      showToast('当前只给建议，满 3 天并授权后才可部分自动回复');
      mode = 'ai_draft';
    }
    persistCustomerPatch(selected.id, {
      handlingMode: mode,
      needCall: mode === 'human_needed' ? selected.needCall : false,
      aiAutoCount: mode === 'ai_auto' ? selected.aiAutoCount ?? 0 : selected.aiAutoCount,
      todoCompletedAt: mode === 'ai_auto' ? new Date().toISOString() : undefined,
    });
  };

  const buildStyleMemoryPayload = (customer: CustomerProfile, finalZh: string, meta?: DraftResult | null): StyleMemoryPayload | null => {
    const original = meta?.originalDraft || meta?.draft || '';
    const trigger = meta?.buyerMessage || latestBuyerText(customer);
    if (!original || !finalZh.trim() || !trigger) return null;
    const edited = original.trim() !== finalZh.trim();
    const riskLevel = customer.handlingMode === 'human_needed' ? 'L4' : customer.handlingMode === 'ai_draft' ? 'L3' : 'L2';
    const interventionType = !edited ? 'direct_adoption'
      : meta?.knowledgeMiss ? 'fact_review'
      : riskLevel === 'L4' ? 'risk_handoff'
      : customer.progressionGoal ? 'progression_edit'
      : 'expression_edit';
    return {
      triggerMessage: `中文概括：客户询问 ${customer.product || customer.outboundProduct} 相关问题\n原文：${trigger}`,
      draftOriginal: original,
      finalSent: finalZh,
      edited,
      category: meta?.category || 'reply',
      strategyIds: meta?.strategies?.map(item => item.id).filter(Boolean) ?? [],
      nodeId: `${customer.stage}:${meta?.category || 'reply'}`,
      riskLevel,
      diffTags: edited ? [interventionType, 'human_final_differs_from_ai_draft'] : ['direct_adoption'],
      interventionType,
      outcome3Turn: 'pending_observation',
      outcome24h: 'pending_observation',
      finalOutcome: customer.stage === 'won' ? 'won' : 'not_yet_attributed',
    };
  };

  const queueSend = async (customer: CustomerProfile, body: string, restoreText: string, templatePlan?: TemplatePlan | null, meta?: DraftResult | null) => {
    if (customer.isHistorical || customer.readOnly || customer.outboundBlocked) {
      showToast('历史会话仅供查看，不能对外发送');
      return;
    }
    if(preparingSendRef.current)return;
    preparingSendRef.current=true;
    let scope:CustomerSendIntent['scope']|null=null;
    if(!customer.isMock){try {scope=await readCustomerSendScope(customer.id);const existing=readSendIntent(localStorage,scope);if(existing&&existing.state!=='accepted'){preparingSendRef.current=false;setPendingSendIntent(existing);setSendingReply(false);showToast('原发送结果尚未确认，请先读取发送状态');return;}}catch(error){preparingSendRef.current=false;setSendingReply(false);showToast(error instanceof Error?error.message:'发送身份读取失败');return;}}
    const sendingAuthorization=authHeader().Authorization;
    const requestId=crypto.randomUUID();
    const styleMemory = buildStyleMemoryPayload(customer, restoreText, meta);
    const eventBody = templatePlan ? templatePlan.rendered : body;
    const event = createMessageEvent(customer.id, eventBody, 'seller', {
      type: customer.source === 'whatsapp' ? 'whatsapp' : customer.source === 'instagram' ? 'instagram' : 'messenger',
      sendStatus: 'queued',
      sendRequestId: requestId,
      sendMode: templatePlan ? 'template' : 'free_text',
      confirmedByHuman: true,
      translatedBody: restoreText.trim() && restoreText.trim() !== eventBody.trim() ? restoreText.trim() : undefined,
      audit: meta?.knowledgeMiss ? { knowledgeMiss: true, buyerMessage: meta.buyerMessage, evidence: meta.evidence } : undefined,
    });
    const intent:CustomerSendIntent|null=scope?{scope,requestId,eventId:event.id,state:'prepared'}:null;
    if(intent){try{saveSendIntent(intent);}catch{preparingSendRef.current=false;setSendingReply(false);showToast('无法保存发送请求身份，尚未发送');return;}}
    preparingSendRef.current=false;
    appendTimelineEvent(customer.id, event);
    setDraftSuggestion(null);
    setDraftMeta(null);
    setInput('');
    setTranslatedInput('');

    let sendAccepted=false;
    const timer = window.setTimeout(() => {
      setUndoSend(current => current?.eventId === event.id ? null : current);
      const send=async()=>{if(authHeader().Authorization!==sendingAuthorization)throw new Error('登录身份已变化，原请求尚未发送');if(intent){assertSendScope(intent.scope,await readCustomerSendScope(customer.id));if(authHeader().Authorization!==sendingAuthorization)throw new Error('登录身份已变化，原请求尚未发送');saveSendIntent({...intent,state:'unknown'});}return sendCustomerOutbox(customer,requestId,body, isOutsideWhatsAppWindow(customer), templatePlan, styleMemory);};
      void send()
        .then(async result => {
          if(authHeader().Authorization!==sendingAuthorization)throw new Error('登录身份已变化，请重新读取原发送状态');
          if(intent){assertSendScope(intent.scope,await readCustomerSendScope(customer.id));const receipt=await readCustomerSendRequest(intent);const recovered=recoverSendIntent(intent,receipt);saveSendIntent(recovered);if(recovered.state!=='accepted')throw new Error('发送结果尚未确认，请读取发送状态');}
          if(!['sent','delivered'].includes(result.status||''))throw new Error('发送结果尚未确认');
          sendAccepted=true;
          if(customer.localSimulation && result.timeline) updateCustomer(customer.id,{timeline:result.timeline}); else updateTimelineEvent(customer.id, event.id, {
            sendStatus: result.status,
            audit: {
              ...(event.audit || {}),
              providerMessageId: result.providerMessageIds?.[0] || result.outboxId,
            },
          });
          if (meta?.knowledgeMiss && meta.buyerMessage) {
            await prepareLearnCandidate(meta.buyerMessage, restoreText);
            showToast('已发送，可将这条补进知识库');
          }
          persistCustomerPatch(customer.id, { lastActive: '刚刚', hasUnread: false, todoCompletedAt: new Date().toISOString(), pendingDraft: undefined });
          setSendingReply(false);
          setUndoSend(null);
        })
        .catch(error => {
          if(authHeader().Authorization!==sendingAuthorization){setPendingSendIntent(null);setSendingReply(false);setUndoSend(null);return;}
          if(sendAccepted){setSendingReply(false);setUndoSend(null);showToast('已发送，后续记录保存需要核验');return;}
          updateTimelineEvent(customer.id,event.id,{sendStatus:'unknown'});
          if(intent&&intent.state!=='accepted'){try{saveSendIntent({...intent,state:'unknown'});}catch{/* Retain visible event; never issue another request. */}}
          setSendingReply(false);
          setUndoSend(null);
          showToast(error instanceof Error ? error.message : '发送失败');
        });
    }, 4000);

    setUndoSend({ customerId: customer.id, eventId: event.id, restoreText, timer });
  };

  const undoQueuedSend = () => {
    if (!undoSend) return;
    window.clearTimeout(undoSend.timer);
    if(pendingSendIntent?.eventId===undoSend.eventId&&pendingSendIntent.state==='prepared'){localStorage.removeItem(sendIntentStorageKey(pendingSendIntent.scope));setPendingSendIntent(null);}
    removeTimelineEvent(undoSend.customerId, undoSend.eventId);
    if (selected?.id === undoSend.customerId) {
      setInput(undoSend.restoreText);
      setTranslatedInput('');
      savePendingDraft(selected, undoSend.restoreText);
    }
    setUndoSend(null);
    setSendingReply(false);
  };

  const sendReply = async () => {
    if (!selected || sendingReply) return;
    setSendingReply(true);
    try {
      if (isOutsideWhatsAppWindow(selected)) {
        showToast(`距客户上次互动已超过 24 小时，当前不能直接发送普通 ${selected.source === 'instagram' ? 'Instagram' : 'Messenger'} 消息。`);
        setSendingReply(false);
        return;
      }
      const body = translatedInput.trim() || await translateReplyToCustomerLanguage(selected, input);
      if (!body) {
        setSendingReply(false);
        return;
      }
      queueSend(selected, body, input, null, draftMeta?.knowledgeMiss ? draftMeta : null);
    } catch (error) {
      setSendingReply(false);
      showToast(error instanceof Error ? error.message : '发送失败');
    }
  };

  const sendDraftDirectly = async () => {
    if (!selected || !draftSuggestion || sendingReply) return;
    setSendingReply(true);
    if (isOutsideWhatsAppWindow(selected)) {
      showToast(`距客户上次互动已超过 24 小时，当前不能直接发送普通 ${selected.source === 'instagram' ? 'Instagram' : 'Messenger'} 消息。`);
      setSendingReply(false);
      return;
    }
    try {
      const body = await translateReplyToCustomerLanguage(selected, draftSuggestion);
      queueSend(selected, body, draftSuggestion, null, draftMeta);
    } catch (error) {
      setSendingReply(false);
      showToast(error instanceof Error ? error.message : '发送失败');
    }
  };

  const generateManualDraft = async (instruction: string, intent: DraftIntent = 'reply') => {
    if (!selected || selected.isHistorical) return;
    if (intent !== 'polish' && isWaitingForHumanQuote(selected)) {
      showToast('客户正在询价，已标记等待人工报价，请由销售亲自回复。');
      return;
    }
    setDraftSuggestion(null);
    setDraftMeta(null);
    const result = await requestDraft(selected, instruction, undefined, intent, true);
    if (!result.draft && result.status) { showToast(result.handlingReason || result.code || '草稿暂不可用'); setDraftMeta(result); return; }
    if (result.handoffRequired) {
      updateCustomer(selected.id, { handlingMode: 'human_needed', handlingReason: result.handlingReason || '该消息需要人工接手' });
      if (result.safeToSendBeforeHandoff && result.draft.trim()) {
        setDraftSuggestion(result.draft);
        setDraftMeta(result);
        savePendingDraft(selected, result.draft);
      }
      showToast(result.safeToSendBeforeHandoff && result.draft.trim()
        ? '已生成安全承接话术，并标记人工接管'
        : result.handlingReason || '该消息需要人工接手。');
      return;
    }
    setDraftSuggestion(result.draft);
    setDraftMeta(result);
    savePendingDraft(selected, result.draft);
  };

  const regenerateDraft = async () => {
    if (!selected || selected.isHistorical) return;
    if (isWaitingForHumanQuote(selected)) {
      showToast('报价问题不生成 AI 回复，请由销售亲自回复。');
      return;
    }
    const result = await requestDraft(selected, undefined, undefined, 'reply', true);
    if (!result.draft && result.status) { showToast(result.handlingReason || result.code || '草稿暂不可用'); setDraftMeta(result); return; }
    if (result.handoffRequired) {
      updateCustomer(selected.id, { handlingMode: 'human_needed', handlingReason: result.handlingReason || '该消息需要人工接手' });
      if (result.safeToSendBeforeHandoff && result.draft.trim()) {
        setDraftSuggestion(result.draft);
        setDraftMeta(result);
        savePendingDraft(selected, result.draft);
      }
      showToast(result.safeToSendBeforeHandoff && result.draft.trim()
        ? '已换一条安全承接话术，并标记人工接管'
        : result.handlingReason || '该消息需要人工接手。');
      return;
    }
    setDraftSuggestion(result.draft);
    setDraftMeta(result);
    savePendingDraft(selected, result.draft);
  };

  const previewTranslate = useCallback(async () => {
    if (!selected || !input.trim()) return;
    const requestId = ++translationRequestRef.current;
    const translation = await translateReplyToCustomerLanguage(selected, input);
    if (translationRequestRef.current === requestId) setTranslatedInput(translation.trim() === input.trim() ? '' : translation);
  }, [input, selected]);

  const refreshManualHold=async()=>{if(!selected||selected.isHistorical||selected.isMock)return;const captured=manualHoldIdentity;try{const view=await customerManualTakeoverApi.read(selected.id);if(actualManualIdentity.current!==captured)return;setManualHold({identity:captured,view});setManualHoldUnknown(null);setManualHoldError(null);}catch(error){if(actualManualIdentity.current===captured)setManualHoldError({identity:captured,message:error instanceof Error?error.message:'真实接管状态尚未恢复'});}};
  const reportManualActive = () => {
    if(!selected||selected.isHistorical||selected.isMock||manualHoldBusy.current||manualHoldUnknown===manualHoldIdentity)return;
    const cached=manualHold?.identity===manualHoldIdentity?manualHold.view:null;if(cached?.active&&cached.item?.ownerUserId===cached.actorUserId&&Date.parse(cached.item.expiresAt)>Date.now()+60000)return;
    const captured=manualHoldIdentity;manualHoldBusy.current=true;
    void customerManualTakeoverApi.read(selected.id).then(async view=>{if(actualManualIdentity.current!==captured)return;await customerManualTakeoverApi.hold(view,10);if(actualManualIdentity.current!==captured)return;await refreshManualHold();}).catch(error=>{if(actualManualIdentity.current===captured){setManualHoldUnknown(captured);setManualHoldError({identity:captured,message:error instanceof Error?error.message:'接管结果未知，请只读恢复'});}}).finally(()=>{manualHoldBusy.current=false;});
  };
  const releaseManualHold=async()=>{const view=manualHold?.identity===manualHoldIdentity?manualHold.view:null;if(!view||!view.item||!view.canRelease||manualHoldBusy.current||manualHoldUnknown===manualHoldIdentity)return;const captured=manualHoldIdentity;manualHoldBusy.current=true;try{await customerManualTakeoverApi.release(view);if(actualManualIdentity.current!==captured)return;await refreshManualHold();}catch(error){if(actualManualIdentity.current===captured){setManualHoldUnknown(captured);setManualHoldError({identity:captured,message:error instanceof Error?error.message:'释放结果未知，请只读恢复'});}}finally{manualHoldBusy.current=false;}};

  const openCustomer = (id: string) => {
    setMobilePanel('chat');
    setSelectedId(id);
    const customer = customers.find(item => item.id === id);
    if (customer?.hasUnread) persistCustomerPatch(id, { hasUnread: false });
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) openCustomer(id);
    };
    window.addEventListener('lingshu:select-customer', handler);
    return () => window.removeEventListener('lingshu:select-customer', handler);
  }, [customers]);

  const focusReplyInput = () => {
    setMobilePanel('chat');
    const inputEl = document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input]');
    inputEl?.focus();
    inputEl?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
  };

  const viewDraftSuggestion = () => {
    setMobilePanel('chat');
    const draftEl = document.querySelector<HTMLElement>('[data-draft-suggestion]');
    if (draftEl) {
      draftEl.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
      return;
    }
    if (selected?.pendingDraft?.trim() && !input.trim()) {
      setInput(selected.pendingDraft.trim());
      focusReplyInput();
      return;
    }
    focusReplyInput();
  };

  const { label: customerServiceLabel, summary: customerServiceSummary } = customerServicePresentation(
    customerServiceStatus, customerServiceStatusLoadFailed, partialAutoReplyActive,
  );


  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    {selected && <LocalCustomerSimulationLauncher customer={selected} onPatch={patch=>persistCustomerPatch(selected.id,patch)}/>}
    <h1 className="sr-only">{PAGE_REGISTRY.conversion.canonicalTitle}</h1>
    {deliveryHandoff?.runId&&deliveryError&&<p role="alert" className="mx-4 mt-3 text-sm text-red-700">{deliveryError}</p>}
    {deliveryHandoff?.runId && <div className="max-h-[35%] shrink-0 overflow-y-auto"><CustomerWorkflowPanel handoff={deliveryHandoff} customers={customers} /></div>}
    {deliveryHandoff && !deliveryHandoff.runId && <section className="mx-4 mt-3 shrink-0 border-l-2 border-accent bg-accent-glow p-3">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-accent">来自业务交付看板 · 客户跟进草稿</p></div>
      {deliveryError ? <p role="alert" className="mt-2 text-xs text-red-700">{deliveryError}</p> : deliveryDraft ? <>
        <details className="mt-2 text-xs text-text-primary"><summary className="cursor-pointer">查看关联草稿 v{deliveryDraft.version}</summary><p className="mt-2 whitespace-pre-wrap leading-6">{deliveryDraft.body}</p></details>
        <p className="mt-2 text-[11px] text-text-muted">此处展示所属批次的草稿。批次审核请返回交付看板；会话中的回复操作独立处理。</p>
      </> : <p className="mt-2 text-xs text-text-muted">没有对应的草稿记录，请返回交付看板选择具体客户任务。</p>}
    </section>}
    <div className="ls-conversation-container flex min-h-0 min-w-0 flex-1 flex-col" data-lingshu-guide="customer-workbench">
      <nav aria-label="会话区域导航" className="ls-conversation-workspace-nav h-12 shrink-0 grid-cols-3 border-b border-border bg-surface">
        {([
          { id: 'list' as const, label: '会话列表', icon: List },
          { id: 'chat' as const, label: '当前对话', icon: MessageSquare },
          { id: 'profile' as const, label: '客户资料', icon: UserRound },
        ]).map(item => {
          const Icon = item.icon;
          const active = mobilePanel === item.id;
          return <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => setMobilePanel(item.id)}
            className={`flex min-w-0 items-center justify-center gap-1.5 border-b-2 px-2 text-xs font-semibold transition-colors ${active ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary'}`}
          >
            <Icon size={15} aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </button>;
        })}
      </nav>
      <div data-testid="conversation-workspace-main" className="ls-conversation-workspace min-h-0 flex-1">
        <div className={`ls-conversation-workspace__slot ls-conversation-workspace__pane${mobilePanel === 'list' ? ' is-active' : ''}`}>
        <CompactCustomerList
          headerActions={<CustomerServiceSwitch enabled={Boolean(customerServiceStatus?.enabled)}
            unavailable={!customerServiceStatus || customerServiceStatusLoadFailed} saving={customerServiceSaving}
            summary={`${customerServiceLabel}。${customerServiceSummary}`}
            onChange={enabled => void changeCustomerServiceEnabled(enabled)} />}
          view={view}
          selectedId={selectedId}
          customers={customers}
          onOpen={openCustomer}
          onViewChange={(nextView) => { filterEmptySelectionRef.current = false; setView(nextView); }}
          onVisibleSelectionChange={(id, filteredEmpty) => {
            filterEmptySelectionRef.current = filteredEmpty;
            setSelectedId(id);
          }}
        />
        </div>
        <div className={`ls-conversation-workspace__slot ls-conversation-workspace__pane${mobilePanel === 'chat' ? ' is-active' : ''}`}>
        {pendingSendIntent&&pendingSendIntent.scope.customerId===selected?.id&&pendingSendIntent.state!=='accepted'&&<div className="border border-amber-200 bg-amber-50 p-3 text-xs">原发送结果未确认；不会自动重发。{pendingSendIntent.state==='prepared'&&<button type="button" className="ml-2 underline" onClick={()=>{if(undoSend?.eventId===pendingSendIntent.eventId){undoQueuedSend();return;}localStorage.removeItem(sendIntentStorageKey(pendingSendIntent.scope));removeTimelineEvent(pendingSendIntent.scope.customerId,pendingSendIntent.eventId);setPendingSendIntent(null);}}>取消尚未发起的请求</button>}<button type="button" className="ml-2 underline" onClick={()=>{const captured=manualHoldIdentity;void readCustomerSendRequest(pendingSendIntent).then(item=>{if(actualManualIdentity.current!==captured)return;const next=recoverSendIntent(pendingSendIntent,item);saveSendIntent(next);updateTimelineEvent(next.scope.customerId,next.eventId,{sendStatus:next.state==='accepted'?'sent':'unknown',audit:{providerMessageId:item.providerMessageId||undefined}});showToast(next.state==='accepted'?'已读取真实平台发送回执':'平台结果仍未知，请勿重复发送');}).catch(error=>{if(actualManualIdentity.current===captured)showToast(error instanceof Error?error.message:'无法读取发送状态');});}}>读取原发送状态</button></div>}
        {selected&&!selected.isMock&&!selected.isHistorical&&<div className="border border-border bg-surface-2 p-3 text-xs"><strong>真人接管</strong>{manualHold?.identity===manualHoldIdentity&&<span className="ml-2">{manualHold.view.active?`负责人 ${manualHold.view.item?.ownerUserId} · 截止 ${manualHold.view.item?.expiresAt}`:'当前没有有效临时接管'}{manualHold.view.humanHandling?'；客户仍处于持久人工处理状态，到期或释放临时接管不会自动切换 AI。':''}</span>}<button type="button" className="ml-2 underline" onClick={reportManualActive} disabled={manualHoldUnknown===manualHoldIdentity}>明确接管十分钟</button><button type="button" className="ml-2 underline" onClick={()=>void refreshManualHold()}>只读刷新状态</button>{manualHold?.identity===manualHoldIdentity&&manualHold.view.active&&manualHold.view.canRelease&&<button type="button" className="ml-2 underline" disabled={manualHoldUnknown===manualHoldIdentity} onClick={()=>void releaseManualHold()}>明确释放临时接管</button>}{manualHoldError?.identity===manualHoldIdentity&&<p role="alert" className="mt-1 text-amber-800">{manualHoldError.message}</p>}{manualHoldUnknown===manualHoldIdentity&&<p className="mt-1 text-amber-800">操作结果未恢复，禁止重复操作；请先只读刷新实际持久状态。</p>}</div>}
        {selected&&<CustomerReplyRecovery key={`${selected.id}:${draftMeta?.requestId}`} meta={draftMeta} onRecovered={result=>{setDraftMeta(result);setDraftSuggestion(result.draft);if(result.draft)savePendingDraft(selected,result.draft);}}/>}
        <ChatThread
          customer={selected}
          draftSuggestion={draftSuggestion}
          input={input}
          translatedInput={translatedInput}
          onInputChange={(value) => { translationRequestRef.current += 1; setInput(value); setTranslatedInput(''); if (selected?.pendingDraft !== undefined) updateCustomer(selected.id, { pendingDraft: value || undefined }); }}
          onDraftChange={value => { setDraftSuggestion(value || null); if (selected) updateCustomer(selected.id, { pendingDraft: value || undefined }); if (!value) setDraftMeta(null); }}
          onTranslatedInputChange={setTranslatedInput}
          savingDraft={savingDraft}
          onSaveDraft={(value) => {
            if (!selected || !value.trim() || savingDraft) return;
            const customer = selected;
            const pendingDraft = value.trim();
            setSavingDraft(true);
            void (async () => {
              try {
                if (customer.isMock) await saveLocalCustomerDraft(customer.id,pendingDraft);
                else {
                  const response = await fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
                    body: JSON.stringify({ pendingDraft }),
                  });
                  if (!response.ok) throw new Error('草稿保存失败，请重试；输入内容仍保留。');
                }
                updateCustomer(customer.id, { pendingDraft });
                showToast('草稿已保存，可在客户资料中查看草稿');
              } catch (error) {
                showToast(error instanceof Error ? error.message : '草稿保存失败，请重试');
              } finally { setSavingDraft(false); }
            })();
          }}
          onSend={sendReply}
          onSendDraft={sendDraftDirectly}
          onDismissDraft={() => { setDraftSuggestion(null); setDraftMeta(null); if (selected) savePendingDraft(selected); }}
          onRegenerateDraft={regenerateDraft}
          onSceneDraft={(intent) => void generateManualDraft('', intent)}
          onPreviewTranslate={previewTranslate}
          templates={templates}
          onManualActive={reportManualActive}
          priceRulesReady={priceRulesReady}
          knowledgeMiss={Boolean(draftMeta?.knowledgeMiss)}
          bridgeOnly={draftMeta?.replyConfidence?.level === 'bridge_only'}
          draftMeta={draftMeta}
          sending={sendingReply}
          channelReady={Boolean(selected?.isMock ? selected.localSimulation?.approvedBody : (selected?.source === 'messenger' ? customerServiceStatus?.messengerAuthorization : selected?.source === 'instagram' ? customerServiceStatus?.instagramAuthorization : customerServiceStatus?.messagingAuthorization)?.providerReady)}
          onInsertQuoteReply={(text) => {
            if (!selected || selected.isHistorical) return;
            reportManualActive();
            translationRequestRef.current += 1;
            setInput(text);
            setTranslatedInput('');
            setDraftSuggestion(null);
            setDraftMeta(null);
            savePendingDraft(selected, text);
            setMobilePanel('chat');
          }}
          onQuoteCardSent={(summary, providerMessageId) => {
            if (!selected || selected.isHistorical) return;
            appendTimelineEvent(selected.id, createMessageEvent(selected.id, summary, 'seller', {
              type: 'quote',
              title: '已发送报价卡片',
              sendStatus: 'sent',
              confirmedByHuman: true,
              audit: { action: 'formal_quote_card_sent', risk: 'L4', providerMessageId },
            }));
          }}
          onToast={showToast}
        />
        </div>
        <div className={`ls-conversation-workspace__slot ls-conversation-workspace__pane${mobilePanel === 'profile' ? ' is-active' : ''}`}>
        {selected?.isHistorical ? <div className="p-4 text-xs leading-5 text-text-secondary">历史会话来源：已归档记录。仅保留原始内容供查阅，不代表已连接真实客户渠道；回复、报价和客户操作均不可用。</div> : <CustomerInfoRail
          key={selected?.id || 'no-customer'}
          customer={selected}
          onCustomerPatch={patch => selected && updateCustomer(selected.id, patch)}
          onGenerateDraft={generateManualDraft}
          onHandlingModeChange={updateHandlingMode}
          onToast={showToast}
          onFocusReply={focusReplyInput}
          onViewDraft={viewDraftSuggestion}
          onCompleteTodo={markSelectedTodoCompleted}
          customerServiceEnabled={Boolean(customerServiceStatus?.enabled)}
          autoReplyReady={partialAutoReplyActive}
          hasReplyReady={Boolean(draftSuggestion?.trim() || input.trim() || selected?.pendingDraft?.trim())}

        />}
        </div>
      </div>
      <Modal open={Boolean(customerServiceStatus?.shouldAskPartialAutoReply)} title="建议模式已经用了 3 天" width={560} closable={false} keyboard={false} mask={{ closable: false }} footer={<div className="flex flex-wrap justify-end gap-2">
        <Button disabled={customerServiceSaving} onClick={() => void decidePartialAutoReply('declined')}>继续只看建议</Button>
        <Button type="primary" loading={customerServiceSaving} onClick={() => void decidePartialAutoReply('enabled')}>开放部分直接回复</Button>
      </div>}>
        <p className="py-3 text-sm leading-6 text-text-secondary">要不要把一小部分简单问题交给灵小枢直接回？只有高置信命中你已审批的常见问答才会发送，报价、折扣、付款、交期和风险问题仍然交给你。</p>
        {customerServiceStatus && customerServiceStatus.approvedFaqCount < 5 && <Alert type="warning" title={`目前已审批 ${customerServiceStatus.approvedFaqCount} 条问答`} description="你可以先开放权限，达到 5 条前系统仍只给建议。"/>}
      </Modal>
      {dailyBriefingOpen && (
        <DailyBriefing customers={customers.filter(customer => !customer.isHistorical)} onSelectCustomer={openCustomer} onClose={() => setDailyBriefingOpen(false)} />
      )}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-2 text-xs font-bold text-text-primary">
          {toast}
          {learnCandidate && (
            <Button htmlType="button" onClick={() => { setToast(null); setLearnDialogOpen(true); }} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary">存进知识库</Button>
          )}
        </div>
      )}
      <Modal open={Boolean(learnCandidate && learnDialogOpen)} title="存进知识库" width={560} mask={{ closable: false }} onCancel={() => { if (!learnCandidate?.saving) { setLearnCandidate(null); setLearnDialogOpen(false); } }} footer={<div className="flex justify-end gap-2">
        <Button disabled={learnCandidate?.saving} onClick={() => { setLearnCandidate(null); setLearnDialogOpen(false); }}>取消</Button>
        <Button type="primary" loading={learnCandidate?.saving} onClick={() => void saveLearnedFaq()} disabled={!learnCandidate?.question.trim() || !learnCandidate?.answer.trim()}>确认入库</Button>
      </div>}>
        {learnCandidate && <div data-lingshu-guide="customer-knowledge-save" className="space-y-4 py-3"><label className="grid gap-2 text-sm">客户常问问题<Input aria-label="客户常问问题" value={learnCandidate.question} onChange={event => setLearnCandidate(current => current ? { ...current, question: event.target.value } : current)}/></label><label className="grid gap-2 text-sm">标准答案<Input.TextArea aria-label="标准答案" value={learnCandidate.answer} onChange={event => setLearnCandidate(current => current ? { ...current, answer: event.target.value } : current)} rows={4}/></label></div>}
      </Modal>
      {undoSend && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[80] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-2 text-xs font-bold text-text-primary">
          <span>{'\u5df2\u53d1\u9001\uff0c4 \u79d2\u5185\u53ef\u64a4\u56de'}</span>
          <Button htmlType="button" onClick={undoQueuedSend} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary">{'\u64a4\u56de'}</Button>
        </div>
      )}
    </div>
    </div>
  );
}
