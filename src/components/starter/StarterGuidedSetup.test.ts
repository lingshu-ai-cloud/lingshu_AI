import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildGuidedStartInput,
  buildGuidedRecommendedPlan,
  buildInitialSetupPayload,
  guidedSetupMissingFacts,
  guidedSetupSubmissionReady,
  parseImportedProducts,
  recommendedProducts,
  recommendedWeeklyMasterCount,
  type GuidedPlanLimits,
  type GuidedSetupDraft,
} from './StarterGuidedSetup.js';

const products = parseImportedProducts('产品名称\n云朵泡沫卸妆蜜\n积雪草屏障修护精华, 氨基酸洁面慕斯\n云朵泡沫卸妆蜜');
assert.deepEqual(products, ['云朵泡沫卸妆蜜', '积雪草屏障修护精华', '氨基酸洁面慕斯']);
assert.deepEqual(recommendedProducts(products.join('\n')), ['云朵泡沫卸妆蜜', '积雪草屏障修护精华']);
assert.deepEqual(
  parseImportedProducts('产品名称,SKU,价格\n云朵泡沫卸妆蜜,CLOUD-01,99\n积雪草屏障修护精华,CICA-02,129'),
  ['云朵泡沫卸妆蜜', '积雪草屏障修护精华'],
  'CSV import must use the product-name column instead of treating SKU and price as products',
);
assert.deepEqual(
  parseImportedProducts('SKU,Product Name,Price\nCLOUD-01,"Cloud Cleanser, Sensitive",99\nCICA-02,Cica Serum,129'),
  ['Cloud Cleanser, Sensitive', 'Cica Serum'],
  'the product-name column must win even when SKU appears first and quoted names contain commas',
);

const limits: GuidedPlanLimits = {
  contentArtifactCountPerCycle: 5,
  primaryPlatformCount: 4,
  budgetCnyPerCycle: 100,
};
const draft: GuidedSetupDraft = {
  companyName: '澄光美研有限公司',
  brandName: 'Aurelia',
  industry: '美妆代工',
  primaryBusiness: '护肤品 OEM / ODM',
  targetMarkets: '美国、东南亚',
  customerProfile: '美妆品牌采购负责人',
  productSource: products.join('\n'),
  focusProduct: '积雪草屏障修护精华',
  presenter: 'product_expert',
  selectedPlatforms: ['tiktok', 'instagram', 'youtube', 'facebook'],
  accountWeeklyOutput: {},
  primaryLanguage: 'en',
  weeklyMasterCount: 5,
  constraints: '不得编造功效\n不得编造认证和交期',
};

const plan = buildGuidedRecommendedPlan(draft, limits);
assert.equal(plan.primaryProduct, '积雪草屏障修护精华');
assert.equal(
  buildGuidedRecommendedPlan({ ...draft, focusProduct: '氨基酸洁面慕斯' }, limits).primaryProduct,
  '氨基酸洁面慕斯',
  'the user may choose an imported product outside the two recommendations',
);
assert.equal(plan.platforms.length, 4);
assert.equal(plan.weeklyMasterCount, 5);
assert.equal(plan.weeklyVariantCount, 18, 'four-platform baseline must keep a stable 4–5 outputs per target platform');
assert.deepEqual(plan.platforms.map(item => item.weeklyOutput), [5, 5, 4, 4]);
const adjustedAccountPlan = buildGuidedRecommendedPlan({
  ...draft,
  accountWeeklyOutput: { tiktok: 4, instagram: 4, youtube: 4, facebook: 4 },
}, limits);
assert.deepEqual(adjustedAccountPlan.platforms.map(item => item.weeklyOutput), [4, 4, 4, 4]);
assert.equal(adjustedAccountPlan.weeklyVariantCount, 16, 'plan adjustment must keep each account cadence editable inside the plan card');
assert.deepEqual(plan.estimatedCostCny, { min: 50, max: 75 }, 'platform adaptation must not be billed again as a full master');
assert.equal(plan.deliveryDays, 7);
assert.match(plan.platforms[0]?.accountName || '', /澄光美研有限公司/);
assert.equal(plan.platforms[0]?.accountName, '澄光美研有限公司', 'the transport payload keeps each target platform scoped to the enterprise');
assert.equal(
  buildGuidedRecommendedPlan({ ...draft, focusProduct: '未导入产品' }, limits).primaryProduct,
  '云朵泡沫卸妆蜜',
  'a stale or forged focus product must fall back to an imported product',
);

const payload = buildInitialSetupPayload(draft, limits);
assert.equal(guidedSetupSubmissionReady(draft, limits), true);
assert.deepEqual(Object.keys(payload), [
  'companyName',
  'industry',
  'primaryBusiness',
  'focusProducts',
  'targetMarkets',
  'customerProfile',
  'primaryPlatform',
  'primaryLanguage',
  'constraints',
  'operatingPlan',
], 'guided cards must submit a structured, server-verifiable operating plan');
assert.equal(payload.focusProducts, '积雪草屏障修护精华');
assert.equal(payload.primaryPlatform, 'tiktok');
assert.ok(Array.isArray(payload.constraints));
assert.deepEqual(payload.constraints, ['不得编造功效', '不得编造认证和交期']);
assert.ok((payload.constraints as string[]).every(item => item.length <= 240));
assert.ok((payload.constraints as string[]).length <= 10);
assert.deepEqual(payload.operatingPlan, {
  brandName: 'Aurelia',
  presenter: 'product_expert',
  plannedAccounts: [
    { platform: 'tiktok', accountName: '澄光美研有限公司', weeklyOutput: 5 },
    { platform: 'instagram', accountName: '澄光美研有限公司', weeklyOutput: 5 },
    { platform: 'youtube', accountName: '澄光美研有限公司', weeklyOutput: 4 },
    { platform: 'facebook', accountName: '澄光美研有限公司', weeklyOutput: 4 },
  ],
  weeklyMasterCount: 5,
  weeklyVariantCount: 18,
  estimatedCostCny: { min: 50, max: 75 },
  deliveryDays: 7,
});
const startInput = buildGuidedStartInput(draft, limits);
assert.match(startInput, /开始制作/);
assert.match(startInput, /积雪草屏障修护精华/);
assert.match(startInput, /TikTok 的“澄光美研有限公司”计划每周 5 条/);
assert.match(startInput, /5 条母版并形成 18 条平台版本/);
assert.match(startInput, /¥50–75/);
assert.match(startInput, /账号连接、外部服务和素材权利必须在执行前按真实状态核验/);
assert.deepEqual(guidedSetupMissingFacts(draft, limits), []);
assert.deepEqual(guidedSetupMissingFacts({ ...draft, targetMarkets: '', customerProfile: '' }, limits), ['目标市场', '核心客户']);
assert.deepEqual(guidedSetupMissingFacts(draft, limits, false), ['灵小枢任务启动能力']);

