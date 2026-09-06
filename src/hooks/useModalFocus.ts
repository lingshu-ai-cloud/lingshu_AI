import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type ModalEntry = { dialog: HTMLElement };
const modalStack: ModalEntry[] = [];

function isAvailable(element: HTMLElement) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.matches(':disabled')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isAvailable);
}

type UseModalFocusOptions = {
  open: boolean;
  onClose: () => void;
  closeOnEscape?: boolean | (() => boolean);
};

/**
 * Provides the keyboard and focus behavior expected from an application modal.
 * The returned ref belongs on the element carrying role="dialog"/"alertdialog".
 */
export function useModalFocus<T extends HTMLElement>({
  open,
  onClose,
  closeOnEscape = true,
}: UseModalFocusOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  onCloseRef.current = onClose;
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: ModalEntry = { dialog };
    modalStack.push(entry);

    const addedFallbackTabIndex = !dialog.hasAttribute('tabindex');
    if (addedFallbackTabIndex) dialog.setAttribute('tabindex', '-1');

    const focusFrame = window.requestAnimationFrame(() => {
      if (!isAvailable(dialog)) return;
      const requested = dialog.querySelector<HTMLElement>('[data-modal-initial-focus]');
      const target = requested && isAvailable(requested) ? requested : focusableElements(dialog)[0] || dialog;
      target.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== entry || !isAvailable(dialog)) return;

      if (event.key === 'Escape') {
        const setting = closeOnEscapeRef.current;
        const shouldClose = typeof setting === 'function' ? setting() : setting;
        if (!shouldClose) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = modalStack.indexOf(entry);
      const wasTop = index === modalStack.length - 1;
      if (index >= 0) modalStack.splice(index, 1);
      if (addedFallbackTabIndex) dialog.removeAttribute('tabindex');
      if (wasTop && previousFocus?.isConnected) {
        window.requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
      }
    };
  }, [open]);

  return dialogRef;
}
