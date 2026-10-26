import { useEffect, useId, useRef } from 'react';

type AssistantMascotSize = 'xs' | 'sm' | 'md' | 'lg';

type Props = {
  size?: AssistantMascotSize;
  interactive?: boolean;
  reduceMotion?: boolean;
  label?: string;
  className?: string;
};

const EYE_TRAVEL: Record<AssistantMascotSize, number> = {
  xs: 1.2,
  sm: 1.6,
  md: 2.1,
  lg: 2.6,
};

/**
 * Original Lingxiaoshu mascot: a conversational "hub seed" with a connected orbit node.
 * Interactive instances only move their eyes; static message avatars avoid global listeners.
 */
export default function AssistantMascot({
  size = 'sm',
  interactive = false,
  reduceMotion = false,
  label,
  className = '',
}: Props) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const rawId = useId();
  const gradientId = `lingshu-mascot-gradient-${rawId.replace(/:/g, '')}`;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !interactive || reduceMotion || typeof window === 'undefined') return;
    let frame = 0;
    let latestX = 0;
    let latestY = 0;

    const renderEyes = () => {
      frame = 0;
      const rect = root.getBoundingClientRect();
      const dx = latestX - (rect.left + rect.width / 2);
      const dy = latestY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      const strength = Math.min(1, distance / Math.max(rect.width * 1.8, 1));
      const travel = EYE_TRAVEL[size] * strength;
      const unitX = distance ? dx / distance : 0;
      const unitY = distance ? dy / distance : 0;
      root.style.setProperty('--ls-mascot-eye-x', `${(unitX * travel).toFixed(2)}px`);
      root.style.setProperty('--ls-mascot-eye-y', `${(unitY * travel).toFixed(2)}px`);
    };

    const followPointer = (event: PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(renderEyes);
    };
    const resetEyes = () => {
      root.style.setProperty('--ls-mascot-eye-x', '0px');
      root.style.setProperty('--ls-mascot-eye-y', '0px');
    };

    window.addEventListener('pointermove', followPointer, { passive: true });
    window.addEventListener('blur', resetEyes);
    return () => {
      window.removeEventListener('pointermove', followPointer);
      window.removeEventListener('blur', resetEyes);
      if (frame) window.cancelAnimationFrame(frame);
      resetEyes();
    };
  }, [interactive, reduceMotion, size]);

  return (
    <span
      ref={rootRef}
      data-assistant-mascot="hub-seed"
      data-interactive={interactive && !reduceMotion ? 'true' : undefined}
      className={`ls-assistant-mascot ls-assistant-mascot--${size} ${className}`.trim()}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <svg className="ls-assistant-mascot__svg" viewBox="0 0 88 88" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="12" y1="12" x2="72" y2="76" gradientUnits="userSpaceOnUse">
            <stop stopColor="#20B8F6" />
            <stop offset="0.52" stopColor="#4D73F4" />
            <stop offset="1" stopColor="#7654E8" />
          </linearGradient>
        </defs>
        <path className="ls-assistant-mascot__halo" d="M44 4c22 0 39 16 39 37 0 10-4 19-10 26-8 10-16 16-29 16C20 83 5 66 5 43 5 20 21 4 44 4Z" />
        <path className="ls-assistant-mascot__body" fill={`url(#${gradientId})`} d="M21 14c9-7 31-6 42 2 11 8 13 23 7 37-3 7-4 17-12 23-9 7-26 6-34-1-5-5-6-14-9-21-6-15-5-31 6-40Z" />
        <path className="ls-assistant-mascot__shine" d="M25 18c8-4 19-4 26-2" />
        <rect className="ls-assistant-mascot__face" x="24" y="27" width="38" height="28" rx="14" />
        <ellipse data-assistant-mascot-eye="left" className="ls-assistant-mascot__eye" cx="36" cy="41" rx="3.5" ry="6" />
        <ellipse data-assistant-mascot-eye="right" className="ls-assistant-mascot__eye" cx="51" cy="41" rx="3.5" ry="6" />
        <path className="ls-assistant-mascot__orbit" d="M58 65c5-5 10-6 15-4" />
        <circle className="ls-assistant-mascot__node" cx="75" cy="61" r="7" />
        <circle className="ls-assistant-mascot__node-shine" cx="72.5" cy="58.5" r="1.7" />
      </svg>
    </span>
  );
}
