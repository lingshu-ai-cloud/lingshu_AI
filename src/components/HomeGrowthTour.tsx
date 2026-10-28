import { useEffect, useRef, useState } from 'react';
import type { Page } from '../pageRegistry';
import { ASSISTANT_HOME_PROMPT_EVENT } from './assistant/useAssistantHomeAnchor';
import { PRIMARY_ASSISTANT_THREAD } from './assistant/globalAssistantRuntime';
import { useAssistantStore } from '../stores/assistantStore';
import { HOME_GROWTH_TOUR_COMPLETE_EVENT, HOME_GROWTH_TOUR_START_EVENT } from '../lib/homeFirstRun';
import { closeContentGenerationQueue, openContentGenerationQueue } from '../lib/contentGenerationQueue';

const TASK_EXAMPLE = '为我生成本周运营计划';
const steps = [
  { title: '和灵小枢对话', description: '这里可以直接说目标，补充产品、市场和期限。涉及执行时，灵小枢会先请你确认。', page: 'strategy', target: '[aria-label="给灵小枢发送消息"]' },
  { title: '进入内容创作', description: '下一步会打开真实的内容创作页面，任务与作品都在这里查看。', page: 'strategy', target: '[data-growth-tour-nav="socialInspiration"]' },
  { title: '查看发布日历', description: '这里展示实际排期。新账号没有任务时，会显示真实空状态。', page: 'socialInspiration', target: '[data-growth-tour="calendar"]' },
  { title: '认识周任务包', description: '下一步进入经营总览。周目标会拆成内容任务，待确认事项由你决定。', page: 'socialInspiration', target: '[data-growth-tour-nav="digitalEmployees"]' },
  { title: '查看周任务', description: '有运行中的周任务时，下一步会打开真实详情；没有任务时，只介绍工作方式，不创建示例任务。', page: 'digitalEmployees', target: '[data-growth-tour="weekly-task"]' },
  { title: '周任务详情', description: '这里可以看周目标、内容安排和执行进度。下一步会关闭详情。', page: 'digitalEmployees', target: '[data-growth-tour="weekly-details"]' },
  { title: '回到灵小枢', description: '下一步回到对话首页，看看如何用一句话提出新任务。', page: 'digitalEmployees', target: '[data-growth-tour-nav="strategy"]' },
  { title: '对话式创建任务', description: '下一步会把示例需求放进空白输入栏，供你修改；不会自动发送或创建任务。', page: 'strategy', target: '[aria-label="给灵小枢发送消息"]' },
] as const;

type TargetRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const progressKey = (scope: string) => `lingshu:home-growth-tour-progress:v2:${scope}`;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Keep the explanation in a free corner next to the highlighted control. */
export function growthTourBubblePosition(rect: TargetRect, bubble: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 12;
  const width = Math.min(bubble.width, viewport.width - gap * 2);
  const height = Math.min(bubble.height, viewport.height - gap * 2);
  const right = clamp(rect.right - width, gap, viewport.width - width - gap);
  const left = clamp(rect.left, gap, viewport.width - width - gap);
  const top = clamp(rect.top, gap, viewport.height - height - gap);
  const candidates = [
    { left: right, top: rect.bottom + gap },
    { left: right, top: rect.top - height - gap },
    { left: rect.right + gap, top },
    { left: rect.left - width - gap, top },
    { left, top: rect.bottom + gap },
    { left, top: rect.top - height - gap },
  ];
  const free = candidates.find(point => point.left >= gap && point.top >= gap && point.left + width <= viewport.width - gap && point.top + height <= viewport.height - gap);
  if (free) return free;
  return { left: right, top: clamp(viewport.height - rect.bottom >= rect.top ? rect.bottom + gap : rect.top - height - gap, gap, viewport.height - height - gap) };
}

function targetForStep(index: number): Element | null {
  if (index === 2) return document.querySelector('[data-growth-tour="calendar"]') || document.querySelector('[data-growth-tour="queue-modal"]');
  if (index === 4) return document.querySelector('[data-growth-tour="weekly-task"]') || document.querySelector('[aria-label="当前周计划"]');
  return document.querySelector(steps[index]?.target || '');
}

