export const PRESENTER_ASSETS_UPDATED_EVENT = 'lingshu:presenter-assets-updated';

/** Notify read-only decision surfaces that enterprise presenter authority changed. */
export function notifyPresenterAssetsUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PRESENTER_ASSETS_UPDATED_EVENT));
}
