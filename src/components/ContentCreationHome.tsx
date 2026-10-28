import { ArrowRight, CheckCircle2, Compass, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Page } from '../pageRegistry';
import { AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import { digitalEmployeeApi } from '../lib/digitalEmployeeApi';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { HOME_FIRST_RUN_RESET_EVENT, HOME_GROWTH_TOUR_COMPLETE_EVENT, HOME_GROWTH_TOUR_START_EVENT, HOME_INTRODUCTION_COMPLETE_EVENT, readHomeFirstRun, resetHomeFirstRun, writeHomeFirstRun } from '../lib/homeFirstRun';
import { EMPTY_CONFIG } from './smartBusiness/digitalEmployeeConfigRules';
import HomeIntroduction from './HomeIntroduction';
import AssistantHomeScenes from './assistant/AssistantHomeScenes';
import { PRIMARY_ASSISTANT_THREAD } from './assistant/globalAssistantRuntime';
import { ASSISTANT_HOME_ACTIVITY_EVENT, ASSISTANT_HOME_PROMPT_EVENT } from './assistant/useAssistantHomeAnchor';

export default function ContentCreationHome({ onNavigate, inspirationWorkspace, sessionScope, firstRunRequestKey, onFirstRunRestored }: { onNavigate?: (page: Page) => void; inspirationWorkspace?: ReactNode; sessionScope: string; firstRunRequestKey?: string; onFirstRunRestored?: () => void }) {
  const handledFirstRunRequestRef = useRef<string | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [firstRunLoaded, setFirstRunLoaded] = useState(false);
  const [firstRunError, setFirstRunError] = useState('');
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [firstRunProgress, setFirstRunProgress] = useState(() => readHomeFirstRun(sessionScope));
  const [introductionOpen, setIntroductionOpen] = useState(false);
  const showFirstRun = firstRunLoaded && !firstRunError && firstRunProgress.entered && (!overview?.config || !firstRunProgress.growthCompleted);

  useEffect(() => {
    setFirstRunProgress(readHomeFirstRun(sessionScope));
    setOverview(null);
    setFirstRunLoaded(false);
    setOverviewRevision(value => value + 1);
  }, [sessionScope]);

  useEffect(() => {
    const refresh = () => setOverviewRevision(value => value + 1);
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, refresh);
  }, []);

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
    setIntroductionOpen(false);
    setFirstRunProgress(resetHomeFirstRun(sessionScope));
    onFirstRunRestored?.();
  }, [firstRunRequestKey, onFirstRunRestored, sessionScope]);

  useEffect(() => {
    const reset = () => {
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
    };
    window.addEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
    return () => window.removeEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
  }, []);

  return <AssistantHomeScenes variant="home" sessionScope={sessionScope} agent={PRIMARY_ASSISTANT_THREAD} disabled={assistantBusy}
    overview={overview} overviewLoaded={firstRunLoaded} onNavigate={onNavigate}
    onPrompt={detail => window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_PROMPT_EVENT, { detail }))}>
    {({ panel, launchers }) => <div className="creator-home creator-home--employee h-full overflow-y-auto">
    <div className="creator-home__inner">
      <header className="creator-home__hero text-center">
        <h2>{showFirstRun ? '先认识灵枢，再让灵小枢认识你' : '今天想让数字员工完成什么？'}</h2>
      </header>

      {!showFirstRun && panel}

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

      {!showFirstRun && launchers}

      <section id="creator-home-library" tabIndex={-1} className="creator-home__library" aria-label="灵小枢，帮我找本周热门素材">
        {inspirationWorkspace}
      </section>
    </div>
    <HomeIntroduction open={introductionOpen} initialConfig={overview?.config || EMPTY_CONFIG}
      onClose={() => setIntroductionOpen(false)} onComplete={() => {
        setIntroductionOpen(false);
        setOverviewRevision(value => value + 1);
        window.dispatchEvent(new CustomEvent(HOME_INTRODUCTION_COMPLETE_EVENT));
      }} />
  </div>}
  </AssistantHomeScenes>;
}
