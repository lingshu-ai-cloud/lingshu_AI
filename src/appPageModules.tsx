import { lazy } from 'react';
import type { Page } from './pageRegistry';
import type { EnterpriseProductsDeepLink } from './components/EnterprisePage';
import { PLATFORM_ADS_PAGE_IDS } from './config/productSurfaceFlags';

const loadPlatformAdsPage = () => import('./components/PlatformAdsPage');
const loadStrategyPage = () => import('./components/StrategyPage');
const loadContentCreationOverviewPage = () => import('./components/ContentCreationOverviewPage');
const loadTrafficPage = () => import('./components/TrafficPage');
const loadConversionPage = () => import('./components/ConversionPage');
const loadEnterprisePage = () => import('./components/EnterprisePage');
const loadIntegrationsPage = () => import('./components/IntegrationsPage');
const loadAdminDashboard = () => import('./components/AdminDashboard');
const loadAdminDeliveryPage = () => import('./components/AdminDeliveryPage');
async function retryDynamicModule<T>(loader: () => Promise<T>, retryLoader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch {
    await new Promise(resolve => window.setTimeout(resolve, 250));
    // Browsers keep a failed ES module URL in the module map. Retry through a
    // statically bundled, distinct URL so a recovered Vite server is actually
    // contacted instead of immediately returning the cached rejection.
    return retryLoader();
  }
}
const loadGlobalAssistant = () => retryDynamicModule(
  () => import('./components/GlobalAssistant'),
  // @ts-expect-error Vite resource-query retry URL.
  () => import('./components/GlobalAssistant?recovery'),
);
const loadWorkspaceManagementPages = () => import('./components/WorkspaceManagementPages');
const loadDigitalEmployeePage = () => import('./components/DigitalEmployeePage');
const loadAgentMonitorPage = () => import('./components/AgentMonitorPage');
const loadStarterWorkspacePage = () => import('./components/starter/StarterWorkspacePage');
const loadSocialContentPlanningPage = () => import('./components/socialContent/SocialContentPlanningPage');
const loadSocialTaskContextBar = () => import('./components/starter/SocialTaskContextBar');
const loadStarterWorkflowContextBar = () => import('./components/starter/StarterWorkflowContextBar');

const PlatformAdsPage = lazy(loadPlatformAdsPage);
const StrategyPage = lazy(loadStrategyPage);
const ContentCreationOverviewPage = lazy(loadContentCreationOverviewPage);
const TrafficPage = lazy(loadTrafficPage);
const ConversionPage = lazy(loadConversionPage);
const EnterprisePage = lazy(loadEnterprisePage);
const IntegrationsPage = lazy(loadIntegrationsPage);
const AdminDashboard = lazy(loadAdminDashboard);
const AdminDeliveryPage = lazy(loadAdminDeliveryPage);
const GlobalAssistant = lazy(loadGlobalAssistant);
const AssistantWeeklyProductionView = lazy(() => import('./components/assistant/AssistantWeeklyProductionView'));
const AgentMemoryPage = lazy(() => loadWorkspaceManagementPages().then(module => ({ default: module.AgentMemoryPage })));
const OrganizationPermissionsPage = lazy(() => loadWorkspaceManagementPages().then(module => ({ default: module.OrganizationPermissionsPage })));
const ScriptLibraryPage = lazy(() => loadWorkspaceManagementPages().then(module => ({ default: module.ScriptLibraryPage })));
const DigitalEmployeePage = lazy(loadDigitalEmployeePage);
const AgentMonitorPage = lazy(loadAgentMonitorPage);
const StarterWorkspacePage = lazy(loadStarterWorkspacePage);
const SocialContentPlanningPage = lazy(loadSocialContentPlanningPage);
const SocialTaskContextBar = lazy(loadSocialTaskContextBar);
const StarterWorkflowContextBar = lazy(loadStarterWorkflowContextBar);
const DesignPrototype = import.meta.env.DEV ? lazy(() => import('./dev/DesignPrototype')) : null;
const SmartBusinessPreview = import.meta.env.DEV ? lazy(() => import('./dev/SmartBusinessPreview')) : null;

