import { useEffect } from 'react';
import type { Page } from '../pageRegistry';
import { isSocialTaskContextPage } from './socialTaskContext';
import { attachSocialContentNavigationState, readSocialContentNavigationQueryTaskId } from './socialContentContext';

export function useSocialContentQueryNavigation(page: Page): void {
  useEffect(() => {
    const taskId = readSocialContentNavigationQueryTaskId(page, window.location.search);
    if (taskId && isSocialTaskContextPage(page)) attachSocialContentNavigationState(taskId, page);
  }, []);
}
