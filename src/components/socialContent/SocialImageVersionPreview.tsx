import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { ReviewImage } from './socialImageWorkbenchPresentation';

export default function SocialImageVersionPreview({ task, fallbackUrl, className, alt }: {
  task: SocialImageCreationTask | null; fallbackUrl: string; className: string; alt: string;
}) {
  const versions = useMemo(() => task?.imageType === 'carousel' || task?.imageType === 'gif_poster' ? []
    : (task?.outputs || []).filter(output => output.mediaUrl && output.role === 'single')
      .sort((a, b) => a.version - b.version) || [], [task]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [versions.length]);
  const selectedIndex = selectedId ? versions.findIndex(output => output.id === selectedId) : -1;
  const index = selectedIndex < 0 ? versions.length - 1 : selectedIndex;
  const selected = versions[index];
  const src = selected?.mediaUrl || fallbackUrl;
  if (!src) return null;
  const move = (offset: number) => setSelectedId(versions[index + offset]?.id || null);
  return <div className={`relative overflow-hidden rounded-lg border border-border ${className}`} aria-label="图片版本预览">
    <ReviewImage key={src} src={src} alt={`${alt}${selected ? ` · 第 ${selected.version} 版` : ''}`} />
    {versions.length > 1 && <>
      {index < versions.length - 1 && <span className="absolute left-2 top-2 rounded bg-neutral-700/55 px-2 py-1 text-xs text-white">历史图片版本 · 配文为当前版本</span>}
      <button type="button" aria-label="上一版本" disabled={index === 0} onClick={() => move(-1)}
        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-neutral-700/45 p-2 text-white transition-colors hover:bg-neutral-700/65 disabled:opacity-30"><ChevronLeft size={20}/></button>
      <button type="button" aria-label="下一版本" disabled={index === versions.length - 1} onClick={() => move(1)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-neutral-700/45 p-2 text-white transition-colors hover:bg-neutral-700/65 disabled:opacity-30"><ChevronRight size={20}/></button>
      <span className="absolute bottom-2 right-2 rounded-full bg-neutral-700/45 px-2 py-1 text-xs text-white">{index + 1} / {versions.length}</span>
    </>}
  </div>;
}
