import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Page } from '../../App';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';
import type { AssistantDecisionDialog } from './AssistantDecisionDialog';

type PanelControlsInput = {
  inlineHome?: boolean;
  activeAgent: OrbitAgentId;
  page: Page;
  mode: 'breathing' | 'chat';
  assistantTool: 'knowledge-intake' | null;
  decisionDialog: AssistantDecisionDialog;
  launcherRetracted: boolean;
  assistantClosedRef: { current: { page: Page; at: number } | null };
  launcherButtonRef: { current: HTMLAnchorElement | HTMLButtonElement | null };
  edgeLauncherButtonRef: { current: HTMLAnchorElement | HTMLButtonElement | null };
  messageScrollRef: { current: HTMLDivElement | null };
  persistThread: (agent: OrbitAgentId) => void;
  setAssistantTool: Dispatch<SetStateAction<'knowledge-intake' | null>>;
  setPanelView: Dispatch<SetStateAction<'todo' | 'chat'>>;
  setDecisionDialog: Dispatch<SetStateAction<AssistantDecisionDialog>>;
  setWelcomeBubbleVisible: Dispatch<SetStateAction<boolean>>;
  setMode: Dispatch<SetStateAction<'breathing' | 'chat'>>;
  setViewport: Dispatch<SetStateAction<{ width: number; height: number }>>;
  openCurrentPageAgent: () => void;
};

/** Panel close, focus, Escape, and viewport behavior; task execution stays separate. */
export function useAssistantPanelControls(input: PanelControlsInput) {
  const { inlineHome, activeAgent, page, mode, assistantTool, decisionDialog, launcherRetracted,
    assistantClosedRef, launcherButtonRef, edgeLauncherButtonRef, messageScrollRef,
    persistThread, setAssistantTool, setPanelView, setDecisionDialog,
    setWelcomeBubbleVisible, setMode, setViewport, openCurrentPageAgent } = input;

  const closeAssistant = useCallback(() => {
    persistThread(activeAgent);
    assistantClosedRef.current = { page, at: Date.now() };
    setAssistantTool(null);
    setPanelView('chat');
    setDecisionDialog(null);
    setWelcomeBubbleVisible(false);
    setMode('breathing');
    window.requestAnimationFrame(() => {
      if (launcherRetracted) edgeLauncherButtonRef.current?.focus();
      else launcherButtonRef.current?.focus();
    });
  }, [activeAgent, launcherRetracted, page, persistThread]);

  const returnToConversation = useCallback(() => {
    const thread = useAssistantStore.getState().threads[activeAgent];
    setPanelView('chat');
    window.requestAnimationFrame(() => {
      const scroller = messageScrollRef.current;
      if (!scroller) return;
      if (!thread.isFollowingLatest) scroller.scrollTop = thread.scrollPosition;
      else scroller.scrollTop = scroller.scrollHeight;
    });
  }, [activeAgent]);

  const handleLauncherClick = () => {
    if (mode === 'chat') {
      closeAssistant();
      return;
    }
    if (assistantTool === 'knowledge-intake') {
      setMode('chat');
      return;
    }
    openCurrentPageAgent();
  };

  useEffect(() => {
    if (mode !== 'chat' && assistantTool !== 'knowledge-intake') return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || decisionDialog || inlineHome) return;
      closeAssistant();
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [assistantTool, closeAssistant, decisionDialog, inlineHome, mode]);

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { closeAssistant, returnToConversation, handleLauncherClick };
}
