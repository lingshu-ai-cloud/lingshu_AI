export function taskMonitorView(taskKey: string | undefined, status: string) {
  if (taskKey === 'content_mode_routing') return 'routing';
  if (taskKey === 'content_quality_gate') return 'quality';
  if (['succeeded', 'completed', 'cancelled', 'failed'].includes(status)) return 'result';
  return 'browser';
}
