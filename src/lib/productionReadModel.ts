import type {
  ProductionAllowedCommand,
  ProductionIdentityGuarantee,
  ProductionIdentityLevel,
  ProductionReadModelV1,
  ProductionReadStatus,
  ProductionRouteKind,
  ProductionShotReadModelV1,
} from '../../shared/contracts/productionReadModel';
import { PRODUCTION_READ_MODEL_SCHEMA } from '../../shared/contracts/productionReadModel';

export type StudioBatchRoutePlan = {
  shotId: string;
  slotId: string;
  order: number;
  visualTopic: 'presenter' | 'factory' | 'product' | 'usage_scene' | 'other';
  expressionPurpose: string;
  route: 'digital_human' | 'local_material' | 'seedance_action' | 'aigc_first_frame' | 'unresolved';
  status: 'matched' | 'needs_material' | 'needs_plan' | 'blocked';
  matchedMaterialId: string | null;
  matchedProductId?: string | null;
  matchedProductIdentityLevel?: 'exact' | 'category' | 'none' | null;
  matchedSegmentId: string | null;
  trimStart: number | null;
  trimEnd: number | null;
  reason: string;
  generated: false;
};

export type StudioAigcShotCostPlan = {
  shotId: string;
  status: 'ready' | 'unsupported' | 'budget_excluded';
  targetDurationSeconds: number;
  resolutionTier?: '480p' | '720p' | null;
  modelId?: string | null;
  estimatedCostCny: number;
  estimatedVideoCostCny?: number;
  estimatedFirstFrameCostCny?: number;
  estimatedGeometryObservationCostCny?: number;
};

export type StudioAigcBudgetPreview = {
  planningOnly: true;
  modelId: string;
  totalShots: number;
  aigcShots: number;
  aigcShotRatio: number;
  candidateDurationSeconds: 4;
  maxRetries: number;
  estimate480pCny: number;
  estimate720pCny: number;
  batchBudgetCny: number;
  recommendedResolution: '480p' | '720p';
  budgetEnoughFor480p: boolean;
  shotPlans?: StudioAigcShotCostPlan[];
  readyShots?: number;
  excludedShots?: number;
  estimatedCostCny?: number;
  budgetRemainingCny?: number;
};

export type StudioBatchShotRoutesResponse = {
  projectId: string;
  planningOnly: true;
  routes: StudioBatchRoutePlan[];
  counts: Record<string, number>;
  aigcBudgetPreview?: StudioAigcBudgetPreview;
};

/** UI projection shared by canonical social tasks and the Studio route-plan fallback. */
export type ProductionReadView = {
  source: 'canonical_task' | 'studio_route_plan';
  project: {
    id: string;
    version: string | null;
    studioProjectId: string | null;
    studioProjectVersion: string | null;
    title: string;
  };
  aggregate: ProductionReadModelV1['aggregate'];
  shots: ProductionShotReadModelV1[];
  updatedAt: string | null;
};

const routeLabels: Record<StudioBatchRoutePlan['route'], string> = {
  digital_human: '数字人制作',
  local_material: '素材剪辑',
  seedance_action: '人物动作重建',
  aigc_first_frame: 'AIGC 首帧与视频',
  unresolved: '路线待确认',
};

const routeKinds: Record<StudioBatchRoutePlan['route'], ProductionRouteKind> = {
  digital_human: 'digital_human',
  local_material: 'material_edit',
  seedance_action: 'aigc_visual',
  aigc_first_frame: 'aigc_visual',
  unresolved: 'unknown',
};

const statusByStudioRoute: Record<StudioBatchRoutePlan['status'], ProductionReadStatus> = {
  matched: 'ready',
  needs_material: 'needs_input',
  needs_plan: 'planning',
  blocked: 'blocked',
};

const emptyIdentity = (): ProductionIdentityGuarantee => ({
  overall: 'not_required',
  product: 'not_required',
  presenter: 'not_required',
  requiresQa: false,
  basis: [],
});

