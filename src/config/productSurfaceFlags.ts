import type { Page } from '../pageRegistry';

/**
 * The advertising implementation is exposed as the 投放管理 unit. Its two primary
 * workspaces are 计划管理 and 素材投放表现. Creation is a modal action; legacy
 * overview/managed URLs retain report access and the shared AI operator drawer.
 */
export const PLATFORM_ADS_SURFACE_ENABLED = true;

export const PLATFORM_ADS_PAGE_IDS: readonly Page[] = [
  'adsOverview',
  'adsPlans',
  'adsCreatives',
  'adsManaged',
];

export function availableProductPage(page: Page): Page {
  if (page === 'orders' || page === 'scheduled') return 'digitalEmployees';
  return !PLATFORM_ADS_SURFACE_ENABLED && PLATFORM_ADS_PAGE_IDS.includes(page)
    ? 'digitalEmployees'
    : page;
}
