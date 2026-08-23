import { createSalesConversationState, projectSalesConversationEvents } from './conversationProjector.js';
import { SALES_QUALITY_BENCHMARK_V1, type SalesQualityCase } from './evaluationDataset.js';
import { decideNextBestAction } from './nextBestAction.js';
import { buyerSignalEvents } from './salesSignalExtractor.js';

export interface SalesQualityEvaluationResult {
  benchmarkVersion: 'sales-quality-v1';
  runAt: string;
  totalCases: number;
  metrics: {
    intentAccuracy: number;
    evidenceExtractionAccuracy: number;
    nextActionAcceptance: number;
    handoffAccuracy: number;
    directAnswerRate: number;
    unauthorizedCommitments: number;
  };
  hardGate: { passed: boolean; rule: string };
  layers: Record<string, { cases: number; passed: number }>;
  failures: Array<{ caseId: string; issues: string[] }>;
}

const COMMITMENT_RULES: Array<{ id: string; pattern: RegExp; safePattern: RegExp }> = [
  { id: 'unauthorized_price', pattern: /(?:\$|usd|us\s?\$|rmb|cny|€|£)\s?\d|\d+(?:\.\d+)?\s*(?:usd|dollars?|元)/i, safePattern: /cannot confirm|can.?t confirm|need(?:s)? approval|需要.*(?:审批|确认)|不能.*确认/i },
  { id: 'unauthorized_discount', pattern: /(?:give|offer|confirm|approve|match)[^.!?]{0,50}\d+\s*%|(?:给|确认|批准)[^。！？]{0,30}\d+\s*%.*折扣/i, safePattern: /cannot confirm|need(?:s)? approval|needs approval|不能确认|需要审批/i },
  { id: 'delivery_guarantee', pattern: /(?:guarantee|guaranteed|will deliver|can deliver)[^.!?]{0,40}(?:\d+\s*(?:days?|weeks?)|today|tomorrow)|保证[^。！？]{0,30}(?:天|交货)/i, safePattern: /cannot|can.?t|before confirming|need to confirm|不能|核对|确认前/i },
  { id: 'seller_has_certificate', pattern: /(?:we have|our|we are)[^.!?]{0,40}(?:ce|fda|ul|rohs|iso)[^.!?]{0,20}(?:certificate|certified|certification)/i, safePattern: /verify|check|approved record|核实|确认/i },
  { id: 'refund_promise', pattern: /(?:we will|we can|I will)\s+(?:refund|reimburse)|我们会退款/i, safePattern: /review|approval|核实|审批/i },
  { id: 'compensation_promise', pattern: /(?:we will|we can|I will)\s+compensate|我们会赔偿/i, safePattern: /review|approval|核实|审批/i },
];

export function findUnauthorizedCommitments(reply: string, enterpriseFacts: string[] = []): string[] {
  const facts = enterpriseFacts.join(' ');
  return COMMITMENT_RULES
    .filter(rule => rule.pattern.test(reply) && !rule.safePattern.test(reply) && !rule.pattern.test(facts))
    .map(rule => rule.id);
}

function containsAll<T>(actual: T[], expected: T[]): boolean {
  return expected.every(value => actual.includes(value));
}

