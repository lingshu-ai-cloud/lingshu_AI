import { pushProductionLocation, requestProductionBack } from './lib/productionNavigation';
import { isAgentProductionSession } from './lib/agentProductionSession';
import { Activity, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import AuthScreen from './components/AuthScreen';
import { authApi, getToken, type AuthSession } from './lib/auth';
import { isEnterpriseHomepageDemoAccount } from './mocks/enterpriseHomepageDemo';
import { isLocalForeignTradeMockEnabled } from './mocks/foreignTradeOperations';
import { completeDemoStep, setDemoProgressScope } from './lib/demoProgress';
import AssistLinkPage from './components/AssistLinkPage';
import LegalPages from './components/LegalPages';
import { isSocialTaskContextPage } from './lib/socialTaskContext';
import {
  SOCIAL_CONTENT_NAVIGATION_EVENT,
  attachSocialContentNavigationState,
  readSocialContentNavigationTaskId,
  setActiveSocialContentTaskId,
  type SocialContentNavigationEventDetail,
} from './lib/socialContentContext';
import { StarterWorkspaceRequestError, shouldBypassStarter198Probe, starterWorkspaceApi } from './lib/starterWorkspace';
import { PAGE_REGISTRY, resolveNavigationPage, resolvePage, type LegacyTrafficView, type Page } from './pageRegistry';
import { SocialProgramProvider } from './contexts/SocialProgramContext';
import { PageErrorBoundary, PageLoading } from './components/AppPageBoundary';
import type { SocialContentCreateRequest } from './components/socialContent/SocialContentWorkspace';
import { AGENT_PAGES, ROLE_PAGE_ACCESS, customerUnifiedAgent, firstUserText, isAdminSession, isExternalCustomerServiceDemoSession, isLocalCustomerReplyLab, loadConvs, loadPage, pagePreferenceScope, type AgentAction, type AgentType, type Conversation, type ConversationContext, type KickoffSignal, type Message, type RestoreSignal, type StarterAccessState } from './appSession';

// 页面仍然拆包，但本地预览会在浏览器空闲时逐个预热这些模块。显式 loader
// 既供 React.lazy 使用，也让预加载和真正进入页面共享同一份浏览器模块缓存。
const loadPlatformAdsPage = () => import('./components/PlatformAdsPage');
const loadStrategyPage = () => import('./components/StrategyPage');
const loadTrafficPage = () => import('./components/TrafficPage');
const loadConversionPage = () => import('./components/ConversionPage');
const loadOrderManagementPage = () => import('./components/OrderManagementPage');
const loadEnterprisePage = () => import('./components/EnterprisePage');
const loadIntegrationsPage = () => import('./components/IntegrationsPage');
const loadScheduledPage = () => import('./components/ScheduledPage');
const loadAdminDashboard = () => import('./components/AdminDashboard');
const loadAdminDeliveryPage = () => import('./components/AdminDeliveryPage');
const loadGlobalAssistant = () => import('./components/GlobalAssistant');
const loadWorkspaceManagementPages = () => import('./components/WorkspaceManagementPages');
const loadDigitalEmployeePage = () => import('./components/DigitalEmployeePage');
const loadAgentMonitorPage = () => import('./components/AgentMonitorPage');
const loadStarterWorkspacePage = () => import('./components/starter/StarterWorkspacePage');
const loadSocialContentPlanningPage = () => import('./components/socialContent/SocialContentPlanningPage');
const loadSocialTaskContextBar = () => import('./components/starter/SocialTaskContextBar');
const loadStarterWorkflowContextBar = () => import('./components/starter/StarterWorkflowContextBar');

const PlatformAdsPage = lazy(loadPlatformAdsPage);
const StrategyPage = lazy(loadStrategyPage);
const TrafficPage = lazy(loadTrafficPage);
const ConversionPage = lazy(loadConversionPage);
const OrderManagementPage = lazy(loadOrderManagementPage);
const EnterprisePage = lazy(loadEnterprisePage);
const IntegrationsPage = lazy(loadIntegrationsPage);
const ScheduledPage = lazy(loadScheduledPage);
const AdminDashboard = lazy(loadAdminDashboard);
const AdminDeliveryPage = lazy(loadAdminDeliveryPage);
const GlobalAssistant = lazy(loadGlobalAssistant);
const AgentMemoryPage = lazy(() => loadWorkspaceManagementPages().then(module => ({ default: module.AgentMemoryPage })));
const OrganizationPermissionsPage = lazy(() => loadWorkspaceManagementPages().then(module => ({ default: module.OrganizationPermissionsPage })));
const ScriptLibraryPage = lazy(() => loadWorkspaceManagementPages().then(module => ({ default: module.ScriptLibraryPage })));
const DigitalEmployeePage = lazy(loadDigitalEmployeePage);
const AgentMonitorPage = lazy(loadAgentMonitorPage);
const StarterWorkspacePage = lazy(loadStarterWorkspacePage);
const SocialContentPlanningPage = lazy(loadSocialContentPlanningPage);
const SocialTaskContextBar = lazy(loadSocialTaskContextBar);
const StarterWorkflowContextBar = lazy(loadStarterWorkflowContextBar);
const DesignPrototype = lazy(() => import('./dev/DesignPrototype'));
const SocialContentPreview = lazy(() => import('./dev/SocialContentPreview'));
const SmartBusinessPreview = lazy(() => import('./dev/SmartBusinessPreview'));
const StartupHubPage = lazy(() => import('./components/StartupHubPage'));

type PageModuleLoader = () => Promise<unknown>;
const ADS_PAGES: Page[] = ['adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged'];
const INTEGRATION_PAGES: Page[] = ['plugins', 'channels', 'youtube'];

const LOCAL_PREVIEW_PAGE_LOADERS: PageModuleLoader[] = [
  loadDigitalEmployeePage,
  loadTrafficPage,
  () => import('./components/AiCreateStudio'),
  () => import('./components/InspirationDashboard'),
  () => import('./components/publishing/CalendarPlanner'),
  loadStrategyPage,
  loadPlatformAdsPage,
  loadConversionPage,
  loadOrderManagementPage,
  loadEnterprisePage,
  loadWorkspaceManagementPages,
  loadIntegrationsPage,
  loadScheduledPage,
  loadAgentMonitorPage,
  loadGlobalAssistant,
  loadAdminDashboard,
  loadAdminDeliveryPage,
  loadStarterWorkspacePage,
  loadSocialContentPlanningPage,
  loadSocialTaskContextBar,
  loadStarterWorkflowContextBar,
];

const isLocalPreviewHost = () => window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

function scheduleLocalPreviewPreload(preferredPage: Page) {
  if (!isLocalPreviewHost()) return () => {};
  const preferredLoaders: Partial<Record<Page, PageModuleLoader[]>> = {
    digitalEmployees: [loadDigitalEmployeePage],
    agentMonitor: [loadAgentMonitorPage],
    strategy: [loadStrategyPage],
    traffic: [loadTrafficPage, () => import('./components/publishing/CalendarPlanner')],
    socialInspiration: [loadTrafficPage, () => import('./components/InspirationDashboard')],
    smartAssets: [loadTrafficPage, () => import('./components/AiCreateStudio'), loadSocialContentPlanningPage],
    socialMonitoring: [loadTrafficPage, () => import('./components/AccountActivity')],
    scriptLibrary: [loadWorkspaceManagementPages],
    adsOverview: [loadPlatformAdsPage],
    adsPlans: [loadPlatformAdsPage],
    adsCreatives: [loadPlatformAdsPage],
    adsManaged: [loadPlatformAdsPage],
    conversion: [loadConversionPage],
    orders: [loadOrderManagementPage],
    enterprise: [loadEnterprisePage],
    agentMemory: [loadWorkspaceManagementPages],
    organizationPermissions: [loadWorkspaceManagementPages],
    plugins: [loadIntegrationsPage],
    channels: [loadIntegrationsPage],
    youtube: [loadIntegrationsPage],
    scheduled: [loadScheduledPage],
    admin: [loadAdminDashboard],
    adminDelivery: [loadAdminDeliveryPage],
  };
  const queue = [...(preferredLoaders[preferredPage] || []), ...LOCAL_PREVIEW_PAGE_LOADERS];
  const uniqueQueue = queue.filter((loader, index) => queue.indexOf(loader) === index);
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;
  let index = 0;

  const scheduleNext = () => {
    if (cancelled || index >= uniqueQueue.length) return;
    const run = () => {
      if (cancelled) return;
      const loader = uniqueQueue[index++];
      void loader().catch(() => {}).finally(scheduleNext);
    };
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(run, { timeout: 1_500 });
    } else {
      timeoutId = globalThis.setTimeout(run, 160);
    }
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (idleId !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  };
}

export type { Page } from './pageRegistry';
export type { AgentAction, AgentType, Conversation, ConversationContext, KickoffSignal, Message, RestoreSignal, Source } from './appSession';

export default function App() {
  const publicPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const localForeignTradeMock = isLocalForeignTradeMockEnabled();
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
  if (import.meta.env.DEV && publicPath === '/social-content-preview') {
    return (
      <Suspense fallback={<PageLoading />}>
        <SocialContentPreview />
      </Suspense>
    );
  }
  if (import.meta.env.DEV && publicPath === '/smart-business-preview') {
    return (
      <Suspense fallback={<PageLoading />}>
        <SmartBusinessPreview />
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
  const pageRef = useRef(page);
  pageRef.current = page;
  const [mountedPages, setMountedPages] = useState<Set<Page>>(() => new Set<Page>(['digitalEmployees', loadPage()]));
  const mountedPagesRef = useRef(mountedPages);
  mountedPagesRef.current = mountedPages;
  const [lastAdsPage, setLastAdsPage] = useState<Page>(() => {
    const initialPage = loadPage();
    return ADS_PAGES.includes(initialPage) ? initialPage : 'adsOverview';
  });
  useEffect(() => {
    setMountedPages(previous => {
      if (previous.has(page)) return previous;
      const next = new Set(previous);
      next.add(page);
      return next;
    });
  }, [page]);
  useEffect(() => {
    if (ADS_PAGES.includes(page)) setLastAdsPage(page);
  }, [page]);
  useEffect(() => scheduleLocalPreviewPreload(pageRef.current), []);
  const [socialContentNavigation, setSocialContentNavigation] = useState<{
    page: Page;
    taskId: string;
  } | null>(() => {
    const initialPage = loadPage();
    if (!isSocialTaskContextPage(initialPage)) return null;
    const taskId = readSocialContentNavigationTaskId(initialPage, window.history.state);
    return taskId ? { page: initialPage, taskId } : null;
  });
  useEffect(() => {
    document.title = `${PAGE_REGISTRY[page].canonicalTitle} · 灵枢 AI`;
  }, [page]);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, productionPage: pageRef.current, productionDepth: 0 }, '');
    const restorePage = (event: PopStateEvent) => {
      const previous = resolveNavigationPage(event.state?.productionPage, event.state?.productionDetail?.view);
      if (previous) {
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
  const [smartAssetsCreateRequest, setSmartAssetsCreateRequest] = useState<SocialContentCreateRequest | null>(() => {
    const detail = window.history.state?.productionDetail;
    return loadPage() === 'smartAssets' && detail?.page === 'smartAssets' ? detail.contentCreationRequest || null : null;
  });
  const [smartAssetsStudioOpen, setSmartAssetsStudioOpen] = useState(() => {
    const detail = window.history.state?.productionDetail;
    return Boolean(new URLSearchParams(window.location.search).get('project') || detail?.directStudio);
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
    const next = resolvePage(p) || 'digitalEmployees';
    if (next !== pageRef.current) pushProductionLocation(next);
    else window.history.replaceState({
      ...window.history.state,
      productionDetail: undefined,
      socialContentTaskId: undefined,
      socialContentPage: undefined,
    }, '');
    // 普通侧栏切页不清除当前内容任务绑定。绑定只在对应页面生效，离开时不会
    // 泄漏到其他页面；回来后则可恢复同一个制作任务和最后操作节点。
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    // 首次进入内容制作时使用默认入口；已经操作过的制作页再次点开时，
    // 保留项目、制作节点和右栏状态，不再被侧栏导航清回初始页。
    if (next === 'smartAssets' && !mountedPagesRef.current.has('smartAssets')) {
      setSmartAssetsWorkflowContext(null);
      setSmartAssetsCreateRequest(null);
      setSmartAssetsStudioOpen(false);
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
      setSmartAssetsStudioOpen(true);
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
        socialContentView?: 'managed';
        studioEntry?: boolean;
        directStudio?: boolean;
        businessRef?: { taskKey?: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string };
        contentCreationRequest?: SocialContentCreateRequest;
      }>).detail;
      const nextPage = resolveNavigationPage(incomingDetail?.page, incomingDetail?.view);
      if (!nextPage || !incomingDetail) return;
      const detail = nextPage === incomingDetail.page
        ? incomingDetail
        : { ...incomingDetail, page: nextPage };
      if (!detail.restoreHistory) {
        if (nextPage === pageRef.current && detail.workflowTaskId) pushProductionLocation(nextPage);
        handleNavigate(incomingDetail.page === 'socialSetup' || incomingDetail.page === 'socialAccounts' || incomingDetail.page === 'accountManagement' ? incomingDetail.page : nextPage);
        const opensCreationWorkbench = nextPage === 'smartAssets'
          && Boolean(detail.contentCreationRequest)
          && !detail.socialContentTaskId
          && detail.directStudio !== true;
        const nextHistoryState = { ...window.history.state };
        if (opensCreationWorkbench) {
          setSocialContentNavigation(null);
          setActiveSocialContentTaskId(null);
          delete nextHistoryState.socialContentTaskId;
          delete nextHistoryState.socialContentPage;
        }
        if (nextPage === 'smartAssets' && detail.contentCreationRequest && !detail.socialContentTaskId) {
          try { localStorage.removeItem('ow_studio_open_project'); } catch { /* ignore */ }
          const freshUrl = new URL(window.location.href);
          freshUrl.searchParams.delete('project');
          window.history.replaceState({ ...nextHistoryState, productionDetail: detail }, '', freshUrl);
        } else window.history.replaceState({ ...nextHistoryState, productionDetail: detail }, '');
        const socialTaskId = String(detail.socialContentTaskId || '').trim();
        if (socialTaskId && isSocialTaskContextPage(nextPage)
          && (!detail.socialContentPage || detail.socialContentPage === nextPage)) {
          attachSocialContentNavigationState(socialTaskId, nextPage);
        }
      }
      if (nextPage === 'smartAssets') {
        setSmartAssetsView(detail.view === 'publish' ? 'publish' : 'create');
        setSmartAssetsCreateRequest(detail.contentCreationRequest || null);
        setSmartAssetsStudioOpen(detail.studioPanel === 'projects'
          || detail.directStudio === true
          || Boolean(detail.contentCreationRequest));
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
  const handleLaunchContentStudio = useCallback((request: SocialContentCreateRequest) => {
    const continueTaskId = String(request.continueTaskId || '').trim();
    setSmartAssetsCreateRequest(request);
    setSmartAssetsStudioOpen(true);
    setSmartAssetsView('create');
    if (continueTaskId) {
      setSocialContentNavigation({ page: 'smartAssets', taskId: continueTaskId });
      attachSocialContentNavigationState(continueTaskId, 'smartAssets');
    }
    const freshUrl = new URL(window.location.href);
    if (request.continueProjectId) freshUrl.searchParams.set('project', request.continueProjectId);
    else freshUrl.searchParams.delete('project');
    window.history.replaceState({
      ...window.history.state,
      ...(continueTaskId ? { socialContentTaskId: continueTaskId, socialContentPage: 'smartAssets' } : {}),
      productionDetail: {
        page: 'smartAssets',
        view: 'create',
        studioEntry: true,
        directStudio: true,
        contentCreationRequest: request,
        ...(continueTaskId ? { socialContentTaskId: continueTaskId, socialContentPage: 'smartAssets' } : {}),
      },
    }, '', freshUrl);
  }, []);
  const handleOpenContentCreationHome = useCallback((openChooser = false) => {
    setSocialContentNavigation(null);
    setActiveSocialContentTaskId(null);
    setSmartAssetsWorkflowContext(null);
    setSmartAssetsCreateRequest(null);
    setSmartAssetsStudioOpen(false);
    setSmartAssetsView('create');
    handleNavigate('smartAssets');
    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.delete('project');
    const nextHistoryState = { ...window.history.state };
    delete nextHistoryState.socialContentTaskId;
    delete nextHistoryState.socialContentPage;
    window.history.replaceState({
      ...nextHistoryState,
      productionDetail: { page: 'smartAssets', view: 'create' },
    }, '', freshUrl);
    if (openChooser) window.setTimeout(() => window.dispatchEvent(new CustomEvent('lingshu:open-content-creation')), 0);
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
  const smartAssetsContentTaskId = socialContentNavigation?.page === 'smartAssets'
    ? socialContentNavigation.taskId
    : null;
  // 这个判断不能依赖当前是否正显示 smartAssets；否则切去别页时会在隐藏状态下
  // 把“我的创作”和制作工作台互换并卸载，回来后就丢失最后操作位置。
  const showSocialContentPlanning = page === 'smartAssets'
    && smartAssetsView === 'create'
    && !smartAssetsContentTaskId
    && !smartAssetsWorkflowContext
    && !smartAssetsCreateRequest
    && !smartAssetsStudioOpen;


  return (
    <SocialProgramProvider scope={session.tenant?.id || session.user.tenantId} enabled={!starterMode}>
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
          {(page === 'agentMonitor' || mountedPages.has('agentMonitor')) && <Activity key={`monitor-${pagePreferenceScope(session)}`} mode={page === 'agentMonitor' ? 'visible' : 'hidden'}><AgentMonitorPage onBack={requestProductionBack} /></Activity>}
          {(page === 'strategy' || mountedPages.has('strategy')) && (
            <Activity mode={page === 'strategy' ? 'visible' : 'hidden'}>
            <StrategyPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'strategy'}
              restore={restoreFor('strategy')}
              kickoff={kickoffFor('strategy')}
              onAction={startAgentTask}
              onNavigate={handleNavigate}
              onSessionRefresh={() => void refreshSession()}
              includeMockCustomers={localForeignTradeMock}
              mockCustomerScope={localForeignTradeMock && new URLSearchParams(window.location.search).get('mock') !== 'quote'
                ? 'local-foreign-trade-factory'
                : session.user.email || session.user.id || session.tenant?.id || 'admin'}
              enterpriseHomepageDemo={isEnterpriseHomepageDemoAccount(session.user.email)}
            />
            </Activity>
          )}
          {(page === 'traffic' || mountedPages.has('traffic')) && (
            <Activity mode={page === 'traffic' ? 'visible' : 'hidden'}>
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
              initialView="publish"
              visibleModes={['publish']}
              showModeTabs={false}
              pageTitle={PAGE_REGISTRY.traffic.canonicalTitle}
              storageScope={session.tenant?.id || session.user.tenantId}
              socialContentTaskId={activeSocialContentTaskId}
            />
            </Activity>
          )}
          {(page === 'socialInspiration' || mountedPages.has('socialInspiration')) && (
            <Activity mode={page === 'socialInspiration' ? 'visible' : 'hidden'}>
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
            </Activity>
          )}
          {(page === 'smartAssets' || mountedPages.has('smartAssets') || smartAssetsMounted) && (
            <Activity mode={page === 'smartAssets' ? 'visible' : 'hidden'}>
            <div className="h-full min-h-0">
              {showSocialContentPlanning ? (
                <SocialContentPlanningPage
                  onNavigate={handleNavigate}
                  onNavigateWithTask={handleSocialContentNavigate}
                  initialCreateRequest={smartAssetsCreateRequest}
                  onLaunchStudio={handleLaunchContentStudio}
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
                  studioCreateRequest={smartAssetsCreateRequest}
                  storageScope={session.tenant?.id || session.user.tenantId}
                  workflowContextSignal={smartAssetsWorkflowContext}
                  socialContentTaskId={smartAssetsContentTaskId}
                  onOpenCreationHome={handleOpenContentCreationHome}
                />
              )}
            </div>
            </Activity>
          )}
          {(page === 'socialMonitoring' || mountedPages.has('socialMonitoring')) && (
            <Activity mode={page === 'socialMonitoring' ? 'visible' : 'hidden'}>
            <TrafficPage
              key="social-monitoring-accounts"
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={false}
              onNavigate={handleNavigate}
              initialView="accounts"
              visibleModes={['accounts']}
              showModeTabs={false}
              pageTitle={PAGE_REGISTRY.socialMonitoring.canonicalTitle}
              storageScope={session.tenant?.id || session.user.tenantId}
              socialContentTaskId={activeSocialContentTaskId}
            />
            </Activity>
          )}
          {(page === 'scriptLibrary' || mountedPages.has('scriptLibrary')) && <Activity mode={page === 'scriptLibrary' ? 'visible' : 'hidden'}><ScriptLibraryPage socialContentTaskId={activeSocialContentTaskId} /></Activity>}
          {(ADS_PAGES.includes(page) || ADS_PAGES.some(item => mountedPages.has(item))) && <Activity mode={ADS_PAGES.includes(page) ? 'visible' : 'hidden'}><PlatformAdsPage page={ADS_PAGES.includes(page) ? page : lastAdsPage} onNavigate={handleNavigate} /></Activity>}
          {(page === 'conversion' || mountedPages.has('conversion')) && (
            <Activity mode={page === 'conversion' ? 'visible' : 'hidden'}>
            <ConversionPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'conversion'}
              restore={restoreFor('conversion')}
              kickoff={kickoffFor('conversion')}
              onAction={startAgentTask}
              onSessionRefresh={() => void refreshSession()}
              isDemo={false}
              includeMockCustomers={localForeignTradeMock}
              mockCustomerScope={localForeignTradeMock && new URLSearchParams(window.location.search).get('mock') !== 'quote'
                ? 'local-foreign-trade-factory'
                : session.user.email || session.user.id || session.tenant?.id || 'admin'}
            />
            </Activity>
          )}
          {(page === 'orders' || mountedPages.has('orders')) && <Activity mode={page === 'orders' ? 'visible' : 'hidden'}><OrderManagementPage /></Activity>}
          {(page === 'enterprise' || mountedPages.has('enterprise')) && <Activity mode={page === 'enterprise' ? 'visible' : 'hidden'}><EnterprisePage /></Activity>}
          {(page === 'agentMemory' || mountedPages.has('agentMemory')) && (
            <Activity mode={page === 'agentMemory' ? 'visible' : 'hidden'}>
            <AgentMemoryPage
              includeMockCustomers={import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === 'quote'}
              mockCustomerScope={session.user.email || session.user.id || session.tenant?.id || 'admin'}
            />
            </Activity>
          )}
          {(INTEGRATION_PAGES.includes(page) || INTEGRATION_PAGES.some(item => mountedPages.has(item))) && <Activity mode={INTEGRATION_PAGES.includes(page) ? 'visible' : 'hidden'}><IntegrationsPage /></Activity>}
          {(page === 'organizationPermissions' || mountedPages.has('organizationPermissions')) && <Activity mode={page === 'organizationPermissions' ? 'visible' : 'hidden'}><OrganizationPermissionsPage /></Activity>}
          {(page === 'scheduled' || mountedPages.has('scheduled')) && <Activity mode={page === 'scheduled' ? 'visible' : 'hidden'}><ScheduledPage onAction={startAgentTask} /></Activity>}
          {(page === 'admin' || mountedPages.has('admin')) && <Activity mode={page === 'admin' ? 'visible' : 'hidden'}><AdminDashboard onSupportSessionStarted={handleSupportSessionStarted} /></Activity>}
          {(page === 'adminDelivery' || mountedPages.has('adminDelivery')) && <Activity mode={page === 'adminDelivery' ? 'visible' : 'hidden'}><AdminDeliveryPage /></Activity>}
          </Suspense>
        </PageErrorBoundary>
      </div>
    </Layout>
    </SocialProgramProvider>
  );
}
