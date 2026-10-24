import type { Page } from './pageRegistry';
import type { CreationMode } from './lib/creationMode';

export type PrimaryProductPage = 'strategy' | 'socialInspiration' | 'digitalEmployees' | 'adsOverview' | 'conversion';
export type PrimaryProductItem = { page: PrimaryProductPage; label: string; disabled: boolean };

const PRIMARY_PAGES: readonly { page: PrimaryProductPage; label: string }[] = [
  { page: 'digitalEmployees', label: '经营总览' },
  { page: 'socialInspiration', label: '灵感爆款' },
  { page: 'strategy', label: '内容创作' },
  { page: 'adsOverview', label: '平台投流' },
  { page: 'conversion', label: '客户会话' },
];

export function primaryProductNavigation(
  _mode: CreationMode,
  allowedPages: ReadonlySet<Page>,
  adsEnabled: boolean,
): PrimaryProductItem[] {
  return PRIMARY_PAGES
    .filter(item => allowedPages.has(item.page))
    .map(item => ({ page: item.page, label: item.label, disabled: item.page === 'adsOverview' && !adsEnabled }));
}

export function modeSwitchDestination(page: Page, _mode: CreationMode): Page {
  return page;
}

/** Secondary settings stay reachable without becoming extra primary tabs. */
export function accountProductNavigation(allowedPages: ReadonlySet<Page>, platformAdmin: boolean): Page[] {
  const settings: Page[] = ['enterprise', 'agentMemory', 'plugins', 'organizationPermissions'];
  return [...settings.filter(page => allowedPages.has(page)), ...(platformAdmin ? ['admin', 'adminDelivery'] as const : [])];
}
