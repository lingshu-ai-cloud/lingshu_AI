import type { Page } from '../pageRegistry';

/**
 * The advertising implementation is exposed as the 投放管理 unit. Its three
 * primary pages are 计划创编、投放数据、素材管理; legacy managed links remain
 * routable so they can open the shared AI operator drawer.
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