const smallLimits: GuidedPlanLimits = {
  contentArtifactCountPerCycle: 2,
  primaryPlatformCount: 2,
  budgetCnyPerCycle: 20,
};
assert.equal(recommendedWeeklyMasterCount(smallLimits), 1, 'recommendation must fit both artifact and budget limits');
const constrainedPlan = buildGuidedRecommendedPlan({ ...draft, weeklyMasterCount: 5 }, smallLimits);
assert.equal(constrainedPlan.weeklyMasterCount, 1);
assert.equal(constrainedPlan.platforms.length, 2);
assert.deepEqual(constrainedPlan.estimatedCostCny, { min: 10, max: 15 });

const exhaustedPlan = buildGuidedRecommendedPlan({ ...draft, weeklyMasterCount: 5 }, {
  contentArtifactCountPerCycle: 0,
  primaryPlatformCount: 0,
  budgetCnyPerCycle: 0,
});
assert.equal(recommendedWeeklyMasterCount({ contentArtifactCountPerCycle: 5, primaryPlatformCount: 4, budgetCnyPerCycle: 14 }), 0);
assert.equal(exhaustedPlan.weeklyMasterCount, 0, 'zero content or budget quota must not silently create work');
assert.equal(exhaustedPlan.platforms.length, 0, 'zero platform quota must not silently select a target platform');
assert.equal(exhaustedPlan.weeklyVariantCount, 0);
assert.deepEqual(exhaustedPlan.estimatedCostCny, { min: 0, max: 0 });
assert.equal(guidedSetupSubmissionReady({ ...draft, industry: '' }, limits), false);
assert.throws(
  () => buildInitialSetupPayload({ ...draft, industry: '' }, limits),
  /guided_setup_not_ready/,
  'the canonical setup payload must never replace a missing business fact with placeholder data',
);
assert.equal(guidedSetupSubmissionReady(draft, { ...limits, budgetCnyPerCycle: 14 }), false);
assert.equal(
  recommendedWeeklyMasterCount({ ...limits, contentBudgetCnyPerCycle: 25 }),
  1,
  'the content Agent budget is a hard limit even when the overall cycle budget is larger',
);

const guidedSetupSource = fs.readFileSync(new URL('./StarterGuidedSetup.tsx', import.meta.url), 'utf8');
assert.match(guidedSetupSource, /灵小枢带你用 3 步完成开工准备/, '首次配置只允许三个输入步骤');
assert.doesNotMatch(guidedSetupSource, /id: 'plan'/, '推荐计划必须是三步输入后的结果卡，不得伪装成第四个输入步骤');
assert.match(guidedSetupSource, /role="dialog"[^>]*aria-labelledby="recommended-plan-title"/, '第三步后必须展示独立推荐计划卡');
assert.match(guidedSetupSource, /主推产品 \/ 市场 \/ 语言/);
assert.match(guidedSetupSource, /Agent 工作排期/);
assert.match(guidedSetupSource, /费用范围 \/ 预算上限/);
assert.match(guidedSetupSource, /预计交付时间/);
assert.match(guidedSetupSource, /连接状态待核验/, '平台计划必须与真实账号连接状态分开表达');
assert.match(guidedSetupSource, />调整计划<\/button>/);
assert.match(guidedSetupSource, /确认计划并开始制作/);
assert.match(guidedSetupSource, /还不能开始制作，请先补齐或恢复/, '缺失事实必须明确提示，不能静默禁用');
assert.doesNotMatch(guidedSetupSource, /<Bot\b/, '首次配置不得渲染一个假的 Bot 入口');

const actionSource = fs.readFileSync(new URL('./WorkspaceActionButtons.tsx', import.meta.url), 'utf8');
assert.match(actionSource, /setupStartAction/);
assert.match(actionSource, /await execute\(setupStartAction, \{ input: startInput \}/, '确认计划必须调用服务端下发的真实 orchestrator start action');
assert.match(actionSource, /return execute\(composerAction, payload/, '真实 start goal 后必须调用 canonical initial-setup command 固化资料并恢复队列');
assert.match(actionSource, /guided-plan-start-/);
assert.match(actionSource, /guided-plan-setup-/);

const workspaceSource = fs.readFileSync(new URL('./StarterWorkspacePage.tsx', import.meta.url), 'utf8');
assert.match(workspaceSource, /workspace\.controls\.find\(action => action\.command === 'submit_orchestrator_input'\)/, '不得由客户端凭空发明启动命令；必须使用服务端 control manifest');

console.log('starter guided setup tests passed');
