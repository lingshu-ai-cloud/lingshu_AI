import type {
  SocialAssetAvailability,
  SocialAssetSupplyPlan,
  SocialAssetSupplyRoute,
  SocialAssetSupplyShotPlan,
  SocialAccountPresenterLock,
  SocialContentCreationMode,
  SocialContentManagementMode,
  SocialProductIdentityGroup,
  SocialProductSceneReplicationSpec,
  SocialReferenceShotAnalysis,
  SocialShotFunction,
  SocialShotSourceStrategy,
  SocialShotTruthBoundary,
  SocialTruthProhibition,
  SocialTruthSensitiveSubject,
} from './contracts/socialContentWorkflow';

export interface SocialAssetInventory {
  customerVideoIds?: string[];
  productImageIds?: string[];
  /** Multiple views of the same product belong in one group. */
  productIdentityGroups?: Array<{ productRef: string; imageIds: string[] }>;
  presenterAssetIds?: string[];
  referenceVideoIds?: string[];
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
  referenceShotId?: string | null;
  /** Optional Director-frozen spec; otherwise the planner builds a safe default. */
  productSceneReplication?: SocialProductSceneReplicationSpec;
}

export interface CreateSocialAssetSupplyPlanInput {
  creationMode: SocialContentCreationMode;
  assetAvailability?: SocialAssetAvailability;
  managementMode?: SocialContentManagementMode;
  /** Task-backed version for new plans. Historic callers may omit it. */
  planVersion?: string;
  inventory?: SocialAssetInventory;
  accountPresenterLock?: SocialAccountPresenterLock | null;
  referenceShots?: SocialReferenceShotAnalysis[];
  confirmedFactRefs?: string[];
  rightsConfirmationRequired?: boolean;
  shots?: SocialAssetSupplyShotRequest[];
}

