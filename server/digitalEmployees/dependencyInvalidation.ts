const INVALIDATABLE_CONTENT_DOWNSTREAM = new Set([
  'viral_analysis', 'content_mode_routing', 'content_production', 'content_quality_gate',
  'content_release_approval', 'publishing_calendar', 'weekly_review',
]);

export function mustInvalidateContentDownstream(taskKey: string, status: string, dependenciesReady: boolean): boolean {
  return !dependenciesReady
    && INVALIDATABLE_CONTENT_DOWNSTREAM.has(taskKey)
    && !['pending', 'cancelled', 'handed_off'].includes(status);
}
