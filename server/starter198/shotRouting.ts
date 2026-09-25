import type {
  ShotRoutingAvailability,
  ShotRoutingDecision,
  ShotRoutingRequirements,
  ShotRoutingRoute,
} from '../../shared/contracts/shotRouting.js';

const LOW_CONFIDENCE = 0.8;

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function overallConfidence(input: ShotRoutingRequirements): number {
  const values = Object.values(input.confidence).map(clampConfidence);
  return values.length ? Math.round((Math.min(...values) * 100)) / 100 : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function candidateRoutes(input: ShotRoutingRequirements): ShotRoutingRoute[] {
  if (input.identityRequirement === 'enterprise_presenter') {
    if (input.backgroundRequirement !== 'flexible' || input.referenceUse === 'first_frame_composition') {
      return ['first_frame_video', 'presenter_talking', 'material_edit'];
    }
    return ['presenter_talking', 'first_frame_video', 'material_edit'];
  }
  if (input.identityRequirement === 'industry_role') return ['ugc_actor', 'material_edit', 'ai_broll'];
  if (input.shotType === 'information_card') return ['material_edit', 'ai_broll'];
  return ['material_edit', 'ai_broll'];
}

function capabilitiesFor(route: ShotRoutingRoute, input: ShotRoutingRequirements): string[] {
  if (route === 'presenter_talking') return ['enterprise_identity', 'precise_lip_sync', 'short_clip_generation'];
  if (route === 'first_frame_video') return unique([
    'enterprise_identity', 'target_presenter_first_frame', 'short_clip_generation',
    input.backgroundRequirement !== 'flexible' ? 'background_composition_preservation' : '',
    input.speechRequirement === 'precise_lip_sync' ? 'precise_lip_sync' : '',
  ]);
  if (route === 'ugc_actor') return ['synthetic_industry_role', 'short_clip_generation'];
  if (route === 'material_edit') return ['authorized_material_or_enterprise_asset_editing'];
  return ['non_evidentiary_ai_broll'];
}

function routeAvailable(route: ShotRoutingRoute, input: ShotRoutingRequirements, availability: ShotRoutingAvailability): boolean {
  if (!availability.budgetAvailable) return false;
  if (route === 'presenter_talking') return availability.enterprisePresenterReady && availability.presenterTalkingAvailable;
  if (route === 'first_frame_video') return availability.enterprisePresenterReady
    && availability.enterprisePresenterImageReady
    && availability.firstFrameVideoAvailable
    && (input.motionRequirement !== 'authorized_reference_motion' || availability.authorizedReferenceMotion);
  if (route === 'ugc_actor') return availability.ugcActorAvailable;
  if (route === 'material_edit') return availability.materialEditAvailable;
  return availability.aiBrollAvailable;
}

function routeBlockers(route: ShotRoutingRoute, input: ShotRoutingRequirements, availability: ShotRoutingAvailability): string[] {
  const blockers: string[] = [];
  if (!availability.budgetAvailable) blockers.push('预算不可用');
  if ((route === 'presenter_talking' || route === 'first_frame_video') && !availability.enterprisePresenterReady) blockers.push('缺少已授权的企业人物资产');
  if (route === 'first_frame_video' && !availability.enterprisePresenterImageReady) blockers.push('缺少可用于目标人物首帧的可信图片资产');
  if (route === 'presenter_talking' && !availability.presenterTalkingAvailable) blockers.push('人物口播能力当前不可用');
  if (route === 'first_frame_video' && !availability.firstFrameVideoAvailable) blockers.push('首帧驱动视频能力当前不可用');
  if (route === 'ugc_actor' && !availability.ugcActorAvailable) blockers.push('AI 行业角色能力当前不可用');
  if (route === 'material_edit' && !availability.materialEditAvailable) blockers.push('素材剪辑能力当前不可用');
  if (route === 'ai_broll' && !availability.aiBrollAvailable) blockers.push('AI 补镜能力当前不可用');
  if (route === 'first_frame_video' && input.motionRequirement === 'authorized_reference_motion' && !availability.authorizedReferenceMotion) blockers.push('缺少已授权的参考动作输入');
  return unique(blockers);
}

/**
 * Deterministically maps a verified shot requirement to a capability route.
 * It deliberately does not select HeyGen, Seedance, SD or another provider.
 */
export function decideShotRoute(
  requirements: ShotRoutingRequirements,
  availability: ShotRoutingAvailability,
): ShotRoutingDecision {
  const candidates = candidateRoutes(requirements);
  const preferredRoute = candidates[0]!;
  const confidence = overallConfidence(requirements);
  const evidenceMissing = requirements.evidence.keyframeIds.length === 0 && !requirements.evidence.asrText
    && requirements.evidence.materialIds.length === 0;
  const primaryBlockers = routeBlockers(preferredRoute, requirements, availability);
  const executable = routeAvailable(preferredRoute, requirements, availability) && !evidenceMissing;
  const requiresUserConfirmation = confidence < LOW_CONFIDENCE
    || evidenceMissing
    || (requirements.identityRequirement === 'enterprise_presenter'
      && (requirements.backgroundRequirement !== 'flexible' || requirements.referenceUse !== 'structure_only'))
    || requirements.motionRequirement === 'authorized_reference_motion';
  const blockers = unique([
    ...primaryBlockers,
    ...(evidenceMissing ? ['缺少关键帧、ASR 或素材证据，不能自动执行'] : []),
  ]);
  const status = blockers.length ? (evidenceMissing || primaryBlockers.some(item => item.startsWith('缺少')) ? 'needs_input' : 'blocked') : 'ready';
  const reasons = [
    `镜头类型：${requirements.shotType}`,
    `叙事用途：${requirements.visualRole || '未说明'}`,
    requirements.identityRequirement === 'enterprise_presenter' ? '需要使用企业人物身份' : requirements.identityRequirement === 'industry_role' ? '只需行业角色，不复刻参考人物身份' : '不需要固定人物身份',
    requirements.speechRequirement === 'precise_lip_sync' ? '需要精确口型' : requirements.speechRequirement === 'voiceover_ok' ? '可使用后配音' : '无需口播',
    requirements.backgroundRequirement !== 'flexible' ? '需要保留背景或构图' : '场景可以重新设计',
  ];
  return {
    route: preferredRoute,
    fallbackRoutes: candidates.slice(1),
    confidence,
    reasons,
    requiresUserConfirmation,
    status,
    executable,
    blockers,
    requiredCapabilities: capabilitiesFor(preferredRoute, requirements),
    evidence: structuredClone(requirements.evidence),
  };
}
