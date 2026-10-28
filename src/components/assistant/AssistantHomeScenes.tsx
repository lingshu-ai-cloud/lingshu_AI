import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button, Modal } from 'antd';
import { ArrowRight, BarChart3, CalendarCheck2, ChevronDown, ChevronUp, Clapperboard, Images, Megaphone, MessagesSquare, Newspaper } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import { isBusinessScene, type BusinessSceneId } from '../../../shared/contracts/assistantBusinessScene';
import { ASSISTANT_HOME_LEVEL_LABELS, ASSISTANT_HOME_QUICK_LAUNCHERS, assistantHomePromptById, type AssistantHomePrompt, type AssistantHomeQuickLauncher, type AssistantHomeQuickLauncherId } from '../../lib/assistantHomeQuickPrompts';
import { assistantQueryKind } from '../../lib/assistantQueryQuickPrompts';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';
import ProductHighlightDialog from '../enterprise/ProductHighlightDialog';
import AssistantBusinessSceneDialog from './AssistantBusinessSceneDialog';
import AssistantQuickPromptDialog from './AssistantQuickPromptDialog';
import CompanyReportScene from './CompanyReportScene';
import SocialInsightDialog from './SocialInsightDialog';
import { assistantImageReplicationPortal } from './assistantImageReplicationIntent';
import { ASSISTANT_HOME_ACTIVITY_EVENT, type AssistantHomePromptMode, type AssistantHomeSubmitOptions, type AssistantHomePromptEventDetail } from './useAssistantHomeAnchor';
import './assistantHomeScenes.css';

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

export interface AssistantHomeScenesProps {
  agent: OrbitAgentId;
  disabled?: boolean;
  variant?: 'home' | 'sidebar';
  sessionScope?: string;
  overview?: DigitalEmployeeOverview | null;
  overviewLoaded?: boolean;
  onPrompt: (detail: AssistantHomePromptEventDetail) => void;
  onNavigate?: (page: Page) => void;
  children?: (parts: { panel: ReactNode; launchers: ReactNode }) => ReactNode;
}

