import { Alert, App, Avatar, Button, Checkbox, Collapse, Empty, Input, Modal, Popover, Select, Switch, Tabs, Tag, Tooltip } from "antd";
import { PAGE_REGISTRY } from "../pageRegistry";
import { sortCustomersByLatestMessage } from '../lib/customerRecency';
import { useAgentProductionAction } from '../lib/agentProductionSession';
import CustomerWorkflowPanel from './CustomerWorkflowPanel';
import { useDeliveryHandoff } from "../hooks/useDeliveryHandoff";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Filter,
  FileImage,
  Info,
  Languages,
  MessageSquare,
  Search,
  Share2,
  Power,
  RefreshCw,
  Send,
  Smile,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { LsAvatarGroup, LsBrandAction, LsCompactFieldGroup, LsGradientProgress } from './ui/LsExperiencePrimitives';
import type { EmojiClickData, PickerProps } from 'emoji-picker-react';
import { authHeader } from '../lib/auth';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';
import { BasicInfoWidget } from './customers/widgets/BasicInfoWidget';
import { TagsWidget } from './customers/widgets/TagsWidget';
import { SourceIcon, sourceLabel } from './customers/SourceIcon';
import { LiveLocalTime } from './customers/LiveLocalTime';
import { DailyBriefing } from './customers/DailyBriefing';
import { SalesDecisionEvidence, type SalesDecisionMeta } from './customers/SalesDecisionEvidence';
import { QuoteSkillCard } from './customers/QuoteSkillCard';
import { isOutsideWhatsAppWindow, lastBuyerEvent, sceneChips, timelineEventAgeHours, type ConversationDraftIntent } from './customers/conversationTiming';
import { useCustomers } from '../hooks/useCustomers';
import { isPredominantlyChineseText } from '../lib/messageLanguage';
import { buildPrioritySuggestion, dailyTodoCustomers, isTodoCompleted, pendingCount, sortCustomersByPriority, type PrioritySuggestion } from '../lib/customerPriority';
import type { AutonomyLevel, CustomerProfile, CustomerStage, HandlingMode, TimelineEvent } from '../types/customer';
import { getCustomerServiceStatus, updateCustomerServiceStatus, type CustomerServiceStatus } from '../lib/customerService';

const EmojiPicker = lazy(async () => {
  const picker = await import('emoji-picker-react');
  const NativeEmojiPicker = (props: PickerProps) => <picker.default {...props} emojiStyle={picker.EmojiStyle.NATIVE} />;
  return { default: NativeEmojiPicker };
});

type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';
type DraftIntent = ConversationDraftIntent;
type CustomerFilterKey = 'source' | 'country' | 'language' | 'stage' | 'handling' | 'tag';

interface DraftResult {
  draft: string;
  translatedDraft?: string;
  handoffRequired?: boolean;
  fallbackCount?: number;
  safeToSendBeforeHandoff?: boolean;
  handlingReason?: string;
  replyConfidence?: { level: string; score: number; reason: string };
  knowledgeMiss?: boolean;
  missReason?: string;
  evidence?: string[];
  buyerMessage?: string;
  category?: string;
  originalDraft?: string;
  strategies?: Array<{ id: string; scenario: string; confidence: number; reason: string }>;
  decision?: SalesDecisionMeta['decision'];
}

interface MessageTemplate {
  name: string;
  label: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  body: string;
}

interface TemplatePlan {
  template: MessageTemplate;
  variables: string[];
  rendered: string;
}

interface CustomerListFilters {
  source: string;
  country: string;
  language: string;
  stage: string;
  handling: string;
  tag: string;
  unreadOnly: boolean;
  highIntentOnly: boolean;
}

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

const VIEW_META: Record<CustomerView, { label: string; desc: string }> = {
  inbox: { label: '收件箱', desc: '按紧急程度排序的待处理会话。' },
  leads: { label: '潜客', desc: '新询盘和正在推进的商机。' },
  won: { label: '成交客户', desc: '已下单、待跟进的客户。' },
  silent: { label: '沉默客户', desc: '30/60 天未互动、需要唤醒的客户。' },
};

const STAGE_LABEL: Record<CustomerStage, string> = {
  lead: '潜客',
  inquiry: '询盘中',
  quoted: '已报价',
  won: '已成交',
  silent30: '沉默30天',
  silent60: '沉默60天',
};

const STAGE_META: Record<CustomerStage, { color: string; bg: string }> = {
  lead: { color: 'var(--color-accent)', bg: 'var(--color-accent-glow)' },
  inquiry: { color: 'var(--color-accent-dim)', bg: 'var(--color-surface-2)' },
  quoted: { color: 'var(--color-amber)', bg: 'var(--color-amber-dim)' },
  won: { color: 'var(--color-accent)', bg: 'var(--color-accent-glow)' },
  silent30: { color: 'var(--color-amber)', bg: 'var(--color-amber-dim)' },
  silent60: { color: 'var(--color-red)', bg: 'rgba(183,77,67,0.08)' },
};

const EMPTY_CUSTOMER_FILTERS: CustomerListFilters = {
  source: 'all',
  country: 'all',
  language: 'all',
  stage: 'all',
  handling: 'all',
  tag: 'all',
  unreadOnly: false,
  highIntentOnly: false,
};

const HANDLING_COLOR: Record<HandlingMode, string> = {
  ai_auto: 'var(--color-accent)',
  ai_draft: 'var(--color-amber)',
  human_needed: 'var(--color-red)',
};

function filterCustomers(view: CustomerView, customers: CustomerProfile[]) {
  if (view === 'inbox') return sortCustomersByLatestMessage(customers.filter(customer => customer.inboxReason));
  if (view === 'leads') return customers.filter(customer => ['lead', 'inquiry', 'quoted'].includes(customer.stage)).sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return customers.filter(customer => customer.stage === 'won');
  return sortCustomersByPriority(customers.filter(customer => customer.stage === 'silent30' || customer.stage === 'silent60'));
}

function applyCustomerListFilters(customers: CustomerProfile[], filters: CustomerListFilters) {
  return customers.filter(customer => {
    if (filters.source !== 'all' && customer.source !== filters.source) return false;
    if (filters.country !== 'all' && customer.countryName !== filters.country) return false;
    if (filters.language !== 'all' && customer.language !== filters.language) return false;
    if (filters.stage !== 'all' && customer.stage !== filters.stage) return false;
    if (filters.handling !== 'all' && customer.handlingMode !== filters.handling) return false;
    if (filters.tag !== 'all' && !customer.tags.includes(filters.tag)) return false;
    if (filters.unreadOnly && !customer.hasUnread) return false;
    if (filters.highIntentOnly && customer.intentScore < 80) return false;
    return true;
  });
}

function replyLanguage(customer: CustomerProfile): string {
  if (customer.language.includes('阿语')) return 'Arabic';
  if (customer.language.includes('西语')) return 'Spanish';
  if (customer.language.includes('英语')) return 'English';
  return customer.language;
}

function latestBuyerMessage(customer: CustomerProfile): string {
  return [...customer.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer')?.body || '';
}

function inferMessageLanguage(text: string): 'Arabic' | 'Spanish' | 'English' | null {
  const body = text.trim();
  if (!body) return null;
  if (/[\u0600-\u06ff]/.test(body)) return 'Arabic';
  const lower = body.toLowerCase();
  if (/[????????]/i.test(body) || /\b(hola|gracias|precio|envio|env?o|cuanto|cu?nto|piezas|interesa)\b/.test(lower)) return 'Spanish';
  if (/[a-z]/i.test(body)) return 'English';
  return null;
}

function customerConversationLanguage(customer: CustomerProfile): string {
  return replyLanguage(customer);
}

function isSimpleGreeting(text: string): boolean {
  return /^(hi|hello|hey|hola|buenas|thanks|thank you|ok|okay|are you there|你好|您好)[\s?!,.。？！]*$/i.test(text.trim());
}

function fallbackConversationPhase(customer: CustomerProfile): 'first_contact' | 'ongoing' | 'resumed' {
  const latestBuyerIndex = customer.timeline.map(event => event.actor === 'buyer').lastIndexOf(true);
  if (latestBuyerIndex < 0) return 'first_contact';
  const previousSeller = [...customer.timeline.slice(0, latestBuyerIndex)]
    .reverse()
    .find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && (event.actor === 'seller' || event.actor === 'ai'));
  if (!previousSeller) return 'first_contact';
  const latestBuyerAt = Number(customer.timeline[latestBuyerIndex]?.timestamp);
  const previousSellerAt = Number(previousSeller.timestamp);
  if (Number.isFinite(latestBuyerAt) && Number.isFinite(previousSellerAt) && latestBuyerAt - previousSellerAt > 30 * 60_000) {
    return 'resumed';
  }
  return 'ongoing';
}

function fallbackCustomerReply(customer: CustomerProfile): string {
  if (isSimpleGreeting(latestBuyerMessage(customer))) {
    const phase = fallbackConversationPhase(customer);
    if (replyLanguage(customer) === 'Arabic') return phase === 'resumed' ? 'مرحبًا مجددًا! أين نكمل؟' : phase === 'ongoing' ? 'أكيد، أنا معك. ماذا تريد أن نراجع؟' : 'مرحبًا! ماذا تبحث عنه؟';
    if (replyLanguage(customer) === 'Spanish') return phase === 'resumed' ? '¡Hola de nuevo! ¿Por dónde seguimos?' : phase === 'ongoing' ? 'Claro, sigo aquí. ¿Qué quieres revisar?' : '¡Hola! ¿Qué estás buscando?';
    return phase === 'resumed' ? 'Hi again! Where shall we pick up?' : phase === 'ongoing' ? "Sure, I'm with you. What do you want to check?" : 'Hey! What are you looking for?';
  }
  if (replyLanguage(customer) === 'Arabic') {
    return `شكرًا لرسالتك. هل يمكنك مشاركة الكمية المستهدفة والمواصفات ومتطلبات التغليف الخاصة بـ ${customer.outboundProduct}؟`;
  }
  if (replyLanguage(customer) === 'Spanish') {
    return `Gracias por tu mensaje. ¿Puedes compartir la cantidad, las especificaciones y los requisitos de empaque de ${customer.outboundProduct}?`;
  }
  return `Thanks for your message. Could you share the target quantity, specifications, and packaging requirements for ${customer.outboundProduct}?`;
}

function fallbackCustomerReplyZh(customer: CustomerProfile): string {
  if (customer.needCall || customer.inboxReason === 'call') {
    return `您好，我们可以根据您要的${customer.product}安排销售跟进。请补充目标规格、包装要求和方便沟通的时间。`;
  }
  if (customer.stage === 'silent30' || customer.stage === 'silent60') {
    return `您好，之前您关注过${customer.product}，我们最近有新款和更适合批量采购的方案。如果您还在看这类产品，我可以发一份最新目录给您参考。`;
  }
  return `您好，感谢您的咨询。请补充${customer.product}的目标数量、规格和包装要求，方便我们准确跟进。`;
}

function chooseTemplateName(customer: CustomerProfile): string {
  if (customer.stage === 'silent30' || customer.stage === 'silent60') return 'product_update';
  if (customer.stage === 'won' || customer.stage === 'quoted') return 'order_followup';
  return 'greeting_opener';
}

function templateVariables(customer: CustomerProfile, draft: string): string[] {
  const firstName = customer.name.split(/\s+/)[0] || customer.name;
  if (chooseTemplateName(customer) === 'order_followup') {
    return [firstName, customer.product, draft.slice(0, 80) || 'next steps'];
  }
  if (chooseTemplateName(customer) === 'product_update') {
    return [firstName, customer.product, draft.slice(0, 80) || 'latest catalog'];
  }
  return [firstName, 'LingShu seller', customer.product];
}

function renderTemplateBody(template: MessageTemplate, variables: string[]): string {
  return template.body.replace(/\{\{(\d+)}}/g, (_, index) => variables[Number(index) - 1] || '');
}

