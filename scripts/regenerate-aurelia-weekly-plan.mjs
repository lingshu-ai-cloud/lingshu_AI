import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STORE_ROOT = path.join(ROOT, 'data', 'local-store');
const TENANT_ID = 'local_tenant_customer_aurelia_beauty';
const GOAL_ID = 'weekly_goals_regenerated_20261016';
const PLAN_ID = 'weekly_plans_regenerated_20261016';
const RUN_ID = 'workflow_runs_regenerated_20261016';
const SOURCE_GOAL_ID = 'weekly_goals_ca62914538ff43fcb75205df90991ec6';
const SOURCE_PLAN_ID = 'weekly_plans_a3ec9738f5734035af28a2d502444a3f';
const SOURCE_RUN_ID = 'workflow_runs_d3188b29b9674a8984e40fa093116ed1';
const WEEK_START = '2026-10-13';
const WEEK_END = '2026-10-19';

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(STORE_ROOT, `${name}.json`), 'utf8'));
}

function write(name, value) {
  const file = path.join(STORE_ROOT, `${name}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function clone(value) {
  return structuredClone(value);
}

const goals = read('weekly_goals');
const plans = read('weekly_plans');
const runs = read('workflow_runs');
const workflowTasks = read('workflow_tasks');
const sourceGoal = goals.find(item => item.tenant_id === TENANT_ID && item.id === SOURCE_GOAL_ID);
const sourcePlan = plans.find(item => item.tenant_id === TENANT_ID && item.id === SOURCE_PLAN_ID);
const sourceRun = runs.find(item => item.tenant_id === TENANT_ID && item.id === SOURCE_RUN_ID);

if (!sourceGoal || !sourcePlan || !sourceRun?.id || !sourcePlan.plan?.businessPackage) {
  throw new Error('Aurelia 当前周任务记录不完整，未执行替换');
}

const now = new Date().toISOString();
const products = [
  { id: 'GUIANFA-RS-001', name: '云朵泡沫卸妆蜜' },
  { id: 'GUIANFA-RS-002', name: '紫苏控油去黑头泥膜 2.0' },
  { id: 'GUIANFA-RS-003', name: '积雪草屏障修护精华' },
  { id: 'GUIANFA-RS-004', name: '神经酰胺锁水面霜' },
];
const themes = [
  '3 秒质地测试：泡沫卸妆是否省步骤',
  '敏感肌清洁前后对比',
  '工厂灌装与质量控制',
  '低 MOQ 打样流程说明',
  '成分与肤感的采购判断',
  '包装定制与交付节点',
  '真实使用步骤演示',
  '品牌采购常见问题答疑',
];
const durations = [30, 30, 30, 30, 30, 30, 45, 45];
const platforms = ['tiktok', 'facebook', 'instagram', 'youtube'];
const accountIds = Object.fromEntries(platforms.map(platform => [platform, `local-${platform}-${TENANT_ID}`]));
const formats = {
  tiktok: ['native_short_video'],
  facebook: ['reel'],
  instagram: ['reel'],
  youtube: ['short'],
};
const thumbnails = [
  '/demo/feishu-viral-remix-final.jpg',
  '/demo/thumbs/7654315226526977288.jpg',
  '/demo/thumbs/7654672409370348814.jpg',
  '/demo/thumbs/7654680467647630605.jpg',
  '/demo/thumbs/7655363874128022806.jpg',
  '/demo/thumbs/7655425971251694855.jpg',
  '/demo/thumbs/7655426562682014989.jpg',
  '/demo/thumbs/7655435142575475981.jpg',
];
const publishHours = ['10:00', '14:00', '18:00', '20:00'];

const videoPlans = [];
for (let familyIndex = 0; familyIndex < themes.length; familyIndex += 1) {
  const familyId = `weekly-family-${String(familyIndex + 1).padStart(2, '0')}`;
  const masterContentId = `${familyId}-tiktok`;
  for (let platformIndex = 0; platformIndex < platforms.length; platformIndex += 1) {
    const platform = platforms[platformIndex];
    const product = products[familyIndex % products.length];
    const contentId = `${familyId}-${platform}`;
    const publishDay = 13 + ((familyIndex * platforms.length + platformIndex) % 7);
    const isMaster = platformIndex === 0;
    videoPlans.push({
      contentId,
      contentFamilyId: familyId,
      productionRole: isMaster ? 'master' : 'platform_adaptation',
      masterContentId,
      adaptationMode: isMaster ? 'master' : 'platform_native_cut',
      plannedPublishDate: `2026-10-${publishDay}`,
      plannedPublishAt: `2026-10-${publishDay}T${publishHours[platformIndex]}:00+08:00`,
      buyerProblem: '如何用真实产品证据快速判断产品与采购需求是否匹配？',
      evidenceRequirement: '使用企业已确认产品资料、实拍素材与可核验生产信息',
      directorStatus: 'script_approved',
      estimatedCost: isMaster ? 40 : 0,
      estimatedCostRange: isMaster
        ? { minCny: 37.5, maxCny: 45, basis: 'weekly_content_bundle' }
        : { minCny: 0, maxCny: 0, basis: 'included_platform_adaptation' },
      publication: {
        title: `${themes[familyIndex]}｜${product.name}`,
        caption: `${themes[familyIndex]}。结合真实产品素材与生产信息，帮助采购方快速判断合作匹配度。`,
        tags: [product.name, platform, '美妆供应链', '产品实测'],
        status: 'planned',
        generatedBy: 'business_agent',
      },
      planningEvidence: {
        generatedFrom: 'weekly_growth_plan',
        matrixAccountId: accountIds[platform],
        requiredCount: 8,
        slot: familyIndex + 1,
        referenceTitle: themes[familyIndex],
        referenceViews: '',
        referenceThumbnailUrl: thumbnails[familyIndex],
        referenceSourceUrl: '',
        benchmarkAccount: '',
        matchScore: 0,
        factors: ['本周重点产品方向', '四平台发布节奏', '内容结构已进入制作排期'],
      },
      matrix: {
        accountId: accountIds[platform],
        audience: '美妆品牌采购、产品经理与供应链负责人',
        objective: '以产品证据和工厂能力获取有效询盘',
        cta: '查看产品资料并提交合作需求',
        accountRole: 'brand_combined',
        formats: formats[platform],
      },
      route: familyIndex % 3 === 0 ? 'clone' : 'material',
      productId: product.id,
      productName: product.name,
      theme: themes[familyIndex],
      language: 'en',
      duration: durations[familyIndex],
      platform,
      materialIds: [],
      referenceId: '',
      presenter: familyIndex % 2 === 0 ? 'material' : 'digital_human',
      heygenAvatarId: '',
      avatarConsent: false,
      voice: 'v1',
    });
  }
}

const sourceBody = clone(sourcePlan.plan);
const sourcePackage = clone(sourceBody.businessPackage);
const productionTask = sourcePackage.tasks.find(task => task.templateId === 'production');
if (!productionTask) throw new Error('Aurelia 周计划缺少生产任务模板，未执行替换');
productionTask.videoPlans = videoPlans;
productionTask.title = '排期并制作 32 条产品视频';
productionTask.notes = '8 条母版内容形成 32 个平台版本，按本周发布节奏执行。';

sourcePackage.revision = Number(sourcePackage.revision || 0) + 1;
sourcePackage.participation = 'agent';
sourcePackage.matrixPlan = platforms.map(platform => ({
  accountId: accountIds[platform],
  connected: true,
  platform,
  accountRole: 'brand_combined',
  formats: formats[platform],
  audience: '美妆品牌采购、产品经理与供应链负责人',
  productName: products.map(item => item.name).join('、'),
  language: 'en',
  objective: '以产品证据和工厂能力获取有效询盘',
  contentDirection: '产品实测、工厂能力、打样流程与采购判断',
  cta: '查看产品资料并提交合作需求',
  weeklyCount: 8,
  sourceProjectIds: [],
}));
sourcePackage.directorPlan = {
  ...(sourcePackage.directorPlan || {}),
  currency: 'CNY',
  productionBudget: 320,
  productionBudgetMin: 300,
  productionBudgetMax: 360,
  paidMediaBudget: 1680,
  productionReserved: 320,
  productionSpent: 0,
  originalTarget: 8,
  platformVersionTarget: 32,
  publishTarget: 32,
  collectionBrief: '围绕产品实测、工厂能力、打样流程和采购判断组织本周内容。',
  qualityStandard: '产品主张有真实资料与素材支撑；平台版本、行动引导和发布节奏完整。',
  progress: [],
  productionBudgetMode: 'protected',
};
sourcePackage.authorization = {
  ...(sourcePackage.authorization || {}),
  mode: 'bounded',
  accountIds: platforms.map(platform => accountIds[platform]),
  maxPublishItems: 32,
  customerIds: [],
  maxCustomerMessages: 0,
};
sourcePackage.operatingContext = {
  ...(sourcePackage.operatingContext || {}),
  objective: '完成 32 条四平台产品内容排期，验证内容触达与采购询盘效率',
  metric: 'planned_content_versions：0 → 32 条',
  markets: ['美国'],
  cycle: { startsAt: WEEK_START, endsAt: WEEK_END },
  accounts: platforms.map(platform => ({
    accountId: accountIds[platform],
    platform,
    accountLabel: 'Aurelia 澄光美研有限公司',
    positioning: '产品实测、工厂能力与采购判断',
    contentCount: 8,
    budgetCny: 80,
    allocationBasis: 'content_load',
  })),
  budget: {
    currency: 'CNY',
    productionCny: 320,
    productionMinCny: 300,
    productionMaxCny: 360,
    paidMediaCny: 1680,
    totalCny: 2000,
    totalMinCny: 1980,
    totalMaxCny: 2040,
  },
  cadence: {
    contentCount: 32,
    description: '四个平台各 8 条，按周一至周日分时发布',
    reviewSchedule: '周五 17:30（北京时间）',
  },
  authorization: {
    mode: 'bounded',
    allowRealPublishing: false,
    allowRealCustomerMessages: false,
    accountIds: platforms.map(platform => accountIds[platform]),
    maxPublishItems: 32,
    maxCustomerMessages: 0,
  },
  outputs: {
    count: 32,
    originalCount: 8,
    platformVersionCount: 32,
    publishCount: 32,
    formats: ['产品实测短视频', '工厂能力短视频', '采购说明短视频'],
    totalDurationSeconds: 1080,
  },
};

const taskPlan = (sourceBody.tasks || []).map(task => ({ ...clone(task) }));
const trafficPlanTasks = [
  {
    key: 'paid_media_setup',
    title: '配置重点内容投流计划',
    description: '经营 Agent 为重点内容配置 Meta 与 TikTok 投流预算、目标人群、版位和排期，执行前保留人工确认。',
    agentRole: 'business',
    backgroundCapability: 'channel',
    kind: 'activation',
    sequence: 11,
    priority: 'high',
    requiresApproval: true,
    dependsOn: ['content_release_approval'],
    expectedMinutes: 8,
    businessDomain: 'advertising',
    capabilityKey: 'platform_ads',
    destination: 'adsManaged',
    statusSource: 'weekly_plans + platform ad tasks',
    executionMode: 'approval',
    externalEffect: 'paid_media',
    automaticExecutionAllowed: false,
    policySource: 'effective_runtime_policy',
  },
  {
    key: 'paid_media_review',
    title: '复核投流表现并调整预算',
    description: '经营 Agent 按内容触达、点击与询盘反馈复核投流表现，预算调整需人工确认。',
    agentRole: 'business',
    backgroundCapability: 'review',
    kind: 'review',
    sequence: 12,
    priority: 'medium',
    requiresApproval: true,
    dependsOn: ['paid_media_setup'],
    expectedMinutes: 6,
    businessDomain: 'advertising',
    capabilityKey: 'ads.optimization',
    destination: 'adsOverview',
    statusSource: 'platform ad reports',
    executionMode: 'approval',
    externalEffect: 'paid_media',
    automaticExecutionAllowed: false,
    policySource: 'effective_runtime_policy',
  },
];
for (const task of taskPlan) {
  if (task.key === 'weekly_review') {
    task.sequence = 13;
    task.dependsOn = ['platform_publish', 'paid_media_review'];
  }
}
const nextPlanTasks = [...taskPlan.filter(task => !trafficPlanTasks.some(candidate => candidate.key === task.key)), ...trafficPlanTasks]
  .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));

const nextGoal = {
  ...clone(sourceGoal),
  id: GOAL_ID,
  created: now,
  updated: now,
  title: 'Aurelia 四平台增长周计划',
  objective: '完成 32 条四平台产品内容排期，并验证重点内容的触达与采购询盘效率',
  metric: 'planned_content_versions',
  baseline: 0,
  target: 32,
  unit: '条',
  starts_at: WEEK_START,
  ends_at: WEEK_END,
  content_platforms: platforms,
  scope: {
    description: '美国',
    videoPlans,
    productionBudget: { currency: 'CNY', estimated: 320, min: 300, max: 360 },
    paidMediaBudget: { currency: 'CNY', total: 1680 },
    externalEffectsAllowed: false,
  },
  constraints: ['对外发布与真实投流必须审批'],
  status: 'active',
  version: 1,
  created_at: now,
  updated_at: now,
};

const nextPlan = {
  ...clone(sourcePlan),
  id: PLAN_ID,
  created: now,
  updated: now,
  goal_id: GOAL_ID,
  status: 'approved',
  created_at: now,
  updated_at: now,
  plan: {
    ...sourceBody,
    strategy: '以 8 条产品内容母版形成 32 个四平台版本，覆盖产品实测、工厂能力、打样流程与采购判断；同步配置发布和投流计划。',
    successCriteria: ['完成 32 条计划视频排期', '视频总时长 1080 秒', '制作预算控制在 300–360 元', '重点内容进入发布与投流审核'],
    estimatedCost: 320,
    tasks: nextPlanTasks,
    businessPackage: sourcePackage,
    packageApprovedBy: sourceGoal.owner_id,
    packageApprovedAt: now,
  },
};

const nextRun = {
  ...clone(sourceRun),
  id: RUN_ID,
  created: now,
  updated: now,
  goal_id: GOAL_ID,
  plan_id: PLAN_ID,
  status: 'waiting_human',
  current_controller: 'human',
  pause_reason: '周计划已生成，等待确认后执行',
  started_at: now,
  completed_at: '',
};

const workflowStatus = {
  context_readiness: 'succeeded',
  goal_decomposition: 'succeeded',
  scheduled_source_collection: 'succeeded',
  viral_analysis: 'pending',
};
const nextWorkflowTasks = nextPlanTasks.map(task => ({
  id: `workflow_tasks_regenerated_${task.key}`,
  created: now,
  updated: now,
  tenant_id: TENANT_ID,
  goal_id: GOAL_ID,
  plan_id: PLAN_ID,
  run_id: RUN_ID,
  task_key: task.key,
  title: task.title,
  description: task.description,
  agent_role: task.agentRole,
  kind: task.kind,
  status: workflowStatus[task.key] || 'pending',
  sequence: task.sequence,
  priority: task.priority,
  requires_approval: task.requiresApproval,
  depends_on: task.dependsOn || [],
  output: task.key === 'goal_decomposition'
    ? { objective: nextGoal.objective, target: 32, unit: '条', videoPlans }
    : {},
  blocked_reason: '',
  owner_id: '',
  business_domain: task.businessDomain,
  capability_key: task.capabilityKey,
  destination: task.destination,
  destination_view: task.destinationView || '',
  status_source: task.statusSource,
  execution_mode: task.executionMode,
  external_effect: task.externalEffect,
  automatic_execution_allowed: task.automaticExecutionAllowed,
  policy_source: task.policySource,
  business_refs: [],
  task_version: 1,
  correction_version: 0,
  created_at: now,
  updated_at: now,
}));

const replacedGoals = goals
  .filter(item => item.id !== GOAL_ID)
  .map(item => item.id === sourceGoal.id ? { ...item, status: 'cancelled', updated: now, updated_at: now } : item);
const replacedPlans = plans
  .filter(item => item.id !== PLAN_ID)
  .map(item => item.id === sourcePlan.id ? { ...item, status: 'superseded', updated: now, updated_at: now } : item);
const replacedRuns = runs
  .filter(item => item.id !== RUN_ID)
  .map(item => item.id === sourceRun.id ? { ...item, status: 'cancelled', completed_at: now, updated: now } : item);
const replacedTasks = workflowTasks.filter(item => item.run_id !== RUN_ID);

write('weekly_goals', [nextGoal, ...replacedGoals]);
write('weekly_plans', [nextPlan, ...replacedPlans]);
write('workflow_runs', [nextRun, ...replacedRuns]);
write('workflow_tasks', [...nextWorkflowTasks, ...replacedTasks]);

console.log(JSON.stringify({
  ok: true,
  goalId: GOAL_ID,
  planId: PLAN_ID,
  runId: RUN_ID,
  videoCount: videoPlans.length,
  durationSeconds: videoPlans.reduce((sum, item) => sum + item.duration, 0),
  productionBudget: { estimated: 320, min: 300, max: 360 },
  paidMediaBudget: 1680,
  workflowTaskCount: nextWorkflowTasks.length,
  replacedGoalId: sourceGoal.id,
}, null, 2));
