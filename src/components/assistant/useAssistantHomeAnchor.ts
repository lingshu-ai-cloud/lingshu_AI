import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';

export type AssistantHomeBounds = { top: number; left: number; width: number; height: number };
export const ASSISTANT_HOME_ACTIVITY_EVENT = 'lingshu:assistant-home-activity';
export const ASSISTANT_HOME_PROMPT_EVENT = 'lingshu:assistant-home-prompt';
export type AssistantHomePromptMode = 'replace' | 'append';
export type AssistantHomePromptEventDetail = { prompt: string; mode?: AssistantHomePromptMode };

export function normalizeAssistantHomePromptDetail(value: unknown): AssistantHomePromptEventDetail | null {
  if (typeof value === 'string') {
    const prompt = value.trim();
    return prompt ? { prompt, mode: 'replace' } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { prompt?: unknown; mode?: unknown };
  const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
  if (!prompt) return null;
  const mode = candidate.mode === 'append' ? 'append' : 'replace';
  return { prompt, mode };
}

export function mergeAssistantHomePrompt(current: string, next: string, mode: AssistantHomePromptMode = 'replace') {
  const prompt = next.trim();
  if (mode !== 'append') return prompt;
  const draft = current.trim();
  return draft ? `${draft}\n\n${prompt}` : prompt;
}

export function useAssistantHomeMode(active: boolean, setMode: Dispatch<SetStateAction<'breathing' | 'chat'>>) {
  useEffect(() => {
    if (!active) return;
    setMode('chat');
    return () => setMode('breathing');
  }, [active, setMode]);
}

/** Locate the home slot once; the portal then follows its native scroll position without frame-by-frame coordinate writes. */
export function useAssistantHomeAnchor(active: boolean): AssistantHomeBounds | null {
  const [bounds, setBounds] = useState<AssistantHomeBounds | null>(null);
  useEffect(() => {
    if (!active) { setBounds(null); return; }
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mountObserver: MutationObserver | null = null;
    const sync = () => {
      const anchor = document.getElementById('content-creation-assistant-anchor');
      if (!anchor) { setBounds(null); return; }
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => schedule());
        resizeObserver.observe(anchor);
        const layout = anchor.closest('.creator-home__inner');
        if (layout) resizeObserver.observe(layout);
        mountObserver?.disconnect();
      }
      const rect = anchor.getBoundingClientRect();
      const next = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      setBounds(previous => previous && Object.keys(next).every(key => previous[key as keyof AssistantHomeBounds] === next[key as keyof AssistantHomeBounds]) ? previous : next);
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };
    mountObserver = new MutationObserver(schedule);
    mountObserver.observe(document.body, { childList: true, subtree: true });
    schedule();
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      mountObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [active]);
  return active ? bounds : null;
}

/** Home suggestions edit the existing assistant draft; the home panel grows only for active threads. */
export function useAssistantHomeInteraction(active: boolean, messageCount: number, loading: boolean, agent: OrbitAgentId,
  setDraftInput: (agent: OrbitAgentId, value: string) => void, inputRef: RefObject<HTMLTextAreaElement | null>, hasReference = false) {
  useEffect(() => {
    if (!active) return;
    const anchor = document.getElementById('content-creation-assistant-anchor');
    anchor?.classList.toggle('creator-home__assistant-anchor--active', messageCount > 0 || loading || hasReference);
    return () => anchor?.classList.remove('creator-home__assistant-anchor--active');
  }, [active, loading, messageCount, hasReference]);
  useEffect(() => {
    if (!active) return;
    const onPrompt = (event: Event) => {
      const detail = normalizeAssistantHomePromptDetail((event as CustomEvent<unknown>).detail);
      if (!detail) return;
      const current = useAssistantStore.getState().threads[agent].draftInput;
      setDraftInput(agent, mergeAssistantHomePrompt(current, detail.prompt, detail.mode));
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    const onReference = () => window.requestAnimationFrame(() => {
      const anchor = document.getElementById('content-creation-assistant-anchor');
      anchor?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      inputRef.current?.focus({ preventScroll: true });
    });
    window.addEventListener('lingshu:assistant-home-reference', onReference);
    window.addEventListener(ASSISTANT_HOME_PROMPT_EVENT, onPrompt);
    return () => { window.removeEventListener(ASSISTANT_HOME_PROMPT_EVENT, onPrompt); window.removeEventListener('lingshu:assistant-home-reference', onReference); };
  }, [active, agent, inputRef, setDraftInput]);
}
