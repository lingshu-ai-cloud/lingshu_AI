import { assessMaturity, normalizeAssessment, assessmentQuestions, type OperatingAssessment } from '../../src/lib/operatingMaturity.js';
import { planConfigForDisplay, type DigitalEmployeeConfig as ClientConfig } from '../../src/lib/digitalEmployees.js';
import assert from 'node:assert/strict';
import { recommendPackage, compilePackage, normalizePackage, validatePackage, grantCovers, packageConfig, criticalBusinessConfigChanges } from './weeklyPackage.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
const config = normalizeDigitalEmployeeConfig({ companyName: 'Test', industry: 'Tools', focusProducts: 'A', operatingMaturity: 'starting', publishingTargets: [{ platform: 'youtube', accountId: 'account-a', accountLabel: 'A' }] });
const goal = normalizeWeeklyGoal({ objective: '跑通首条发布', startsAt: '2026-09-06', endsAt: '2026-09-12', contentPlatforms: ['youtube'] }, config);
const pack = recommendPackage(goal, config);
assert.equal(pack.matrixPlan?.length, 1, 'recommended packages create the deterministic account matrix immediately');
assert.equal(pack.matrixPlan?.[0].accountId, 'account-a');
assert.equal(pack.matrixPlan?.[0].platform, 'youtube');
assert.equal(pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.filter(plan => plan.matrix?.accountId === 'account-a').length, pack.matrixPlan?.[0].weeklyCount, 'weekly content is filled to the matrix target');
assert.equal(pack.authorization.mode, 'bounded', 'weekly package approval is the default bounded publish authorization');
assert.equal(pack.authorization.maxPublishItems, pack.matrixPlan?.reduce((sum, row) => sum + row.weeklyCount, 0));
const twoAccounts = recommendPackage(goal, normalizeDigitalEmployeeConfig({
  ...config,
  publishingTargets: [
    { platform: 'youtube', accountId: 'account-a', accountLabel: 'A' },
    { platform: 'youtube', accountId: 'account-b', accountLabel: 'B' },
  ],
}));
assert.equal(twoAccounts.authorization.maxPublishItems, twoAccounts.matrixPlan?.reduce((sum, row) => sum + row.weeklyCount, 0), 'the default bound covers actual account publish assignments');
assert.deepEqual(criticalBusinessConfigChanges(config, config), []);
assert.deepEqual(criticalBusinessConfigChanges(config, {
  ...config,
  focusProducts: 'B', targetMarkets: 'EU', customerProfile: 'distributors', videoLanguages: ['ar'],
  publishingTargets: [{ platform: 'facebook', accountId: 'account-b', accountLabel: 'B' }], allowRealPublishing: true,
}), ['products', 'markets', 'audience', 'languages', 'platforms', 'accounts', 'realPublishingPermission']);
assert.deepEqual(pack.tasks.map(t => t.templateId), ['readiness', 'director', 'production', 'publishing', 'customers', 'followup', 'review']);
assert.ok(pack.directorPlan, 'recommended packages include a director plan');
assert.equal(pack.directorPlan?.originalTarget, pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.length);
assert.ok(packageConfig(pack, config).enabledWorkflows.includes('scheduled_social'));
assert.ok(packageConfig(pack, config).enabledWorkflows.includes('viral_clone'));
assert.equal(validatePackage(pack, goal).length, 0);
const withoutProduction = normalizePackage({ ...pack, matrixPlan: undefined, directorPlan: undefined, tasks: pack.tasks.filter(t => t.templateId !== 'production') });
assert.ok(validatePackage(withoutProduction, goal).some(s => s.includes('已有作品')));
withoutProduction.tasks.find(t => t.templateId === 'publishing')!.sourceProjectIds = ['real-project'];
assert.equal(validatePackage(withoutProduction, goal).length, 0);
const compiled = compilePackage(withoutProduction, goal, config);
assert.ok(!compiled.tasks.some(t => t.key === 'content_production'));
assert.ok(compiled.tasks.some(t => t.key === 'platform_publish'));
for (const task of compiled.tasks) for (const dep of task.dependsOn) assert.ok(compiled.tasks.some(t => t.key === dep));
assert.ok(packageConfig(pack, config).enabledWorkflows.includes('batch_followup'), 'starting stage must retain eligible customer followup');
const scoped = normalizePackage({ ...pack, authorization: { mode: 'bounded', accountIds: ['account-a'], maxPublishItems: 2, customerIds: ['customer-a'], maxCustomerMessages: 1 } });
assert.deepEqual(scoped.directorPlan, pack.directorPlan, 'director budgets and targets persist through normalization');
const overBudget = normalizePackage({ ...pack, directorPlan: { ...pack.directorPlan!, productionBudget: 100, productionSpent: 70, productionReserved: 40 } });
assert.ok(validatePackage(overBudget, goal).some(issue => issue.includes('超过生产预算')));
const costly = structuredClone(pack); costly.directorPlan!.productionBudget = 10; costly.tasks.find(t => t.templateId === 'production')!.videoPlans![0].estimatedCost = 20;
assert.ok(validatePackage(costly, goal).some(issue => issue.includes('预计费用')));
const wrongTarget = structuredClone(pack); wrongTarget.directorPlan!.originalTarget = 2; wrongTarget.directorPlan!.platformVersionTarget = 2; wrongTarget.directorPlan!.publishTarget = 2;
assert.ok(validatePackage(wrongTarget, goal).some(issue => issue.includes('与编导目标')));
const multilingual = structuredClone(pack); multilingual.directorPlan!.platformVersionTarget = 1; multilingual.directorPlan!.publishTarget = 2;
assert.ok(validatePackage(multilingual, goal, { ...config, videoLanguages: ['en', 'es'] }).some(issue => issue.includes(`将生成 ${pack.directorPlan?.originalTarget || 0} 个版本`)), 'business targets must match the versions handed to the director');
assert.ok(grantCovers(scoped, 'publish', ['account-a'], 2, '2026-09-08', goal.endsAt));
assert.ok(!grantCovers(scoped, 'publish', ['account-b'], 1, '2026-09-08', goal.endsAt));
assert.ok(!grantCovers(scoped, 'publish', ['account-a'], 3, '2026-09-08', goal.endsAt));
assert.ok(!grantCovers(scoped, 'publish', ['account-a'], 1, '2026-09-13', goal.endsAt));
assert.ok(!grantCovers(scoped, 'send', ['customer-b'], 1, '2026-09-08', goal.endsAt));
assert.ok(grantCovers(pack, 'publish', ['account-a'], 1, '2026-09-08', goal.endsAt));
assert.ok(!grantCovers({ ...pack, authorization: { ...pack.authorization, mode: 'each' } }, 'publish', ['account-a'], 1, '2026-09-08', goal.endsAt));
const legacyPackage = normalizePackage({
  ...pack,
  tasks: [
    ...pack.tasks.filter(task => task.templateId !== 'director'),
    { templateId: 'collection', title: '旧采集任务', ownerId: '', ownerName: '', dueAt: goal.endsAt, notes: '采集范围', sourceProjectIds: [] },
    { templateId: 'inspiration', title: '旧灵感任务', ownerId: '', ownerName: '', dueAt: goal.endsAt, notes: '筛选依据', sourceProjectIds: [] },
  ],
} as unknown as typeof pack);
assert.equal(legacyPackage.tasks.filter(task => task.templateId === 'director').length, 1, 'legacy collection and inspiration tasks migrate into one director task');
assert.match(legacyPackage.tasks.find(task => task.templateId === 'director')!.notes, /采集范围/);
assert.match(legacyPackage.tasks.find(task => task.templateId === 'director')!.notes, /筛选依据/);
const prematureGrowth = validatePackage(pack, goal, { ...config, socialOperatingProfile: 'dual_account_growth' });
assert.ok(prematureGrowth.some(issue => issue.includes('稳定经营')));
assert.ok(prematureGrowth.some(issue => issue.includes('tiktok')));
const late = structuredClone(pack); late.tasks[0].dueAt = '2026-09-13'; assert.ok(validatePackage(late, goal).length);
const team = recommendPackage(goal, { ...config, defaultParticipation: 'team' }, 'member-a', 'Alice');
assert.equal(team.tasks.find(t => t.templateId === 'production')?.ownerId, 'member-a');
assert.equal(team.tasks.find(t => t.templateId === 'review')?.ownerId, '');
console.log('Weekly package dependency, recommendation, assignment and authorization tests passed');

