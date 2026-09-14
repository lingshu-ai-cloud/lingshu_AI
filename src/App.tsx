import { pushProductionLocation, requestProductionBack } from './lib/productionNavigation';
import { isAgentProductionSession } from './lib/agentProductionSession';
import { Activity, Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import AuthScreen from './components/AuthScreen';
import { authApi, type AuthSession } from './lib/auth';
import { completeDemoStep, setDemoProgressScope } from './lib/demoProgress';
import AssistLinkPage from './components/AssistLinkPage';
import LegalPages from './components/LegalPages';

// 业务页面体积较大（尤其智能素材与灵感大屏），仅在用户真正进入时下载和解析。
// 避免登录后一次性解析所有页面造成主线程长任务，表现为浏览器“页面无响应”。
const PlatformAdsPage = lazy(() => import('./components/PlatformAdsPage'));
const StrategyPage = lazy(() => import('./components/StrategyPage'));
const TrafficPage = lazy(() => import('./components/TrafficPage'));
const ConversionPage = lazy(() => import('./components/ConversionPage'));
const OrderManagementPage = lazy(() => import('./components/OrderManagementPage'));
const EnterprisePage = lazy(() => import('./components/EnterprisePage'));
const IntegrationsPage = lazy(() => import('./components/IntegrationsPage'));
const ScheduledPage = lazy(() => import('./components/ScheduledPage'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AdminDeliveryPage = lazy(() => import('./components/AdminDeliveryPage'));
const GlobalAssistant = lazy(() => import('./components/GlobalAssistant'));
const AgentMemoryPage = lazy(() => import('./components/WorkspaceManagementPages').then(module => ({ default: module.AgentMemoryPage })));
const OrganizationPermissionsPage = lazy(() => import('./components/WorkspaceManagementPages').then(module => ({ default: module.OrganizationPermissionsPage })));
const ScriptLibraryPage = lazy(() => import('./components/WorkspaceManagementPages').then(module => ({ default: module.ScriptLibraryPage })));
const DigitalEmployeePage = lazy(() => import('./components/DigitalEmployeePage'));
const AgentMonitorPage = lazy(() => import('./components/AgentMonitorPage'));

export type Page =
  | 'digitalEmployees'
  | 'agentMonitor'
  | 'strategy'
  | 'traffic'
  | 'socialInspiration'
  | 'scriptLibrary'
  | 'smartAssets'
  | 'accountManagement'
  | 'adsOverview'
  | 'adsPlans'
  | 'adsCreatives'
  | 'adsManaged'
  | 'conversion'
  | 'retention'
  | 'orders'
  | 'enterprise'
  | 'plugins'
  | 'scheduled'
  | 'admin'
  | 'adminDelivery'
  | 'channels'
  | 'youtube'
  | 'agentMemory'
  | 'organizationPermissions';

export type AgentType = 'strategy' | 'traffic' | 'conversion' | 'retention';

export interface Source { title: string; uri: string }
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

export interface ConversationContext {
  agent: AgentType;
  messages?: Message[];
}

export interface Conversation {
  id: string;
  agent: AgentType;
  title: string;
  messages: Message[];
  updatedAt: number;
}
export interface RestoreSignal { agent: AgentType; messages: Message[]; key: string }
export interface KickoffSignal { text: string; key: string }
export type AgentAction = (agent: AgentType, task: string) => void;

const AGENT_PAGES: Page[] = ['strategy', 'traffic', 'conversion', 'retention'];
const ROLE_PAGE_ACCESS: Record<import('./lib/auth').OrganizationRole, Set<Page>> = {
  super_admin: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'conversion', 'retention', 'orders', 'enterprise', 'agentMemory', 'plugins', 'organizationPermissions', 'scheduled', 'admin', 'adminDelivery', 'channels', 'youtube']),
  admin: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'conversion', 'retention', 'orders', 'enterprise', 'agentMemory', 'plugins', 'organizationPermissions', 'scheduled', 'channels', 'youtube']),
  social_operator: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'scheduled']),
  customer_service: new Set(['digitalEmployees', 'agentMonitor', 'strategy', 'conversion', 'retention', 'orders', 'scheduled']),
};
const ALL_PAGES: Page[] = [
  'digitalEmployees', 'agentMonitor', 'strategy', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged',
  'conversion', 'retention', 'orders', 'enterprise', 'agentMemory', 'plugins',
  'organizationPermissions', 'scheduled', 'admin', 'adminDelivery', 'channels', 'youtube',
];
const isAdminSession = (session: AuthSession | null) => Boolean(session && !session.supportAccess && (
  session.user.email === 'lingshu-admin@local.test' ||
  session.tenant?.subscriptionPlan === 'admin' ||
  session.subscription?.plan === 'admin'
));
const EXTERNAL_CUSTOMER_SERVICE_DEMO_EMAILS = new Set([
  'customer-demo@lingshu.site',
  'wenlantianxia-test@local.test',
]);
const isExternalCustomerServiceDemoSession = (session: AuthSession | null) => (
  Boolean(session && EXTERNAL_CUSTOMER_SERVICE_DEMO_EMAILS.has(session.user.email.trim().toLowerCase()))
);
const isLocalCustomerReplyLab = () => (
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
  window.location.pathname.replace(/\/+$/, '') === '/customer-reply-lab'
);
const firstUserText = (msgs?: Message[]) => (msgs?.find(m => m.role === 'user')?.content ?? '新会话').slice(0, 24);
const customerUnifiedAgent = (agent: AgentType): AgentType => (agent === 'retention' ? 'conversion' : agent);
const loadConvs = (): Conversation[] => {
  try { return JSON.parse(localStorage.getItem('ow_convs') || '[]'); } catch { return []; }
};
const loadPage = (): Page => {
  try {
    if (window.location.pathname === '/admin/delivery') return 'adminDelivery';
    const queryPage = new URLSearchParams(window.location.search).get('page') as Page | null;
    if (queryPage && ALL_PAGES.includes(queryPage)) return queryPage === 'retention' ? 'conversion' : queryPage;
    const saved = localStorage.getItem('ow_page') as Page | null;
    if (saved && ALL_PAGES.includes(saved)) return saved === 'retention' ? 'conversion' : saved;
    if (saved) localStorage.removeItem('ow_page');
    return 'digitalEmployees';
  } catch { return 'digitalEmployees'; }
};

