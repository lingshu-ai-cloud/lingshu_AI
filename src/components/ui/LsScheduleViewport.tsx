import { useEffect, useRef, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import './scheduleViewport.css';

type Props = {
  children: ReactNode;
  className?: string;
  label: string;
};

/**
 * Bounded viewport for the two retained account-by-date schedule matrices.
 * FullCalendar pages use LsCalendar; this wrapper only standardizes scrolling,
 * sticky date headers and one-time reveal for the resource-matrix exception.
 */
export function LsScheduleViewport({ children, className = '', label }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef(new Set<string>());
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let intersectionObserver: IntersectionObserver | null = null;

    const reveal = (element: HTMLElement) => {
      const id = element.dataset.scheduleRevealId;
      if (id) seenIdsRef.current.add(id);
      element.classList.add('is-revealed');
      intersectionObserver?.unobserve(element);
    };
    const register = () => {
      root.querySelectorAll<HTMLElement>('[data-schedule-reveal-id]').forEach(element => {
        const id = element.dataset.scheduleRevealId;
        if (reducedMotion || !id || seenIdsRef.current.has(id) || !intersectionObserver) reveal(element);
        else intersectionObserver.observe(element);
      });
    };

    if (!reducedMotion && typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) reveal(entry.target as HTMLElement);
        });
      }, { root, threshold: 0.08 });
    }
    register();
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(register);
    mutationObserver?.observe(root, { childList: true, subtree: true });
    return () => {
      mutationObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }, [reducedMotion]);

  return <div ref={rootRef} className={`ls-bounded-schedule-viewport ${className}`.trim()} aria-label={label} onFocusCapture={event => {
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-schedule-reveal-id]');
    if (!element) return;
    const id = element.dataset.scheduleRevealId;
    if (id) seenIdsRef.current.add(id);
    element.classList.add('is-revealed');
  }}>{children}</div>;
}