export default function AssistantHomeScenes({ agent, disabled = false, variant = 'sidebar', sessionScope = '', overview: suppliedOverview, overviewLoaded, onPrompt, onNavigate, children }: AssistantHomeScenesProps) {
  const [activeLauncherId, setActiveLauncherId] = useState<AssistantHomeQuickLauncherId | null>(null);
  const [companyReportOpen, setCompanyReportOpen] = useState(false);
  const [socialInsightOpen, setSocialInsightOpen] = useState(false);
  const conversationKey = useAssistantStore(state => state.threads[agent].conversationKey || '');
  const resetVersion = useAssistantStore(state => state.threads[agent].conversationResetVersion || 0);
  const reportScope = `${sessionScope}:${agent}:${conversationKey}:${resetVersion}`;
  useEffect(() => setSocialInsightOpen(false), [reportScope]);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [businessSceneId, setBusinessSceneId] = useState<BusinessSceneId | null>(null);
  const [queryPrompt, setQueryPrompt] = useState<AssistantHomePrompt | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingHomePrompt | null>(null);
  const [readOverview, setReadOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [readLoaded, setReadLoaded] = useState(false);
  const overview = suppliedOverview === undefined ? readOverview : suppliedOverview;
  const firstRunLoaded = overviewLoaded ?? readLoaded;
  const assistantBusy = disabled;
  const uniqueId = useId();
  const panelId = variant === 'home' ? 'creator-home-operations' : `assistant-scenes-${uniqueId}`;
  const companyPanelId = `${panelId}-company`;
  const activeLauncher = useMemo(
    () => ASSISTANT_HOME_QUICK_LAUNCHERS.find(entry => entry.id === activeLauncherId) || null,
    [activeLauncherId],
  );
  const hasWeeklyPlan = Boolean(overview?.goal && overview.plan);
  const activePrompts = useMemo(() => {
    const prompts = resolveLauncherPrompts(activeLauncher);
    if (activeLauncher?.id !== 'weekly-plan' || !firstRunLoaded || hasWeeklyPlan) return prompts;
    return prompts.map(entry => entry.id === 'OP-CALENDAR' ? {
      ...entry,
      label: '创建周计划',
      summary: '当前没有周计划，通过对话生成本周目标、任务、预算和排期',
      prompt: '请帮我创建本周计划。',
      level: 'plan' as const,
    } : entry);
  }, [activeLauncher, firstRunLoaded, hasWeeklyPlan]);
  const canvasCollapsed = activeLauncher === null;
  useEffect(() => {
    setActiveLauncherId(null); setCompanyReportOpen(false); setHighlightOpen(false); setBusinessSceneId(null); setQueryPrompt(null); setPendingPrompt(null);
    if (suppliedOverview !== undefined) return;
    let active = true; setReadOverview(null); setReadLoaded(false);
    void digitalEmployeeApi.overview().then(value => { if (active) { setReadOverview(value); setReadLoaded(true); } }).catch(() => { if (active) setReadLoaded(true); });
    return () => { active = false; };
  }, [sessionScope, agent, suppliedOverview]);
  useEffect(() => {
    if (variant !== 'home') return;
    const collapse = (event: Event) => { if ((event as CustomEvent<{ active?: boolean }>).detail?.active) { setActiveLauncherId(null); setCompanyReportOpen(false); } };
    window.addEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, collapse);
    return () => window.removeEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, collapse);
  }, [variant]);
  const fillPrompt = (entry: AssistantHomePrompt, mode: AssistantHomePromptMode = 'replace', submitOptions?: AssistantHomeSubmitOptions) => {
    onPrompt({ prompt: entry.prompt, mode, submitOptions });
    setPendingPrompt(null);
    setActiveLauncherId(null);
  };

  const preparePrompt = (entry: AssistantHomePrompt, submitOptions?: AssistantHomeSubmitOptions) => {
    const draft = useAssistantStore.getState().threads[agent].draftInput.trim();
    if (draft && draft !== entry.prompt.trim()) { setPendingPrompt({ entry, submitOptions }); return; }
    fillPrompt(entry, 'replace', submitOptions);
  };

  const choosePrompt = (entry: AssistantHomePrompt) => {
    if (assistantBusy) return;
    if (entry.id === 'OP-CALENDAR') {
      if (!hasWeeklyPlan) { preparePrompt(entry); return; }
      onNavigate?.('digitalEmployees');
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('lingshu:open-weekly-plan', { detail: { source: 'home' } })), 0);
      setActiveLauncherId(null);
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
    if (entry.id === 'OP-11') { setSocialInsightOpen(true); return; }
    setCompanyReportOpen(false);
    if (assistantQueryKind(entry.id)) { setQueryPrompt(entry); return; }
    if (entry.id === 'CO-13') {
      const portal = assistantImageReplicationPortal(entry.prompt);
      if (!portal) return;
      const store = useAssistantStore.getState();
      store.setMessages(agent, [...store.threads[agent].messages,
        { role: 'assistant', content: '先确认参考图和企业产品，其他要求可以补充；确认后我来完成图片和配文。', creationPortal: portal }]);
      store.setFollowingLatest(agent, true);
      window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: true } }));
      setActiveLauncherId(null);
      return;
    }
    preparePrompt(entry);
  };

  const toggleLauncher = (launcherId: AssistantHomeQuickLauncherId) => {
    setCompanyReportOpen(false);
    setActiveLauncherId(current => current === launcherId ? null : launcherId);
  };

  const panel = <div className={`creator-home__canvas-stage${canvasCollapsed ? ' is-collapsed' : ''}`} inert={canvasCollapsed ? true : undefined} aria-hidden={canvasCollapsed || undefined}>
        <section id={panelId} className="creator-home__canvas" aria-label={activeLauncher ? `${activeLauncher.label}快捷任务` : '快捷任务'}>
          {activeLauncher ? <div className="creator-home__quick-panel">
            <div id={`${panelId}-cards`} className={`creator-home__prompt-grid${activeLauncher.id === 'viral-script' ? ' creator-home__prompt-grid--creation' : ''}`} aria-label={`${activeLauncher.label}：${activeLauncher.description}`}>
              {activePrompts.map((entry, index) => <button
                type="button"
                key={entry.id}
                disabled={assistantBusy}
                aria-expanded={entry.id === 'OP-LEADER' ? companyReportOpen : undefined}
                aria-controls={entry.id === 'OP-LEADER' ? companyPanelId : undefined}
                className={`creator-home__prompt-card${index === 0 ? ' creator-home__prompt-card--primary' : ''}`}
                onClick={() => choosePrompt(entry)}
              >
                <span className="creator-home__prompt-card-icon">{entry.id === 'CO-13' ? <Images size={19} aria-hidden="true"/> : launcherIcon(activeLauncher.id, 19)}</span>
                <span className="creator-home__prompt-card-copy"><strong>{entry.label}</strong><span>{entry.summary}</span></span>
                <span className={`creator-home__prompt-card-level is-${entry.level}`}>{ASSISTANT_HOME_LEVEL_LABELS[entry.level]}</span>
                <ArrowRight size={15} aria-hidden="true"/>
              </button>)}
            </div>
            {companyReportOpen && <div id={companyPanelId}><CompanyReportScene busy={assistantBusy}
              onConfirm={request => {
                if (assistantBusy) return;
                setCompanyReportOpen(false);
                onPrompt({ prompt: request.text, submit: true, submitOptions: { companyReport: true } });
              }}/></div>}
          </div> : null}
        </section>
      </div>;
  const launchers = <div className="creator-home__suggestions" aria-label="快捷任务">
        {ASSISTANT_HOME_QUICK_LAUNCHERS.map(launcher => {
          const active = activeLauncherId === launcher.id;
          return <button
            type="button"
            key={launcher.id}
            disabled={assistantBusy}
            className={active ? 'is-active' : undefined}
            aria-controls={panelId}
            aria-expanded={active}
            onClick={() => toggleLauncher(launcher.id)}
          >
            {launcherIcon(launcher.id, 15)}
            <span>{launcher.label}</span>
            {active ? <ChevronUp size={14} aria-hidden="true"/> : <ChevronDown size={14} aria-hidden="true"/>}
          </button>;
        })}
      </div>;
  return <div className={`assistant-home-scenes assistant-home-scenes--${variant}`}>
    {children ? children({ panel, launchers }) : <>{launchers}{panel}</>}
    {socialInsightOpen && <SocialInsightDialog key={reportScope} scope={reportScope} onClose={() => setSocialInsightOpen(false)} onReport={(report, partial, reportId) => {
      const store = useAssistantStore.getState();
      const thread = store.threads[agent];
      if ((thread.conversationKey || '') !== conversationKey || (thread.conversationResetVersion || 0) !== resetVersion) return;
      store.setMessages(agent, [...thread.messages,
        { role: 'user', content: `生成“${report.keyword}”近7天社交媒体资讯报告。` },
        { role: 'assistant', content: `${partial ? '部分报告：本次已取得公开样本，部分解读未完成，详见数据局限。\n\n' : ''}\`\`\`social-insight\n${JSON.stringify({ reportId })}\n\`\`\``, analysisComplete: true }]);
      store.setFollowingLatest(agent, true);
      setSocialInsightOpen(false); setActiveLauncherId(null);
      window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: true } }));
    }}/>}
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
  </div>;
}
