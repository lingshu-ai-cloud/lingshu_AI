import { useEffect, useRef, useState } from 'react';

export default function ShootingTaskDialog({ title, brief, duration, ratio, busy, error, soundMode = 'voiceover', onClose, onSubmit }: {
  title: string; brief: string; duration: number; ratio: string; busy: boolean; error: string;
  onClose: () => void; onSubmit: (brief: string) => void;
  soundMode?: 'voiceover' | 'source' | 'silent';
}) {
  const [instructions, setInstructions] = useState(brief);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector('textarea')?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <form ref={formRef} role="dialog" aria-modal="true" aria-labelledby="shooting-task-title" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      onSubmit={event => { event.preventDefault(); if (instructions.trim() && !busy) onSubmit(instructions.trim()); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key === 'Tab') {
          const items = Array.from(formRef.current?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)') || []);
          const target = event.shiftKey ? items.at(-1) : items[0];
          if ((event.shiftKey && document.activeElement === items[0]) || (!event.shiftKey && document.activeElement === items.at(-1))) { event.preventDefault(); target?.focus(); }
        }
      }}>
      <h2 id="shooting-task-title" className="text-base font-bold">安排拍摄 · {title}</h2>
      <p className="text-xs text-text-secondary">建议至少 {duration.toFixed(1)} 秒 · {ratio} · {soundMode === 'source' ? '录制完整口播，保留现场原声；上传后转写核对台词' : soundMode === 'silent' ? '此镜头无声：仅使用拍摄画面，不混入口播或配乐' : '保留草稿旁白，补拍视频作为无声画面使用'}</p>
      <label className="block text-sm">拍摄要求<textarea autoFocus required maxLength={10000} rows={6} value={instructions} onChange={event => setInstructions(event.target.value)} className="mt-2 w-full rounded-lg border border-border p-3 text-xs" /></label>
      <p className="text-xs leading-5 text-text-muted">先保存当前草稿，再创建绑定任务。上传后返回原草稿时，要求一致且未选画面的镜头会自动补位；已有画面不覆盖。口播转写未通过时保留候选，需人工核对。</p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border px-4 py-2 text-xs">取消</button><button type="submit" disabled={busy || !instructions.trim()} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? '正在保存…' : '保存草稿并创建任务'}</button></div>
    </form>
  </div>;
}
