import { Alert, Button } from 'antd';
import type { WeeklyStartConflict } from '../lib/weeklyStartValidation';

export default function WeeklyStartConflictAlert({ conflict, statusLabels, onViewRun }: {
  conflict: WeeklyStartConflict;
  statusLabels: Record<string, string>;
  onViewRun: () => void;
}) {
  const state = statusLabels[conflict.runStatus] || statusLabels[conflict.goalStatus] || conflict.runStatus || conflict.goalStatus || '执行中';
  const range = conflict.startsAt && conflict.endsAt ? `${conflict.startsAt} 至 ${conflict.endsAt}` : '';
  return <Alert
    type="warning"
    showIcon
    title="周任务未启动：已有另一轮任务正在执行"
    description={(
      <div className="space-y-1 text-xs leading-5">
        <p>{conflict.goalTitle || '另一轮周任务'}{range ? `（${range}）` : ''}当前为“{state}”。本轮计划仍未开工，系统不会自动取消或重复启动任何运行。</p>
        {(conflict.runId || conflict.goalId) && <p className="font-mono text-text-muted">
          {conflict.runId ? `运行 ${conflict.runId}` : ''}{conflict.runId && conflict.goalId ? ' · ' : ''}{conflict.goalId ? `目标 ${conflict.goalId}` : ''}
        </p>}
      </div>
    )}
    action={<Button className="min-h-11" onClick={onViewRun}>查看该运行</Button>}
  />;
}
