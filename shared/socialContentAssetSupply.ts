import type {
  SocialAssetAvailability,
  SocialAssetSupplyPlan,
  SocialAssetSupplyRoute,
  SocialAssetSupplyShotPlan,
  SocialContentCreationMode,
  SocialContentManagementMode,
  SocialShotFunction,
  SocialShotSourceStrategy,
  SocialShotTruthBoundary,
  SocialTruthProhibition,
  SocialTruthSensitiveSubject,
} from './contracts/socialContentWorkflow';

export interface SocialAssetInventory {
  customerVideoIds?: string[];
  productImageIds?: string[];
  presenterAssetIds?: string[];
  factoryEvidenceAssetIds?: string[];
  customerCaseEvidenceAssetIds?: string[];
  productEffectEvidenceAssetIds?: string[];
  licensedStockAssetIds?: string[];
}

export interface SocialAssetSupplyShotRequest {
  shotId: string;
  function: SocialShotFunction;
  requestedDescription?: string | null;
  truthSensitiveSubject?: SocialTruthSensitiveSubject;
}

export interface CreateSocialAssetSupplyPlanInput {
  creationMode: SocialContentCreationMode;
  assetAvailability?: SocialAssetAvailability;
  managementMode?: SocialContentManagementMode;
  /** Task-backed version for new plans. Historic callers may omit it. */
  planVersion?: string;
  inventory?: SocialAssetInventory;
  confirmedFactRefs?: string[];
  rightsConfirmationRequired?: boolean;
  shots?: SocialAssetSupplyShotRequest[];
}

const EMPTY_INVENTORY: Required<SocialAssetInventory> = {
  customerVideoIds: [],
  productImageIds: [],
  presenterAssetIds: [],
  factoryEvidenceAssetIds: [],
  customerCaseEvidenceAssetIds: [],
  productEffectEvidenceAssetIds: [],
  licensedStockAssetIds: [],
};

const DEFAULT_SHOTS: Record<SocialContentCreationMode, SocialAssetSupplyShotRequest[]> = {
  material_processing: [
    { shotId: 'shot-hook', function: 'hook', requestedDescription: '前三秒呈现清楚主体和核心利益点' },
    { shotId: 'shot-value', function: 'value', requestedDescription: '解释产品或服务能解决什么问题' },
    { shotId: 'shot-demonstration', function: 'demonstration', requestedDescription: '用可验证信息说明使用方式或工作原理' },
    { shotId: 'shot-cta', function: 'call_to_action', requestedDescription: '给出与真实业务一致的下一步行动' },
  ],
  viral_replication: [
    { shotId: 'shot-hook', function: 'hook', requestedDescription: '复用参考视频的前三秒吸引机制，不复用原素材和原文案' },
    { shotId: 'shot-problem', function: 'problem', requestedDescription: '保持参考视频的信息推进功能，换成客户自己的表达' },
    { shotId: 'shot-demonstration', function: 'demonstration', requestedDescription: '保持镜头节奏，用可生产且真实的画面完成说明' },
    { shotId: 'shot-cta', function: 'call_to_action', requestedDescription: '按照客户真实业务重写行动引导' },
  ],
};

function unique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
}

function normalizeInventory(input?: SocialAssetInventory): Required<SocialAssetInventory> {
  return {
    customerVideoIds: unique(input?.customerVideoIds),
    productImageIds: unique(input?.productImageIds),
    presenterAssetIds: unique(input?.presenterAssetIds),
    factoryEvidenceAssetIds: unique(input?.factoryEvidenceAssetIds),
    customerCaseEvidenceAssetIds: unique(input?.customerCaseEvidenceAssetIds),
    productEffectEvidenceAssetIds: unique(input?.productEffectEvidenceAssetIds),
    licensedStockAssetIds: unique(input?.licensedStockAssetIds),
  };
}

export function inferSocialAssetAvailability(input?: SocialAssetInventory): SocialAssetAvailability {
  const inventory = normalizeInventory(input);
  const customerMotionCount = inventory.customerVideoIds.length
    + inventory.presenterAssetIds.length
    + inventory.factoryEvidenceAssetIds.length
    + inventory.customerCaseEvidenceAssetIds.length
    + inventory.productEffectEvidenceAssetIds.length;
  if (customerMotionCount > 0) return 'ready';
  if (inventory.productImageIds.length > 0 || inventory.licensedStockAssetIds.length > 0) return 'limited';
  return 'none';
}

