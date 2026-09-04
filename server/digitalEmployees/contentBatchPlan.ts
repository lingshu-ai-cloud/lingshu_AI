import type { DigitalEmployeeConfig, PublishingPlatform, WeeklyGoalInput } from './domain.js';

export type ContentRoute = 'clone' | 'product' | 'material';

export interface ContentRoutingEvidence {
  products: Array<{ id: string; name: string; materialIds: string[] }>;
  exactAnalysisIds: string[];
  materialIds: string[];
}

export interface ContentOrder {
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
  if (goal === 'awareness') return '查看企业官方资料了解更多';
  if (goal === 'sales') return '联系业务人员确认真实产品与交付条件';
  if (goal === 'reactivation') return '回复消息获取最新资料';
  return '私信获取详细方案';
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