function buildTemplatePlan(customer: CustomerProfile, templates: MessageTemplate[], draft: string): TemplatePlan | null {
  const template = templates.find(item => item.name === chooseTemplateName(customer)) || templates[0];
  if (!template) return null;
  const variables = templateVariables(customer, draft);
  return { template, variables, rendered: renderTemplateBody(template, variables) };
}

function translateChineseReplyForCustomer(customer: CustomerProfile, text: string): string {
  const body = text.trim();
  if (!isPredominantlyChineseText(body)) return body;

  const product = customer.outboundProduct;
  const language = customerConversationLanguage(customer);
  const wantsCall = body.includes('通话') || body.includes('电话');
  const isWakeup = body.includes('最新目录') || body.includes('新款');

  if (language === 'Arabic') {
    if (wantsCall) return `شكرًا لرسالتك. بخصوص ${product}، يمكن لمديرنا شرح الخيارات والسعر ومدة التسليم في مكالمة قصيرة. ما الوقت المناسب لك اليوم؟`;
    if (isWakeup) return `مرحبًا، لدينا خيارات جديدة من ${product}. إذا كنت لا تزال مهتمًا، يمكنني إرسال الكتالوج الأحدث لك.`;
    return `شكرًا لرسالتك. هل يمكنك مشاركة الكمية المستهدفة والمواصفات ومتطلبات التغليف الخاصة بـ ${product}؟`;
  }
  if (language === 'Spanish') {
    if (wantsCall) return `Gracias por tu mensaje. Para ${product}, nuestro gerente puede explicarte las opciones, el precio y el plazo de entrega en una llamada breve. ¿Qué horario te conviene hoy?`;
    if (isWakeup) return `Hola, tenemos nuevas opciones de ${product}. Si todavía te interesa, puedo enviarte el catálogo actualizado.`;
    return `Gracias por tu mensaje. ¿Puedes compartir la cantidad, las especificaciones y los requisitos de empaque de ${product}?`;
  }
  if (wantsCall) return `Thanks for your message. For ${product}, our manager can explain the options, price, and delivery time in a short call. What time works for you today?`;
  if (isWakeup) return `Hi, we have new options for ${product}. If you are still interested, I can send you the latest catalog for review.`;
  return `Thanks for your message. Could you share the target quantity, specifications, and packaging requirements for ${product}?`;
}

async function translateReplyToCustomerLanguage(customer: CustomerProfile, text: string): Promise<string> {
  const body = text.trim();
  if (!body || !isPredominantlyChineseText(body)) return body;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch('/api/overseas/plugins/translate/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ text: body, source: '简体中文', target: replyLanguage(customer) }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const translated = response.ok && typeof data?.translatedText === 'string' ? data.translatedText.trim() : '';
    if (translated && translated !== body) return translated;
  } catch {
    // Keep the composer usable in local preview when the translation provider is unavailable.
  } finally {
    window.clearTimeout(timeout);
  }
  return translateChineseReplyForCustomer(customer, body);
}

function latestBuyerText(customer: CustomerProfile): string {
  return [...customer.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer')?.body || '';
}

function isWaitingForHumanQuote(customer: CustomerProfile): boolean {
  const latest = latestBuyerText(customer);
  return customer.handlingReason.includes('等待人工报价')
    || /\b(price|quote|quotation|discount|unit cost|how much)\b|报价|价格|单价|多少钱|折扣|优惠/i.test(latest);
}

interface StyleMemoryPayload {
  triggerMessage: string;
  draftOriginal: string;
  finalSent: string;
  edited: boolean;
  category: string;
  strategyIds: string[];
  nodeId: string;
  riskLevel: 'L2' | 'L3' | 'L4';
  diffTags: string[];
  interventionType: 'expression_edit' | 'progression_edit' | 'fact_review' | 'risk_handoff' | 'direct_adoption';
  outcome3Turn: string;
  outcome24h: string;
  finalOutcome: string;
}

async function requestDraft(
  customer: CustomerProfile,
  instruction?: string,
  mode?: 'draft' | 'polish',
  intent: DraftIntent = mode === 'polish' ? 'polish' : 'reply',
  manualRequest = false,
): Promise<DraftResult> {
  try {
    const resp = await fetch('/api/overseas/agents/conversion/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        customerId: customer.id,
        timeline: customer.timeline.slice(-20),
        product: customer.outboundProduct,
        internalProduct: customer.product,
        language: customer.language,
        stage: STAGE_LABEL[customer.stage],
        bant: customer.bant,
        progressionGoal: customer.progressionGoal,
        spinGuidance: customer.spinGuidance,
        fallbackCount: customer.fallbackCount ?? 0,
        instruction,
        mode,
        intent,
        manualRequest,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      if (data?.handoffRequired) {
        const bridgeDraft = typeof data?.draft === 'string' ? data.draft.trim() : '';
        const chineseBridgeDraft = typeof data?.translatedDraft === 'string' && data.translatedDraft.trim()
          ? data.translatedDraft.trim()
          : isPredominantlyChineseText(bridgeDraft) ? bridgeDraft : fallbackCustomerReplyZh(customer);
        return {
          draft: bridgeDraft ? chineseBridgeDraft : '',
          originalDraft: bridgeDraft,
          translatedDraft: chineseBridgeDraft || undefined,
          handoffRequired: true,
          fallbackCount: Number(data.fallbackCount || customer.fallbackCount || 0),
          safeToSendBeforeHandoff: Boolean(data.safeToSendBeforeHandoff),
          handlingReason: typeof data.handlingReason === 'string' ? data.handlingReason : '客户正在询价，需要人工报价',
          replyConfidence: data.replyConfidence && typeof data.replyConfidence === 'object'
            ? {
                level: String(data.replyConfidence.level || 'human_required'),
                score: Number(data.replyConfidence.score || 0),
                reason: String(data.replyConfidence.reason || ''),
              }
            : undefined,
          knowledgeMiss: Boolean(data.knowledgeMiss),
          missReason: typeof data.missReason === 'string' ? data.missReason : '',
          evidence: Array.isArray(data.evidence) ? data.evidence.map(String) : [],
          category: typeof data.category === 'string' ? data.category : '报价',
          buyerMessage: latestBuyerText(customer),
        };
      }
      if (typeof data?.draft === 'string' && data.draft.trim()) {
        const originalDraft = data.draft.trim();
        const draft = typeof data?.translatedDraft === 'string' && data.translatedDraft.trim()
          ? data.translatedDraft.trim()
          : isPredominantlyChineseText(originalDraft) ? originalDraft : fallbackCustomerReplyZh(customer);
        return {
          draft,
          originalDraft,
          translatedDraft: draft,
          fallbackCount: Number(data.fallbackCount || customer.fallbackCount || 0),
          knowledgeMiss: Boolean(data.knowledgeMiss),
          missReason: typeof data.missReason === 'string' ? data.missReason : '',
          evidence: Array.isArray(data.evidence) ? data.evidence.map(String) : [],
          buyerMessage: latestBuyerText(customer),
          category: typeof data.category === 'string' ? data.category : intent,
          strategies: Array.isArray(data.strategies)
            ? data.strategies.map((item: any) => ({
                id: String(item?.id || ''),
                scenario: String(item?.scenario || ''),
                confidence: Number(item?.confidence || 0),
                reason: String(item?.reason || ''),
              })).filter((item: { id: string }) => item.id)
            : [],
        };
      }
    }
    if (resp.status === 409 && data?.error === 'customer_service_disabled') {
      return {
        draft: '',
        originalDraft: '',
        handlingReason: typeof data.message === 'string' ? data.message : '智能客服尚未开启',
        category: '智能客服未开启',
      };
    }
  } catch {
    // Use local fallback when the API is unavailable in local preview.
  }
  const originalDraft = fallbackCustomerReply(customer);
  const draft = fallbackCustomerReplyZh(customer);
  return { draft, originalDraft, translatedDraft: draft, buyerMessage: latestBuyerText(customer), category: intent };
}

function fallbackHandoffSummary(customer: CustomerProfile): string {
  return [
    `客户想要：${customer.summary}`,
    `当前进展：${customer.nextStep}`,
    `需要人工原因：${customer.handlingReason}`,
  ].join('\n');
}

async function requestHandoffSummary(customer: CustomerProfile): Promise<string> {
  try {
    const resp = await fetch('/api/overseas/agents/conversion/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        customerId: customer.id,
        timeline: customer.timeline.slice(-20),
        product: customer.outboundProduct,
        internalProduct: customer.product,
        language: customer.language,
        stage: STAGE_LABEL[customer.stage],
        handlingReason: customer.handlingReason,
        customerSummary: customer.summary,
        nextStep: customer.nextStep,
        intent: 'handoff_summary',
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data?.draft === 'string' && data.draft.trim()) return data.draft.trim();
    }
  } catch {
    // Local fallback keeps the handoff context available.
  }
  return fallbackHandoffSummary(customer);
}

function FilterSelect({ label, value, onChange, options, renderLabel }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  renderLabel?: (item: string) => string;
}) {
  return <label className="block">
    <span className="text-[10px] font-bold text-text-muted">{label}</span>
    <Select aria-label={label} value={value} onChange={onChange} className="mt-1 w-full" options={[{ value: 'all', label: '全部' }, ...options.map(value => ({ value, label: renderLabel ? renderLabel(value) : value }))]}/>
  </label>;
}

