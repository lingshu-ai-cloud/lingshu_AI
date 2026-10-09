import assert from 'node:assert/strict';
import {
  automaticExecutionAllowed,
  approvalRequiredFor,
  configurationSnapshot,
  enterpriseProfileFromKnowledgeBinding,
  knowledgeBindingFactState,
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
    factVersion: { id: 'enterprise-facts-v12-canonical', revision: 12, contentHash: 'canonical-hash' },
    company: { name: '知识库企业', industry: '机器人', mainMarkets: '美国', description: '仓储机器人' },
    strategy: { focusMarkets: '德国、法国', focusProducts: 'RB-100' },
    customers: { targetProfiles: '海外仓负责人' },
    products: { items: [{ sku: 'RB-100', name: '搬运机器人', material: '304 steel', images: [{ name: 'front', type: 'image/png', size: 12, updatedAt: '2026-09-04', url: '/api/overseas/enterprise/assets/rb-100.png' }] }, { sku: 'RB-200', name: '分拣机器人' }] },
  },
});

assert.equal(resolved.config.companyName, '知识库企业', 'enterprise knowledge must be the fact source');
assert.equal(resolved.config.targetMarkets, '德国、法国');
assert.equal(resolved.config.customerProfile, '海外仓负责人');
assert.equal(resolved.config.focusProducts, 'RB-100');
assert.equal(resolved.configVersion, 7);
assert.equal(resolved.knowledgeBinding.factsVersion, 'enterprise-facts-v12-canonical', 'digital employees must bind the canonical confirmed enterprise fact version');
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
const frozenProfile = enterpriseProfileFromKnowledgeBinding(snapshot.knowledgeBinding);
assert.equal(frozenProfile?.products?.items?.[0]?.material, '304 steel', 'the run snapshot must retain complete product facts, not only display labels');
assert.equal((frozenProfile?.products?.items?.[0]?.images as Array<{ url: string }> | undefined)?.[0]?.url, '/api/overseas/enterprise/assets/rb-100.png', 'the product asset facts used by production must be frozen with the version');
assert.equal(enterpriseProfileFromKnowledgeBinding(JSON.parse(JSON.stringify(snapshot.knowledgeBinding)))?.products?.items?.[0]?.name, '搬运机器人', 'the snapshot hash must survive its JSON storage round trip');
assert.equal(knowledgeBindingFactState(snapshot.knowledgeBinding, {
  factVersion: { id: 'enterprise-facts-v12-canonical' },
}), 'current');
assert.equal(knowledgeBindingFactState(snapshot.knowledgeBinding, {
  factVersion: { id: 'enterprise-facts-v13-canonical' },
}), 'stale', 'a new run must compare its saved binding to the canonical enterprise version');

const mismatchedBinding = structuredClone(snapshot.knowledgeBinding);
mismatchedBinding.enterpriseSnapshot.factsVersion = 'enterprise-facts-v13-canonical';
assert.equal(enterpriseProfileFromKnowledgeBinding(mismatchedBinding), null, 'a run must fail closed when the fact label and frozen payload disagree');

const relabeledPayload = structuredClone(snapshot.knowledgeBinding);
relabeledPayload.enterpriseSnapshot.profile.products!.items![0]!.name = '未更新版本标签的新名称';
assert.equal(enterpriseProfileFromKnowledgeBinding(relabeledPayload), null, 'a frozen payload cannot change while retaining the old fact label and snapshot hash');

const changedLiveProfile = structuredClone(frozenProfile!);
changedLiveProfile.products!.items![0]!.name = '当前资料中的新名称';
assert.equal(
  enterpriseProfileFromKnowledgeBinding(snapshot.knowledgeBinding)?.products?.items?.[0]?.name,
  '搬运机器人',
  'active-run facts remain unchanged when the live enterprise profile changes',
);

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

const changedSnapshotSameCanonicalVersion = resolveDigitalEmployeeConfiguration({
  configVersion: 7,
  config: resolved.config,
  enterpriseProfile: {
    factVersion: { id: 'enterprise-facts-v12-canonical', revision: 12, contentHash: 'canonical-hash' },
    company: { name: '内存中的陈旧名称' },
  },
});
assert.equal(
  changedSnapshotSameCanonicalVersion.knowledgeBinding.factsVersion,
  'enterprise-facts-v12-canonical',
  'downstream snapshots must retain the enterprise center fact version instead of minting a parallel version',
);

console.log('digital employee configuration tests passed');
