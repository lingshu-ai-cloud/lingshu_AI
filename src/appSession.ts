import type { AuthSession } from './lib/auth';
import { resolveNavigationPage, resolvePage, type Page } from './pageRegistry';

export type AgentType = 'strategy' | 'traffic' | 'conversion' | 'retention';
export interface Source { title: string; uri: string }
export interface Message { role: 'user' | 'assistant'; content: string; sources?: Source[] }
export interface ConversationContext { agent: AgentType; messages?: Message[] }
export interface Conversation { id: string; agent: AgentType; title: string; messages: Message[]; updatedAt: number }
export interface RestoreSignal { agent: AgentType; messages: Message[]; key: string }
export interface KickoffSignal { text: string; key: string }
export type AgentAction = (agent: AgentType, task: string) => void;
export type StarterAccessState = 'loading' | 'starter_198' | 'legacy' | 'unavailable';

export const AGENT_PAGES: Page[] = ['strategy', 'traffic', 'conversion', 'retention'];
export const ROLE_PAGE_ACCESS: Record<import('./lib/auth').OrganizationRole, Set<Page>> = {
  super_admin: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'socialWorkspace', 'socialSetup', 'socialAccounts', 'socialPlanning', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'socialMonitoring', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'conversion', 'wecomCustomerService', 'retention', 'orders', 'enterprise', 'agentMemory', 'plugins', 'organizationPermissions', 'scheduled', 'admin', 'adminDelivery', 'channels', 'youtube']),
  admin: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'socialWorkspace', 'socialSetup', 'socialAccounts', 'socialPlanning', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'socialMonitoring', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'conversion', 'wecomCustomerService', 'retention', 'orders', 'enterprise', 'agentMemory', 'plugins', 'organizationPermissions', 'scheduled', 'channels', 'youtube']),
  social_operator: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'socialWorkspace', 'socialSetup', 'socialAccounts', 'socialPlanning', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'socialMonitoring', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'scheduled']),
  customer_service: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'conversion', 'wecomCustomerService', 'retention', 'orders', 'scheduled']),
};
export const isAdminSession = (session: AuthSession | null) => Boolean(session && !session.supportAccess && session.platformAdmin === true);
const EXTERNAL_CUSTOMER_SERVICE_DEMO_EMAILS = new Set(['customer-demo@lingshu.site', 'wenlantianxia-test@local.test']);
export const isExternalCustomerServiceDemoSession = (session: AuthSession | null) => Boolean(session && EXTERNAL_CUSTOMER_SERVICE_DEMO_EMAILS.has(session.user.email.trim().toLowerCase()));
export const isLocalCustomerReplyLab = () => (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') && window.location.pathname.replace(/\/+$/, '') === '/customer-reply-lab';
export const firstUserText = (msgs?: Message[]) => (msgs?.find(m => m.role === 'user')?.content ?? '新会话').slice(0, 24);
export const customerUnifiedAgent = (agent: AgentType): AgentType => agent === 'retention' ? 'conversion' : agent;
export const loadConvs = (): Conversation[] => { try { return JSON.parse(localStorage.getItem('ow_convs') || '[]'); } catch { return []; } };
export const loadPage = (): Page => {
  try {
    if (window.location.pathname === '/admin/delivery') return 'adminDelivery';
    const query = new URLSearchParams(window.location.search);
    const queryPage = resolveNavigationPage(query.get('page'), query.get('view'));
    if (queryPage) return queryPage;
    const savedValue = localStorage.getItem('ow_page');
    const saved = resolvePage(savedValue);
    if (saved) return saved;
    if (savedValue) localStorage.removeItem('ow_page');
    return 'digitalEmployees';
  } catch { return 'digitalEmployees'; }
};
export const loadTrafficEntryView = (): 'publish' | 'accounts' => {
  try { const query = new URLSearchParams(window.location.search); return query.get('page') === 'accountManagement' || query.get('view') === 'accounts' ? 'accounts' : 'publish'; }
  catch { return 'publish'; }
};
export const pagePreferenceScope = (session: AuthSession) => `${session.tenant?.id || session.user.tenantId}:${session.user.id}`;
