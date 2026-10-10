export type PersonReplacementScope = 'face_head_hair' | 'full_person' | 'creative_person';
export type PersonReplacementMode = 'fast' | 'expert' | 'creative';
export type PersonReplacementRoute = 'preserve' | 'replace' | 'review' | 'blocked';
export type PersonReplacementProvider = 'local_head_pipeline' | 'runway_kling_motion' | 'runway_seedance' | 'runway_act_two';
export type PersonReplacementFeasibility = 'full_fidelity' | 'functional_equivalent' | 'goal_degraded' | 'blocked_for_facts_or_rights';
export type PersonReplacementSourceKind = 'customer_asset' | 'licensed_asset' | 'external_reference';
export type PersonReplacementModeSelection = PersonReplacementMode | 'auto';

export interface PersonReplacementRightsScope {
  analysis: boolean;
  derivative: boolean;
  commercialPublish: boolean;
}

export const STRICT_PRESERVATION_LOCKS = [
  '原视频构图与机位',
  '人物出镜位置与姿势',
  '身体动作与手势节奏',
  '原口播内容与口型时序',
  '镜头时长、剪辑点与原音轨',
] as const;

export const CREATIVE_MODE_LOCKS = ['原口播核心信息', '品牌禁用项与授权边界', '目标人物身份'] as const;
export const PERSON_REPLACEMENT_LOCKS = STRICT_PRESERVATION_LOCKS;

export interface PersonReplacementModeContract {
  mode: PersonReplacementMode;
  scope: PersonReplacementScope;
  label: string;
  shortLabel: string;
  description: string;
  runwayRole: string;
  providerOrder: readonly PersonReplacementProvider[];
  lockedElements: readonly string[];
  requiresAutomaticReview: boolean;
  allowsCompositionChange: boolean;
  maturity: 'limited' | 'experimental' | 'preview';
  maturityLabel: string;
  suitableFor: readonly string[];
  limitations: readonly string[];
}

export const PERSON_REPLACEMENT_MODE_CONTRACTS: Record<PersonReplacementMode, PersonReplacementModeContract> = {
  fast: {
    mode: 'fast', scope: 'face_head_hair', label: '快速模式 · 面部＋头部＋发型', shortLabel: '精准换头',
    description: '三项一起替换；保留原人物身体、服装、姿势、动作、口播和背景。',
    runwayRole: 'Runway 仅生成目标人物参考图；成片由本地逐帧替换管线完成。',
    providerOrder: ['local_head_pipeline'], lockedElements: STRICT_PRESERVATION_LOCKS,
    requiresAutomaticReview: true, allowsCompositionChange: false,
    maturity: 'limited', maturityLabel: '有限场景可用',
    suitableFor: ['单人连续镜头', '正脸至轻侧脸占比≥80%', '面部遮挡≤20%', '建议15秒内逐镜处理'],
    limitations: ['多人、手遮脸、强侧脸、大幅快速转头需要改用其他路线', '目标发型轮廓必须覆盖原发型至少 90%'],
  },
  expert: {
    mode: 'expert', scope: 'full_person', label: '保真全人物', shortLabel: '保真全人物',
    description: '替换完整人物外观，以原视频姿势、手势、口播和镜头为驱动约束。',
    runwayRole: '仅使用明确声明原镜头人物替换能力的链路生成候选，并回贴原背景。',
    providerOrder: ['runway_kling_motion'], lockedElements: STRICT_PRESERVATION_LOCKS,
    requiresAutomaticReview: true, allowsCompositionChange: false,
    maturity: 'experimental', maturityLabel: '实验中 · 尚未通过保真验收',
    suitableFor: ['已授权的单人短镜头', '先生成人物层，再回贴原背景'],
    limitations: ['当前样片姿态误差与背景保真未达门槛，不得自动进入成片'],
  },
  creative: {
    mode: 'creative', scope: 'creative_person', label: '创意模式 · 人物重新演绎', shortLabel: '创意重演',
    description: '保留口播核心信息和目标人物，允许重新设计动作、服装、背景、机位与构图。',
    runwayRole: 'Runway 作为主生成引擎，可按镜头选择 Kling、Seedance 或 Act-Two。',
    providerOrder: ['runway_kling_motion', 'runway_seedance', 'runway_act_two'], lockedElements: CREATIVE_MODE_LOCKS,
    requiresAutomaticReview: false, allowsCompositionChange: true,
    maturity: 'preview', maturityLabel: '可试用 · 需人工复核',
    suitableFor: ['参考视频只用于结构分析', '可接受重新设计动作、服装、背景和机位'],
    limitations: ['必须锁定口播核心信息、目标人物身份与品牌禁用项'],
  },
};

export interface ReferenceShotForReplacement {
  time: string;
  visual?: string;
  shot?: string;
  camera?: string;
  confidence?: number;
  needsReview?: boolean;
  personCount?: number;
  hasPerson?: boolean;
  maximumOcclusionRatio?: number;
}

