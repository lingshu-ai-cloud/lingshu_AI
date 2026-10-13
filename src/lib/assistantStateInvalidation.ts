export const ASSISTANT_STATE_INVALIDATED_EVENT = 'lingshu:assistant-state-invalidated';

export type AssistantStateInvalidationDetail = {
  domain: 'weekly-work' | 'presenter-assets' | 'content-production' | 'enterprise-facts' | 'social-content';
  source?: string;
  entityId?: string;
  changedAt: string;
};

const STORAGE_KEY = 'lingshu:assistant-state-revision';

/**
 * Announces that a persisted business fact may have changed. This notification
 * never carries the new business value and never authorizes an action: every
 * decision surface must re-read the authoritative server projection.
 */
export function notifyAssistantStateInvalidated(
  detail: Omit<AssistantStateInvalidationDetail, 'changedAt'>,
): void {
  if (typeof window === 'undefined') return;
  const normalized: AssistantStateInvalidationDetail = {
    domain: detail.domain,
    ...(detail.source ? { source: detail.source.slice(0, 80) } : {}),
    ...(detail.entityId ? { entityId: detail.entityId.slice(0, 200) } : {}),
    changedAt: new Date().toISOString(),
  };
  window.dispatchEvent(new CustomEvent<AssistantStateInvalidationDetail>(
    ASSISTANT_STATE_INVALIDATED_EVENT,
    { detail: normalized },
  ));
  // Storage events let another tab revalidate without copying business data.
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch { /* optional */ }
}

export function subscribeAssistantStateInvalidations(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onLocal = () => listener();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && event.newValue) listener();
  };
  window.addEventListener(ASSISTANT_STATE_INVALIDATED_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ASSISTANT_STATE_INVALIDATED_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}
