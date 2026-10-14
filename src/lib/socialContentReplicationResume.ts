import type { StudioProject } from './studioApi';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the three-step replication workbench from the server-owned project.
 * Returning null means the project is still genuinely in the speech step.
 */
export function replicationResumeStep(project: Pick<StudioProject, 'spec'>): 2 | 3 | null {
  const automation = record(project.spec.automation);
  const rawStage = text(automation.stage);
  const stage = ['blocked', 'failed'].includes(rawStage)
    ? text(automation.resumeStage) || rawStage
    : rawStage;

  if (['render', 'rendering', 'quality', 'completed', 'requires_revision', 'delivery'].includes(stage)) return 3;
  if (['material_match', 'voice_subtitles', 'heygen'].includes(stage)) return 2;
  return null;
}
