import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Menu } from 'antd';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight, LogOut, Loader2, RefreshCcw, X, ShieldCheck, ListTree, PanelLeftClose, PanelLeftOpen, Coins, Settings,
  PanelRightOpen, Sparkles,
} from 'lucide-react';
import type { Page, ConversationContext, Conversation, AgentAction } from '../App';
import { PAGE_REGISTRY, PRIMARY_SOCIAL_NAV_PAGES } from '../pageRegistry';
import { authApi, exitSupportSession, type AuthSession, type OrganizationRole } from '../lib/auth';
import RightPanel from './RightPanel';
import DemoGuide from './DemoGuide';
import AccountSettingsModal from './AccountSettingsModal';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { useModalFocus } from '../hooks/useModalFocus';
import ActionFeedbackHost from './ui/ActionFeedbackHost';
import DuotoneGlyph from './ui/DuotoneGlyph';
import LsPageTransition from './ui/LsPageTransition';
import { lsMotion } from '../lib/designTokens';
import { getScrollBehavior, usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { PLATFORM_ADS_SURFACE_ENABLED } from '../config/productSurfaceFlags';

interface NavSection {
  label: string;
  items: { id: Page; label: string; icon: ReactNode }[];
}

const navItem = (id: Page, icon: ReactNode) => ({ id, label: PAGE_REGISTRY[id].navLabel, icon });

const HOME_NAV_ITEM = navItem('digitalEmployees', <DuotoneGlyph kind="home" />);

const SOCIAL_NAV_ICONS: Record<(typeof PRIMARY_SOCIAL_NAV_PAGES)[number], ReactNode> = {
  socialInspiration: <DuotoneGlyph kind="inspiration" />,
  smartAssets: <DuotoneGlyph kind="create" />,
  traffic: <DuotoneGlyph kind="publish" />,
};

const SOCIAL_NAV: NavSection = {
  label: '社媒运营',
  items: PRIMARY_SOCIAL_NAV_PAGES.map(id => navItem(id, SOCIAL_NAV_ICONS[id])),
};

const ADS_NAV: NavSection = {
  label: '平台投放',
  items: [
    navItem('adsOverview', <DuotoneGlyph kind="ads" />),
    navItem('adsPlans', <DuotoneGlyph kind="campaign" />),
    navItem('adsManaged', <DuotoneGlyph kind="agent" />),
  ],
};

const CUSTOMER_NAV: NavSection = {
  label: '客户管理',
  items: [
    navItem('conversion', <DuotoneGlyph kind="customers" />),
    navItem('orders', <DuotoneGlyph kind="orders" />),
  ],
};

const AGENT_NAV: NavSection = {
  label: '智能体管理',
  items: [
    navItem('enterprise', <DuotoneGlyph kind="enterprise" />),
    navItem('agentMemory', <DuotoneGlyph kind="memory" />),
    navItem('scheduled', <DuotoneGlyph kind="schedule" />),
  ],
};

const ADMIN_NAV: NavSection = {
  label: '管理员权限',
  items: [
    navItem('admin', <DuotoneGlyph kind="permissions" />),
    navItem('adminDelivery', <DuotoneGlyph kind="integration" />),
  ],
};

const SYSTEM_NAV: NavSection = {
  label: '系统设置',
  items: [
    navItem('plugins', <DuotoneGlyph kind="integration" />),
    navItem('organizationPermissions', <DuotoneGlyph kind="permissions" />),
  ],
};

// Platform Ads is temporarily hidden behind a reversible product-surface flag;
// ADS_NAV remains intact as the restoration backup.
const NAV_SECTIONS = [SOCIAL_NAV, ...(PLATFORM_ADS_SURFACE_ENABLED ? [ADS_NAV] : []), CUSTOMER_NAV, AGENT_NAV, SYSTEM_NAV];

const STARTER_HOME_NAV_ITEM = navItem('digitalEmployees', <DuotoneGlyph kind="home" />);

const ROLE_PAGE_ACCESS: Record<OrganizationRole, Set<Page>> = {
  super_admin: new Set<Page>(['digitalEmployees', 'agentMonitor', 'strategy', 'socialWorkspace', 'socialSetup', 'socialAccounts', 'socialPlanning', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'socialMonitoring', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'conversion', 'orders', 'enterprise', 'agentMemory', 'scheduled', 'plugins', 'organizationPermissions']),
  admin: new Set<Page>(['digitalEmployees', 'agentMonitor', 'strategy', 'socialWorkspace', 'socialSetup', 'socialAccounts', 'socialPlanning', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'socialMonitoring', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'conversion', 'orders', 'enterprise', 'agentMemory', 'scheduled', 'plugins', 'organizationPermissions']),
  social_operator: new Set<Page>(['digitalEmployees', 'agentMonitor', 'strategy', 'socialWorkspace', 'socialSetup', 'socialAccounts', 'socialPlanning', 'traffic', 'socialInspiration', 'scriptLibrary', 'smartAssets', 'socialMonitoring', 'accountManagement', 'adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged', 'scheduled']),
  customer_service: new Set<Page>(['digitalEmployees', 'agentMonitor', 'strategy', 'conversion', 'orders', 'scheduled']),
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

const relTime = (ts: number) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

const SUB_LABEL: Record<string, string> = {
  trialing: '试用中', active: '已订阅', past_due: '续费逾期', canceled: '已取消', expired: '已过期', none: '未订阅',
};

function NavItem({
  item,
  active,
  onClick,
  onPrefetch,
  collapsed = false,
}: {
  item: { id: Page; label: string; icon: ReactNode };
  active: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
  collapsed?: boolean;
}) {
  return (
    <div onPointerEnter={onPrefetch} onFocus={onPrefetch}>
      <Menu
        className="ls-nav-menu"
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={active ? [item.id] : []}
        onClick={onClick}
        items={[{
          key: item.id,
          icon: <span className="inline-flex items-center justify-center">{item.icon}</span>,
          title: collapsed ? item.label : '',
          label: <span data-demo-target={item.id} aria-current={active ? 'page' : undefined}>{item.label}</span>,
        }]}
      />
    </div>
  );
}

const formatTokens = (value?: number | null) => {
  const n = Math.max(0, Math.floor(Number(value ?? 0)));
  return n.toLocaleString('en-US');
};

const pct = (used?: number, limit?: number) => {
  const cap = Math.max(0, Number(limit ?? 0));
  if (!cap) return 0;
  return Math.min(100, Math.max(0, (Number(used ?? 0) / cap) * 100));
};

const byToken = (tokens: number, reserve: number) => Math.max(0, Math.floor(tokens / reserve));
const isAdminSession = (session?: AuthSession | null) => (
  Boolean(session && !session.supportAccess && session.platformAdmin === true)
);

const ADMIN_PAGE_GUIDES: Partial<Record<Page, Array<{ label: string; target: string }>>> = {
  admin: [
    { label: '试用账号', target: 'admin-trial-accounts' },
    { label: '客户账号', target: 'admin-customer-accounts' },
    { label: '行业账号', target: 'admin-industry-accounts' },
  ],
  adminDelivery: [
    { label: '内容运维', target: 'customer-content-ops' },
    { label: '客户部署', target: 'customer-deployment' },
  ],
};

function AdminPageGuide({ page }: { page: Page }) {
  const items = ADMIN_PAGE_GUIDES[page];
  if (!items?.length) return null;

  const jumpTo = (target: string) => {
    document.getElementById(target)?.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
  };

  return (
    <div className="mx-3 rounded-lg border border-border bg-white p-2 shadow-sm">
      <div className="flex items-center gap-2 px-1.5 pb-1.5 text-[11px] font-semibold text-text-secondary">
        <ListTree size={14} className="text-accent" />
        功能导览
      </div>
      <div className="space-y-0.5">
        {items.map(item => (
          <button
            key={item.target}
            type="button"
            onClick={() => jumpTo(item.target)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <span>{item.label}</span>
            <ChevronRight size={13} className="text-text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Layout({ page, onNavigate, onPrefetchPage, conversation, children, session, onLogout, suppressRightPanel, onAction, onSessionUpdate, demoGuideActive, onDemoGuideShown, starterMode = false }: LayoutProps) {
  const reducedMotion = usePrefersReducedMotion();
  const spatialTransition = reducedMotion ? { duration: 0 } : {
    ...lsMotion.spring.standard,
    opacity: { duration: lsMotion.duration.enter / 1000, ease: lsMotion.ease.enter },
  };
  const isInConversation = conversation !== null && !suppressRightPanel;
  const [quotaOpen, setQuotaOpen] = useState(false);
  const quotaAreaRef = useRef<HTMLDivElement>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState('');
  const [quotaUpdatedAt, setQuotaUpdatedAt] = useState<number | null>(null);
  const [liveSession, setLiveSession] = useState<AuthSession | null>(null);
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
  const [mobileViewport, setMobileViewport] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  ));
  const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
  const sidebarCollapsed = mobileViewport ? !mobileSidebarExpanded : desktopSidebarCollapsed;
  const sidebarWidth = sidebarCollapsed ? (mobileViewport ? 56 : 60) : 176;
  const sessionScope = session?.demo?.guideScope || session?.demo?.expiresAt || null;
  const liveSessionScope = liveSession?.demo?.guideScope || liveSession?.demo?.expiresAt || null;
  const sessionIdentityScope = `${session?.user?.id || ''}:${session?.tenant?.id || ''}:${session?.supportAccess?.requestId || ''}:${sessionScope || ''}`;
  const liveSessionIdentityScope = `${liveSession?.user?.id || ''}:${liveSession?.tenant?.id || ''}:${liveSession?.supportAccess?.requestId || ''}:${liveSessionScope || ''}`;
  const activeSession = liveSession && liveSessionIdentityScope === sessionIdentityScope ? liveSession : session;
  const guideScope = activeSession?.demo?.guideScope || (activeSession?.demo?.expiresAt ? `${activeSession.user.id}:${activeSession.demo.expiresAt}` : activeSession?.user?.id || 'demo-guide');
  const supportAccess = activeSession?.supportAccess;
  const organizationRole = activeSession?.user.role || 'customer_service';
  const allowedPages = ROLE_PAGE_ACCESS[organizationRole];
  const roleSections = NAV_SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => allowedPages.has(item.id)) }))
    .filter(section => section.items.length > 0);
  const customerSections = starterMode
    ? roleSections
      .map(section => ({ ...section, items: section.items.filter(item => item.id !== 'digitalEmployees' && item.id !== 'strategy') }))
      .filter(section => section.items.length > 0)
    : roleSections;
  const navSections = isAdminSession(activeSession) ? [...customerSections, ADMIN_NAV] : customerSections;
  const homeNavItem = starterMode ? STARTER_HOME_NAV_ITEM : HOME_NAV_ITEM;

  const leaveSupportSession = () => {
    if (!exitSupportSession()) authApi.logout();
    window.location.assign('/');
  };

  useEffect(() => {
    setLiveSession(null);
  }, [sessionIdentityScope]);
  useEffect(() => {
    if (starterMode) setQuotaOpen(false);
  }, [starterMode]);
  useEffect(() => {
    if (!isInConversation) setMobileRightPanelOpen(false);
  }, [isInConversation]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const syncViewport = () => {
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
  useDismissibleLayer(quotaOpen || accountMenuOpen, quotaAreaRef, () => {
    setQuotaOpen(false);
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
  const suggestedChats = Math.min(demo?.remaining.aiChat ?? 0, byToken(remainingTokens, 1600));
  const suggestedGenerations = Math.min(demo?.remaining.generation ?? 0, byToken(remainingTokens, 1200));
  const suggestedVideoJobs = Math.min(demo?.totalRemaining?.videoGeneration ?? demo?.remaining.videoGeneration ?? 0, byToken(remainingTokens, 2000));
  const suggestedVideoSeconds = suggestedVideoJobs * 8;
  const suggestedAiVideoAnalyses = Math.min(suggestedGenerations, byToken(remainingTokens, 1200));
  const isTrialAccount = Boolean(
    activeSession?.demo?.enabled ||
    activeSession?.tenant?.subscriptionPlan === 'trial' ||
    activeSession?.subscription?.plan === 'trial' ||
    subStatus === 'trialing'
  );
  const showDemoGuide = Boolean(demoGuideActive && (activeSession?.demo?.enabled || isTrialAccount));
  const refreshQuota = async () => {
    setQuotaLoading(true);
    setQuotaError('');
    try {
      const latest = await authApi.me();
      setLiveSession(latest);
      onSessionUpdate?.(latest);
      setQuotaUpdatedAt(Date.now());
    } catch (error) {
      setQuotaError(error instanceof Error ? error.message : '额度读取失败，请稍后重试');
    } finally {
      setQuotaLoading(false);
    }
  };
  const openQuota = () => {
    setAccountMenuOpen(false);
    setQuotaOpen(true);
    void refreshQuota();
  };
  const navigateFromSidebar = (nextPage: Page) => {
    if (mobileViewport) setMobileSidebarExpanded(false);
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
    else setDesktopSidebarCollapsed(value => !value);
  };

  return (
    <div className="app-shell flex h-[100dvh] min-h-0 min-w-0 overflow-hidden">

      <ActionFeedbackHost />

      {/* ── Left sidebar ─────────────────────────────── */}
      {page !== 'agentMonitor' && <motion.aside
        initial={false}
        animate={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
        transition={spatialTransition}
        className="app-sidebar relative z-40 flex flex-shrink-0 flex-col overflow-visible border-r border-border"
      >
        {/* Logo */}
        <div className={`relative h-12 flex items-center flex-shrink-0 ${sidebarCollapsed ? 'justify-center px-2' : 'px-3 gap-2'}`}>
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
          <NavItem
            item={homeNavItem}
            active={page === homeNavItem.id}
            onClick={() => navigateFromSidebar(homeNavItem.id)}
            onPrefetch={() => onPrefetchPage?.(homeNavItem.id)}
            collapsed={sidebarCollapsed}
          />
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {navSections.map((section, index) => (
            <div key={section.label}>
              {index > 0 && <div className={`mx-4 border-t border-border ${sidebarCollapsed ? 'my-1' : 'my-1.5'}`} />}
              <nav aria-label={section.label} className={sidebarCollapsed ? 'px-2' : 'px-3'}>
                {!sidebarCollapsed && <p className="px-3 pb-1 pt-0.5 ls-type-body-small font-semibold text-text-muted uppercase tracking-wider">{section.label}</p>}
                {section.items.map(item => (
                  <NavItem
                    key={item.id}
                    item={item}
                    active={page === item.id || PAGE_REGISTRY[page].navParent === item.id}
                    onClick={() => navigateFromSidebar(item.id)}
                    onPrefetch={() => onPrefetchPage?.(item.id)}
                    collapsed={sidebarCollapsed}
                  />
                ))}
              </nav>
            </div>
          ))}

          {!starterMode && !sidebarCollapsed && <AdminPageGuide page={page} />}
        </div>

        {/* Bottom user */}
        <div ref={quotaAreaRef} className="relative px-3 py-3 border-t border-border flex-shrink-0">
          <AnimatePresence>
            {quotaOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                role="dialog"
                aria-label="Token 使用"
                className="absolute left-3 bottom-[68px] z-50 max-h-[calc(100dvh-96px)] w-[min(324px,calc(100vw-88px))] overflow-y-auto rounded-2xl border border-border bg-white p-3 shadow-xl"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs font-bold text-text-primary">Token 使用</p>
                    <p className="ls-type-body-small text-text-muted mt-0.5">
                      {quotaUpdatedAt ? `${relTime(quotaUpdatedAt)}刷新` : '打开时自动刷新'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => void refreshQuota()} disabled={quotaLoading} title="刷新额度"
                      className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors disabled:opacity-60">
                      {quotaLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                    </button>
                    <button onClick={() => setQuotaOpen(false)} title="关闭"
                      className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {quotaError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3">
                    <p className="text-xs font-semibold text-red-700">额度读取失败</p>
                    <p className="mt-1 ls-type-body-small leading-relaxed text-red-600">{quotaError}</p>
                    <button type="button" onClick={() => void refreshQuota()} disabled={quotaLoading} className="mt-2 ls-type-body-small font-bold text-red-700 underline disabled:opacity-60">重新读取</button>
                  </div>
                ) : demo && isTrialAccount ? (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-surface-2 border border-border px-3 py-2.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] font-semibold text-text-secondary">剩余 Token</span>
                        <span className="text-lg font-bold text-text-primary">{formatTokens(remainingTokens)}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden border border-border">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${pct(demo.usage.tokens, demo.limits.tokenDaily)}%` }}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 ls-type-body-small">
                        <div>
                          <p className="text-text-muted">今日已用</p>
                          <p className="font-bold text-text-primary">{formatTokens(demo.usage.tokens)} / {formatTokens(demo.limits.tokenDaily)}</p>
                        </div>
                        <div>
                          <p className="text-text-muted">总计已用</p>
                          <p className="font-bold text-text-primary">{formatTokens(demo.totalUsage?.tokens)} / {formatTokens(demo.limits.tokenTotal)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-white border border-border px-3 py-2.5">
                      <p className="text-[11px] font-bold text-text-primary mb-2">建议可用量</p>
                      <div className="space-y-1.5 ls-type-body-small text-text-secondary">
                        <div className="flex items-center justify-between gap-3">
                          <span>顾问对话</span>
                          <span className="font-bold text-text-primary">约 {suggestedChats} 轮</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>脚本/文案/选材生成</span>
                          <span className="font-bold text-text-primary">约 {suggestedGenerations} 次</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>视频爬取</span>
                          <span className="font-bold text-text-primary">YouTube 不吃 token</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>爆款视频抓取</span>
                          <span className="font-bold text-text-primary">建议轻量爬取</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>视频 AI 分析</span>
                          <span className="font-bold text-text-primary">约 {suggestedAiVideoAnalyses} 条</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>AI 视频生成</span>
                          <span className="font-bold text-text-primary">约 {suggestedVideoJobs} 条 / {suggestedVideoSeconds} 秒</span>
                        </div>
                      </div>
                      <p className="mt-2 text-[9px] leading-relaxed text-text-muted">
                        估算按短对话 1.6k、普通生成 1.2k、视频生成 2k token 预留；爆款视频抓取 token 消耗大，建议轻量爬取。
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ['对话', demo.remaining.aiChat, demo.limits.aiChatDaily],
                        ['普通生成', demo.remaining.generation, demo.limits.generationDaily],
                        ['预览渲染', demo.remaining.render, demo.limits.renderDaily],
                        ['视频生成', demo.totalRemaining?.videoGeneration ?? demo.remaining.videoGeneration ?? 0, demo.limits.videoGenerationDaily],
                      ].map(([label, left, limit]) => (
                        <div key={String(label)} className="rounded-xl border border-border bg-white px-2.5 py-2">
                          <p className="ls-type-body-small text-text-muted">{label}</p>
                          <p className="mt-0.5 text-sm font-bold text-text-primary">{left}<span className="ls-type-body-small font-medium text-text-muted"> / {limit}</span></p>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-accent-glow px-3 py-2">
                      <span className="ls-type-body-small font-semibold text-text-secondary">试用状态</span>
                      <span className={`ls-type-body-small font-bold ${demo.expired ? 'text-red-600' : 'text-accent'}`}>
                        {demo.expired ? '已到期' : `剩余 ${demo.daysRemaining ?? '-'} 天`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-surface-2 border border-border px-3 py-3">
                    <p className="text-xs font-semibold text-text-primary">当前账号无试用 Token 配额</p>
                    <p className="ls-type-body-small text-text-muted mt-1">正式订阅账号不展示测试版额度；如需核对用量，请联系管理员。</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {accountMenuOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute bottom-[68px] left-3 z-50 w-[260px] rounded-2xl border border-border bg-white p-3 shadow-xl">
                <div className="flex items-center gap-3 border-b border-border px-2 pb-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${isJiangZheTestAccount ? 'border border-border bg-surface-2 text-transparent' : 'bg-accent text-white'}`}>{isJiangZheTestAccount ? '' : initial}</span>
                  <div className="min-w-0"><p className="truncate text-sm font-bold text-text-primary">{accountDisplayName}</p><p className="truncate ls-type-body-small text-text-muted">{activeSession?.user?.email}</p></div>
                </div>
                <div className="pt-2">
                  {!starterMode && <button onClick={openQuota} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><Coins size={17} /><span className="flex-1 text-left">积分管理</span><ChevronRight size={14} className="text-text-muted" /></button>}
                  <button onClick={openDigitalEmployeeGuide} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><Sparkles size={17} /><span className="flex-1 text-left">新手引导</span><ChevronRight size={14} className="text-text-muted" /></button>
                  <button onClick={() => { setAccountMenuOpen(false); setMobileRightPanelOpen(false); setAccountSettingsOpen(true); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-2"><Settings size={17} /><span className="flex-1 text-left">账号设置</span><ChevronRight size={14} className="text-text-muted" /></button>
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
                {starterMode ? '198 标准工作区' : demo && isTrialAccount ? `Token 剩余 ${tokenLabel}` : (SUB_LABEL[subStatus] ?? subStatus)}
              </p>
            </button>}
            {!sidebarCollapsed && <ChevronRight size={14} className={`text-text-muted transition-transform ${accountMenuOpen ? '-rotate-90' : ''}`} />}
          </div>
        </div>
      </motion.aside>}

      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onLogout={onLogout}
        canManageEmployees={organizationRole === 'super_admin' || organizationRole === 'admin'}
      />

      {/* ── Main content ─────────────────────────────── */}
      <main className="app-main relative flex min-w-0 flex-1 basis-0 flex-col overflow-hidden">
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
        <LsPageTransition page={page}>{children}</LsPageTransition>
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
