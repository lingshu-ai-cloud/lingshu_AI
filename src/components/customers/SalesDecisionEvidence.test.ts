import assert from 'node:assert/strict';
import { buildSalesDecisionViewModel } from './SalesDecisionEvidence';

const handoff = buildSalesDecisionViewModel({
  handoffRequired: true,
  safeToSendBeforeHandoff: true,
  knowledgeMiss: true,
  missReason: '缺少已审批交期依据',
  replyConfidence: { level: 'bridge_only', score: 0.42, reason: '只能安全承接' },
  strategies: [{ id: 'S09', scenario: '先确认采购时间', confidence: 0.8, reason: '避免直接承诺交期' }],
  evidence: ['企业 FAQ #12', '企业 FAQ #12', '  '],
});

assert.equal(handoff.status, 'handoff');
assert.equal(handoff.confidenceLabel, '42% · bridge_only');
assert.equal(handoff.executionLabel, '可先发送安全承接话术，具体承诺仍需人工确认');
assert.equal(handoff.knowledgeReason, '缺少已审批交期依据');
assert.deepEqual(handoff.evidence, ['企业 FAQ #12']);
assert.deepEqual(handoff.strategies, [{ id: 'S09', title: '先确认采购时间', reason: '避免直接承诺交期' }]);

const grounded = buildSalesDecisionViewModel({
  replyConfidence: { level: 'high', score: 87, reason: '高置信命中企业知识' },
  evidence: ['MOQ 审批问答'],
});
assert.equal(grounded.status, 'grounded');
assert.equal(grounded.confidenceLabel, '87% · high');
assert.equal(grounded.knowledgeLabel, '引用 1 条判断依据');
assert.match(grounded.executionLabel, /发送流程/);

const review = buildSalesDecisionViewModel({ knowledgeMiss: true });
assert.equal(review.status, 'review');
assert.equal(review.knowledgeLabel, '企业知识未覆盖');

const structuredDecision = buildSalesDecisionViewModel({
  decision: {
    schemaVersion: 1,
    execution: 'human_required',
    handoff: { required: true, reason: '涉及正式报价', safeBridgeAllowed: false },
    knowledge: { ready: true, miss: false, safetyMode: 'grounded' },
    explanations: [{ summary: '涉及正式报价，必须人工确认', evidence: ['价格规则'] }],
  },
});
assert.equal(structuredDecision.status, 'handoff');
assert.equal(structuredDecision.executionLabel, '不得自动发送，需人工确认后回复');
assert.deepEqual(structuredDecision.evidence, ['涉及正式报价，必须人工确认', '价格规则']);

console.log('sales decision evidence tests passed');
