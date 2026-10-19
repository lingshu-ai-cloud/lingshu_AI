import type { ReactNode } from 'react';

const DEFAULT_PREVIEW_RATIO = 9 / 16;

const joinClassNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

/** Resolve project ratios such as `9:16`, `4/5`, or a numeric width/height value. */
export function studioPreviewRatio(value?: string | number): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : DEFAULT_PREVIEW_RATIO;
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return DEFAULT_PREVIEW_RATIO;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : DEFAULT_PREVIEW_RATIO;
}

export function studioPreviewWidth(value?: string | number): string {
  const percentage = Number((studioPreviewRatio(value) * 100).toFixed(4));
  return `min(100%, ${percentage}cqh)`;
}

/**
 * Height-led media stage shared by content-production entry and review modes.
 * Application controls belong outside this component so they never cover media.
 */
export default function StudioPreviewStage({
  ratio = '9:16',
  children,
  className,
  stageClassName,
  ariaLabel,
}: {
  ratio?: string | number;
  children: ReactNode;
  className?: string;
  stageClassName?: string;
  ariaLabel?: string;
}) {
  const resolvedRatio = studioPreviewRatio(ratio);
  return (
    <div
      className={joinClassNames('studio-workbench-preview-shell relative flex min-h-0 w-full items-center justify-center overflow-hidden', className)}
      data-preview-aspect-ratio={String(ratio || '9:16')}
      aria-label={ariaLabel}
    >
      <div
        className={joinClassNames('studio-workbench-preview-stage relative flex items-center justify-center overflow-hidden', stageClassName)}
        style={{ aspectRatio: resolvedRatio, width: studioPreviewWidth(resolvedRatio) }}
      >
        {children}
      </div>
    </div>
  );
}
