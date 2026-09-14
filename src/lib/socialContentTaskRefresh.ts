export const SOCIAL_CONTENT_TASK_REFRESH_EVENT = 'lingshu:social-content-task-refresh' as const;

export type SocialContentTaskRefreshDetail = { taskId?: string };

/** Signals that a completed user action may have changed a task projection. */
export function notifySocialContentTaskChanged(taskId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SocialContentTaskRefreshDetail>(
    SOCIAL_CONTENT_TASK_REFRESH_EVENT,
    { detail: taskId ? { taskId } : {} },
  ));
}

export function socialContentTaskIdFromApiPath(path: string): string | undefined {
  const encoded = /^\/tasks\/([^/]+)/.exec(path)?.[1];
  if (!encoded) return undefined;
  try { return decodeURIComponent(encoded); } catch { return undefined; }
}