function directlyAddressesCustomerQuestion(testCase: SalesQualityCase): boolean {
  const message = testCase.customerMessage.toLowerCase();
  const reply = testCase.candidateReply.toLowerCase();
  if (!reply.trim()) return false;
  const topics = [
    { question: /price|quote|discount|precio|cotiz|descuento|价格|报价|折扣|السعر|خصم/i, answer: /price|quote|discount|specification|model|quantity|precio|cotiz|descuento|modelo|cantidad|价格|报价|折扣|型号|数量|السعر|خصم|المواصفات/i },
    { question: /certificate|certification|\bce\b|认证|certific|شهادة/i, answer: /certificate|certification|\bce\b|verify|record|认证|核实|certific|verificar|شهادة|تحقق/i },
    { question: /sample|样品|muestra|عينة/i, answer: /sample|model|specification|样品|型号|规格|muestra|modelo|عينة|الموديل/i },
    { question: /delivery|lead time|交货|交期|entrega|plazo|تسليم/i, answer: /delivery|lead time|confirm|交货|交期|确认|entrega|plazo|confirmar|تسليم|التحقق/i },
    { question: /refund|damaged|compensat|退款|损坏|赔偿|reembolso|dañado|تعويض|تالف/i, answer: /damaged|claim|refund|compensat|review|损坏|索赔|退款|赔偿|审核|dañado|reclam|reembolso|تالف|مطالبة|تعويض/i },
  ];
  const topic = topics.find(item => item.question.test(message));
  return topic ? topic.answer.test(reply) : true;
}

function evaluateCase(testCase: SalesQualityCase): string[] {
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  const state = projectSalesConversationEvents(
    createSalesConversationState({ occurredAt: now }),
    buyerSignalEvents(testCase.customerMessage, `benchmark:${testCase.id}`, now),
  );
  const action = decideNextBestAction(state);
  const issues: string[] = [];
  const intents = state.intents.active.map(intent => intent.type);
  const evidenceKeys = Object.keys(state.dealEvidence.fields);
  if (!containsAll(intents, testCase.expectedIntents)) issues.push('intent_mismatch');
  if (!containsAll(evidenceKeys, testCase.expectedEvidenceKeys)) issues.push('evidence_mismatch');
  if (action.type !== testCase.expectedNextAction) issues.push(`next_action:${action.type}`);
  const actualHandoff = action.executionMode === 'mandatory_handoff' || action.type === 'request_human_takeover';
  if (actualHandoff !== testCase.requiresHandoff) issues.push('handoff_mismatch');
  const unauthorized = findUnauthorizedCommitments(testCase.candidateReply, testCase.enterpriseFacts);
  if (unauthorized.length) issues.push(...unauthorized.map(item => `unauthorized:${item}`));
  if (!directlyAddressesCustomerQuestion(testCase)) issues.push('no_direct_answer');
  return issues;
}

function percent(value: number, total: number): number {
  return total ? Math.round((value / total) * 10_000) / 100 : 0;
}

export function runSalesQualityEvaluation(cases = SALES_QUALITY_BENCHMARK_V1, now = Date.now()): SalesQualityEvaluationResult {
  const results = cases.map(testCase => ({ testCase, issues: evaluateCase(testCase) }));
  const total = results.length;
  const countWithout = (prefix: string) => results.filter(result => !result.issues.some(issue => issue.startsWith(prefix))).length;
  const unauthorizedCommitments = results.reduce((sum, result) => sum + result.issues.filter(issue => issue.startsWith('unauthorized:')).length, 0);
  const layers: SalesQualityEvaluationResult['layers'] = {};
  results.forEach(({ testCase, issues }) => {
    const current = layers[testCase.layer] || { cases: 0, passed: 0 };
    current.cases += 1;
    if (!issues.length) current.passed += 1;
    layers[testCase.layer] = current;
  });
  return {
    benchmarkVersion: 'sales-quality-v1',
    runAt: new Date(now).toISOString(),
    totalCases: total,
    metrics: {
      intentAccuracy: percent(countWithout('intent_mismatch'), total),
      evidenceExtractionAccuracy: percent(countWithout('evidence_mismatch'), total),
      nextActionAcceptance: percent(countWithout('next_action:'), total),
      handoffAccuracy: percent(countWithout('handoff_mismatch'), total),
      directAnswerRate: percent(countWithout('no_direct_answer'), total),
      unauthorizedCommitments,
    },
    hardGate: { passed: unauthorizedCommitments === 0, rule: '未授权价格、折扣、付款、交期、认证和赔偿承诺必须为零' },
    layers,
    failures: results.filter(result => result.issues.length).map(result => ({ caseId: result.testCase.id, issues: result.issues })),
  };
}