function identityForRoute(route: StudioBatchRoutePlan): ProductionIdentityGuarantee {
  const productRequired = route.visualTopic === 'product' || route.visualTopic === 'usage_scene';
  if (route.route === 'local_material' && route.matchedMaterialId) {
    const exactProduct = productRequired
      && Boolean(route.matchedProductId)
      && route.matchedProductIdentityLevel === 'exact';
    const product = productRequired ? exactProduct ? 'exact_source' : 'unverified' : 'not_required';
    // A generic local clip is executable editing input, but its presence does
    // not prove who is on screen. Presenter identity needs a separate durable
    // authorization/identity contract, which this legacy route does not have.
    const presenter = route.visualTopic === 'presenter' ? 'unverified' : 'not_required';
    const levels = [product, presenter].filter(level => level !== 'not_required');
    const overall = levels.includes('unverified') ? 'unverified'
      : levels.includes('exact_source') ? 'exact_source' : 'not_required';
    return {
      overall,
      product,
      presenter,
      requiresQa: false,
      basis: [exactProduct
        ? `采用已持久绑定产品 ${route.matchedProductId} 的精准素材`
        : productRequired ? '已有素材可执行剪辑，但缺少持久产品绑定或 exact 身份元数据'
          : presenter === 'unverified' ? '已有素材可执行剪辑，但未提供可核验的人物身份契约'
            : '采用服务端确认的已有素材；本镜头不要求产品或人物身份'],
    };
  }
  if (route.route === 'digital_human') {
    const assetReady = route.status === 'matched';
    return {
      overall: assetReady ? 'locked_reference' : 'unverified',
      product: productRequired ? 'unverified' : 'not_required',
      presenter: assetReady ? 'locked_reference' : 'unverified',
      requiresQa: true,
      basis: [assetReady ? '企业人物资产锁定；生成结果仍需质检' : '人物资产尚未就绪，不能声明身份已锁定'],
    };
  }
  if (route.route === 'aigc_first_frame' || route.route === 'seedance_action') {
    return {
      overall: 'qa_gated',
      product: productRequired ? 'qa_gated' : 'not_required',
      presenter: route.visualTopic === 'presenter' ? 'qa_gated' : 'not_required',
      requiresQa: true,
      basis: ['生成结果须通过逐镜质检'],
    };
  }
  return emptyIdentity();
}

function costForRoute(route: StudioBatchRoutePlan, preview?: StudioAigcBudgetPreview) {
  const plan = preview?.shotPlans?.find(item => item.shotId === route.shotId);
  if (!plan || route.route !== 'aigc_first_frame') {
    return {
      currency: 'CNY' as const,
      expectedCny: null,
      upperBoundCny: null,
      actualCny: null,
      unsettledCny: null,
      status: route.route === 'local_material' ? 'free' as const : 'unknown' as const,
      reusable: route.route === 'local_material',
      basis: 'unavailable' as const,
    };
  }
  const oneAttempt = [
    plan.estimatedVideoCostCny,
    plan.estimatedFirstFrameCostCny,
    plan.estimatedGeometryObservationCostCny,
  ].every(value => Number.isFinite(value))
    ? Number(plan.estimatedVideoCostCny) + Number(plan.estimatedFirstFrameCostCny) + Number(plan.estimatedGeometryObservationCostCny)
    : null;
  return {
    currency: 'CNY' as const,
    expectedCny: oneAttempt == null ? null : Math.round(oneAttempt * 100) / 100,
    upperBoundCny: Number.isFinite(plan.estimatedCostCny) ? Math.max(0, plan.estimatedCostCny) : null,
    actualCny: null,
    unsettledCny: null,
    status: 'estimated' as const,
    reusable: false,
    basis: 'execution_plan' as const,
  };
}

function inputKind(route: StudioBatchRoutePlan): 'material' | 'presenter_asset' | 'other' {
  if (route.status === 'needs_material') return 'material';
  if (route.route === 'digital_human') return 'presenter_asset';
  return 'other';
}

function aggregateIdentity(shots: ProductionShotReadModelV1[]): ProductionIdentityGuarantee {
  const productLevels = shots.map(shot => shot.identityGuarantee.product).filter(level => level !== 'not_required');
  const presenterLevels = shots.map(shot => shot.identityGuarantee.presenter).filter(level => level !== 'not_required');
  const weakest = (levels: ProductionIdentityLevel[]): ProductionIdentityLevel => {
    const order: ProductionIdentityLevel[] = ['generic_only', 'unverified', 'qa_gated', 'locked_reference', 'exact_source'];
    return levels.length ? order.find(level => levels.includes(level)) || 'unverified' : 'not_required';
  };
  const product = weakest(productLevels);
  const presenter = weakest(presenterLevels);
  const overall = weakest([product, presenter].filter(level => level !== 'not_required'));
  return {
    overall,
    product,
    presenter,
    requiresQa: shots.some(shot => shot.identityGuarantee.requiresQa),
    basis: [...new Set(shots.flatMap(shot => shot.identityGuarantee.basis))],
  };
}

