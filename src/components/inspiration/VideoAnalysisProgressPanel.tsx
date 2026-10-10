import { useEffect, useState } from 'react';
import { AlertTriangle, Clock3, Loader2, RotateCcw, ServerCog } from 'lucide-react';
import type { VideoAnalysisProgress } from '../../lib/inspirationTypes';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';

const activeStages = new Set<VideoAnalysisProgress['stage']>([
  'queued', 'downloading', 'transcoding', 'analyzing', 'extracting_evidence',
]);

export function analysisProgressIsActive(progress: VideoAnalysisProgress | undefined): boolean {
  return Boolean(progress && activeStages.has(progress.stage));
}

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function analysisDurationLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const seconds = Math.floor(totalSeconds);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function analysisElapsedLabel(progress: VideoAnalysisProgress, nowMs: number): string {
  const origin = parsedTime(progress.startedAt) ?? parsedTime(progress.queuedAt);
  return origin === null ? '后端未提供' : analysisDurationLabel(Math.max(0, (nowMs - origin) / 1000));
}

export function analysisEtaLabel(progress: VideoAnalysisProgress): string {
  const estimatedAt = parsedTime(progress.estimatedCompletedAt);
  if (estimatedAt !== null) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(estimatedAt);
  }
  return typeof progress.etaSeconds === 'number' && Number.isFinite(progress.etaSeconds) && progress.etaSeconds >= 0
    ? `约 ${analysisDurationLabel(progress.etaSeconds)}后`
    : '后端暂未给出';
}

function progressPercent(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
}

function backendState(progress: VideoAnalysisProgress): { label: string; className: string } {
  if (!progress.backendAccepted) return { label: '尚未确认受理', className: 'text-rose-700' };
  if (progress.workerStarted) return { label: '后台已开始执行', className: 'text-emerald-700' };
  return { label: '后台已受理，等待执行', className: 'text-amber-700' };
}

function queueLabel(progress: VideoAnalysisProgress): string {
  if (typeof progress.queuePosition === 'number' && Number.isInteger(progress.queuePosition) && progress.queuePosition > 0) return `第 ${progress.queuePosition} 位`;
  return progress.stage === 'queued' ? '后端暂未给出' : '当前不在排队';
}

function updatedLabel(value: string | null): string {
  const timestamp = parsedTime(value);
  if (timestamp === null) return '更新时间未提供';
  return `更新于 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(timestamp)}`;
}

export default function VideoAnalysisProgressPanel({
  progress,
  pending,
  onRetry,
  retryDisabled = false,
}: {
  progress?: VideoAnalysisProgress;
  pending: boolean;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!progress || !activeStages.has(progress.stage)) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress?.stage, progress?.runId]);

  if (progress?.stage === 'completed') return null;

  if (!progress) {
    if (!pending) return null;
    return <section aria-label="分析进度" role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50/45 p-4">
      <div className="flex items-start gap-3">
        <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-amber-700" />
        <div><h3 className="text-sm font-semibold text-text-primary">正在同步后台任务状态</h3><p className="mt-1 text-xs leading-5 text-amber-900">暂未收到可核验的后台进度凭证，因此还不能确认 Worker 已开始。页面会继续刷新真实状态。</p></div>
      </div>
    </section>;
  }

  const percent = progressPercent(progress.percent);
  const backend = backendState(progress);
  const isActive = analysisProgressIsActive(progress);
  const isFailed = progress.stage === 'failed';
  const isInterrupted = progress.stage === 'paused' || progress.stage === 'cancelled';
  const runToken = progress.runId?.trim() ? progress.runId.trim().slice(-8) : '';
  const tone = isFailed ? 'border-rose-200 bg-rose-50/60' : progress.stage === 'paused' || progress.stage === 'cancelled' ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50/45';

  return <section aria-label="分析进度" className={`mb-4 rounded-lg border p-4 ${tone}`}>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{progress.stageLabel || '后台分析状态'}：{progress.currentStep || '后端暂未提供当前步骤'}；{backend.label}</p>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ${isFailed ? 'text-rose-700' : 'text-amber-700'}`}>
          {isFailed ? <AlertTriangle size={18} /> : isActive ? <Loader2 size={18} className="animate-spin" /> : <Clock3 size={18} />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="text-sm font-semibold text-text-primary">{progress.stageLabel || '后台分析状态'}</h3>{percent !== null && <strong className="text-sm text-accent">{percent}%</strong>}</div>
          <p className="mt-1 text-xs leading-5 text-text-secondary">{progress.currentStep || '后端暂未提供当前步骤'}</p>
          <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${backend.className}`}><ServerCog size={12} />{backend.label}</p>
        </div>
      </div>
      <div className="text-right text-[11px] leading-4 text-text-muted"><p>{updatedLabel(progress.updatedAt)}</p>{runToken && <p title={progress.runId || undefined}>任务凭证 · {runToken}</p>}</div>
    </div>

    {percent !== null && <LsGradientProgress className="mt-3" aria-label="当前处理阶段里程碑" percent={percent} showInfo={false} size="small" status={isFailed ? 'exception' : 'active'} />}

    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div className="rounded-md bg-white/80 px-3 py-2"><dt className="text-text-muted">后台执行</dt><dd className={`mt-1 font-semibold ${backend.className}`}>{progress.workerStarted ? '已启动' : progress.backendAccepted ? '等待 Worker' : '未确认'}</dd></div>
      <div className="rounded-md bg-white/80 px-3 py-2"><dt className="text-text-muted">排队位置</dt><dd className="mt-1 font-semibold text-text-primary">{queueLabel(progress)}</dd></div>
      <div className="rounded-md bg-white/80 px-3 py-2"><dt className="text-text-muted">已等待 / 耗时</dt><dd className="mt-1 font-semibold text-text-primary">{analysisElapsedLabel(progress, nowMs)}</dd></div>
      <div className="rounded-md bg-white/80 px-3 py-2"><dt className="text-text-muted">预计完成</dt><dd className="mt-1 font-semibold text-text-primary">{analysisEtaLabel(progress)}</dd></div>
    </dl>

    {percent === null && isActive && <p className="mt-3 text-[11px] leading-4 text-text-muted">后台尚未提供可信百分比，界面不会模拟递增。</p>}
    {isFailed && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rose-200 pt-3"><p className="text-xs font-medium text-rose-800">{progress.retryable ? '本次运行已停止，可以从失败状态重新提交。' : '本次运行已停止，后台未标记为可重试。'}</p>{progress.retryable && <button type="button" onClick={onRetry} disabled={retryDisabled} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"><RotateCcw size={13} />重试分析</button>}</div>}
    {isInterrupted && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><p className="text-xs font-medium text-slate-700">分析进度已保留，可从当前记录重新提交，不会让卡片一直停在暂停遮罩中。</p><button type="button" onClick={onRetry} disabled={retryDisabled} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"><RotateCcw size={13} />继续分析</button></div>}
  </section>;
}
