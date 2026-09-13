/** Shared, side-effect-free shot identity and refill policy. */
export interface ShootingSlot {
  id: string;
  slotId: string;
  detail: string;
  requirements: string;
  duration: number;
}

export interface ScriptGapTask {
  id: string;
  origin: 'script_gap';
  title: string;
  productLabel: string;
  themeTitle: string;
  shotBrief: string;
  suggestedDurationSec: number;
  sourceProjectId?: string;
  sourceStoryboardSlotId?: string;
  sourceAssemblyId?: string;
  sourceShotId?: string;
  requirements?: string;
  /** Initial refill accepts silent footage; recorded dialogue needs transcription/alignment. */
  soundMode?: 'voiceover' | 'source' | 'silent';
  expectedNarration?: string;
  createdAt: string;
  uploadedMaterialIds: string[];
}

export function reconcileShootingSlots(
  previous: ShootingSlot[],
  slots: Array<{ id: string; detail: string; start: number; end: number }>,
  context: string | ((slotId: string) => string),
  newId: () => string,
): ShootingSlot[] {
  const sameOrder = previous.length === slots.length && previous.every((item, i) => item.detail === slots[i].detail);
  return slots.map((slot, i) => {
    // Unique unchanged content survives reorder. Ambiguous repeated shots fail closed after edits.
    const matches = previous.filter(item => item.detail === slot.detail);
    const unique = slots.filter(item => item.detail === slot.detail).length === 1;
    const old = sameOrder ? previous[i] : unique && matches.length === 1 ? matches[0] : undefined;
    const duration = Math.round(Math.max(0.5, slot.end - slot.start) * 100) / 100;
    return {
      id: old?.id || newId(), slotId: slot.id, detail: slot.detail, duration,
      requirements: JSON.stringify({ detail: slot.detail, duration, context: typeof context === 'function' ? context(slot.id) : context }),
    };
  });
}

export function transcriptMatches(actual: string | undefined, expected: string | undefined): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  return Boolean(actual?.trim() && expected?.trim() && normalize(actual) === normalize(expected));
}

export function shootingRefillTarget(
  task: ScriptGapTask,
  context: { projectId: string; assemblyId: string; slots: ShootingSlot[]; assignments: Record<string, string>; confirmed: Record<string, boolean> },
): { slot?: ShootingSlot; reason: string } {
  if (task.sourceProjectId !== context.projectId || task.sourceAssemblyId !== context.assemblyId) return { reason: '不属于当前草稿版本' };
  if (!task.sourceShotId || !task.requirements) return { reason: '旧任务缺少稳定分镜绑定，请手动选用' };
  const slot = context.slots.find(item => item.id === task.sourceShotId);
  if (!slot) return { reason: '原分镜已删除或内容已变化，素材保留为候选' };
  if (slot.requirements !== task.requirements) return { reason: '拍摄要求已变化，请人工确认候选' };
  if (context.assignments[slot.slotId] || context.confirmed[slot.slotId]) return { reason: '当前镜头已有画面或已确认，不自动覆盖' };
  if (!task.uploadedMaterialIds.length) return { reason: '等待上传' };
  return { slot, reason: '' };
}
