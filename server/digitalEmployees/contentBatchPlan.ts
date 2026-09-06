import { type VideoCreationPlan, videoPlanErrors } from '../../src/lib/videoCreationPlan.js';
import type { DigitalEmployeeConfig, PublishingPlatform, WeeklyGoalInput } from './domain.js';

export type ContentRoute = 'clone' | 'product' | 'material';

export interface ContentRoutingEvidence {
  products: Array<{ id: string; name: string; materialIds: string[] }>;
  exactAnalysisIds: string[];
  materialIds: string[];
}

export interface ContentOrder {
  videoPlan?: VideoCreationPlan;
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
  eligibleRoutes: ContentRoute[];
  disabledRoutes: Array<{ route: ContentRoute; reason: string }>;
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

function ctaFor(goal: DigitalEmployeeConfig['primaryGoal']): string {
  if (goal === 'awareness') return '提出一个与买家判断有关的讨论问题，邀请评论';
  if (goal === 'sales') return '联系业务人员确认真实产品与交付条件';
  if (goal === 'reactivation') return '回复消息说明当前需求是否有变化';
  return '私信说说当前选型需求，不承诺提供额外资料或方案';
}

export function buildContentBatchPlan(input: {
  goalId: string;
  goal: WeeklyGoalInput;
  config: DigitalEmployeeConfig;
  evidence: ContentRoutingEvidence;
  versions: { configVersion: number; policyVersion: string; factsVersion: string };
  priorRoutingEvidence?: { priorRouteDistribution?: Partial<Record<ContentRoute, number>>; approvalFeedback?: Array<{ note?: string }> };
}): ContentBatchPlanDraft {
  const disabledRoutes: ContentBatchPlanDraft['disabledRoutes'] = [];
  const eligibleRoutes: ContentRoute[] = [];
  const enabled = new Set(input.config.enabledWorkflows);
  const productsWithMaterial = input.evidence.products.filter(product => product.materialIds.length > 0);
  if (input.goal.videoPlans?.length) {
    const orders: ContentOrder[] = [];
    const errors: string[] = [];
    input.goal.videoPlans.forEach((plan, index) => {
      const prefix = `第 ${index + 1} 条：`;
      errors.push(...videoPlanErrors(plan).map(error => prefix + error));
      const workflow = { clone: 'viral_clone', product: 'product_content', material: 'material_content' }[plan.route];
      if (!enabled.has(workflow as DigitalEmployeeConfig['enabledWorkflows'][number])) errors.push(prefix + '此创作方式未在 Agent 配置中开启');
      const product = input.evidence.products.find(product => product.name === plan.productName || product.id === plan.productName);
      if (!product) { errors.push(prefix + '指定产品不在重点产品资料中'); return; }
      const ids = plan.materialIds.length ? plan.materialIds : product.materialIds;
      if (ids.some(id => !product.materialIds.includes(id))) errors.push(prefix + '所选素材不存在或不属于指定产品');
      if (!ids.length && plan.presenter === 'material' && plan.route !== 'product') errors.push(prefix + `${product.name} 缺少画面素材，请补充或明确选择数字人口播`);
      if (plan.route === 'clone' && !input.evidence.exactAnalysisIds.includes(plan.referenceId)) errors.push(prefix + '参考视频尚无有效精确分析');
      const account = input.config.publishingTargets.find(target => target.platform === plan.platform);
      if (!input.goal.contentPlatforms.includes(plan.platform)) errors.push(prefix + '制作平台不在本周目标范围中');
      if (enabled.has('content_publish') && !account) errors.push(prefix + '缺少已确认发布账号');
      orders.push({ id: `content_order_${index + 1}`, goalId: input.goalId, productId: product.id, productName: product.name,
        theme: { key: 'user_selected', label: plan.theme }, platform: plan.platform, accountId: account?.accountId || '', accountLabel: account?.accountLabel || '仅内容生产，不分发',
        route: plan.route, videoPlan: plan, configurationSnapshot: input.versions, cta: ctaFor(input.config.primaryGoal),
        constraints: [...new Set([...input.config.constraints, ...input.goal.constraints])],
        evidenceRefs: [...ids.map(id => ({ type: 'enterprise_material' as const, id })), ...(plan.route === 'clone' ? [{ type: 'exact_analysis' as const, id: plan.referenceId }] : [])], status: 'planned' });
    });
    return { status: errors.length ? 'blocked' : 'planned', orders: errors.length ? [] : orders, blocker: errors.join('；'), eligibleRoutes: [...new Set(orders.map(order => order.route))], disabledRoutes };
  }
  const missingProducts = input.evidence.products.filter(product => !product.materialIds.length);
  if (missingProducts.length) return { status: 'blocked', orders: [], blocker: `重点产品缺少素材：${missingProducts.map(product => product.name).join('、')}。请补充素材或逐条确认制作计划，不能自动替换产品。`, eligibleRoutes, disabledRoutes };

  if (enabled.has('viral_clone') && input.evidence.exactAnalysisIds.length && productsWithMaterial.length) eligibleRoutes.push('clone');
  else if (enabled.has('viral_clone')) disabledRoutes.push({ route: 'clone', reason: '缺少全片精确分析或真实产品' });
  if (enabled.has('product_content') && productsWithMaterial.length) eligibleRoutes.push('product');
  else if (enabled.has('product_content')) disabledRoutes.push({ route: 'product', reason: '缺少真实产品资料' });
  if (enabled.has('material_content') && productsWithMaterial.length) eligibleRoutes.push('material');
  else if (enabled.has('material_content')) disabledRoutes.push({ route: 'material', reason: '缺少真实企业素材或关联产品' });

  const connectedTargets = input.config.publishingTargets.filter(target => input.goal.contentPlatforms.includes(target.platform));
  if (input.config.enabledWorkflows.includes('content_publish') && !connectedTargets.length) {
    return { status: 'blocked', orders: [], blocker: '缺少本周目标平台对应的已确认发布账号', eligibleRoutes, disabledRoutes };
  }
  const targets = connectedTargets.length ? connectedTargets : input.goal.contentPlatforms.map(platform => ({ platform, accountId: '', accountLabel: '仅内容生产，不分发' }));
  if (!eligibleRoutes.length) return { status: 'blocked', orders: [], blocker: disabledRoutes.map(item => `${item.route}：${item.reason}`).join('；') || '没有可执行的内容路径', eligibleRoutes, disabledRoutes };

  const count = requestedCount(input.config.socialCadence);
  const allocationCounts: Record<ContentRoute, number> = {
    clone: Number(input.priorRoutingEvidence?.priorRouteDistribution?.clone || 0),
    product: Number(input.priorRoutingEvidence?.priorRouteDistribution?.product || 0),
    material: Number(input.priorRoutingEvidence?.priorRouteDistribution?.material || 0),
  };
  const allocations = Array.from({ length: count }, () => {
    const route = eligibleRoutes.slice().sort((left, right) => allocationCounts[left] - allocationCounts[right] || eligibleRoutes.indexOf(left) - eligibleRoutes.indexOf(right))[0]!;
    allocationCounts[route] += 1;
    return route;
  });
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
      constraints: [...new Set([...input.config.constraints, ...input.goal.constraints, ...feedbackConstraints])],
      evidenceRefs,
      status: 'planned',
    };
  });
  return { status: 'planned', orders, blocker: '', eligibleRoutes, disabledRoutes };
}
