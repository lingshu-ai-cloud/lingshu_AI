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
    if (next.goal && next.plan && !operating(next)) setProposal(current => current?.goal?.id === next.goal?.id ? current : next);
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
    let next = await digitalEmployeeApi.overview();
    if (!next.goal || !next.plan) {
      if (!next.config) throw new Error('请先点击上方『让灵小枢认识我』完成基础资料');
      const { defaultWeeklyGoal } = await import('../../lib/defaultWeeklyGoal');
      next = await digitalEmployeeApi.createGoal(defaultWeeklyGoal(next.config).draft);
    }
    if (!next.goal || !next.plan?.businessPackage) throw new Error('周计划没有生成完整，请稍后重试。');
    setOverview(next); setProposal(next);
    const planCount = next.goal.videoPlans?.length || next.plan.businessPackage.operatingContext?.outputs.count || 0;
    const platforms = next.goal.contentPlatforms.join('、');
    return `已生成本周运营计划：${next.goal.objective}。周期为 ${next.goal.startsAt} 至 ${next.goal.endsAt}，覆盖 ${platforms || '待确认平台'}${planCount ? `，共 ${planCount} 条内容` : ''}。点击下方卡片查看全部安排，确认无误后才会正式开始运行。`;
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
