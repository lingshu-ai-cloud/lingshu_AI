/** Same-tab history for the production drill-down. No task execution occurs here. */
export function requestProductionBack() {
  window.dispatchEvent(new CustomEvent('lingshu:back'));
}
export function pushProductionLocation(page: string, extra: Record<string, unknown> = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', page);
  window.history.pushState({ ...extra, productionPage: page, productionDepth: (window.history.state?.productionDepth || 0) + 1 }, '', url);
}