const pagePreferenceScope = (session: AuthSession) =>
  `${session.tenant?.id || session.user.tenantId}:${session.user.id}`;

function PageLoading() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-white">
      <Loader2 size={20} className="animate-spin text-text-muted" />
    </div>
  );
}

function isChunkLoadError(error: unknown): boolean {
  const text = String(error instanceof Error ? `${error.name} ${error.message}` : error || '').toLowerCase();
  return text.includes('failed to fetch dynamically imported module') ||
    text.includes('loading chunk') ||
    text.includes('chunkloaderror') ||
    text.includes('importing a module script failed');
}

class PageErrorBoundary extends Component<
  { page: Page; onNavigateHome: () => void; children: ReactNode },
  { error: Error | null; resetKey: Page }
> {
  state = { error: null as Error | null, resetKey: this.props.page };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { page: Page }, state: { error: Error | null; resetKey: Page }) {
    if (props.page !== state.resetKey) return { error: null, resetKey: props.page };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info);
    if (!isChunkLoadError(error)) return;
    const retryKey = `ow_chunk_retry:${this.props.page}`;
    try {
      if (sessionStorage.getItem(retryKey)) return;
      sessionStorage.setItem(retryKey, '1');
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-text-primary">页面加载异常</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            当前页面资源没有正确加载，请重新加载页面；如果仍然异常，可以先返回首页继续使用。
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-semibold"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={this.props.onNavigateHome}
              className="px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-text-secondary"
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  const publicPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (publicPath.startsWith('/assist/')) return <AssistLinkPage />;
  if (publicPath === '/privacy') return <LegalPages kind="privacy" />;
  if (publicPath === '/data-deletion') return <LegalPages kind="data-deletion" />;

  const isRegistrationEntry = window.location.pathname === '/register' &&
    Boolean(new URLSearchParams(window.location.search).get('invite')?.trim());
  const [page, setPage] = useState<Page>(loadPage);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [monitorMounted, setMonitorMounted] = useState(() => loadPage() === 'agentMonitor');
  useEffect(() => { if (page === 'agentMonitor') setMonitorMounted(true); }, [page]);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, productionPage: pageRef.current, productionDepth: 0 }, '');
    const restorePage = (event: PopStateEvent) => {
      const previous = event.state?.productionPage;
      if (ALL_PAGES.includes(previous)) {
        setPage(previous);
        if (event.state?.productionDetail) {
          const detail = event.state.productionDetail;
          try { sessionStorage.setItem('digitalEmployee.businessDeepLink', JSON.stringify({ ...detail, issuedAt: Date.now() })); } catch { /* optional storage */ }
          window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { ...detail, restoreHistory: true } }));
        }
      }
    };
    const back = () => {
      if (window.history.state?.productionDepth > 0) window.history.back();
      else setPage('digitalEmployees');
    };
    window.addEventListener('popstate', restorePage);
    window.addEventListener('lingshu:back', back);
    return () => { window.removeEventListener('popstate', restorePage); window.removeEventListener('lingshu:back', back); };
  }, []);
  const [smartAssetsMounted, setSmartAssetsMounted] = useState(() => loadPage() === 'smartAssets');
  const [conversation, setConversation] = useState<ConversationContext | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);
  const [smartAssetsView, setSmartAssetsView] = useState<'create' | 'publish'>(() => {
    const target = window.__agentProductionTarget;
    if (target?.link.page === 'smartAssets') return target.link.view || 'create';
    const detail = window.history.state?.productionDetail;
    return loadPage() === 'smartAssets' && detail?.page === 'smartAssets' && detail.view === 'publish' ? 'publish' : 'create';
  });
  const [smartAssetsInstanceKey, setSmartAssetsInstanceKey] = useState(0);
  const [smartAssetsWorkflowContext, setSmartAssetsWorkflowContext] = useState<{ runId: string; taskId: string; taskKey: string; preview?: boolean; entityId?: string } | null>(() => {
    const target = window.__agentProductionTarget;
    if (target?.link.page === 'smartAssets') return { runId: target.link.runId, taskId: target.link.taskId, taskKey: target.link.businessRef.taskKey, entityId: target.projectId };
    const detail = window.history.state?.productionDetail;
    if (loadPage() !== 'smartAssets' || detail?.page !== 'smartAssets') return null;
    const runId = String(detail.workflowRunId || '');
    const taskId = String(detail.workflowTaskId || '');
    return runId && taskId || detail.businessRef?.entityId ? { runId, taskId, taskKey: String(detail.businessRef?.taskKey || ''), entityId: detail.businessRef?.entityId } : null;
  });

  useEffect(() => {
    if (page === 'smartAssets') setSmartAssetsMounted(true);
  }, [page]);
  const [openProjectsSignal, setOpenProjectsSignal] = useState(0);

  // 会话历史（本地持久化，供全局助手恢复旧内容）
  const [conversations, setConversations] = useState<Conversation[]>(loadConvs);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreSignal | null>(null);
  const [kickoff, setKickoff] = useState<{ agent: AgentType; text: string; key: string } | null>(null);
  const convsRef = useRef<Conversation[]>(conversations);
  const activeIdRef = useRef<string | null>(null);
  const persist = (list: Conversation[]) => {
    convsRef.current = list; setConversations(list);
    try { localStorage.setItem('ow_convs', JSON.stringify(list.slice(0, 20))); } catch { /* ignore */ }
  };

  // 账号会话
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const progressScopeFor = (s: AuthSession | null) => s?.demo?.guideScope || (s?.demo?.expiresAt ? `${s.user.id}:${s.demo.expiresAt}` : s?.user?.id || s?.tenant?.id || null);

  useEffect(() => {
    if (isRegistrationEntry) {
      setAuthLoading(false);
      return;
    }
    authApi.me().then(s => {
      setDemoProgressScope(progressScopeFor(s));
      setSession(s);
      setAuthLoading(false);
    });
  }, [isRegistrationEntry]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      authApi.me().then(s => {
        setDemoProgressScope(progressScopeFor(s));
        setSession(s);
      });
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id]);
  useEffect(() => {
    try {
      localStorage.setItem('ow_page', page);
      if (window.location.pathname === '/') {
        const url = new URL(window.location.href);
        url.searchParams.set('page', page);
        window.history.replaceState(window.history.state, '', url);
      }
    } catch { /* ignore */ }
  }, [page]);
  useEffect(() => {
    if (session && (page === 'admin' || page === 'adminDelivery') && !isAdminSession(session)) setPage('digitalEmployees');
  }, [page, session]);
  useEffect(() => {
    if (!session) return;
    const role = session.user.role || 'super_admin';
    if (!ROLE_PAGE_ACCESS[role].has(page)) setPage('digitalEmployees');
  }, [page, session]);

  // 每次对话推进都记录/更新会话历史
  const enterConversation = (ctx: ConversationContext) => {
    if (ctx.messages?.some(msg => msg.role === 'assistant' && msg.content.trim().length > 12)) {
      if (ctx.agent === 'strategy') completeDemoStep('strategy');
      if (ctx.agent === 'conversion') completeDemoStep('conversion');
      if (ctx.agent === 'retention') completeDemoStep('retention');
    }
    setConversation(ctx);
    if (!ctx.messages?.length) {
      activeIdRef.current = null;
      setActiveConvId(null);
      setRestore({ agent: ctx.agent, messages: [], key: `open:${ctx.agent}:${Date.now()}` });
      setKickoff(null);
      setPage(ctx.agent);
      return;
    }
    let id = activeIdRef.current;
    let list = convsRef.current;
    if (id && list.some(c => c.id === id)) {
      list = list.map(c => c.id === id ? { ...c, messages: ctx.messages!, updatedAt: Date.now() } : c);
    } else {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `c${Date.now()}`;
      list = [{ id, agent: ctx.agent, title: firstUserText(ctx.messages), messages: ctx.messages!, updatedAt: Date.now() }, ...list];
      activeIdRef.current = id; setActiveConvId(id);
    }
    persist([...list].sort((a, b) => b.updatedAt - a.updatedAt));
  };
  const leaveConversation = () => setConversation(null);

  // 恢复历史会话 → 打开全局助手并载入旧内容
  const openConversation = (id: string) => {
    const conv = convsRef.current.find(c => c.id === id);
    if (!conv) return;
    activeIdRef.current = id; setActiveConvId(id);
    const pageAgent = customerUnifiedAgent(conv.agent);
    setConversation({ agent: pageAgent, messages: conv.messages });
    setRestore({ agent: pageAgent, messages: conv.messages, key: `${id}:${Date.now()}` });
    setKickoff(null);
    setPage(pageAgent);
  };
  const newConversation = () => {
    activeIdRef.current = null; setActiveConvId(null);
    setConversation(null); setKickoff(null);
    if (AGENT_PAGES.includes(page)) setRestore({ agent: page as AgentType, messages: [], key: `new:${Date.now()}` });
  };

  // 一键执行：策略专家把任务交给某个专家，跳转过去并自动发起任务
  const startAgentTask = (agent: AgentType, text: string) => {
    const pageAgent = customerUnifiedAgent(agent);
    activeIdRef.current = null; setActiveConvId(null);
    setRestore(null); setConversation(null);
    setKickoff({ agent: pageAgent, text, key: `k${Date.now()}` });
    if (!AGENT_PAGES.includes(page)) setPage(pageAgent);
  };

  const handleNavigate = useCallback((p: Page) => {
    const next = p === 'retention' ? 'conversion' : p;
    if (next !== pageRef.current) pushProductionLocation(next);
    else window.history.replaceState({ ...window.history.state, productionDetail: undefined }, '');
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    if (p === 'smartAssets') {
      setSmartAssetsWorkflowContext(null);
      setSmartAssetsView('create');
      try {
        if (localStorage.getItem('ow_video_kickoff') || localStorage.getItem('ow_seedance_kickoff')) {
          setSmartAssetsInstanceKey(current => current + 1);
        }
      } catch { /* ignore */ }
    }
    setPage(p === 'retention' ? 'conversion' : p);
    if (p === 'adminDelivery') window.history.replaceState(window.history.state, '', '/admin/delivery');
    else if (window.location.pathname === '/admin/delivery') window.history.replaceState(window.history.state, '', '/');
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        restoreHistory?: boolean;
        page?: Page;
        view?: 'create' | 'publish';
        studioPanel?: 'projects';
        workflowRunId?: string;
        workflowTaskId?: string;
        businessRef?: { taskKey?: string; preview?: boolean; entityId?: string };
      }>).detail;
      const nextPage = detail?.page;
      if (!nextPage || !ALL_PAGES.includes(nextPage)) return;
      if (!detail.restoreHistory) {
        if (nextPage === pageRef.current && detail.workflowTaskId) pushProductionLocation(nextPage);
        handleNavigate(nextPage);
        window.history.replaceState({ ...window.history.state, productionDetail: detail }, '');
      }
      if (nextPage === 'smartAssets') {
        setSmartAssetsView(detail.view === 'publish' ? 'publish' : 'create');
        if (detail.studioPanel === 'projects') setOpenProjectsSignal(current => current + 1);
        const runId = String(detail.workflowRunId || '').trim();
        const taskId = String(detail.workflowTaskId || '').trim();
        const taskKey = String(detail.businessRef?.taskKey || '').trim();
        const preview = detail.businessRef?.preview === true;
        if ((runId && taskId) || detail.businessRef?.entityId || (preview && taskKey)) {
          setSmartAssetsWorkflowContext({ runId, taskId, taskKey, entityId: detail.businessRef?.entityId, ...(preview ? { preview: true } : {}) });
        }
      }
    };
    window.addEventListener('lingshu:navigate', handler);
    return () => window.removeEventListener('lingshu:navigate', handler);
  }, [handleNavigate]);
  const restoreFor = (a: AgentType) => (restore && restore.agent === a ? restore : undefined);
  const kickoffFor = (a: AgentType) => (kickoff && kickoff.agent === a ? { text: kickoff.text, key: kickoff.key } : undefined);

  const handleAuthed = (s: AuthSession) => {
    if (isRegistrationEntry) {
      window.history.replaceState(null, '', '/');
    }
    // `ow_page` is browser-wide. Never carry the previous account's last page
    // into a newly authenticated tenant; a new customer must enter through the
    // operating cockpit and its first-time setup.
    try {
      const nextScope = pagePreferenceScope(s);
      const previousScope = localStorage.getItem('ow_page_scope');
      if (previousScope !== nextScope) {
        localStorage.setItem('ow_page_scope', nextScope);
        localStorage.setItem('ow_page', 'digitalEmployees');
        setPage('digitalEmployees');
      }
    } catch { /* ignore browser persistence failures */ }
    setDemoProgressScope(progressScopeFor(s));
    setSession(s);
  };
  const refreshSession = async () => {
    const latest = await authApi.me();
    if (!latest) {
      setDemoProgressScope(null);
      setSession(null);
      return;
    }
    setDemoProgressScope(progressScopeFor(latest));
    setSession(latest);
  };
  const handleLogout = () => {
    authApi.logout();
    setDemoProgressScope(null);
    setSession(null);
  };
  const handleSupportSessionStarted = (supportSession: AuthSession) => {
    setDemoProgressScope(progressScopeFor(supportSession));
    setSession(supportSession);
    setConversation(null);
    setRestore(null);
    setKickoff(null);
    setPage('digitalEmployees');
  };

  if (isRegistrationEntry) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!session) return <AuthScreen onAuthed={handleAuthed} />;
  if (session.demo?.enabled && session.demo.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-2 px-6">
        <div className="w-full max-w-md rounded-2xl bg-white border border-border p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-text-primary">Demo 试用已到期</p>
          <p className="text-sm text-text-muted mt-2 leading-relaxed">
            当前试用账号已超过 {session.demo.trialDays} 天有效期。请联系服务顾问开通或延长试用。
          </p>
          <button onClick={handleLogout}
            className="mt-5 px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-semibold">
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout page={page} onNavigate={handleNavigate} conversation={conversation} session={session} onLogout={handleLogout}
      onSessionUpdate={setSession}
      demoGuideActive={false}
      conversations={conversations} activeConvId={activeConvId} onOpenConversation={openConversation} onNewConversation={newConversation}
      suppressRightPanel={scriptPanelOpen} onAction={startAgentTask}>
      <Suspense fallback={null}>
        {!isAgentProductionSession() && <GlobalAssistant
          page={page}
          restore={restore}
          kickoff={kickoff}
          suppressForRightSidebar={scriptPanelOpen || conversation !== null || page === 'agentMonitor'}
          onKickoffConsumed={() => setKickoff(null)}
          onAction={startAgentTask}
          onSessionRefresh={() => void refreshSession()}
        />}
      </Suspense>
      {!isAgentProductionSession() && page !== 'agentMonitor' && window.history.state?.productionDepth > 0 && <button type="button" onClick={requestProductionBack} className="shrink-0 border-b bg-white px-5 py-2 text-left text-sm font-semibold text-blue-700">← 返回上一页（保留查看位置）</button>}
      <PageErrorBoundary page={page} onNavigateHome={() => handleNavigate('strategy')}>
        <Suspense fallback={<PageLoading />}>
          <Activity key={pagePreferenceScope(session)} mode={page === 'digitalEmployees' ? 'visible' : 'hidden'}>
            <DigitalEmployeePage onViewResults={() => handleNavigate('strategy')} onNavigate={handleNavigate} onOpenMonitor={() => handleNavigate('agentMonitor')} />
          </Activity>
          {monitorMounted && <Activity key={`monitor-${pagePreferenceScope(session)}`} mode={page === 'agentMonitor' ? 'visible' : 'hidden'}><AgentMonitorPage onBack={requestProductionBack} /></Activity>}
          {page === 'strategy' && (
            <StrategyPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'strategy'}
              restore={restoreFor('strategy')}
              kickoff={kickoffFor('strategy')}
              onAction={startAgentTask}
              onNavigate={handleNavigate}
              onSessionRefresh={() => void refreshSession()}
              includeMockCustomers={import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === 'quote'}
              mockCustomerScope={session.user.email || session.user.id || session.tenant?.id || 'admin'}
            />
          )}
          {page === 'traffic' && (
            <TrafficPage
              key="legacy-traffic"
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'traffic'}
              onNavigate={handleNavigate}
              restore={restoreFor('traffic')}
              kickoff={kickoffFor('traffic')}
              onAction={startAgentTask}
              onScriptPanelOpen={() => setScriptPanelOpen(true)}
              onScriptPanelClose={() => setScriptPanelOpen(false)}
              onSessionRefresh={() => void refreshSession()}
              storageScope={session.tenant?.id || session.user.tenantId}
            />
          )}
          {page === 'socialInspiration' && (
            <TrafficPage
              key="social-inspiration"
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={false}
              onNavigate={handleNavigate}
              onScriptPanelOpen={() => setScriptPanelOpen(true)}
              onScriptPanelClose={() => setScriptPanelOpen(false)}
              initialView="materials"
              showModeTabs={false}
              pageTitle="灵感中心"
              storageScope={session.tenant?.id || session.user.tenantId}
            />
          )}
          {(page === 'smartAssets' || smartAssetsMounted) && (
            <div className={page === 'smartAssets' ? 'h-full' : 'hidden'} aria-hidden={page !== 'smartAssets'}>
              <TrafficPage
                key={`smart-assets-${smartAssetsInstanceKey}`}
                onEnterConversation={enterConversation}
                onLeaveConversation={leaveConversation}
                isInConversation={false}
                onNavigate={handleNavigate}
                onScriptPanelOpen={() => setScriptPanelOpen(true)}
                onScriptPanelClose={() => setScriptPanelOpen(false)}
                initialView={smartAssetsView}
                showModeTabs={false}
                openProjectsSignal={openProjectsSignal}
                pageTitle="内容创作"
                storageScope={session.tenant?.id || session.user.tenantId}
                workflowContextSignal={smartAssetsWorkflowContext}
              />
            </div>
          )}
          {page === 'accountManagement' && (
            <TrafficPage
              key="account-management"
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={false}
              onNavigate={handleNavigate}
              initialView="accounts"
              showModeTabs={false}
              pageTitle="账号管理"
              storageScope={session.tenant?.id || session.user.tenantId}
            />
          )}
          {(['adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged'] as Page[]).includes(page) && <PlatformAdsPage page={page} onNavigate={handleNavigate} />}
          {page === 'scriptLibrary' && <ScriptLibraryPage />}
          {page === 'conversion' && (
            <ConversionPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'conversion'}
              restore={restoreFor('conversion')}
              kickoff={kickoffFor('conversion')}
              onAction={startAgentTask}
              onSessionRefresh={() => void refreshSession()}
              isDemo={false}
              includeMockCustomers={import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === 'quote'}
              mockCustomerScope={session.user.email || session.user.id || session.tenant?.id || 'admin'}
            />
          )}
          {page === 'orders' && <OrderManagementPage />}
          {page === 'enterprise' && <EnterprisePage />}
          {page === 'agentMemory' && (
            <AgentMemoryPage
              includeMockCustomers={import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === 'quote'}
              mockCustomerScope={session.user.email || session.user.id || session.tenant?.id || 'admin'}
            />
          )}
          {page === 'plugins' && <IntegrationsPage />}
          {page === 'organizationPermissions' && <OrganizationPermissionsPage />}
          {page === 'scheduled' && <ScheduledPage onAction={startAgentTask} />}
          {page === 'admin' && <AdminDashboard onSupportSessionStarted={handleSupportSessionStarted} />}
          {page === 'adminDelivery' && <AdminDeliveryPage />}
          {(page === 'channels' || page === 'youtube') && <IntegrationsPage />}
        </Suspense>
      </PageErrorBoundary>
    </Layout>
  );
}
