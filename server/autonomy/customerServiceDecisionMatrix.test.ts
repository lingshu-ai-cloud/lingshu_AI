import assert from 'node:assert/strict';
import { decideAction, type AutonomyLevel } from './actionRules.js';
import { guardOutbound } from './outboundGuard.js';
import { customerServiceStatus } from '../routes/enterprise.js';
import { evaluateHandoff } from '../sales/handoff.js';
import { buildCustomerServiceDecision, executionForActionRisk } from '../customerService/decision.js';

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 19, 8, 0, 0);

function approvedFaq(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `faq-${index}`,
    question: `Question ${index}`,
    answer: `Grounded answer ${index}`,
    approvedForAuto: true,
  }));
}

function serviceStatus(input: {
  enabled?: boolean;
  elapsedHours?: number;
  permission?: boolean;
  faqCount?: number;
  autonomy?: AutonomyLevel;
}) {
  const permission = input.permission ?? false;
  return customerServiceStatus({
    customerService: {
      enabled: input.enabled ?? true,
      enabledAt: new Date(now - (input.elapsedHours ?? 96) * hour).toISOString(),
      partialAutoReplyEnabled: permission,
      partialAutoReplyDecision: permission ? 'enabled' : 'pending',
    },
    faq: approvedFaq(input.faqCount ?? 5),
    strategy: { aiAutonomy: input.autonomy ?? 'auto' },
  } as never, now);
}

// Activation is a fail-closed AND gate: time, explicit permission, approved knowledge,
// and configured autonomy are all required before a reply may even request auto mode.
const activationCases = [
  { name: 'master switch off', input: { enabled: false }, ready: false },
  { name: 'still in three-day observation', input: { elapsedHours: 71, permission: true }, ready: false },
  { name: 'permission not granted', input: { elapsedHours: 96, permission: false }, ready: false },
  { name: 'only four approved FAQs', input: { elapsedHours: 96, permission: true, faqCount: 4 }, ready: false },
  { name: 'operator returned to draft mode', input: { elapsedHours: 96, permission: true, autonomy: 'draft' as const }, ready: false },
  { name: 'all activation gates pass', input: { elapsedHours: 96, permission: true, faqCount: 5, autonomy: 'auto' as const }, ready: true },
];

for (const testCase of activationCases) {
  assert.equal(serviceStatus(testCase.input).autoReplyReady, testCase.ready, testCase.name);
}

// Risk/autonomy matrix. L1 only reminds; L4 never auto-sends. L2 auto is restricted
// to safe conversational drafts, while L3 represents the approved-FAQ lane.
const actionCases: Array<{
  name: string;
  action: string;
  autonomy: AutonomyLevel;
  risk: 'L1' | 'L2' | 'L3' | 'L4';
  decision: 'remind' | 'draft' | 'auto';
}> = [
  { name: 'L1 reminder stays non-sending', action: 'remind_silent_high_value', autonomy: 'auto', risk: 'L1', decision: 'remind' },
  { name: 'L2 greeting can auto only in auto mode', action: 'draft_greeting', autonomy: 'auto', risk: 'L2', decision: 'auto' },
  { name: 'L2 greeting is a draft in draft mode', action: 'draft_greeting', autonomy: 'draft', risk: 'L2', decision: 'draft' },
  { name: 'L2 logistics requires business evidence', action: 'auto_logistics_update', autonomy: 'auto', risk: 'L2', decision: 'draft' },
  { name: 'L3 approved FAQ can auto in auto mode', action: 'auto_faq_reply', autonomy: 'auto', risk: 'L3', decision: 'auto' },
  { name: 'L3 approved FAQ waits in draft mode', action: 'auto_faq_reply', autonomy: 'draft', risk: 'L3', decision: 'draft' },
  { name: 'L4 quotation always waits for a human', action: 'formal_quote', autonomy: 'auto', risk: 'L4', decision: 'draft' },
  { name: 'L4 payment terms always wait for a human', action: 'payment_terms', autonomy: 'auto', risk: 'L4', decision: 'draft' },
  { name: 'L4 complaint compensation always waits for a human', action: 'complaint_compensation', autonomy: 'auto', risk: 'L4', decision: 'draft' },
];

for (const testCase of actionCases) {
  const actual = decideAction(testCase.action, testCase.autonomy);
  assert.equal(actual.rule.risk, testCase.risk, `${testCase.name}: risk`);
  assert.equal(actual.decision, testCase.decision, `${testCase.name}: decision`);
}

