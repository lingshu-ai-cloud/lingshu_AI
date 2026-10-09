import { useEffect, useRef, useState } from 'react';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import type { WeeklyReviewEvidenceView } from '../../../shared/contracts/weeklyReviewEvidence';
import { getScrollBehavior } from '../../lib/usePrefersReducedMotion';
import { loadWeeklyReviewEvidenceForScope } from '../../lib/weeklyReviewEvidenceApi';
import { weeklyReviewPanelId } from './reviewCalendarNavigation';

const observed = (value: number | null | undefined) => value === null || value === undefined ? '未观测' : String(value);

export default function WeeklyReviewEvidencePanel({
  pkg,
  tasks,
  taskId,
}: {
  pkg: WeeklyOperatingPackage;
  tasks: WeeklyExecutionTask[];
  taskId?: string;
}) {
  const scoped = tasks.filter(task => task.programId === pkg.programId && task.packageId === pkg.packageId && task.packageVersion === pkg.version);
  const chosen = taskId
    ?? scoped.find(task => task.schedule.stepKind === 'weekly_review')?.taskId
    ?? scoped.find(task => task.schedule.stepKind === 'performance_monitoring')?.taskId;
  const matches = scoped.filter(task => task.taskId === chosen && ['weekly_review', 'performance_monitoring'].includes(task.schedule.stepKind));
  const task = matches.length === 1 && new Set(scoped.map(item => item.tenantId)).size === 1 ? matches[0] : null;
  const identity = JSON.stringify([pkg.programId, pkg.packageId, pkg.version, chosen]);
  const current = useRef(identity);
  current.current = identity;
  const section = useRef<HTMLElement>(null);
  const [state, setState] = useState<{ identity: string; item: WeeklyReviewEvidenceView } | null>(null);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const taskEvidence = JSON.stringify(task ? [task.status, task.resultRefs, task.lastError?.message, task.ownBlockingReasons] : null);

  useEffect(() => {
    let active = true;
    if (!task) return;
    setError(null);
    const captured = identity;
    void loadWeeklyReviewEvidenceForScope({
      scope: { programId: pkg.programId, packageId: pkg.packageId, packageVersion: pkg.version, taskId: task.taskId },
      isCurrent: () => active && current.current === captured,
      onLoaded: item => setState({ identity: captured, item }),
    }).catch(cause => {
      if (active && current.current === captured) {
        setError({ identity: captured, message: cause instanceof Error ? cause.message : '真实复盘证据读取失败' });
      }
    });
    return () => { active = false; };
  }, [identity, refresh, Boolean(task), taskEvidence]);

  useEffect(() => {
    if (!taskId || !task || !section.current) return;
    let parent = section.current.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
      parent = parent.parentElement;
    }
    section.current.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
    section.current.focus({ preventScroll: true });
  }, [identity]);

  const item = state?.identity === identity ? state.item : null;
  const message = error?.identity === identity ? error.message : null;

  return (
    <section
      ref={section}
      id={weeklyReviewPanelId(pkg)}
      tabIndex={-1}
      data-review-task={task?.taskId}
      data-review-program={pkg.programId}
      data-review-package={pkg.packageId}
      data-review-version={String(pkg.version)}
      className="scroll-mt-6 space-y-3 rounded-lg border border-border bg-white p-4 text-xs"
    >
      <h4 className="text-sm font-bold">本周真实社媒指标与冻结复盘</h4>
      <p>周包 v{pkg.version} · {pkg.weekStart} — {pkg.weekEnd}。读取实际执行证据；刷新仅查询，不触发复盘扫描或生成报告。</p>
      {!task && <p className="text-amber-800">当前周版本没有匹配的真实指标或复盘任务，请刷新任务图。</p>}
      {task && <p>执行任务：{task.taskId} · {task.schedule.stepKind === 'weekly_review' ? '周复盘' : '效果指标监测'} · 后台状态 {task.status}</p>}
      {message && <p role="alert" className="text-red-700">{message}</p>}
      {task && !item && !message && <p role="status">正在读取这条任务的真实复盘证据…</p>}
      {item && <>
        <p>报告窗口（沿用现有 worker 的 UTC 统计窗口）：{item.window.startsAt} — {item.window.endsAt} · {item.window.closed ? '已结束' : '尚未结束'}</p>
        <p>读取状态：{{ report_frozen: '报告已冻结', monitoring_evidence: '已有指标证据', waiting_window: '等待窗口结束', waiting_evidence: '等待真实证据', blocked: '证据或执行受阻' }[item.state]}</p>
        {item.gaps.map((gap, index) => <p key={index} className="text-amber-800">{gap}</p>)}
        {item.task.blockingReasons.map((reason, index) => <p key={index} className="text-amber-800">{reason}</p>)}
        {item.task.lastError && <p className="text-red-700">实际执行错误：{item.task.lastError}</p>}
        {item.metrics.map(metric => <article key={metric.ref.id} className="rounded-lg border border-border p-2">
          <p>实际指标 {metric.ref.id} · 账号 {metric.accountId} · 内容 {metric.contentId ?? '账号级观测'} · {metric.capturedAt}</p>
          <p>播放 {observed(metric.values.views)} · 赞 {observed(metric.values.likes)} · 转 {observed(metric.values.shares)} · 评 {observed(metric.values.comments)}</p>
        </article>)}
        {item.report && <div className="space-y-2">
          <p className="font-semibold">冻结报告 {item.report.snapshotId} · v{item.report.version} · {item.report.window.frozenAt}</p>
          <p>样本状态：{item.report.sampleSufficiency.status} · 自有内容 {item.report.sampleSufficiency.ownedContentCount} · 可归因 {item.report.sampleSufficiency.attributableContentCount}</p>
          {item.report.sampleSufficiency.reasons.map((reason, index) => <p key={index} className="text-amber-800">{reason}</p>)}
          <p className="text-stone-500">外部参考不是客户自身经营成果；未观测指标不补零，播放与互动不等同成交。</p>
          {item.report.contents.map(content => <article key={`${content.platform}:${content.accountId}:${content.contentId}`} className="rounded-lg border border-border p-2">
            <p>{content.businessDirection} · {content.platform} · {content.accountId} · {content.contentId} · {content.evidenceKind === 'owned_content_result' ? '自有内容成果' : '外部参考'}</p>
            <p>播放 {observed(content.metrics.views?.value)} · 赞 {observed(content.metrics.likes?.value)} · 转 {observed(content.metrics.shares?.value)} · 评 {observed(content.metrics.comments?.value)}</p>
            <p>归因状态 {content.attributionStatus ?? 'unknown'} · 指标证据 {content.metricSnapshotRefs.join('、') || '暂无'}</p>
          </article>)}
        </div>}
      </>}
      <button type="button" disabled={!task} onClick={() => setRefresh(value => value + 1)} className="text-accent underline disabled:opacity-40">刷新真实只读证据</button>
    </section>
  );
}
