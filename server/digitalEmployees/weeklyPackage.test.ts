import { assessMaturity, normalizeAssessment, assessmentQuestions, type OperatingAssessment } from '../../src/lib/operatingMaturity.js';
import { planConfigForDisplay, type DigitalEmployeeConfig as ClientConfig } from '../../src/lib/digitalEmployees.js';
import assert from 'node:assert/strict';
import './contentPlanRecommendation.test.js';
import { recommendPackage, compilePackage, normalizePackage, repairCollapsedWeeklyVideoProduction, validatePackage, validatePackageForStart, grantCovers, packageConfig, criticalBusinessConfigChanges } from './weeklyPackage.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { estimateWeeklyMixedProduction } from '../../shared/contracts/weeklyMixedContentPlan.js';
import { fillMatrixVideos } from '../../src/lib/weeklyMatrix.js';
import { bindWeeklyImageProducts, bindWeeklyImageReferences } from './weeklyImageReferences.js';
const config = normalizeDigitalEmployeeConfig({ companyName: 'Test', industry: 'Tools', focusProducts: 'A', operatingMaturity: 'starting', publishingTargets: [{ platform: 'youtube', accountId: 'account-a', accountLabel: 'A' }] });
const goal = normalizeWeeklyGoal({ objective: '跑通首条发布', startsAt: '2026-09-06', endsAt: '2026-09-12', contentPlatforms: ['youtube'] }, config);
const pack = recommendPackage(goal, config);
const mixedConfig = normalizeDigitalEmployeeConfig({
  companyName: 'Aurelia', industry: 'Beauty', focusProducts: '产品 A',
  publishingTargets: [],
});
const mixedGoal = normalizeWeeklyGoal({ objective: '验证产品内容方向', startsAt: '2026-10-28', endsAt: '2026-11-03' }, mixedConfig);
const mixedPack = recommendPackage(mixedGoal, mixedConfig);
const mixedSlots = mixedPack.mixedContentSlots || [];
assert.equal(mixedSlots.length, 15, 'weekly package freezes all publication positions');
assert.equal(mixedSlots.filter(slot => slot.productionRole === 'original').length, 10, 'only ten productions are charged');
assert.equal(mixedSlots.filter(slot => slot.kind === 'image' && slot.productionRole === 'original').length, 4);
assert.equal(mixedPack.tasks.find(task => task.templateId === 'production')?.videoPlans?.length, 6);
assert.ok(mixedPack.tasks.find(task => task.templateId === 'production')?.videoPlans?.every(plan => !plan.matrix?.accountId),
  'creative production must not be attached to provisional publishing accounts');
const changedPublishingQuota = fillMatrixVideos({ ...mixedPack, matrixPlan: mixedPack.matrixPlan?.map(row => ({ ...row, weeklyCount: 1 })) }, mixedConfig.videoDefaults ?? {}, mixedGoal.endsAt);
assert.equal(changedPublishingQuota.tasks.find(task => task.templateId === 'production')?.videoPlans?.length, 6,
  'changing provisional account quotas must not change creative production count');
assert.equal(mixedPack.directorPlan?.paidMediaBudget, 10 * 36, 'Facebook media outline follows ten planned posts at US$5 each');
assert.equal(mixedPack.directorPlan?.productionBudgetMin, estimateWeeklyMixedProduction(mixedSlots).minCny,
  'new mixed plans keep the public-model estimate instead of a legacy per-video floor');
assert.equal(mixedPack.operatingContext?.outputs.count, 15);
assert.equal(mixedPack.operatingContext?.outputs.originalCount, 10);
assert.deepEqual(mixedPack.matrixPlan?.map(row => [row.platform, row.weeklyCount]), [['facebook', 5], ['facebook', 5], ['linkedin', 5]]);
assert.ok((mixedPack.operatingContext?.budget.productionMinCny || 0) >= 25, 'public price estimate includes the six video originals');
assert.ok((mixedPack.operatingContext?.budget.productionMaxCny || 0) > (mixedPack.operatingContext?.budget.productionMinCny || 0));
assert.deepEqual(normalizePackage(mixedPack).mixedContentSlots, mixedSlots, 'persisted package retains the mixed slots');
const imageBoundSlots = mixedSlots.map(slot => slot.kind === 'image' && slot.productionRole === 'original'
  ? { ...slot, referenceId: `image-${slot.slotId}`, referenceTitle: '爆款图文参考', referenceSourceUrl: 'https://example.com/post' }
  : slot);
