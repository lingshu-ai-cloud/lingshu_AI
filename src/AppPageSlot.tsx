import { Activity, Suspense, type Dispatch, type SetStateAction } from 'react';
import { authApi, type AuthSession } from './lib/auth';
import type { Page } from './pageRegistry';
import { PAGE_REGISTRY } from './pageRegistry';
import type { AgentType, ConversationContext, RestoreSignal } from './appSession';
import { pagePreferenceScope } from './appSession';
import type { SocialContentCreateRequest } from './components/socialContent/SocialContentWorkspace';
import type { EnterpriseProductsDeepLink } from './components/EnterprisePage';
import { requestProductionBack, productionNavigationIdentity } from './lib/productionNavigation';
import { readAssistantWeeklyNavigation } from './lib/assistantWeeklyNavigation';
import { isEnterpriseHomepageDemoAccount } from './mocks/enterpriseHomepageDemo';
import { PLATFORM_ADS_SURFACE_ENABLED } from './config/productSurfaceFlags';
import { PageErrorBoundary, PageLoading } from './components/AppPageBoundary';
import {
  PlatformAdsPage, StrategyPage, ContentCreationOverviewPage, TrafficPage, ConversionPage, EnterprisePage,
  IntegrationsPage, AdminDashboard, AdminDeliveryPage, AssistantWeeklyProductionView,
  AgentMemoryPage, OrganizationPermissionsPage, ScriptLibraryPage, DigitalEmployeePage,
  AgentMonitorPage, StarterWorkspacePage, SocialContentPlanningPage,
  ADS_PAGES, INTEGRATION_PAGES,
} from './appPageModules';

interface AppPageSlotProps {
  page: Page;
  session: AuthSession;
  starterMode: boolean;
  weeklyPlanNavigation: { goalId: string; planId: string; requestId: number; identity: string } | null;
  handleNavigate: (page: Page) => void;
  handleSocialContentNavigate: (page: Page, taskId: string) => void;
  mountedPages: Set<Page>;
  enterConversation: (context: ConversationContext) => void;
  leaveConversation: () => void;
  conversation: ConversationContext | null;
  restoreFor: (agent: AgentType) => RestoreSignal | undefined;
  kickoffFor: (agent: AgentType) => { text: string; key: string } | undefined;
  startAgentTask: (agent: AgentType, text: string) => void;
  refreshSession: () => Promise<void>;
  localForeignTradeMock: boolean;
  setScriptPanelOpen: Dispatch<SetStateAction<boolean>>;
  activeSocialContentTaskId: string | null;
  smartAssetsMounted: boolean;
  showSocialContentPlanning: boolean;
  smartAssetsContentTaskId: string | null;
  smartAssetsCreateRequest: SocialContentCreateRequest | null;
  handleLaunchContentStudio: (request: SocialContentCreateRequest) => void;
  smartAssetsInstanceKey: number;
  smartAssetsView: 'create' | 'publish';
  openProjectsSignal: number;
  smartAssetsWorkflowContext: { runId: string; taskId: string; taskKey: string; preview?: boolean; entityId?: string; contentId?: string; referenceId?: string } | null;
  handleOpenContentCreationHome: (openChooser?: boolean) => void;
  handleReturnToContentPlanning: (request: SocialContentCreateRequest) => void;
  lastAdsPage: Page;
  enterpriseProductsDeepLink: EnterpriseProductsDeepLink | null;
  handleSupportSessionStarted: (session: AuthSession) => void;
}

