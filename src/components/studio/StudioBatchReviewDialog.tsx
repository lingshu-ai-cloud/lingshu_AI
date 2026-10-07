import { useState, type ReactNode } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';

export type StudioBatchReviewIssue = {
  id: string;
  shotNumber: number;
  title: string;
  question: string;
  detail?: string;
  options?: Array<{ id: string; label: string }>;
  selectedOptionId?: string;
  resolved?: boolean;
};

export type StudioBatchReviewFrame = {
  id: string;
  shotNumber: number;
  title: string;
  imageUrl: string;
};

export type StudioBatchReviewDialogProps = {
  issues: StudioBatchReviewIssue[];
  frames: StudioBatchReviewFrame[];
  totalShots: number;
  readyShots: number;
  generatingShots?: number;
  pendingShots?: number;
  estimatedCostCny?: number;
  busy?: boolean;
  error?: string;
  canSubmit: boolean;
  submitLabel?: string;
  onSelectIssueOption: (issueId: string, optionId: string) => void;
  renderIssueActions?: (issue: StudioBatchReviewIssue) => ReactNode;
  onSubmit: () => void;
  onClose: () => void;
};

/** A single lightweight review stop before the batch of approved first frames is submitted. */
export default function StudioBatchReviewDialog({
  issues, frames, totalShots, readyShots, generatingShots = 0, pendingShots = 0, estimatedCostCny,
  busy = false, error, canSubmit, submitLabel = '确认首帧并生成视频', onSelectIssueOption, renderIssueActions, onSubmit, onClose,
}: StudioBatchReviewDialogProps) {
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose, closeOnEscape: !busy });
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const activeIssue = issues.find(issue => issue.id === activeIssueId);
  const pendingCount = issues.filter(issue => !issue.resolved).length;
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" onClick={() => { if (!busy) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="studio-batch-review-title" onClick={event => event.stopPropagation()} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 id="studio-batch-review-title" className="text-lg font-black text-text-primary">进入成片前确认</h2>
          <p className="mt-1 text-xs text-text-muted">系统已自动选择可用素材和制作路线，只需处理少数例外。</p>
        </div>
        <button type="button" aria-label="关闭首帧审核" onClick={onClose} disabled={busy} className="rounded-lg p-1 text-text-muted hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto md:flex md:overflow-hidden">
      <div className="min-w-0 flex-1 space-y-5 px-5 py-5 sm:px-6 md:overflow-y-auto">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">已就绪 {readyShots}/{totalShots} 镜</span>
          {generatingShots > 0 && <span className="rounded-full bg-sky-50 px-3 py-1.5 text-sky-800">生成中 {generatingShots} 镜</span>}
          {pendingCount > 0 && <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">待完成 {pendingCount} 项</span>}
          {pendingShots > 0 && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">待制作 {pendingShots} 镜</span>}
        </div>

        {issues.length > 0 && <section aria-labelledby="studio-review-issues-title">
          <h3 id="studio-review-issues-title" className="mb-2 text-sm font-black text-text-primary">需要你看一下</h3>
          <div className="space-y-2">{issues.map(issue => <article key={issue.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
            <div className="flex items-start gap-2">
              {issue.resolved ? <Check size={16} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-700" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-text-primary">{issue.shotNumber === 0 ? '全片' : `分镜 ${issue.shotNumber}`} · {issue.title}</p>
                <p className="mt-1 text-xs text-text-secondary">{issue.question}</p>
                {issue.detail && <p className="mt-1 text-[11px] text-text-muted">{issue.detail}</p>}
              </div>
            </div>
            <button type="button" aria-label={`去处理分镜 ${issue.shotNumber}`} aria-pressed={activeIssue?.id === issue.id} aria-controls="studio-review-actions" onClick={() => setActiveIssueId(issue.id)} className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold ${activeIssue?.id === issue.id ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-border bg-white text-text-secondary hover:border-emerald-500'}`}>去处理</button>
          </article>)}</div>
        </section>}

        {frames.length > 0 && <section aria-labelledby="studio-review-frames-title">
          <h3 id="studio-review-frames-title" className="mb-2 text-sm font-black text-text-primary">已准备的目标首帧 <span className="font-normal text-text-muted">· {frames.length} 镜，可快速抽查</span></h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{frames.map(frame => <figure key={frame.id} className="min-w-0 overflow-hidden rounded-xl border border-border bg-slate-50"><img src={frame.imageUrl} alt={`分镜 ${frame.shotNumber} 目标首帧`} className="aspect-[9/12] w-full object-contain bg-slate-900" /><figcaption className="truncate px-2 py-1.5 text-[11px] font-bold text-text-secondary">{frame.shotNumber}. {frame.title}</figcaption></figure>)}</div>
        </section>}
        {!issues.length && !frames.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-text-muted">当前没有需要审核的首帧。</p>}
      </div>
      <aside id="studio-review-actions" aria-label="问题处理" className="w-full shrink-0 border-t border-border bg-slate-50 px-5 py-5 md:w-72 md:overflow-y-auto md:border-l md:border-t-0" aria-live="polite">
        <h3 className="text-sm font-black text-text-primary">问题处理</h3>
        {activeIssue ? <div key={activeIssue.id} className="mt-4 space-y-3">
          <p className="text-xs font-black text-emerald-800">{activeIssue.shotNumber === 0 ? '全片' : `分镜 ${activeIssue.shotNumber}`} · {activeIssue.title}</p>
          <p className="text-xs font-bold text-text-secondary">{activeIssue.question}</p>
          {activeIssue.detail && <p className="break-words text-xs leading-5 text-text-muted">{activeIssue.detail}</p>}
          <div className="space-y-2">{renderIssueActions?.(activeIssue) ?? (activeIssue.options?.length ? activeIssue.options : [{ id: 'open-video', label: '打开分镜配置' }]).map(option => <button key={option.id} type="button" aria-pressed={activeIssue.selectedOptionId === option.id} disabled={busy} onClick={() => onSelectIssueOption(activeIssue.id, option.id)} className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-left text-xs font-bold text-text-secondary hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{option.label}</button>)}</div>
          {busy && <p role="status" className="text-xs text-sky-700">正在处理，请稍候…</p>}
          {error && <p role="alert" className="break-words text-xs text-red-700">{error}</p>}
        </div> : <p className="mt-4 text-xs leading-5 text-text-muted">点击左侧问题卡片的“去处理”，在这里查看并执行对应操作。</p>}
      </aside>
      </div>

      <footer className="flex shrink-0 items-end justify-between gap-3 border-t border-border bg-white px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1 text-xs text-text-muted">{estimatedCostCny !== undefined && <p>本批预计费用 ¥{estimatedCostCny.toFixed(2)}</p>}{pendingCount > 0 && <p className="mt-1 text-amber-700">请完成全部 {pendingCount} 项后进入下一步</p>}{pendingShots > 0 && <p className="mt-1">其余 {pendingShots} 镜可返回步骤二继续制作。</p>}{error && <p role="alert" className="mt-1 text-red-700">{error}</p>}</div>
        <button type="button" data-modal-initial-focus onClick={onSubmit} disabled={!canSubmit || busy || pendingCount > 0} className="ml-auto shrink-0 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '正在处理…' : submitLabel}</button>
      </footer>
    </div>
  </div>;
}
