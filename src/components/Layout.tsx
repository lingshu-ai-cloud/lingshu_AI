import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Menu, Segmented } from 'antd';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, LogOut, ShieldCheck, PanelLeftClose, PanelLeftOpen, Settings,
  PanelRightOpen, Sparkles, Star, X,
} from 'lucide-react';
import type { Page, ConversationContext, Conversation, AgentAction } from '../App';
import { isPageInNavigationBranch, PAGE_REGISTRY } from '../pageRegistry';
import { isAdminSession, pagePreferenceScope, ROLE_PAGE_ACCESS } from '../appSession';
import { authApi, exitSupportSession, type AuthSession } from '../lib/auth';
import RightPanel from './RightPanel';
import DemoGuide from './DemoGuide';
import HomeGrowthTour from './HomeGrowthTour';
import AccountSettingsModal from './AccountSettingsModal';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { useModalFocus } from '../hooks/useModalFocus';
import ActionFeedbackHost from './ui/ActionFeedbackHost';
import DuotoneGlyph from './ui/DuotoneGlyph';
import LsPageTransition from './ui/LsPageTransition';
import { lsMotion } from '../lib/designTokens';
import { getScrollBehavior, usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { PLATFORM_ADS_PAGE_IDS, PLATFORM_ADS_SURFACE_ENABLED } from '../config/productSurfaceFlags';
import PointsManagementDrawer from './PointsManagementDrawer';
import { CreationModeContext, type CreationMode } from '../lib/creationMode';
import { accountProductNavigation, primaryProductNavigation, type PrimaryProductPage } from '../productNavigation';

const PRODUCT_NAV_ICONS: Record<PrimaryProductPage, ReactNode> = {
  strategy: <DuotoneGlyph kind="conversation" />,
  socialInspiration: <DuotoneGlyph kind="create" />,
  inspirationMarket: <DuotoneGlyph kind="inspiration" />,
  digitalEmployees: <DuotoneGlyph kind="home" />,
  adsOverview: <DuotoneGlyph kind="ads" />,
  conversion: <DuotoneGlyph kind="customers" />,
};

interface LayoutProps {
  page: Page;
  onNavigate: (p: Page) => void;
  onPrefetchPage?: (p: Page) => void;
  conversation: ConversationContext | null;
  children: ReactNode;
  session?: import('../lib/auth').AuthSession | null;
  onLogout?: () => void;
  conversations?: Conversation[];
  activeConvId?: string | null;
  onOpenConversation?: (id: string) => void;
  onNewConversation?: () => void;
  suppressRightPanel?: boolean;
  onAction?: AgentAction;
  onSessionUpdate?: (session: AuthSession | null) => void;
  demoGuideActive?: boolean;
  onDemoGuideShown?: () => void;
  starterMode?: boolean;
}

const SUB_LABEL: Record<string, string> = {
  trialing: '试用中', active: '已订阅', past_due: '续费逾期', canceled: '已取消', expired: '已过期', none: '未订阅',
};

function NavItem({
  item,
  active,
  onClick,
  onPrefetch,
  collapsed = false,
  disabled = false,
}: {
  item: { id: Page; label: string; icon: ReactNode };
  active: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
  collapsed?: boolean;
  disabled?: boolean;
}) {
  return (
    <div data-growth-tour-nav={item.id} onPointerEnter={disabled ? undefined : onPrefetch} onFocus={disabled ? undefined : onPrefetch} title={disabled ? '投流尚未接通，暂不可打开' : undefined}>
      <Menu
        className="ls-nav-menu"
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={active ? [item.id] : []}
        onClick={disabled ? undefined : onClick}
        items={[{
          key: item.id,
          disabled,
          icon: <span className="inline-flex items-center justify-center">{item.icon}</span>,
          title: collapsed ? item.label : '',
          label: <span data-demo-target={item.id} aria-current={active ? 'page' : undefined}>{item.label}{disabled && !collapsed && <span className="ml-1 text-[10px] text-text-muted">待接通</span>}</span>,
        }]}
      />
    </div>
  );
}

export default function Layout({ page, onNavigate, onPrefetchPage, conversation, children, session, onLogout, suppressRightPanel, onAction, demoGuideActive, onDemoGuideShown, starterMode = false }: LayoutProps) {
  const reducedMotion = usePrefersReducedMotion();
  const spatialTransition = reducedMotion ? { duration: 0 } : {
    ...lsMotion.spring.standard,
    opacity: { duration: lsMotion.duration.enter / 1000, ease: lsMotion.ease.enter },
  };
  const isInConversation = conversation !== null && !suppressRightPanel;
  const [quotaOpen, setQuotaOpen] = useState(false);
  const quotaAreaRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [mobileRightPanelOpen, setMobileRightPanelOpen] = useState(false);
  const mobileRightPanelRef = useModalFocus<HTMLElement>({
    open: isInConversation && mobileRightPanelOpen,
    onClose: () => setMobileRightPanelOpen(false),
  });
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('lingshu:sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [creatorSidebarCollapsed, setCreatorSidebarCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);
  const [mobileViewport, setMobileViewport] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  ));
  const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
  const homeSurface = page === 'strategy';
  const creatorSurface = page === 'strategy' || page === 'socialInspiration' || page === 'inspirationMarket' || page === 'digitalEmployees' || PLATFORM_ADS_PAGE_IDS.includes(page) || page === 'conversion';
  const sidebarCollapsed = mobileViewport ? !mobileSidebarExpanded : creatorSurface ? creatorSidebarCollapsed : desktopSidebarCollapsed;
  const sidebarWidth = sidebarCollapsed ? (mobileViewport ? 56 : 60) : creatorSurface ? Math.min(354, Math.max(246, Math.round(viewportWidth * 0.173))) : 176;
  const activeSession = session;
  const [homeActiveSection, setHomeActiveSection] = useState<'strategy' | 'socialInspiration'>('strategy');
  const creationMode: CreationMode = 'employee';
  const guideScope = activeSession?.demo?.guideScope || (activeSession?.demo?.expiresAt ? `${activeSession.user.id}:${activeSession.demo.expiresAt}` : activeSession?.user?.id || 'demo-guide');
  const supportAccess = activeSession?.supportAccess;
  const organizationRole = activeSession?.user.role || 'customer_service';
  const allowedPages = ROLE_PAGE_ACCESS[organizationRole];
  const primaryItems = primaryProductNavigation(creationMode, allowedPages, PLATFORM_ADS_SURFACE_ENABLED);
  const accountPages = accountProductNavigation(allowedPages, isAdminSession(activeSession ?? null));

  const leaveSupportSession = () => {
    if (!exitSupportSession()) authApi.logout();
    window.location.assign('/');
  };

  useEffect(() => {
    if (starterMode) setQuotaOpen(false);
  }, [starterMode]);
  useEffect(() => {
    const onHomeSection = (event: Event) => {
      const section = (event as CustomEvent<string>).detail;
      if (section === 'strategy' || section === 'socialInspiration') setHomeActiveSection(section);
    };
    window.addEventListener('lingshu:home-section-active', onHomeSection);
    return () => window.removeEventListener('lingshu:home-section-active', onHomeSection);
  }, []);
  useEffect(() => {
    if (!isInConversation) setMobileRightPanelOpen(false);
  }, [isInConversation]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const syncViewport = () => {
      setViewportWidth(window.innerWidth);
      setMobileViewport(media.matches);
      setMobileSidebarExpanded(false);
    };
    syncViewport();
    if (media.addEventListener) {
      media.addEventListener('change', syncViewport);
      return () => media.removeEventListener('change', syncViewport);
    }
    media.addListener(syncViewport);
    return () => media.removeListener(syncViewport);
  }, []);
  useEffect(() => {
    try { localStorage.setItem('lingshu:sidebar-collapsed', String(desktopSidebarCollapsed)); } catch { /* storage can be unavailable */ }
  }, [desktopSidebarCollapsed]);
  useEffect(() => {
    if (sidebarCollapsed) { setQuotaOpen(false); setAccountMenuOpen(false); }
  }, [sidebarCollapsed]);
  useDismissibleLayer(accountMenuOpen, quotaAreaRef, () => {
    setAccountMenuOpen(false);
  });
  const accountEmail = String(activeSession?.user?.email || '').trim().toLowerCase();
  const isJiangZheTestAccount = accountEmail === 'wenlantianxia-test@local.test';
  const tenantName = isJiangZheTestAccount
    ? '灵枢测试07-江浙'
    : activeSession?.tenant?.name || activeSession?.user?.name || activeSession?.user?.email?.split('@')[0] || '未命名';
  const accountDisplayName = isJiangZheTestAccount ? tenantName : activeSession?.user?.name || tenantName;
  const subStatus = activeSession?.tenant?.subscriptionStatus || activeSession?.subscription?.status || 'none';
  const initial = (tenantName[0] || '灵').toUpperCase();
  const demo = activeSession?.demo;
  const remainingTokens = Math.max(0, Math.min(
    demo?.remaining?.tokens ?? demo?.limits?.tokenDaily ?? 0,
    demo?.totalRemaining?.tokens ?? demo?.limits?.tokenTotal ?? Number.POSITIVE_INFINITY,
  ));
  const tokenLabel = remainingTokens >= 1000 ? `${Math.floor(remainingTokens / 1000)}k` : String(remainingTokens);
  const isTrialAccount = Boolean(
    activeSession?.demo?.enabled ||
    activeSession?.tenant?.subscriptionPlan === 'trial' ||
    activeSession?.subscription?.plan === 'trial' ||
    subStatus === 'trialing'
  );
  const showDemoGuide = Boolean(demoGuideActive && (activeSession?.demo?.enabled || isTrialAccount));
  const openQuota = () => {
    setAccountMenuOpen(false);
    setQuotaOpen(true);
  };
  const navigateFromSidebar = (nextPage: Page) => {
    if (mobileViewport) setMobileSidebarExpanded(false);
    if (homeSurface && nextPage === 'strategy') {
      const target = document.querySelector('.creator-home');
      if (target) {
        (target as HTMLElement).scrollTo({ top: 0, behavior: getScrollBehavior() });
        setHomeActiveSection(nextPage);
        return;
      }
    }
    onNavigate(nextPage);
  };
  const openDigitalEmployeeGuide = () => {
    setAccountMenuOpen(false);
    if (mobileViewport) setMobileSidebarExpanded(false);
    if (page === 'digitalEmployees') {
      window.dispatchEvent(new CustomEvent('lingshu:open-digital-employee-guide'));
      return;
    }
    try { sessionStorage.setItem('lingshu:open-digital-employee-guide', 'true'); } catch { /* storage can be unavailable */ }
    onNavigate('digitalEmployees');
  };
  const toggleSidebar = () => {
    if (mobileViewport) setMobileSidebarExpanded(value => !value);
    else if (creatorSurface) setCreatorSidebarCollapsed(value => !value);
    else setDesktopSidebarCollapsed(value => !value);
  };

  return (
    <div className={`app-shell flex h-[100dvh] min-h-0 min-w-0 overflow-hidden ${creatorSurface ? `creator-shell ${homeSurface ? '' : 'creator-shell--section'}` : ''}`}>

      <ActionFeedbackHost />
      <HomeGrowthTour page={page} scope={activeSession ? pagePreferenceScope(activeSession) : 'guest'} onNavigate={onNavigate} />

      {/* ── Left sidebar ─────────────────────────────── */}
      {page !== 'agentMonitor' && <motion.aside
        initial={false}
        animate={{ '--sidebar-width': `${sidebarWidth}px` }}
        style={{
          width: 'var(--sidebar-width)',
          minWidth: 'var(--sidebar-width)',
          maxWidth: 'var(--sidebar-width)',
        }}
        transition={spatialTransition}
        className="app-sidebar relative z-40 flex flex-shrink-0 flex-col overflow-visible border-r border-border"
      >
        {/* Logo */}
        <div className={`creator-sidebar-brand relative h-12 flex items-center flex-shrink-0 ${sidebarCollapsed ? 'justify-center px-2' : 'px-3 gap-2'}`}>
          {!sidebarCollapsed && (starterMode
            ? <span aria-hidden="true" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">{initial}</span>
            : <img src="/brand-logo.png?v=20260921" alt="灵枢 AI" className="w-7 h-7 object-contain flex-shrink-0" />)}
          {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-text-primary font-display">{starterMode ? tenantName : '灵枢 AI'}</span>}
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
            aria-label={sidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition hover:bg-white hover:text-text-primary ${sidebarCollapsed ? 'border border-border bg-white' : ''}`}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        {showDemoGuide && (
          <DemoGuide
            key={guideScope}
            page={page}
            onNavigate={navigateFromSidebar}
            onShown={onDemoGuideShown}
            forceStart={Boolean(activeSession?.demo?.guideTrigger)}
          />
        )}

        {/* Home nav */}
        <nav aria-label="主导航" className={`${sidebarCollapsed ? 'px-2' : 'px-3'} pb-1`}>
          {primaryItems.filter(item => item.page !== 'digitalEmployees').map(item => <NavItem
            key={item.page}
            item={{ id: item.page, label: item.label, icon: PRODUCT_NAV_ICONS[item.page] }}
            active={isPageInNavigationBranch(page, item.page)}
            onClick={() => navigateFromSidebar(item.page)}
            onPrefetch={() => onPrefetchPage?.(item.page)}
            collapsed={sidebarCollapsed}
            disabled={item.disabled}
          />)}
        </nav>

        <nav aria-label="经营导航" className={`${sidebarCollapsed ? 'mx-2 px-0' : 'mx-3 px-0'} mt-3 border-t border-border pt-3`}>
          {primaryItems.filter(item => item.page === 'digitalEmployees').map(item => <NavItem
            key={item.page}
            item={{ id: item.page, label: item.label, icon: PRODUCT_NAV_ICONS[item.page] }}
            active={isPageInNavigationBranch(page, item.page)}
            onClick={() => navigateFromSidebar(item.page)}
            onPrefetch={() => onPrefetchPage?.(item.page)}
            collapsed={sidebarCollapsed}
            disabled={item.disabled}
          />)}
        </nav>

        <div className="min-h-0 flex-1" />

        {/* Bottom user */}
        <div ref={quotaAreaRef} className="relative px-3 py-3 border-t border-border flex-shrink-0">
          <AnimatePresence>
            {accountMenuOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute bottom-[68px] left-3 z-50 max-h-[calc(100dvh-100px)] w-[260px] overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-xl">
                <div className="flex items-center gap-3 border-b border-border px-2 pb-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${isJiangZheTestAccount ? 'border border-border bg-surface-2 text-transparent' : 'bg-accent text-white'}`}>{isJiangZheTestAccount ? '' : initial}</span>
                  <div className="min-w-0"><p className="truncate text-sm font-bold text-text-primary">{accountDisplayName}</p><p className="truncate ls-type-body-small text-text-muted">{activeSession?.user?.email}</p></div>
                </div>
                <div className="pt-2">
                  <button onClick={openQuota} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><Star size={17} className="text-amber-500" fill="currentColor"/><span className="flex-1 text-left">积分管理</span><ChevronRight size={14} className="text-text-muted" /></button>
                  <button onClick={openDigitalEmployeeGuide} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><Sparkles size={17} /><span className="flex-1 text-left">新手引导</span><ChevronRight size={14} className="text-text-muted" /></button>
                  <button onClick={() => { setAccountMenuOpen(false); setMobileRightPanelOpen(false); setAccountSettingsOpen(true); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><Settings size={17} /><span className="flex-1 text-left">账号设置</span><ChevronRight size={14} className="text-text-muted" /></button>
                  {accountPages.map(accountPage => <button key={accountPage} onClick={() => { setAccountMenuOpen(false); navigateFromSidebar(accountPage); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><ShieldCheck size={17}/><span className="flex-1 text-left">{PAGE_REGISTRY[accountPage].navLabel}</span><ChevronRight size={14} className="text-text-muted"/></button>)}
                  {onLogout && <button onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-red-50 hover:text-red-600"><LogOut size={17} /><span className="flex-1 text-left">退出登录</span></button>}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-3 pt-2 ls-type-body-small font-semibold text-text-muted">
                    <a href="/privacy" target="_blank" rel="noreferrer" className="hover:text-accent">隐私政策</a>
                    <a href="/terms" target="_blank" rel="noreferrer" className="hover:text-accent">用户协议</a>
                    <a href="/data-deletion" target="_blank" rel="noreferrer" className="hover:text-accent">数据删除</a>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2.5'}`}>
            <button
              onClick={() => { setQuotaOpen(false); setAccountMenuOpen(value => !value); }}
              title="账号菜单"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${isJiangZheTestAccount ? 'border border-border bg-surface-2 text-transparent' : 'text-white'}`}
              style={isJiangZheTestAccount ? undefined : { background: 'var(--color-accent)' }}
            >
              {isJiangZheTestAccount ? '' : initial}
            </button>
            {!sidebarCollapsed && <button onClick={() => { setQuotaOpen(false); setAccountMenuOpen(value => !value); }} aria-expanded={accountMenuOpen} aria-haspopup="menu" className="flex-1 min-w-0 text-left rounded-lg -my-1 py-1 hover:bg-black/5 transition-colors">
              <p className="text-xs font-semibold text-text-primary truncate">{tenantName}</p>
              <p className="ls-type-body-small text-text-muted truncate">
                {starterMode ? '198 标准工作区' : demo?.tokenUnlimited ? 'Token 不限额' : demo && isTrialAccount ? `Token 剩余 ${tokenLabel}` : (SUB_LABEL[subStatus] ?? subStatus)}
              </p>
            </button>}
            {!sidebarCollapsed && <ChevronRight size={14} className={`text-text-muted transition-transform ${accountMenuOpen ? '-rotate-90' : ''}`} />}
          </div>
        </div>
      </motion.aside>}

      <PointsManagementDrawer open={quotaOpen} onClose={() => setQuotaOpen(false)} session={activeSession}/>

      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onLogout={onLogout}
      />

      {/* ── Main content ─────────────────────────────── */}
      <main className="app-main relative flex min-w-0 flex-1 basis-0 flex-col overflow-clip">
        {supportAccess && (
          <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-text-primary">
              <ShieldCheck size={14} className="shrink-0 text-accent" />
              <span className="truncate font-semibold">正在协助：{supportAccess.tenantName}</span>
              <span className="hidden text-text-secondary sm:inline">持续协助，直至手动退出</span>
            </div>
            <button type="button" onClick={leaveSupportSession} className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-accent hover:text-accent-dim">
              <LogOut size={13} />退出协助
            </button>
          </div>
        )}
        <CreationModeContext.Provider value={creationMode}>
          <LsPageTransition page={page}>{children}</LsPageTransition>
        </CreationModeContext.Provider>
      </main>

      {/* ── Right panel (only in conversation mode) ── */}
      {isInConversation && !mobileRightPanelOpen && (
        <button
          type="button"
          onClick={() => setMobileRightPanelOpen(true)}
          aria-label="打开协作面板"
          aria-controls="conversation-context-panel-mobile"
          aria-expanded="false"
          className="fixed bottom-4 right-4 z-40 inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-text-primary shadow-sm md:hidden"
        >
          <PanelRightOpen size={15} aria-hidden="true" />
          协作面板
        </button>
      )}

      <AnimatePresence>
        {isInConversation && mobileRightPanelOpen && (
          <motion.aside
            ref={mobileRightPanelRef}
            tabIndex={-1}
            id="conversation-context-panel-mobile"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={spatialTransition}
            className="fixed inset-y-0 right-0 z-50 flex flex-col overflow-hidden bg-white md:hidden"
            style={{ left: page === 'agentMonitor' ? 0 : sidebarWidth }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversation-context-panel-mobile-title"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <h2 id="conversation-context-panel-mobile-title" className="text-xs font-semibold text-text-primary">协作面板</h2>
              <button
                type="button"
                data-modal-initial-focus
                onClick={() => setMobileRightPanelOpen(false)}
                aria-label="关闭协作面板"
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <RightPanel conversation={conversation} onAction={onAction} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isInConversation && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 272, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spatialTransition}
            className="hidden flex-shrink-0 flex-col overflow-hidden bg-white md:flex"
            style={{ boxShadow: '-6px 0 24px rgba(0,0,0,0.06)' }}
          >
            <RightPanel conversation={conversation} onAction={onAction} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