export interface PersonReplacementShotPlan {
  id: string;
  start: number;
  end: number;
  duration: number;
  sourceTime: string;
  summary: string;
  route: PersonReplacementRoute;
  scope: PersonReplacementScope;
  mode: PersonReplacementMode;
  sourceKind: PersonReplacementSourceKind;
  feasibility: PersonReplacementFeasibility;
  publicMethodLabel: string;
  providerOrder: readonly PersonReplacementProvider[];
  lockedElements: readonly string[];
  requiresAutomaticReview: boolean;
  reasons: string[];
}

export interface PersonReplacementPlanningOptions {
  sourceKind?: PersonReplacementSourceKind;
  rightsScope?: Partial<PersonReplacementRightsScope>;
  maxAttempts?: number;
}

export interface PersonReplacementQualityMetrics {
  durationDeltaFrames?: number;
  audioCorrelation?: number;
  backgroundSsim?: number;
  normalizedPoseError?: number;
  handPck?: number;
  identityPassed?: boolean;
  visibleArtifactCount?: number;
  headSilhouetteCoverage?: number;
}

export interface PersonReplacementQualityResult {
  status: 'passed' | 'failed' | 'needs_measurement' | 'manual_review';
  failures: string[];
  missingMetrics: Array<keyof PersonReplacementQualityMetrics>;
}

const personEvidence = /人物|真人|男人|女人|男性|女性|男士|女士|模特|主播|主持|讲解|出镜|脸|面部|半身|全身|person|people|man|woman|presenter|speaker|face|portrait|host/i;
const multiplePeople = /多人|两人|三人|人群|群像|people|crowd|two people|three people/i;
const occlusionEvidence = /遮挡|挡住|捂脸|手遮|快速转身|背对|强侧脸|反光|motion blur|occlusion|profile|back to camera/i;

export function parseReferenceShotRange(value: string): { start: number; end: number } | null {
  const matches = String(value || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!matches.length) return null;
  const start = matches[0] ?? 0;
  const end = matches[1] ?? start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return { start, end };
}

function classifyShot(shot: ReferenceShotForReplacement): { route: PersonReplacementRoute; reasons: string[] } {
  const description = `${shot.visual || ''} ${shot.shot || ''} ${shot.camera || ''}`.trim();
  const count = Number.isFinite(shot.personCount) ? Number(shot.personCount) : multiplePeople.test(description) ? 2 : undefined;
  const hasPerson = shot.hasPerson ?? Boolean((count && count > 0) || personEvidence.test(description));
  if (!hasPerson) return { route: 'preserve', reasons: ['未检测到明确出镜人物，沿用原片'] };
  const reasons: string[] = [];
  if ((count || 0) > 1) reasons.push('多人镜头需要指定替换对象');
  if (shot.needsReview || (shot.confidence !== undefined && shot.confidence < 0.72)) reasons.push('人物识别置信度不足');
  if ((shot.maximumOcclusionRatio || 0) > 0.25 || occlusionEvidence.test(description)) reasons.push('存在遮挡、侧脸或快速动作');
  return reasons.length ? { route: 'review', reasons } : { route: 'replace', reasons: ['单人且画面条件适合逐镜替换'] };
}

const defaultRightsBySource: Record<PersonReplacementSourceKind, PersonReplacementRightsScope> = {
  customer_asset: { analysis: true, derivative: true, commercialPublish: true },
  licensed_asset: { analysis: true, derivative: true, commercialPublish: true },
  external_reference: { analysis: true, derivative: false, commercialPublish: false },
};

function modeFromSelection(selection: PersonReplacementModeSelection | PersonReplacementScope, sourceKind: PersonReplacementSourceKind, shot: ReferenceShotForReplacement): PersonReplacementMode {
  if (selection === 'full_person') return 'expert';
  if (selection === 'face_head_hair') return 'fast';
  if (selection === 'creative_person') return 'creative';
  if (selection !== 'auto') return selection;
  if (sourceKind === 'external_reference') return 'creative';
  const description = `${shot.visual || ''} ${shot.shot || ''}`;
  return /全身|完整人物|换装|full.?body/i.test(description) ? 'expert' : 'fast';
}