function CompactCustomerList({
  view,
  selectedId,
  customers,
  showSimulationBadge,
  onOpen,
  onViewChange,
  onVisibleSelectionChange,
}: {
  view: CustomerView;
  selectedId: string | null;
  customers: CustomerProfile[];
  showSimulationBadge: boolean;
  onOpen: (id: string) => void;
  onViewChange: (view: CustomerView) => void;
  onVisibleSelectionChange: (id: string | null, filteredEmpty: boolean) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CustomerListFilters>(EMPTY_CUSTOMER_FILTERS);
  const baseList = filterCustomers(view, customers).filter((customer, index, list) => list.findIndex(item => item.id === customer.id) === index);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const list = applyCustomerListFilters(baseList, filters).filter(customer => !normalizedQuery || [
    customer.name,
    customer.summary,
    customer.product,
    customer.outboundProduct,
    customer.countryName,
    customer.timeline.at(-1)?.body,
  ].some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery)));
  const activeFilterCount = [
    filters.source !== 'all',
    filters.country !== 'all',
    filters.language !== 'all',
    filters.stage !== 'all',
    filters.handling !== 'all',
    filters.tag !== 'all',
    filters.unreadOnly,
    filters.highIntentOnly,
  ].filter(Boolean).length;
  const setFilterValue = (key: CustomerFilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const optionList = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const sourceOptions = optionList(customers.map(customer => customer.source));
  const countryOptions = optionList(customers.map(customer => customer.countryName));
  const languageOptions = optionList(customers.map(customer => customer.language));
  const tagOptions = optionList(customers.flatMap(customer => customer.tags));

  useEffect(() => {
    if (selectedId && list.some(customer => customer.id === selectedId)) return;
    onVisibleSelectionChange(list[0]?.id ?? null, activeFilterCount > 0 && list.length === 0);
  }, [activeFilterCount, list, onVisibleSelectionChange, selectedId]);
  const renderCustomer = (customer: CustomerProfile) => {
    const lastMessage = customer.timeline[customer.timeline.length - 1];
    const statusColor = HANDLING_COLOR[customer.handlingMode];
    const hasUnread = Boolean(customer.hasUnread);
    return (
      <button
        key={customer.id}
        type="button"
        data-layout-check="customer-row"
        onClick={() => onOpen(customer.id)}
        aria-current={customer.id === selectedId ? 'true' : undefined}
        className={`ls-customer-list-row ${customer.id === selectedId ? 'is-selected' : ''}`}
      >
        <div className="flex items-start gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-text-secondary">
            <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white transition-opacity" style={{ backgroundColor: hasUnread ? '#dc2626' : statusColor, opacity: hasUnread ? 1 : 0 }} />
            {customer.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13px] font-semibold leading-5 text-text-primary" title={customer.name}>{customer.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`border-l-2 px-1.5 py-0.5 text-[9px] font-bold ${customer.isMock ? 'border-amber bg-amber-dim text-amber' : 'border-accent bg-accent-glow text-accent'}`}>
                    {customer.isMock ? '模拟客户' : '真实客户'}
                  </span>
                  {customer.simulation?.warning && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">大单预警</span>}
                  <SourceIcon source={customer.source} size={11} />
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-text-muted">{lastMessage?.time || customer.lastActive}</span>
            </div>
            <p className="mt-1 line-clamp-2 break-words text-xs leading-[18px] text-text-muted" title={lastMessage?.body || customer.summary}>{lastMessage?.body || customer.summary}</p>
          </div>
        </div>
      </button>
    );
  };
  return <aside data-testid="conversation-list" className="flex h-full w-full shrink-0 flex-col bg-white lg:w-52 xl:w-56 2xl:w-60">
    <div className="border-b border-border px-3 pt-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-primary">聊天</h2>
        <span className="text-xs text-text-muted">{list.length}</span>
      </div>
      <Input allowClear value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={15}/>} placeholder="搜索客户或消息" aria-label="搜索客户或消息" />
      <div className="mt-2 flex items-center justify-between gap-2"><p className="truncate text-xs text-text-secondary">最近动态 {showSimulationBadge && <Tag title="客服演示沙盘">演示</Tag>}</p>
        <Popover trigger="click" placement="bottomLeft" open={filterOpen} onOpenChange={setFilterOpen} title="筛选客户" content={<div className="w-72 max-w-[calc(100vw-48px)]">
          <p className="mb-3 text-xs text-text-secondary">当前命中 {list.length}/{baseList.length}</p>
          <div className="grid grid-cols-2 gap-3">
            <FilterSelect label="来源渠道" value={filters.source} onChange={value => setFilterValue('source', value)} options={sourceOptions} renderLabel={sourceLabel}/>
            <FilterSelect label="国家/地区" value={filters.country} onChange={value => setFilterValue('country', value)} options={countryOptions}/>
            <FilterSelect label="语言" value={filters.language} onChange={value => setFilterValue('language', value)} options={languageOptions}/>
            <FilterSelect label="客户阶段" value={filters.stage} onChange={value => setFilterValue('stage', value)} options={Object.keys(STAGE_LABEL)} renderLabel={item => STAGE_LABEL[item as CustomerStage] || item}/>
            <FilterSelect label="处理方式" value={filters.handling} onChange={value => setFilterValue('handling', value)} options={['human_needed', 'ai_draft', 'ai_auto']} renderLabel={item => item === 'human_needed' ? '需要你处理' : item === 'ai_draft' ? '等你确认' : 'AI 接待中'}/>
            <FilterSelect label="客户标签" value={filters.tag} onChange={value => setFilterValue('tag', value)} options={tagOptions}/>
          </div>
          <div className="my-4 flex flex-wrap gap-3"><Checkbox checked={filters.unreadOnly} onChange={event => setFilters(current => ({ ...current, unreadOnly: event.target.checked }))}>只看未读</Checkbox><Checkbox checked={filters.highIntentOnly} onChange={event => setFilters(current => ({ ...current, highIntentOnly: event.target.checked }))}>高意向 80+</Checkbox></div>
          <div className="flex justify-between"><Button type="text" onClick={() => setFilters(EMPTY_CUSTOMER_FILTERS)}>清空筛选</Button><Button type="primary" onClick={() => setFilterOpen(false)}>完成</Button></div>
        </div>}><Button aria-label={activeFilterCount ? `已启用 ${activeFilterCount} 项筛选` : '筛选客户'} icon={<Filter size={15}/>}>{activeFilterCount || null}</Button></Popover>
      </div>
      <Tabs className="ls-customer-view-tabs" aria-label="客户视图" size="small" activeKey={view} onChange={key => onViewChange(key as CustomerView)} items={(Object.entries(VIEW_META) as [CustomerView, typeof VIEW_META[CustomerView]][]).map(([key, item]) => ({ key, label: item.label }))}/>
    </div>
    <div className="ls-customer-list-scroll min-h-0 flex-1 overflow-y-auto">{list.map(renderCustomer)}{!list.length && <div className="px-4 py-10"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合当前条件的客户"/>{activeFilterCount > 0 && <Button block onClick={() => setFilters(EMPTY_CUSTOMER_FILTERS)}>清空筛选</Button>}</div>}</div>
  </aside>;
}

function DraftSuggestionBar({
  customer,
  draft,
  isTemplate,
  templatePlan,
  priceRulesReady,
  knowledgeMiss,
  bridgeOnly,
  onSend,
  onSave,
  savingDraft,
  channelReady,
  onEdit,
  onChangeDraft,
  onDismiss,
  onRegenerate,
}: {
  customer: CustomerProfile;
  draft: string;
  isTemplate: boolean;
  templatePlan: TemplatePlan | null;
  priceRulesReady: boolean;
  knowledgeMiss?: boolean;
  bridgeOnly?: boolean;
  onSend: () => void;
  onSave: () => void;
  savingDraft: boolean;
  channelReady?: boolean;
  onEdit: () => void;
  onChangeDraft: (value: string) => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}) {
  const templateApproved = !isTemplate || templatePlan?.template.status === 'approved';
  const draftMessages = draft.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean).slice(0, 3);
  const updateMessage = (index: number, value: string) => {
    const next = [...draftMessages];
    next[index] = value;
    onChangeDraft(next.filter(Boolean).join('\n\n'));
  };
  const deleteMessage = (index: number) => {
    onChangeDraft(draftMessages.filter((_, itemIndex) => itemIndex !== index).join('\n\n'));
  };
  return (
    <div data-draft-suggestion className="relative ml-auto max-w-[90%] rounded-lg rounded-tr-sm border border-dashed border-accent/35 bg-accent-glow px-4 py-3 sm:max-w-[74%]">
      <Button htmlType="button" onClick={onDismiss} aria-label="关闭 AI 建议" className="!h-auto min-h-9 !whitespace-normal absolute right-2 top-2 rounded-full p-1 text-text-muted hover:bg-white/70">
        <X size={12} />
      </Button>
      <div className="pr-6">
        <div className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-accent">
          <Bot size={14} />
          {bridgeOnly ? 'AI 承接回复' : 'AI 建议回复'}
          {isTemplate && (
            <span className={`border-l-2 px-1.5 py-0.5 text-[10px] font-bold ${templateApproved ? 'border-accent bg-surface text-accent' : 'border-amber bg-amber-dim text-amber'}`}>
              {templateApproved ? '\u6a21\u677f\u53ef\u53d1' : '\u6a21\u677f\u5ba1\u6838\u4e2d'}
            </span>
          )}
          {knowledgeMiss && (
            <span className="border-l-2 border-amber bg-amber-dim px-1.5 py-0.5 text-[10px] font-bold text-amber">{bridgeOnly ? '已转人工确认' : '知识库未覆盖'}</span>
          )}
          <Button htmlType="button" onClick={onRegenerate} className="!h-auto min-h-9 !whitespace-normal ml-1 rounded-md p-1 text-accent hover:bg-surface" title="换一版">
            <RefreshCw size={12} />
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          {draftMessages.map((message, index) => (
            <div key={`${index}-${message.slice(0, 12)}`} className="group relative rounded-md rounded-tr-sm border border-accent/20 bg-surface px-3 py-2 pr-8">
              <Input.TextArea
                value={message}
                rows={Math.min(4, Math.max(1, message.split(/\n/).length))}
                onChange={event => updateMessage(index, event.target.value)}
                aria-label={`编辑第 ${index + 1} 条短消息`}
                className="w-full resize-none bg-transparent text-sm leading-relaxed text-text-primary outline-none"
              />
              <Button htmlType="button" onClick={() => deleteMessage(index)} aria-label={`删除第 ${index + 1} 条短消息`} className="!h-auto min-h-9 !whitespace-normal absolute right-2 top-2 rounded-full p-1 text-text-muted opacity-70 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100">
                <X size={11} />
              </Button>
            </div>
          ))}
          <p className="text-[10px] font-semibold text-text-muted">将按顺序发送，共 {draftMessages.length}/3 条；每条都可直接修改或删除。</p>
        </div>
        {isTemplate && templatePlan && (
          <div className="mt-2 border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs leading-relaxed text-amber">
            <p className="font-semibold">{'AI \u5df2\u9009\u62e9\u6a21\u677f\uff1a'}{templatePlan.template.label}</p>
            <p className="mt-1">{'\u53d8\u91cf\uff1a'}{templatePlan.variables.map((item, index) => `{{${index + 1}}}=${item}`).join(' / ')}</p>
            <p className="mt-1 whitespace-pre-line">{'\u6700\u7ec8\u53d1\u9001\u6548\u679c\uff1a'}{templatePlan.rendered}</p>
          </div>
        )}
        {!priceRulesReady && (
          <Button
            htmlType="button"
            onClick={() => { localStorage.setItem('lingshu:enterprise:highlight-biz-rules', 'true'); window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }}
            className="!h-auto min-h-9 !whitespace-normal !justify-start mt-2 rounded-md border border-accent/20 bg-surface px-3 py-2 text-left text-xs font-bold text-accent hover:bg-surface-2"
          >
            完善报价规则后，AI 才能帮你答价格 → 去完善
          </Button>
        )}
        <div className="mt-3 flex justify-end gap-1.5">
          <Button htmlType="button" onClick={onSave} disabled={savingDraft || !draft.trim()} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">{savingDraft ? '保存中…' : '保存修改'}</Button>
          <Button type="primary" htmlType="button" onClick={onSend} disabled={!templateApproved || !channelReady} className="!h-auto min-h-9 !whitespace-normal rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-white hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-amber-dim disabled:text-amber">
            {!templateApproved ? '\u6d88\u606f\u6a21\u677f\u5ba1\u6838\u4e2d' : isTemplate ? '\u53d1\u9001\u6a21\u677f' : '\u76f4\u63a5\u53d1\u9001'}
          </Button>
          <Button htmlType="button" onClick={onEdit} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-text-secondary">{'\u4fee\u6539'}</Button>
        </div>
      </div>
    </div>
  );
}

function chineseMessageTranslation(body: string, customer: CustomerProfile): string | null {
  if (/[\u4e00-\u9fff]/.test(body)) return null;
  const normalized = body.replace(/\s+/g, ' ').trim().toLowerCase();

  const exact: Record<string, string> = {
    'hi, i need 500 pcs custom hair wigs. please share moq, best price, and delivery time.': '你好，我需要 500 件定制假发。请提供起订量、最优价格和交期。',
    'i can ask our manager to walk you through the options by a short call. what time works for you?': '我可以安排经理通过一次简短通话为您说明方案。您什么时间方便？',
    'need 1000 gift boxes with custom logo. what is the best price?': '需要 1000 套定制 LOGO 礼盒，最优惠价格是多少？',
    'we can support custom logo gift boxes. i will confirm the best price and packaging options for you.': '我们可以支持定制 LOGO 礼盒。我会为您确认最优价格和包装方案。',
    'me interesa el parche de moxibustion, 200 piezas. cual es el precio unitario?': '我对艾灸贴感兴趣，200 件。单价是多少？',
    'curated selection sounds great. standard shipping is fine.': '这个精选组合听起来不错，标准运输就可以。',
    'hi, interested in wholesale hair accessories. what collections do you have?': '你好，我对发饰批发感兴趣。你们有哪些系列？',
    'thanks for reaching out. i sent our hair accessories catalog and 50 pcs mixed wholesale pack for your review.': '感谢联系。我已发送发饰目录和 50 件混批批发包，供您查看。',
  };

  if (exact[normalized]) return exact[normalized];
  if (normalized.includes('thanks for your message') && normalized.includes('moq')) {
    return `感谢您的消息。我会确认${customer.product}的 MOQ、最优价格和交期，然后尽快把详情发给您。`;
  }
  if (normalized.includes('best price') && normalized.includes('delivery time')) {
    return `我会为您确认${customer.product}的最优价格和交期。`;
  }
  return null;
}

