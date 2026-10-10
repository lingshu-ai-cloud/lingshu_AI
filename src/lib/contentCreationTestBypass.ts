import type { SocialExecutionPlanReviewReason } from '../../shared/contracts/socialContentAgentContract';

const SAFETY_BLOCKERS = new Set<SocialExecutionPlanReviewReason>([
  'facts_missing',
  'rights_missing',
]);

// Local preview may ignore a budget ceiling so a walkthrough can continue,
// but anything that can lower the quality, factual accuracy or rights safety
// of the finished video remains fail-closed.
const DEMO_BYPASSABLE_BLOCKERS = new Set<SocialExecutionPlanReviewReason>([
  'budget_exceeded',
]);

function explicitlyDisabled(value: unknown): boolean {
  return ['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());
}

function isLoopbackPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * Local preview is served from a Vite production bundle, so DEV alone is not
 * sufficient. The loopback hostname keeps the walkthrough available at
 * 127.0.0.1 while ensuring the same bundle is fail-closed on a deployed host.
 */
export function contentCreationTestBypassEnabled(): boolean {
  return (Boolean(import.meta.env?.DEV) || isLoopbackPreview())
    && !explicitlyDisabled(import.meta.env?.VITE_CONTENT_CREATION_TEST_BYPASS);
}

export interface ContentCreationDemoMaterialCandidate {
  id: string;
  name?: string;
  type?: string;
  scope?: string;
  usage?: string;
  sourceType?: string;
  url?: string;
  poster?: string;
}

/**
 * Material inventory is returned newest-first. For a local walkthrough, prefer
 * the operator's latest raw uploads and leave generated presenter/history
 * outputs out of the automatic three-item demo set.
 */
export function contentCreationDemoMaterialIds(
  materials: readonly ContentCreationDemoMaterialCandidate[],
  limit = 3,
): string[] {
  const generatedSource = /^(?:ai-generated|project-snapshot|historical-kickoff)$/i;
  const generatedName = /(?:数字人[·・\s_-]*分镜|heygen\s*数字人)/i;
  return materials
    .filter(item => item.id
      && item.type !== 'audio'
      && item.scope !== 'shared'
      && item.usage !== 'reference_only'
      && !generatedSource.test(String(item.sourceType || '').trim())
      && !generatedName.test(String(item.name || ''))
      && Boolean(item.url || item.poster))
    .slice(0, Math.max(1, limit))
    .map(item => item.id);
}

export function contentCreationHasSafetyBlocker(
  reasonCodes: readonly SocialExecutionPlanReviewReason[] | null | undefined,
): boolean {
  return Boolean(reasonCodes?.some(reason => SAFETY_BLOCKERS.has(reason)));
}

export function contentCreationReviewAdmissionAllowed(input: {
  approved: boolean;
  reasonCodes?: readonly SocialExecutionPlanReviewReason[] | null;
}): boolean {
  if (input.approved) return true;
  const reasons = input.reasonCodes || [];
  return contentCreationTestBypassEnabled()
    && reasons.length > 0
    && reasons.every(reason => DEMO_BYPASSABLE_BLOCKERS.has(reason));
}
