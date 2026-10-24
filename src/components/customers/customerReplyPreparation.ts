import { fetchCustomerReply } from '../../lib/customerReplyRequest';
import { authHeader } from '../../lib/auth';
import { isPredominantlyChineseText } from '../../lib/messageLanguage';
import type { CustomerProfile } from '../../types/customer';
import type { SalesDecisionMeta } from './SalesDecisionEvidence';
import type { ConversationDraftIntent } from './conversationTiming';
import { STAGE_LABEL } from './conversionPresentation';

type DraftIntent = ConversationDraftIntent;

export interface DraftResult {
  schemaVersion?: number; requestId?: string; status?: string; generationSource?: string;
  code?: string | null; retryable?: boolean; enterpriseFactVersion?: string | null;
  verification?: {status:string;issues:string[]}; messages?:string[]; translatedMessages?:string[];
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

export interface MessageTemplate {
  name: string;
  label: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  body: string;
}

export interface TemplatePlan {
  template: MessageTemplate;
  variables: string[];
  rendered: string;
}

export interface StyleMemoryPayload {
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

export function replyLanguage(customer: CustomerProfile): string {
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

export function fallbackCustomerReplyZh(customer: CustomerProfile): string {
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

export async function translateReplyToCustomerLanguage(customer: CustomerProfile, text: string): Promise<string> {
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
  throw new Error('翻译服务暂不可用，原文已保留，请稍后重试；本次未发送。');
}

export function latestBuyerText(customer: CustomerProfile): string {
  return [...customer.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer')?.body || '';
}

export function isWaitingForHumanQuote(customer: CustomerProfile): boolean {
  const latest = latestBuyerText(customer);
  return customer.handlingReason.includes('等待人工报价')
    || /\b(price|quote|quotation|discount|unit cost|how much)\b|报价|价格|单价|多少钱|折扣|优惠/i.test(latest);
}

export async function requestDraft(
  customer: CustomerProfile,
  instruction?: string,
  mode?: 'draft' | 'polish',
  intent: DraftIntent = mode === 'polish' ? 'polish' : 'reply',
  manualRequest = false,
): Promise<DraftResult> {
  try {
    const {response:resp,data,requestId} = await fetchCustomerReply({
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
    }, manualRequest);
    const metadata = {schemaVersion:data.schemaVersion,requestId,status:data.status,generationSource:data.generationSource,
      decision:data.decision,verification:data.verification,enterpriseFactVersion:data.enterpriseFactVersion,
      messages:data.messages,translatedMessages:data.translatedMessages,code:data.code,retryable:data.retryable};
    if (resp.status===202) return {...metadata,draft:'',category:intent,handlingReason:'原草稿仍在核对中，请读取原请求结果，不要重复生成。'};
    if (resp.ok) {
      if (data?.handoffRequired) {
        const bridgeDraft = typeof data?.draft === 'string' ? data.draft.trim() : '';
        const chineseBridgeDraft = typeof data?.translatedDraft === 'string' && data.translatedDraft.trim()
          ? data.translatedDraft.trim()
          : isPredominantlyChineseText(bridgeDraft) ? bridgeDraft : bridgeDraft;
        return {
          ...metadata,
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
          : originalDraft;
        return {
          ...metadata,
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
    return {...metadata,draft:'',status:'blocked',code:data.error||'customer_reply_unavailable',handlingReason:data.message||data.error||'草稿暂不可用，未生成替代话术。',category:intent};
  } catch (error) {
    return {draft:'',requestId:error&&typeof error==='object'&&'requestId'in error?String(error.requestId):undefined,status:'failed',code:'customer_reply_transport_unavailable',retryable:false,handlingReason:error instanceof Error?error.message:'草稿请求结果未确认，请读取原请求。',category:intent};
  }
}
