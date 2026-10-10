import assert from 'node:assert/strict';
import { evaluateDigitalEmployeeAcceptance, type DigitalEmployeeAcceptanceFacts } from './e2eAcceptance.js';

const base: DigitalEmployeeAcceptanceFacts = {
  tenantId: 'local_tenant_customer_e2e',
  runId: 'run-1',
  config: { id: 'config-1', status: 'active', config: { enabledWorkflows: ['content_publish'], allowRealPublishing: false, allowRealCustomerMessages: true } },
  enterpriseReady: true,
  productCount: 1,
  materialCount: 2,
  goal: { id: 'goal-1' },
  plan: { id: 'plan-1' },
  run: { id: 'run-1', status: 'waiting_external' },
  tasks: [
    'context_readiness', 'goal_decomposition', 'scheduled_source_collection', 'content_production', 'content_quality_gate', 'followup_batch_approval', 'weekly_review',
  ].map((task_key, index) => ({ id: `task-${index}`, task_key, status: 'succeeded' })),
  realSources: [{ id: 'source-1', sourceUrl: 'https://example.com/video' }],
  exactAnalyses: [{ id: 'source-1' }],
  completedProjects: [{ id: 'project-1' }],
  connectedPublishingAccounts: [],
  publishedReceipts: [],
  segments: [{ id: 'segment-1' }],
  batches: [{ id: 'batch-1' }],
  batchItems: [{ id: 'item-1', status: 'sent', provider_message_id: 'wamid.real-1' }],
  providerReady: true,
  realSendAuthorized: true,
  sendReceipts: [{ id: 'item-1', status: 'sent', provider_message_id: 'wamid.real-1' }],
  reviews: [{ id: 'review-1' }],
  syntheticRecords: [],
  requireExactVideoAnalysis: true,
  waiveWhatsAppRealSend: false,
  whatsAppWaiverReason: '',
};

const passed = evaluateDigitalEmployeeAcceptance(base);
assert.equal(passed.overall, 'passed');
assert.equal(passed.checks.find(item => item.key === 'publishing_safety')?.status, 'passed', 'no publishing account must be a truthful safe stop');

const noProvider = evaluateDigitalEmployeeAcceptance({ ...base, providerReady: false, realSendAuthorized: false, sendReceipts: [], batchItems: [{ id: 'item-1', status: 'approved', provider_message_id: '' }] });
assert.equal(noProvider.overall, 'blocked');
assert.equal(noProvider.checks.find(item => item.key === 'whatsapp_real_send')?.status, 'blocked');

const metaWaived = evaluateDigitalEmployeeAcceptance({
  ...base,
  providerReady: false,
  realSendAuthorized: false,
  sendReceipts: [],
  batchItems: [{ id: 'item-1', status: 'approved', provider_message_id: '' }],
  waiveWhatsAppRealSend: true,
  whatsAppWaiverReason: 'Meta 当前暂不可连接',
});
assert.equal(metaWaived.overall, 'passed');
assert.equal(metaWaived.checks.find(item => item.key === 'whatsapp_real_send')?.status, 'waived');
assert.match(metaWaived.waivers.join('\n'), /Meta 当前暂不可连接/);

const fakeSend = evaluateDigitalEmployeeAcceptance({ ...base, batchItems: [{ id: 'item-1', status: 'sent', provider_message_id: '' }], sendReceipts: [] });
assert.equal(fakeSend.overall, 'failed');
assert.match(fakeSend.failures.join('\n'), /provider_message_id/);

const fakePublish = evaluateDigitalEmployeeAcceptance({ ...base, publishedReceipts: [{ id: 'post-1', platform_post_id: 'provider-post-id' }] });
assert.equal(fakePublish.overall, 'failed');
assert.match(fakePublish.failures.join('\n'), /未连接发布账号/);

const synthetic = evaluateDigitalEmployeeAcceptance({ ...base, syntheticRecords: [{ type: 'studio_project', id: 'mock-project' }] });
assert.equal(synthetic.overall, 'failed');
assert.match(synthetic.failures.join('\n'), /mock\/demo\/fixture/);

const fakeSendCannotBeWaived = evaluateDigitalEmployeeAcceptance({
  ...base,
  batchItems: [{ id: 'item-1', status: 'sent', provider_message_id: '' }],
  sendReceipts: [],
  waiveWhatsAppRealSend: true,
  whatsAppWaiverReason: 'Meta 当前暂不可连接',
});
assert.equal(fakeSendCannotBeWaived.overall, 'failed');

const productPathWithoutExactAnalysis = evaluateDigitalEmployeeAcceptance({
  ...base,
  config: { id: 'config-1', status: 'active', config: { enabledWorkflows: ['product_content'], allowRealPublishing: false, allowRealCustomerMessages: true } },
  exactAnalyses: [],
  requireExactVideoAnalysis: false,
});
assert.equal(productPathWithoutExactAnalysis.checks.find(item => item.key === 'exact_video_analysis')?.status, 'passed');

console.log('digital employee e2e acceptance tests passed');
