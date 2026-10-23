/** Platform-free binding rules shared by Studio, the task API and native preview. */
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const identity = (value: unknown): string => text(value).replace(/^replication-/, '');
const media = (value: unknown): string => /^https:\/\//i.test(text(value)) || /^\/(?!\/)/.test(text(value)) ? text(value) : '';

export interface ShootingSourceBinding {
  sourceProjectId: string;
  sourceAssemblyId: string;
  sourceStoryboardSlotId: string;
  sourceShotId: string;
  requirements: string;
}
export class ShootingBindingError extends Error {
  readonly code = 'shooting_source_changed';
  constructor() { super('原草稿或分镜要求已变化，请保存草稿后重新安排拍摄'); }
}
/** Always use the acknowledged saved project, not stale component state. */
export function shootingSourceBinding(projectValue: unknown, storyboardSlotId: string,
  expected?: { assemblyId: string; requirements: string }): ShootingSourceBinding {
  const project = row(projectValue), spec = row(project.spec);
  const matches = rows(spec.shootingSlots).filter(slot => text(slot.slotId) === storyboardSlotId);
  const slot = matches[0];
  if (!text(project.id) || !storyboardSlotId || matches.length !== 1 || !text(slot?.id) || !text(slot?.requirements)
    || !text(spec.activeAssemblyId) || (expected && (expected.assemblyId !== spec.activeAssemblyId || expected.requirements !== slot.requirements))) {
    throw new ShootingBindingError();
  }
  return { sourceProjectId: text(project.id), sourceAssemblyId: text(spec.activeAssemblyId),
    sourceStoryboardSlotId: text(slot.slotId), sourceShotId: text(slot.id), requirements: String(slot.requirements) };
}

export interface ShootingReferencePreview {
  url: string; poster: string; start: number; end: number; rangeText: string;
  sourceLabel: string; description: string; referenceRecordId?: string; referenceShotId?: string;
}
/** A persisted task snapshot contains identity and time, never bearer URLs. */
export interface ShootingReferenceClip {
  schemaVersion: 'shooting-reference.v1';
  projectId: string; shotId: string; storyboardSlotId: string;
  videoId: string; referenceShotId: string; startSeconds: number; endSeconds: number; description: string;
}

export function shootingReferencePreview(taskValue: unknown, projectValue: unknown): ShootingReferencePreview | null {
  const task = row(taskValue), project = row(projectValue), spec = row(project.spec);
  if (!text(task.sourceProjectId) || text(project.id) !== text(task.sourceProjectId)) return null;
  const matches = rows(spec.shootingSlots).filter(slot => text(task.sourceShotId)
    ? text(slot.id) === text(task.sourceShotId) : text(slot.slotId) === text(task.sourceStoryboardSlotId));
  if (matches.length !== 1) return null;
  const slot = matches[0];
  if (text(task.sourceStoryboardSlotId) && text(slot.slotId) !== text(task.sourceStoryboardSlotId)) return null;
  if (task.requirements && task.requirements !== slot.requirements) return null;
  const timeline = rows(Array.isArray(spec.storyboardTimeline) ? spec.storyboardTimeline : row(row(spec.analysisResults).storyboard).slots);
  const matchingTimeline = timeline.filter(item => text(item.id) === text(slot.slotId));
  if (matchingTimeline.length > 1) return null;
  const index = timeline.findIndex(item => text(item.id) === text(slot.slotId));
  let sourceId = identity(matchingTimeline[0]?.sourceShotId);
  const ids = Array.isArray(spec.socialSourceShotIds) ? spec.socialSourceShotIds.map(identity) : [];
  if (!sourceId && index >= 0 && ids.length === timeline.length && ids.every(Boolean) && new Set(ids).size === ids.length) sourceId = ids[index];
  if (!sourceId) sourceId = identity(slot.slotId);
  const kickoff = row(spec.videoKickoff);
  const analysis = row(kickoff.referenceAnalysis || row(spec.analysisResults).reference);
  const references = rows(analysis.details).filter(detail => identity(detail.shotId) === sourceId);
  if (!sourceId || references.length !== 1) return null;
  const detail = references[0];
  const range = text(detail.time).match(/^\[?(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\]?$/i);
  if (!range) return null;
  const start = Number(range[1]), end = Number(range[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const video = row(kickoff.video);
  const url = media(row(video.aiAnalysis).materialUrl) || media(video.videoUrl);
  const referenceRecordId = text(video.referenceRecordId);
  if ((!url && !referenceRecordId) || video.contentFormat === 'image') return null;
  return { url, poster: media(detail.firstFrameRef) || media(video.thumbnail), start, end,
    rangeText: start.toFixed(1) + '–' + end.toFixed(1) + ' 秒', sourceLabel: '对标分镜', description: text(detail.visual),
    ...(referenceRecordId ? { referenceRecordId } : {}), referenceShotId: text(detail.shotId) };
}

export function shootingReferenceClip(task: ShootingSourceBinding, project: unknown): ShootingReferenceClip | undefined {
  const preview = shootingReferencePreview(task, project);
  if (!preview?.referenceRecordId || !preview.referenceShotId) return undefined;
  return { schemaVersion: 'shooting-reference.v1', projectId: task.sourceProjectId, shotId: task.sourceShotId,
    storyboardSlotId: task.sourceStoryboardSlotId, videoId: preview.referenceRecordId, referenceShotId: preview.referenceShotId,
    startSeconds: preview.start, endSeconds: preview.end, description: preview.description };
}

export function taskReferencePreview(taskValue: unknown): ShootingReferencePreview | null {
  const task = row(taskValue), clip = row(task.referenceClip);
  if (clip.schemaVersion !== 'shooting-reference.v1' || !text(task.sourceProjectId) || !text(task.sourceShotId)
    || !text(task.sourceStoryboardSlotId) || !text(task.requirements) || !text(task.sourceAssemblyId)
    || clip.projectId !== task.sourceProjectId || clip.shotId !== task.sourceShotId || clip.storyboardSlotId !== task.sourceStoryboardSlotId
    || !text(clip.videoId) || !text(clip.referenceShotId) || typeof clip.startSeconds !== 'number' || typeof clip.endSeconds !== 'number'
    || !Number.isFinite(clip.startSeconds) || !Number.isFinite(clip.endSeconds) || clip.startSeconds < 0 || clip.endSeconds <= clip.startSeconds) return null;
  return { url: '', poster: '', referenceRecordId: text(clip.videoId), referenceShotId: text(clip.referenceShotId),
    start: clip.startSeconds, end: clip.endSeconds, rangeText: clip.startSeconds.toFixed(1) + '–' + clip.endSeconds.toFixed(1) + ' 秒',
    sourceLabel: '对标分镜', description: text(clip.description) };
}
