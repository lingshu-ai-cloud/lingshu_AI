import { restoreAgentCalendarReturnContext } from './lib/agentCalendarReturnContext';
import { pushProductionLocation, stampProductionHistoryState, canRestoreProductionHistoryState, restorableProductionDetail, productionNavigationIdentity } from './lib/productionNavigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Result } from 'antd';
import { Loader2 } from 'lucide-react';
import { authApi, getToken, AUTH_TOKEN_CHANGED_EVENT, startInitialAuthSessionRefresh, type AuthSession } from './lib/auth';
import { isLocalForeignTradeMockEnabled } from './mocks/foreignTradeOperations';
import { completeDemoStep, setDemoProgressScope } from './lib/demoProgress';
import AssistLinkPage from './components/AssistLinkPage';
import LegalPages from './components/LegalPages';
import { isSocialTaskContextPage } from './lib/socialTaskContext';
import {
  SOCIAL_CONTENT_NAVIGATION_EVENT,
  attachSocialContentNavigationState,
  readSocialContentNavigationQueryTaskId,
  readSocialContentNavigationTaskId,
  setActiveSocialContentTaskId,
  type SocialContentNavigationEventDetail,
} from './lib/socialContentContext';
import { StarterWorkspaceRequestError, shouldBypassStarter198Probe, starterWorkspaceApi } from './lib/starterWorkspace';
import { PAGE_REGISTRY, resolveNavigationPage, resolvePage, type LegacyTrafficView, type Page } from './pageRegistry';
import { SocialProgramProvider } from './contexts/SocialProgramContext';
import { readLegacyWeeklyPlanNavigation } from './lib/assistantLegacyWeeklyNavigation';
import { PageLoading } from './components/AppPageBoundary';
import type { SocialContentCreateRequest } from './components/socialContent/SocialContentWorkspace';
import type { EnterpriseProductsDeepLink } from './components/EnterprisePage';
import AppShellChrome from './components/AppShellChrome';
import AppPageSlot from './AppPageSlot';
import { availableProductPage, PLATFORM_ADS_SURFACE_ENABLED } from './config/productSurfaceFlags';
import { AGENT_PAGES, ROLE_PAGE_ACCESS, customerUnifiedAgent, firstUserText, isAdminSession, isExternalCustomerServiceDemoSession, isLocalCustomerReplyLab, loadConvs, loadPage, pagePreferenceScope, type AgentAction, type AgentType, type Conversation, type ConversationContext, type KickoffSignal, type Message, type RestoreSignal, type StarterAccessState } from './appSession';
import { useSocialContentQueryNavigation } from './lib/useSocialContentQueryNavigation';
import { Layout, AuthScreen } from './components/AppDeferredShell';

import { DesignPrototype, SmartBusinessPreview, ADS_PAGES, prefetchPageModule, scheduleLocalPreviewPreload, normalizeEnterpriseProductsDeepLink } from './appPageModules';
export { normalizeEnterpriseProductsDeepLink } from './appPageModules';

export type { Page } from './pageRegistry';
export type { AgentAction, AgentType, AssistantReferenceMedia, Conversation, ConversationContext, KickoffSignal, Message, RestoreSignal, Source } from './appSession';

