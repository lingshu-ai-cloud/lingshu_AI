import type { SubCue } from '../../lib/studioApi';
import type { ShotProduction } from '../../lib/shotProduction';

export interface StoryboardSlot {
  id: string;
  /** Immutable source-task identity; unlike `id`, it survives Studio reordering. */
  sourceShotId?: string;
  time: string;
  start: number;
  end: number;
  title: string;
  detail: string;
}

/** Keep every storyboard shot, but make each language version end with its real voiceover. */
export function fitTimelineToVoiceover<T extends {
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  targetStart?: number;
  targetEnd?: number;
  targetDuration: number;
}>(timeline: T[], voiceoverDuration: number): T[] {
  const sourceDuration = timeline.reduce((sum, item) => sum + Math.max(0, Number(item.targetDuration) || 0), 0);
  if (!timeline.length || !Number.isFinite(voiceoverDuration) || voiceoverDuration <= 0 || sourceDuration <= 0) return timeline;
  // A shorter voiceover may end before the visuals, but must not compress an
  // approved storyboard. Only extend the visual timeline when narration needs
  // more room so captions and speech are not cut off.
  if (voiceoverDuration <= sourceDuration) return timeline;
  const minimumShotDuration = Math.min(0.5, voiceoverDuration / timeline.length);
  const scale = voiceoverDuration / sourceDuration;
  let cursor = 0;
  return timeline.map((item, index) => {
    const isLast = index === timeline.length - 1;
    const remainingShots = timeline.length - index - 1;
    const remainingRoom = Math.max(minimumShotDuration, voiceoverDuration - cursor - remainingShots * minimumShotDuration);
    const targetDuration = isLast
      ? Math.max(minimumShotDuration, voiceoverDuration - cursor)
      : Math.min(remainingRoom, Math.max(minimumShotDuration, item.targetDuration * scale));
    const targetStart = cursor;
    cursor += targetDuration;
    const sourceClipDuration = Math.max(0, (Number(item.trimEnd) || 0) - (Number(item.trimStart) || 0));
    return {
      ...item,
      targetStart: +targetStart.toFixed(3),
      targetEnd: +(isLast ? voiceoverDuration : cursor).toFixed(3),
      targetDuration: +targetDuration.toFixed(3),
      speed: sourceClipDuration > 0 ? Math.max(0.25, Math.min(4, sourceClipDuration / targetDuration)) : item.speed,
    };
  });
}

/** Align one narration cue with one storyboard shot for each language version. */
export function fitTimelineToVoiceoverCues<T extends {
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  targetStart?: number;
  targetEnd?: number;
  targetDuration: number;
}>(timeline: T[], voiceoverDuration: number, cues?: SubCue[]): T[] {
  if (!cues?.length || cues.length !== timeline.length) return fitTimelineToVoiceover(timeline, voiceoverDuration);
  if (!Number.isFinite(voiceoverDuration) || voiceoverDuration <= 0) return timeline;
  const boundaries = [0, ...cues.slice(1).map(cue => Number(cue.start)), voiceoverDuration];
  if (boundaries.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value <= boundaries[index - 1]))) {
    return fitTimelineToVoiceover(timeline, voiceoverDuration);
  }
  return timeline.map((item, index) => {
    const targetStart = boundaries[index];
    const targetEnd = boundaries[index + 1];
    const targetDuration = targetEnd - targetStart;
    const sourceClipDuration = Math.max(0, (Number(item.trimEnd) || 0) - (Number(item.trimStart) || 0));
    return {
      ...item,
      targetStart: +targetStart.toFixed(3),
      targetEnd: +targetEnd.toFixed(3),
      targetDuration: +targetDuration.toFixed(3),
      speed: sourceClipDuration > 0 ? Math.max(0.25, Math.min(4, sourceClipDuration / targetDuration)) : item.speed,
    };
  });
}

export function fitStoryboardSlotsToDuration(slots: StoryboardSlot[], duration: number): StoryboardSlot[] {
  const sourceDuration = slots.reduce((max, slot) => Math.max(max, slot.end), 0);
  if (!slots.length || !Number.isFinite(duration) || duration <= 0 || sourceDuration <= 0) return slots;
  if (duration <= sourceDuration) return slots;
  const scale = duration / sourceDuration;
  return slots.map((slot, index) => {
    const start = index === 0 ? 0 : slot.start * scale;
    const end = index === slots.length - 1 ? duration : slot.end * scale;
    return { ...slot, start: +start.toFixed(3), end: +end.toFixed(3), time: `${start.toFixed(1)}s-${end.toFixed(1)}s` };
  });
}

export function followAdoptedDigitalHumanSlotDurations(
  slots: StoryboardSlot[], assignments: Record<string, string>, productions: Record<string, ShotProduction>, materialDurations: Map<string, number>,
  assemblyId: string, persistedShotIds: Record<string, string>, digitalHumanMaterialIds: ReadonlySet<string> = new Set(),
): StoryboardSlot[] {
  let cursor = slots[0]?.start || 0;
  return slots.map(slot => {
    const materialId = assignments[slot.id] || '';
    const persistedShotId = persistedShotIds[slot.id] || slot.id;
    const shot = productions[`${assemblyId}:${persistedShotId}`];
    const adoptedAvatar = Boolean(shot?.candidates.some(candidate => candidate.id === shot.adoptedId
      && candidate.source === 'avatar' && candidate.materialId === materialId));
    const measured = adoptedAvatar || digitalHumanMaterialIds.has(materialId) ? materialDurations.get(materialId) : undefined;
    const length = measured && measured > 0 ? measured : Math.max(0.5, slot.end - slot.start);
    const start = cursor, end = cursor + length; cursor = end;
    return { ...slot, start: +start.toFixed(3), end: +end.toFixed(3), time: `${start.toFixed(1)}s-${end.toFixed(1)}s` };
  });
}
