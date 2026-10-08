import { normalizeVideoPlan, type VideoCreationPlan, videoPlanErrors } from '../../shared/contracts/videoCreationPlan.js';
import type { DigitalEmployeeConfig, PublishingPlatform, WeeklyGoalInput } from './domain.js';
import type { DirectorScriptContract } from '../../src/lib/directorScript.js';
import { platformExecutionConstraints } from '../../shared/contracts/socialOperatingProfile.js';
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS } from '../../shared/benchmarkAnalysis.js';

export type ContentRoute = 'clone' | 'product' | 'material';

export interface ContentRoutingEvidence {
  products: Array<{ id: string; name: string; materialIds: string[] }>;
  exactAnalysisIds: string[];
  materialIds: string[];
}

export interface ContentOrder extends Partial<DirectorScriptContract> {
  videoPlan?: VideoCreationPlan;
  /** Publish destinations derived from this master without another full render. */
  deliveryVariants?: Array<{
    contentId: string;
    platform: PublishingPlatform;
    accountId: string;
    accountLabel: string;
    plannedPublishDate: string;
    adaptationMode: 'master' | 'platform_light';
    publication?: VideoCreationPlan['publication'];
  }>;
  /** Frozen autonomous deliverable languages for this approved order. */
  languages?: string[];
  id: string;
  goalId: string;
  productId: string;
  productName: string;
  theme: { key: string; label: string };
  platform: PublishingPlatform;
  accountId: string;
  accountLabel: string;
  route: ContentRoute;
  configurationSnapshot: { configVersion: number; policyVersion: string; factsVersion: string };
  cta: string;
  constraints: string[];
  evidenceRefs: Array<{ type: 'exact_analysis' | 'enterprise_material'; id: string }>;
  status: 'planned';
}

export interface ContentBatchPlanDraft {
  status: 'planned' | 'blocked';
  orders: ContentOrder[];
  blocker: string;
  coverage?: ReturnType<typeof contentPlanCoverage>;
  eligibleRoutes: ContentRoute[];
  disabledRoutes: Array<{ route: ContentRoute; reason: string }>;
}

interface PriorReviewRoutingEvidence {
  priorRouteDistribution?: Partial<Record<ContentRoute, number>>;
  approvalFeedback?: Array<{ note?: string }>;
  contentInheritance?: {
    status?: string;
    title?: string;
    hook?: string;
    framework?: string[];
  };
  tagAdaptation?: {
    status?: string;
    newTags?: string[];
    droppedTags?: string[];
    requiresConfirmation?: boolean;
  };
  industryTrends?: {
    status?: string;
    signals?: Array<{ title?: string; sourceUrl?: string }>;
  };
}

const themes = [
  { key: 'buyer_problem', label: '客户痛点与解法' },
  { key: 'use_case', label: '应用场景与选择建议' },
  { key: 'product_evidence', label: '产品事实与可核验信息' },
];

export function enterpriseAssetStableId(productIndex: number, assetIndex: number, url: string): string {
  return `enterprise-product-${productIndex}-${assetIndex}-${Buffer.from(url).toString('base64url').slice(0, 12)}`;
}

function requestedCount(cadence: string): number {
  const match = String(cadence || '').match(/(?:每周|week)[^\d]{0,8}(\d{1,2})\s*(?:条|posts?)/i);
  return Math.max(1, Math.min(30, Number(match?.[1] || 3)));
}

export function contentPlanCoverage(config: DigitalEmployeeConfig, goal: WeeklyGoalInput, planned: number) {
  const cadence = String(config.socialCadence || '').match(/(?:每周|week)[^\d]{0,8}(\d{1,2})\s*(?:条|posts?)/i);
  const target = cadence ? Number(cadence[1]) : goal.metric === 'approved_content_packages' ? goal.target : planned;
  const missing = Math.max(0, target - planned);
  return { target, planned, missing, message: missing ? `本周独立内容计划覆盖 ${planned}/${target}，还缺 ${missing} 条；请补齐差异化制作计划或调整目标，平台分发次数不计为独立成片。` : `本周独立内容计划覆盖 ${planned}/${target}` };
}

function ctaFor(goal: DigitalEmployeeConfig['primaryGoal']): string {
  if (goal === 'awareness') return '提出一个与买家判断有关的讨论问题，邀请评论';
  if (goal === 'sales') return '联系业务人员确认真实产品与交付条件';
  if (goal === 'reactivation') return '回复消息说明当前需求是否有变化';
  return '私信说说当前选型需求，不承诺提供额外资料或方案';
}

