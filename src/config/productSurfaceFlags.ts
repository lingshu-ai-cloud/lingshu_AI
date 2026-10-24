import type { Page } from '../pageRegistry';

/**
 * 投流作为五个一级导航之一；概览、计划与素材保持在该入口下，
 * 旧 AI 托管深链仍可进入共用投手面板。真实投放继续受后端账号和授权门禁控制。
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