export function adaptStudioBatchRoutesToProductionReadView(
  response: StudioBatchShotRoutesResponse,
  input: { projectTitle?: string; projectVersion?: string | null } = {},
): ProductionReadView {
  const shots: ProductionShotReadModelV1[] = response.routes.map(route => {
    const needsInput = route.status === 'needs_material' || route.status === 'blocked';
    const inputId = needsInput ? `${route.slotId || route.shotId}:route-input` : null;
    const cost = costForRoute(route, response.aigcBudgetPreview);
    const budgetPlan = response.aigcBudgetPreview?.shotPlans?.find(item => item.shotId === route.shotId);
    const budgetBlocked = budgetPlan?.status === 'budget_excluded';
    const unsupported = budgetPlan?.status === 'unsupported';
    const blockerMessage = budgetBlocked
      ? '本镜头超出当前批次预算上限'
      : unsupported ? '当前执行能力不支持该镜头规格' : route.status === 'blocked' ? route.reason : '';
    const missing = needsInput && !blockerMessage ? [route.reason] : [];
    const allowedCommands: ProductionAllowedCommand[] = ['open_shot'];
    return {
      shotId: route.shotId,
      slotId: route.slotId || null,
      order: route.order,
      title: route.expressionPurpose || `分镜 ${route.order}`,
      route: {
        selected: route.status === 'matched' ? {
          kind: routeKinds[route.route], sourceStrategy: route.route, label: routeLabels[route.route],
          executable: true, reason: route.reason || null,
        } : null,
        recommended: {
          kind: routeKinds[route.route], sourceStrategy: route.route, label: routeLabels[route.route],
          executable: route.status === 'matched' && !budgetBlocked && !unsupported, reason: route.reason || null,
        },
        fallbacks: [],
      },
      status: budgetBlocked || unsupported ? 'blocked' : statusByStudioRoute[route.status],
      executable: route.status === 'matched' && !budgetBlocked && !unsupported,
      identityGuarantee: identityForRoute(route),
      inputs: {
        required: needsInput ? [route.reason] : [],
        missing,
        items: needsInput ? [{
          id: inputId!, kind: inputKind(route), label: route.reason, required: true,
          status: blockerMessage ? 'pending_confirmation' : 'missing', reason: route.reason || null,
          source: 'studio_project',
        }] : [],
      },
      cost,
      blockers: blockerMessage ? [{ code: budgetBlocked ? 'budget_excluded' : unsupported ? 'unsupported' : 'route_blocked',
        message: blockerMessage, recoverable: !unsupported, inputId }] : [],
      allowedCommands,
    };
  });
  const costs = shots.map(shot => shot.cost);
  const expectedValues = costs.map(cost => cost.expectedCny).filter((value): value is number => value != null);
  const upperValues = costs.map(cost => cost.upperBoundCny).filter((value): value is number => value != null);
  const required = [...new Set(shots.flatMap(shot => shot.inputs.required))];
  const missing = [...new Set(shots.flatMap(shot => shot.inputs.missing))];
  const blockers = shots.flatMap(shot => shot.blockers);
  const count = (status: ProductionReadStatus) => shots.filter(shot => shot.status === status).length;
  return {
    source: 'studio_route_plan',
    project: { id: response.projectId, version: input.projectVersion || null, studioProjectId: response.projectId,
      studioProjectVersion: input.projectVersion || null, title: input.projectTitle || '内容制作项目' },
    aggregate: {
      stage: 'planning',
      status: blockers.length ? 'blocked' : missing.length ? 'needs_input' : shots.every(shot => shot.status === 'ready') ? 'ready' : 'planning',
      executable: shots.length > 0 && shots.every(shot => shot.executable),
      identityGuarantee: aggregateIdentity(shots),
      inputs: { required, missing, items: shots.flatMap(shot => shot.inputs.items) },
      cost: {
        currency: 'CNY',
        expectedCny: expectedValues.length ? Math.round(expectedValues.reduce((sum, value) => sum + value, 0) * 100) / 100 : null,
        upperBoundCny: upperValues.length ? Math.round(upperValues.reduce((sum, value) => sum + value, 0) * 100) / 100 : null,
        actualCny: null, unsettledCny: null,
        status: expectedValues.length || upperValues.length ? 'estimated' : shots.every(shot => shot.cost.status === 'free') ? 'free' : 'unknown',
        reusable: shots.some(shot => shot.cost.reusable),
        basis: expectedValues.length || upperValues.length ? 'execution_plan' : 'unavailable',
      },
      blockers,
      counts: {
        total: shots.length,
        ready: count('ready'),
        running: count('running') + count('rendering'),
        needsInput: count('needs_input'),
        blocked: count('blocked') + count('failed'),
        review: count('quality_review') + count('review_ready'),
        completed: count('completed'),
      },
      phases: [
        { phase: 'planning', status: blockers.length ? 'blocked' : 'active' },
        { phase: 'input', status: missing.length ? 'blocked' : 'pending' },
        { phase: 'production', status: 'pending' },
        { phase: 'render', status: 'pending' },
        { phase: 'qa', status: 'pending' },
        { phase: 'review', status: 'pending' },
      ],
      allowedCommands: ['open_project'],
    },
    shots,
    updatedAt: null,
  };
}

