import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

type StudioTopNoticeProps = {
  message: string;
  tone?: 'info' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
};

/** Transient, dismissible feedback that never takes space from the editor or its footer. */
export default function StudioTopNotice({ message, tone = 'info', actionLabel, onAction }: StudioTopNoticeProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Blocking errors keep their recovery action available until dismissed or resolved.
    if (tone === 'warning' && onAction) return;
    const timeout = window.setTimeout(() => setDismissed(true), tone === 'warning' ? 12_000 : 7_000);
    return () => window.clearTimeout(timeout);
  }, [message, tone, onAction]);

  if (dismissed || !message) return null;

  return <div className="pointer-events-none fixed inset-x-4 top-4 z-[110] flex justify-center" role={tone === 'warning' ? 'alert' : 'status'} aria-live={tone === 'warning' ? 'assertive' : 'polite'}>
    <div className={`pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border px-4 py-3 text-xs leading-5 shadow-xl ${tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-white text-emerald-950'}`}>
      <span className="min-w-0 flex-1">{message}</span>
      {actionLabel && onAction && <button type="button" onClick={onAction} className="shrink-0 font-black text-emerald-800 underline underline-offset-2">{actionLabel}</button>}
      <button type="button" onClick={() => setDismissed(true)} aria-label="关闭提示" className="shrink-0 rounded p-0.5 hover:bg-black/5"><X size={15} /></button>
    </div>
  </div>;
}
