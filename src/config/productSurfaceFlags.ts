import type { Page } from '../pageRegistry';

/**
 * TEMPORARY PRODUCT-SURFACE BACKUP MARKER — 2026-10-08
 *
 * The Platform Ads implementation, routes and data are intentionally retained.
 * Set this flag back to `true` to enable the primary 投流 entry and its retained
 * internal overview, plan, creative, and managed routes without rebuilding them.
 */
export const PLATFORM_ADS_SURFACE_ENABLED = false;

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
