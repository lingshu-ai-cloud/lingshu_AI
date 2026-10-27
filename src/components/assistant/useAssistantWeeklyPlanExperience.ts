import { useCallback, useEffect, useState } from 'react';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { confirmedWeeklyExecution, weeklyStartConflictFromError, weeklyStartResultNeedsReconciliation } from '../../lib/weeklyStartValidation';
import { notifyWeeklyWorkUpdated, WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';

const operating = (data: DigitalEmployeeOverview | null) => Boolean(data?.goal && confirmedWeeklyExecution(data, data.goal.id));

export function useAssistantWeeklyPlanExperience() {
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [proposal, setProposal] = useState<DigitalEmployeeOverview | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const refresh = useCallback(async () => {
    const next = await digitalEmployeeApi.overview();
    setOverview(next);
    return next;
  }, []);
  useEffect(() => {
    let active = true;
    void digitalEmployeeApi.overview().then(value => { if (active) setOverview(value); }).catch(() => undefined);
    const update = () => void refresh().catch(() => undefined);
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, update);
    return () => { active = false; window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, update); };
  }, [refresh]);

  const prepare = useCallback(async () => {
    setError('');
    const next = await digitalEmployeeApi.overview();
    if (!next.config) throw new Error('请先点击上方『让灵小枢认识我』完成基础资料');
    setOverview(next);setProposal(null);setModalOpen(false);
    window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'digitalEmployees'}}));
    window.setTimeout(()=>window.dispatchEvent(new CustomEvent('lingshu:open-weekly-plan',{detail:{source:'assistant'}})),0);
    return next.goal&&next.plan
      ? '已打开经营总览中的当前周计划。计划范围、预算、版本和启动确认都在同一处处理。'
      : '已打开经营总览中的周计划编辑页。系统会预填建议，但在你确认前不会保存或启动计划。';
  }, []);

  const confirm = useCallback(async () => {
    const current = proposal;
    if (!current?.goal || !current.plan?.businessPackage || busy) return;
    setBusy(true); setError('');
    let requestSent = false;
    let reconciliationRead = false;
    const finish = (next: DigitalEmployeeOverview) => {
      const execution = confirmedWeeklyExecution(next, current.goal!.id);
      if (!execution) return false;
      setOverview(next); setProposal(next); setModalOpen(false); setCelebrating(true);
      notifyWeeklyWorkUpdated({ source: 'assistant', goalId: current.goal!.id, execution: {
        goalId: current.goal!.id, runId: execution.run.id, status: execution.run.status,
        taskCount: execution.tasks.length, startedAt: execution.run.started_at,
      } });
      window.setTimeout(() => setCelebrating(false), 900);
      return true;
    };
    try {
      requestSent = true;
      let next = await digitalEmployeeApi.approveGoal(current.goal.id, current.plan.businessPackage.revision, true);
      let finished = finish(next);
      if (!finished) {
        reconciliationRead = true;
        next = await digitalEmployeeApi.overview(current.goal.id);
        finished = finish(next);
      }
      if (!finished) throw new Error('启动请求已经发出，但暂未取得可确认的运行回执。系统不会自动重复启动，请稍后刷新查看。');
    } catch (cause) {
      const conflict = weeklyStartConflictFromError(cause);
      if (conflict) setError(`${conflict.goalTitle || '另一轮周计划'}正在运行，本周计划没有被重复启动。`);
      else if (requestSent && !reconciliationRead && weeklyStartResultNeedsReconciliation(cause)) {
        reconciliationRead = true;
        try { if (finish(await digitalEmployeeApi.overview(current.goal.id))) return; } catch { /* one read cannot prove the result */ }
        setError('启动结果暂时无法确认。系统已完成一次只读核对，不会自动重复提交，请稍后刷新查看。');
      } else setError(cause instanceof Error ? cause.message : '周计划启动失败');
    } finally { setBusy(false); }
  }, [busy, proposal]);

  return {
    proposal, modalOpen, busy, error, celebrating, weeklyPlanOperating: operating(overview),
    prepare, open: () => setModalOpen(true), close: () => { if (!busy) setModalOpen(false); }, confirm,
  };
}

export type AssistantWeeklyPlanExperience = ReturnType<typeof useAssistantWeeklyPlanExperience>;
