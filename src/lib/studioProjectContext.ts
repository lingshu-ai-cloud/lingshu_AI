import type { StudioProject } from './studioApi';
export type StudioWorkflowContext = { runId: string; taskId: string; taskKey?: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string };

export function studioWorkflowContextFromSpec(spec: Record<string, unknown>): StudioWorkflowContext | null {
  const runId = typeof spec.workflowRunId === 'string' ? spec.workflowRunId.trim() : '';
  const taskId = typeof spec.workflowTaskId === 'string' ? spec.workflowTaskId.trim() : '';
  if (!runId || !taskId) return null;
  return {
    runId,
    taskId,
    taskKey: typeof spec.workflowTaskKey === 'string' ? spec.workflowTaskKey.trim() : '',
  };
}

export function resolveStudioWorkflowProjectEntry(
  projects: StudioProject[],
  context: StudioWorkflowContext,
): { projects: StudioProject[]; project: StudioProject | null; openList: boolean } {
  const matches = projects.filter(project => {
    const projectContext = studioWorkflowContextFromSpec(project.spec);
    if (context.entityId) {
      return project.id === context.entityId
        && (!context.runId || projectContext?.runId === context.runId);
    }
    return projectContext?.runId === context.runId && projectContext.taskId === context.taskId;
  });
  return {
    projects: matches,
    project: matches.length === 1 ? matches[0] : null,
    openList: matches.length !== 1,
  };
}

/**
 * Silent autosave may update a persisted project, but it must not manufacture
 * an empty project merely because Studio is mounted in the background.
 * Enterprise defaults (product, audience, tone, platform) are intentionally
 * not sufficient: they are loaded without a user or worker creating content.
*/

const LEGACY_UNVERIFIED_COVER_TITLES = new Set([
  ['You NEED this in', '2026'].join(' '),
  'Factory price, 24h ship',
  'Why everyone is obsessed',
]);
export function isUnverifiedLegacyCoverTitle(value: unknown): boolean {
  return LEGACY_UNVERIFIED_COVER_TITLES.has(String(value || '').trim());
}
export function studioSpecHasMeaningfulContent(spec: Record<string, unknown>): boolean {
  const hasText = (key: string) => typeof spec[key] === 'string' && Boolean(String(spec[key]).trim());
  const hasArray = (key: string) => Array.isArray(spec[key]) && (spec[key] as unknown[]).length > 0;
  const hasObject = (key: string) => Boolean(
    spec[key] && typeof spec[key] === 'object' && Object.keys(spec[key] as Record<string, unknown>).length > 0,
  );
  return [
    'script', 'caption', 'posterJsonText', 'posterImageUrl', 'voiceoverUrl', 'coverTitle',
  ].some(hasText)
    || ['selected', 'materialSnapshots', 'modeScripts', 'productVideoVersions'].some(hasArray)
    || ['videoKickoff', 'posterDraft', 'languageRenderOutputs', 'storyboardVideoVersions'].some(hasObject);
}

export function withoutStudioWorkflowContext(spec: Record<string, unknown>): Record<string, unknown> {
  const next = { ...spec };
  delete next.workflowRunId;
  delete next.workflowTaskId;
  delete next.workflowTaskKey;
  delete next.automation;
  delete next.contentOrder;
  delete next.contentOrderId;
  delete next.batchPlanId;
  return next;
}
