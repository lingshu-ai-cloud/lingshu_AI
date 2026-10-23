import { type StudioProject } from '../../lib/studioApi';
import type { SocialContentCreateRequest } from '../socialContent/SocialContentWorkspace';


export function loadedStudioProjectTitle(
  project: Pick<StudioProject, 'id' | 'title' | 'status'>,
  request?: Pick<SocialContentCreateRequest, 'continueProjectId' | 'prefill'> | null,
): string {
  if (project.status === 'template') return `${project.title} · 副本`;
  if (request?.continueProjectId !== project.id) return project.title;
  return request.prefill?.title?.trim() || project.title;
}

export function loadedStudioContinuationStep(
  projectId: string | null,
  request?: Pick<SocialContentCreateRequest, 'continueProjectId' | 'replicationStep' | 'confirmedSpeech'> | null,
  compiledStoryboardReady = false,
): 'mode' | 'material' | 'preview' | null {
  const requestedProjectId = request?.continueProjectId?.trim() || null;
  if (!request || requestedProjectId !== projectId) return null;
  if (request.replicationStep === 1) return 'mode';
  if (request.replicationStep !== 2 && request.replicationStep !== 3) return null;
  // Material matching and preview both depend on a compiled storyboard. Keep a
  // fresh or legacy incomplete handoff on the preparation node; a persisted
  // project with real script/storyboard evidence can resume without rebuilding.
  if (request.replicationStep === 3) return compiledStoryboardReady ? 'preview' : 'mode';
  // Step 2 with confirmed speech is a new user edit, not a navigation-only
  // resume. It must rebuild the script/storyboard even when an older version
  // already exists on the same draft.
  if (request.confirmedSpeech?.length) return 'mode';
  return compiledStoryboardReady ? 'material' : 'mode';
}

export function safeStudioStepId(
  steps: ReadonlyArray<{ id: string }>,
  requestedIndex: number,
  fallback = 'mode',
): string {
  if (!steps.length) return fallback;
  const normalizedIndex = Number.isFinite(requestedIndex) ? Math.trunc(requestedIndex) : 0;
  return steps[Math.max(0, Math.min(normalizedIndex, steps.length - 1))]?.id || steps[0]?.id || fallback;
}
