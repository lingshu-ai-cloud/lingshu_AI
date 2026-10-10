import { allocateAigcBudget, type AigcModelOffer, type AigcResolution } from '../../shared/aigcShotPlanning.js';
import { estimateSeedanceCostCny } from '../lib/seedanceBudget.js';
import { planStudioBatchShotRoutes, type StudioBatchShotRoute } from './studioBatchShotRoutes.js';

export interface StudioAigcBudgetSlot {
  id?: string;
  slotId?: string;
  duration?: number;
  priority?: number;
  importance?: number;
}

interface StoryboardBudgetActionPlan {
  sceneType?: string;
  actionStartState?: string;
  actionBeats?: string;
  actionKeyStates?: string;
  actionEndState?: string;
}

const actionParts = (value: string | undefined) => String(value || '').split(/[；;\n]+/).map(item => item.trim()).filter(Boolean);

/** Match the integer-duration video tasks created for each confirmed action beat. */
export function storyboardBudgetConfirmedStageDurations(duration: number, plan: StoryboardBudgetActionPlan | undefined): number[] | null {
  if (!Number.isFinite(duration) || duration <= 0 || !plan?.actionStartState?.trim() || !plan.actionEndState?.trim()) return null;
  const beats = actionParts(plan.actionBeats);
  const states = actionParts(plan.actionKeyStates);
  if (beats.length < 2 || states.length !== beats.length - 1 || duration < beats.length * 4) return null;
  if (Number.isInteger(duration)) {
    const base = Math.floor(duration / beats.length);
    return beats.map((_, index) => base + (index < duration % beats.length ? 1 : 0));
  }
  return beats.map(() => Math.ceil(duration / beats.length - 1e-9));
}

/** Cost envelope for a sequential action. The final segment is at least four
 * seconds, so a total such as 16s is planned as 12s + 4s. */
export function storyboardBudgetSegmentDurations(targetSeconds: number): number[] {
  const total = Math.ceil(targetSeconds);
  if (!Number.isFinite(total) || total <= 15) return [Math.max(4, total || 4)];
  if (total > 300) return [];
  const count = Math.ceil(total / 15);
  const durations: number[] = [];
  let remaining = total;
  for (let index = 0; index < count; index++) {
    const remainingSegments = count - index - 1;
    const current = Math.min(15, remaining - remainingSegments * 4);
    durations.push(current);
    remaining -= current;
  }
  return durations;
}

