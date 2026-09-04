import assert from 'node:assert/strict';
import {
  automaticExecutionAllowed,
  approvalRequiredFor,
  configurationSnapshot,
  parseFollowupCadence,
  parseReviewSchedule,
  parseSocialCadence,
  resolveDigitalEmployeeConfiguration,
} from './configuration.js';

const resolved = resolveDigitalEmployeeConfiguration({
  configVersion: 7,
  boundAt: '2026-09-04T08:00:00.000Z',
  config: {
    companyName: '初始化旧名称',
    industry: '初始化旧行业',
    primaryBusiness: '初始化旧业务',
    targetMarkets: '初始化旧市场',
    customerProfile: '初始化旧客户',
    focusProducts: 'OLD-1',
    autonomyMode: 'managed',
    approvalOwner: '市场负责人',
    socialCadence: 'YouTube、TikTok；近 14 天；每天 08:30；每次最多 35 条；去重 60 天；每周生成 8 条发布草稿',
    followupCadence: '每周三 10:15 生成；16:30 前审批；客户当地工作日 08:00–17:00 发送；同一客户 10 天最多 1 次',
    reviewSchedule: '周四 18:20（Asia/Shanghai）；数据截止 18:00',
    agentApprovalPolicies: {
      business: { activatePlan: false, changeGoalScope: true },
      industry: { addUnverifiedSource: true, expandCollectionScope: false },
      content: { contentPublish: false, factualClaims: true },
      customer: { batchFollowup: false, commercialCommitment: false },
    },
  },
  enterpriseProfile: {
    company: { name: '知识库企业', industry: '机器人', mainMarkets: '美国', description: '仓储机器人' },
    strategy: { focusMarkets: '德国、法国', focusProducts: 'RB-100' },
    customers: { targetProfiles: '海外仓负责人' },
    products: { items: [{ sku: 'RB-100', name: '搬运机器人' }, { sku: 'RB-200', name: '分拣机器人' }] },
  },
});

assert.equal(resolved.config.companyName, '知识库企业', 'enterprise knowledge must be the fact source');
assert.equal(resolved.config.targetMarkets, '德国、法国');
assert.equal(resolved.config.customerProfile, '海外仓负责人');
assert.equal(resolved.config.focusProducts, 'RB-100');
assert.equal(resolved.configVersion, 7);
assert.equal(resolved.knowledgeBinding.references.products[0]?.sku, 'RB-100');
assert.equal(resolved.runtimePolicy.agents.industry.collection.time, '08:30');
assert.equal(resolved.runtimePolicy.agents.industry.collection.maxItems, 35);
assert.equal(resolved.runtimePolicy.agents.industry.collection.lookbackDays, 14);
assert.equal(resolved.runtimePolicy.agents.content.publishDraftsPerWeek, 8);
assert.equal(resolved.runtimePolicy.agents.customer.followup.draftWeekday, 3);
assert.equal(resolved.runtimePolicy.agents.customer.followup.localSendWindow.end, '17:00');
assert.equal(resolved.runtimePolicy.agents.business.review.weekday, 4);
assert.equal(resolved.runtimePolicy.agents.business.review.time, '18:20');
assert.equal(approvalRequiredFor(resolved.runtimePolicy, 'content', 'contentPublish'), true);
assert.equal(approvalRequiredFor(resolved.runtimePolicy, 'industry', 'addUnverifiedSource'), true);
assert.equal(resolved.runtimePolicy.agents.customer.approvals.commercialCommitment, true, 'commercial commitment must remain a hard approval boundary');
assert.equal(resolved.config.approvalPolicy.contentPublish, true, 'content publish must remain a hard approval boundary');
assert.equal(resolved.config.approvalPolicy.batchFollowup, true, 'batch follow-up must remain a hard approval boundary');

const snapshot = configurationSnapshot(resolved);
assert.equal(snapshot.configVersion, 7);
assert.equal(snapshot.configSnapshot.allowGeneratedVisuals, false, 'generated visuals consent must be frozen explicitly and default off');
assert.equal(snapshot.knowledgeBinding.factsVersion, resolved.knowledgeBinding.factsVersion);
assert.equal(snapshot.runtimePolicy.agents.industry.collection.maxItems, 35);

assert.deepEqual(parseSocialCadence('Instagram；每天 7:05；近 3 天；每次 9 条；每周 2 条'), {
  raw: 'Instagram；每天 7:05；近 3 天；每次 9 条；每周 2 条', platforms: ['instagram'], time: '07:05', lookbackDays: 3, maxItems: 9, dedupeDays: 30, draftsPerWeek: 2,
});
assert.equal(parseFollowupCadence('周一 09:30；同一客户 14 天 1 次').minContactGapDays, 14);
assert.equal(parseReviewSchedule('星期日 20:00（北京时间）').weekday, 0);

const suggest = resolveDigitalEmployeeConfiguration({
  config: { ...resolved.config, autonomyMode: 'suggest' },
  enterpriseProfile: { company: { name: '知识库企业', industry: '机器人', mainMarkets: '美国', description: '仓储机器人' } },
});
assert.equal(suggest.runtimePolicy.autonomy.allowInternalExecution, true, 'suggest mode must allow read-only analysis');
assert.equal(automaticExecutionAllowed(suggest.runtimePolicy, 'none'), true);
assert.equal(automaticExecutionAllowed(suggest.runtimePolicy, 'draft'), false);
assert.equal(automaticExecutionAllowed(suggest.runtimePolicy, 'schedule'), false);
assert.equal(automaticExecutionAllowed(suggest.runtimePolicy, 'publish'), false);
assert.equal(automaticExecutionAllowed(suggest.runtimePolicy, 'send'), false);

const changedFacts = resolveDigitalEmployeeConfiguration({
  configVersion: 7,
  config: resolved.config,
  enterpriseProfile: { ...resolved.knowledgeBinding.snapshot, company: { name: '新名称' } } as never,
});
assert.notEqual(changedFacts.knowledgeBinding.factsVersion, resolved.knowledgeBinding.factsVersion);

console.log('digital employee configuration tests passed');
