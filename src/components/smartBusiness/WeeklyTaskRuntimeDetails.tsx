import { Alert, Tag } from 'antd';

import type { WeeklyTaskWorkspace } from '../../../shared/contracts/weeklyTaskWorkspace';

type Props = {
  executionTaskId: string;
  loading: boolean;
  error: string;
  workspace: WeeklyTaskWorkspace | null;
};

const costLabel = {
  none: '尚无已结算费用',
  known: '已有真实结算费用',
  unknown: '费用状态尚不能核验',
} as const;

const chargeTone = {
  possible: 'warning',
  not_expected: 'success',
  unknown: 'info',
} as const;

/** Read-only runtime evidence inside the calendar's canonical task-detail drawer. */
export default function WeeklyTaskRuntimeDetails({ executionTaskId, loading, error, workspace }: Props) {
  if (loading) return <section aria-label="任务运行证据" data-execution-task-id={executionTaskId} className="rounded-lg border border-border p-4"><p role="status" className="text-sm text-text-secondary">正在核验任务运行证据…</p></section>;
  if (error) return <section aria-label="任务运行证据" data-execution-task-id={executionTaskId}><Alert type="error" showIcon title="任务运行证据无法读取" description={error}/></section>;
  if (!workspace) return null;
  if (workspace.executionTaskId !== executionTaskId) return <section aria-label="任务运行证据" data-execution-task-id={executionTaskId}><Alert type="error" showIcon title="任务运行证据身份不一致" description="日历任务与运行证据不是同一个 executionTask，已停止展示。请刷新后重试。"/></section>;

  const runtime = workspace.runtime;
  return <section aria-label="任务运行证据" data-execution-task-id={workspace.executionTaskId} className="space-y-4 rounded-lg border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="text-sm font-semibold text-text-primary">真实运行与恢复证据</h4><p className="mt-1 break-all text-xs text-text-secondary">执行任务：{workspace.executionTaskId} · 周包 v{workspace.packageVersion}</p></div>
      <Tag color={workspace.phase === 'blocked' || workspace.phase === 'waiting_human' ? 'warning' : workspace.phase === 'completed' ? 'success' : 'processing'}>{workspace.phase}</Tag>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-lg bg-surface-2 p-3"><h5 className="text-xs font-semibold">暂停原因</h5>{runtime.pauseReasons.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-800">{runtime.pauseReasons.map((reason, index) => <li key={`${reason.code}:${index}`}>{reason.message} · {reason.retryable === null ? '能否重试待核验' : reason.retryable ? '可重试' : '不可自动重试'}</li>)}</ul> : <p className="mt-2 text-xs text-text-secondary">当前没有持久化暂停原因。</p>}</section>
      <section className="rounded-lg bg-surface-2 p-3"><h5 className="text-xs font-semibold">真实费用</h5><p className="mt-2 text-sm font-medium">{costLabel[runtime.actualCost.status]}{runtime.actualCost.status === 'known' && runtime.actualCost.totalCny !== null ? ` · ¥${runtime.actualCost.totalCny.toFixed(2)}` : ''}</p><p className="mt-1 break-all text-xs text-text-secondary">费用凭据：{runtime.actualCost.evidenceRefs.join('、') || '暂无'}</p></section>
    </div>

    <section><h5 className="text-xs font-semibold">已完成工作</h5>{runtime.completedWork.length ? <ul className="mt-2 space-y-2">{runtime.completedWork.map(item => <li key={item.executionTaskId} className="rounded-lg border border-border px-3 py-2 text-xs"><strong>{item.stepKind}</strong> · {item.finishedAt || '完成时间待核验'}<p className="mt-1 break-all text-text-secondary">{item.resultRefs.length ? item.resultRefs.map(ref => `${ref.type}:${ref.id}:v${ref.version}`).join('、') : '无权威结果引用'}</p></li>)}</ul> : <p className="mt-2 text-xs text-text-secondary">尚无已完成步骤证据。</p>}</section>

    <section className="rounded-lg border border-border p-3"><h5 className="text-xs font-semibold">Job / Checkpoint / 恢复证据</h5><dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-text-secondary">Job</dt><dd className="break-all">{runtime.recovery.jobId || '尚未创建'}{runtime.recovery.jobStatus ? ` · ${runtime.recovery.jobStatus}` : ''}{runtime.recovery.jobAttempt !== null ? ` · 第 ${runtime.recovery.jobAttempt} 次` : ''}</dd></div><div><dt className="text-text-secondary">任务尝试</dt><dd>{runtime.recovery.taskAttempt}/{runtime.recovery.taskMaximumAttempts || '未设置'}</dd></div><div><dt className="text-text-secondary">重试分类</dt><dd>{runtime.recovery.retryClass || '暂无'}{runtime.recovery.nextAttemptAt ? ` · ${runtime.recovery.nextAttemptAt}` : ''}</dd></div><div><dt className="text-text-secondary">死信恢复</dt><dd>{runtime.recovery.recoveredFromDeadLetterAt || '无'}</dd></div></dl>
      <div className="mt-3"><p className="text-xs font-semibold">Checkpoint</p>{runtime.checkpoints.length ? runtime.checkpoints.map(item => <p key={`${item.key}:${item.version}`} className="mt-1 break-all text-xs text-text-secondary">{item.key} · v{item.version} · {item.updatedAt} · input {item.inputHash}</p>) : <p className="mt-1 text-xs text-text-secondary">暂无可核验 Checkpoint。</p>}</div>
      <div className="mt-3"><p className="text-xs font-semibold">供应商回执</p>{runtime.recovery.providerReceipts.length ? runtime.recovery.providerReceipts.map(item => <p key={`${item.provider}:${item.requestId}`} className="mt-1 break-all text-xs text-text-secondary">{item.provider} · {item.requestId} · {item.state}{item.providerTaskId ? ` · ${item.providerTaskId}` : ''}</p>) : <p className="mt-1 text-xs text-text-secondary">暂无供应商回执。</p>}</div>
    </section>

    <section className="rounded-lg bg-surface-2 p-3"><h5 className="text-xs font-semibold">下一动作</h5>{runtime.nextActions.map(action => <p key={`${action.code}:${action.label}`} className="mt-2 text-xs"><Tag color={action.userRequired ? 'warning' : 'default'}>{action.userRequired ? '需要用户处理' : '系统处理'}</Tag>{action.label}</p>)}</section>
    <Alert type={chargeTone[runtime.mayChargeAgain.status]} showIcon title={runtime.mayChargeAgain.status === 'possible' ? '再次执行可能产生费用' : runtime.mayChargeAgain.status === 'not_expected' ? '当前不预计再次收费' : '再次收费风险待核验'} description={runtime.mayChargeAgain.reason}/>
  </section>;
}
