import { showActionFeedback } from '../lib/actionFeedback';
import {
  confirmedWeeklyExecution,
  weeklyStartConflictFromError,
  weeklyStartResultNeedsReconciliation,
  type WeeklyStartConflict,
} from '../lib/weeklyStartValidation';
import { notifyWeeklyWorkUpdated } from '../lib/weeklyWorkEvents';
import { weeklyWorkStatus } from '../lib/weeklyWorkStatus';
import { digitalEmployeeApi, type DigitalEmployeeOverview } from '../lib/digitalEmployees';

type WeeklyLaunchApi = Pick<typeof digitalEmployeeApi, 'approveGoal' | 'overview'>;

interface WeeklyLaunchContext {
  data: DigitalEmployeeOverview | null;
  busy: string;
  overviewRequestVersionRef: { current: number };
  setData: (value: DigitalEmployeeOverview) => void;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  setWeeklyStartConflict: (value: WeeklyStartConflict | null) => void;
  setWeeklyPlanOpen: (value: boolean) => void;
  setNewGoal: (value: boolean) => void;
  setWorkspaceView: (value: 'matrix' | 'live') => void;
  setSelectedTaskId: (value: string) => void;
  recoverEnterpriseFactsChanged: (error: unknown, goal: NonNullable<DigitalEmployeeOverview['goal']>) => Promise<boolean>;
  api?: WeeklyLaunchApi;
  feedback?: typeof showActionFeedback;
  notify?: typeof notifyWeeklyWorkUpdated;
}

export function createDigitalEmployeeWeeklyLaunch(context: WeeklyLaunchContext) {
  const {
    data, busy, overviewRequestVersionRef, setData, setBusy, setError,
    setWeeklyStartConflict, setWeeklyPlanOpen, setNewGoal, setWorkspaceView,
    setSelectedTaskId, recoverEnterpriseFactsChanged,
  } = context;
  const api = context.api || digitalEmployeeApi;
  const feedback = context.feedback || showActionFeedback;
  const notify = context.notify || notifyWeeklyWorkUpdated;
  const reportWeeklyStartFailure = (message: string) => {
    setError(message);
    feedback({ title: '周任务未启动', description: message, tone: 'error' });
  };

  const publishWeeklyWorkUpdate = (next: DigitalEmployeeOverview) => {
    const updatedGoal = next.goal;
    if (!updatedGoal) return;
    const run = next.run;
    const tasks = run ? next.tasks.filter(task => task.run_id === run.id) : [];
    notify({
      source: 'page',
      goalId: updatedGoal.id,
      ...(run && run.goal_id === updatedGoal.id && tasks.length > 0 && Number.isFinite(Date.parse(run.started_at))
        ? { execution: { goalId: updatedGoal.id, runId: run.id, status: run.status, taskCount: tasks.length, startedAt: run.started_at } }
        : {}),
    });
  };

  const presentConfirmedWeeklyExecution = (next: DigitalEmployeeOverview, goalId: string) => {
    const execution = confirmedWeeklyExecution(next, goalId);
    if (!execution) return false;
    overviewRequestVersionRef.current += 1;
    setData(next);
    publishWeeklyWorkUpdate(next);
    setWeeklyPlanOpen(false);
    setNewGoal(false);
    const launchedStatus = weeklyWorkStatus(next);
    setWorkspaceView(launchedStatus?.phase === 'running' || launchedStatus?.phase === 'queued' ? 'matrix' : 'live');
    setSelectedTaskId(launchedStatus?.currentTaskId || execution.tasks[0]?.id || '');
    const feedbackTone = launchedStatus?.phase === 'running' || (launchedStatus?.phase === 'finished' && launchedStatus.outcome === 'succeeded')
      ? 'success'
      : launchedStatus?.phase === 'finished' && launchedStatus.outcome === 'failed'
        ? 'error'
        : launchedStatus?.phase === 'queued'
          ? 'info'
          : 'warning';
    feedback({
      title: launchedStatus?.title || '本周任务运行状态待确认',
      description: launchedStatus?.description || '真实运行已建立，请查看生产进度。',
      tone: feedbackTone,
    });
    return true;
  };

  const launchWeeklyPlan = async (source: DigitalEmployeeOverview | null) => {
    const goal = source?.goal;
    if (!goal) {
      reportWeeklyStartFailure('尚未创建本周目标，请先完成目标设置。');
      return;
    }
    if (!source?.plan?.businessPackage) {
      reportWeeklyStartFailure('本周计划尚未生成完整，请刷新后重试。');
      return;
    }
    setBusy('confirm-weekly-plan');
    setError('');
    setWeeklyStartConflict(null);
    let launchRequestSent = false;
    try {
      // Preparation is runtime work; only the server validates this revision.
      launchRequestSent = true;
      const next = await api.approveGoal(goal.id, source.plan.businessPackage.revision, true);
      if (!presentConfirmedWeeklyExecution(next, goal.id)) {
        throw new Error('启动结果未返回可确认的真实运行；系统不会自动重复提交同一周计划。');
      }
    } catch (actionError) {
      if (await recoverEnterpriseFactsChanged(actionError, goal)) return;
      const conflict = weeklyStartConflictFromError(actionError);
      if (conflict) {
        setError('');
        setWeeklyStartConflict(conflict);
        feedback({
          title: '周任务未启动',
          description: `${conflict.goalTitle || '另一轮周任务'}正在执行；请先查看该运行。本轮计划没有被重复启动。`,
          tone: 'error',
        });
        return;
      }
      if (launchRequestSent && weeklyStartResultNeedsReconciliation(actionError)) {
        try {
          const reconciled = await api.overview(goal.id);
          if (presentConfirmedWeeklyExecution(reconciled, goal.id)) return;
        } catch {
          // A failed read cannot prove whether the mutating request was accepted.
        }
        const message = '启动请求已经发出，但暂未取得可确认的运行回执。系统已执行一次只读核对，不会自动重复启动；请稍后刷新查看。';
        setError(message);
        feedback({ title: '启动结果待确认', description: message, tone: 'warning' });
        return;
      }
      reportWeeklyStartFailure(actionError instanceof Error ? actionError.message : '周任务启动失败');
    } finally {
      setBusy('');
    }
  };

  const confirmWeeklyPlan = async () => {
    if (busy) return;
    await launchWeeklyPlan(data);
  };

  return { confirmWeeklyPlan, launchWeeklyPlan, presentConfirmedWeeklyExecution, publishWeeklyWorkUpdate };
}