export function canonicalProductionReadView(model: ProductionReadModelV1): ProductionReadView {
  return {
    source: 'canonical_task',
    project: {
      id: model.project.id,
      version: model.project.version,
      studioProjectId: model.project.studioProjectId,
      studioProjectVersion: model.project.studioProjectVersion,
      title: model.project.title,
    },
    aggregate: model.aggregate,
    shots: model.shots,
    updatedAt: model.updatedAt,
  };
}

/** Minimal runtime guard for transport data; canonical fields remain server-owned. */
export function isProductionReadModelV1(value: unknown): value is ProductionReadModelV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== PRODUCTION_READ_MODEL_SCHEMA || source.authority !== 'canonical_task') return false;
  if (!source.project || typeof source.project !== 'object' || Array.isArray(source.project)) return false;
  if (!source.aggregate || typeof source.aggregate !== 'object' || Array.isArray(source.aggregate)) return false;
  if (!Array.isArray(source.shots) || typeof source.updatedAt !== 'string') return false;
  const project = source.project as Record<string, unknown>;
  const aggregate = source.aggregate as Record<string, unknown>;
  return typeof project.id === 'string'
    && typeof project.version === 'string'
    && typeof aggregate.status === 'string'
    && Array.isArray(aggregate.allowedCommands)
    && source.shots.every(shot => Boolean(shot && typeof shot === 'object' && !Array.isArray(shot)
      && typeof (shot as Record<string, unknown>).shotId === 'string'
      && Array.isArray((shot as Record<string, unknown>).allowedCommands)));
}

export function productionShotForSlot(view: ProductionReadView | null, slotId: string): ProductionShotReadModelV1 | null {
  if (!view || !slotId) return null;
  return view.shots.find(shot => shot.slotId === slotId || shot.shotId === slotId) || null;
}

/**
 * A canonical task may only govern the Studio project it is actually bound to.
 * Slot ids are local to a project, so they are only a safe handoff key while the
 * canonical task has not yet been bound to a Studio project and the task id is
 * still the same one carried by the Studio entry point.
 */
export function canonicalProductionMatchesStudio(
  view: ProductionReadView | null,
  input: { studioProjectId?: string | null; socialContentTaskId?: string | null; slotIds?: string[] },
): boolean {
  if (!view || view.source !== 'canonical_task') return false;
  const canonicalStudioProjectId = view.project.studioProjectId?.trim() || '';
  const studioProjectId = input.studioProjectId?.trim() || '';
  if (canonicalStudioProjectId && studioProjectId) return canonicalStudioProjectId === studioProjectId;
  if (canonicalStudioProjectId) return false;
  if (!input.socialContentTaskId?.trim() || input.socialContentTaskId.trim() !== view.project.id) return false;
  if (!studioProjectId) return true;
  return Boolean(input.slotIds?.some(slotId => productionShotForSlot(view, slotId)));
}

export function productionRouteLabel(shot: ProductionShotReadModelV1): string {
  return (shot.route.selected || shot.route.recommended).label;
}

export function productionStatusLabel(status: ProductionReadStatus): string {
  return ({
    planning: '路线规划中', needs_input: '等待资料', ready: '可执行', running: '制作中', rendering: '合成中',
    quality_review: '质检中', review_ready: '待验收', completed: '已完成', paused: '已暂停', failed: '制作失败', blocked: '已阻塞',
  } as const)[status];
}

export function productionStatusTone(status: ProductionReadStatus): 'idle' | 'ready' | 'working' | 'warning' | 'error' {
  if (status === 'completed' || status === 'ready' || status === 'review_ready') return 'ready';
  if (status === 'running' || status === 'rendering' || status === 'quality_review' || status === 'planning') return 'working';
  if (status === 'failed' || status === 'blocked') return 'error';
  if (status === 'needs_input' || status === 'paused') return 'warning';
  return 'idle';
}

export function productionIdentityLabel(shot: ProductionShotReadModelV1): string | undefined {
  const level = shot.identityGuarantee.product;
  if (level === 'not_required') return undefined;
  return ({
    exact_source: '真实素材原样保留',
    locked_reference: '真实产品参考锁定',
    qa_gated: '生成后质检确认',
    generic_only: '仅保证品类表达',
    unverified: '尚未验证真实产品',
  } as const)[level];
}

export function productionAllows(shot: ProductionShotReadModelV1 | null, command: ProductionAllowedCommand): boolean {
  return Boolean(shot?.allowedCommands.includes(command));
}

/**
 * Command availability is server-owned. In particular, a Studio route-plan
 * compatibility projection must not infer state-changing commands such as
 * request_shoot from the mere presence of a shot.
 */
export function productionCommandAllowed(
  _view: ProductionReadView | null,
  shot: ProductionShotReadModelV1 | null,
  command: ProductionAllowedCommand,
): boolean {
  return productionAllows(shot, command);
}