const EMPTY_INVENTORY: Required<SocialAssetInventory> = {
  customerVideoIds: [],
  productImageIds: [],
  productIdentityGroups: [],
  presenterAssetIds: [],
  referenceVideoIds: [],
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
  const productIdentityGroups = (input?.productIdentityGroups ?? []).flatMap(group => {
    const productRef = group.productRef?.trim();
    const imageIds = unique(group.imageIds);
    return productRef && imageIds.length ? [{ productRef, imageIds }] : [];
  });
  return {
    customerVideoIds: unique(input?.customerVideoIds),
    productImageIds: unique([
      ...(input?.productImageIds ?? []),
      ...productIdentityGroups.flatMap(group => group.imageIds),
    ]),
    productIdentityGroups,
    presenterAssetIds: unique(input?.presenterAssetIds),
    referenceVideoIds: unique(input?.referenceVideoIds),
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

function presenterLockReady(lock: SocialAccountPresenterLock | null | undefined): lock is SocialAccountPresenterLock {
  return Boolean(lock
    && lock.status === 'published'
    && lock.commercialRightsStatus === 'cleared'
    && lock.socialAccountId.trim()
    && lock.presenterProfileId.trim()
    && lock.presenterProfileVersion.trim()
    && lock.presenterAssetId.trim()
    && lock.avatarId.trim()
    && lock.voiceProfileId.trim()
    && lock.consentRef.trim()
    && lock.consistencyKey.trim());
}

export function buildSocialProductSceneReplicationSpec(input: {
  shot: SocialAssetSupplyShotRequest;
  inventory: Required<SocialAssetInventory>;
  referenceShots?: SocialReferenceShotAnalysis[];
}): SocialProductSceneReplicationSpec {
  if (input.shot.productSceneReplication) return structuredClone(input.shot.productSceneReplication);
  const reference = input.referenceShots?.find(item => item.shotId === input.shot.referenceShotId);
  const groups: SocialProductIdentityGroup[] = input.inventory.productIdentityGroups.length
    ? input.inventory.productIdentityGroups.map(group => ({
      productRef: group.productRef,
      referenceImageIds: [...group.imageIds],
      requiredVisibleElements: ['产品轮廓', '材质与颜色', 'Logo', '包装标签与可读文字'],
      forbiddenChanges: ['shape', 'material', 'color', 'logo', 'label_text', 'packaging_structure'],
    }))
    : [{
      productRef: 'task-product',
      referenceImageIds: [...input.inventory.productImageIds],
      requiredVisibleElements: ['产品轮廓', '材质与颜色', 'Logo', '包装标签与可读文字'],
      forbiddenChanges: ['shape', 'material', 'color', 'logo', 'label_text', 'packaging_structure'],
    }];
  const cameraTags = reference?.tags.cameraLanguage ?? [];
  const durationSeconds = reference
    ? Math.max(0.5, +(reference.endSeconds - reference.startSeconds).toFixed(2))
    : input.shot.function === 'hook' ? 3 : 4;
  const referenceShotId = input.shot.referenceShotId ?? reference?.shotId ?? null;
  return {
    schemaVersion: 'social-product-scene-replication.v1',
    templateSource: reference ? 'reference_shot' : 'system_clean_stage',
    sceneTemplateKey: reference ? `reference-shot:${reference.shotId}` : 'system:clean-platform-orbit-v1',
    referenceShotId,
    referenceSourceId: input.inventory.referenceVideoIds[0] ?? null,
    referenceStartSeconds: reference?.startSeconds ?? null,
    referenceEndSeconds: reference?.endSeconds ?? null,
    productIdentity: {
      groups,
      identitySimilarityMinimum: 0.78,
      ocrExactMatchRequired: true,
    },
    sceneLock: {
      environment: reference?.visualDescription || '干净摄影棚产品展示环境',
      background: reference ? '沿用参考镜头的背景类别、明暗关系和留白' : '纯净中性背景，无无关道具和文字',
      platform: reference ? '沿用参考镜头的承托面和高低层级' : '简洁圆形展示台',
      lighting: reference ? '沿用参考镜头的光向、软硬、色温和产品高光关系' : '柔和棚拍主光与轮廓光',
      composition: reference?.shotLanguage?.composition || cameraTags.join('、') || '多产品有序排列，主体位于安全区内',
      productSlots: groups.map((group, index) => ({
        slotId: `product-slot-${index + 1}`,
        productRef: group.productRef,
        placement: groups.length === 1 ? '展台视觉中心' : `从左到右第 ${index + 1} 个固定槽位`,
        orientation: '正面标签朝向镜头，随运镜保持可识别',
        scale: groups.length === 1 ? 1 : 0.82,
      })),
    },
    cameraLock: {
      shotSize: reference?.shotLanguage?.shotSize || '产品中近景',
      cameraAngle: reference?.shotLanguage?.cameraAngle || '轻微俯视',
      lensFeel: '中焦产品摄影，无夸张广角畸变',
      startFrame: '第一帧完整展示固定产品槽位与干净背景',
      movementPath: reference?.shotLanguage?.movement || cameraTags.find(item => /旋转|环绕|推进|orbit|push/i.test(item)) || '围绕展台平滑环绕并轻微推近',
      endFrame: '产品标签和整体排列仍清晰可识别',
      durationSeconds,
      easing: '缓入缓出，速度连续，不随机变向',
    },
    tolerance: {
      durationSeconds: 0.25,
      productPositionRatio: 0.06,
      productScaleRatio: 0.08,
      cameraPathDeviationRatio: 0.1,
    },
    validation: {
      requiredChecks: ['product_identity', 'label_ocr', 'scene_topology', 'product_slot_layout', 'camera_trajectory'],
      singleShotRetryOnFailure: true,
    },
  };
}

function generalStrategy(
  shot: SocialAssetSupplyShotRequest,
  inventory: Required<SocialAssetInventory>,
  confirmedFactRefs: string[],
  creationMode: SocialContentCreationMode,
  accountPresenterLock: SocialAccountPresenterLock | null | undefined,
  referenceShots?: SocialReferenceShotAnalysis[],
): { strategy: SocialShotSourceStrategy; refs: string[]; instruction: string; productSceneReplication?: SocialProductSceneReplicationSpec } {
  const description = String(shot.requestedDescription || '');
  const firstReferenceShot = shot.referenceShotId === 'reference-shot-1'
    || shot.shotId === 'shot-hook'
    || /(?:^|-)shot-?1$/i.test(shot.shotId);
  const productScenePreferred = inventory.productImageIds.length > 0 && (
    creationMode === 'viral_replication'
      ? firstReferenceShot
      : shot.function === 'hook' || shot.function === 'demonstration' || /产品|商品|包装|陈列|展台|product/i.test(description)
  );
  if (productScenePreferred) {
    return {
      strategy: 'aigc_product_scene_replication',
      refs: inventory.productImageIds,
      instruction: '锁定产品轮廓、材质、颜色、Logo、标签和包装文字；按 ProductSceneReplicationSpec 复现完整场景拓扑、产品槽位、布光、构图与镜头轨迹，不得退化为单图平移缩放',
      productSceneReplication: buildSocialProductSceneReplicationSpec({ shot, inventory, referenceShots }),
    };
  }
  if (creationMode === 'viral_replication' && inventory.factoryEvidenceAssetIds.length > 0) {
    return {
      strategy: 'customer_real_asset',
      refs: inventory.factoryEvidenceAssetIds,
      instruction: '开头产品场景后只使用素材库中的真实工厂视频，按参考片节奏切换不同工厂镜头，并叠加口播、字幕与轻量音效',
    };
  }
  if (creationMode === 'viral_replication' && inventory.presenterAssetIds.length > 0 && inventory.referenceVideoIds.length > 0) {
    return { strategy: 'authorized_digital_presenter', refs: inventory.presenterAssetIds,
      instruction: '使用当前社媒账号已发布的数字人身份版本，以参考视频逐句对齐；不得在任务内随机更换人脸、声线或身份版本' };
  }
  if (inventory.customerVideoIds.length > 0) {
    return {
      strategy: 'customer_real_asset',
      refs: inventory.customerVideoIds,
      instruction: '优先剪辑客户真实视频；只做裁切、调色、字幕和声音处理，不重绘真实主体',
    };
  }
  if (presenterLockReady(accountPresenterLock) || inventory.presenterAssetIds.length > 0) {
    return {
      strategy: 'authorized_digital_presenter',
      refs: presenterLockReady(accountPresenterLock) ? [accountPresenterLock.presenterAssetId] : inventory.presenterAssetIds,
      instruction: '复用当前社媒账号已发布的数字人身份与声音人格；任务只改变口播和允许变化的表演参数，不改变账号主播身份',
    };
  }
  if (inventory.productImageIds.length > 0) {
    return {
      strategy: 'aigc_product_scene_replication',
      refs: inventory.productImageIds,
      instruction: '锁定产品身份并使用同一场景模板与镜头语言生成产品展示；不把生成场景表述为客户实拍',
      productSceneReplication: buildSocialProductSceneReplicationSpec({ shot, inventory, referenceShots }),
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
      instruction: '优先创建或绑定当前社媒账号的已发布数字人身份版本后完成口播；不要求用户拍摄真人视频，身份未锁定前不得提交生成',
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
  if (strategy === 'aigc_product_scene_replication') return 'motion_graphics';
  if (strategy === 'licensed_stock_asset') return 'non_evidentiary_ai_visual';
  if (strategy === 'non_evidentiary_ai_visual') return 'motion_graphics';
  if (strategy === 'verified_fact_card') return 'motion_graphics';
  return 'motion_graphics';
}

function digitalHumanMethod(creationMode: SocialContentCreationMode, description: string | null | undefined): 'talking' | 'replace' | 'reenact' {
  if (creationMode !== 'viral_replication') return 'talking';
  return /重新演绎|reenact|re-?perform/i.test(String(description || '')) ? 'reenact' : 'replace';
}

function planShot(
  shot: SocialAssetSupplyShotRequest,
  inventory: Required<SocialAssetInventory>,
  confirmedFactRefs: string[],
  creationMode: SocialContentCreationMode,
  accountPresenterLock: SocialAccountPresenterLock | null | undefined,
  referenceShots?: SocialReferenceShotAnalysis[],
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

  const selected = generalStrategy(shot, inventory, confirmedFactRefs, creationMode, accountPresenterLock, referenceShots);
  const hasUsableInput = selected.refs.length > 0 || confirmedFactRefs.length > 0;
  const feasibility = !hasUsableInput
    ? 'blocked_for_facts_or_rights'
    : selected.strategy === 'customer_real_asset' || selected.strategy === 'customer_product_image_animation'
      || selected.strategy === 'aigc_product_scene_replication'
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
    ...(selected.productSceneReplication ? {
      productSceneReplication: structuredClone(selected.productSceneReplication),
    } : {}),
    ...(selected.strategy === 'authorized_digital_presenter' ? {
      digitalHumanPlan: {
        workflow: creationMode,
        method: digitalHumanMethod(creationMode, shot.requestedDescription),
        presenterAssetIds: presenterLockReady(accountPresenterLock)
          ? [accountPresenterLock.presenterAssetId]
          : [...inventory.presenterAssetIds],
        referenceMaterialIds: creationMode === 'viral_replication' ? [...inventory.referenceVideoIds] : [],
        referenceRequired: creationMode === 'viral_replication',
        candidateTools: creationMode !== 'viral_replication' ? ['heygen']
          : digitalHumanMethod(creationMode, shot.requestedDescription) === 'replace'
            ? ['local_head_pipeline', 'runway_kling_motion']
            : ['runway_seedance', 'runway_kling_motion', 'runway_act_two'],
        executionState: presenterLockReady(accountPresenterLock)
          ? creationMode === 'viral_replication'
            ? inventory.referenceVideoIds.length ? 'preview_only' as const : 'needs_confirmation' as const
            : 'ready_for_capability_check' as const
          : 'needs_presenter' as const,
        accountPresenterLock: presenterLockReady(accountPresenterLock)
          ? structuredClone(accountPresenterLock)
          : null,
      },
    } : {}),
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
  const shots = requestedShots.map(shot => planShot(
    shot,
    inventory,
    confirmedFactRefs,
    input.creationMode,
    input.accountPresenterLock,
    input.referenceShots,
  ));
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
    accountPresenterLock: presenterLockReady(input.accountPresenterLock)
      ? structuredClone(input.accountPresenterLock)
      : null,
    systemActions: [
      ...(input.creationMode === 'viral_replication'
        ? ['选择或读取参考视频，并完成前三秒与全片逐镜分析']
        : ['读取客户资料并建立前三秒与完整制作脚本']),
      '为每个镜头选择素材来源和备用制作方式',
      ...(shots.some(shot => shot.sourceStrategy === 'authorized_digital_presenter')
        ? ['绑定并复用发布账号的数字人身份版本；缺少时创建一次账号主播档案，不要求真人拍摄'] : []),
      ...(shots.some(shot => shot.sourceStrategy === 'aigc_product_scene_replication')
        ? ['根据产品真实参考图生成完整产品场景，并逐项校验产品身份、场景拓扑、产品槽位与镜头轨迹'] : []),
      '自动制作配音、字幕、动态图文、数字人或辅助画面',
      '逐镜检查事实边界、素材来源和生成内容标识',
    ],
    optionalEnhancements: [
      '用户可自愿补充更多产品角度图以提高产品身份保真，不要求拍摄产品运镜视频',
      '用户可自愿补充真实工厂、案例或效果证据以恢复对应实拍镜头',
    ],
    shots,
  };
}
