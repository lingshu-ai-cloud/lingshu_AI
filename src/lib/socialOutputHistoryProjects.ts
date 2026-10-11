import type { StudioProject } from './studioApi';
import type { OwnedReviewMedia } from './socialReviewOwnedMedia';

export function socialOutputOwnedReviewMedia(project: StudioProject): OwnedReviewMedia | null {
  const automation = project.spec.automation;
  const output = project.spec.socialProductionOutput;
  const taskId = typeof project.spec.socialContentTaskId === 'string' ? project.spec.socialContentTaskId.trim() : '';
  const sha256 = typeof project.spec.renderOutputSha256 === 'string' ? project.spec.renderOutputSha256.trim().toLowerCase() : '';
  if (!automation || typeof automation !== 'object' || Array.isArray(automation)
    || (automation as Record<string, unknown>).managedBy !== 'social_content_output'
    || !output || typeof output !== 'object' || Array.isArray(output)) return null;
  const lineage = output as Record<string, unknown>;
  const artifactId = typeof lineage.artifactId === 'string' ? lineage.artifactId.trim() : '';
  if (lineage.type !== 'social_production_artifact' || lineage.version !== 1
    || lineage.taskId !== taskId || lineage.fileSha256 !== sha256 || !taskId || !artifactId
    || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  return { taskId, artifactId, fileSha256: sha256, previewUrl: `/api/overseas/starter-198/social-content/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/media` };
}

function trustedSocialOutputKey(project: StudioProject): string | null {
  const media = socialOutputOwnedReviewMedia(project);
  return media ? `${media.taskId}:${media.fileSha256}` : null;
}

/** Collapse artifact revisions that point at the exact same completed film.
 * Only server-owned social output workspaces participate; ordinary Studio
 * projects remain distinct even when users intentionally reuse one video. */
export function dedupeSocialOutputHistoryProjects(projects: StudioProject[]): StudioProject[] {
  const winnerByKey = new Map<string, StudioProject>();
  for (const project of projects) {
    const key = trustedSocialOutputKey(project);
    if (!key) continue;
    const current = winnerByKey.get(key);
    if (!current || Date.parse(project.updatedAt) > Date.parse(current.updatedAt)) winnerByKey.set(key, project);
  }
  return projects.filter(project => {
    const key = trustedSocialOutputKey(project);
    return !key || winnerByKey.get(key)?.id === project.id;
  });
}