function ChatThread({
  customer,
  draftSuggestion,
  input,
  translatedInput,
  onInputChange,
  onDraftChange,
  onTranslatedInputChange: _onTranslatedInputChange,
  onSend,
  onSaveDraft,
  savingDraft,
  onEditDraft,
  onSendDraft,
  onDismissDraft,
  onRegenerateDraft,
  onSceneDraft,
  onPreviewTranslate,
  templates,
  onManualActive,
  priceRulesReady,
  knowledgeMiss,
  bridgeOnly,
  draftMeta,
  onToast,
  onMockBuyerMessage,
  sending,
  channelReady,
}: {
  customer: CustomerProfile | null;
  draftSuggestion: string | null;
  input: string;
  translatedInput: string;
  onInputChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onTranslatedInputChange: (value: string) => void;
  onSend: () => void;
  onSaveDraft: (value: string) => void;
  savingDraft: boolean;
  onEditDraft: () => void;
  onSendDraft: () => void;
  onDismissDraft: () => void;
  onRegenerateDraft: () => void;
  onSceneDraft: (intent: DraftIntent) => void;
  onPreviewTranslate: () => Promise<void>;
  templates: MessageTemplate[];
  onManualActive: () => void;
  priceRulesReady: boolean;
  knowledgeMiss?: boolean;
  bridgeOnly?: boolean;
  draftMeta: SalesDecisionMeta | null;
  onToast: (text: string) => void;
  onMockBuyerMessage: (text: string) => void;
  sending?: boolean;
  channelReady?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mockInput, setMockInput] = useState('');
  const composerState = draftSuggestion ? 'draft' : input.trim() ? 'typing' : 'idle';
  const isOutsideWindow = customer ? timelineEventAgeHours(lastBuyerEvent(customer)) > 24 : false;
  const templatePlan = null;
  const chips = customer && composerState === 'idle' ? sceneChips(customer) : [];
  const conversationPeople = customer ? [
    { id: customer.id, name: customer.name, color: '#E8C7EC' },
    { id: 'lingshu-customer-agent', name: '客服 Agent', icon: <Bot size={15}/>, color: '#EAF6F2' },
  ] : [];

  const refreshTranslationPreview = useCallback(async () => {
    if (!input.trim()) return;
    setTranslationLoading(true);
    try {
      await onPreviewTranslate();
    } finally {
      setTranslationLoading(false);
    }
  }, [input, onPreviewTranslate]);

  const insertEmoji = (emoji: string) => {
    const start = inputRef.current?.selectionStart ?? input.length;
    const end = inputRef.current?.selectionEnd ?? input.length;
    const next = `${input.slice(0, start)}${emoji}${input.slice(end)}`;
    const nextCaret = start + emoji.length;
    onManualActive();
    onInputChange(next);
    setEmojiOpen(false);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  };

  useEffect(() => {
    if (!previewOpen || !input.trim()) return;
    const timer = window.setTimeout(() => void refreshTranslationPreview(), 500);
    return () => window.clearTimeout(timer);
  }, [previewOpen, input, refreshTranslationPreview]);

  useEffect(() => {
    if (!draftSuggestion) return;
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-draft-suggestion]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [customer?.id, Boolean(draftSuggestion)]);

  if (!customer) {
    return (
      <section data-testid="conversation-chat-thread" className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-surface">
        <div className="text-center">
          <MessageSquare size={26} className="mx-auto text-text-muted" />
          <p className="mt-3 text-sm font-semibold text-text-primary">{'\u9009\u62e9\u5de6\u4fa7\u4e00\u4e2a\u5ba2\u6237\u5f00\u59cb'}</p>
          <p className="mt-1 text-xs text-text-muted">{'\u67e5\u770b\u5bf9\u8bdd\u3001\u7f16\u8f91 AI \u8349\u7a3f\u5e76\u53d1\u9001\u56de\u590d'}</p>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="conversation-chat-thread" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar size={40} style={{ background: '#E8C7EC', color: '#6F3E7A' }}>{customer.avatar || customer.name.slice(0, 1)}</Avatar>
          <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-base font-semibold text-text-primary">{customer.name}</p>
            <span className={`shrink-0 border-l-2 px-2 py-0.5 text-[10px] font-bold ${customer.isMock ? 'border-amber bg-amber-dim text-amber' : channelReady ? 'border-accent bg-accent-glow text-accent' : 'border-amber bg-amber-dim text-amber'}`}>
              {customer.isMock ? '模拟客户 · 不对外发送' : channelReady ? '真实客户 · 通道已连接' : '真实客户 · 通道未连接'}
            </span>
            {customer.simulation?.checkpoint && (
              <span className="max-w-52 truncate border-l-2 border-accent bg-accent-glow px-2 py-0.5 text-[10px] font-bold text-accent" title={customer.simulation.checkpoint}>
                {customer.simulation.checkpoint}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>{STAGE_LABEL[customer.stage]}</span>
            <span>·</span>
            <SourceIcon source={customer.source} size={12} />
            <span>·</span>
            <span>{customer.lastActive}</span>
          </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 xl:flex">
            <LsAvatarGroup people={conversationPeople} max={3} size={30}/>
            <span className="border-l border-border pl-3 text-xs font-semibold text-text-secondary">当地时间 <LiveLocalTime timeZone={customer.timeZone} /></span>
          </div>
          <Tooltip title="客户与会话详情"><Button shape="circle" aria-label="客户与会话详情" icon={<Info size={16}/>} /></Tooltip>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ink px-3 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {customer.isMock && (
            <form onSubmit={event => { event.preventDefault(); const value = mockInput.trim(); if (!value) return; onMockBuyerMessage(value); setMockInput(''); }} className="rounded-lg border border-accent/20 bg-accent-glow p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-accent"><UserRound size={14} />模拟客户输入</div>
              <p className="mt-1 text-[11px] text-text-secondary">输入客户接下来会说的话，只在演示沙盘里推进，不会发送到真实平台。</p>
              <div className="mt-3 flex gap-2">
                <input value={mockInput} onChange={event => setMockInput(event.target.value)} placeholder={customer.simulation?.editable ? '例如：我们想改造一条装配线，怎么开始？' : '输入下一条客户消息…'} className="ui-field min-w-0 flex-1 !rounded-md px-3 py-2 text-sm" />
                <Button type="primary" htmlType="submit" disabled={!mockInput.trim()} className="!h-auto min-h-9 !whitespace-normal rounded-md bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent-dim disabled:opacity-40">模拟发送</Button>
              </div>
            </form>
          )}
          {customer.timeline.map(event => {
            if (event.type !== 'messenger' && event.type !== 'instagram' && event.type !== 'whatsapp') {
              return (
                <div key={event.id} className="flex justify-center">
                  <div className="max-w-[90%] rounded-md border border-border bg-surface px-3 py-2 text-center sm:max-w-[82%]">
                    <p className="text-[11px] font-semibold text-text-primary">{event.title}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{event.body}</p>
                    <p className="mt-1 text-[10px] text-text-muted">{event.time}</p>
                  </div>
                </div>
              );
            }
            const isBuyer = event.actor === 'buyer';
            const isAi = event.actor === 'ai';
            // Only show a translation that belongs to this exact message. A generic
            // fallback looks helpful but can silently tell the seller something the
            // buyer or AI never said.
            const translation = event.translatedBody || chineseMessageTranslation(event.body, customer) || null;
            return (
              <div key={event.id} className={`flex ${isBuyer ? 'justify-start' : 'justify-end'}`}>
                <div className={`ls-messenger-bubble relative ${isBuyer ? 'ls-messenger-bubble--inbound' : 'ls-messenger-bubble--outbound'}`}>
                  {isAi && <span className="absolute -top-2 right-3 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[9px] font-bold text-accent">AI</span>}
                  <div className="flex items-center justify-between gap-4">
                    <p className={`text-xs font-bold ${isBuyer ? 'text-text-primary' : 'text-white'}`}>{event.title}</p>
                    <span className={`text-[10px] ${isBuyer ? 'text-text-muted' : 'text-white/75'}`}>{event.time}</span>
                  </div>
                  <p className={`mt-1 whitespace-pre-line text-sm leading-relaxed ${isBuyer ? 'text-text-secondary' : 'text-white'}`}>{event.body}</p>
                  {!isBuyer && (event.audit?.editedByHuman || event.audit?.memoryApplied?.length) && (
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {event.audit.editedByHuman && (
                        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white/90" title={event.audit.originalDraft ? `AI 初稿：${event.audit.originalDraft}` : undefined}>AI 草稿 · 人工改过</span>
                      )}
                      {event.audit.memoryApplied?.length ? (
                        <span className="rounded-full bg-emerald-100/25 px-2 py-0.5 text-[10px] font-bold text-white/90" title={event.audit.memoryApplied.join('；')}>已用学习记忆</span>
                      ) : null}
                    </div>
                  )}
                  {translation && (
                    <div className={`mt-2 border-t pt-2 text-xs leading-relaxed ${isBuyer ? 'border-border text-text-muted' : 'border-white/20 text-white/80'}`}>
                      <span className="font-bold">{'\u4e2d\u6587\u7ffb\u8bd1\uff1a'}</span>{translation}
                    </div>
                  )}
                  {event.autoSent && <div className="mt-2 flex justify-end"><span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white/85">{'AI \u81ea\u52a8\u56de\u590d'}</span></div>}
                  {!isBuyer && event.sendStatus && (
                    <div className="mt-2 flex justify-end">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${event.sendStatus === 'failed' ? 'bg-red-100 text-red-700' : 'bg-white/15 text-white/85'}`}>
                        {event.sendStatus === 'queued' ? '发送中' : event.sendStatus === 'sent' ? '已发送' : event.sendStatus === 'delivered' ? '已送达' : event.sendStatus === 'failed' ? '发送失败' : '草稿'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {draftSuggestion && (
            <>
              <SalesDecisionEvidence meta={draftMeta} />
              <DraftSuggestionBar customer={customer} draft={draftSuggestion} isTemplate={false} templatePlan={templatePlan} priceRulesReady={priceRulesReady} knowledgeMiss={knowledgeMiss} bridgeOnly={bridgeOnly} onSend={onSendDraft} onSave={() => onSaveDraft(draftSuggestion)} savingDraft={savingDraft} channelReady={channelReady && !isOutsideWindow} onEdit={onEditDraft} onChangeDraft={onDraftChange} onDismiss={onDismissDraft} onRegenerate={onRegenerateDraft} />
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border bg-surface p-3">
        <div className="mx-auto max-w-3xl space-y-2">
          {isOutsideWindow && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">距客户上次互动已超过 24 小时，当前不能直接发送普通 {customer.source === 'instagram' ? 'Instagram' : 'Messenger'} 消息。</div>}
          {composerState === 'idle' && chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(chip => <Button key={chip.intent} htmlType="button" onClick={() => onSceneDraft(chip.intent)} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-accent/30 hover:bg-accent-glow hover:text-accent"><Sparkles size={13} /> {chip.label}</Button>)}
            </div>
          )}
          <div data-testid="conversation-composer" className="relative rounded-lg border border-border bg-surface-2 px-3 py-2.5 focus-within:border-accent">
            {previewOpen && (
              <div className="mb-3 rounded-lg border border-border bg-white px-3 py-2 text-xs leading-relaxed text-text-secondary">
                <span className="font-semibold text-text-primary">目标语言译文（{customer.language}）：</span>
                {translationLoading ? '翻译中…' : translatedInput || '请输入中文内容后查看译文'}
              </div>
            )}
            <Input.TextArea ref={node => { inputRef.current = node?.resizableTextArea?.textArea || null; }} data-customer-reply-input aria-label="客户回复" rows={2} value={input} onFocus={onManualActive} onChange={event => { onManualActive(); onInputChange(event.target.value); }} placeholder="输入中文回复…" variant="borderless" className="max-h-24 w-full resize-none" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="relative flex items-center gap-1.5">
                <Popover trigger="click" placement="topLeft" open={emojiOpen} onOpenChange={setEmojiOpen} title="选择表情" content={emojiOpen ? <Suspense fallback={<div className="flex h-[360px] w-80 items-center justify-center text-xs text-text-secondary">正在加载表情…</div>}>
                  <EmojiPicker width={320} height={360} lazyLoadEmojis searchPlaceHolder="搜索表情" previewConfig={{ showPreview: false }} onEmojiClick={(emojiData: EmojiClickData) => insertEmoji(emojiData.emoji)}/>
                </Suspense> : null}><Button aria-expanded={emojiOpen} aria-label="添加表情" icon={<Smile size={15}/>}/></Popover>
                <Button
                  htmlType="button"
                  onClick={() => {
                    const shouldOpen = !previewOpen;
                    setPreviewOpen(shouldOpen);
                    if (shouldOpen) void refreshTranslationPreview();
                  }}
                  disabled={!input.trim()}
                  aria-label={previewOpen ? '隐藏目标语言译文' : '显示目标语言译文'}
                  className="!h-auto min-h-9 !whitespace-normal flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-text-muted hover:bg-white hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  title={previewOpen ? '隐藏目标语言译文' : '显示目标语言译文'}
                >
                  <Languages size={15} />
                  {previewOpen ? '隐藏译文' : '显示译文'}
                </Button>
              </div>
               <LsCompactFieldGroup className="!w-auto shrink-0">
                 <Button htmlType="button" onClick={() => onSaveDraft(input)} disabled={savingDraft || !input.trim()} className="!h-auto min-h-9 !whitespace-normal px-2 py-2 text-xs font-bold disabled:opacity-40">{savingDraft ? '保存中…' : '保存草稿'}</Button>
                 <LsBrandAction htmlType="button" onClick={onSend} loading={sending} disabled={sending || !channelReady || !input.trim() || isOutsideWindow} className="!h-auto min-h-9 !whitespace-normal flex items-center gap-1.5 px-4 py-2 text-xs"><Send size={13} /> {!channelReady ? '通道未连接' : isOutsideWindow ? '已超出回复时间' : '发送'}</LsBrandAction>
               </LsCompactFieldGroup>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function suggestionDismissKey(customerId: string, suggestionType: string) {
  return `lingshu:crm:dismissed:${customerId}:${suggestionType}`;
}

function isSuggestionDismissed(customerId: string, suggestionType: string) {
  const until = Number(localStorage.getItem(suggestionDismissKey(customerId, suggestionType)) || 0);
  return Date.now() < until;
}

function intentLevelLabel(customer: CustomerProfile) {
  if (customer.bant?.band === 'black') return '信息待核实';
  if (customer.bant?.level === 'hot' || customer.intentScore >= 90) return '高价值商机';
  if (customer.bant?.level === 'qualified' || customer.intentScore >= 75) return '值得重点跟进';
  return '继续了解需求';
}

function CustomerIntentActionPanel({
  customer,
  onModeChange,
  onToast,
  onGenerateDraft,
  onFocusReply,
  onViewDraft,
  onCompleteTodo,
  customerServiceEnabled,
  autoReplyReady,
  hasReplyReady,
}: {
  customer: CustomerProfile;
  onModeChange: (mode: HandlingMode) => void;
  onToast: (message: string) => void;
  onGenerateDraft: (instruction: string, intent?: DraftIntent) => Promise<void> | void;
  onFocusReply: () => void;
  onViewDraft: () => void;
  onCompleteTodo: () => void;
  customerServiceEnabled: boolean;
  autoReplyReady: boolean;
  hasReplyReady: boolean;
}) {
  const agentProduction = useAgentProductionAction('customer');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [dismissTick, setDismissTick] = useState(0);
  const [handoffSummary, setHandoffSummary] = useState('');
  const [isPrimaryLoading, setIsPrimaryLoading] = useState(false);
  const rawSuggestion = buildPrioritySuggestion(customer);
  const actionableSuggestion: PrioritySuggestion = ['draft_review', 'blocked_auto'].includes(rawSuggestion.suggestionType) && !hasReplyReady
    ? { ...rawSuggestion, headline: '生成回复建议', reason: '已开启建议模式，点击后会根据客户最新消息生成草稿' }
    : rawSuggestion;
  const dismissed = actionableSuggestion.suggestionType !== 'none' && isSuggestionDismissed(customer.id, actionableSuggestion.suggestionType);
  const suggestion: PrioritySuggestion = dismissed
    ? {
      customerId: customer.id,
      suggestionType: 'none',
      headline: '今日任务已完成',
      reason: '已暂不处理，24 小时内不再提醒',
      evidence: ['已按你的选择静默 24 小时'],
      priorityScore: 0,
      tone: 'green',
    }
    : actionableSuggestion;
  const spinStageLabel = {
    situation: '了解现状',
    problem: '识别问题',
    implication: '确认影响',
    need_payoff: '推进决策',
  } as const;
  const communicationStage = customer.spinGuidance
    ? spinStageLabel[customer.spinGuidance.stage]
    : customer.progressionGoal?.label || STAGE_LABEL[customer.stage];
  const communicationSummary = customer.spinGuidance?.statement
    || customer.progressionGoal?.reason
    || customer.summary;
  const nextMove = customer.spinGuidance?.question
    || customer.progressionGoal?.question
    || customer.nextStep;
  const evidenceItems = Array.from(new Set([
    ...suggestion.evidence,
    ...(customer.bant?.evidence || []),
  ])).slice(0, 10);

  const switchMode = (mode: HandlingMode, message: string) => {
    onModeChange(mode);
    onToast(message);
  };

  useEffect(() => {
    setEvidenceOpen(false);
    setHandoffSummary('');
  }, [customer.id, suggestion.suggestionType]);

  useEffect(() => {
    if (!evidenceOpen || suggestion.suggestionType !== 'handoff' || handoffSummary) return;
    let alive = true;
    void requestHandoffSummary(customer).then(summary => {
      if (alive) setHandoffSummary(summary);
    });
    return () => {
      alive = false;
    };
  }, [customer, evidenceOpen, handoffSummary, suggestion.suggestionType]);

  const dismissSuggestion = () => {
    localStorage.setItem(suggestionDismissKey(customer.id, suggestion.suggestionType), String(Date.now() + 24 * 60 * 60 * 1000));
    onCompleteTodo();
    setDismissTick(value => value + 1);
    onToast('已暂不处理，24 小时内不再提醒');
  };

  void dismissTick;

  const primaryAction = async () => {
    if (suggestion.suggestionType === 'call') {
      if (isPrimaryLoading) return;
      setIsPrimaryLoading(true);
      try {
        await onGenerateDraft('生成一条主动触达草稿，语气自然，不承诺价格、折扣、付款条款或交期。', 'reactivate');
      } finally {
        setIsPrimaryLoading(false);
      }
      return;
    }
    if (suggestion.suggestionType === 'handoff') {
      onFocusReply();
      onToast('已聚焦回复框');
      return;
    }
    if (suggestion.suggestionType === 'draft_review' || suggestion.suggestionType === 'blocked_auto') {
      if (hasReplyReady) onViewDraft();
      else await onGenerateDraft('', 'reply');
      return;
    }
    if (suggestion.suggestionType === 'touch') {
      if (isPrimaryLoading) return;
      setIsPrimaryLoading(true);
      try {
        await onGenerateDraft('生成一条主动触达草稿，语气自然，不承诺价格、折扣、付款条款或交期。', 'reactivate');
      } finally {
        setIsPrimaryLoading(false);
      }
      return;
    }
  };

  const secondaryAction = () => {
    if (suggestion.suggestionType === 'call') {
      dismissSuggestion();
      return;
    }
    if (suggestion.suggestionType === 'handoff') {
      if (!customerServiceEnabled) {
        onToast('先开启智能客服，开启后只会给建议');
        return;
      }
      switchMode(autoReplyReady ? 'ai_auto' : 'ai_draft', autoReplyReady ? '已交回 AI 接待' : '已改为 AI 只给建议');
      return;
    }
    if (suggestion.suggestionType === 'draft_review' || suggestion.suggestionType === 'blocked_auto') {
      dismissSuggestion();
      return;
    }
    if (suggestion.suggestionType === 'touch') {
      dismissSuggestion();
    }
  };

  const primaryLabel: Record<PrioritySuggestion['suggestionType'], string> = {
    call: '生成触达草稿',
    handoff: '打开回复',
    draft_review: hasReplyReady ? '查看草稿' : '生成建议',
    touch: '生成触达草稿',
    blocked_auto: hasReplyReady ? '查看草稿' : '生成建议',
    none: '知道了',
  };
  const secondaryLabel: Record<PrioritySuggestion['suggestionType'], string> = {
    call: '暂不处理',
    handoff: !customerServiceEnabled ? '先开启客服' : autoReplyReady ? '交回 AI' : '改为 AI 建议',
    draft_review: '忽略此条',
    touch: '暂不处理',
    blocked_auto: '忽略此条',
    none: '',
  };

  return (
    <section data-testid="ai-intent-action-panel" className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
        <div>
          <p className="text-xs font-bold text-text-primary">AI 意向信号</p>
          <p className="mt-0.5 text-[10px] text-text-muted">沟通阶段与下一步推进建议</p>
        </div>
        <span className="shrink-0 border-l-2 border-accent bg-accent-glow px-2 py-1 text-[10px] font-bold text-accent">
          {intentLevelLabel(customer)} · {customer.intentScore}
        </span>
      </div>
      <div className="p-3">
      <div className="border-b border-border pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">当前沟通阶段</p>
          <p className="text-[11px] font-bold text-text-primary">{communicationStage}</p>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-secondary">{communicationSummary}</p>
      </div>
      <div className="pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-accent">下一步推进建议</p>
          <p className="text-[11px] font-bold text-text-primary">{suggestion.headline}</p>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-secondary">{nextMove || suggestion.reason}</p>
      </div>
      {!!customer.intentSignals.length && (
        <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
          {customer.intentSignals.slice(0, 6).map(signal => (
            <span key={signal} className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-text-secondary">{signal}</span>
          ))}
        </div>
      )}
      {(suggestion.suggestionType !== 'none' || agentProduction.action) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button type="primary" htmlType="button" data-agent-action={window.__agentProductionTarget?.customerId === customer.id && !['customer_segmentation', 'followup_batch_draft'].includes(window.__agentProductionTarget?.link.businessRef.taskKey || '') ? 'customer-primary' : undefined} onClick={() => void (agentProduction.active ? agentProduction.execute().catch(error => onToast(error.message)) : primaryAction())} disabled={agentProduction.active ? !agentProduction.action || agentProduction.busy : isPrimaryLoading} className="!h-auto min-h-9 !whitespace-normal rounded-md bg-accent px-3 py-1.5 text-[11px] font-bold text-white hover:bg-accent-dim disabled:cursor-wait disabled:opacity-70">
            {agentProduction.busy || isPrimaryLoading ? '草稿生成中…' : agentProduction.action?.label || primaryLabel[suggestion.suggestionType]}
          </Button>
          {secondaryLabel[suggestion.suggestionType] && (
            <Button htmlType="button" onClick={secondaryAction} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
              {secondaryLabel[suggestion.suggestionType]}
            </Button>
          )}
        </div>
      )}
      {!!evidenceItems.length && (
        <Button htmlType="button" onClick={() => setEvidenceOpen(open => !open)} className="!h-auto min-h-9 !whitespace-normal !justify-start mt-2.5 flex w-full items-center justify-between border-t border-border pt-2.5 text-left text-[11px] font-bold text-text-secondary">
          查看 AI 判断依据
          <ChevronDown size={14} className={`transition-transform ${evidenceOpen ? 'rotate-180' : ''}`} />
        </Button>
      )}
      {evidenceOpen && (
        <div className="mt-2 border-l-2 border-border-bright bg-surface-2 px-3 py-3 text-[11px] leading-5">
          {suggestion.suggestionType === 'handoff' && (
            <div className="mb-2 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-text-secondary">
              {handoffSummary || '正在整理交接摘要...'}
            </div>
          )}
          <div className="space-y-1.5">
            {evidenceItems.map(item => (
              <p key={item} className="flex gap-2 text-text-secondary"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />{item.replace(/\s[+-]\d+$/, '')}</p>
            ))}
          </div>
        </div>
      )}
      {customer.handlingMode === 'ai_auto' && suggestion.suggestionType === 'none' && (
        <Button htmlType="button" onClick={() => switchMode('human_needed', '已转为你亲自接手')} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
          转我接手
        </Button>
      )}
      </div>
    </section>
  );
}

function RulesDisclosure({
  customerServiceStatus,
  customerServiceSaving,
  customerServiceLabel,
  customerServiceSummary,
  notificationReady,
  onToggleCustomerService,
  onEnablePartialAutoReply,
}: {
  customerServiceStatus: CustomerServiceStatus | null;
  customerServiceSaving: boolean;
  customerServiceLabel: string;
  customerServiceSummary: string;
  notificationReady: boolean;
  onToggleCustomerService: (enabled: boolean) => void;
  onEnablePartialAutoReply: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <Button htmlType="button" onClick={() => setOpen(v => !v)} className="!h-auto min-h-9 !whitespace-normal !justify-start flex w-full items-center justify-between px-3.5 py-3 text-left text-xs font-bold text-text-primary">
        分工规则
        <ChevronDown size={14} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div className="space-y-2 border-t border-border px-3.5 py-3 text-[11px] leading-5 text-text-secondary">
          <div className="mb-3 border-y border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold text-text-primary">智能客服接待</p>
                <p className="text-[10px] text-text-muted">{customerServiceLabel}</p>
              </div>
              <Switch aria-label="智能客服总开关" checked={Boolean(customerServiceStatus?.enabled)} loading={customerServiceSaving} onChange={onToggleCustomerService}/>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-text-muted">{customerServiceSummary}</p>
            {customerServiceStatus?.enabled && customerServiceStatus.eligibleForPartialAutoReply && customerServiceStatus.partialAutoReplyDecision === 'declined' && (
              <Button htmlType="button" disabled={customerServiceSaving} onClick={onEnablePartialAutoReply} className="!h-auto min-h-9 !whitespace-normal mt-2 text-[10px] font-bold text-accent hover:underline disabled:opacity-50">
                开放部分直回
              </Button>
            )}
          </div>
          {!notificationReady && (
            <Button
              htmlType="button"
              onClick={() => {
                localStorage.setItem('lingshu:enterprise:highlight-notifications', 'true');
                window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }));
              }}
              className="!h-auto min-h-9 !whitespace-normal !justify-start mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[10px] font-semibold leading-4 text-slate-600 hover:bg-slate-50"
            >
              设置重要消息提醒接收方式
            </Button>
          )}
          <p>开启后的前 3 天：AI 只给建议，你确认后再发。</p>
          <p>出现采购数量、样品或收货信息：AI 写草稿，你确认后发送。</p>
          <p>满 3 天并由你授权后：仅已审批的简单问答可直接回复。</p>
          <p>讨价还价、订单条款、大单或高价值客户：提醒你亲自接手。</p>
          <Button
            htmlType="button"
            onClick={() => {
              localStorage.setItem('lingshu:enterprise:highlight-autonomy', 'auto');
              window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }));
            }}
            className="!h-auto min-h-9 !whitespace-normal mt-1 text-[11px] font-bold text-accent hover:underline"
          >
            在企业中心调整规则
          </Button>
        </div>
      )}
    </div>
  );
}

function CustomerInsightDisclosure({ customer }: { customer: CustomerProfile }) {
  const [open, setOpen] = useState(false);
  const scenario = customer.simulation;
  const humanEditedEvents = customer.timeline.filter(event => event.audit?.editedByHuman).length;
  const humanEditCount = Math.max(humanEditedEvents, scenario?.humanEditCount || 0);
  const aiHandledCount = customer.timeline.filter(event => (
    event.actor === 'ai'
    || Boolean(event.audit?.originalDraft)
    || Boolean(event.audit?.memoryApplied?.length)
  )).length;
  const memoryRecords = Array.from(new Set([
    ...(scenario?.memoryApplied || []),
    ...customer.timeline.flatMap(event => event.audit?.memoryApplied || []),
  ]));

  useEffect(() => setOpen(false), [customer.id]);

  return (
    <section data-testid="customer-insight-disclosure" className="rounded-lg border border-border bg-surface">
      <Button
        htmlType="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="!h-auto min-h-9 !whitespace-normal !justify-start flex w-full items-center gap-2 px-3.5 py-3 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
          <BrainCircuit size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold text-text-primary">客户判断摘要</span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {scenario?.warning && (
              <span
                data-testid="large-order-warning-tag"
                aria-label={`${scenario.warning.title}：${scenario.warning.reason}`}
                title={`${scenario.warning.title}：${scenario.warning.reason}`}
                className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"
              >
                <AlertTriangle size={10} />大单预警
              </span>
            )}
            <span className="border-l border-border-bright px-2 py-0.5 text-[10px] font-semibold text-text-secondary">{STAGE_LABEL[customer.stage]}</span>
            <span className="border-l border-border-bright px-2 py-0.5 text-[10px] font-semibold text-text-secondary">意向 {customer.intentScore}</span>
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div className="space-y-3 border-t border-border px-3.5 py-3">
          {scenario?.warning && (
            <p className="border-l-2 border-red bg-red/5 px-3 py-2 text-[11px] leading-5 text-red">{scenario.warning.reason}</p>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">AI 对客户意向的判断</p>
            <p className="mt-1 text-[11px] font-semibold text-text-primary">{intentLevelLabel(customer)}</p>
            <p className="mt-1 text-[11px] leading-5 text-text-secondary">{customer.summary}</p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">销售节点进度</p>
            <p className="mt-1 text-[11px] font-semibold text-text-primary">{scenario?.checkpoint || STAGE_LABEL[customer.stage]}</p>
            <p className="mt-1 text-[11px] leading-5 text-text-secondary">{scenario?.goal || customer.nextStep}</p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">AI 处理记录</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">AI 参与 {aiHandledCount} 次</span>
              <span className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">人工优化 {humanEditCount} 次</span>
              <span className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">学习记录 {memoryRecords.length} 条</span>
            </div>
            {!!memoryRecords.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {memoryRecords.slice(0, 6).map(item => (
                  <span key={item} className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] text-text-secondary">{item}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CustomerInfoRail({
  customer,
  customerServiceStatus,
  customerServiceSaving,
  customerServiceLabel,
  customerServiceSummary,
  notificationReady,
  onGenerateDraft,
  onHandlingModeChange,
  onCustomerPatch,
  onToast,
  onFocusReply,
  onViewDraft,
  onCompleteTodo,
  customerServiceEnabled,
  autoReplyReady,
  hasReplyReady,
  onToggleCustomerService,
  onEnablePartialAutoReply,
  onInsertQuoteReply,
  onQuoteCardSent,
}: {
  customer: CustomerProfile | null;
  customerServiceStatus: CustomerServiceStatus | null;
  customerServiceSaving: boolean;
  customerServiceLabel: string;
  customerServiceSummary: string;
  notificationReady: boolean;
  onGenerateDraft: (instruction: string, intent?: DraftIntent) => Promise<void> | void;
  onHandlingModeChange: (mode: HandlingMode) => void;
  onCustomerPatch: (patch: Partial<CustomerProfile>) => void;
  onToast: (message: string) => void;
  onFocusReply: () => void;
  onViewDraft: () => void;
  onCompleteTodo: () => void;
  customerServiceEnabled: boolean;
  autoReplyReady: boolean;
  hasReplyReady: boolean;
  onToggleCustomerService: (enabled: boolean) => void;
  onEnablePartialAutoReply: () => void;
  onInsertQuoteReply: (text: string) => void;
  onQuoteCardSent: (summary: string, providerMessageId?: string) => void;
}) {
  if (!customer) {
    return (
      <aside className="flex h-full w-full lg:w-64 shrink-0 items-center justify-center border-l border-border bg-slate-50 px-6 text-center xl:w-[272px] 2xl:w-72">
        <p className="text-xs font-bold text-text-muted">未选择客户</p>
      </aside>
    );
  }

  const copyConversationLink = () => {
    void navigator.clipboard.writeText(window.location.href)
      .then(() => onToast('会话链接已复制'))
      .catch(() => onToast('浏览器未允许复制，请从地址栏复制链接'));
  };

  return (
    <aside data-testid="customer-info-rail" className="min-h-0 w-full shrink-0 self-stretch overflow-y-auto overscroll-contain border-l border-border bg-white [scrollbar-gutter:stable] lg:w-64 xl:w-[272px] 2xl:w-72">
      <div className="border-b border-border px-4 py-5 text-center">
        <Avatar size={72} style={{ background: '#E8C7EC', color: '#6F3E7A', fontSize: 28 }}>{customer.avatar || customer.name.slice(0, 1)}</Avatar>
        <h2 className="mt-3 truncate text-base font-semibold text-text-primary" title={customer.name}>{customer.name}</h2>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-text-muted"><SourceIcon source={customer.source} size={13}/><span>{sourceLabel(customer.source)}</span><span>·</span><LiveLocalTime timeZone={customer.timeZone}/></div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[
            { label: '分享', icon: <Share2 size={16}/>, action: copyConversationLink },
            { label: '资料', icon: <UserRound size={16}/>, action: () => onToast('客户资料已在下方展开') },
            { label: '草稿', icon: <FileImage size={16}/>, action: onViewDraft },
            { label: '回复', icon: <MessageSquare size={16}/>, action: onFocusReply },
          ].map(item => <button key={item.label} type="button" onClick={item.action} className="group flex min-w-0 flex-col items-center gap-1 text-[10px] font-medium text-text-secondary"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-text-primary transition-colors group-hover:bg-accent-glow group-hover:text-accent">{item.icon}</span><span>{item.label}</span></button>)}
        </div>
        <div className="mt-4 text-left">
          <div className="mb-1 flex items-center justify-between text-[11px]"><span className="font-medium text-text-secondary">客户意向</span><strong className="text-text-primary">{customer.intentScore}%</strong></div>
          <LsGradientProgress percent={customer.intentScore} showInfo={false} size="small" />
        </div>
      </div>
      <Collapse
        ghost
        defaultActiveKey={['business']}
        items={[
          {
            key: 'media',
            label: '影音内容、文件和链接',
            children: <div className="rounded-lg bg-surface-2 p-3 text-xs leading-5 text-text-secondary"><p>当前会话共 {customer.timeline.filter(event => event.type === 'messenger' || event.type === 'whatsapp').length} 条消息。</p><p className="mt-1">收到的媒体和链接会在这里按时间归档；没有内容时不展示伪造缩略图。</p></div>,
          },
          {
            key: 'business',
            label: '客户与销售工作台',
            children: <div className="grid gap-2.5">
              <CustomerInsightDisclosure customer={customer} />
              <CustomerIntentActionPanel customer={customer} onModeChange={onHandlingModeChange} onToast={onToast} onGenerateDraft={onGenerateDraft} onFocusReply={onFocusReply} onViewDraft={onViewDraft} onCompleteTodo={onCompleteTodo} customerServiceEnabled={customerServiceEnabled} autoReplyReady={autoReplyReady} hasReplyReady={hasReplyReady} />
              <QuoteSkillCard key={`quote-skill-${customer.id}`} customer={customer} onInsertReply={onInsertQuoteReply} onToast={onToast} channelReady={Boolean((customer.source === 'messenger' ? customerServiceStatus?.messengerAuthorization : customer.source === 'instagram' ? customerServiceStatus?.instagramAuthorization : customerServiceStatus?.messagingAuthorization)?.providerReady)} onCardSent={onQuoteCardSent} />
              <BasicInfoWidget customer={customer} onCustomerPatch={onCustomerPatch} />
              <TagsWidget key={`tags-${customer.id}`} customer={customer} onCustomerPatch={onCustomerPatch} onToast={onToast} />
            </div>,
          },
          {
            key: 'privacy',
            label: '隐私设置与支持',
            children: <RulesDisclosure customerServiceStatus={customerServiceStatus} customerServiceSaving={customerServiceSaving} customerServiceLabel={customerServiceLabel} customerServiceSummary={customerServiceSummary} notificationReady={notificationReady} onToggleCustomerService={onToggleCustomerService} onEnablePartialAutoReply={onEnablePartialAutoReply} />,
          },
        ]}
      />
    </aside>
  );
}

function createMessageEvent(
  customerId: string,
  body: string,
  actor: 'seller' | 'buyer' | 'ai',
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  const timestamp = Date.now();
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    id: `${customerId}-${Date.now()}-${actor}`,
    type: 'messenger',
    actor,
    title: actor === 'buyer' ? '客户消息' : actor === 'ai' ? 'AI 回复' : '我的回复',
    body,
    time,
    timestamp,
    ...extra,
  };
}

async function sendCustomerOutbox(customer: CustomerProfile, body: string, outsideWindow: boolean, templatePlan?: TemplatePlan | null, styleMemory?: StyleMemoryPayload | null) {
  if (customer.isMock) return { status: 'delivered' as const, outboxId: `mock-${Date.now()}` };
  const resp = await fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(templatePlan
      ? { body: templatePlan.rendered, mode: 'template', outsideWindow, to: customer.source === 'instagram' ? customer.instagramUserId : customer.messengerUserId, styleMemory }
      : { body, mode: 'free_text', outsideWindow, to: customer.source === 'instagram' ? customer.instagramUserId : customer.messengerUserId, styleMemory }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || data.error || '发送失败');
  return data as { status?: 'queued' | 'sent' | 'delivered'; outboxId?: string; providerMessageIds?: string[] };
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
  const selectedLatestBuyerId = useMemo(() => (
    selected ? [...selected.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer')?.id ?? '' : ''
  ), [selected?.id, selected?.timeline]);
  const customersInActiveView = useMemo(() => filterCustomers(view, customers), [view, customers]);
  const activeView = VIEW_META[view];
  const partialAutoReplyActive = Boolean(customerServiceStatus?.autoReplyReady && autonomyLevel === 'auto');
  const customerPendingCount = useMemo(() => pendingCount(customers), [customers]);
  const customerTodoItems = useMemo(() => (
    dailyTodoCustomers(customers).map(customer => {
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
    if (customer.isMock) return;
    void fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ pendingDraft: pendingDraft ?? null }),
    }).catch(() => {
      // 本地状态仍保留，下次后端同步时再以服务端为准。
    });
  }, [updateCustomer]);

  useEffect(() => {
    if (deepLinkConsumedRef.current || !customers.length) return;
    const customerId = new URLSearchParams(window.location.search).get('customer');
    if (!customerId) {
      deepLinkConsumedRef.current = true;
      return;
    }
    if (customers.some(customer => customer.id === customerId)) {
      setSelectedId(customerId);
      const customer = customers.find(item => item.id === customerId)!;
      setView(customer.stage === 'won' ? 'won' : ['silent30', 'silent60'].includes(customer.stage) ? 'silent' : 'leads');
      deepLinkConsumedRef.current = true;
    }
  }, [customers]);

  useEffect(() => {
    if (agentProduction.active && window.__agentProductionTarget?.customerId) {
      setSelectedId(window.__agentProductionTarget.customerId);
      return;
    }
    if (selectedId && customersInActiveView.some(customer => customer.id === selectedId)) return;
    if (!selectedId && filterEmptySelectionRef.current) return;
    setSelectedId(customersInActiveView[0]?.id ?? null);
  }, [customersInActiveView, selectedId]);

  useEffect(() => {
    const ref = deliveryHandoff?.businessRef;
    if (!ref?.entityId) return;
    const customer = customers.find(item => item.id === ref.entityId);
    if (!customer) { if (customers.length) setDeliveryError('关联客户暂不可访问，请返回交付看板核对。'); return; }
    setDeliveryError('');
    setSelectedId(customer.id);
    setView(customer.stage === 'won' ? 'won' : ['silent30', 'silent60'].includes(customer.stage) ? 'silent' : 'leads');
  }, [deliveryHandoff, customers]);


  useEffect(() => {
    customers.forEach(customer => {
      if (customer.todoCompletedAt) return;
      const suggestion = buildPrioritySuggestion(customer);
      if (suggestion.suggestionType !== 'none' && isSuggestionDismissed(customer.id, suggestion.suggestionType)) {
        updateCustomer(customer.id, { todoCompletedAt: new Date().toISOString(), hasUnread: false });
      }
    });
  }, [customers, updateCustomer]);

  useEffect(() => {
    let alive = true;
    let retryTimer: number | null = null;
    let attempt = 0;

    const loadStatus = async () => {
      try {
        const status = await getCustomerServiceStatus();
        if (!alive) return;
        setCustomerServiceStatus(status);
        setCustomerServiceStatusLoadFailed(false);
      } catch {
        if (!alive) return;
        attempt += 1;
        if (attempt < 4) {
          retryTimer = window.setTimeout(() => void loadStatus(), 700 * (2 ** (attempt - 1)));
          return;
        }
        setCustomerServiceStatus(null);
        setCustomerServiceStatusLoadFailed(true);
      }
    };

    void loadStatus();
    return () => {
      alive = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        const value = data?.strategy?.aiAutonomy;
        const approvedFaqCount = Array.isArray(data?.faq)
          ? data.faq.filter((item: any) => item?.approvedForAuto && String(item?.question || '').trim() && String(item?.answer || '').trim()).length
          : 0;
        if (value === 'auto') setAutonomyLevel(approvedFaqCount >= 5 ? 'auto' : 'draft');
        else if (value === 'remind' || value === 'draft') setAutonomyLevel(value);
        setPriceRulesReady(Boolean(data?.bizRules?.quoteMode && data?.bizRules?.samplePolicy && data?.bizRules?.paymentTerms));
        const firstProduct = Array.isArray(data?.products?.items)
          ? data.products.items.find((item: any) => String(item?.name || '').trim())
          : null;
        const enterpriseProduct = String(firstProduct?.name || data?.products?.categories || data?.company?.industry || '').trim();
        updateCustomer('mock-customer-conversation', {
          product: enterpriseProduct,
          outboundProduct: enterpriseProduct,
          summary: `当前绑定企业：${String(data?.company?.name || '当前企业')}；主营：${enterpriseProduct || '等待客户说明具体需求'}`,
        });
      })
      .catch(() => {});
    fetch('/api/overseas/enterprise/knowledge-completion', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (data?.sections?.bizRules) setPriceRulesReady(Boolean(data.sections.bizRules.completed));
        if (typeof data?.notificationsReady === 'boolean') {
          setNotificationReady(data.notificationsReady);
        }
      })
      .catch(() => {});
  }, [updateCustomer]);

  useEffect(() => {
    fetch('/api/overseas/customers/templates', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setTemplates(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (agentProduction.active || deliveryHandoff || customerPendingCount <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = 'lingshu:briefing:lastShown';
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
    setDailyBriefingOpen(true);
  }, [customerPendingCount, deliveryHandoff, agentProduction.active]);

  useEffect(() => {
    const handler = () => setDailyBriefingOpen(true);
    window.addEventListener('lingshu:open-daily-briefing', handler);
    return () => window.removeEventListener('lingshu:open-daily-briefing', handler);
  }, []);

  useEffect(() => {
    translationRequestRef.current += 1;
    setDraftSuggestion(null);
    setDraftMeta(null);
    setLastDraftKey('');
    setInput('');
    setTranslatedInput('');
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    const untranslated = selected.timeline.filter(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && !/[\u4e00-\u9fff]/.test(event.body) && !event.translatedBody);
    if (!untranslated.length) return;
    let cancelled = false;
    void Promise.all(untranslated.map(async event => {
      try {
        const response = await fetch('/api/overseas/plugins/translate/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ text: event.body, target: '简体中文' }),
        });
        const data = await response.json();
        if (!cancelled && response.ok && data.translatedText) {
          updateTimelineEvent(selected.id, event.id, { translatedBody: String(data.translatedText).trim() });
        }
      } catch { /* 翻译为辅助信息，失败时保留原文。 */ }
    }));
    return () => { cancelled = true; };
  }, [selected?.id, selected?.timeline, updateTimelineEvent]);

  useEffect(() => {
    if (!selected) return;
    if (!customerServiceStatus?.enabled) return;
    const lastBuyer = [...selected.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer');
    if (!lastBuyer) return;
    if (isWaitingForHumanQuote(selected)) {
      setDraftSuggestion(null);
      setDraftMeta(null);
      return;
    }
    const key = `${selected.id}:${lastBuyer.id}`;
    if (key === lastDraftKey) return;
    setLastDraftKey(key);
    if (selected.pendingDraft?.trim()) {
      setDraftSuggestion(selected.pendingDraft.trim());
      return;
    }
    let cancelled = false;
    void requestDraft(selected).then(result => {
      if (cancelled) return;
      setDraftSuggestion(result.draft);
      setDraftMeta(result);
      savePendingDraft(selected, result.draft);
    });
    return () => { cancelled = true; };
    // lastDraftKey is intentionally a guard, not a dependency: adding it here
    // would cancel the request immediately after the key is recorded.
  }, [selected?.id, selectedLatestBuyerId, selected?.pendingDraft, selected?.handlingReason, customerServiceStatus?.enabled, savePendingDraft]);

  useEffect(() => {
    const viewLabel = selected ? `客户详情 / ${selected.name}` : activeView.label;
    const summary = selected
      ? `当前页面：客户详情。客户：${selected.name}。阶段：${STAGE_LABEL[selected.stage]}。意向：${selected.intentScore}。产品：${selected.product}。预估价值：${selected.estimatedValue}。摘要：${selected.summary}`
      : `当前页面：我的客户 - ${activeView.label}。${activeView.desc}`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'conversion',
        label: viewLabel,
        summary,
        pendingCount: customerPendingCount,
        todoItems: customerTodoItems,
        suggestions: selected
          ? ['生成下一条回复', '整理触达要点', '生成报价跟进', '创建今日触达任务']
          : ['现在该先回谁？', '筛选紧急客户', '筛选高意向客户', '创建老客唤醒批次'],
      },
    }));
  }, [view, selected, activeView, customerPendingCount, customerTodoItems]);

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
    if (!current) return;
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
    if (!selected) return;
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

  const pushMockBuyerMessage = async (text: string) => {
    if (!selected?.isMock || !text.trim()) return;
    const buyerEvent = createMessageEvent(selected.id, text.trim(), 'buyer');
    const customerWithMessage = { ...selected, timeline: [...selected.timeline, buyerEvent] };
    appendTimelineEvent(selected.id, buyerEvent);
    updateCustomer(selected.id, { hasUnread: true, lastActive: '刚刚', lastActiveAt: buyerEvent.timestamp, inboxReason: 'reply', pendingDraft: undefined });
    if (!customerServiceStatus?.enabled) {
      updateCustomer(selected.id, { handlingMode: 'human_needed', handlingReason: '智能客服未开启，等待人工回复' });
      showToast('智能客服未开启，这条消息只进入收件箱');
      return;
    }
    setLastDraftKey(`${selected.id}:${buyerEvent.id}`);
    setDraftSuggestion(null);
    setDraftMeta(null);
    const result = await requestDraft(customerWithMessage);
    if (result.handoffRequired || !result.draft.trim()) {
      if (result.safeToSendBeforeHandoff && result.draft.trim()) {
        const bridgeReply = translateChineseReplyForCustomer(customerWithMessage, result.draft);
        appendTimelineEvent(selected.id, createMessageEvent(selected.id, bridgeReply, 'ai', { autoSent: true, sendStatus: 'delivered', translatedBody: result.translatedDraft }));
      }
      updateCustomer(selected.id, {
        handlingMode: 'human_needed',
        handlingReason: result.handlingReason || '该消息需要人工接待',
        fallbackCount: result.fallbackCount ?? selected.fallbackCount,
        pendingDraft: undefined,
      });
      setDraftMeta(result);
      showToast(result.safeToSendBeforeHandoff && result.draft.trim()
        ? 'AI 已先承接客户，并把完整上下文转给人工'
        : result.handlingReason || '该消息已转人工处理');
      return;
    }
    if (!partialAutoReplyActive) {
      setDraftSuggestion(result.draft);
      setDraftMeta(result);
      updateCustomer(selected.id, {
        handlingMode: 'ai_draft',
        handlingReason: 'AI 已生成建议，等待你确认后发送',
        hasUnread: true,
        fallbackCount: result.fallbackCount ?? selected.fallbackCount,
        pendingDraft: result.draft,
      });
      showToast('已生成建议回复，确认后再发送');
      return;
    }
    const reply = translateChineseReplyForCustomer(customerWithMessage, result.draft);
    appendTimelineEvent(selected.id, createMessageEvent(selected.id, reply, 'ai', {
      autoSent: true,
      sendStatus: 'delivered',
      translatedBody: result.translatedDraft,
    }));
    updateCustomer(selected.id, {
      handlingMode: 'ai_auto',
      handlingReason: 'Mock 智能客服已自动接待',
      hasUnread: false,
      aiAutoCount: (selected.aiAutoCount ?? 0) + 1,
      fallbackCount: result.fallbackCount ?? selected.fallbackCount,
      pendingDraft: undefined,
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

  const queueSend = (customer: CustomerProfile, body: string, restoreText: string, templatePlan?: TemplatePlan | null, meta?: DraftResult | null) => {
    const styleMemory = buildStyleMemoryPayload(customer, restoreText, meta);
    const eventBody = templatePlan ? templatePlan.rendered : body;
    const event = createMessageEvent(customer.id, eventBody, 'seller', {
      type: customer.source === 'instagram' ? 'instagram' : 'messenger',
      sendStatus: 'queued',
      sendMode: templatePlan ? 'template' : 'free_text',
      confirmedByHuman: true,
      translatedBody: restoreText.trim() && restoreText.trim() !== eventBody.trim() ? restoreText.trim() : undefined,
      audit: meta?.knowledgeMiss ? { knowledgeMiss: true, buyerMessage: meta.buyerMessage, evidence: meta.evidence } : undefined,
    });
    appendTimelineEvent(customer.id, event);
    setDraftSuggestion(null);
    setDraftMeta(null);
    setInput('');
    setTranslatedInput('');

    const timer = window.setTimeout(() => {
      setUndoSend(current => current?.eventId === event.id ? null : current);
      void sendCustomerOutbox(customer, body, isOutsideWhatsAppWindow(customer), templatePlan, styleMemory)
        .then(async result => {
          updateTimelineEvent(customer.id, event.id, {
            sendStatus: result.status || 'sent',
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
          removeTimelineEvent(customer.id, event.id);
          persistCustomerPatch(customer.id, { hasUnread: true, todoCompletedAt: undefined, pendingDraft: restoreText });
          if (selected?.id === customer.id) {
            setInput(restoreText);
            setTranslatedInput('');
          }
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
    if (!selected) return;
    if (intent !== 'polish' && isWaitingForHumanQuote(selected)) {
      showToast('客户正在询价，已标记等待人工报价，请由销售亲自回复。');
      return;
    }
    setDraftSuggestion(null);
    setDraftMeta(null);
    const result = await requestDraft(selected, instruction, undefined, intent, true);
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
    if (!selected) return;
    if (isWaitingForHumanQuote(selected)) {
      showToast('报价问题不生成 AI 回复，请由销售亲自回复。');
      return;
    }
    const result = await requestDraft(selected, undefined, undefined, 'reply', true);
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

  const reportManualActive = () => {
    if (!selected) return;
    fetch(`/api/overseas/customers/${encodeURIComponent(selected.id)}/manual-active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ minutes: 10 }),
    }).catch(() => {});
  };

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

  const editDraft = () => {
    if (!selected || !draftSuggestion) return;
    setInput(draftSuggestion);
    translationRequestRef.current += 1;
    setTranslatedInput('');
    setDraftSuggestion(null);
    updateCustomer(selected.id, { pendingDraft: draftSuggestion });
    window.setTimeout(() => {
      const inputEl = document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input]');
      inputEl?.focus();
      if (inputEl) {
        inputEl.selectionStart = inputEl.value.length;
        inputEl.selectionEnd = inputEl.value.length;
      }
    }, 0);
  };

  const focusReplyInput = () => {
    setMobilePanel('chat');
    const inputEl = document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input]');
    inputEl?.focus();
    inputEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const viewDraftSuggestion = () => {
    setMobilePanel('chat');
    const draftEl = document.querySelector<HTMLElement>('[data-draft-suggestion]');
    if (draftEl) {
      draftEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (selected?.pendingDraft?.trim() && !input.trim()) {
      setDraftSuggestion(selected.pendingDraft.trim());
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-draft-suggestion]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      return;
    }
    focusReplyInput();
  };

  const customerServiceLabel = !customerServiceStatus
    ? (customerServiceStatusLoadFailed ? '读取失败' : '正在读取')
    : !customerServiceStatus.enabled
      ? '已关闭'
      : partialAutoReplyActive
        ? '部分直回'
        : `只给建议 · 第 ${customerServiceStatus.observationDay}/3 天`;
  const customerServiceSummary = !customerServiceStatus
    ? (customerServiceStatusLoadFailed
      ? '暂时没读到客服状态，点一下开关可重新尝试。'
      : '正在读取智能客服状态…')
    : !customerServiceStatus.enabled
      ? '账号消息只进入收件箱，灵小枢不会自行处理。'
    : partialAutoReplyActive
      ? '仅高置信命中已审批常见问答时直回；其余内容仍等你确认。'
      : customerServiceStatus.partialAutoReplyEnabled
        ? '已开放权限，但已审批问答不足 5 条，目前仍只给建议。'
        : customerServiceStatus.eligibleForPartialAutoReply
          ? '建议模式已运行满 3 天，是否开放部分直接回复由你决定。'
          : '灵小枢只生成建议回复，所有消息都要由你确认后发送。';


  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <h1 className="sr-only">{PAGE_REGISTRY.conversion.canonicalTitle}</h1>
    {includeMockCustomers && <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900"><strong>本地模拟 · 外贸客户全流程</strong>　收件箱、潜客、成交客户和沉默客户均已加入多语言工厂采购场景。</div>}
    {deliveryHandoff?.runId && <div className="shrink-0"><CustomerWorkflowPanel handoff={deliveryHandoff} customers={customers} /></div>}
    {deliveryHandoff && !deliveryHandoff.runId && <section className="mx-4 mt-3 shrink-0 border-l-2 border-accent bg-accent-glow p-3">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-accent">来自业务交付看板 · 客户跟进草稿</p></div>
      {deliveryError ? <p role="alert" className="mt-2 text-xs text-red-700">{deliveryError}</p> : deliveryDraft ? <>
        <details className="mt-2 text-xs text-slate-700"><summary className="cursor-pointer">查看关联草稿 v{deliveryDraft.version}</summary><p className="mt-2 whitespace-pre-wrap leading-6">{deliveryDraft.body}</p></details>
        <p className="mt-2 text-[11px] text-slate-500">此处展示所属批次的草稿。批次审核请返回交付看板；会话中的回复操作独立处理。</p>
      </> : <p className="mt-2 text-xs text-slate-500">没有对应的草稿记录，请返回交付看板选择具体客户任务。</p>}
    </section>}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink p-0 lg:p-3" data-lingshu-guide="customer-workbench">
      <Tabs className="shrink-0 bg-white px-3 lg:hidden" aria-label="客服工作区" activeKey={mobilePanel} onChange={key => setMobilePanel(key as typeof mobilePanel)} items={[{ key: 'list', label: '客户列表' }, { key: 'chat', label: '会话' }, { key: 'profile', label: '客户资料' }]}/>
      <div data-testid="conversation-workspace-main" className="ls-conversation-workspace min-h-0 flex-1">
        <div className={mobilePanel === 'list' ? 'ls-conversation-workspace__pane flex min-h-0 min-w-0 flex-1 lg:contents' : 'hidden lg:contents'}>
        <CompactCustomerList
          view={view}
          selectedId={selectedId}
          customers={customers}
          showSimulationBadge={includeMockCustomers}
          onOpen={openCustomer}
          onViewChange={(nextView) => { filterEmptySelectionRef.current = false; setView(nextView); }}
          onVisibleSelectionChange={(id, filteredEmpty) => {
            filterEmptySelectionRef.current = filteredEmpty;
            setSelectedId(id);
          }}
        />
        </div>
        <div className={mobilePanel === 'chat' ? 'ls-conversation-workspace__pane flex min-h-0 min-w-0 flex-1 lg:contents' : 'hidden lg:contents'}>
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
                if (!customer.isMock) {
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
          onEditDraft={editDraft}
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
          onMockBuyerMessage={pushMockBuyerMessage}
          sending={sendingReply}
          channelReady={Boolean((selected?.source === 'messenger' ? customerServiceStatus?.messengerAuthorization : selected?.source === 'instagram' ? customerServiceStatus?.instagramAuthorization : customerServiceStatus?.messagingAuthorization)?.providerReady)}
          onToast={showToast}
        />
        </div>
        <div className={mobilePanel === 'profile' ? 'ls-conversation-workspace__pane flex min-h-0 min-w-0 flex-1 lg:contents' : 'hidden lg:contents'}>
        <CustomerInfoRail
          key={selected?.id || 'no-customer'}
          customer={selected}
          customerServiceStatus={customerServiceStatus}
          customerServiceSaving={customerServiceSaving}
          customerServiceLabel={customerServiceLabel}
          customerServiceSummary={customerServiceSummary}
          notificationReady={notificationReady}
          onGenerateDraft={generateManualDraft}
          onHandlingModeChange={updateHandlingMode}
          onCustomerPatch={(patch) => {
            if (selected) persistCustomerPatch(selected.id, patch);
          }}
          onToast={showToast}
          onFocusReply={focusReplyInput}
          onViewDraft={viewDraftSuggestion}
          onCompleteTodo={markSelectedTodoCompleted}
          customerServiceEnabled={Boolean(customerServiceStatus?.enabled)}
          autoReplyReady={partialAutoReplyActive}
          hasReplyReady={Boolean(draftSuggestion?.trim() || input.trim() || selected?.pendingDraft?.trim())}
          onToggleCustomerService={(enabled) => void changeCustomerServiceEnabled(enabled)}
          onEnablePartialAutoReply={() => void decidePartialAutoReply('enabled')}
          onInsertQuoteReply={(text) => {
            if (!selected) return;
            reportManualActive();
            translationRequestRef.current += 1;
            setInput(text);
            setTranslatedInput('');
            setDraftSuggestion(null);
            setDraftMeta(null);
            updateCustomer(selected.id, { pendingDraft: text });
            setMobilePanel('chat');
          }}
          onQuoteCardSent={(summary, providerMessageId) => {
            if (!selected) return;
            appendTimelineEvent(selected.id, createMessageEvent(selected.id, summary, 'seller', {
              type: 'quote',
              title: '已发送报价卡片',
              sendStatus: 'sent',
              confirmedByHuman: true,
              audit: { action: 'formal_quote_card_sent', risk: 'L4', providerMessageId },
            }));
          }}
        />
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
        <DailyBriefing customers={customers} onSelectCustomer={openCustomer} onClose={() => setDailyBriefingOpen(false)} />
      )}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-md bg-text-primary px-4 py-2 text-xs font-bold text-white">
          {toast}
          {learnCandidate && (
            <Button htmlType="button" onClick={() => { setToast(null); setLearnDialogOpen(true); }} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-950">存进知识库</Button>
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
        <div role="status" className="fixed bottom-24 left-1/2 z-[80] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-md bg-text-primary px-4 py-2 text-xs font-bold text-white">
          <span>{'\u5df2\u53d1\u9001\uff0c4 \u79d2\u5185\u53ef\u64a4\u56de'}</span>
          <Button htmlType="button" onClick={undoQueuedSend} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-950">{'\u64a4\u56de'}</Button>
        </div>
      )}
    </div>
    </div>
  );
}
