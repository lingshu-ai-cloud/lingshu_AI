import type {
  SocialContentSourceOption,
  SocialTaskSource,
} from '../../shared/contracts/socialContentWorkflow';
import type { SocialContentDraft } from './socialContentModel';

export const SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH = 100;
export const SOCIAL_CONTENT_MAX_SOURCES_PER_TASK = 100;

type SourcePlanningDraft = Pick<
  SocialContentDraft,
  'selectedSources' | 'removedSourceIds' | 'referenceLinks' | 'keyFacts'
>;

type ExistingSource = Pick<SocialTaskSource, 'sourceId' | 'kind' | 'sourceRef' | 'status'>;

export function normalizeSocialContentSourceQuery(value: string): string {
  return value.trim().slice(0, SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH);
}

export function mergeSocialContentSourceOptions(
  current: SocialContentSourceOption[],
  incoming: SocialContentSourceOption[],
  page: number,
): SocialContentSourceOption[] {
  if (page === 1) return incoming;
  const optionIds = new Set(current.map(item => item.optionId));
  return [...current, ...incoming.filter(item => !optionIds.has(item.optionId))];
}

export function socialContentSourceOptionsAfterFailure(
  current: SocialContentSourceOption[],
  page: number,
): SocialContentSourceOption[] {
  return page === 1 ? [] : current;
}

/** Mirrors the server's per-task source capacity, including historical source rows. */
export function plannedSocialContentSourceCount(
  existingSources: readonly ExistingSource[],
  draft: SourcePlanningDraft,
  pendingFileCount: number,
): number {
  const removedIds = new Set(draft.removedSourceIds);
  const plannedRefs = new Set(
    existingSources
      .filter(source => source.status === 'active' && !removedIds.has(source.sourceId))
      .map(source => `${source.kind}:${source.sourceRef}`),
  );
  let additions = 0;
  const addPlannedRef = (kind: string, sourceRef: string) => {
    const normalizedRef = sourceRef.trim();
    if (!normalizedRef) return;
    const key = `${kind}:${normalizedRef}`;
    if (plannedRefs.has(key)) return;
    plannedRefs.add(key);
    additions += 1;
  };

  draft.selectedSources.forEach(source => addPlannedRef(source.kind, source.sourceRef));
  draft.referenceLinks.forEach(link => addPlannedRef('reference_link', link));
  if (draft.keyFacts.trim()) addPlannedRef('text_note', 'brief:brand-notes');

  const fileCount = Number.isFinite(pendingFileCount)
    ? Math.max(0, Math.floor(pendingFileCount))
    : 0;
  return existingSources.length + additions + fileCount;
}

export function socialContentSourceLimitMessage(count: number): string | null {
  if (count <= SOCIAL_CONTENT_MAX_SOURCES_PER_TASK) return null;
  return `本次任务最多可使用 ${SOCIAL_CONTENT_MAX_SOURCES_PER_TASK} 项资料，请减少 ${count - SOCIAL_CONTENT_MAX_SOURCES_PER_TASK} 项新增资料后继续`;
}
