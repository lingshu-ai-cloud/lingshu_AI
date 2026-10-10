import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, Sparkles, X } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { studioApi } from '../lib/studioApi';
import { useModalFocus } from '../hooks/useModalFocus';

export type ContentOpsExecutionIntent = {
  kind: 'recommendation' | 'top-content';
  id: string;
  title: string;
  detail: string;
  evidenceCount?: number;
  platform?: string;
  sourceMetric?: string;
};

export function ContentOpsExecutionDialog({ intent, onClose }: {
  intent: ContentOpsExecutionIntent | null;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [platform, setPlatform] = useState('tiktok');
  const [addSchedule, setAddSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const isClone = intent?.kind === 'top-content';
  useEffect(() => {
    if (!intent) return;
    const inferred = String(intent.platform || '').toLowerCase();
    setPlatform(['tiktok', 'instagram', 'youtube', 'facebook'].includes(inferred) ? inferred : 'tiktok');
    setQuantity(1);
    setAddSchedule(false);
    setError('');
    setDone('');
  }, [intent]);
  const planSteps = useMemo(() => intent ? [
    isClone ? `以“${intent.title}”作为表现证据，创建爆款裂变草稿` : `把“${intent.title}”转为可编辑创作草稿`,
    `目标平台：${platform === 'instagram' ? 'Instagram' : platform === 'youtube' ? 'YouTube' : platform === 'facebook' ? 'Facebook' : 'TikTok'}；生成 ${quantity} 个草稿`,
    addSchedule ? `同时创建每日 ${scheduleTime} 的创作提醒；不会自动发布` : '仅保存草稿，不创建定时任务，也不会自动发布',
  ] : [], [addSchedule, intent, isClone, platform, quantity, scheduleTime]);
  const dialogRef = useModalFocus<HTMLDivElement>({ open: Boolean(intent), onClose });

  if (!intent) return null;

  const confirm = async () => {
    if (busy || done) return;
    setBusy(true);
    setError('');
    try {
      const projects = [];
      for (let index = 0; index < quantity; index += 1) {
        const result = await studioApi.saveProject({
          title: `${intent.title}${quantity > 1 ? ` · 方向 ${index + 1}` : ''}`,
          status: 'draft',
          spec: {
            mode: isClone ? 'clone' : 'material',
            platform,
            language: 'zh',
            script: '',
            operationsBrief: {
              source: 'content_ops_memory',
              sourceKind: intent.kind,
              sourceId: intent.id,
              recommendation: intent.title,
              evidence: intent.detail,
              evidenceCount: intent.evidenceCount || 0,
              sourceMetric: intent.sourceMetric || '',
              confirmedAt: new Date().toISOString(),
            },
          },
        });
        if (!result.ok || !result.project) throw new Error('草稿创建失败，请稍后重试。');
        projects.push(result.project);
      }
      if (addSchedule) {
        const [hour = '10', minute = '0'] = scheduleTime.split(':');
        const cronHour = Number.isInteger(Number(hour)) ? Number(hour) : 10;
        const cronMinute = Number.isInteger(Number(minute)) ? Number(minute) : 0;
        const response = await fetch('/api/overseas/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({
            name: `创作提醒：${intent.title}`,
            category: 'automation',
            taskType: 'custom',
            cronExpr: `${cronMinute} ${cronHour} * * *`,
            cronLabel: `每天 ${scheduleTime}（北京时间）`,
            enabled: true,
            config: { purpose: 'content_creation', projectIds: projects.map(item => item.id).join(','), sourceId: intent.id },
          }),
        });
        if (!response.ok) throw new Error('草稿已创建，但定时任务创建失败。请前往定时任务页面重试。');
      }
      localStorage.setItem('ow_studio_open_project', JSON.stringify({ projectId: projects[0].id, at: Date.now() }));
      setDone(`已创建 ${projects.length} 个草稿${addSchedule ? '和 1 个定时提醒' : ''}`);
      window.setTimeout(() => {
        onClose();
        window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', view: 'create' } }));
      }, 650);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '执行失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="content-ops-execution-dialog-title" className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
    <section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div><div className="flex items-center gap-2 text-emerald-700"><Sparkles size={16} /><span className="text-xs font-black">AI 执行计划确认</span></div><h2 id="content-ops-execution-dialog-title" className="mt-2 text-base font-black text-text-primary">{isClone ? '创建爆款裂变草稿' : '生成创作草稿'}</h2></div>
        <button type="button" data-modal-initial-focus aria-label="关闭执行计划" onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button>
      </header>
      <div className="space-y-4 p-5">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><p className="text-xs font-black text-emerald-900">{intent.title}</p><p className="mt-1.5 text-xs leading-5 text-emerald-900/75">{intent.detail}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-bold text-text-secondary">目标平台<select value={platform} onChange={event => setPlatform(event.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-xs outline-none"><option value="tiktok">TikTok</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="facebook">Facebook</option></select></label>
          <label className="text-[11px] font-bold text-text-secondary">草稿数量<select value={quantity} onChange={event => setQuantity(Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-xs outline-none"><option value={1}>1 个草稿</option><option value={3}>3 个创作方向</option></select></label>
        </div>
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border p-3"><span className="flex items-center gap-2 text-xs font-bold text-text-primary"><CalendarClock size={15} className="text-emerald-600" />加入每日创作提醒</span><input type="checkbox" checked={addSchedule} onChange={event => setAddSchedule(event.target.checked)} /></label>
        {addSchedule && <label className="block text-[11px] font-bold text-text-secondary">提醒时间<input type="time" value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-xs" /></label>}
        <div className="rounded-xl bg-surface-2 p-4"><p className="text-[11px] font-black text-text-primary">确认后将执行</p><ol className="mt-2 space-y-2">{planSteps.map((step, index) => <li key={step} className="flex gap-2 text-xs leading-5 text-text-secondary"><span className="font-black text-emerald-600">{index + 1}.</span>{step}</li>)}</ol></div>
        <p className="text-[10px] leading-4 text-text-muted">确认前不会写入任何数据；确认后只创建可编辑草稿和可关闭的提醒，不会生成成片或自动发布。</p>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        {done && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 size={15} />{done}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-border px-5 py-4"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-border px-4 py-2.5 text-xs font-black text-text-secondary">取消</button><button type="button" onClick={() => void confirm()} disabled={busy || Boolean(done)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" />}{isClone ? '确认并创建裂变草稿' : '确认并创建草稿'}</button></footer>
    </section>
  </div>;
}