const current = { ...config, allowRealPublishing: true, allowRealCustomerMessages: true } as ClientConfig;
const legacy = { companyName: 'Legacy' } as ClientConfig;
const display = planConfigForDisplay(legacy, current);
assert.deepEqual(display.publishingTargets, []);
assert.deepEqual(display.enabledWorkflows, []);
assert.equal(display.allowRealPublishing, false);
assert.equal(display.allowRealCustomerMessages, false);
assert.deepEqual(planConfigForDisplay(undefined, current).publishingTargets, current.publishingTargets);
console.log('Legacy plan configuration compatibility tests passed');

const noDeliveryAccounts = normalizePackage({ ...pack, matrixPlan: undefined, authorization: { mode: 'bounded', accountIds: [], customerIds: [], maxPublishItems: 0, maxCustomerMessages: 0 } });
assert.deepEqual(validatePackage(noDeliveryAccounts, goal), [], 'missing delivery accounts must not block package start');
assert.equal(grantCovers(noDeliveryAccounts, 'publish', ['unknown'], 1, '2026-09-08', goal.endsAt), false, 'missing scope still cannot authorize a real publication');
const full = recommendPackage(goal, { ...config, operatingMaturity: 'established' });
const independent = compilePackage(full, goal, config);
const deps = (key: string): string[] => { const direct = independent.tasks.find(t => t.key === key)?.dependsOn || []; return [...direct, ...direct.flatMap(deps)]; };
assert.ok(!deps('customer_segmentation').includes('platform_publish'), 'customer preparation must not wait for publication');
assert.ok(!deps('followup_batch_draft').includes('platform_publish'), 'customer drafts must not wait for publication');
console.log('Independent branch startup tests passed');

