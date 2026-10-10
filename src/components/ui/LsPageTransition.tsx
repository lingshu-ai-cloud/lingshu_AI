import { useEffect, useRef, type PropsWithChildren } from 'react';
import { lsMotion } from '../../lib/designTokens';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';

/** Keep cached pages mounted; only the shared surface fades when navigation changes. */
export default function LsPageTransition({ page, children }: PropsWithChildren<{ page: string }>) {
  const surface = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion || !surface.current?.animate) return;
    const animation = surface.current.animate([{ opacity: 0.6 }, { opacity: 1 }], {
      duration: lsMotion.duration.fast,
      easing: `cubic-bezier(${lsMotion.ease.enter.join(',')})`,
    });
    return () => animation.cancel();
  }, [page, reducedMotion]);

  return <div ref={surface} data-app-content-stack className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">{children}</div>;
}
