import { useCallback, useEffect, useState } from 'react';
import { defaultWeeklyGoal, type GoalDraft } from '../../lib/defaultWeeklyGoal';
import { DigitalEmployeeApiError, digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { socialDiscoveryApi } from '../../lib/socialDiscoveryApi';
import type { DigitalEmployeeConfig, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { confirmedWeeklyExecution, weeklyStartConflictFromError, weeklyStartResultNeedsReconciliation } from '../../lib/weeklyStartValidation';
import { notifyWeeklyWorkUpdated, WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import { ASSISTANT_WEEKLY_PLAN_OPEN_EVENT } from '../../lib/assistantWeeklyPlanEvents';
import { prepareWeeklyPlanForLaunch } from '../../lib/weeklyPlanLaunchPreparation';

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
  return { ...base, ...(objective ? { title: '本周重点经营计划', objective } : {}), constraints: [...base.constraints, '方案与预算均须由用户分步确认后才可启动'] };
}

export function useAssistantWeeklyPlanExperience() {
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [proposal, setProposal] = useState<DigitalEmployeeOverview | null>(null);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [stage, setStage] = useState<'plan' | 'budget'>('plan');
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const [referenceGap, setReferenceGap] = useState<{ missingCount: number; requiredCount: number } | null>(null);
  const [referenceMessage, setReferenceMessage] = useState('');
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
    setReferenceMessage('');
    const next = await digitalEmployeeApi.overview();
    if (!next.config) throw new Error('企业基础档案尚未建立。请先完成首页的新手卡片，之后我会在这里逐项补充周计划信息。');
    setOverview(next); setGuidance(null); setDraft(null);
    if (next.goal && next.plan) {
      const readiness = await digitalEmployeeApi.weeklyReferenceReadiness(next.goal.id);
      if (!readiness.ready) {
        setReferenceGap({ missingCount: readiness.missingCount, requiredCount: readiness.requiredCount });
        setProposal(next); setStage('plan'); setModalOpen(false);
        return `本周计划还缺 ${readiness.missingCount} 条可用于制作的爆款视频。周任务尚未确立，请选择手动录入或立即采集。`;
      }
      setReferenceGap(null);
      setProposal(next); setStage('budget'); setModalOpen(true);
      return '已在当前窗口打开本周计划。你可以核对方案和预算；只有再次确认后才会启动运营。';
    }
    const questions = guidanceQuestions(next.config);
    setReferenceGap(null);
    setProposal(null); setStage('plan'); setModalOpen(false);
    setGuidance({ config: next.config, questions, index: 0, answers: {} });
    return questionPrompt(questions[0]!);
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
    setDraft(guidedDraft(config, answers));
    setGuidance({ ...current, config, answers, index: nextIndex });
    setStage('plan'); setModalOpen(true);
    return '信息够用了。我先整理了一版周计划草案，已在当前窗口打开。请先确认目标、内容和排期；确认方案后，我再给你看预算。';
  }, [busy, guidance]);

  const confirmPlan = useCallback(async () => {
    if (!draft || !guidance || busy) return;
    setBusy(true); setError(''); setReferenceMessage('');
    try {
      const configChanged = Object.keys(guidance.answers).some(key => key !== 'weeklyObjective');
      if (configChanged) await digitalEmployeeApi.completeOnboarding(guidance.config);
      const created = await digitalEmployeeApi.createGoal(draft);
      if (!created.goal || !created.plan?.businessPackage) throw new Error('周计划方案尚未生成完整，请稍后重试。');
      setOverview(created); setProposal(created); setGuidance(null); setReferenceGap(null); setStage('budget');
    } catch (cause) {
      if (cause instanceof DigitalEmployeeApiError && cause.code === 'weekly_reference_shortage') {
        const count = Number(cause.details.missingCount);
        const required = Number(cause.details.requiredCount);
        if (Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(required) && required >= count) {
          setReferenceGap({ missingCount: count, requiredCount: required });
          setModalOpen(false);
          return;
        }
      }
      setError(cause instanceof Error ? cause.message : '周计划方案保存失败');
    }
    finally { setBusy(false); }
  }, [busy, draft, guidance]);

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
        : '已发起采集。新视频完成逐镜分析与复核后，返回这里重新核验周计划；采集入库不等于可用于制作。');
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
    if (!current?.goal || !current.plan?.businessPackage || busy || stage !== 'budget') return;
    setBusy(true); setError('');
    let requestSent = false;
    let reconciliationRead = false;
    const finish = (next: DigitalEmployeeOverview) => {
      const execution = confirmedWeeklyExecution(next, current.goal!.id);
      if (!execution) return false;
      setOverview(next); setProposal(next); setModalOpen(false); setCelebrating(true);
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
      requestSent = true;
      let next = await digitalEmployeeApi.approveGoal(current.goal.id, preparedPackage.revision, true);
      let finished = finish(next);
      if (!finished) { reconciliationRead = true; next = await digitalEmployeeApi.overview(current.goal.id); finished = finish(next); }
      if (!finished) throw new Error('启动请求已经发出，但暂未取得可确认的运行回执。系统不会自动重复启动，请稍后刷新查看。');
    } catch (cause) {
      const conflict = weeklyStartConflictFromError(cause);
      if (conflict) setError(`${conflict.goalTitle || '另一轮周计划'}正在运行，本周计划没有被重复启动。`);
      else if (requestSent && !reconciliationRead && weeklyStartResultNeedsReconciliation(cause)) {
        reconciliationRead = true;
        try { if (finish(await digitalEmployeeApi.overview(current.goal.id))) return; } catch { /* read cannot prove result */ }
        setError('启动结果暂时无法确认。系统已完成一次只读核对，不会自动重复提交，请稍后刷新查看。');
      } else setError(cause instanceof Error ? cause.message : '周计划启动失败');
    } finally { setBusy(false); }
  }, [busy, proposal, stage]);

  return { proposal, draft, stage, modalOpen, busy, error, celebrating,
    referenceGap, referenceMessage, openReferenceLibrary, collectReferencesNow,
    retryReferenceCheck: () => { if (draft) void confirmPlan(); else void prepare().catch(cause => setReferenceMessage(cause instanceof Error ? cause.message : '参考核验暂不可用')); },
    guidanceActive: Boolean(guidance && guidance.index < guidance.questions.length), weeklyPlanOperating: operating(overview),
    objectiveChoices: guidance?.questions[guidance.index]?.key === 'weeklyObjective'
      ? suggestedWeeklyObjectives(applyGuidance(guidance.config, guidance.answers)).map((label, index) => ({
        value: String(index + 1), label, recommended: index === 0,
      })) : [],
    prepare, answer, confirmPlan, open: () => setModalOpen(true), close: () => { if (!busy) setModalOpen(false); }, confirm };
}

export type AssistantWeeklyPlanExperience = ReturnType<typeof useAssistantWeeklyPlanExperience>;