assert.deepEqual(normalizePackage({ ...mixedPack, mixedContentSlots: imageBoundSlots }).mixedContentSlots, imageBoundSlots,
  'persisted package must retain validated image reference bindings');
const imagePlan = bindWeeklyImageReferences(bindWeeklyImageProducts(mixedPack, [
  { id: 'p1', name: '主推一' }, { id: 'p2', name: '主推二' }, { id: 'p3', name: '主推三' },
]), [1, 2, 3, 4].map(index => ({ id: `image-${index}`, contentFormat: 'image', status: 'analyzed',
  title: `参考 ${index}`, sourceUrl: `https://example.com/${index}`,
  aiAnalysis: { contentFormat: 'image', imageAnalysisStatus: 'analyzed', imageUrls: [`/image/${index}.png`],
    imageEvidence: { status: 'analyzed', observedFacts: ['产品'] } } })));
assert.deepEqual(normalizePackage(imagePlan).mixedContentSlots, imagePlan.mixedContentSlots,
  'persisted package retains each image product, reference and content theme');
assert.equal(repairCollapsedWeeklyVideoProduction(mixedPack).operatingContext?.outputs.count, 15, 'legacy video repair must not collapse mixed publication slots');
assert.equal(normalizePackage(mixedPack).directorPlan?.productionBudgetMin,
  mixedPack.directorPlan?.productionBudgetMin, 'legacy video repair must preserve the public mixed-cost quote');
