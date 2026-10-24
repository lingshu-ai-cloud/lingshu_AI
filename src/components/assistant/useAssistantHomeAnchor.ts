import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { OrbitAgentId } from '../../stores/assistantStore';

export type AssistantHomeBounds = { top: number; left: number; width: number; height: number };

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
      const prompt = (event as CustomEvent<unknown>).detail;
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      setDraftInput(agent, prompt);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    const onReference = () => window.requestAnimationFrame(() => {
      const anchor = document.getElementById('content-creation-assistant-anchor');
      anchor?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      inputRef.current?.focus({ preventScroll: true });
    });
    window.addEventListener('lingshu:assistant-home-reference', onReference);
    window.addEventListener('lingshu:assistant-home-prompt', onPrompt);
    return () => { window.removeEventListener('lingshu:assistant-home-prompt', onPrompt); window.removeEventListener('lingshu:assistant-home-reference', onReference); };
  }, [active, agent, inputRef, setDraftInput]);
}
