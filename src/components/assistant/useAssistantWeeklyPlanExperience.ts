import { useCallback, useEffect, useState } from 'react';
import { defaultWeeklyGoal, type GoalDraft } from '../../lib/defaultWeeklyGoal';
import { DigitalEmployeeApiError, digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { socialDiscoveryApi } from '../../lib/socialDiscoveryApi';
import type { DigitalEmployeeConfig, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { confirmedWeeklyExecution, weeklyStartConflictFromError, weeklyStartResultNeedsReconciliation } from '../../lib/weeklyStartValidation';
import { notifyWeeklyWorkUpdated, WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import { ASSISTANT_WEEKLY_PLAN_OPEN_EVENT } from '../../lib/assistantWeeklyPlanEvents';
import { prepareWeeklyPlanForLaunch } from '../../lib/weeklyPlanLaunchPreparation';
import { finishedFilmBudgetDecision, finishedFilmBudgetQuoteKey } from '../../../shared/contracts/finishedFilmBudget';
import { showWeeklyReadinessGuidance } from '../../lib/weeklyReadinessGuidance';

type GuidanceKey = 'companyName' | 'focusProducts' | 'targetMarkets' | 'customerProfile' | 'weeklyObjective';
type GuidanceQuestion = { key: GuidanceKey; prompt: string };
type GuidanceState = { config: DigitalEmployeeConfig; questions: GuidanceQuestion[]; index: number; answers: Partial<Record<GuidanceKey, string>> };

const operating = (data: DigitalEmployeeOverview | null) => Boolean(data?.goal && confirmedWeeklyExecution(data, data.goal.id));
const missing = (value: string | undefined) => !String(value || '').trim() || /待在实际任务中确认|待确认|未填写/.test(String(value));

function guidanceQuestions(config: DigitalEmployeeConfig): GuidanceQuestion[] {
  const missingQuestions: GuidanceQuestion[] = [];
  if (missing(config.companyName)) missingQuestions.push({ key: 'companyName', prompt: '先确认一项：你的企业名称是什么？' });
  if (missing(config.focusProducts)) missingQuestions.push({ key: 'focusProducts', prompt: '好的。这个星期最希望优先推广哪个产品或产品线？' });
  if (missing(config.targetMarkets)) missingQuestions.push({ key: 'targetMarkets', prompt: '这周主要面向哪个国家或市场？' });
  if (missing(config.customerProfile)) missingQuestions.push({ key: 'customerProfile', prompt: '这周最想触达哪一类客户？' });
  return [...missingQuestions.slice(0, 2), { key: 'weeklyObjective', prompt: '' }];
}

function firstLabel(value: string | undefined, fallback: string): string {
  const first = String(value || '').split(/[,，、;；/]/).map(item => item.trim()).find(Boolean) || fallback;
  return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}

function suggestedWeeklyObjectives(config: DigitalEmployeeConfig): [string, string, string] {
  const product = firstLabel(config.focusProducts, '重点产品');
  const market = firstLabel(config.targetMarkets, '目标市场');
  const customer = firstLabel(config.customerProfile, '目标客户');
  return [
    `验证${product}在${market}的内容方向，找出最能带来互动和咨询的主题。`,
    `围绕${product}触达${customer}，获取一批高意向询盘。`,
    '用内容发布与重点客户跟进，推动现有意向进入样品或报价阶段。',
  ];
}

function weeklyObjectivePrompt(): string {
  return `结合现有企业资料，我整理了三个本周经营目标。请选择一个，也可以自定义。`;
}

function questionPrompt(question: GuidanceQuestion): string {
  return question.key === 'weeklyObjective' ? weeklyObjectivePrompt() : question.prompt;
}

function resolveWeeklyObjective(value: string, config: DigitalEmployeeConfig): string | null {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase();
  const suggestions = suggestedWeeklyObjectives(config);
  if (/^(确认|采用推荐|就按这个|第?1(项|个)?|一)$/.test(normalized)) return suggestions[0];
  if (/^(第?2(项|个)?|二)$/.test(normalized)) return suggestions[1];
  if (/^(第?3(项|个)?|三)$/.test(normalized)) return suggestions[2];
  if (/^(修改|我要修改|其他)$/.test(normalized)) return null;
  return value.trim();
}

function applyGuidance(config: DigitalEmployeeConfig, answers: Partial<Record<GuidanceKey, string>>): DigitalEmployeeConfig {
  return { ...config,
    ...(answers.companyName ? { companyName: answers.companyName } : {}),
    ...(answers.focusProducts ? { focusProducts: answers.focusProducts } : {}),
    ...(answers.targetMarkets ? { targetMarkets: answers.targetMarkets } : {}),
    ...(answers.customerProfile ? { customerProfile: answers.customerProfile } : {}),
  };
}

function guidedDraft(config: DigitalEmployeeConfig, answers: Partial<Record<GuidanceKey, string>>): GoalDraft {
  const base = defaultWeeklyGoal(config).draft;
  const objective = answers.weeklyObjective?.trim();
  return { ...base, ...(objective ? { title: '本周重点经营计划', objective } : {}), constraints: [...base.constraints, '周计划与预算须由用户在同一页确认后才可启动'] };
}

export function useAssistantWeeklyPlanExperience() {
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [proposal, setProposal] = useState<DigitalEmployeeOverview | null>(null);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const [referenceGap, setReferenceGap] = useState<{ missingCount: number; requiredCount: number; videoMissingCount: number; imageMissingCount: number } | null>(null);
  const [referenceMessage, setReferenceMessage] = useState('');
  const [overBudgetApprovalRevision, setOverBudgetApprovalRevision] = useState<number | null>(null);
  const [overBudgetApprovalQuoteKey, setOverBudgetApprovalQuoteKey] = useState('');
  const [overBudgetConfirmationOpen, setOverBudgetConfirmationOpen] = useState(false);
  const [overBudgetConfirmationCount, setOverBudgetConfirmationCount] = useState(0);
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
    setOverBudgetApprovalRevision(null);
    setOverBudgetApprovalQuoteKey('');
    setOverBudgetConfirmationOpen(false);
    setOverBudgetConfirmationCount(0);
    setReferenceMessage('');
    let next = await digitalEmployeeApi.overview();
    if (!next.config) throw new Error('企业基础档案尚未建立。请先完成首页的新手卡片，之后我会在这里逐项补充周计划信息。');
    setOverview(next); setGuidance(null); setDraft(null);
    if (next.goal && next.plan) {
      const goalId = next.goal.id;
      let readiness = await digitalEmployeeApi.weeklyReferenceReadiness(goalId);
      if (!readiness.ready && readiness.videoMissingCount === 0 && readiness.imageMissingCount > 0
        && next.plan.status === 'draft') {
        try {
          next = await digitalEmployeeApi.rebindWeeklyImageReferences(goalId);
          readiness = await digitalEmployeeApi.weeklyReferenceReadiness(goalId);
          setOverview(next);
        } catch (cause) {
          setReferenceMessage(cause instanceof Error ? cause.message : '图文参考自动匹配失败');
        }
      }
      if (!readiness.ready) {
        setReferenceGap(readiness);
        setProposal(next); setModalOpen(true);
        return `本周计划还缺 ${readiness.videoMissingCount} 条爆款视频、${readiness.imageMissingCount} 条爆款图文参考。请手动录入或立即采集。`;
      }
      setReferenceGap(null);
      setProposal(next); setModalOpen(true);
      return '已在当前窗口打开本周计划。请核对爆款参考、暂定发布安排和预算，确认后开始运营。';
    }
    const questions = guidanceQuestions(next.config);
    setReferenceGap(null);
    setProposal(null); setModalOpen(false);
    setGuidance({ config: next.config, questions, index: 0, answers: {} });
    return questionPrompt(questions[0]!);
  }, []);

  const saveDraft = useCallback(async (candidate: GoalDraft, current: GuidanceState): Promise<string> => {
    setBusy(true); setError(''); setReferenceMessage('');
    try {
      const configChanged = Object.keys(current.answers).some(key => key !== 'weeklyObjective');
      if (configChanged) await digitalEmployeeApi.completeOnboarding(current.config);
      const created = await digitalEmployeeApi.createGoal(candidate);
      if (!created.goal || !created.plan?.businessPackage) throw new Error('周计划方案尚未生成完整，请稍后重试。');
      setOverview(created); setProposal(created); setGuidance(null); setReferenceGap(null); setModalOpen(true);
      return '已找到并绑定可用的爆款视频与图文参考。请在同一页核对计划和预算，确认后开始运营。';
    } catch (cause) {
      if (cause instanceof DigitalEmployeeApiError && cause.code === 'weekly_reference_shortage') {
        const count = Number(cause.details.missingCount);
        const required = Number(cause.details.requiredCount);
        if (Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(required) && required >= count) {
          const videoMissingCount = Number(cause.details.videoMissingCount) || 0;
          const imageMissingCount = Number(cause.details.imageMissingCount) || 0;
          setReferenceGap({ missingCount: count, requiredCount: required, videoMissingCount, imageMissingCount });
          setModalOpen(false);
          return `本周还缺 ${videoMissingCount} 条爆款视频、${imageMissingCount} 条爆款图文参考。请手动录入或立即采集。`;
        }
      }
      const message = cause instanceof Error ? cause.message : '周计划方案保存失败';
      setError(message); setModalOpen(false);
      return `周计划尚未确立：${message}`;
    } finally { setBusy(false); }
  }, []);

  const answer = useCallback(async (value: string) => {
    const current = guidance;
    if (!current || busy) return null;
    let answerValue = value.trim();
    if (!answerValue) return '请先回答当前这个问题；我会一项一项来。';
    const question = current.questions[current.index]!;
    const currentConfig = applyGuidance(current.config, current.answers);
    if (question.key === 'weeklyObjective') {
      const resolved = resolveWeeklyObjective(answerValue, currentConfig);
      if (!resolved) return '可以，直接发来你修改后的本周经营目标。';
      answerValue = resolved;
    }
    const answers = { ...current.answers, [question.key]: answerValue };
    const nextIndex = current.index + 1;
    if (nextIndex < current.questions.length) {
      setGuidance({ ...current, answers, index: nextIndex });
      return questionPrompt(current.questions[nextIndex]!);
    }
    const config = applyGuidance(current.config, answers);
    const candidate = guidedDraft(config, answers);
    const nextGuidance = { ...current, config, answers, index: nextIndex };
    setDraft(candidate); setGuidance(nextGuidance);
    return saveDraft(candidate, nextGuidance);
  }, [busy, guidance, saveDraft]);

  const openReferenceLibrary = useCallback((view: 'inspiration' | 'accounts') => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration', view } }));
  }, []);

  const collectReferencesNow = useCallback(async () => {
    if (busy || !referenceGap) return;
    setBusy(true); setReferenceMessage('');
    try {
      const scope = await socialDiscoveryApi.getScope();
      if (!scope.persisted || scope.needsConfirmation) {
        setReferenceMessage('首次采集需要先确认采集范围。已打开对标账号设置；确认后点击“立即采集”。');
        openReferenceLibrary('accounts');
        return;
      }
      const result = await socialDiscoveryApi.run({ triggerType: 'manual' });
      setReferenceMessage(result.skipped
        ? `本次采集未启动：${result.reason || '请检查采集范围与运行状态'}。周任务仍未创建。`
        : '已发起采集。新视频或图文完成相应分析后，返回这里重新匹配周计划；采集入库不等于可用于制作。');
    } catch (cause) {
      setReferenceMessage(cause instanceof Error ? cause.message : '采集未启动，请检查采集设置。');
    } finally { setBusy(false); }
  }, [busy, referenceGap, openReferenceLibrary]);

  useEffect(() => {
    const open = () => { void prepare().catch(cause => setError(cause instanceof Error ? cause.message : '当前周计划暂时无法读取')); };
    window.addEventListener(ASSISTANT_WEEKLY_PLAN_OPEN_EVENT, open);
    return () => window.removeEventListener(ASSISTANT_WEEKLY_PLAN_OPEN_EVENT, open);
  }, [prepare]);

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
      setOverBudgetConfirmationOpen(false);
      notifyWeeklyWorkUpdated({ source: 'assistant', goalId: current.goal!.id, execution: { goalId: current.goal!.id, runId: execution.run.id, status: execution.run.status, taskCount: execution.tasks.length, startedAt: execution.run.started_at } });
      window.setTimeout(() => setCelebrating(false), 900);
      return true;
    };
    try {
      const prepared = await prepareWeeklyPlanForLaunch(current, {
        onObserved: next => { setOverview(next); setProposal(next); },
      });
      const preparedPackage = prepared.plan?.businessPackage;
      if (!preparedPackage) throw new Error('任务包准备结果与当前周目标不一致，本周任务尚未启动。');
      const overBudgetFilms = (preparedPackage.tasks.find(task => task.templateId === 'production')?.videoPlans || [])
        .filter(item => item.productionRole !== 'platform_adaptation')
        .map(item => finishedFilmBudgetDecision({ contentId: item.contentId ?? '', durationSeconds: Number(item.duration),
          estimatedCostCny: Number(item.estimatedCostRange?.maxCny ?? item.estimatedCost) }))
        .filter(item => item.requiresConfirmation);
      if (overBudgetFilms.some(item => !item.estimateAvailable)) {
        throw new Error('部分成片缺少可核验的时长或费用估算；本次未启动生产。');
      }
      const quoteKey = finishedFilmBudgetQuoteKey(overBudgetFilms);
      if (overBudgetFilms.length && (overBudgetApprovalRevision !== preparedPackage.revision || overBudgetApprovalQuoteKey !== quoteKey)) {
        setProposal(prepared);
        if (overBudgetConfirmationOpen) {
          setOverBudgetConfirmationOpen(false);
          setOverBudgetApprovalRevision(null);
          setOverBudgetApprovalQuoteKey('');
          setOverBudgetConfirmationCount(0);
          setError('制作费用预留已更新，本周计划尚未启动。请重新核对预算后再确认。');
          return;
        }
        setOverBudgetApprovalRevision(preparedPackage.revision);
        setOverBudgetApprovalQuoteKey(quoteKey);
        setOverBudgetConfirmationCount(overBudgetFilms.length);
        setOverBudgetConfirmationOpen(true);
        return;
      }
      requestSent = true;
      let next = await digitalEmployeeApi.approveGoal(current.goal.id, preparedPackage.revision, true,
        overBudgetFilms.length > 0 ? quoteKey : '');
      let finished = finish(next);
      if (!finished) { reconciliationRead = true; next = await digitalEmployeeApi.overview(current.goal.id); finished = finish(next); }
      if (!finished) throw new Error('启动请求已经发出，但暂未取得可确认的运行回执。系统不会自动重复启动，请稍后刷新查看。');
    } catch (cause) {
      setOverBudgetConfirmationOpen(false);
      if (showWeeklyReadinessGuidance(cause)) {
        setModalOpen(false);
        setError('');
        return;
      }
      const conflict = weeklyStartConflictFromError(cause);
      if (conflict) setError(`${conflict.goalTitle || '另一轮周计划'}正在运行，本周计划没有被重复启动。`);
      else if (requestSent && !reconciliationRead && weeklyStartResultNeedsReconciliation(cause)) {
        reconciliationRead = true;
        try { if (finish(await digitalEmployeeApi.overview(current.goal.id))) return; } catch { /* read cannot prove result */ }
        setError('启动结果暂时无法确认。系统已完成一次只读核对，不会自动重复提交，请稍后刷新查看。');
      } else setError(cause instanceof Error ? cause.message : '周计划启动失败');
    } finally { setBusy(false); }
  }, [busy, proposal, overBudgetApprovalRevision, overBudgetApprovalQuoteKey, overBudgetConfirmationOpen]);

  return { proposal, draft, modalOpen, busy, error, celebrating, overBudgetApprovalRevision,
    overBudgetConfirmationOpen, overBudgetConfirmationCount,
    cancelOverBudgetConfirmation: () => { if (busy) return; setOverBudgetConfirmationOpen(false);
      setOverBudgetApprovalRevision(null); setOverBudgetApprovalQuoteKey(''); setOverBudgetConfirmationCount(0); },
    referenceGap, referenceMessage, openReferenceLibrary, collectReferencesNow,
    retryReferenceCheck: () => { if (draft && guidance) { void saveDraft(draft, guidance); return; }
      const goalId = proposal?.goal?.id;
      if (goalId && referenceGap?.imageMissingCount) {
        setBusy(true);
        void digitalEmployeeApi.rebindWeeklyImageReferences(goalId)
          .then(next => { setOverview(next); setProposal(next); setReferenceGap(null); setModalOpen(true); setReferenceMessage('图文参考已重新匹配，请核对方案。'); })
          .catch(cause => setReferenceMessage(cause instanceof Error ? cause.message : '图文参考重新匹配失败'))
          .finally(() => setBusy(false));
        return;
      }
      void prepare().catch(cause => setReferenceMessage(cause instanceof Error ? cause.message : '参考核验暂不可用')); },
    guidanceActive: Boolean(guidance && guidance.index < guidance.questions.length), weeklyPlanOperating: operating(overview),
    objectiveChoices: guidance?.questions[guidance.index]?.key === 'weeklyObjective'
      ? suggestedWeeklyObjectives(applyGuidance(guidance.config, guidance.answers)).map((label, index) => ({
        value: String(index + 1), label, recommended: index === 0,
      })) : [],
    prepare, answer, open: () => setModalOpen(true), close: () => { if (!busy) setModalOpen(false); }, confirm };
}

export type AssistantWeeklyPlanExperience = ReturnType<typeof useAssistantWeeklyPlanExperience>;
