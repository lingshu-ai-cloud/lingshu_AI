import { Button } from 'antd';
import { LsFlowDialog, LsGradientProgress } from '../ui/LsExperiencePrimitives';
import { useState, type ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';

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

export function StudioBatchReviewFooter({ issues, pendingShots = 0, estimatedCostCny, error, busy = false, canSubmit, submitLabel = '确认首帧并生成视频', onSubmit }: StudioBatchReviewDialogProps) {
  const pendingCount = issues.filter(issue => !issue.resolved).length;
  return <div className="flex flex-wrap items-end justify-between gap-3 text-left">
    <div className="min-w-0 flex-1 text-xs text-text-muted">{estimatedCostCny !== undefined && <p>本批预计费用 ¥{estimatedCostCny.toFixed(2)}</p>}{pendingCount > 0 && <p className="mt-1 text-amber-700">请完成全部 {pendingCount} 项后进入下一步</p>}{pendingShots > 0 && <p className="mt-1">其余 {pendingShots} 镜可返回步骤二继续制作。</p>}{error && <p role="alert" className="mt-1 text-red-700">{error}</p>}</div>
    <Button type="primary" onClick={onSubmit} loading={busy} disabled={busy || !canSubmit || pendingCount > 0}>{submitLabel}</Button>
  </div>;
}

export default function StudioBatchReviewDialog(props: StudioBatchReviewDialogProps) {
  const pendingCount = props.issues.filter(issue => !issue.resolved).length;
  return <LsFlowDialog open title="进入成片前确认" width={840} centered onCancel={props.onClose}
    current={pendingCount > 0 ? 1 : 2}
    steps={[{ title: '抽查目标首帧' }, { title: '处理待确认项' }, { title: '开始生成视频' }]}
    closable={!props.busy} keyboard={!props.busy} mask={{ closable: false }}
    footer={<StudioBatchReviewFooter {...props} />} styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
    <StudioBatchReviewContent {...props} />
  </LsFlowDialog>;
}

export function StudioBatchReviewContent({
  issues, frames, totalShots, readyShots, generatingShots = 0, pendingShots = 0, estimatedCostCny,
  busy = false, error, canSubmit, submitLabel = '确认首帧并生成视频', onSelectIssueOption, renderIssueActions, onSubmit, onClose,
}: StudioBatchReviewDialogProps) {
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const activeIssue = issues.find(issue => issue.id === activeIssueId);
  const pendingCount = issues.filter(issue => !issue.resolved).length;
  return <>
    <p className="mb-4 text-sm text-text-secondary">核对目标首帧，处理待确认项后开始生成。</p>
    <LsGradientProgress percent={totalShots > 0 ? Math.round(readyShots / totalShots * 100) : 0} format={() => `${readyShots}/${totalShots} 镜就绪`} />
      <div className="min-h-0 flex-1 overflow-y-auto md:flex md:overflow-hidden">
      <div className="min-w-0 flex-1 space-y-5 px-5 py-5 sm:px-6 md:overflow-y-auto">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">已就绪 {readyShots}/{totalShots} 镜</span>
          {generatingShots > 0 && <span className="rounded-full bg-sky-50 px-3 py-1.5 text-sky-800">生成中 {generatingShots} 镜</span>}
          {pendingCount > 0 && <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">待完成 {pendingCount} 项</span>}
          {pendingShots > 0 && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">待制作 {pendingShots} 镜</span>}
        </div>

        {issues.length > 0 && <section aria-labelledby="studio-review-issues-title">
          <h3 id="studio-review-issues-title" className="mb-2 text-sm font-semibold text-text-primary">需要你看一下</h3>
          <div className="space-y-2">{issues.map(issue => <article key={issue.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
            <div className="flex items-start gap-2">
              {issue.resolved ? <Check size={16} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-700" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary">{issue.shotNumber === 0 ? '全片' : `分镜 ${issue.shotNumber}`} · {issue.title}</p>
                <p className="mt-1 text-xs text-text-secondary">{issue.question}</p>
                {issue.detail && <p className="mt-1 text-[11px] text-text-muted">{issue.detail}</p>}
              </div>
            </div>
            <Button className="mt-3" aria-label={`去处理分镜 ${issue.shotNumber}`} aria-pressed={activeIssue?.id === issue.id} aria-controls="studio-review-actions" onClick={() => setActiveIssueId(issue.id)}>去处理</Button>
          </article>)}</div>
        </section>}

        {frames.length > 0 && <section aria-labelledby="studio-review-frames-title">
          <h3 id="studio-review-frames-title" className="mb-2 text-sm font-semibold text-text-primary">已准备的目标首帧 <span className="font-normal text-text-muted">· {frames.length} 镜，可快速抽查</span></h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{frames.map(frame => <figure key={frame.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-slate-50"><img src={frame.imageUrl} alt={`分镜 ${frame.shotNumber} 目标首帧`} className="aspect-[9/12] w-full object-contain bg-slate-900" /><figcaption className="truncate px-2 py-1.5 text-[11px] font-bold text-text-secondary">{frame.shotNumber}. {frame.title}</figcaption></figure>)}</div>
        </section>}
        {!issues.length && !frames.length && <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-text-muted">当前没有需要审核的首帧。</p>}
      </div>
      <aside id="studio-review-actions" aria-label="问题处理" className="w-full shrink-0 border-t border-border bg-slate-50 px-5 py-5 md:w-72 md:overflow-y-auto md:border-l md:border-t-0" aria-live="polite">
        <h3 className="text-sm font-semibold text-text-primary">问题处理</h3>
        {activeIssue ? <div key={activeIssue.id} className="mt-4 space-y-3">
          <p className="text-xs font-semibold text-emerald-800">{activeIssue.shotNumber === 0 ? '全片' : `分镜 ${activeIssue.shotNumber}`} · {activeIssue.title}</p>
          <p className="text-xs font-bold text-text-secondary">{activeIssue.question}</p>
          {activeIssue.detail && <p className="break-words text-xs leading-5 text-text-muted">{activeIssue.detail}</p>}
          <div className="space-y-2">{renderIssueActions?.(activeIssue) ?? (activeIssue.options?.length ? activeIssue.options : [{ id: 'open-video', label: '打开分镜配置' }]).map(option => <Button key={option.id} block aria-pressed={activeIssue.selectedOptionId === option.id} disabled={busy} onClick={() => onSelectIssueOption(activeIssue.id, option.id)}>{option.label}</Button>)}</div>
          {busy && <p role="status" className="text-xs text-sky-700">正在处理，请稍候…</p>}
          {error && <p role="alert" className="break-words text-xs text-red-700">{error}</p>}
        </div> : <p className="mt-4 text-xs leading-5 text-text-muted">点击左侧问题卡片的“去处理”，在这里查看并执行对应操作。</p>}
      </aside>
      </div>

  </>;
}
