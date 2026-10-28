import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_CONFIG, completeConfig, configErrors, platformCountsFromCadence, primaryEnterpriseLanguage } from './digitalEmployeeConfigRules';

test('configuration completion restores safety approvals and a confirmed owner', () => {
  const completed = completeConfig({
    ...EMPTY_CONFIG,
    approvalOwner: ' ',
    enabledWorkflows: [],
    agentApprovalPolicies: { ...EMPTY_CONFIG.agentApprovalPolicies, content: { factualClaims: false, contentPublish: true } },
  });
  assert.equal(completed.approvalOwner, '企业管理员');
  assert.deepEqual(completed.enabledWorkflows, EMPTY_CONFIG.enabledWorkflows);
  assert.equal(completed.approvalPolicy.contentPublish, true);
  assert.equal(completed.agentApprovalPolicies.content.contentPublish, true);
});

test('publishing and follow-up cannot disable required human approval', () => {
  const errors = configErrors({
    ...EMPTY_CONFIG,
    companyName: '企业', industry: '行业', targetMarkets: '市场', customerProfile: '客户', approvalOwner: '管理员',
    approvalPolicy: { ...EMPTY_CONFIG.approvalPolicy, contentPublish: false, batchFollowup: false },
  });
  assert.equal(errors.contentPublish, '真实发布必须保留人工审批');
  assert.equal(errors.batchFollowup, '整批客户跟进必须保留人工审批');
});

test('legacy cadence fallback and enterprise language remain explicit', () => {
  assert.deepEqual(platformCountsFromCadence('', 5), { facebook: 3, linkedin: 3 });
  assert.equal(primaryEnterpriseLanguage('中文、英语'), '中文');
  assert.equal(primaryEnterpriseLanguage(''), '英语');
});
