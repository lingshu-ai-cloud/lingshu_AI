import {productionNavigationIdentity} from './productionNavigation';
/** UI-only return state. Source history entries own their calendar snapshot. */
export interface AgentCalendarReturnContext {
  id: string;
  authIdentity: string;
  calendar: { positionKey: string; offset: number; cardId: string };
  states: Record<string, unknown>;
  scroll: Array<{ path: number[]; left: number; top: number }>;
  windowScroll: { left: number; top: number };
  calendarScroll?: {left:number;top:number};
}
type StateProvider = { read: () => unknown; restore: (value: unknown) => void };
const providers = new Map<string, StateProvider>();
const historyKey = 'agentCalendarReturnContext';
export function agentCalendarAuthIdentity():string{return typeof localStorage==='undefined'?'navigation:signed-out':productionNavigationIdentity();}
const sessionKey=()=>`${historyKey}:${agentCalendarAuthIdentity()}`;
function validContext(value:unknown):value is AgentCalendarReturnContext {
  const v=value as AgentCalendarReturnContext|null;
  return !!v&&v.authIdentity===agentCalendarAuthIdentity()&&typeof v.id==='string'&&typeof v.calendar?.positionKey==='string'&&Number.isSafeInteger(v.calendar.offset)&&typeof v.calendar.cardId==='string'&&Array.isArray(v.scroll)&&!!v.states&&typeof v.states==='object';
}
function saveContext(context:AgentCalendarReturnContext){
  window.history.replaceState({...window.history.state,[historyKey]:context},'');
  try{if(typeof sessionStorage!=='undefined')sessionStorage.setItem(sessionKey(),JSON.stringify(context));}catch{/* History still works if session storage is unavailable. */}
}
export function readAgentCalendarReturnContext():AgentCalendarReturnContext|null {
  if(typeof window==='undefined')return null;
  const value=window.history.state?.[historyKey];
  if(value!==undefined)return validContext(value)?value:null;
  try{const saved=typeof sessionStorage==='undefined'?null:JSON.parse(sessionStorage.getItem(sessionKey())||'null');return validContext(saved)?saved:null;}catch{return null;}
}
export function persistAgentCalendarReturnContext(){
  const context=readAgentCalendarReturnContext();
  if(context){
    const roots=Array.from(document.querySelectorAll<HTMLElement>('[data-agent-calendar-position-key]'));
    const visible=roots.some(node=>node.dataset.agentCalendarPositionKey===context.calendar.positionKey&&node.getClientRects().length>0);
    if(roots.length&&!visible)return;
    if(visible)captureAgentCalendarReturnContext(context.calendar);
    const refreshed=visible?readAgentCalendarReturnContext():context;
    if(refreshed)saveContext({...refreshed,states:{...context.states,...Object.fromEntries(Array.from(providers,([key,p])=>[key,p.read()]))}});
  }
}
export function registerAgentCalendarReturnState(key: string, provider: StateProvider) {
  providers.set(key, provider);
  if(typeof window!=='undefined')window.addEventListener?.('pagehide',persistAgentCalendarReturnContext);
  const saved = readAgentCalendarReturnContext();
  if (saved && Object.prototype.hasOwnProperty.call(saved.states, key)) provider.restore(saved.states[key]);
  return () => { if (providers.get(key) === provider) providers.delete(key);if(!providers.size&&typeof window!=='undefined')window.removeEventListener?.('pagehide',persistAgentCalendarReturnContext); };
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
  const root=Array.from(document.querySelectorAll<HTMLElement>('[data-agent-calendar-position-key]')).find(node=>node.dataset.agentCalendarPositionKey===calendar.positionKey&&node.getClientRects().length>0);
  const horizontal=root?.querySelector?.<HTMLElement>('[data-agent-calendar-scroll]');
  const context: AgentCalendarReturnContext = {
    id: `${Date.now()}:${Math.random()}`, authIdentity:agentCalendarAuthIdentity(), calendar, states: Object.fromEntries(Array.from(providers, ([key, provider]) => [key, provider.read()])),
    scroll, windowScroll: { left: window.scrollX, top: window.scrollY },...(horizontal?{calendarScroll:{left:horizontal.scrollLeft,top:horizontal.scrollTop}}:{}),
  };
  saveContext(context);
}
export function restoreAgentCalendarReturnContext(context = readAgentCalendarReturnContext()) {
  if (!context || typeof window === 'undefined' || !validContext(context)) return;
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
    const horizontal=calendar.querySelector?.<HTMLElement>('[data-agent-calendar-scroll]');
    if(horizontal&&context.calendarScroll){horizontal.scrollLeft=context.calendarScroll.left;horizontal.scrollTop=context.calendarScroll.top;}
    const card=Array.from(calendar.querySelectorAll?.<HTMLElement>('[data-agent-calendar-card-id]')||[]).find(node=>node.dataset.agentCalendarCardId===context.calendar.cardId);
    card?.focus({preventScroll:true});
    window.scrollTo(context.windowScroll.left, context.windowScroll.top);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(restoreScroll));
}
