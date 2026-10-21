import { callLLM } from '../agents/llm.js';
import { draftFactualRiskSignals, requiresFactualVerification, unsupportedDraftNumbers } from '../agents/draftSafety.js';
import type { RetrievedContext } from '../knowledge/retrieve.js';
import type { RetrievedStrategy } from '../knowledge/strategyRetrieve.js';
import { cleanDraft } from './draftReplyLanguage.js';

function factualSourceForDraft(input: {
  latestMessage: string;
  sellerInstruction?: string;
  context: RetrievedContext;
  timeline: any[];
}): string {
  return JSON.stringify({
    buyerMessage: input.latestMessage,
    sellerInstruction: input.sellerInstruction || '',
    knowledgeReady: input.context.knowledgeReady,
    company: input.context.companyIntro,
    businessRules: input.context.bizRules,
    matchedFaq: input.context.faqMatch,
    products: input.context.products,
    timeline: input.timeline,
  });
}

export type DraftIntent = 'reply'|'opener'|'followup'|'reactivate'|'post_call'|'polish'|'handoff_summary';
type VerificationStatus = 'verified' | 'revised' | 'review_required' | 'safe_fallback';

export interface DraftVerification {
  draft: string;
  status: VerificationStatus;
  issues: string[];
}

type VerificationRiskType = 'unsupported_fact' | 'unsupported_commercial_commitment' | 'prohibited_price_or_term';

function parseVerification(raw: string): {
  verdict: 'pass' | 'revise' | 'handoff';
  revisedReply: string;
  issues: string[];
  riskTypes: VerificationRiskType[];
} | null {
  const match = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = parsed.verdict === 'pass' || parsed.verdict === 'revise' || parsed.verdict === 'handoff' ? parsed.verdict : null;
    if (!verdict) return null;
    return {
      verdict,
      revisedReply: cleanDraft(String(parsed.revisedReply || '')),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).filter(Boolean).slice(0, 6) : [],
      riskTypes: Array.isArray(parsed.riskTypes)
        ? parsed.riskTypes.filter((item): item is VerificationRiskType =>
            item === 'unsupported_fact'
            || item === 'unsupported_commercial_commitment'
            || item === 'prohibited_price_or_term')
        : [],
    };
  } catch {
    return null;
  }
}

