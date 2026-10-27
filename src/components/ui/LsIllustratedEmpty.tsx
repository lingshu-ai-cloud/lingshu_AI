import type { LucideIcon } from 'lucide-react';

/** A factual empty state with a quiet icon backdrop; never implies missing data is zero. */
export default function LsIllustratedEmpty({ icon: Icon, title, detail, compact = false }: {
  icon: LucideIcon; title: string; detail: string; compact?: boolean;
}) {
  return <div className={`relative isolate flex overflow-hidden rounded-xl border border-border bg-surface-2 ${compact ? 'min-h-28 items-center gap-3 px-4 py-3' : 'min-h-44 flex-col items-center justify-center px-5 py-6 text-center'}`} role="status">
    <Icon size={compact ? 76 : 112} strokeWidth={1} aria-hidden="true" className="pointer-events-none absolute -right-2 -bottom-5 -z-10 text-accent/10"/>
    <div className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-white text-accent ${compact ? 'h-11 w-11' : 'h-14 w-14'}`}><Icon size={compact ? 22 : 28} strokeWidth={1.7} aria-hidden="true"/></div>
    <div className={compact ? 'min-w-0' : 'mt-3'}><p className="text-sm font-medium text-text-primary">{title}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{detail}</p></div>
  </div>;
}
