import { salesPresenterRecognition, type SalesPresenterEvidence } from '../../../shared/contracts/presenterShotRecognition';
import type { ShotProduction } from '../../lib/shotProduction';
import { isClipCompatibleWithRatio, verifiedStoryboardSegment, effectiveClipDuration, matchMaterialsToStoryboardLocally, assessMaterialMatch, type MaterialMatchAssessment } from './studioStoryboardMaterialMatching';
import { isProductionEligibleClip, type Clip } from './studioSourceMaterial';
import { clipSourceMode } from './studioMaterialPresentation';
import type { StoryboardSlot } from './studioTimelineFitting';
import type { VideoKickoff } from './studioVideoKickoff';
import type { StoryboardAssembly, StoryboardSourcePlan, ClipEdit } from './studioWorkspaceContracts';

export interface StudioMaterialAssignmentInput {
  allVisuals: Clip[];
  videoKickoff: VideoKickoff | null;
  socialViralTask: boolean;
  ratio: string;
  selected: string[];
  hookMaterialId: string;
  activeAssemblyId: string;
  assemblyName: string;
  storyboardSlots: StoryboardSlot[];
  storyboardAssignments: Record<string, string>;
  storyboardSourcePlans: Record<string, StoryboardSourcePlan>;
  storyboardAssemblies: StoryboardAssembly[];
  personContinuityBySlot: Record<string, string>;
  productionFor: (slot: StoryboardSlot) => Pick<ShotProduction, 'locked'>;
  presenterEvidenceFor: (slot: StoryboardSlot) => SalesPresenterEvidence;
  shotRouteFor: (slot: StoryboardSlot) => string;
  sourcePlanFor: (slot: StoryboardSlot) => StoryboardSourcePlan;
  slotClipEditKey: (slotId: string, materialId: string) => string;
  defaultEditForSlot: (clip: Clip, slot: StoryboardSlot) => ClipEdit;
}

/** Pure cross-shot evidence plan. Request execution and result commit stay
 * together in the page's existing material-selection lifecycle. */