type PageModuleLoader = () => Promise<unknown>;
const ADS_PAGES: Page[] = [...PLATFORM_ADS_PAGE_IDS], INTEGRATION_PAGES: Page[] = ['plugins', 'channels', 'youtube'];

const PAGE_MODULE_LOADERS: Partial<Record<Page, PageModuleLoader[]>> = {
  digitalEmployees: [loadDigitalEmployeePage],
  agentMonitor: [loadAgentMonitorPage],
  strategy: [loadStrategyPage],
  traffic: [loadTrafficPage, () => import('./components/publishing/CalendarPlanner')],
  socialInspiration: [loadContentCreationOverviewPage],
  inspirationMarket: [loadTrafficPage, () => import('./components/InspirationDashboard')],
  smartAssets: [loadTrafficPage, () => import('./components/AiCreateStudio'), loadSocialContentPlanningPage],
  socialMonitoring: [loadTrafficPage, () => import('./components/AccountActivity')],
  scriptLibrary: [loadWorkspaceManagementPages],
  adsOverview: [loadPlatformAdsPage],
  adsPlans: [loadPlatformAdsPage],
  adsCreatives: [loadPlatformAdsPage],
  adsManaged: [loadPlatformAdsPage],
  conversion: [loadConversionPage],
  enterprise: [loadEnterprisePage],
  agentMemory: [loadWorkspaceManagementPages],
  organizationPermissions: [loadWorkspaceManagementPages],
  plugins: [loadIntegrationsPage],
  channels: [loadIntegrationsPage],
  youtube: [loadIntegrationsPage],
  admin: [loadAdminDashboard],
  adminDelivery: [loadAdminDeliveryPage],
};

const prefetchedPages = new Set<Page>();
function prefetchPageModule(page: Page) {
  if (prefetchedPages.has(page)) return;
  prefetchedPages.add(page);
  for (const loader of PAGE_MODULE_LOADERS[page] || []) void loader().catch(() => prefetchedPages.delete(page));
}

const isLocalPreviewHost = () => window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

export function normalizeEnterpriseProductsDeepLink(detail: unknown): EnterpriseProductsDeepLink | null {
  if (!detail || typeof detail !== 'object') return null;
  const candidate = detail as Record<string, unknown>;
  if (candidate.page !== 'enterprise' || candidate.view !== 'products') return null;
  const materialIds = Array.isArray(candidate.materialIds)
    ? [...new Set(candidate.materialIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 30)
    : [];
  return {
    productName: String(candidate.productName || '').trim().slice(0, 180),
    materialIds,
    contentItemId: String(candidate.contentItemId || '').trim().slice(0, 160),
  };
}

function scheduleLocalPreviewPreload(preferredPage: Page) {
  if (!isLocalPreviewHost()) return () => {};
  // Compile only the visible page. Other workspaces are warmed on navigation
  // intent so background transforms cannot delay the user's current clicks.
  const uniqueQueue = [...new Set(PAGE_MODULE_LOADERS[preferredPage] || [])];
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
      idleId = window.requestIdleCallback(run, { timeout: 4_000 });
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

export { PlatformAdsPage, StrategyPage, ContentCreationOverviewPage, TrafficPage, ConversionPage, EnterprisePage, IntegrationsPage, AdminDashboard, AdminDeliveryPage, GlobalAssistant, AssistantWeeklyProductionView, AgentMemoryPage, OrganizationPermissionsPage, ScriptLibraryPage, DigitalEmployeePage, AgentMonitorPage, StarterWorkspacePage, SocialContentPlanningPage, SocialTaskContextBar, StarterWorkflowContextBar, DesignPrototype, SmartBusinessPreview, ADS_PAGES, INTEGRATION_PAGES, prefetchPageModule, scheduleLocalPreviewPreload };
