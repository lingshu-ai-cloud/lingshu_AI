import type { Page } from './pageRegistry';
import type { CreationMode } from './lib/creationMode';

export type PrimaryProductPage = 'strategy' | 'socialInspiration' | 'digitalEmployees' | 'adsOverview' | 'conversion';
export type PrimaryProductItem = { page: PrimaryProductPage; label: string; disabled: boolean };

const PRIMARY_PAGES: readonly { page: PrimaryProductPage; label: string }[] = [
  { page: 'strategy', label: '内容创作' },
  { page: 'socialInspiration', label: '爆款库' },
  { page: 'digitalEmployees', label: '经营总览' },
  { page: 'adsOverview', label: '投流' },
  { page: 'conversion', label: '智能客服' },
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

export function modeSwitchDestination(page: Page, mode: CreationMode): Page {
  return mode === 'employee' && page === 'socialInspiration' ? 'strategy' : page;
}

/** Secondary settings stay reachable without becoming extra primary tabs. */
export function accountProductNavigation(allowedPages: ReadonlySet<Page>, platformAdmin: boolean): Page[] {
  const settings: Page[] = ['enterprise', 'plugins'];
  return [...settings.filter(page => allowedPages.has(page)), ...(platformAdmin ? ['admin', 'adminDelivery'] as const : [])];
}