function productionRoute(
  availability: SocialAssetAvailability,
  inventory: Required<SocialAssetInventory>,
): SocialAssetSupplyRoute {
  if (availability === 'ready') return 'real_asset_enhancement';
  if (inventory.productImageIds.length > 0) return 'product_anchored_generation';
  return 'zero_asset_generation';
}

function evidenceRefsFor(
  subject: SocialTruthSensitiveSubject,
  inventory: Required<SocialAssetInventory>,
): string[] {
  if (subject === 'customer_factory') return inventory.factoryEvidenceAssetIds;
  if (subject === 'customer_case') return inventory.customerCaseEvidenceAssetIds;
  if (subject === 'product_effect') return inventory.productEffectEvidenceAssetIds;
  return [];
}

function prohibitionsFor(subject: SocialTruthSensitiveSubject): SocialTruthProhibition[] {
  const common: SocialTruthProhibition[] = ['alter_locked_product_identity', 'present_synthetic_media_as_customer_evidence'];
  if (subject === 'customer_factory') return ['depict_generated_factory_as_customer_factory', ...common];
  if (subject === 'customer_case') return ['invent_customer_case_or_results', ...common];
  if (subject === 'product_effect') return ['depict_generated_effect_as_verified_product_result', ...common];
  return common;
}

function replacementDescription(subject: SocialTruthSensitiveSubject): string {
  if (subject === 'customer_factory') {
    return '用已确认的能力参数、产品细节和流程示意承担信任功能，不生成或暗示客户真实工厂画面';
  }
  if (subject === 'customer_case') {
    return '用通用采购决策过程、服务步骤或经确认的匿名事实承担说明功能，不虚构客户身份、案例和结果';
  }
  if (subject === 'product_effect') {
    return '用使用步骤、适用场景、工作原理或经确认的参数承担说明功能，不生成可被误认成真实效果的画面';
  }
  return '';
}

function safeReplacementStrategy(confirmedFactRefs: string[]): SocialShotSourceStrategy {
  return confirmedFactRefs.length > 0 ? 'verified_fact_card' : 'motion_graphics';
}

function generalStrategy(
  shot: SocialAssetSupplyShotRequest,
  inventory: Required<SocialAssetInventory>,
  confirmedFactRefs: string[],
): { strategy: SocialShotSourceStrategy; refs: string[]; instruction: string } {
  if (inventory.customerVideoIds.length > 0) {
    return {
      strategy: 'customer_real_asset',
      refs: inventory.customerVideoIds,
      instruction: '优先剪辑客户真实视频；只做裁切、调色、字幕和声音处理，不重绘真实主体',
    };
  }
  if (inventory.productImageIds.length > 0) {
    return {
      strategy: 'customer_product_image_animation',
      refs: inventory.productImageIds,
      instruction: '锁定产品外观、包装、商标和文字，只生成背景、景深、运镜与非事实性动效',
    };
  }
  if (inventory.presenterAssetIds.length > 0) {
    return {
      strategy: 'customer_real_asset',
      refs: inventory.presenterAssetIds,
      instruction: '保留已授权人物身份和关键动作，用配音、字幕与图文层完成镜头',
    };
  }
  if (shot.function === 'proof' && confirmedFactRefs.length > 0) {
    return {
      strategy: 'verified_fact_card',
      refs: confirmedFactRefs,
      instruction: '只把已确认事实做成数据卡片，不把图形动画包装成实拍证据',
    };
  }
  if (shot.function === 'transition' && inventory.licensedStockAssetIds.length > 0) {
    return {
      strategy: 'licensed_stock_asset',
      refs: inventory.licensedStockAssetIds,
      instruction: '仅把有商用权限的素材用于环境、气氛或转场，不暗示它属于客户',
    };
  }
  if (shot.function === 'hook' || shot.function === 'value' || shot.function === 'call_to_action') {
    return {
      strategy: 'authorized_digital_presenter',
      refs: [],
      instruction: '由已授权数字人或配音承担口播，搭配品牌图文；不虚构产品外观、工厂、案例或效果',
    };
  }
  return {
    strategy: 'motion_graphics',
    refs: confirmedFactRefs,
    instruction: '使用动态图文、示意动画和经确认的事实完成说明，不把示意内容当作客户实拍',
  };
}