export function studioAigcBudgetConfigFromEnv() {
  const geometryEnabled = process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED === 'true';
  const geometryCost = Number(process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY || 0.1);
  if (geometryEnabled && (!Number.isFinite(geometryCost) || geometryCost <= 0))
    throw new Error('爆款首帧几何观察费用配置无效，未提交供应商');
  return {
    firstFrameCostCny: Number(process.env.STORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY || 0.3),
    cloneGeometryObservationCostCny: geometryEnabled ? geometryCost : 0,
    maxRetries: Number(process.env.STORYBOARD_AIGC_MAX_RETRIES || 1),
    batchBudgetCny: Number(process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY || 30),
    modelId: String(process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128'),
  };
}

/** Cost-only plan for the existing one-click storyboard flow. Product/first
 * frame readiness remains a separate per-shot gate. No supplier is submitted
 * by this function. */
export function studioAigcBatchBudgetPreview(routes: StudioBatchShotRoute[], input: {
  firstFrameCostCny: number;
  cloneGeometryObservationCostCny?: number;
  creationMode?: string;
  maxRetries: number;
  batchBudgetCny: number;
  modelId: string;
  slots?: StudioAigcBudgetSlot[];
  actionPlans?: Record<string, StoryboardBudgetActionPlan | undefined>;
  requestedResolutions?: Record<string, AigcResolution | undefined>;
  offers?: AigcModelOffer[];
  preferredResolution?: AigcResolution;
}) {
  const active = routes.filter(route => route.route === 'aigc_first_frame');
  const byId = new Map((input.slots || []).flatMap(slot => [slot.id, slot.slotId].filter(Boolean).map(id => [id!, slot] as const)));
  const maxRetries = Number.isInteger(input.maxRetries) ? Math.max(0, input.maxRetries) : 0;
  const firstFrameCost = Number.isFinite(input.firstFrameCostCny) ? Math.max(0, input.firstFrameCostCny) : 0;
  const cloneGeometryCost = input.creationMode === 'clone' && Number.isFinite(input.cloneGeometryObservationCostCny)
    ? Math.max(0, Number(input.cloneGeometryObservationCostCny)) : 0;
  const budgetCny = Number.isFinite(input.batchBudgetCny) ? Math.max(0, input.batchBudgetCny) : 0;
  const offers: AigcModelOffer[] = input.offers || [{
    modelId: input.modelId, resolutions: ['480p', '720p'], minDurationSeconds: 4, maxDurationSeconds: 15,
    firstFrameCostCny: firstFrameCost,
    videoCostCnyPerSecond: { '480p': estimateSeedanceCostCny(1, '480p'), '720p': estimateSeedanceCostCny(1, '720p') },
  }];
  const candidates = active.map(route => {
    const slot = byId.get(route.slotId) || byId.get(route.shotId);
    const raw = Number(slot?.duration);
    const requested = input.requestedResolutions?.[route.slotId] || input.requestedResolutions?.[route.shotId];
    const actionPlan = input.actionPlans?.[route.slotId] || input.actionPlans?.[route.shotId];
    const usageScene = route.visualTopic === 'usage_scene' || actionPlan?.sceneType === 'usage';
    const confirmedStages = usageScene ? storyboardBudgetConfirmedStageDurations(raw, actionPlan) : null;
    return { shotId: route.shotId, targetDurationSeconds: Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 4,
      priority: Number(slot?.priority ?? slot?.importance ?? 0) || 0,
      requestedResolution: requested === '480p' || requested === '720p' ? requested : undefined,
      firstFrameSurchargeCny: cloneGeometryCost,
      segmentDurations: confirmedStages || (usageScene && Number.isFinite(raw) && raw > 15
        ? storyboardBudgetSegmentDurations(raw) : undefined) };
  });
  const shotPlans = allocateAigcBudget({ candidates, offers, budgetCny, maxRetries, preferredResolution: input.preferredResolution });
  const total = routes.length;
  const costAt = (tier: AigcResolution) => Math.round(candidates.reduce((sum, candidate) => {
    const segments = candidate.segmentDurations?.length ? candidate.segmentDurations : [Math.max(4, candidate.targetDurationSeconds)];
    const duration = segments.reduce((total, segment) => total + segment, 0);
    const compatible = offers.filter(offer => offer.resolutions.includes(tier)
      && segments.every(segment => offer.minDurationSeconds <= segment && offer.maxDurationSeconds >= segment)
      && offer.videoCostCnyPerSecond[tier] !== null);
    if (!compatible.length) return sum;
    return sum + Math.min(...compatible.map(offer => (offer.firstFrameCostCny + (candidate.firstFrameSurchargeCny || 0)
      + duration * (offer.videoCostCnyPerSecond[tier] || 0)) * (maxRetries + 1)));
  }, 0) * 100) / 100;
  const estimate480pCny = costAt('480p');
  const estimate720pCny = costAt('720p');
  const estimatedCostCny = Math.round(shotPlans.reduce((sum, plan) => sum + plan.estimatedCostCny, 0) * 100) / 100;
  const readyShots = shotPlans.filter(plan => plan.status === 'ready').length;
  return {
    planningOnly: true as const, modelId: input.modelId, totalShots: total, aigcShots: active.length,
    aigcShotRatio: total ? Math.round(active.length / total * 100) / 100 : 0,
    candidateDurationSeconds: 4 as const, maxRetries, estimate480pCny, estimate720pCny,
    batchBudgetCny: budgetCny,
    recommendedResolution: (estimate720pCny <= budgetCny ? '720p' : '480p') as AigcResolution,
    budgetEnoughFor480p: estimate480pCny <= budgetCny,
    shotPlans, readyShots, excludedShots: active.length - readyShots, estimatedCostCny,
    budgetRemainingCny: Math.round((budgetCny - estimatedCostCny) * 100) / 100,
  };
}

/** Shared source of truth for preview and the supplier-submission gate. Digital
 * human readiness does not affect selection of non-presenter AIGC routes. */
export function studioAigcBudgetPreviewForSpec(
  spec: Parameters<typeof planStudioBatchShotRoutes>[0],
  input: Omit<Parameters<typeof studioAigcBatchBudgetPreview>[1], 'slots' | 'requestedResolutions' | 'actionPlans'>,
) {
  const routes = planStudioBatchShotRoutes(spec, {
    talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [],
  });
  return studioAigcBatchBudgetPreview(routes, { ...input, slots: Array.isArray(spec.shootingSlots) ? spec.shootingSlots : [],
    creationMode: spec.mode,
    actionPlans: spec.storyboardSourcePlans || {},
    requestedResolutions: Object.fromEntries(Object.entries(spec.storyboardSourcePlans || {}).map(([id, plan]) => [id,
      plan.videoResolutionPinned && (plan.videoResolution === '480p' || plan.videoResolution === '720p') ? plan.videoResolution : undefined])),
  });
}
