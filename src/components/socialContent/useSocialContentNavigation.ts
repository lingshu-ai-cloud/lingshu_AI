import { useCallback } from 'react';
import type { Page } from '../../App';
import { attachSocialContentNavigationState } from '../../lib/socialContentContext';

const SOCIAL_CONTENT_PAGES = new Set<Page>([
  'enterprise',
  'socialInspiration',
  'scriptLibrary',
  'smartAssets',
  'traffic',
  'accountManagement',
]);

export function useSocialContentNavigation(
  onNavigate?: (page: Page) => void,
  taskId?: string | null,
) {
  return useCallback((nextPage: Page) => {
    onNavigate?.(nextPage);
    if (taskId && SOCIAL_CONTENT_PAGES.has(nextPage)) {
      attachSocialContentNavigationState(taskId, nextPage);
    }
  }, [onNavigate, taskId]);
}