assert.deepEqual(validatePackageForStart(mixedPack, mixedGoal, mixedConfig), [], 'missing social connections only defer publication');
assert.equal(pack.referenceSourcePolicy, 'existing_library_only', 'new plans prefer the existing viral library and must not create a collector');
assert.equal(normalizePackage(pack).referenceSourcePolicy, 'existing_library_only', 'the frozen plan retains its reference policy');
assert.equal(pack.matrixPlan?.length, 1, 'recommended packages create the deterministic account matrix immediately');
assert.equal(pack.matrixPlan?.[0].accountId, 'account-a');
assert.equal(pack.matrixPlan?.[0].platform, 'youtube');
assert.equal(pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.filter(plan => plan.matrix?.accountId === 'account-a').length, pack.matrixPlan?.[0].weeklyCount, 'weekly content is filled to the matrix target');
assert.equal(pack.authorization.mode, 'bounded', 'weekly package approval is the default bounded publish authorization');
assert.equal(pack.authorization.maxPublishItems, pack.matrixPlan?.reduce((sum, row) => sum + row.weeklyCount, 0));
assert.equal(pack.operatingContext?.objective, goal.objective, 'weekly package exposes the confirmed business objective');
assert.deepEqual(pack.operatingContext?.cycle, { startsAt: goal.startsAt, endsAt: goal.endsAt });
assert.equal(pack.operatingContext?.accounts[0]?.accountLabel, 'A', 'account assignment stays visible in the operating context');
assert.equal(pack.operatingContext?.accounts[0]?.contentCount, pack.matrixPlan?.[0].weeklyCount);
assert.equal(pack.operatingContext?.cadence.contentCount, pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.length);
assert.equal(pack.operatingContext?.outputs.count, pack.operatingContext?.cadence.contentCount);
assert.ok(pack.operatingContext?.outputs.formats.length, 'the package states its primary output formats');
assert.equal(pack.operatingContext?.authorization.mode, 'bounded');
assert.deepEqual(pack.operatingContext?.authorization.accountIds, ['account-a']);
const promotedVideoPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
const promotedContentId = promotedVideoPlans[0]?.contentId;
assert.ok(promotedContentId, 'recommended videos expose stable content identities for the promotion plan');
const promotedGoal = normalizeWeeklyGoal({
  ...goal,
  videoPlans: promotedVideoPlans,
  promotionPlans: [{ contentId: promotedContentId!, budgetCny: 120 }],
}, config);
const promotedPack = recommendPackage(promotedGoal, config);
assert.deepEqual(promotedPack.operatingContext?.promotionPlans, [{ contentId: promotedContentId!, budgetCny: 120 }], 'the confirmed per-video promotion plan must remain visible in the operating context');
assert.equal(promotedPack.directorPlan?.paidMediaBudget, 120, 'the confirmed promotion spend must become the paid-media budget');
assert.equal(promotedPack.operatingContext?.budget.totalMaxCny, (promotedPack.operatingContext?.budget.productionMaxCny || 0) + 120, 'the second confirmation total must include production and promotion spend');
const twoAccounts = recommendPackage(goal, normalizeDigitalEmployeeConfig({
  ...config,
  publishingTargets: [
    { platform: 'youtube', accountId: 'account-a', accountLabel: 'A' },
    { platform: 'youtube', accountId: 'account-b', accountLabel: 'B' },
  ],
}));
assert.equal(twoAccounts.authorization.maxPublishItems, twoAccounts.matrixPlan?.reduce((sum, row) => sum + row.weeklyCount, 0), 'the default bound covers actual account publish assignments');
const twoPlatformQuotaConfig = normalizeDigitalEmployeeConfig({
  ...config,
  socialCadence: '每周生成 2 条发布草稿；发布平台：facebook、tiktok；各平台条数：facebook=1,tiktok=1',
  publishingTargets: [
    { platform: 'facebook', accountId: 'facebook-one', accountLabel: 'Facebook', weeklyCount: 1 },
    { platform: 'tiktok', accountId: 'tiktok-one', accountLabel: 'TikTok', weeklyCount: 1 },
  ],
});
const twoPlatformQuotaGoal = normalizeWeeklyGoal({ ...goal, contentPlatforms: ['facebook', 'tiktok'] }, twoPlatformQuotaConfig);
const twoPlatformQuotaPackage = recommendPackage(twoPlatformQuotaGoal, twoPlatformQuotaConfig);
const twoPlatformQuotaPlans = twoPlatformQuotaPackage.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
assert.equal(twoPlatformQuotaPlans.length, 2, 'the server package must keep the two-item Agent quota');
assert.deepEqual(twoPlatformQuotaPlans.map(plan => plan.productionRole), ['master', 'master'], 'both requested videos must be independently produced');
assert.equal(new Set(twoPlatformQuotaPlans.map(plan => plan.contentFamilyId)).size, 2, 'the two requested videos must keep separate production identities');
assert.equal(twoPlatformQuotaPackage.directorPlan?.originalTarget, 2, 'the director target must equal the actual planned video count');
assert.equal(twoPlatformQuotaPackage.directorPlan?.platformVersionTarget, 2, 'the Agent delivery target must equal the actual planned video count');
assert.ok((twoPlatformQuotaPackage.directorPlan?.productionBudgetMin || 0) >= 20, 'the displayed budget must cover both actual video productions');
assert.equal(twoPlatformQuotaPackage.authorization.maxPublishItems, 2, 'publish authorization must use the same two-item quota');
assert.deepEqual(twoPlatformQuotaPackage.operatingContext?.accounts.map(account => [account.platform, account.contentCount]), [['facebook', 1], ['tiktok', 1]]);
const dateOnlyPackage = structuredClone(twoPlatformQuotaPackage);
const dateOnlyPlan = dateOnlyPackage.tasks.find(task => task.templateId === 'production')!.videoPlans![0]!;
dateOnlyPlan.plannedPublishDate = dateOnlyPackage.operatingContext!.cycle.startsAt;
dateOnlyPlan.plannedPublishAt = '';
const repairedDateOnlyPackage = repairCollapsedWeeklyVideoProduction(dateOnlyPackage);
assert.equal(repairedDateOnlyPackage.tasks.find(task => task.templateId === 'production')!.videoPlans![0]!.plannedPublishAt, '', 'a confirmed date-only plan must remain time-undecided without recursively repairing forever');
const collapsedHistoricPackage = structuredClone(twoPlatformQuotaPackage);
const collapsedPlans = collapsedHistoricPackage.tasks.find(task => task.templateId === 'production')!.videoPlans!;
collapsedPlans[1] = {
  ...collapsedPlans[1],
  contentFamilyId: collapsedPlans[0].contentFamilyId,
  productionRole: 'platform_adaptation',
  masterContentId: collapsedPlans[0].contentId,
  adaptationMode: 'platform_light',
};
collapsedHistoricPackage.directorPlan = {
  ...collapsedHistoricPackage.directorPlan!,
  productionBudgetMin: 10,
  productionBudget: 12.5,
  productionBudgetMax: 15,
};
const repairedHistoricPackage = normalizePackage(collapsedHistoricPackage);
const repairedHistoricPlans = repairedHistoricPackage.tasks.find(task => task.templateId === 'production')!.videoPlans!;
assert.deepEqual(repairedHistoricPlans.map(plan => plan.productionRole), ['master', 'master'], 'normalization must repair the historic cross-platform slot collapse before production');
assert.equal(new Set(repairedHistoricPlans.map(plan => plan.contentFamilyId)).size, 2, 'historic repair must restore one production identity per planned video');
assert.equal(repairedHistoricPlans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0), 25, 'historic repair must restore one full production estimate per video');
assert.ok((repairedHistoricPackage.directorPlan?.productionBudgetMin || 0) >= 20, 'historic repair must show the full cost range before confirmation');
const repairedHistoricProjection = repairCollapsedWeeklyVideoProduction(collapsedHistoricPackage);
assert.equal(repairedHistoricProjection.operatingContext?.budget.productionCny, 30, 'the pending-plan summary must expose the approved protected ceiling for two videos');
assert.equal(repairedHistoricProjection.operatingContext?.budget.totalMinCny, 20, 'the pending-plan summary must expose the two-video minimum estimate');
assert.equal(repairedHistoricProjection.operatingContext?.outputs.originalCount, 2, 'the pending-plan summary must report two actual productions');
assert.equal(repairedHistoricProjection.operatingContext?.accounts.reduce((sum, account) => sum + (account.budgetCny || 0), 0), 30, 'account allocations must add up to the approved protected production ceiling');
const staleCostPackage = structuredClone(twoPlatformQuotaPackage);
const staleCostPlans = staleCostPackage.tasks.find(task => task.templateId === 'production')!.videoPlans!;
staleCostPlans[1] = { ...staleCostPlans[1], estimatedCost: 0, estimatedCostRange: { minCny: 0, maxCny: 0, basis: 'included_platform_adaptation' } };
staleCostPackage.directorPlan = { ...staleCostPackage.directorPlan!, productionBudgetMin: 10, productionBudget: 12.5, productionBudgetMax: 15 };
staleCostPackage.operatingContext = {
  ...staleCostPackage.operatingContext!,
  budget: { ...staleCostPackage.operatingContext!.budget, productionMinCny: 10, productionCny: 12.5, productionMaxCny: 15, totalMinCny: 10, totalCny: 12.5, totalMaxCny: 15 },
};
const repairedStaleCostPackage = repairCollapsedWeeklyVideoProduction(staleCostPackage);
assert.equal(repairedStaleCostPackage.tasks.find(task => task.templateId === 'production')!.videoPlans!.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0), 25, 'already independent videos must not keep a stale one-video estimate');
assert.equal(repairedStaleCostPackage.operatingContext?.budget.totalMaxCny, 30, 'the dashboard cost range must cover every independently produced video');
assert.deepEqual(criticalBusinessConfigChanges(config, config), []);
assert.deepEqual(criticalBusinessConfigChanges(config, {
  ...config,
  focusProducts: 'B', targetMarkets: 'EU', customerProfile: 'distributors', videoLanguages: ['ar'],
  publishingTargets: [{ platform: 'facebook', accountId: 'account-b', accountLabel: 'B' }], allowRealPublishing: true,
}), ['products', 'markets', 'audience', 'languages', 'platforms', 'accounts', 'realPublishingPermission']);
assert.deepEqual(criticalBusinessConfigChanges(twoPlatformQuotaConfig, {
  ...twoPlatformQuotaConfig,
  publishingTargets: twoPlatformQuotaConfig.publishingTargets.map(target => ({ ...target, weeklyCount: (target.weeklyCount || 0) + 1 })),
}), ['weeklyPublishingQuota'], 'changing only the frozen weekly quota must invalidate the existing plan without duplicating an account-scope change');
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
const unknownDetailCost = normalizePackage({ ...pack, detailGeneration: { status: 'ready', startedAt: '2026-10-05T00:00:00Z', generatedAt: '2026-10-05T00:01:00Z', estimatedMinutes: 2, usageCostCny: null, readyCount: 1, blockedCount: 0, blockers: [] } });
assert.equal(unknownDetailCost.detailGeneration?.usageCostCny, null, 'unknown Agent usage must not normalize into a fabricated zero cost');
const overBudget = normalizePackage({ ...pack, directorPlan: { ...pack.directorPlan!, productionBudget: 100, productionBudgetMax: 100, productionSpent: 70, productionReserved: 40 } });
assert.ok(!validatePackage(overBudget, goal).some(issue => issue.includes('超过生产预算')), 'spent and reserved figures are reporting data, not a production gate');
const costly = structuredClone(pack); costly.directorPlan!.productionBudget = 10; costly.directorPlan!.productionBudgetMax = 10; costly.tasks.find(t => t.templateId === 'production')!.videoPlans![0].estimatedCost = 20;
assert.ok(!validatePackage(costly, goal).some(issue => issue.includes('预计费用')), 'a displayed estimate does not stop a weekly package');
const optimizedContext = compilePackage(costly, goal, config).businessPackage.operatingContext!;
assert.equal(optimizedContext.accounts.reduce((sum, account) => sum + (account.budgetCny || 0), 0), 10, 'account budgets exhaust the confirmed production budget');
assert.equal(optimizedContext.accounts[0]?.allocationBasis, 'content_load', 'shared master cost is allocated by each account publication load, not by whichever platform owns the master record');
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
const readinessDeferred = structuredClone(pack);
const deferredPlan = readinessDeferred.tasks.find(task => task.templateId === 'production')!.videoPlans![0]!;
deferredPlan.productId = '';
deferredPlan.productName = '';
deferredPlan.referenceId = '';
assert.ok(validatePackage(readinessDeferred, goal, config).some(issue => issue.startsWith('第 1 条视频：')), 'strict package review still reports per-video readiness');
assert.ok(!validatePackageForStart(readinessDeferred, goal, config).some(issue => issue.startsWith('第 1 条视频：')), 'run admission defers an affected video input to its production item');
const accountDeferredConfig = { ...config, publishingTargets: [] };
assert.ok(validatePackage(pack, goal, accountDeferredConfig).some(issue => issue.includes('矩阵账号')), 'strict review still reports disconnected publishing scope');
assert.ok(!validatePackageForStart(pack, goal, accountDeferredConfig).some(issue => issue.includes('矩阵账号')), 'publishing connectivity must not block production admission');
assert.ok(!validatePackageForStart(overBudget, goal, config).some(issue => issue.includes('超过生产预算')), 'production admission must not use the display estimate as a ceiling');
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

const productionOnlyPack = structuredClone(pack);
productionOnlyPack.tasks = productionOnlyPack.tasks.filter(task => task.templateId !== 'publishing');
if (productionOnlyPack.directorPlan) productionOnlyPack.directorPlan.publishTarget = 0;
assert.ok(!validatePackage(productionOnlyPack, goal, config).includes('发布次数目标不能少于平台交付版本目标'), 'production-only goals do not require external publishing targets');
const publishingPack = structuredClone(pack);
if (publishingPack.directorPlan) publishingPack.directorPlan.publishTarget = 0;
assert.ok(validatePackage(publishingPack, goal, config).includes('发布次数目标不能少于平台交付版本目标'), 'publishing goals retain the delivery-count guard');
