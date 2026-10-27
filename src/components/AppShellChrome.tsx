import { Suspense } from 'react';
import type { AuthSession } from '../lib/auth';
import type { AgentType, ConversationContext, RestoreSignal } from '../appSession';
import type { Page } from '../pageRegistry';
import { isAgentProductionSession } from '../lib/agentProductionSession';
import { isSocialTaskContextPage, type SocialTaskView } from '../lib/socialTaskContext';
import { OptionalFeatureErrorBoundary } from './AppPageBoundary';
import RuntimeVersionBanner from './RuntimeVersionBanner';
import { GlobalAssistant, SocialTaskContextBar, StarterWorkflowContextBar } from '../appPageModules';
import ContentGenerationQueueModal from './socialContent/ContentGenerationQueueModal';
import { openAgentSettings } from '../lib/contentGenerationQueue';

interface AppShellChromeProps {
  page: Page;
  session: AuthSession;
  starterMode: boolean;
  conversation: ConversationContext | null;
  restore: RestoreSignal | null;
  kickoff: { agent: AgentType; text: string; key: string } | null;
  sessionRefreshError: string;
  smartAssetsView: SocialTaskView;
  onKickoffConsumed: () => void;
  onAction: (agent: AgentType, text: string) => void;
  onSessionRefresh: () => void;
  onNavigate: (page: Page) => void;
}

export default function AppShellChrome({
  page, session, starterMode, conversation, restore, kickoff, sessionRefreshError,
  smartAssetsView, onKickoffConsumed, onAction, onSessionRefresh, onNavigate,
}: AppShellChromeProps) {
  const identity = `${session.tenant?.id || session.user.tenantId}:${session.user.id}`;
  return (
    <>
      <OptionalFeatureErrorBoundary resetKey={`assistant:${identity}`} label="灵小枢">
        <Suspense fallback={null}>
          <GlobalAssistant
            primaryEntry
            key={`assistant:${identity}`}
            page={page}
            persistenceScope={{ tenantId: session.tenant?.id || session.user.tenantId, userId: session.user.id }}
            restore={restore}
            kickoff={kickoff}
            compactMode={starterMode || isAgentProductionSession()}
            suppressForRightSidebar={page !== 'digitalEmployees' && (conversation !== null || page === 'agentMonitor')}
            onKickoffConsumed={onKickoffConsumed}
            onAction={onAction}
            onSessionRefresh={onSessionRefresh}
            onNavigate={onNavigate}
          />
        </Suspense>
      </OptionalFeatureErrorBoundary>
      <OptionalFeatureErrorBoundary resetKey={`content-generation-queue:${identity}`} label="内容生成队列">
        <ContentGenerationQueueModal onOpenAgentSettings={() => { onNavigate('digitalEmployees'); window.setTimeout(openAgentSettings, 0); }}/>
      </OptionalFeatureErrorBoundary>
      <RuntimeVersionBanner showSystemAnnouncement={page === 'strategy'} />
      {sessionRefreshError && <div role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">{sessionRefreshError} <button type="button" className="ml-2 font-semibold underline" onClick={onSessionRefresh}>立即重试</button></div>}
      {starterMode && isSocialTaskContextPage(page) && (
        <Suspense fallback={null}>
          <SocialTaskContextBar page={page} view={page === 'smartAssets' ? smartAssetsView : undefined} onNavigate={onNavigate} />
        </Suspense>
      )}
      {starterMode && page !== 'digitalEmployees' && !isSocialTaskContextPage(page) && (
        <Suspense fallback={null}><StarterWorkflowContextBar page={page} onNavigate={onNavigate} /></Suspense>
      )}
    </>
  );
}
