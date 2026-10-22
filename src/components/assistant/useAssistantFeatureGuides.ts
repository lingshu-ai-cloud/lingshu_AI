import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../../App';
import { ASSISTANT_GUIDES, type AssistantGuide } from '../../lib/assistantGuides';

const GUIDE_MEMORY_KEY = 'lingshu-feature-guides-human-v1';
const GUIDE_HOVER_DELAY_MS = 900;
const GUIDE_COOLDOWN_MS = 45_000;
const GUIDE_VISIBLE_MS = 6_000;
const ENTERPRISE_GUIDE_MEMORY_ID = '__enterprise-guide-shown__';

type GuideMemory = { seen: string[]; lastShownAt: number };

export function canShowAssistantFeatureGuide(input: {
  id: string;
  page: Page;
  seen: ReadonlySet<string>;
  enterpriseGuideSeen: boolean;
  lastShownAt: number;
  now: number;
}) {
  const { id, page, seen, enterpriseGuideSeen, lastShownAt, now } = input;
  if (!ASSISTANT_GUIDES[id] || seen.has(id)) return false;
  if (page === 'enterprise' && id.startsWith('enterprise-')
    && (enterpriseGuideSeen || seen.has(ENTERPRISE_GUIDE_MEMORY_ID))) return false;
  return now - lastShownAt >= GUIDE_COOLDOWN_MS;
}

export function useAssistantFeatureGuides({ page, compactMode, mode }: {
  page: Page;
  compactMode: boolean;
  mode: 'breathing' | 'chat';
}) {
  const [featureGuide, setFeatureGuide] = useState<(AssistantGuide & { id: string }) | null>(null);
  const [enterpriseGuideSeen, setEnterpriseGuideSeen] = useState(false);
  const featureGuideTimerRef = useRef<number | null>(null);
  const featureGuideHoverTimerRef = useRef<number | null>(null);
  const seenGuideIdsRef = useRef(new Set<string>());
  const lastGuideShownAtRef = useRef(0);
  const lastGuideTargetRef = useRef<HTMLElement | null>(null);

  const rememberGuide = useCallback((id: string, shownAt: number) => {
    seenGuideIdsRef.current.add(id);
    lastGuideShownAtRef.current = shownAt;
    try {
      const memory: GuideMemory = { seen: [...seenGuideIdsRef.current], lastShownAt: shownAt };
      window.localStorage.setItem(GUIDE_MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // Storage can be unavailable in privacy mode; in-memory deduplication still works.
    }
  }, []);

  const showFeatureGuide = useCallback((id: string) => {
    const now = Date.now();
    if (!canShowAssistantFeatureGuide({
      id, page, seen: seenGuideIdsRef.current, enterpriseGuideSeen,
      lastShownAt: lastGuideShownAtRef.current, now,
    })) return;
    const guide = ASSISTANT_GUIDES[id];
    const isEnterpriseGuide = page === 'enterprise' && id.startsWith('enterprise-');
    if (featureGuideTimerRef.current) window.clearTimeout(featureGuideTimerRef.current);
    if (isEnterpriseGuide) {
      seenGuideIdsRef.current.add(ENTERPRISE_GUIDE_MEMORY_ID);
      setEnterpriseGuideSeen(true);
    }
    rememberGuide(id, now);
    setFeatureGuide({ ...guide, id });
    featureGuideTimerRef.current = window.setTimeout(() => setFeatureGuide(null), GUIDE_VISIBLE_MS);
  }, [enterpriseGuideSeen, page, rememberGuide]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(GUIDE_MEMORY_KEY);
      if (!stored) return;
      const memory = JSON.parse(stored) as Partial<GuideMemory>;
      if (Array.isArray(memory.seen)) {
        seenGuideIdsRef.current = new Set(memory.seen.filter(id => typeof id === 'string'));
        setEnterpriseGuideSeen(
          seenGuideIdsRef.current.has(ENTERPRISE_GUIDE_MEMORY_ID)
          || [...seenGuideIdsRef.current].some(id => id.startsWith('enterprise-')),
        );
      }
      if (typeof memory.lastShownAt === 'number') lastGuideShownAtRef.current = memory.lastShownAt;
    } catch {
      // Ignore malformed or unavailable storage and start with a clean guide memory.
    }
  }, []);

  useEffect(() => {
    if (compactMode || mode !== 'breathing') {
      setFeatureGuide(null);
      return;
    }
    const findTarget = (event: Event) => {
      const target = event.target;
      return target instanceof Element ? target.closest<HTMLElement>('[data-lingshu-guide]') : null;
    };
    const cancelPendingHover = () => {
      if (featureGuideHoverTimerRef.current) window.clearTimeout(featureGuideHoverTimerRef.current);
      featureGuideHoverTimerRef.current = null;
    };
    const showFromEvent = (event: Event) => {
      const target = findTarget(event);
      if (!target) return;
      const id = target.dataset.lingshuGuide;
      if (!id) return;
      if (event.type === 'pointerover') {
        const related = (event as PointerEvent).relatedTarget;
        if (related instanceof Node && target.contains(related)) return;
        if (lastGuideTargetRef.current === target) return;
        cancelPendingHover();
        lastGuideTargetRef.current = target;
        featureGuideHoverTimerRef.current = window.setTimeout(() => {
          if (lastGuideTargetRef.current === target) showFeatureGuide(id);
        }, GUIDE_HOVER_DELAY_MS);
        return;
      }
      cancelPendingHover();
      lastGuideTargetRef.current = target;
      showFeatureGuide(id);
    };
    const clearPointerTarget = (event: Event) => {
      const target = findTarget(event);
      if (!target) return;
      const related = (event as PointerEvent).relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      if (lastGuideTargetRef.current === target) {
        lastGuideTargetRef.current = null;
        cancelPendingHover();
      }
    };
    document.addEventListener('pointerover', showFromEvent, true);
    document.addEventListener('pointerout', clearPointerTarget, true);
    document.addEventListener('focusin', showFromEvent, true);
    document.addEventListener('click', showFromEvent, true);
    return () => {
      cancelPendingHover();
      document.removeEventListener('pointerover', showFromEvent, true);
      document.removeEventListener('pointerout', clearPointerTarget, true);
      document.removeEventListener('focusin', showFromEvent, true);
      document.removeEventListener('click', showFromEvent, true);
    };
  }, [compactMode, mode, showFeatureGuide]);

  useEffect(() => () => {
    if (featureGuideTimerRef.current) window.clearTimeout(featureGuideTimerRef.current);
    if (featureGuideHoverTimerRef.current) window.clearTimeout(featureGuideHoverTimerRef.current);
  }, []);

  return { featureGuide, setFeatureGuide, enterpriseGuideSeen };
}
