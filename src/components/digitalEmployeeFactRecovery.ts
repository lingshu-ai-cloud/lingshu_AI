import { authHeader } from '../lib/auth';
import { showActionSuccess } from '../lib/actionFeedback';
import { DigitalEmployeeApiError } from '../lib/digitalEmployeeApi';
import {
  digitalEmployeeApi,
  ENTERPRISE_FACTS_CHANGED_ERROR_CODE,
  enterpriseFactsRebuildInput,
  type DigitalEmployeeOverview,
  type WeeklyGoal,
} from '../lib/digitalEmployees';

interface FactRecoveryContext {
  pending: Map<string, Promise<void>>;
  overviewRequestVersionRef: { current: number };
  setData: (value: DigitalEmployeeOverview) => void;
  setError: (value: string) => void;
  setViewGoalId: (value: string) => void;
  setNewGoal: (value: boolean) => void;
  setPlanHistoryOpen: (value: boolean) => void;
  setSelectedContentItemId: (value: string) => void;
  setWorkspaceView: (value: 'today') => void;
  setWeeklyPlanOpen: (value: boolean) => void;
  authorization?: () => string | undefined;
  rebuildGoal?: typeof digitalEmployeeApi.rebuildGoalFromLatestFacts;
  notifySuccess?: typeof showActionSuccess;
}

export function createDigitalEmployeeFactRecovery(context: FactRecoveryContext) {
  const authorizationNow = context.authorization || (() => authHeader().Authorization);
  const rebuildGoal = context.rebuildGoal || digitalEmployeeApi.rebuildGoalFromLatestFacts;
  const notifySuccess = context.notifySuccess || showActionSuccess;
  return async function recoverEnterpriseFactsChanged(
    actionError: unknown,
    staleGoal: Pick<WeeklyGoal, 'id' | 'version'> | null | undefined,
  ): Promise<boolean> {
    if (
      !(actionError instanceof DigitalEmployeeApiError)
      || actionError.code !== ENTERPRISE_FACTS_CHANGED_ERROR_CODE
      || !staleGoal
    ) return false;

    let rebuildInput: ReturnType<typeof enterpriseFactsRebuildInput>;
    try {
      rebuildInput = enterpriseFactsRebuildInput(staleGoal, actionError.details);
    } catch {
      return false;
    }
    const authorization = authorizationNow();
    const recoveryKey = [
      authorization || '',
      staleGoal.id,
      rebuildInput.expectedGoalVersion,
      rebuildInput.sourcePlanId,
      rebuildInput.expectedFactsVersion,
      rebuildInput.expectedSourcePlanDigest,
    ].join('\u0000');
    const pending = context.pending.get(recoveryKey);
    if (pending) {
      await pending;
      return true;
    }
    const recovery = (async () => {
      try {
        let rebuildAttempt = 0;
        let rebuilt: DigitalEmployeeOverview;
        while (true) {
          try {
            rebuilt = await rebuildGoal(staleGoal.id, rebuildInput);
            break;
          } catch (rebuildError) {
            if (
              rebuildAttempt >= 1
              || !(rebuildError instanceof DigitalEmployeeApiError)
              || rebuildError.code !== ENTERPRISE_FACTS_CHANGED_ERROR_CODE
            ) throw rebuildError;
            // Retry only the guarded rebuild once, never the original mutation.
            rebuildAttempt += 1;
          }
        }
        if (authorization !== authorizationNow()) return;
        context.overviewRequestVersionRef.current += 1;
        context.setData(rebuilt);
        context.setError('');
        context.setViewGoalId('');
        context.setNewGoal(false);
        context.setPlanHistoryOpen(false);
        context.setSelectedContentItemId('');
        context.setWorkspaceView('today');
        context.setWeeklyPlanOpen(false);
        notifySuccess(
          '计划已按最新企业资料重建',
          '新版周计划已回到智能经营。请重新核对计划并确认开始生产；原保存、批准或启动操作没有自动重试。',
        );
      } catch (rebuildError) {
        if (authorization !== authorizationNow()) return;
        context.setError(rebuildError instanceof Error ? `计划自动重建失败：${rebuildError.message}` : '计划自动重建失败，请刷新后重试');
      }
    })();
    context.pending.set(recoveryKey, recovery);
    try {
      await recovery;
    } finally {
      if (context.pending.get(recoveryKey) === recovery) context.pending.delete(recoveryKey);
    }
    return true;
  };
}