function fallbackFor(strategy: SocialShotSourceStrategy): SocialShotSourceStrategy | null {
  if (strategy === 'motion_graphics') return 'authorized_digital_presenter';
  if (strategy === 'authorized_digital_presenter') return 'motion_graphics';
  if (strategy === 'licensed_stock_asset') return 'non_evidentiary_ai_visual';
  if (strategy === 'non_evidentiary_ai_visual') return 'motion_graphics';
  if (strategy === 'verified_fact_card') return 'motion_graphics';
  return 'motion_graphics';
}

function planShot(
  shot: SocialAssetSupplyShotRequest,
  inventory: Required<SocialAssetInventory>,
  confirmedFactRefs: string[],
): SocialAssetSupplyShotPlan {
  const subject = shot.truthSensitiveSubject ?? 'none';
  const evidenceRefs = evidenceRefsFor(subject, inventory);
  const hasEvidence = subject !== 'none' && evidenceRefs.length > 0;

  if (hasEvidence) {
    const truthBoundary: SocialShotTruthBoundary = {
      subject,
      syntheticVisualAllowed: false,
      customerEvidenceRequired: true,
      customerEvidenceRefs: evidenceRefs,
      confirmedFactRefs,
      mustNotImplyCustomerReality: false,
      prohibitedRepresentations: prohibitionsFor(subject),
    };
    return {
      shotId: shot.shotId,
      function: shot.function,
      requestedDescription: shot.requestedDescription ?? null,
      sourceStrategy: 'customer_real_asset',
      sourceRefs: evidenceRefs,
      fallbackSourceStrategy: null,
      productionInstruction: '使用对应的客户真实证据素材；不得生成、替换或夸大承担证明作用的主体和结果',
      truthBoundary,
      functionalEquivalentReplacement: {
        required: false,
        preservesFunction: shot.function,
        replacesSubject: null,
        description: null,
        reason: null,
      },
      feasibility: 'full_fidelity',
      feasibilityReason: '已有可追溯的客户真实证据，可以完整承担该镜头的证明作用',
      customerShootRequired: false,
    };
  }

  if (subject !== 'none') {
    const strategy = safeReplacementStrategy(confirmedFactRefs);
    const hasConfirmedFacts = confirmedFactRefs.length > 0;
    const truthBoundary: SocialShotTruthBoundary = {
      subject,
      syntheticVisualAllowed: true,
      customerEvidenceRequired: false,
      customerEvidenceRefs: [],
      confirmedFactRefs,
      mustNotImplyCustomerReality: true,
      prohibitedRepresentations: prohibitionsFor(subject),
    };
    return {
      shotId: shot.shotId,
      function: shot.function,
      requestedDescription: shot.requestedDescription ?? null,
      sourceStrategy: strategy,
      sourceRefs: strategy === 'verified_fact_card' ? confirmedFactRefs : [],
      fallbackSourceStrategy: fallbackFor(strategy),
      productionInstruction: replacementDescription(subject),
      truthBoundary,
      functionalEquivalentReplacement: {
        required: true,
        preservesFunction: shot.function,
        replacesSubject: subject,
        description: replacementDescription(subject),
        reason: '缺少可证明该真实场景或结果的客户素材，自动改成不依赖实拍的等价表达',
      },
      feasibility: hasConfirmedFacts ? 'functional_equivalent' : 'blocked_for_facts_or_rights',
      feasibilityReason: hasConfirmedFacts
        ? '缺少真实证据素材，但已有确认事实，可以用非证据型表达保持镜头功能'
        : '缺少可核验事实和真实证据，不能安全替代该证明型镜头',
      customerShootRequired: false,
    };
  }

  const selected = generalStrategy(shot, inventory, confirmedFactRefs);
  const hasUsableInput = selected.refs.length > 0 || confirmedFactRefs.length > 0;
  const feasibility = !hasUsableInput
    ? 'blocked_for_facts_or_rights'
    : selected.strategy === 'customer_real_asset' || selected.strategy === 'customer_product_image_animation'
      ? 'full_fidelity'
      : 'functional_equivalent';
  return {
    shotId: shot.shotId,
    function: shot.function,
    requestedDescription: shot.requestedDescription ?? null,
    sourceStrategy: selected.strategy,
    sourceRefs: selected.refs,
    fallbackSourceStrategy: fallbackFor(selected.strategy),
    productionInstruction: selected.instruction,
    truthBoundary: {
      subject: 'none',
      syntheticVisualAllowed: true,
      customerEvidenceRequired: false,
      customerEvidenceRefs: [],
      confirmedFactRefs,
      mustNotImplyCustomerReality: selected.strategy !== 'customer_real_asset',
      prohibitedRepresentations: prohibitionsFor('none'),
    },
    functionalEquivalentReplacement: {
      required: false,
      preservesFunction: shot.function,
      replacesSubject: null,
      description: null,
      reason: null,
    },
    feasibility,
    feasibilityReason: feasibility === 'full_fidelity'
      ? '已有客户素材，可在不改变真实主体的情况下完整实现'
      : feasibility === 'functional_equivalent'
        ? '已有确认事实，可通过授权能力或非证据型画面保持镜头功能'
        : '尚未确认最基本的产品事实，不能安全生成对外内容',
    customerShootRequired: false,
  };
}