export default function HomeGrowthTour({ page, scope, onNavigate }: { page: Page; scope: string; onNavigate: (page: Page) => void }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [bubbleSize, setBubbleSize] = useState({ width: 320, height: 180 });
  const bubbleRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const completedRef = useRef(false);
  const queueRequestedRef = useRef(false);
  const step = steps[index] ?? steps[0];

  useEffect(() => {
    const start = (event: Event) => {
      completedRef.current = false;
      queueRequestedRef.current = false;
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let saved = 0;
      const restart = event instanceof CustomEvent && event.detail?.restart === true;
      try { saved = restart ? 0 : Number(sessionStorage.getItem(progressKey(scope)) || 0); } catch { /* optional storage */ }
      const resumed = Number.isInteger(saved) && saved >= 0 && saved < steps.length ? saved : 0;
      const next = resumed === 5 && !document.querySelector('[data-growth-tour="weekly-details"]') ? 4 : resumed;
      setIndex(next);
      setActive(true);
      if (steps[next].page !== page) onNavigate(steps[next].page);
    };
    window.addEventListener(HOME_GROWTH_TOUR_START_EVENT, start);
    return () => window.removeEventListener(HOME_GROWTH_TOUR_START_EVENT, start);
  }, [onNavigate, page, scope]);

  useEffect(() => {
    if (!active || index !== 2 || page !== 'socialInspiration') {
      queueRequestedRef.current = false;
      return;
    }
    if (document.querySelector('[data-growth-tour="queue-modal"]') || queueRequestedRef.current) return;
    queueRequestedRef.current = true;
    openContentGenerationQueue({ view: 'calendar' });
  }, [active, index, page]);

  useEffect(() => {
    if (!active) return;
    try { sessionStorage.setItem(progressKey(scope), String(index)); } catch { /* optional storage */ }
    bubbleRef.current?.focus({ preventScroll: true });
  }, [active, index, scope]);

  useEffect(() => {
    if (!active) return;
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const observer = new ResizeObserver(() => {
      const next = bubble.getBoundingClientRect();
      setBubbleSize(previous => previous.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height });
    });
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = page === step.page ? targetForStep(index)?.getBoundingClientRect() : null;
        const next = bounds && bounds.width > 0 && bounds.height > 0
          ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height }
          : null;
        setRect(previous => previous && next && Object.keys(next).every(key => previous[key as keyof TargetRect] === next[key as keyof TargetRect]) ? previous : next);
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [active, index, page, step.page]);

  const pause = () => {
    if (index === 2) closeContentGenerationQueue();
    if (index === 5) {
      document.querySelector<HTMLElement>('.ant-drawer:has([data-growth-tour="weekly-details"]) .ant-drawer-close')?.click();
      try { sessionStorage.setItem(progressKey(scope), '4'); } catch { /* optional storage */ }
    }
    setActive(false);
    if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
  };
  const finish = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    try { sessionStorage.removeItem(progressKey(scope)); } catch { /* optional storage */ }
    setActive(false);
    window.dispatchEvent(new CustomEvent(HOME_GROWTH_TOUR_COMPLETE_EVENT));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="给灵小枢发送消息"]')?.focus({ preventScroll: true }));
  };
  const advance = () => {
    if (page !== step.page || !rect) return;
    if (index === 0) {
      document.querySelector<HTMLTextAreaElement>(step.target)?.focus({ preventScroll: true });
      setIndex(1);
    } else if (index === 1) {
      onNavigate('socialInspiration');
      setIndex(2);
    } else if (index === 2) {
      closeContentGenerationQueue();
      setIndex(3);
    } else if (index === 3) {
      onNavigate('digitalEmployees');
      setIndex(4);
    } else if (index === 4) {
      const weeklyButton = document.querySelector<HTMLButtonElement>('[data-growth-tour="weekly-task"]');
      if (weeklyButton) { weeklyButton.click(); setIndex(5); }
      else setIndex(6);
    } else if (index === 5) {
      document.querySelector<HTMLElement>('.ant-drawer:has([data-growth-tour="weekly-details"]) .ant-drawer-close')?.click();
      setIndex(6);
    } else if (index === 6) {
      onNavigate('strategy');
      setIndex(7);
    } else {
      const draft = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].draftInput.trim();
      if (!draft) window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_PROMPT_EVENT, { detail: { prompt: TASK_EXAMPLE, mode: 'replace' } }));
      finish();
    }
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); pause(); return; }
      if (event.key !== 'Enter' || event.repeat || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      advance();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  if (!active) return null;
  const position = rect ? growthTourBubblePosition(rect, bubbleSize, { width: window.innerWidth, height: window.innerHeight }) : { left: 12, top: 12 };
  const noWeeklyTask = index === 4 && !document.querySelector('[data-growth-tour="weekly-task"]');
  const existingDraft = index === 7 && Boolean(useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].draftInput.trim());
  return <>
    {rect && <div aria-hidden="true" className="pointer-events-none fixed rounded-lg" style={{ zIndex: 1200, left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10, boxShadow: '0 0 0 9999px rgba(9,9,11,.64), 0 0 0 2px var(--color-accent)' }} />}
    <aside ref={bubbleRef} tabIndex={-1} aria-label="海外增长导览" aria-live="polite" className="fixed w-[min(320px,calc(100vw-24px))] rounded-lg border border-border bg-surface p-4 text-text-primary shadow-lg outline-none" style={{ zIndex: 1201, left: position.left, top: position.top, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}>
      <span className="text-xs font-semibold text-accent">真实页面导览 · {index + 1}/{steps.length}</span>
      <h2 className="mt-2 text-base font-semibold">{step.title}</h2>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{step.description}</p>
      {noWeeklyTask && <p className="mt-2 text-xs leading-5 text-text-secondary">周目标 → 内容任务 → 待确认 → 执行结果。当前账号没有可查看的周任务。</p>}
      {existingDraft && <p className="mt-2 text-xs leading-5 text-text-secondary">输入栏已有内容，将保留你的草稿，不会替换。</p>}
      <p className="mt-3 border-t border-border pt-3 text-xs font-medium text-text-secondary">{rect && page === step.page ? <>按 <kbd className="font-semibold text-accent">Enter</kbd> {index === steps.length - 1 ? '完成导览' : '进入下一步'}</> : '正在定位当前页面…'} · 按 Esc 暂停</p>
    </aside>
  </>;
}
