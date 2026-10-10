/** UI-only return state. Source history entries own their calendar snapshot. */
export interface AgentCalendarReturnContext {
  id: string;
  calendar: { positionKey: string; offset: number; cardId: string };
  states: Record<string, unknown>;
  scroll: Array<{ path: number[]; left: number; top: number }>;
  windowScroll: { left: number; top: number };
}
type StateProvider = { read: () => unknown; restore: (value: unknown) => void };
const providers = new Map<string, StateProvider>();
const historyKey = 'agentCalendarReturnContext';
export function readAgentCalendarReturnContext(): AgentCalendarReturnContext | null {
  if (typeof window === 'undefined') return null;
  const value = window.history.state?.[historyKey];
  return value && typeof value.calendar?.positionKey === 'string' && Array.isArray(value.scroll) && value.states ? value : null;
}
export function registerAgentCalendarReturnState(key: string, provider: StateProvider) {
  providers.set(key, provider);
  const saved = readAgentCalendarReturnContext();
  if (saved && Object.prototype.hasOwnProperty.call(saved.states, key)) provider.restore(saved.states[key]);
  return () => { if (providers.get(key) === provider) providers.delete(key); };
}
function elementPath(element: Element): number[] | null {
  const path: number[] = [];
  let node: Element | null = element;
  while (node && node !== document.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return node ? path : null;
}
export function captureAgentCalendarReturnContext(calendar: AgentCalendarReturnContext['calendar']) {
  if (typeof window === 'undefined') return;
  const scroll: AgentCalendarReturnContext['scroll'] = [];
  document.querySelectorAll<HTMLElement>('body *').forEach(node => {
    if (node.closest('[role=dialog]') || (!node.scrollLeft && !node.scrollTop)) return;
    const path = elementPath(node);
    if (path) scroll.push({ path, left: node.scrollLeft, top: node.scrollTop });
  });
  const context: AgentCalendarReturnContext = {
    id: `${Date.now()}:${Math.random()}`, calendar, states: Object.fromEntries(Array.from(providers, ([key, provider]) => [key, provider.read()])),
    scroll, windowScroll: { left: window.scrollX, top: window.scrollY },
  };
  window.history.replaceState({ ...window.history.state, [historyKey]: context }, '');
}
export function restoreAgentCalendarReturnContext(context = readAgentCalendarReturnContext()) {
  if (!context || typeof window === 'undefined') return;
  for (const [key, provider] of providers) {
    if (Object.prototype.hasOwnProperty.call(context.states, key)) provider.restore(context.states[key]);
  }
  // The original calendar may wait for its package and tasks to load after Activity resumes.
  // Keep this bounded, and stop immediately if another history entry becomes current.
  let attempts = 0;
  const restoreScroll = () => {
    if (readAgentCalendarReturnContext()?.id !== context.id) return;
    const calendar = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-calendar-position-key]'))
      .find(node => node.dataset.agentCalendarPositionKey === context.calendar.positionKey && node.getClientRects().length > 0);
    if (!calendar) {
      if (++attempts < 600) window.requestAnimationFrame(restoreScroll);
      return;
    }
    for (const saved of context.scroll) {
      let node: Element | undefined = document.body;
      for (const index of saved.path) node = node?.children[index];
      if (node instanceof HTMLElement) { node.scrollLeft = saved.left; node.scrollTop = saved.top; }
    }
    window.scrollTo(context.windowScroll.left, context.windowScroll.top);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(restoreScroll));
}