/**
 * Produces an executable plan even when the customer supplies no media. The
 * plan replaces unsupported factory, case and effect claims instead of asking
 * the customer to shoot or generating fake evidence.
 */
export function createSocialAssetSupplyPlan(input: CreateSocialAssetSupplyPlanInput): SocialAssetSupplyPlan {
  const inventory = normalizeInventory(input.inventory ?? EMPTY_INVENTORY);
  const confirmedFactRefs = unique(input.confirmedFactRefs);
  const availability = input.assetAvailability ?? inferSocialAssetAvailability(inventory);
  const managementMode = input.managementMode ?? 'one_click_managed';
  const requestedShots = input.shots?.length ? input.shots : DEFAULT_SHOTS[input.creationMode];
  const needsFacts = confirmedFactRefs.length === 0;
  const needsRights = input.rightsConfirmationRequired === true;
  const shots = requestedShots.map(shot => planShot(shot, inventory, confirmedFactRefs));
  const overallFeasibility = needsRights || shots.some(shot => shot.feasibility === 'blocked_for_facts_or_rights')
    ? 'blocked_for_facts_or_rights'
    : shots.some(shot => shot.feasibility === 'goal_degraded')
      ? 'goal_degraded'
      : shots.some(shot => shot.feasibility === 'functional_equivalent')
        ? 'functional_equivalent'
        : 'full_fidelity';
  const customerActions: SocialAssetSupplyPlan['customerActions'] = [
    ...(needsFacts ? ['confirm_facts' as const] : []),
    ...(needsRights ? ['confirm_rights' as const] : []),
  ];
  const status: SocialAssetSupplyPlan['status'] = needsRights
    ? 'requires_rights_confirmation'
    : needsFacts
      ? 'requires_fact_confirmation'
      : overallFeasibility === 'goal_degraded'
        ? 'goal_degraded'
        : 'ready';

  return {
    planVersion: input.planVersion?.trim() || 'historic-unversioned',
    creationMode: input.creationMode,
    assetAvailability: availability,
    managementMode,
    productionRoute: productionRoute(availability, inventory),
    status,
    overallFeasibility,
    canProduceWithoutCustomerShoot: customerActions.length === 0
      && (overallFeasibility === 'full_fidelity' || overallFeasibility === 'functional_equivalent'),
    customerActions,
    systemActions: [
      ...(input.creationMode === 'viral_replication'
        ? ['选择或读取参考视频，并完成前三秒与全片逐镜分析']
        : ['读取客户资料并建立前三秒与完整制作脚本']),
      '为每个镜头选择素材来源和备用制作方式',
      '自动制作配音、字幕、动态图文、数字人或辅助画面',
      '逐镜检查事实边界、素材来源和生成内容标识',
    ],
    optionalEnhancements: [
      '用户可自愿补充产品图片或视频以提高品牌一致性',
      '用户可自愿补充真实工厂、案例或效果证据以恢复对应实拍镜头',
    ],
    shots,
  };
}