export function planStudioMaterialAssignments(input: StudioMaterialAssignmentInput) {
  const {
    allVisuals, videoKickoff, socialViralTask, ratio,
    selected, hookMaterialId, activeAssemblyId, assemblyName,
    storyboardSlots, storyboardAssignments, storyboardSourcePlans, storyboardAssemblies,
    personContinuityBySlot, productionFor, presenterEvidenceFor, shotRouteFor,
    sourcePlanFor, slotClipEditKey, defaultEditForSlot,
  } = input;
  const matchingMaterialById = new Map(allVisuals.map(item => [item.id, item]));
  const compatiblePool = allVisuals.filter(item => isClipCompatibleWithRatio(item, ratio));
  const savedCurrent: StoryboardAssembly = {
    id: activeAssemblyId,
    name: assemblyName,
    assignments: storyboardAssignments,
    sourcePlans: storyboardSourcePlans,
    selected,
  };
  const allPlans = storyboardAssemblies.map(item => item.id === activeAssemblyId ? savedCurrent : item);
  const variantIndex = Math.max(0, allPlans.findIndex(item => item.id === activeAssemblyId));
  const previousAssignments = allPlans
    .filter(item => item.id !== activeAssemblyId)
    .map(item => item.assignments)
    .filter(item => Object.keys(item).length > 0);
  // 所有视觉素材都可参与匹配；同方向优先，其他方向在渲染时居中裁切。
  const pool = allVisuals;
  const usesCropFallback = compatiblePool.length < Math.min(storyboardSlots.length, allVisuals.length);
  const lockedAssignments = Object.fromEntries(Object.entries(storyboardAssignments).filter(([slotId, clipId]) => (
    storyboardSlots.some(slot => slot.id === slotId && (() => {
      const clip = matchingMaterialById.get(clipId);
      return Boolean(clip && isProductionEligibleClip(clip, videoKickoff)
        && (socialViralTask
          ? storyboardSourcePlans[slotId]?.userSource === 'material' && storyboardSourcePlans[slotId]?.confirmed
          : storyboardSourcePlans[slotId]?.confirmed || assessMaterialMatch(slot, clip, ratio).level === 'direct'));
    })())
  )));
  const lockedClipIds = new Set(Object.values(lockedAssignments));
  const slotsToMatch = storyboardSlots.filter(slot => {
    if (lockedAssignments[slot.id]) return false;
    if (productionFor(slot).locked || storyboardSourcePlans[slot.id]?.mode === 'ai' || storyboardSourcePlans[slot.id]?.mode === 'hybrid') return false;
    if (!socialViralTask) return true;
    const foregroundIdentity = salesPresenterRecognition(presenterEvidenceFor(slot)) === 'confirmed';
    return shotRouteFor(slot) === 'material' && (!foregroundIdentity || storyboardSourcePlans[slot.id]?.userSource === 'material');
  });
  if (!slotsToMatch.length) {
    return { kind: 'already_assigned' as const };
  }
  const unusedPool = pool.filter(item => !lockedClipIds.has(item.id));
  const matchPool = unusedPool.length ? unusedPool : pool;
  const candidateAssignments = matchMaterialsToStoryboardLocally(matchPool, slotsToMatch, selected.filter(id => id !== hookMaterialId), {
    variantIndex,
    previousAssignments,
    targetRatio: ratio,
    requireSegmentEvidence: socialViralTask,
  });
  // Identity is a cross-shot constraint. A semantic match of three
  // different faces cannot fill three cuts of the same source person.
  const continuityGroups = new Map<string, StoryboardSlot[]>();
  storyboardSlots.forEach(slot => {
    const id = personContinuityBySlot[slot.id];
    if (id) continuityGroups.set(id, [...(continuityGroups.get(id) || []), slot]);
  });
  for (const group of continuityGroups.values()) {
    if (group.length < 2 || !group.some(slot => slotsToMatch.includes(slot))) continue;
    const lockedIds = [...new Set(group.map(slot => lockedAssignments[slot.id]).filter(Boolean))];
    const common = lockedIds.length > 1 ? undefined : pool.find(clip =>
      (!lockedIds.length || clip.id === lockedIds[0])
      && clip.type === 'video'
      && effectiveClipDuration(clip) >= group.reduce((sum, slot) => sum + slot.end - slot.start, 0)
      && group.every(slot => socialViralTask
        ? Boolean(verifiedStoryboardSegment(clip, slot))
        : assessMaterialMatch(slot, clip, ratio).level !== 'missing'));
    group.forEach(slot => {
      if (lockedAssignments[slot.id]) return;
      if (common) candidateAssignments[slot.id] = common.id;
      else delete candidateAssignments[slot.id];
    });
  }
  const assessmentBySlot: Record<string, MaterialMatchAssessment> = {};
  const matchedAssignments = Object.fromEntries(Object.entries(candidateAssignments).filter(([slotId, clipId]) => {
    const slot = storyboardSlots.find(item => item.id === slotId);
    const clip = matchingMaterialById.get(clipId);
    if (!slot || !clip) return false;
    const assessment = assessMaterialMatch(slot, clip, ratio);
    assessmentBySlot[slotId] = assessment;
    // Below 60 points the material is only a visual placeholder, not a
    // trustworthy match. Leave the shot open instead of silently filling it.
    return socialViralTask
      ? Boolean(verifiedStoryboardSegment(clip, slot))
      : assessment.level !== 'missing';
  }));
  const assignments = { ...lockedAssignments, ...matchedAssignments };
  storyboardSlots.forEach(slot => {
    const clip = matchingMaterialById.get(assignments[slot.id] || '');
    if (clip && !assessmentBySlot[slot.id]) assessmentBySlot[slot.id] = assessMaterialMatch(slot, clip, ratio);
  });
  const orderedIds = storyboardSlots.map(slot => assignments[slot.id]).filter((id): id is string => Boolean(id));
  const nextEdits: Record<string, ClipEdit> = {};
  const nextPlans: Record<string, StoryboardSourcePlan> = {};
  slotsToMatch.forEach(slot => {
    const clipId = matchedAssignments[slot.id];
    const clip = clipId ? matchingMaterialById.get(clipId) : undefined;
    if (!clip) {
      nextPlans[slot.id] = {
        ...sourcePlanFor(slot),
        confirmed: false,
        matchScore: 0,
        matchLevel: 'missing',
        matchReason: '企业素材库中没有通过逐片段画面校验的高匹配素材',
        matchDifference: '保留为空，等待上传、拍摄或手动指定',
      };
      return;
    }
    nextEdits[slotClipEditKey(slot.id, clip.id)] = defaultEditForSlot(clip, slot);
    const detectedSource = clipSourceMode(clip);
    nextPlans[slot.id] = {
      ...sourcePlanFor(slot),
      mode: detectedSource,
      decided: true,
      confirmed: false,
      generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
      error: '',
      matchScore: assessmentBySlot[slot.id]?.score,
      matchReason: assessmentBySlot[slot.id]?.reason,
      matchDifference: assessmentBySlot[slot.id]?.difference,
      matchLevel: assessmentBySlot[slot.id]?.level,
    };
  });

  return { kind: 'planned' as const, assignments, nextPlans, nextEdits, orderedIds,
    matchedCount: Object.keys(matchedAssignments).length, usesCropFallback,
    reviewCount: storyboardSlots.filter(slot => assessmentBySlot[slot.id]?.level === 'review' && assignments[slot.id]).length,
    missingCount: storyboardSlots.filter(slot => !assignments[slot.id]).length };
}