export default function AppPageSlot({
  page, session, starterMode, weeklyPlanNavigation, handleNavigate, handleSocialContentNavigate,
  mountedPages, enterConversation, leaveConversation, conversation, restoreFor, kickoffFor,
  startAgentTask, refreshSession, localForeignTradeMock, setScriptPanelOpen,
  activeSocialContentTaskId, smartAssetsMounted, showSocialContentPlanning, smartAssetsContentTaskId,
  smartAssetsCreateRequest, handleLaunchContentStudio, smartAssetsInstanceKey, smartAssetsView,
  openProjectsSignal, smartAssetsWorkflowContext, handleOpenContentCreationHome,
  handleReturnToContentPlanning, lastAdsPage, enterpriseProductsDeepLink, handleSupportSessionStarted,
}: AppPageSlotProps) {
  return (
      <div data-app-page-slot className="min-h-0 flex-1 overflow-hidden">
        <PageErrorBoundary page={page} onNavigateHome={() => handleNavigate('strategy')}>
          <Suspense fallback={<PageLoading />}>
          <Activity key={pagePreferenceScope(session)} mode={page === 'digitalEmployees' ? 'visible' : 'hidden'}>
            {readAssistantWeeklyNavigation(window.location.search)
              ? <AssistantWeeklyProductionView key={`${session.tenant?.id || session.user.tenantId}:${session.user.id}`} target={readAssistantWeeklyNavigation(window.location.search)!} />
              : starterMode
              ? <StarterWorkspacePage onNavigate={handleNavigate} onNavigateWithTask={handleSocialContentNavigate} />
              : <DigitalEmployeePage active={page === 'digitalEmployees'} weeklyPlanNavigation={weeklyPlanNavigation?.identity === productionNavigationIdentity() ? weeklyPlanNavigation : null} onViewResults={() => handleNavigate('strategy')} onNavigate={handleNavigate} onOpenMonitor={() => handleNavigate('agentMonitor')} />}
          </Activity>
          {(page === 'agentMonitor' || mountedPages.has('agentMonitor')) && <Activity key={`monitor-${pagePreferenceScope(session)}`} mode={page === 'agentMonitor' ? 'visible' : 'hidden'}><AgentMonitorPage onBack={requestProductionBack} /></Activity>}
          {(page === 'strategy' || mountedPages.has('strategy')) && (
            <Activity mode={page === 'strategy' ? 'visible' : 'hidden'}>
            <StrategyPage
              sessionScope={pagePreferenceScope(session)}
              firstRunRequestKey={session.demo?.guideTrigger ? session.demo.guideScope : undefined}
              onFirstRunRestored={() => { void authApi.guideSeen().then(refreshSession); }}
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
              sourcePage="traffic"
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
            <ContentCreationOverviewPage />
            </Activity>
          )}
          {(page === 'inspirationMarket' || mountedPages.has('inspirationMarket')) && (
            <Activity mode={page === 'inspirationMarket' ? 'visible' : 'hidden'}>
              <TrafficPage sourcePage="inspirationMarket" onEnterConversation={enterConversation}
                onLeaveConversation={leaveConversation} isInConversation={conversation?.agent === 'traffic'}
                onNavigate={handleNavigate} onScriptPanelOpen={() => setScriptPanelOpen(true)}
                onScriptPanelClose={() => setScriptPanelOpen(false)} onSessionRefresh={() => void refreshSession()}
                initialView="materials" visibleModes={['materials']} showModeTabs={false}
                pageTitle={PAGE_REGISTRY.inspirationMarket.canonicalTitle} storageScope={session.tenant?.id || session.user.tenantId}/>
            </Activity>
          )}
          {(page === 'smartAssets' || mountedPages.has('smartAssets') || smartAssetsMounted) && (
            <Activity mode={page === 'smartAssets' ? 'visible' : 'hidden'}>
            <div className="h-full min-h-0">
              {showSocialContentPlanning ? (
                <SocialContentPlanningPage
                  taskOnly={Boolean(smartAssetsContentTaskId && !smartAssetsCreateRequest)}
                  onNavigate={handleNavigate}
                  onNavigateWithTask={handleSocialContentNavigate}
                  initialCreateRequest={smartAssetsCreateRequest}
                  onLaunchStudio={handleLaunchContentStudio}
                />
              ) : (
                <TrafficPage
                  key={`smart-assets-${smartAssetsInstanceKey}`}
                  sourcePage="smartAssets"
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
                  onLaunchContentStudio={handleLaunchContentStudio}
                  onReturnToContentPlanning={handleReturnToContentPlanning}
                />
              )}
            </div>
            </Activity>
          )}
          {(page === 'socialMonitoring' || mountedPages.has('socialMonitoring')) && (
            <Activity mode={page === 'socialMonitoring' ? 'visible' : 'hidden'}>
            <TrafficPage
              key="social-monitoring-accounts"
              sourcePage="socialMonitoring"
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
          {PLATFORM_ADS_SURFACE_ENABLED && (ADS_PAGES.includes(page) || ADS_PAGES.some(item => mountedPages.has(item))) && <Activity mode={ADS_PAGES.includes(page) ? 'visible' : 'hidden'}><PlatformAdsPage page={ADS_PAGES.includes(page) ? page : lastAdsPage} onNavigate={handleNavigate} /></Activity>}
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
          {(page === 'enterprise' || mountedPages.has('enterprise')) && <Activity mode={page === 'enterprise' ? 'visible' : 'hidden'}><EnterprisePage productsDeepLink={enterpriseProductsDeepLink} /></Activity>}
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
          {(page === 'admin' || mountedPages.has('admin')) && <Activity mode={page === 'admin' ? 'visible' : 'hidden'}><AdminDashboard onSupportSessionStarted={handleSupportSessionStarted} /></Activity>}
          {(page === 'adminDelivery' || mountedPages.has('adminDelivery')) && <Activity mode={page === 'adminDelivery' ? 'visible' : 'hidden'}><AdminDeliveryPage /></Activity>}
          </Suspense>
        </PageErrorBoundary>
      </div>

  );
}
