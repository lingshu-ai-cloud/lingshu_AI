import AssistantBusinessSceneDialog from './assistant/AssistantBusinessSceneDialog';
import { isBusinessScene, type BusinessSceneId } from '../../shared/contracts/assistantBusinessScene';
import ProductHighlightDialog from './enterprise/ProductHighlightDialog';
import { Button, Modal } from 'antd';
import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Lightbulb,
  Images,
  Megaphone,
  MessagesSquare,
  Newspaper,
  CheckCircle2,
  Compass,
  UserRound,
  AlertCircle,
  LoaderCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Page } from '../pageRegistry';
import { AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import { digitalEmployeeApi } from '../lib/digitalEmployeeApi';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { HOME_FIRST_RUN_RESET_EVENT, HOME_GROWTH_TOUR_COMPLETE_EVENT, HOME_GROWTH_TOUR_START_EVENT, HOME_INTRODUCTION_COMPLETE_EVENT, readHomeFirstRun, resetHomeFirstRun, writeHomeFirstRun } from '../lib/homeFirstRun';
import { EMPTY_CONFIG } from './smartBusiness/digitalEmployeeConfigRules';
import HomeIntroduction from './HomeIntroduction';
import {
  ASSISTANT_HOME_LEVEL_LABELS,
  ASSISTANT_HOME_QUICK_LAUNCHERS,
  assistantHomePromptById,
  type AssistantHomePrompt,
  type AssistantHomeQuickLauncher,
  type AssistantHomeQuickLauncherId,
} from '../lib/assistantHomeQuickPrompts';
import AssistantQuickPromptDialog from './assistant/AssistantQuickPromptDialog';
import { assistantQueryKind } from '../lib/assistantQueryQuickPrompts';
import { useAssistantStore } from '../stores/assistantStore';
import CompanyReportScene from './assistant/CompanyReportScene';
import { PRIMARY_ASSISTANT_THREAD } from './assistant/globalAssistantRuntime';
import { assistantImageReplicationPortal } from './assistant/assistantImageReplicationIntent';
import {
  ASSISTANT_HOME_ACTIVITY_EVENT,
  ASSISTANT_HOME_PROMPT_EVENT,
  type AssistantHomePromptMode,
  type AssistantHomeSubmitOptions,
} from './assistant/useAssistantHomeAnchor';
import { openContentGenerationQueue } from '../lib/contentGenerationQueue';
import { WEEKLY_WORK_UPDATED_EVENT } from '../lib/weeklyWorkEvents';
import { weeklyHomeIndicator } from '../lib/weeklyHomeIndicator';
import { weeklyTaskReply } from './contentCreationHomeReplies';

type PendingHomePrompt = { entry: AssistantHomePrompt; submitOptions?: AssistantHomeSubmitOptions };

function launcherIcon(id: AssistantHomeQuickLauncherId, size = 18) {
  const props = { size, 'aria-hidden': true as const };
  if (id === 'weekly-plan') return <CalendarCheck2 {...props}/>;
  if (id === 'external-news') return <Newspaper {...props}/>;
  if (id === 'business-analysis') return <BarChart3 {...props}/>;
  if (id === 'traffic-optimization') return <Megaphone {...props}/>;
  if (id === 'customer-followup') return <MessagesSquare {...props}/>;
  return <Clapperboard {...props}/>;
}

function resolveLauncherPrompts(launcher: AssistantHomeQuickLauncher | null): AssistantHomePrompt[] {
  if (!launcher) return [];
  return launcher.promptIds
    .slice(0, 4)
    .map(id => assistantHomePromptById(id))
    .filter((entry): entry is AssistantHomePrompt => Boolean(entry));
}

export default function ContentCreationHome({ onNavigate, inspirationWorkspace, sessionScope, firstRunRequestKey, onFirstRunRestored }: { onNavigate?: (page: Page) => void; inspirationWorkspace?: ReactNode; sessionScope: string; firstRunRequestKey?: string; onFirstRunRestored?: () => void }) {
  const [activeLauncherId, setActiveLauncherId] = useState<AssistantHomeQuickLauncherId | null>(null);
  const [companyReportOpen, setCompanyReportOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [businessSceneId, setBusinessSceneId] = useState<BusinessSceneId | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [queryPrompt, setQueryPrompt] = useState<AssistantHomePrompt | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingHomePrompt | null>(null);
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [firstRunLoaded, setFirstRunLoaded] = useState(false);
  const [firstRunError, setFirstRunError] = useState('');
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [firstRunProgress, setFirstRunProgress] = useState(() => readHomeFirstRun(sessionScope));
  const [introductionOpen, setIntroductionOpen] = useState(false);
  const handledFirstRunRequestRef = useRef<string | null>(null);
  const activeLauncher = useMemo(
    () => ASSISTANT_HOME_QUICK_LAUNCHERS.find(entry => entry.id === activeLauncherId) || null,
    [activeLauncherId],
  );
  const hasWeeklyPlan = Boolean(overview?.goal && overview.plan);
  const weeklyIndicator = weeklyHomeIndicator(overview);
  const activePrompts = useMemo(() => {
    const prompts = resolveLauncherPrompts(activeLauncher);
    if (activeLauncher?.id !== 'weekly-plan' || !firstRunLoaded) return prompts;
    if (weeklyIndicator === 'attention') return prompts.map(entry => entry.id === 'OP-CALENDAR' ? {
      ...entry,
      label: '解决当前问题',
      summary: '让灵小枢说明当前缺什么，并在对话中补齐',
    } : entry);
    if (hasWeeklyPlan) return prompts;
    return prompts.map(entry => entry.id === 'OP-CALENDAR' ? {
      ...entry,
      label: '创建周计划',
      summary: '当前没有周计划，通过对话生成本周目标、任务、预算和排期',
      prompt: '请帮我创建本周计划。',
      level: 'plan' as const,
    } : entry);
  }, [activeLauncher, firstRunLoaded, hasWeeklyPlan, weeklyIndicator]);
  const canvasCollapsed = activeLauncher === null;
  const showFirstRun = firstRunLoaded && !firstRunError && firstRunProgress.entered && (!overview?.config || !firstRunProgress.growthCompleted);

  useEffect(() => {
    setHighlightOpen(false); setBusinessSceneId(null);
    setFirstRunProgress(readHomeFirstRun(sessionScope));
    setOverview(null);
    setFirstRunLoaded(false);
    setOverviewRevision(value => value + 1);
  }, [sessionScope]);

  useEffect(() => {
    const refresh = () => setOverviewRevision(value => value + 1);
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, refresh);
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, refresh);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, refresh); window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, refresh); };
  }, []);

  useEffect(() => {
    if (!overview?.run || ['succeeded', 'cancelled'].includes(overview.run.status)) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setOverviewRevision(value => value + 1); }, 15_000);
    return () => window.clearInterval(timer);
  }, [overview?.run?.id, overview?.run?.status]);

  useEffect(() => {
    let active = true;
    void digitalEmployeeApi.overview().then(data => {
      if (!active) return;
      setOverview(data);
      setFirstRunError('');
      setFirstRunLoaded(true);
      if (!data.config) setFirstRunProgress(writeHomeFirstRun(sessionScope, { entered: true }));
    }).catch(error => {
      if (!active) return;
      setFirstRunError(error instanceof Error ? error.message : '新用户状态读取失败');
      setFirstRunLoaded(true);
    });
    return () => { active = false; };
  }, [overviewRevision, sessionScope]);

  useEffect(() => {
    const complete = () => setFirstRunProgress(writeHomeFirstRun(sessionScope, { growthCompleted: true }));
    window.addEventListener(HOME_GROWTH_TOUR_COMPLETE_EVENT, complete);
    return () => window.removeEventListener(HOME_GROWTH_TOUR_COMPLETE_EVENT, complete);
  }, [sessionScope]);

  useEffect(() => {
    if (!firstRunRequestKey || handledFirstRunRequestRef.current === firstRunRequestKey) return;
    handledFirstRunRequestRef.current = firstRunRequestKey;
    setActiveLauncherId(null);
    setIntroductionOpen(false);
    setFirstRunProgress(resetHomeFirstRun(sessionScope));
    onFirstRunRestored?.();
  }, [firstRunRequestKey, onFirstRunRestored, sessionScope]);

  useEffect(() => {
    const reset = () => {
      setActiveLauncherId(null);
      setIntroductionOpen(false);
      setFirstRunProgress(readHomeFirstRun(sessionScope));
    };
    window.addEventListener(HOME_FIRST_RUN_RESET_EVENT, reset);
    return () => window.removeEventListener(HOME_FIRST_RUN_RESET_EVENT, reset);
  }, [sessionScope]);

  useEffect(() => {
    const onAssistantActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean; busy?: boolean }>).detail;
      setAssistantBusy(Boolean(detail?.busy));
      if (detail?.active) { setActiveLauncherId(null); setCompanyReportOpen(false); }
    };
    window.addEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
    return () => window.removeEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
  }, []);

  const fillPrompt = (entry: AssistantHomePrompt, mode: AssistantHomePromptMode = 'replace', submitOptions?: AssistantHomeSubmitOptions) => {
    window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_PROMPT_EVENT, { detail: { prompt: entry.prompt, mode, submitOptions } }));
    setPendingPrompt(null);
    setActiveLauncherId(null);
  };

  const preparePrompt = (entry: AssistantHomePrompt, submitOptions?: AssistantHomeSubmitOptions) => {
    const draft = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].draftInput.trim();
    if (draft && draft !== entry.prompt.trim()) { setPendingPrompt({ entry, submitOptions }); return; }
    fillPrompt(entry, 'replace', submitOptions);
  };

  const choosePrompt = (entry: AssistantHomePrompt) => {
    if (entry.id === 'OP-CALENDAR') {
      if (weeklyIndicator === 'attention') {
        void showWeeklyIssueInConversation();
        return;
      }
      preparePrompt(entry);
      return;
    }
    if (entry.id === 'CO-11') { openContentGenerationQueue({view:'tasks'});setActiveLauncherId(null);return; }
    if (entry.id === 'CO-07') {
      if (assistantBusy) return;
      setBusinessSceneId(entry.id);
      return;
    }
    if (isBusinessScene(entry.id)) { preparePrompt(entry); return; }
    if (entry.id === 'CO-SPEECH-HIGHLIGHT') { setHighlightOpen(true); return; }
    if (entry.id === 'OP-LEADER') { setCompanyReportOpen(true); return; }
    setCompanyReportOpen(false);
    if (assistantQueryKind(entry.id)) { setQueryPrompt(entry); return; }
    if (entry.id === 'CO-13') {
      const portal = assistantImageReplicationPortal(entry.prompt);
      if (!portal) return;
      const store = useAssistantStore.getState();
      store.setMessages(PRIMARY_ASSISTANT_THREAD, [...store.threads[PRIMARY_ASSISTANT_THREAD].messages,
        { role: 'assistant', content: '先确认参考图和企业产品，其他要求可以补充；确认后我来完成图片和配文。', creationPortal: portal }]);
      store.setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
      window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: true } }));
      setActiveLauncherId(null);
      return;
    }
    preparePrompt(entry);
  };

  const showWeeklyIssueInConversation = async () => {
    if (assistantBusy) return;
    setAssistantBusy(true);
    try {
      const latest = await digitalEmployeeApi.overview();
      setOverview(latest);
      const readiness = latest.goal && !latest.run
        ? await digitalEmployeeApi.weeklyProductionReadiness(latest.goal.id).catch(() => null) : null;
      const store = useAssistantStore.getState();
      const thread = store.threads[PRIMARY_ASSISTANT_THREAD];
      const prompt = assistantHomePromptById('OP-CALENDAR')!.prompt;
      store.setMessages(PRIMARY_ASSISTANT_THREAD, [...thread.messages,
        { role: 'user', content: prompt }, { role: 'assistant', content: weeklyTaskReply(latest, readiness) }]);
      store.setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
      window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: true } }));
    } catch {
      const store = useAssistantStore.getState();
      store.setMessages(PRIMARY_ASSISTANT_THREAD, [...store.threads[PRIMARY_ASSISTANT_THREAD].messages,
        { role: 'assistant', content: '周计划最新状态暂时读取不到。资料和原任务都没有改动，请稍后再试。' }]);
      window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: true } }));
    } finally { setAssistantBusy(false); }
  };

  const toggleLauncher = (launcherId: AssistantHomeQuickLauncherId) => {
    setCompanyReportOpen(false);
    setActiveLauncherId(current => current === launcherId ? null : launcherId);
  };

  return <div className="creator-home creator-home--employee h-full overflow-y-auto">
    <div className="creator-home__inner">
      <header className="creator-home__hero text-center">
        <h2>{showFirstRun ? '先认识灵枢，再让灵小枢认识你' : '今天想让数字员工完成什么？'}</h2>
      </header>

      {!showFirstRun && <div className={`creator-home__canvas-stage${canvasCollapsed ? ' is-collapsed' : ''}`} inert={canvasCollapsed ? true : undefined} aria-hidden={canvasCollapsed || undefined}>
        <section id="creator-home-operations" className="creator-home__canvas" aria-label={activeLauncher ? `${activeLauncher.label}快捷任务` : '快捷任务'}>
          {activeLauncher ? <div className="creator-home__quick-panel">
            <div id="creator-home-prompt-cards" className={`creator-home__prompt-grid${activeLauncher.id === 'viral-script' ? ' creator-home__prompt-grid--creation' : ''}`} aria-label={`${activeLauncher.label}：${activeLauncher.description}`}>
              {activePrompts.map((entry, index) => <button
                type="button"
                key={entry.id}
                aria-expanded={entry.id === 'OP-LEADER' ? companyReportOpen : undefined}
                aria-controls={entry.id === 'OP-LEADER' ? 'company-report-selection' : undefined}
                className={`creator-home__prompt-card${index === 0 ? ' creator-home__prompt-card--primary' : ''}${entry.id === 'OP-CALENDAR' && weeklyIndicator === 'attention' ? ' creator-home__prompt-card--attention' : ''}`}
                onClick={() => choosePrompt(entry)}
              >
                <span className="creator-home__prompt-card-icon">{entry.id === 'OP-CALENDAR' && weeklyIndicator === 'attention' ? <AlertCircle size={19} aria-hidden="true"/> : entry.id === 'CO-13' ? <Images size={19} aria-hidden="true"/> : launcherIcon(activeLauncher.id, 19)}</span>
                <span className="creator-home__prompt-card-copy"><strong>{entry.label}</strong><span>{entry.summary}</span></span>
                <span className={`creator-home__prompt-card-level is-${entry.level}`}>{ASSISTANT_HOME_LEVEL_LABELS[entry.level]}</span>
                <ArrowRight size={15} aria-hidden="true"/>
              </button>)}
            </div>
            {companyReportOpen && <div id="company-report-selection"><CompanyReportScene busy={assistantBusy}
              onCancel={() => setCompanyReportOpen(false)} onPrompt={text => {
                setCompanyReportOpen(false);
                preparePrompt({ ...assistantHomePromptById('OP-LEADER')!, prompt: text }, { companyReport: true });
              }} onConfirm={request => {
                if (assistantBusy) return;
                setCompanyReportOpen(false);
                preparePrompt({ ...assistantHomePromptById('OP-LEADER')!, prompt: request.text }, { companyReport: true });
              }}/></div>}
          </div> : null}
        </section>
      </div>}

      {showFirstRun && <div className="creator-home__canvas-stage">
        <section className="creator-home__canvas" aria-label="新用户入门">
          <div className="creator-home__canvas-grid creator-home__canvas-grid--onboarding">
            <button type="button" className="creator-home__canvas-card creator-home__canvas-card--primary" onClick={() => setIntroductionOpen(true)}>
              <span className="creator-home__canvas-card-shade" aria-hidden="true"/>
              <span className="creator-home__canvas-card-content">
                <UserRound size={28} aria-hidden="true"/>
                <strong>让灵小枢认识我</strong>
                <span>通过问答确认企业、品牌、主推产品和目标市场。</span>
                <span className="creator-home__canvas-card-action">{overview?.config ? <><CheckCircle2 size={14} aria-hidden="true"/>已确认 · 查看资料</> : <>开始介绍 · 可稍后继续<ArrowRight size={14} aria-hidden="true"/></>}</span>
              </span>
            </button>
            <button type="button" className="creator-home__canvas-card" onClick={() => window.dispatchEvent(new CustomEvent(HOME_GROWTH_TOUR_START_EVENT, { detail: { restart: true } }))}>
              <span className="creator-home__canvas-card-shade" aria-hidden="true"/>
              <span className="creator-home__canvas-card-content">
                <Compass size={28} aria-hidden="true"/>
                <strong>灵枢如何助力海外增长</strong>
                <span>亲手体验对话、业务页面、周任务包和创建任务。</span>
                <span className="creator-home__canvas-card-action">{firstRunProgress.growthCompleted ? <><CheckCircle2 size={14} aria-hidden="true"/>已了解 · 再看一次</> : <>开始了解 · 约 2 分钟<ArrowRight size={14} aria-hidden="true"/></>}</span>
              </span>
            </button>
          </div>
        </section>
      </div>}
      {firstRunError && <p role="alert" className="mb-4 text-sm text-warning">入门状态暂时无法读取：{firstRunError} <button type="button" className="underline" onClick={() => setOverviewRevision(value => value + 1)}>重试</button></p>}

      <section className="creator-home__conversation" aria-label="灵小枢对话">
        <div id="content-creation-assistant-anchor" className="creator-home__assistant-anchor"/>
      </section>

      {!showFirstRun && <div className="creator-home__suggestions" aria-label="快捷任务">
        {ASSISTANT_HOME_QUICK_LAUNCHERS.map(launcher => {
          const active = activeLauncherId === launcher.id;
          return <button
            type="button"
            key={launcher.id}
            className={[active ? 'is-active' : '', launcher.id === 'weekly-plan' && weeklyIndicator !== 'idle' ? `creator-home__suggestion--${weeklyIndicator}` : ''].filter(Boolean).join(' ') || undefined}
            aria-controls="creator-home-operations"
            aria-expanded={active}
            aria-label={launcher.id === 'weekly-plan' && weeklyIndicator === 'attention' ? '查看当前周计划：有问题需要处理' : launcher.id === 'weekly-plan' && weeklyIndicator === 'producing' ? '查看当前周计划：正在生产' : undefined}
            onClick={() => toggleLauncher(launcher.id)}
          >
            {launcher.id === 'weekly-plan' && weeklyIndicator === 'attention' ? <AlertCircle size={15} aria-hidden="true"/> : launcher.id === 'weekly-plan' && weeklyIndicator === 'producing' ? <LoaderCircle size={15} aria-hidden="true"/> : launcherIcon(launcher.id, 15)}
            <span>{launcher.label}</span>
            {active ? <ChevronUp size={14} aria-hidden="true"/> : <ChevronDown size={14} aria-hidden="true"/>}
          </button>;
        })}
      </div>}

      <section id="creator-home-library" tabIndex={-1} className="creator-home__library" aria-label="爆款素材">
        {inspirationWorkspace}
      </section>
    </div>
    {businessSceneId && <AssistantBusinessSceneDialog key={`${sessionScope}:${businessSceneId}`} sceneId={businessSceneId} onClose={() => setBusinessSceneId(null)} onConfirm={selection => {
      const entry = assistantHomePromptById(selection.sceneId); if (!entry || assistantBusy) return;
      setBusinessSceneId(null);
      preparePrompt(entry, { businessScene: selection });
    }}/>}
    <ProductHighlightDialog key={sessionScope} open={highlightOpen} onClose={() => setHighlightOpen(false)}/>
    {queryPrompt && assistantQueryKind(queryPrompt.id) && <AssistantQuickPromptDialog key={queryPrompt.id} kind={assistantQueryKind(queryPrompt.id)!}
      onClose={() => setQueryPrompt(null)} onPrompt={prompt => preparePrompt({ ...queryPrompt, prompt })}/>}
    <Modal open={Boolean(pendingPrompt)} title="输入框已有内容" width={480} closable={false} footer={[
      <Button key="cancel" onClick={() => setPendingPrompt(null)}>取消</Button>,
      <Button key="append" onClick={() => pendingPrompt && fillPrompt(pendingPrompt.entry, 'append', pendingPrompt.submitOptions)}>追加到现有内容</Button>,
      <Button key="replace" type="primary" onClick={() => pendingPrompt && fillPrompt(pendingPrompt.entry, 'replace', pendingPrompt.submitOptions)}>替换现有内容</Button>,
    ]}>
      <p>“{pendingPrompt?.entry.label}”会填入灵小枢输入框。请选择追加或替换；系统不会自动发送。</p>
    </Modal>
    <HomeIntroduction open={introductionOpen} initialConfig={overview?.config || EMPTY_CONFIG}
      onClose={() => setIntroductionOpen(false)} onComplete={() => {
        setIntroductionOpen(false);
        setOverviewRevision(value => value + 1);
        window.dispatchEvent(new CustomEvent(HOME_INTRODUCTION_COMPLETE_EVENT));
      }} />
  </div>;
}
