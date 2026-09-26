import { pushProductionLocation, requestProductionBack } from './lib/productionNavigation';
import { isAgentProductionSession } from './lib/agentProductionSession';
import { Activity, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import AuthScreen from './components/AuthScreen';
import { authApi, getToken, type AuthSession } from './lib/auth';
import { isEnterpriseHomepageDemoAccount } from './mocks/enterpriseHomepageDemo';
import { completeDemoStep, setDemoProgressScope } from './lib/demoProgress';
import AssistLinkPage from './components/AssistLinkPage';
import LegalPages from './components/LegalPages';
import { isSocialTaskContextPage } from './lib/socialTaskContext';
import {
  SOCIAL_CONTENT_NAVIGATION_EVENT,
  attachSocialContentNavigationState,
  readSocialContentNavigationTaskId,
  type SocialContentNavigationEventDetail,
} from './lib/socialContentContext';
import { StarterWorkspaceRequestError, shouldBypassStarter198Probe, starterWorkspaceApi } from './lib/starterWorkspace';
import { PAGE_REGISTRY, SOCIAL_PROGRAM_NAV_PAGES, resolveNavigationPage, resolvePage, type LegacyTrafficView, type Page } from './pageRegistry';
import { SocialProgramProvider } from './contexts/SocialProgramContext';
import { PageErrorBoundary, PageLoading } from './components/AppPageBoundary';
import { AGENT_PAGES, ROLE_PAGE_ACCESS, customerUnifiedAgent, firstUserText, isAdminSession, isExternalCustomerServiceDemoSession, isLocalCustomerReplyLab, loadConvs, loadPage, loadTrafficEntryView, pagePreferenceScope, type AgentAction, type AgentType, type Conversation, type ConversationContext, type KickoffSignal, type Message, type RestoreSignal, type StarterAccessState } from './appSession';

// 业务页面体积较大（尤其智能素材与灵感大屏），仅在用户真正进入时下载和解析。
// 避免登录后一次性解析所有页面造成主线程长任务，表现为浏览器“页面无响应”。
const PlatformAdsPage = lazy(() => import('./components/PlatformAdsPage'));
const StrategyPage = lazy(() => import('./components/StrategyPage'));
const TrafficPage = lazy(() => import('./components/TrafficPage'));
const SocialMonitoringPage = lazy(() => import('./components/SocialMonitoringPage'));
const WeComCustomerServicePage = lazy(() => import('./components/WeComCustomerServicePage'));
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
const StarterWorkspacePage = lazy(() => import('./components/starter/StarterWorkspacePage'));
const SocialContentPlanningPage = lazy(() => import('./components/socialContent/SocialContentPlanningPage'));
const SocialWorkspacePage = lazy(() => import('./components/socialProgram/SocialWorkspacePage'));
const SocialSetupPage = lazy(() => import('./components/socialProgram/SocialSetupPage'));
const SocialAccountsPage = lazy(() => import('./components/socialProgram/SocialAccountsPage'));
const SocialPlanningPage = lazy(() => import('./components/socialProgram/SocialPlanningPage'));
const SocialTaskContextBar = lazy(() => import('./components/starter/SocialTaskContextBar'));
const StarterWorkflowContextBar = lazy(() => import('./components/starter/StarterWorkflowContextBar'));
const DesignPrototype = lazy(() => import('./dev/DesignPrototype'));
const StartupHubPage = lazy(() => import('./components/StartupHubPage'));

export type { Page } from './pageRegistry';
export type { AgentAction, AgentType, Conversation, ConversationContext, KickoffSignal, Message, RestoreSignal, Source } from './appSession';

export default function App() {
  const publicPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (publicPath === '/startup-hub-preview') {
    return (
      <Suspense fallback={<PageLoading />}>
        <StartupHubPage preview />
      </Suspense>
    );
  }
  if (publicPath === '/design-prototype') {
    return (
      <Suspense fallback={<PageLoading />}>
        <DesignPrototype />
      </Suspense>
    );
  }
  if (publicPath.startsWith('/assist/')) return <AssistLinkPage />;
  if (publicPath === '/privacy') return <LegalPages kind="privacy" />;
  if (publicPath === '/terms') return <LegalPages kind="terms" />;
  if (publicPath === '/data-deletion') return <LegalPages kind="data-deletion" />;
  const isRegistrationEntry = window.location.pathname === '/register' &&
    Boolean(new URLSearchParams(window.location.search).get('invite')?.trim());
  const [page, setPage] = useState<Page>(loadPage);
  const [trafficEntryView, setTrafficEntryView] = useState<'publish' | 'accounts'>(loadTrafficEntryView);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [socialContentNavigation, setSocialContentNavigation] = useState<{
    page: Page;
    taskId: string;
  } | null>(() => {
    const initialPage = loadPage();
    if (!isSocialTaskContextPage(initialPage)) return null;
    const taskId = readSocialContentNavigationTaskId(initialPage, window.history.state);
    return taskId ? { page: initialPage, taskId } : null;
  });
  const [monitorMounted, setMonitorMounted] = useState(() => loadPage() === 'agentMonitor');
  useEffect(() => { if (page === 'agentMonitor') setMonitorMounted(true); }, [page]);
  useEffect(() => {
    document.title = `${PAGE_REGISTRY[page].canonicalTitle} · 灵枢 AI`;
  }, [page]);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, productionPage: pageRef.current, productionDepth: 0 }, '');
    const restorePage = (event: PopStateEvent) => {
      const previous = resolveNavigationPage(event.state?.productionPage, event.state?.productionDetail?.view);
      if (previous) {
        if (previous === 'traffic') setTrafficEntryView(event.state?.productionDetail?.view === 'accounts' ? 'accounts' : 'publish');
        setPage(previous);
        const socialTaskId = isSocialTaskContextPage(previous)
          ? readSocialContentNavigationTaskId(previous, event.state)
          : null;
        setSocialContentNavigation(socialTaskId ? { page: previous, taskId: socialTaskId } : null);
        if (event.state?.productionDetail) {
          const detail = event.state.productionDetail;
          try { sessionStorage.setItem('digitalEmployee.businessDeepLink', JSON.stringify({ ...detail, issuedAt: Date.now() })); } catch { /* optional storage */ }
          window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { ...detail, restoreHistory: true } }));
        } else {
          try { sessionStorage.removeItem('digitalEmployee.businessDeepLink'); } catch { /* optional storage */ }
          // A generic history entry is also authoritative: notify the page
          // coordinator so it clears any task binding from the newer entry.
          window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: previous, restoreHistory: true } }));
        }
      }
    };
    const back = () => {
      if (window.history.state?.productionDepth > 0) window.history.back();
      else {
        setSocialContentNavigation(null);
        setPage('digitalEmployees');
      }
    };
    window.addEventListener('popstate', restorePage);
    window.addEventListener('lingshu:back', back);
    return () => { window.removeEventListener('popstate', restorePage); window.removeEventListener('lingshu:back', back); };
  }, []);
  useEffect(() => {
    const syncSocialNavigation = (event: Event) => {
      const detail = (event as CustomEvent<SocialContentNavigationEventDetail>).detail;
      const targetPage = resolvePage(detail?.page);
      if (!targetPage || !isSocialTaskContextPage(targetPage) || !detail?.taskId) return;
      setSocialContentNavigation({ page: targetPage, taskId: detail.taskId });
    };
    window.addEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT, syncSocialNavigation);
    return () => window.removeEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT, syncSocialNavigation);
  }, []);
  const [smartAssetsMounted, setSmartAssetsMounted] = useState(() => {
    if (loadPage() !== 'smartAssets') return false;
    const detail = window.history.state?.productionDetail;
    return Boolean(
      readSocialContentNavigationTaskId('smartAssets', window.history.state)
      || window.__agentProductionTarget?.link.page === 'smartAssets'
      || detail?.workflowTaskId
      || detail?.businessRef?.entityId,
    );
  });
  const [conversation, setConversation] = useState<ConversationContext | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);
  const [smartAssetsView, setSmartAssetsView] = useState<'create' | 'publish'>(() => {
    const target = window.__agentProductionTarget;
    if (target?.link.page === 'smartAssets') return target.link.view || 'create';
    const detail = window.history.state?.productionDetail;
    return loadPage() === 'smartAssets' && detail?.page === 'smartAssets' && detail.view === 'publish' ? 'publish' : 'create';
  });
  const [smartAssetsInstanceKey, setSmartAssetsInstanceKey] = useState(0);
  const [smartAssetsWorkflowContext, setSmartAssetsWorkflowContext] = useState<{ runId: string; taskId: string; taskKey: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string } | null>(() => {
    const target = window.__agentProductionTarget;
    if (target?.link.page === 'smartAssets') return { runId: target.link.runId, taskId: target.link.taskId, taskKey: target.link.businessRef.taskKey, entityId: target.projectId };
    const detail = window.history.state?.productionDetail;
    if (loadPage() !== 'smartAssets' || detail?.page !== 'smartAssets') return null;
    const runId = String(detail.workflowRunId || '');
    const taskId = String(detail.workflowTaskId || '');
    return runId && taskId || detail.businessRef?.entityId ? { runId, taskId, taskKey: String(detail.businessRef?.taskKey || ''), entityId: detail.businessRef?.entityId, contentId: detail.businessRef?.contentId, referenceId: detail.businessRef?.referenceId } : null;
  });

  useEffect(() => {
    if (page === 'smartAssets' && (
      socialContentNavigation?.page === 'smartAssets'
      || smartAssetsWorkflowContext
    )) setSmartAssetsMounted(true);
  }, [page, smartAssetsWorkflowContext, socialContentNavigation]);
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
  const [sessionRefreshError, setSessionRefreshError] = useState('');
  const [starterAccess, setStarterAccess] = useState<StarterAccessState>('loading');
  const [starterAccessError, setStarterAccessError] = useState('');
  const [starterProbeRetry, setStarterProbeRetry] = useState(0);

  const progressScopeFor = (s: AuthSession | null) => s?.demo?.guideScope || (s?.demo?.expiresAt ? `${s.user.id}:${s.demo.expiresAt}` : s?.user?.id || s?.tenant?.id || null);

  useEffect(() => {
    if (isRegistrationEntry) {
      setAuthLoading(false);
      return;
    }
    authApi.me().then(s => {
      setDemoProgressScope(progressScopeFor(s));
      setSession(s);
      setSessionRefreshError('');
    }).catch(() => {
      setSessionRefreshError('暂时无法连接服务，登录状态未被清除。');
    }).finally(() => setAuthLoading(false));
  }, [isRegistrationEntry]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      authApi.me().then(s => {
        setDemoProgressScope(progressScopeFor(s));
        setSession(s);
        setSessionRefreshError('');
      }).catch(() => {
        setSessionRefreshError('网络或服务暂时不可用，已保留当前登录状态和页面。');
      });
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id]);
  const starterProbeScope = `${session?.tenant?.id || ''}:${session?.user?.id || ''}:${session?.supportAccess?.requestId || ''}`;
  useEffect(() => {
    if (!session) {
      starterWorkspaceApi.clearAll();
      setStarterAccess('loading');
      setStarterAccessError('');
      return;
    }
    // Product profile is server authority. A subscription label can affect
    // presentation, but can never bypass the starter access probe.
    if (shouldBypassStarter198Probe(session)) {
      setStarterAccess('legacy');
      setStarterAccessError('');
      return;
    }
    let cancelled = false;
    setStarterAccess('loading');
    setStarterAccessError('');
    starterWorkspaceApi.get({ force: true }).then(workspace => {
      if (cancelled) return;
      setStarterAccess(workspace.productProfile === 'starter_198' ? 'starter_198' : 'legacy');
    }).catch(error => {
      if (cancelled) return;
      if (
        error instanceof StarterWorkspaceRequestError
        && error.status === 403
        && (error.code === 'profile_not_enabled' || error.code === 'starter_198_not_provisioned')
      ) {
        setStarterAccess('legacy');
        return;
      }
      setStarterAccessError(error instanceof Error ? error.message : '工作区权限暂时无法核验');
      setStarterAccess('unavailable');
    });
    return () => { cancelled = true; };
  }, [starterProbeScope, starterProbeRetry]);
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
    if (starterAccess === 'loading' || starterAccess === 'unavailable') return;
    const role = session.user.role || 'customer_service';
    if (!ROLE_PAGE_ACCESS[role].has(page)) setPage('digitalEmployees');
  }, [page, session, starterAccess]);

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
    const next = p === 'retention' ? 'conversion' : p === 'accountManagement' ? 'traffic' : p;
    if (next === 'traffic') setTrafficEntryView(p === 'accountManagement' ? 'accounts' : 'publish');
    if (next !== pageRef.current) pushProductionLocation(next);
    else window.history.replaceState({
      ...window.history.state,
      productionDetail: undefined,
      socialContentTaskId: undefined,
      socialContentPage: undefined,
    }, '');
    setSocialContentNavigation(null);
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    if (next === 'smartAssets') {
      setSmartAssetsWorkflowContext(null);
      setSmartAssetsView('create');
      try {
        if (localStorage.getItem('ow_video_kickoff') || localStorage.getItem('ow_seedance_kickoff')) {
          setSmartAssetsInstanceKey(current => current + 1);
        }
      } catch { /* ignore */ }
    }
    setPage(next);
    if (next === 'adminDelivery') window.history.replaceState(window.history.state, '', '/admin/delivery');
    else if (window.location.pathname === '/admin/delivery') window.history.replaceState(window.history.state, '', '/');
  }, []);

  const handleSocialContentNavigate = useCallback((p: Page, taskId: string) => {
    const next = p === 'retention' ? 'conversion' : p;
    pushProductionLocation(next, {
      socialContentTaskId: taskId,
      socialContentPage: next,
      productionDetail: {
        socialContentTaskId: taskId,
        socialContentPage: next,
      },
    });
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    if (next === 'smartAssets') {
      setSmartAssetsWorkflowContext(null);
      setSmartAssetsView('create');
    }
    setPage(next);
    attachSocialContentNavigationState(taskId, next);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const incomingDetail = (event as CustomEvent<{
        restoreHistory?: boolean;
        page?: Page;
        view?: LegacyTrafficView;
        studioPanel?: 'projects';
        workflowRunId?: string;
        workflowTaskId?: string;
        socialContentTaskId?: string;
        socialContentPage?: string;
        businessRef?: { taskKey?: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string };
      }>).detail;
      const nextPage = resolveNavigationPage(incomingDetail?.page, incomingDetail?.view);
      if (!nextPage || !incomingDetail) return;
      if (nextPage === 'traffic') setTrafficEntryView(incomingDetail.view === 'accounts' ? 'accounts' : 'publish');
      const detail = nextPage === incomingDetail.page
        ? incomingDetail
        : { ...incomingDetail, page: nextPage };
      if (!detail.restoreHistory) {
        if (nextPage === pageRef.current && detail.workflowTaskId) pushProductionLocation(nextPage);
        handleNavigate(nextPage);
        window.history.replaceState({ ...window.history.state, productionDetail: detail }, '');
        const socialTaskId = String(detail.socialContentTaskId || '').trim();
        if (socialTaskId && isSocialTaskContextPage(nextPage)
          && (!detail.socialContentPage || detail.socialContentPage === nextPage)) {
          attachSocialContentNavigationState(socialTaskId, nextPage);
        }
      }
      if (nextPage === 'smartAssets') {
        setSmartAssetsView(detail.view === 'publish' ? 'publish' : 'create');
        if (detail.studioPanel === 'projects') setOpenProjectsSignal(current => current + 1);
        const runId = String(detail.workflowRunId || '').trim();
        const taskId = String(detail.workflowTaskId || '').trim();
        const taskKey = String(detail.businessRef?.taskKey || '').trim();
        const preview = detail.businessRef?.preview === true;
        if ((runId && taskId) || detail.businessRef?.entityId || (preview && taskKey)) {
          setSmartAssetsWorkflowContext({ runId, taskId, taskKey, entityId: detail.businessRef?.entityId, contentId: detail.businessRef?.contentId, referenceId: detail.businessRef?.referenceId, ...(preview ? { preview: true } : {}) });
        } else setSmartAssetsWorkflowContext(null);
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
        setSocialContentNavigation(null);
        setPage('digitalEmployees');
      }
    } catch { /* ignore browser persistence failures */ }
    setDemoProgressScope(progressScopeFor(s));
    starterWorkspaceApi.clearAll();
    setStarterAccess('loading');
    setSessionRefreshError('');
    setSession(s);
  };
  const refreshSession = async () => {
    try {
      const latest = await authApi.me();
      if (!latest) {
        setDemoProgressScope(null);
        starterWorkspaceApi.clearAll();
        setSession(null);
        setSessionRefreshError('');
        return;
      }
      setDemoProgressScope(progressScopeFor(latest));
      setSession(latest);
      setSessionRefreshError('');
    } catch {
      setSessionRefreshError('网络或服务暂时不可用，已保留当前登录状态和页面。');
    }
  };
  const handleLogout = () => {
    authApi.logout();
    setDemoProgressScope(null);
    starterWorkspaceApi.clearAll();
    setStarterAccess('loading');
    setSessionRefreshError('');
    setSocialContentNavigation(null);
    setSession(null);
  };
  const handleSupportSessionStarted = (supportSession: AuthSession) => {
    setDemoProgressScope(progressScopeFor(supportSession));
    starterWorkspaceApi.clearAll();
    setSession(supportSession);
    setConversation(null);
    setRestore(null);
    setKickoff(null);
    setSocialContentNavigation(null);
    setPage('digitalEmployees');
  };

  if (isRegistrationEntry) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }
  if (authLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!session && sessionRefreshError && getToken()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base font-semibold text-slate-900">服务连接暂时中断</p>
          <p className="mt-2 text-sm text-slate-600">{sessionRefreshError} 请重试；不会因为一次服务抖动清除登录凭据。</p>
          <button type="button" onClick={() => { setAuthLoading(true); void refreshSession().finally(() => setAuthLoading(false)); }} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">重新连接</button>
        </div>
      </div>
    );
  }
  if (!session) return <AuthScreen onAuthed={handleAuthed} />;
  if (session.demo?.enabled && session.demo.expired) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface-2 px-6">
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
  if (starterAccess === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface-2">
        <Loader2 size={22} className="animate-spin text-accent" />
        <span className="ml-2 text-sm text-text-muted">正在核验工作区能力……</span>
      </div>
    );
  }
  if (starterAccess === 'unavailable') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface-2 px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-text-primary">工作区能力暂时无法核验</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{starterAccessError || '请稍后重试。在能力边界确认前，系统不会降级打开可写生产页面。'}</p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button type="button" onClick={() => setStarterProbeRetry(value => value + 1)} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white">重新核验</button>
            <button type="button" onClick={handleLogout} className="rounded-lg border border-border bg-white px-4 py-2 text-xs font-semibold text-text-secondary">退出登录</button>
          </div>
        </div>
      </div>
    );
  }

  const starterMode = starterAccess === 'starter_198';
  const activeSocialContentTaskId = isSocialTaskContextPage(page)
    && socialContentNavigation?.page === page
    ? socialContentNavigation.taskId
    : null;
  const showSocialContentPlanning = page === 'smartAssets'
    && smartAssetsView === 'create'
    && !activeSocialContentTaskId
    && !smartAssetsWorkflowContext;
  const isSocialProgramPage = (SOCIAL_PROGRAM_NAV_PAGES as readonly Page[]).includes(page);

  return (
    <Layout page={page} onNavigate={handleNavigate} conversation={conversation} session={session} onLogout={handleLogout}
      starterMode={starterMode}
      onSessionUpdate={setSession}
      demoGuideActive={false}
      conversations={conversations} activeConvId={activeConvId} onOpenConversation={openConversation} onNewConversation={newConversation}
      suppressRightPanel={starterMode || scriptPanelOpen} onAction={startAgentTask}>
      <Suspense fallback={null}>
        {!starterMode && !isAgentProductionSession() && <GlobalAssistant
          page={page}
          restore={restore}
          kickoff={kickoff}
          suppressForRightSidebar={scriptPanelOpen || conversation !== null || page === 'agentMonitor'}
          onKickoffConsumed={() => setKickoff(null)}
          onAction={startAgentTask}
          onSessionRefresh={() => void refreshSession()}
        />}
      </Suspense>
      {sessionRefreshError && <div role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">{sessionRefreshError} <button type="button" className="ml-2 font-semibold underline" onClick={() => void refreshSession()}>立即重试</button></div>}
      {!isAgentProductionSession() && page !== 'agentMonitor' && window.history.state?.productionDepth > 0 && <button type="button" onClick={requestProductionBack} className="shrink-0 border-b bg-white px-5 py-2 text-left text-sm font-semibold text-blue-700">← 返回上一页</button>}
      {starterMode && isSocialTaskContextPage(page) && (
        <Suspense fallback={null}>
          <SocialTaskContextBar
            page={page}
            view={page === 'smartAssets' ? smartAssetsView : undefined}
            onNavigate={handleNavigate}
          />
        </Suspense>
      )}
      {starterMode && page !== 'digitalEmployees' && !isSocialTaskContextPage(page) && (
        <Suspense fallback={null}>
          <StarterWorkflowContextBar page={page} onNavigate={handleNavigate} />
        </Suspense>
      )}
      <div data-app-page-slot className="min-h-0 flex-1 overflow-hidden">
        <PageErrorBoundary page={page} onNavigateHome={() => handleNavigate('digitalEmployees')}>
          <Suspense fallback={<PageLoading />}>
          <Activity key={pagePreferenceScope(session)} mode={page === 'digitalEmployees' ? 'visible' : 'hidden'}>
            {starterMode
              ? <StarterWorkspacePage onNavigate={handleNavigate} onNavigateWithTask={handleSocialContentNavigate} />
              : <DigitalEmployeePage onViewResults={() => handleNavigate('strategy')} onNavigate={handleNavigate} onOpenMonitor={() => handleNavigate('agentMonitor')} />}
          </Activity>
          {monitorMounted && <Activity key={`monitor-${pagePreferenceScope(session)}`} mode={page === 'agentMonitor' ? 'visible' : 'hidden'}><AgentMonitorPage onBack={requestProductionBack} /></Activity>}
          {isSocialProgramPage && (
            <SocialProgramProvider scope={session.tenant?.id || session.user.tenantId}>
              {page === 'socialWorkspace' && <SocialWorkspacePage onNavigate={handleNavigate} />}
              {page === 'socialSetup' && <SocialSetupPage onNavigate={handleNavigate} />}
              {page === 'socialAccounts' && <SocialAccountsPage onNavigate={handleNavigate} />}
              {page === 'socialPlanning' && <SocialPlanningPage onNavigate={handleNavigate} />}
            </SocialProgramProvider>
          )}
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
              enterpriseHomepageDemo={isEnterpriseHomepageDemoAccount(session.user.email)}
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
              initialView={trafficEntryView}
              visibleModes={['publish', 'accounts']}
              pageTitle={PAGE_REGISTRY.traffic.canonicalTitle}
              storageScope={session.tenant?.id || session.user.tenantId}
              socialContentTaskId={activeSocialContentTaskId}
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
              pageTitle={PAGE_REGISTRY.socialInspiration.canonicalTitle}
              storageScope={session.tenant?.id || session.user.tenantId}
              socialContentTaskId={activeSocialContentTaskId}
            />
          )}
          {(page === 'smartAssets' || smartAssetsMounted) && (
            <div className={page === 'smartAssets' ? 'h-full min-h-0' : 'hidden'} aria-hidden={page !== 'smartAssets'}>
              {showSocialContentPlanning ? (
                <SocialContentPlanningPage
                  onNavigate={handleNavigate}
                  onNavigateWithTask={handleSocialContentNavigate}
                />
              ) : (
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
                  pageTitle={PAGE_REGISTRY.smartAssets.canonicalTitle}
                  storageScope={session.tenant?.id || session.user.tenantId}
                  workflowContextSignal={smartAssetsWorkflowContext}
                  socialContentTaskId={activeSocialContentTaskId}
                />
              )}
            </div>
          )}
          {page === 'socialMonitoring' && <SocialMonitoringPage onNavigate={handleNavigate} />}
          {page === 'scriptLibrary' && <ScriptLibraryPage socialContentTaskId={activeSocialContentTaskId} />}
          {(['adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged'] as Page[]).includes(page) && <PlatformAdsPage page={page} onNavigate={handleNavigate} />}
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
          {page === 'wecomCustomerService' && <WeComCustomerServicePage />}
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
      </div>
    </Layout>
  );
}