export function buildPersonReplacementPlan(
  shots: ReferenceShotForReplacement[],
  selectedMode: PersonReplacementModeSelection | PersonReplacementScope = 'auto',
  options: PersonReplacementPlanningOptions = {},
): PersonReplacementShotPlan[] {
  const sourceKind = options.sourceKind || 'external_reference';
  const rights = { ...defaultRightsBySource[sourceKind], ...(options.rightsScope || {}) };
  return shots.flatMap((shot, index) => {
    const mode = modeFromSelection(selectedMode, sourceKind, shot);
    const contract = PERSON_REPLACEMENT_MODE_CONTRACTS[mode];
    const range = parseReferenceShotRange(shot.time);
    if (!range) return [];
    const classification = classifyShot(shot);
    const output: PersonReplacementShotPlan[] = [];
    // Keep paid provider inputs short and independently retryable.
    for (let start = range.start, part = 0; start < range.end - 0.001; part += 1) {
      const end = Math.min(range.end, start + 10);
      const reasons = [...classification.reasons];
      if (range.end - range.start > 10) reasons.push('原分镜超过 10 秒，已拆成独立生成片段');
      if (mode === 'expert') reasons.push('全人物重演必须通过动作、手部、背景、身份与音轨自动验收');
      if (mode === 'creative') reasons.push('允许重新设计动作、服装、背景、机位与构图');
      const directEditBlocked = sourceKind === 'external_reference' && mode !== 'creative';
      if (directEditBlocked) reasons.push('外部参考仅允许分析，不能直接保留原背景、音轨或受保护画面');
      if (!rights.analysis) reasons.push('当前授权不允许分析源视频');
      if (sourceKind !== 'external_reference' && (!rights.derivative || !rights.commercialPublish)) reasons.push('源视频缺少派生或商业发布授权');
      const rightsBlocked = !rights.analysis || (sourceKind !== 'external_reference' && (!rights.derivative || !rights.commercialPublish));
      const feasibility: PersonReplacementFeasibility = directEditBlocked || rightsBlocked
        ? 'blocked_for_facts_or_rights'
        : sourceKind === 'external_reference'
          ? 'functional_equivalent'
          : classification.route === 'review'
            ? 'goal_degraded'
            : 'full_fidelity';
      const reviewRequired = contract.requiresAutomaticReview && classification.route === 'replace';
      output.push({
        id: `reference-shot-${index + 1}-${part + 1}`,
        start,
        end,
        duration: Number((end - start).toFixed(3)),
        sourceTime: shot.time,
        summary: String(shot.visual || shot.shot || `分镜 ${index + 1}`).trim(),
        route: feasibility === 'blocked_for_facts_or_rights' ? 'blocked' : reviewRequired ? 'review' : classification.route,
        scope: contract.scope,
        mode,
        sourceKind,
        feasibility,
        publicMethodLabel: mode === 'fast' ? '保留原表演，精准替换头部人物特征' : mode === 'expert' ? '保留原表演，更换完整人物' : '按参考镜头功能重新演绎',
        providerOrder: contract.providerOrder,
        lockedElements: contract.lockedElements,
        requiresAutomaticReview: contract.requiresAutomaticReview,
        reasons,
      });
      start = end;
    }
    return output;
  });
}

export function evaluatePersonReplacementQuality(mode: PersonReplacementMode, metrics: PersonReplacementQualityMetrics): PersonReplacementQualityResult {
  const required: Array<keyof PersonReplacementQualityMetrics> = mode === 'creative'
    ? ['identityPassed', 'visibleArtifactCount']
    : mode === 'fast'
      ? ['durationDeltaFrames', 'audioCorrelation', 'backgroundSsim', 'headSilhouetteCoverage', 'identityPassed', 'visibleArtifactCount']
      : ['durationDeltaFrames', 'audioCorrelation', 'backgroundSsim', 'normalizedPoseError', 'handPck', 'identityPassed', 'visibleArtifactCount'];
  const missingMetrics = required.filter(key => metrics[key] === undefined);
  if (missingMetrics.length) return { status: 'needs_measurement', failures: [], missingMetrics };
  const failures: string[] = [];
  if (mode !== 'creative') {
    if ((metrics.durationDeltaFrames || 0) > 1) failures.push('输出与原片时长相差超过 1 帧');
    if ((metrics.audioCorrelation || 0) < 0.995) failures.push('原音轨相关系数低于 0.995');
    const minimum = mode === 'fast' ? 0.98 : 0.95;
    if ((metrics.backgroundSsim || 0) < minimum) failures.push(`蒙版外背景 SSIM 低于 ${minimum}`);
  }
  if (mode === 'expert') {
    if ((metrics.normalizedPoseError || 0) > 0.06) failures.push('身体姿态误差超过画面对角线的 0.06');
    if ((metrics.handPck || 0) < 0.85) failures.push('手部关键点 PCK 低于 0.85');
  }
  if (mode === 'fast' && (metrics.headSilhouetteCoverage || 0) < 0.90) failures.push('目标头发轮廓对原头部区域的覆盖率低于 90%');
  if (metrics.identityPassed !== true) failures.push('目标人物身份未通过');
  if ((metrics.visibleArtifactCount || 0) > 0) failures.push('检测到明显肢体或附件伪影');
  if (failures.length) return { status: 'failed', failures, missingMetrics: [] };
  return { status: mode === 'creative' ? 'manual_review' : 'passed', failures: [], missingMetrics: [] };
}

export function replacementPlanSummary(plan: PersonReplacementShotPlan[]) {
  return {
    total: plan.length,
    replace: plan.filter(item => item.route === 'replace').length,
    preserve: plan.filter(item => item.route === 'preserve').length,
    review: plan.filter(item => item.route === 'review').length,
    blocked: plan.filter(item => item.route === 'blocked').length,
    billableSeconds: Number(plan.filter(item => item.route !== 'preserve' && item.route !== 'blocked').reduce((sum, item) => sum + item.duration, 0).toFixed(2)),
  };
}
