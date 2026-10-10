import type { DigitalHumanExecutionRecord, DigitalHumanPlanRecord } from '../../lib/digitalHumanPlan';

export type DigitalHumanOverviewShot = {
  shotId: string;
  title: string;
  plan?: DigitalHumanPlanRecord;
  executions: DigitalHumanExecutionRecord[];
};

function executionStatus(execution: DigitalHumanExecutionRecord): string {
  if (execution.adoption) return '已填入分镜';
  if (execution.quality.state === 'accepted') return '待填入分镜';
  if (execution.quality.state === 'manual_review') return '待人工验收';
  if (execution.quality.state === 'failed') return '质检未通过';
  return ({ submitting: '正在提交', pending: '生成／检查中', completed: '质检中', failed: '生成失败', uncertain: '提交结果待核对', cancelled: '已取消' } as const)[execution.state];
}

export default function DigitalHumanProductionOverview({ shots, onOpenShot }: { shots: DigitalHumanOverviewShot[]; onOpenShot: (shotId: string) => void }) {
  if (!shots.length) return null;
  const latest = shots.map(shot => ({ shot, execution: [...shot.executions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] }));
  const adopted = latest.filter(item => item.execution?.adoption).length;
  const attention = latest.filter(item => item.execution && (item.execution.state === 'failed' || item.execution.state === 'uncertain' || item.execution.quality.state === 'failed')).length;
  const estimated = latest.reduce((sum, item) => sum + (item.execution?.estimatedCostCny ?? item.shot.plan?.estimatedCostCny ?? 0), 0);
  const actualValues = latest.map(item => item.execution?.actualCostCny).filter((value): value is number => value != null);
  const actual = actualValues.reduce((sum, value) => sum + value, 0);
  return <details className="mx-4 mb-4 rounded-lg border border-border bg-white shadow-none" aria-label="数字人制作进度">
    <summary className="cursor-pointer px-4 py-3 text-xs font-semibold">数字人制作进度 · {adopted}/{shots.length} 已填入{attention ? ` · ${attention} 项需处理` : ''}</summary>
    <div className="border-t px-4 py-3">
      <p className="mb-3 text-[10px] text-text-muted">当前视频预计费用 ¥{estimated.toFixed(2)} · 已对账 ¥{actual.toFixed(2)}{actualValues.length < latest.filter(item => item.execution).length ? ' · 部分任务待账单' : ''}</p>
      <ul className="space-y-2">{latest.map(({ shot, execution }) => {
        const status = execution ? executionStatus(execution) : shot.plan ? ({ needs_input: '待补资料', needs_confirmation: '待确认内容', preview_only: '仅方案预览', ready: '可生成' } as const)[shot.plan.state] : '待建立方案';
        const currentStep = execution?.routeSteps?.find(step => ['ready', 'running', 'attention', 'failed'].includes(step.status));
        return <li key={shot.shotId} className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 p-3 text-[10px]">
          <div className="min-w-0"><p className="font-bold text-text-primary">{shot.title} · {status}</p>
            {currentStep && <p className="mt-1 text-text-muted">当前步骤：{currentStep.label}</p>}
            {execution?.error && <p className="mt-1 text-red-600">{execution.error}</p>}
            {execution?.quality.reviewNote && <p className="mt-1 text-amber-700">修改意见：{execution.quality.reviewNote}</p>}
            <p className="mt-1 text-text-muted">预计 {execution?.estimatedCostCny == null && shot.plan?.estimatedCostCny == null ? '待确认' : `¥${(execution?.estimatedCostCny ?? shot.plan?.estimatedCostCny ?? 0).toFixed(2)}`} · 实际 {execution?.costStatus === 'reconciled' && execution.actualCostCny != null ? `¥${execution.actualCostCny.toFixed(2)}` : '待对账'}</p>
            {execution && <details className="mt-1"><summary>技术记录</summary><p>{execution.tool} · {execution.externalTaskId || '外部任务待确认'}{execution.adoption ? ` · 装配 ${execution.adoption.assemblyVersion}` : ''}</p></details>}
          </div>
          <button type="button" onClick={() => onOpenShot(shot.shotId)} className="shrink-0 rounded border bg-white px-2 py-1 font-bold text-accent">打开分镜处理</button>
        </li>;
      })}</ul>
    </div>
  </details>;
}
