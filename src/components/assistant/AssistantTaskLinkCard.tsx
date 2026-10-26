import { Button } from 'antd';
import { ChevronRight, Clapperboard } from 'lucide-react';

/** Compact task portal; the only action opens the original task. */
export default function AssistantTaskLinkCard({ title, description, onOpen }: {
  title: string; description: string; onOpen: () => void;
}) {
  return <section aria-label={`任务门户：${title}`} className="mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface text-accent"><Clapperboard size={24} aria-hidden="true"/></span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-text-primary" title={title}>{title}</p>
      <p className="mt-1 truncate text-xs text-text-secondary" title={description}>{description}</p>
    </div>
    <Button className="shrink-0" aria-label={`打开任务：${title}`} onClick={onOpen}>打开 <ChevronRight size={14} aria-hidden="true"/></Button>
  </section>;
}