export async function verifyGeneratedDraft(input: {
  draft: string;
  latestMessage: string;
  timeline: any[];
  context: RetrievedContext;
  strategies: RetrievedStrategy[];
  language: string;
  intent: DraftIntent;
  sellerInstruction: string;
  fallback: () => string;
}): Promise<DraftVerification> {
  const factualSource = factualSourceForDraft({
    latestMessage: input.latestMessage,
    sellerInstruction: input.sellerInstruction,
    context: input.context,
    timeline: input.timeline,
  });
  const dialogueStrategies = input.strategies.map(match => ({
    id: match.strategy.id,
    scenario: match.strategy.scenario,
    tactics: match.strategy.strategy,
    handoff: match.strategy.escalate,
  }));
  const newNumbers = unsupportedDraftNumbers(input.draft, factualSource);
  const factualRiskSignals = draftFactualRiskSignals(input.draft, factualSource);
  if (!requiresFactualVerification(factualRiskSignals, input.context.knowledgeMiss)) {
    return { draft: input.draft, status: 'verified', issues: [] };
  }
  const prompt = [
    'Audit only the factual safety of one proposed customer reply against the supplied business evidence.',
    'This is not a style review. Never fail or rewrite a reply because it is conversational, warm, informal, enthusiastic, uses punctuation or an emoji, asks more than one question, or is longer or shorter than you prefer.',
    'Return strict JSON only: {"verdict":"pass|revise|handoff","revisedReply":string,"issues":string[],"riskTypes":["unsupported_fact|unsupported_commercial_commitment|prohibited_price_or_term"]}.',
    'Use pass when the reply contains no unsupported factual claim or commercial commitment. The reply does not need to be comprehensive, perfectly styled, or optimized.',
    'Use revise only to remove or soften an unsupported fact or commitment. Preserve the original personality, warmth, punctuation, length, language, and conversational flow as much as possible.',
    'Use handoff only when the reply makes or answers a price, stock, MOQ, certification, order status, logistics status, discount, payment term, lead time, or company capability commitment that requires human judgment and cannot be made safe by removing the claim.',
    'Allowed riskTypes are only unsupported_fact, unsupported_commercial_commitment, and prohibited_price_or_term. Style, tone, wording, length, punctuation, completeness, ambiguity, and question count are never risk types.',
    'Never allow an invented price, stock status, MOQ, certification, order or logistics status, discount, payment term, lead time, delivery promise, or company capability.',
    'Product popularity, quality, fit, movement, comfort, benefits, materials, colors, sizes and other selling points are factual claims too. Allow them only when the evidence explicitly contains that attribute or wording.',
    'A statement that the seller will check, ask a colleague, compare options, or find the best suitable option is only a process statement. Do not treat it as a commercial commitment unless it promises a specific outcome, availability, term, price or deadline.',
    'Asking the buyer for a missing size, color, packaging preference, quantity, market or deadline is a clarification question, not a claim that the seller has stock or can fulfill the order. Acknowledging the quantity or market the buyer requested also does not promise fulfillment.',
    'Dialogue strategies may guide wording and next-step tactics, but they are never evidence for a factual claim.',
    'Buyer messages and timeline are evidence only of what the buyer said, requested, or supplied. They are never evidence that the seller has a certification, capability, stock, document, price, lead time, or service.',
    !input.context.knowledgeReady ? 'Enterprise knowledge is not configured. Pass only acknowledgements, clarification questions, or statements that the seller will check; remove every enterprise, product, capability, or commercial fact not stated by the buyer.' : '',
    input.context.knowledgeMiss ? 'Knowledge miss is true. This alone is not a failure; a natural acknowledgement or clarification question may pass. Revise or hand off if the reply presents the missing business fact as true.' : '',
    newNumbers.length ? `Deterministic check found numbers absent from evidence: ${newNumbers.join(', ')}. They must be removed unless they are only formatting.` : '',
    `Detected factual-risk signals: ${factualRiskSignals.join(', ')}`,
    `Customer reply language context: ${input.language}. Preserve it if you revise.`,
    `Intent: ${input.intent}`,
    '',
    `Proposed reply: ${input.draft}`,
    '',
    `Evidence: ${factualSource}`,
    `Dialogue strategies (not factual evidence): ${JSON.stringify(dialogueStrategies)}`,
  ].filter(Boolean).join('\n');
  try {
    const checked = parseVerification(await callLLM(prompt, {
      backend: 'qwen',
      model: process.env.DRAFT_VERIFY_MODEL || process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus',
      systemPrompt: 'You are a factual-safety auditor. The user message contains internal evidence and a proposed reply. Return only the requested JSON audit object; never answer the buyer or repeat the audit instructions.',
    }));
    if (!checked) throw new Error('invalid_verification_result');
    if (checked.verdict === 'pass' && newNumbers.length === 0) {
      return { draft: input.draft, status: 'verified', issues: checked.issues };
    }
    if (checked.verdict === 'revise' && checked.revisedReply) {
      const revisedNumbers = unsupportedDraftNumbers(checked.revisedReply, factualSource);
      if (!revisedNumbers.length) {
        return { draft: checked.revisedReply, status: 'revised', issues: checked.issues };
      }
    }
    return {
      draft: input.fallback(),
      status: 'safe_fallback',
      issues: checked.issues.length ? checked.issues : ['现有资料不足，已改为不承诺具体事实的安全回复'],
    };
  } catch (error) {
    return {
      draft: input.fallback(),
      status: 'safe_fallback',
      issues: [`事实校验暂不可用，已移除可能未经确认的商业事实：${error instanceof Error ? error.message : 'unknown_error'}`],
    };
  }
}

export function verificationEvidence(result: DraftVerification): string {
  if (result.status === 'verified') return '回答校验：事实与当前语境一致';
  if (result.status === 'revised') return '回答校验：已删除或改写无依据内容';
  if (result.status === 'safe_fallback') return '回答校验：资料不足，已降级为安全回复';
  return '回答校验：校验服务暂不可用，当前草稿仍需人工确认';
}