export default function App() {
  const publicPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const localForeignTradeMock = isLocalForeignTradeMockEnabled();
  if (import.meta.env.DEV && DesignPrototype && publicPath === '/design-prototype') {
    return (
      <Suspense fallback={<PageLoading />}>
        <DesignPrototype />
      </Suspense>
    );
  }
  if (import.meta.env.DEV && SmartBusinessPreview && publicPath === '/smart-business-preview') {
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
  const [page, setPage] = useState<Page>(() => availableProductPage(loadPage()));
  const [weeklyPlanNavigation, setWeeklyPlanNavigation] = useState<{
    goalId: string; planId: string; requestId: number; identity: string;
  } | null>(() => {
    const target = readLegacyWeeklyPlanNavigation(window.location.search);
    return target ? { ...target, requestId: 1, identity: productionNavigationIdentity() } : null;
  });
  const [enterpriseProductsDeepLink, setEnterpriseProductsDeepLink] = useState<EnterpriseProductsDeepLink | null>(() => (
    loadPage() === 'enterprise'
      ? normalizeEnterpriseProductsDeepLink(window.history.state?.productionDetail)
      : null
  ));
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
      // Keep the home and production workbench warm, but cap other retained
      // pages so a long session does not accumulate every heavy workspace.
      const sticky = new Set<Page>(['digitalEmployees', 'smartAssets']);
      while (next.size > 4) {
        const removable = [...next].find(item => item !== page && !sticky.has(item));
        if (!removable) break;
        next.delete(removable);
      }
      return next;
    });
  }, [page]);
  useEffect(() => {
    if (ADS_PAGES.includes(page)) setLastAdsPage(page);
  }, [page]);
  useEffect(() => {
    if (!PLATFORM_ADS_SURFACE_ENABLED && ADS_PAGES.includes(page)) setPage('strategy');
  }, [page]);
  useEffect(() => {
    if (page !== 'enterprise') setEnterpriseProductsDeepLink(null);
  }, [page]);
  useEffect(() => scheduleLocalPreviewPreload(pageRef.current), []);
  const [socialContentNavigation, setSocialContentNavigation] = useState<{
    page: Page;
    taskId: string;
  } | null>(() => {
    const initialPage = loadPage();
    if (!isSocialTaskContextPage(initialPage)) return null;
    const taskId = (canRestoreProductionHistoryState(window.history.state) ? readSocialContentNavigationTaskId(initialPage, window.history.state) : null)
      || readSocialContentNavigationQueryTaskId(initialPage, window.location.search);
    return taskId ? { page: initialPage, taskId } : null;
  });
  useEffect(() => {
    document.title = `${PAGE_REGISTRY[page].canonicalTitle} · 灵枢 AI`;
  }, [page]);
  useEffect(() => {
    const initialState = canRestoreProductionHistoryState(window.history.state) ? window.history.state : {};
    window.history.replaceState(stampProductionHistoryState({ ...initialState, productionPage: pageRef.current, productionDepth: 0 }), '');
    const restorePage = (event: PopStateEvent) => {
      const trusted = canRestoreProductionHistoryState(event.state);
      const restoredDetail = restorableProductionDetail(event.state);
      const previous = trusted ? resolveNavigationPage(event.state?.productionPage, restoredDetail?.view) : 'strategy';
      if (previous) {
        setPage(previous);
        restoreAgentCalendarReturnContext(trusted ? event.state?.agentCalendarReturnContext ?? null : null);
        const socialTaskId = trusted && isSocialTaskContextPage(previous)
          ? readSocialContentNavigationTaskId(previous, event.state)
          : null;
        setSocialContentNavigation(socialTaskId ? { page: previous, taskId: socialTaskId } : null);
        if (restoredDetail) {
          const detail = restoredDetail;
          try { sessionStorage.setItem('digitalEmployee.businessDeepLink', JSON.stringify({ ...detail, navigationIdentity:productionNavigationIdentity(), issuedAt: Date.now() })); } catch { /* optional storage */ }
          window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { ...detail, restoreHistory: true } }));
        } else {
          try { sessionStorage.removeItem('digitalEmployee.businessDeepLink'); if(!trusted)sessionStorage.removeItem('digitalEmployee.returnContext'); } catch { /* optional storage */ }
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
        setPage('strategy');
      }
    };
    let navigationAuthority = productionNavigationIdentity();
    const authChanged = () => {
      const nextAuthority = productionNavigationIdentity();if(nextAuthority===navigationAuthority)return;navigationAuthority=nextAuthority;
      const cleanUrl=new URL(window.location.href);cleanUrl.searchParams.set('page','strategy');
      cleanUrl.searchParams.delete('goalId');cleanUrl.searchParams.delete('planId');
      setWeeklyPlanNavigation(null);
      window.history.replaceState(stampProductionHistoryState({productionPage:'strategy',productionDepth:0}), '',cleanUrl);
      try { sessionStorage.removeItem('digitalEmployee.businessDeepLink'); sessionStorage.removeItem('digitalEmployee.returnContext'); } catch { /* optional storage */ }
      restoreAgentCalendarReturnContext(null);
      setSmartAssetsWorkflowContext(null);setSmartAssetsCreateRequest(null);setSmartAssetsStudioOpen(false);
      setConversation(null);setRestore(null);setKickoff(null);
      setSocialContentNavigation(null);
      setPage('strategy');
      window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'strategy',restoreHistory:true}}));
    };
    const storageChanged = (event: StorageEvent) => { if(event.key === 'overseas_token' || event.key === null)authChanged(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,authChanged);
    window.addEventListener('storage',storageChanged);
    window.addEventListener('popstate', restorePage);
    window.addEventListener('lingshu:back', back);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,authChanged); window.removeEventListener('storage',storageChanged); window.removeEventListener('popstate', restorePage); window.removeEventListener('lingshu:back', back); };
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
    const detail = canRestoreProductionHistoryState(window.history.state) ? window.history.state?.productionDetail : null;
    return Boolean(
      readSocialContentNavigationTaskId('smartAssets', window.history.state)
      || readSocialContentNavigationQueryTaskId('smartAssets', window.location.search)
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
    const detail = canRestoreProductionHistoryState(window.history.state) ? window.history.state?.productionDetail : null;
    return loadPage() === 'smartAssets' && detail?.page === 'smartAssets' && detail.view === 'publish' ? 'publish' : 'create';
  });
  const [smartAssetsInstanceKey, setSmartAssetsInstanceKey] = useState(0);
  const [smartAssetsWorkflowContext, setSmartAssetsWorkflowContext] = useState<{ runId: string; taskId: string; taskKey: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string } | null>(() => {
    const target = window.__agentProductionTarget;
    if (target?.link.page === 'smartAssets') return { runId: target.link.runId, taskId: target.link.taskId, taskKey: target.link.businessRef.taskKey, entityId: target.projectId };
    const detail = canRestoreProductionHistoryState(window.history.state) ? window.history.state?.productionDetail : null;
    if (loadPage() !== 'smartAssets' || detail?.page !== 'smartAssets') return null;
    const runId = String(detail.workflowRunId || '');
    const taskId = String(detail.workflowTaskId || '');
    return runId && taskId || detail.businessRef?.entityId ? { runId, taskId, taskKey: String(detail.businessRef?.taskKey || ''), entityId: detail.businessRef?.entityId, contentId: detail.businessRef?.contentId, referenceId: detail.businessRef?.referenceId } : null;
  });
  const [smartAssetsCreateRequest, setSmartAssetsCreateRequest] = useState<SocialContentCreateRequest | null>(() => {
    const detail = canRestoreProductionHistoryState(window.history.state) ? window.history.state?.productionDetail : null;
    return loadPage() === 'smartAssets' && detail?.page === 'smartAssets' ? detail.contentCreationRequest || null : null;
  });
  const [smartAssetsStudioOpen, setSmartAssetsStudioOpen] = useState(() => {
    const detail = canRestoreProductionHistoryState(window.history.state) ? window.history.state?.productionDetail : null;
    return Boolean(new URLSearchParams(window.location.search).get('project')
      || (new URLSearchParams(window.location.search).get('taskId') && !new URLSearchParams(window.location.search).has('socialContentTaskId'))
      || detail?.directStudio);
  });

  useSocialContentQueryNavigation(pageRef.current);

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
    setAuthLoading(true);
    return startInitialAuthSessionRefresh({
      refresh: () => authApi.me(),
      getToken,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: timer => window.clearTimeout(timer),
      onSuccess: s => {
        setDemoProgressScope(progressScopeFor(s));
        setSession(s);
        setSessionRefreshError('');
        setAuthLoading(false);
      },
      onRetry: () => {
        setSessionRefreshError('服务暂时不可用，正在自动重新连接。');
        if (getToken()) setAuthLoading(false);
      },
      onFailure: () => {
        setSessionRefreshError('暂时无法连接服务，登录状态未被清除。');
        setAuthLoading(false);
      },
    });
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
      if (window.location.pathname === '/') {
        const url = new URL(window.location.href);
        url.searchParams.set('page', page);
        window.history.replaceState(window.history.state, '', url);
      }
    } catch { /* ignore */ }
  }, [page]);
  useEffect(() => {
    if (session && (page === 'admin' || page === 'adminDelivery') && !isAdminSession(session)) setPage('strategy');
  }, [page, session]);
  useEffect(() => {
    if (!session) return;
    if (starterAccess === 'loading' || starterAccess === 'unavailable') return;
    const role = session.user.role || 'customer_service';
    if (!ROLE_PAGE_ACCESS[role].has(page)) setPage('strategy');
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

  // 历史回复中的执行建议统一回到灵小枢。专业 Agent 只在内部路由，
  // 不再作为平级入口跳走当前页面或创建另一段可见会话。
  const startAgentTask = (_agent: AgentType, text: string) => {
    activeIdRef.current = null; setActiveConvId(null);
    setRestore(null); setConversation(null);
    setKickoff({ agent: 'strategy', text, key: `k${Date.now()}` });
  };

  const handleNavigate = useCallback((p: Page) => {
    const next = availableProductPage(resolvePage(p) || 'strategy');
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
        navigationIdentity?: string;
        page?: Page;
        view?: LegacyTrafficView | 'products' | 'calendar';
        productName?: string;
        materialIds?: string[];
        contentItemId?: string;
        studioPanel?: 'projects';
        workflowRunId?: string;
        workflowTaskId?: string;
        socialContentTaskId?: string;
        weeklyContentTarget?: import('../shared/contracts/weeklyContentNavigation').WeeklyContentNavigation;
        exactReferenceReview?: import('./lib/exactReferenceReview').ExactReferenceReviewTarget;
        socialContentPage?: string;
        socialContentView?: 'managed';
        studioEntry?: boolean;
        directStudio?: boolean;
        businessRef?: { taskKey?: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string; goalId?: string; planId?: string };
        contentCreationRequest?: SocialContentCreateRequest;
      }>).detail;
      const nextPage = resolveNavigationPage(incomingDetail?.page, incomingDetail?.view);
      if (!nextPage || !incomingDetail) return;
      if(incomingDetail.navigationIdentity && incomingDetail.navigationIdentity !== productionNavigationIdentity())return;
      const detail = nextPage === incomingDetail.page
        ? incomingDetail
        : { ...incomingDetail, page: nextPage };
      if (nextPage === 'digitalEmployees' && (detail.businessRef?.goalId || detail.businessRef?.planId)) {
        setWeeklyPlanNavigation(previous => ({
          goalId: String(detail.businessRef?.goalId || '').trim(),
          planId: String(detail.businessRef?.planId || '').trim(),
          requestId: (previous?.requestId || 0) + 1,
          identity: productionNavigationIdentity(),
        }));
      }
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
          delete nextHistoryState.weeklyContentTarget;
        }
        if (nextPage === 'socialInspiration' && detail.view === 'calendar') {
          const calendarUrl = new URL(window.location.href);
          calendarUrl.searchParams.set('view', 'calendar');
          calendarUrl.searchParams.delete('taskId');
          calendarUrl.searchParams.delete('socialContentTaskId');
          delete nextHistoryState.socialContentTaskId;
          delete nextHistoryState.socialContentPage;
          window.history.replaceState(stampProductionHistoryState(nextHistoryState), '', calendarUrl);
        }
        if (nextPage === 'smartAssets' && detail.contentCreationRequest
          && (!detail.contentCreationRequest.continueProjectId
            || !detail.socialContentTaskId
            || (detail.contentCreationRequest.creationPath === 'viral_replication' && detail.directStudio === false))) {
          try { localStorage.removeItem('ow_studio_open_project'); } catch { /* ignore */ }
          const freshUrl = new URL(window.location.href);
          freshUrl.searchParams.delete('project');
          if (opensCreationWorkbench) { freshUrl.searchParams.delete('socialContentTaskId'); freshUrl.searchParams.delete('taskId'); }
          freshUrl.searchParams.set('view', 'create');
          window.history.replaceState(stampProductionHistoryState({ ...nextHistoryState, productionDetail: detail }), '', freshUrl);
        } else window.history.replaceState(stampProductionHistoryState({ ...nextHistoryState, productionDetail: detail }), '');
        const socialTaskId = String(detail.socialContentTaskId || '').trim();
        if (socialTaskId && isSocialTaskContextPage(nextPage)
          && (!detail.socialContentPage || detail.socialContentPage === nextPage)) {
          attachSocialContentNavigationState(socialTaskId, nextPage, detail.weeklyContentTarget);
        }
      }
      if (nextPage === 'enterprise') setEnterpriseProductsDeepLink(normalizeEnterpriseProductsDeepLink(detail));
      if (nextPage === 'smartAssets') {
        setSmartAssetsView(detail.view === 'publish' ? 'publish' : 'create');
        setSmartAssetsCreateRequest(detail.contentCreationRequest || null);
        setSmartAssetsStudioOpen(detail.studioPanel === 'projects'
          || detail.directStudio === true
          || Boolean(detail.contentCreationRequest && !detail.contentCreationRequest.resumeEditableDraft && detail.contentCreationRequest.creationPath !== 'viral_replication' && !detail.contentCreationRequest.creationDialoguePlan && !detail.contentCreationRequest.assistantEntry));
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
  const handleReturnToContentPlanning = useCallback((request: SocialContentCreateRequest) => {
    const planningRequest = { ...request, replicationStep: 1 as const };
    try { localStorage.removeItem('ow_studio_open_project'); } catch { /* ignore */ }
    setSmartAssetsCreateRequest(planningRequest);
    setSmartAssetsView('create');
    setSmartAssetsStudioOpen(false);
    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.delete('project');
    window.history.replaceState({
      ...window.history.state,
      productionDetail: {
        page: 'smartAssets', view: 'create', directStudio: false,
        contentCreationRequest: planningRequest,
        ...(request.continueTaskId ? { socialContentTaskId: request.continueTaskId, socialContentPage: 'smartAssets' } : {}),
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
    delete nextHistoryState.weeklyContentTarget;
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
    // Never carry the previous account's page into a newly authenticated tenant.
    // Explicit deep links remain available, but the ordinary entry is creation.
    try {
      const nextScope = pagePreferenceScope(s);
      const previousScope = localStorage.getItem('ow_page_scope');
      if (previousScope !== nextScope) {
        localStorage.setItem('ow_page_scope', nextScope);
        setSocialContentNavigation(null);
        setPage('strategy');
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
    setPage('strategy');
  };

  if (isRegistrationEntry) {
    return <Suspense fallback={<PageLoading />}><AuthScreen onAuthed={handleAuthed} /></Suspense>;
  }
  if (authLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!session && sessionRefreshError) {
    const retainedSessionToken = Boolean(getToken());
    return (
      <div role="alert" className="flex min-h-[100dvh] items-center justify-center bg-white p-6">
        <Result
          status="warning"
          title="服务连接暂时中断"
          subTitle={retainedSessionToken
            ? `${sessionRefreshError} 登录凭据已保留，请重新连接。`
            : `${sessionRefreshError} 本地预览会话尚未恢复，请重新连接。`}
          extra={(
            <Button type="primary" onClick={() => { setAuthLoading(true); void refreshSession().finally(() => setAuthLoading(false)); }}>
              重新连接
            </Button>
          )}
        />
      </div>
    );
  }
  if (!session) return <Suspense fallback={<PageLoading />}><AuthScreen onAuthed={handleAuthed} /></Suspense>;
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
  const showSocialContentPlanning = smartAssetsView === 'create'
    && !smartAssetsStudioOpen
    && (Boolean(smartAssetsContentTaskId && !smartAssetsWorkflowContext && !smartAssetsCreateRequest)
      || Boolean(smartAssetsCreateRequest?.resumeEditableDraft)
      || Boolean(smartAssetsCreateRequest?.creationDialoguePlan)
      || Boolean(smartAssetsCreateRequest?.assistantEntry)
      || smartAssetsCreateRequest?.creationPath === 'viral_replication'
      || (!smartAssetsContentTaskId && !smartAssetsWorkflowContext && !smartAssetsCreateRequest));


  return (
    <SocialProgramProvider scope={session.tenant?.id || session.user.tenantId} enabled={!starterMode}>
    <Suspense fallback={<PageLoading />}><Layout page={page} onNavigate={handleNavigate} onPrefetchPage={prefetchPageModule} conversation={conversation} session={session} onLogout={handleLogout}
      starterMode={starterMode}
      onSessionUpdate={setSession}
      demoGuideActive={false}
      conversations={conversations} activeConvId={activeConvId} onOpenConversation={openConversation} onNewConversation={newConversation}
      suppressRightPanel={starterMode || scriptPanelOpen} onAction={startAgentTask}>
      <AppShellChrome
        page={page} session={session} starterMode={starterMode} conversation={conversation}
        restore={restore} kickoff={kickoff} sessionRefreshError={sessionRefreshError}
        smartAssetsView={smartAssetsView} onKickoffConsumed={() => setKickoff(null)}
        onAction={startAgentTask} onSessionRefresh={() => void refreshSession()}
        onNavigate={handleNavigate}
      />
      <AppPageSlot {...{
        page, session, starterMode, weeklyPlanNavigation, handleNavigate, handleSocialContentNavigate,
        mountedPages, enterConversation, leaveConversation, conversation, restoreFor, kickoffFor,
        startAgentTask, refreshSession, localForeignTradeMock, setScriptPanelOpen,
        activeSocialContentTaskId, smartAssetsMounted, showSocialContentPlanning, smartAssetsContentTaskId,
        smartAssetsCreateRequest, handleLaunchContentStudio, smartAssetsInstanceKey, smartAssetsView,
        openProjectsSignal, smartAssetsWorkflowContext, handleOpenContentCreationHome,
        handleReturnToContentPlanning, lastAdsPage, enterpriseProductsDeepLink, handleSupportSessionStarted,
      }} />
    </Layout></Suspense>
    </SocialProgramProvider>
  );
}
