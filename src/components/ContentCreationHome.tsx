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
  Send,
  Target,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Page } from '../pageRegistry';
import {
  ASSISTANT_HOME_LEVEL_LABELS,
  ASSISTANT_HOME_QUICK_LAUNCHERS,
  assistantHomePromptById,
  type AssistantHomePrompt,
  type AssistantHomeQuickLauncher,
  type AssistantHomeQuickLauncherId,
} from '../lib/assistantHomeQuickPrompts';
import { useAssistantStore } from '../stores/assistantStore';
import { PRIMARY_ASSISTANT_THREAD } from './assistant/globalAssistantRuntime';
import { assistantImageReplicationPortal } from './assistant/assistantImageReplicationIntent';
import {
  ASSISTANT_HOME_ACTIVITY_EVENT,
  ASSISTANT_HOME_PROMPT_EVENT,
  type AssistantHomePromptMode,
} from './assistant/useAssistantHomeAnchor';

function launcherIcon(id: AssistantHomeQuickLauncherId, size = 18) {
  const props = { size, 'aria-hidden': true as const };
  if (id === 'weekly-plan') return <CalendarCheck2 {...props}/>;
  if (id === 'external-news') return <Newspaper {...props}/>;
  if (id === 'content-strategy') return <Target {...props}/>;
  if (id === 'business-analysis') return <BarChart3 {...props}/>;
  if (id === 'publish-plan') return <Send {...props}/>;
  if (id === 'traffic-optimization') return <Megaphone {...props}/>;
  if (id === 'customer-followup') return <MessagesSquare {...props}/>;
  if (id === 'materials') return <Lightbulb {...props}/>;
  return <Clapperboard {...props}/>;
}

function resolveLauncherPrompts(launcher: AssistantHomeQuickLauncher | null): AssistantHomePrompt[] {
  if (!launcher) return [];
  return launcher.promptIds
    .map(id => assistantHomePromptById(id))
    .filter((entry): entry is AssistantHomePrompt => Boolean(entry));
}

export default function ContentCreationHome({ inspirationWorkspace }: { onNavigate?: (page: Page) => void; inspirationWorkspace?: ReactNode }) {
  const [activeLauncherId, setActiveLauncherId] = useState<AssistantHomeQuickLauncherId | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<AssistantHomePrompt | null>(null);
  const activeLauncher = useMemo(
    () => ASSISTANT_HOME_QUICK_LAUNCHERS.find(entry => entry.id === activeLauncherId) || null,
    [activeLauncherId],
  );
  const activePrompts = useMemo(() => resolveLauncherPrompts(activeLauncher), [activeLauncher]);
  const canvasCollapsed = activeLauncher === null;

  useEffect(() => {
    const onAssistantActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      if (detail?.active) setActiveLauncherId(null);
    };
    window.addEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
    return () => window.removeEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
  }, []);

  const fillPrompt = (entry: AssistantHomePrompt, mode: AssistantHomePromptMode = 'replace') => {
    window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_PROMPT_EVENT, { detail: { prompt: entry.prompt, mode } }));
    setPendingPrompt(null);
    setActiveLauncherId(null);
  };

  const choosePrompt = (entry: AssistantHomePrompt) => {
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
    const draft = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].draftInput.trim();
    if (draft && draft !== entry.prompt.trim()) {
      setPendingPrompt(entry);
      return;
    }
    fillPrompt(entry);
  };

  const toggleLauncher = (launcherId: AssistantHomeQuickLauncherId) => {
    setActiveLauncherId(current => current === launcherId ? null : launcherId);
  };

  return <div className="creator-home creator-home--employee h-full overflow-y-auto">
    <div className="creator-home__inner">
      <header className="creator-home__hero text-center">
        <h2>今天想让数字员工完成什么？</h2>
      </header>

      <div className={`creator-home__canvas-stage${canvasCollapsed ? ' is-collapsed' : ''}`} inert={canvasCollapsed ? true : undefined} aria-hidden={canvasCollapsed || undefined}>
        <section id="creator-home-operations" className="creator-home__canvas" aria-label={activeLauncher ? `${activeLauncher.label}快捷任务` : '快捷任务'}>
          {activeLauncher ? <div className="creator-home__quick-panel">
            <div id="creator-home-prompt-cards" className={`creator-home__prompt-grid${activeLauncher.id === 'viral-script' ? ' creator-home__prompt-grid--creation' : ''}`} aria-label={`${activeLauncher.label}：${activeLauncher.description}`}>
              {activePrompts.map((entry, index) => <button
                type="button"
                key={entry.id}
                className={`creator-home__prompt-card${index === 0 ? ' creator-home__prompt-card--primary' : ''}`}
                onClick={() => choosePrompt(entry)}
              >
                <span className="creator-home__prompt-card-icon">{entry.id === 'CO-13' ? <Images size={19} aria-hidden="true"/> : launcherIcon(activeLauncher.id, 19)}</span>
                <span className="creator-home__prompt-card-copy"><strong>{entry.label}</strong><span>{entry.summary}</span></span>
                <span className={`creator-home__prompt-card-level is-${entry.level}`}>{ASSISTANT_HOME_LEVEL_LABELS[entry.level]}</span>
                <ArrowRight size={15} aria-hidden="true"/>
              </button>)}
            </div>
          </div> : null}
        </section>
      </div>

      <section className="creator-home__conversation" aria-label="灵小枢对话">
        <div id="content-creation-assistant-anchor" className="creator-home__assistant-anchor"/>
      </section>

      <div className="creator-home__suggestions" aria-label="快捷任务">
        {ASSISTANT_HOME_QUICK_LAUNCHERS.map(launcher => {
          const active = activeLauncherId === launcher.id;
          return <button
            type="button"
            key={launcher.id}
            className={active ? 'is-active' : undefined}
            aria-controls="creator-home-operations"
            aria-expanded={active}
            onClick={() => toggleLauncher(launcher.id)}
          >
            {launcherIcon(launcher.id, 15)}
            <span>{launcher.label}</span>
            {active ? <ChevronUp size={14} aria-hidden="true"/> : <ChevronDown size={14} aria-hidden="true"/>}
          </button>;
        })}
      </div>

      <section id="creator-home-library" className="creator-home__library" aria-label="爆款素材">
        {inspirationWorkspace}
      </section>
    </div>
    <Modal open={Boolean(pendingPrompt)} title="输入框已有内容" width={480} closable={false} footer={[
      <Button key="cancel" onClick={() => setPendingPrompt(null)}>取消</Button>,
      <Button key="append" onClick={() => pendingPrompt && fillPrompt(pendingPrompt, 'append')}>追加到现有内容</Button>,
      <Button key="replace" type="primary" onClick={() => pendingPrompt && fillPrompt(pendingPrompt, 'replace')}>替换现有内容</Button>,
    ]}>
      <p>“{pendingPrompt?.label}”会填入灵小枢输入框。请选择追加或替换；系统不会自动发送。</p>
    </Modal>
  </div>;
}