// Stage assessment uses prerequisites rather than an additive score.
assert.equal(assessMaturity(undefined).maturity, null);
const evidence: OperatingAssessment = { answers: Object.fromEntries(assessmentQuestions.map(q => [q.id, { value: 'yes', evidence: '过去四周记录与本轮具体调整实例' }])), gaps: [] };
assert.equal(assessMaturity(evidence).maturity, 'established');
const missingFoundation = structuredClone(evidence); missingFoundation.answers.audience!.value = 'no';
assert.equal(assessMaturity(missingFoundation).maturity, 'starting', 'advanced tools and metrics cannot offset unclear audience');
assert.ok(assessMaturity(missingFoundation).gaps.includes('unclear_audience'));
const missingProof = structuredClone(evidence); missingProof.answers.attribution!.evidence = '';
assert.equal(assessMaturity(missingProof).maturity, 'growing', 'advanced stage requires concrete evidence');
const unknownFoundation = structuredClone(evidence); unknownFoundation.answers.cadence!.value = 'unknown';
assert.equal(assessMaturity(unknownFoundation).maturity, null);
assert.deepEqual(normalizeAssessment({ answers: { cadence: { value: 'invalid', evidence: ' x ' }, invented: { value: 'yes' } }, gaps: ['missing_assets', 'bad', 'missing_assets'] }), { answers: { cadence: { value: 'unknown', evidence: 'x' } }, gaps: ['missing_assets'] });
const assessedConfig = normalizeDigitalEmployeeConfig({ ...config, operatingAssessment: evidence });
assert.deepEqual(assessedConfig.operatingAssessment, evidence);
const assessedPack = recommendPackage(goal, assessedConfig);
assert.deepEqual(normalizePackage(assessedPack).operatingAssessment, evidence);
assert.equal(assessedPack.maturity, 'starting', 'assessment suggestion must not silently override chosen stage');
const growing = recommendPackage(goal, { ...config, operatingMaturity: 'growing' });
assert.notEqual(growing.tasks.find(t => t.templateId === 'review')!.notes, full.tasks.find(t => t.templateId === 'review')!.notes);
assert.notEqual(compilePackage(growing, goal, config).strategy, independent.strategy);
assert.notDeepEqual(compilePackage(growing, goal, config).successCriteria, independent.successCriteria);
const gapsPack = recommendPackage(goal, { ...config, operatingAssessment: { answers: {}, gaps: ['missing_assets', 'unclear_source'] } });
assert.match(gapsPack.tasks.find(t => t.templateId === 'production')!.notes, /素材不足/);
assert.match(compilePackage(gapsPack, goal, config).tasks.find(t => t.key === 'content_production')!.description, /素材不足/);
const contentOnly = recommendPackage({ ...goal, businessLine: 'content_growth' }, config);
assert.ok(!contentOnly.tasks.some(t => ['customers', 'followup'].includes(t.templateId)), 'stage must respect business scope');
const customersOnly = recommendPackage({ ...goal, businessLine: 'customer_conversion' }, config);
assert.ok(customersOnly.tasks.some(t => t.templateId === 'followup'));
assert.ok(!customersOnly.tasks.some(t => t.templateId === 'production'));
console.log('Maturity assessment, persistence, differentiated strategies and scope tests passed');

assert.equal(assessMaturity({ ...evidence, gaps: ['missing_handoff'] }).maturity, 'growing', 'declared gaps must not contradict advanced recommendation');
assert.equal(assessMaturity({ ...evidence, gaps: ['unstable_publishing'] }).maturity, 'starting');
