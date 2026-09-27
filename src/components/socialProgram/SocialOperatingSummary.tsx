import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
import SocialOperatingConfiguration from './SocialOperatingConfiguration';

/** Compact operating context inside the existing home, not a second workspace. */
export default function SocialOperatingSummary({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { available, activeProgram, accounts, loading, error } = useSocialProgram();
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('page') === 'socialSetup');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const show = () => {
      setOpen(true);
      try { sessionStorage.removeItem('lingshu:operating-config:open'); } catch { /* optional storage */ }
    };
    try { if (sessionStorage.getItem('lingshu:operating-config:open')) show(); } catch { /* optional storage */ }
    window.addEventListener('lingshu:operating-config', show);
    return () => window.removeEventListener('lingshu:operating-config', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); previous?.focus(); };
  }, [open]);
  if (!available) return <section aria-label="托管发布能力" className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">当前工作区尚未开放持续托管发布授权。可继续制作内容并交付发布包；连接账号不会自动启用无人值守发布。</section>;
  return <>
    <section aria-label="社媒经营背景" className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-5 py-3">
      <div className="text-sm"><strong>{activeProgram ? `${activeProgram.brandName} · ${activeProgram.market}` : '社媒经营'}</strong><span className="ml-3 text-text-muted">{loading ? '读取经营背景…' : activeProgram ? `${accounts.length} 个账号策略 · ${activeProgram.targetAudience}` : '从目标、灵感或成片开始，业务背景可随时补充'}</span>{error && <p role="status" className="text-xs text-amber-800">经营背景暂时不可用：{error}</p>}</div>
      <div className="flex gap-2"><button className="btn-ghost text-xs" onClick={() => onNavigate('socialInspiration')}>查看选题</button><button className="btn-ghost text-xs" onClick={() => onNavigate('traffic')}>查看发布</button><button className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setOpen(true)}><Settings size={14} />业务配置</button></div>
    </section>
    {open && <div className="fixed inset-0 z-[180] bg-black/30" onClick={() => setOpen(false)}>
      <aside ref={dialogRef} role="dialog" aria-modal="true" aria-label="社媒业务配置" className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto bg-white shadow-xl" onClick={event => event.stopPropagation()}>
        <div className="flex justify-end p-3"><button ref={closeRef} aria-label="关闭业务配置" className="btn-ghost" onClick={() => setOpen(false)}><X size={18} /></button></div>
        <SocialOperatingConfiguration onNavigate={page => { setOpen(false); onNavigate(page); }} />
      </aside>
    </div>}
  </>;
}