assert.equal(executionForActionRisk('L1', 'auto', true), 'remind');
assert.equal(executionForActionRisk('L2', 'auto', true), 'auto_send');
assert.equal(executionForActionRisk('L3', 'draft', true), 'draft');
assert.equal(executionForActionRisk('L4', 'auto', true), 'human_required');

const explainedHandoff = buildCustomerServiceDecision({
  action: { id: 'formal_quote', risk: 'L4', description: '正式报价' },
  requestedAutonomy: 'auto',
  effectiveAutonomy: 'auto',
  execution: 'human_required',
  handoff: { required: true, reason: '正式价格需要销售确认', safeBridgeAllowed: true },
  knowledge: { ready: true, miss: false, safetyMode: 'grounded', fallbackCount: 0 },
  safety: { matchedRule: 'price_or_amount', guardAllowed: false, issues: ['未经确认的价格'] },
  explanations: [{ code: 'formal_quote_handoff', source: 'risk', severity: 'blocking', summary: '涉及正式报价，必须人工确认' }],
});
assert.equal(explainedHandoff.schemaVersion, 1);
assert.equal(explainedHandoff.handlingMode, 'human_needed');
assert.equal(explainedHandoff.handoff.safeBridgeAllowed, true);
assert.equal(explainedHandoff.explanations[0]?.code, 'formal_quote_handoff');

// An approved FAQ action must be downgraded unless the enterprise activation gate
// is ready. This mirrors the effective-autonomy boundary used by inbound handling.
for (const testCase of activationCases) {
  const status = serviceStatus(testCase.input);
  const effectiveAutonomy: AutonomyLevel = status.autoReplyReady ? 'auto' : 'draft';
  assert.equal(
    decideAction('auto_faq_reply', effectiveAutonomy).decision,
    testCase.ready ? 'auto' : 'draft',
    `approved FAQ / ${testCase.name}`,
  );
}

// Knowledge gaps and repeated fallback are capability failures: stop automation and
// transfer internally. A single unknown turn without a declared gap is not enough.
const knowledgeGap = evaluateHandoff({ message: 'Can you confirm this certificate?', knowledgeGap: true });
assert.equal(knowledgeGap.required, true);
assert.equal(knowledgeGap.stopAuto, true);
assert.ok(knowledgeGap.lines.includes('capability'));

const repeatedMiss = evaluateHandoff({ message: 'I still need an answer.', knowledgeMissStreak: 2 });
assert.equal(repeatedMiss.required, true);
assert.equal(repeatedMiss.stopAuto, true);
assert.ok(repeatedMiss.lines.includes('capability'));

const firstUnclassifiedMiss = evaluateHandoff({ message: 'I have another question.', knowledgeMissStreak: 1 });
assert.equal(firstUnclassifiedMiss.required, false, 'one miss alone may clarify safely before handoff');

// Even a route that is nominally eligible for auto-send must pass the final text
// guard. Safe grounded FAQ wording passes; commercial commitments fail closed.
const safeFaq = await guardOutbound('Yes, this model is available in blue. Which quantity do you need?');
assert.equal(safeFaq.allowed, true);

const guardedCommitments = [
  { text: 'The unit price is USD 2.50.', rule: 'price_or_amount' },
  { text: 'We guarantee delivery in 7 days.', rule: 'delivery_promise' },
  { text: 'Payment terms are T/T before shipment.', rule: 'payment_terms' },
  { text: 'We can give you 10% off.', rule: 'discount' },
];

for (const sample of guardedCommitments) {
  const guarded = await guardOutbound(sample.text);
  assert.equal(guarded.allowed, false, `must block: ${sample.text}`);
  assert.equal(guarded.matchedRule, sample.rule, `rule identity: ${sample.text}`);
}

// Current known classification ambiguity: the generic percentage discount rule is
// evaluated before payment terms, so a percentage deposit is safely blocked but may
// be labelled as a discount. Do not rely on matchedRule as a canonical risk category.
const percentageDeposit = await guardOutbound('Payment is 30% deposit and 70% before shipment.');
assert.equal(percentageDeposit.allowed, false);
assert.ok(percentageDeposit.matchedRule, 'percentage deposit must always be blocked');

// Explicit/high-value/risk handoff is stronger than the configured autonomy level.
for (const input of [
  { message: 'Please connect me with a person.', requestedHuman: true },
  { message: 'Give me your best price and confirm delivery date.' },
  { message: 'We need 5,000 bottles with OEM packaging and are ready to order.' },
]) {
  const handoff = evaluateHandoff(input);
  assert.equal(handoff.required, true, input.message);
  assert.equal(handoff.stopAuto, true, input.message);
}

console.log('customer service decision matrix passed');