function priorReviewConstraints(evidence?: PriorReviewRoutingEvidence): string[] {
  if (!evidence) return [];
  const constraints: string[] = [];
  const inheritance = evidence.contentInheritance;
  if (inheritance?.status === 'ready') {
    if (String(inheritance.title || '').trim()) constraints.push(`上轮优秀内容继承：复用「${String(inheritance.title).trim()}」的内容框架与钩子，但必须重新表达并更换镜头组合`);
    if (String(inheritance.hook || '').trim()) constraints.push(`上轮有效钩子候选：${String(inheritance.hook).trim()}`);
    if (Array.isArray(inheritance.framework) && inheritance.framework.length) constraints.push(`上轮有效结构候选：${inheritance.framework.slice(0, 8).join(' → ')}`);
  }
  const tags = evidence.tagAdaptation;
  if (tags?.status === 'changed' && Array.isArray(tags.newTags) && tags.newTags.length) {
    constraints.push(`热门 Tag 变化候选：${tags.newTags.slice(0, 8).map(tag => `#${String(tag).replace(/^#+/, '')}`).join(' ')}；用于验证新卖点关键词和选题，不得改写已确认产品事实`);
    if (tags.requiresConfirmation) constraints.push('采集范围变化需要人工确认；内容 Agent 只能先生成候选方案，不得静默扩大采集范围');
  }
  const signals = evidence.industryTrends?.status === 'available' && Array.isArray(evidence.industryTrends.signals)
    ? evidence.industryTrends.signals : [];
  if (signals.length) constraints.push(`行业热点候选：${signals.slice(0, 3).map(signal => String(signal.title || '').trim()).filter(Boolean).join('；')}；仅基于可追溯来源用于下一轮编导判断`);
  return constraints;
}

export function buildContentBatchPlan(input: {
  goalId: string;
  goal: WeeklyGoalInput;
  config: DigitalEmployeeConfig;
  evidence: ContentRoutingEvidence;
  versions: { configVersion: number; policyVersion: string; factsVersion: string };
  priorRoutingEvidence?: PriorReviewRoutingEvidence;
}): ContentBatchPlanDraft {
  const disabledRoutes: ContentBatchPlanDraft['disabledRoutes'] = [];
  const eligibleRoutes: ContentRoute[] = [];
  const enabled = new Set(input.config.enabledWorkflows);
  const productsWithMaterial = input.evidence.products.filter(product => product.materialIds.length > 0);
  const reviewConstraints = priorReviewConstraints(input.priorRoutingEvidence);
  if (input.goal.videoPlans?.length) {
    const orders: ContentOrder[] = [];
    const errors: string[] = [];
    const referenceErrors: string[] = [];
    input.goal.videoPlans.forEach((plan, index) => {
      const prefix = `第 ${index + 1} 条：`;
      const deferredMaterialErrors = /(?:请选择本条素材|数字人混剪需选择产品画面素材)/;
      errors.push(...videoPlanErrors(plan).filter(error => !deferredMaterialErrors.test(error)).map(error => prefix + error));
      if (plan.route !== 'clone') errors.push(prefix + '数字员工只执行爆款复刻；自由创作请由人工从内容制作发起');
      if (!enabled.has('viral_clone')) errors.push(prefix + '爆款复刻未在 Agent 配置中开启');
      const product = input.evidence.products.find(product => product.id === plan.productId)
        || input.evidence.products.find(product => product.name === plan.productName || product.id === plan.productName);
      if (!product) { errors.push(prefix + '指定产品不在重点产品资料中'); return; }
      const ids = plan.materialIds.length ? plan.materialIds : product.materialIds;
      if (ids.some(id => !product.materialIds.includes(id))) errors.push(prefix + '所选素材不存在或不属于指定产品');
      // A missing product visual is a per-master production readiness issue.
      // Keep the order so other masters in the same week can still run; the
      // storyboard preflight below reports the exact missing shot requirement.
      if (plan.route === 'clone' && !input.evidence.exactAnalysisIds.includes(plan.referenceId)) referenceErrors.push(prefix + '参考视频尚无有效精确分析');
      const account = input.config.publishingTargets.find(target => target.platform === plan.platform && (!plan.matrix || target.accountId === plan.matrix.accountId));
      if (!input.goal.contentPlatforms.includes(plan.platform)) errors.push(prefix + '制作平台不在本周目标范围中');
      if (plan.productionRole === 'platform_adaptation') return;
      const familyVariants = input.goal.videoPlans!.filter(candidate => (candidate.contentFamilyId || candidate.contentId) === (plan.contentFamilyId || plan.contentId));
      const deliveryVariants: NonNullable<ContentOrder['deliveryVariants']> = familyVariants.map((variant, variantIndex) => {
        const target = input.config.publishingTargets.find(item => item.platform === variant.platform && (!variant.matrix || item.accountId === variant.matrix.accountId));
        return {
          contentId: variant.contentId || `${plan.contentId || `content-${index + 1}`}-delivery-${variantIndex + 1}`,
          platform: variant.platform,
          accountId: target?.accountId || variant.matrix?.accountId || '',
          accountLabel: target?.accountLabel || (enabled.has('content_publish') ? '发布前待绑定账号' : '仅内容生产，不分发'),
          plannedPublishDate: variant.plannedPublishDate || '',
          adaptationMode: variant.productionRole === 'platform_adaptation' ? 'platform_light' : 'master',
          ...(variant.publication ? { publication: variant.publication } : {}),
        };
      });
      const frozenScript = plan.preproduction?.directorScript;
      const benchmarkStructureConstraints = plan.benchmarkAnalysis?.structure.map((step, structureIndex) => {
        const shots = step.shotIds.map(id => plan.benchmarkAnalysis?.shots.find(shot => shot.shotId === id)).filter(Boolean);
        const first = shots[0];
        return `参考结构 ${structureIndex + 1}：${MATERIAL_TYPE_LABELS[step.materialType]} / ${SHOT_ROLE_LABELS[step.narrativeRole]} / ${step.shotIds.length} 镜${first?.purpose ? `；作用：${first.purpose}` : ''}`;
      }) || [];
      const frozenVideoPlan = normalizeVideoPlan({ ...plan, productId: product.id, productName: product.name });
      orders.push({ id: `content_order_${index + 1}`, goalId: input.goalId, productId: product.id, productName: product.name,
        languages: plan.matrix ? [plan.language] : input.config.videoLanguages,
        theme: { key: 'user_selected', label: plan.theme }, platform: plan.platform, accountId: account?.accountId || '', accountLabel: account?.accountLabel || (enabled.has('content_publish') ? '发布前待绑定账号' : '仅内容生产，不分发'),
        route: plan.route, videoPlan: frozenVideoPlan, deliveryVariants, configurationSnapshot: input.versions, cta: plan.matrix?.cta || ctaFor(input.config.primaryGoal),
        constraints: [...new Set([...input.config.constraints, ...input.goal.constraints, ...reviewConstraints,
          ...familyVariants.flatMap(variant => platformExecutionConstraints(variant.platform).map(rule => `${variant.platform} 平台改编：${rule}`)),
          `本订单只生产 1 条原创母版；${deliveryVariants.length} 个平台发布版本共用母版，不得重复提交完整 AIGC 生成`,
          ...(plan.buyerProblem ? [`必须回答的买家问题：${plan.buyerProblem}`] : []),
          ...(plan.evidenceRequirement ? [`必须呈现并核验的证据：${plan.evidenceRequirement}`] : []),
          ...(plan.matrix?.objective ? [`账号本周目标：${plan.matrix.objective}`] : []),
          ...(plan.matrix?.accountRole ? [`账号定位：${plan.matrix.accountRole === 'brand_capability' ? '品牌与供应能力' : plan.matrix.accountRole === 'buyer_advisor' ? '买家顾问与采购教育' : '品牌综合账号'}`] : []),
          ...(plan.matrix?.formats?.length ? [`平台内容形式：${plan.matrix.formats.join('、')}`] : []),
          ...(benchmarkStructureConstraints.length ? ['素材调用必须严格按以下规范化结构顺序逐段匹配，不得合并或改写素材类别', ...benchmarkStructureConstraints] : []),
          ...(plan.reviewRequirements || []).map(r => `复盘分镜约束【${r.todoId}】：第1镜0–3秒；参考：${r.reference}；保留：${r.requirements}；素材：${r.materials}；验收：${r.acceptance}`)])],
        evidenceRefs: [...ids.map(id => ({ type: 'enterprise_material' as const, id })), ...(plan.route === 'clone' ? [{ type: 'exact_analysis' as const, id: plan.referenceId }] : [])], status: 'planned',
        ...(frozenScript && plan.preproduction?.readiness.canStart ? {
          contractVersion: 1 as const,
          scripts: { [frozenScript.language]: frozenScript },
        } : {}),
      });
    });
    // Every new Agent order is clone-only. A missing exact analysis blocks the
    // whole batch and returns to the Director instead of silently falling back
    // to product/material generation.
    errors.push(...referenceErrors);
    return { coverage: contentPlanCoverage(input.config, input.goal, errors.length ? 0 : orders.length), status: errors.length ? 'blocked' : 'planned', orders: errors.length ? [] : orders, blocker: errors.join('；'), eligibleRoutes: [...new Set(orders.map(order => order.route))], disabledRoutes: [...disabledRoutes, ...referenceErrors.map(reason => ({ route: 'clone' as const, reason }))] };
  }
  const missingProducts = input.evidence.products.filter(product => !product.materialIds.length);
  if (missingProducts.length) return { status: 'blocked', orders: [], blocker: `重点产品缺少素材：${missingProducts.map(product => product.name).join('、')}。请补充素材或逐条确认制作计划，不能自动替换产品。`, eligibleRoutes, disabledRoutes };

  if (enabled.has('viral_clone') && input.evidence.exactAnalysisIds.length && productsWithMaterial.length) eligibleRoutes.push('clone');
  else if (enabled.has('viral_clone')) disabledRoutes.push({ route: 'clone', reason: '缺少全片精确分析或真实产品，请由编导 Agent 补齐对标分析后重试' });
  if (enabled.has('product_content')) disabledRoutes.push({ route: 'product', reason: '自由创作仅供人工使用，数字员工不再创建产品生成任务' });
  if (enabled.has('material_content')) disabledRoutes.push({ route: 'material', reason: '自由创作仅供人工使用，数字员工不再创建素材生成任务' });

  const connectedTargets = input.config.publishingTargets.filter(target => input.goal.contentPlatforms.includes(target.platform));
  const targets = input.goal.contentPlatforms.map(platform => connectedTargets.find(target => target.platform === platform) || { platform, accountId: '', accountLabel: enabled.has('content_publish') ? '发布前待绑定账号' : '仅内容生产，不分发' });
  if (!eligibleRoutes.length) return { status: 'blocked', orders: [], blocker: disabledRoutes.map(item => `${item.route}：${item.reason}`).join('；') || '没有可执行的内容路径', eligibleRoutes, disabledRoutes };

  const count = requestedCount(input.config.socialCadence);
  const allocations = Array.from({ length: count }, () => 'clone' as const);
  const feedbackConstraints = (input.priorRoutingEvidence?.approvalFeedback || []).map(item => String(item.note || '').trim()).filter(Boolean).slice(0, 10).map(note => `审批反馈：${note}`);
  const orders: ContentOrder[] = Array.from({ length: count }, (_, index) => {
    const route = allocations[index]!;
    const product = productsWithMaterial[index % productsWithMaterial.length];
    const target = targets[index % targets.length];
    const theme = themes[index % themes.length];
    const productMaterial = { type: 'enterprise_material' as const, id: product.materialIds[index % product.materialIds.length] };
    const evidenceRefs: ContentOrder['evidenceRefs'] = route === 'clone'
      ? [{ type: 'exact_analysis', id: input.evidence.exactAnalysisIds[index % input.evidence.exactAnalysisIds.length] }, productMaterial]
      : [productMaterial];
    return {
      id: `content_order_${index + 1}`,
      languages: input.config.videoLanguages,
      goalId: input.goalId,
      productId: product.id,
      productName: product.name,
      theme,
      platform: target.platform,
      accountId: target.accountId,
      accountLabel: target.accountLabel,
      route,
      configurationSnapshot: input.versions,
      cta: ctaFor(input.config.primaryGoal),
      constraints: [...new Set([
        ...input.config.constraints,
        ...input.goal.constraints,
        ...input.goal.contentPlatforms.flatMap(platform => platformExecutionConstraints(platform).map(rule => `${platform} 平台改编：${rule}`)),
        ...feedbackConstraints,
        ...reviewConstraints,
      ])],
      evidenceRefs,
      status: 'planned',
    };
  });
  return { status: 'planned', orders, blocker: '', eligibleRoutes, disabledRoutes };
}
