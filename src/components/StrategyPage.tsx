import ContentCreationHome from './ContentCreationHome';
import TrafficPage from './TrafficPage';
import { PAGE_REGISTRY } from '../pageRegistry';
import type { AgentAction, ConversationContext, KickoffSignal, Page, RestoreSignal } from '../App';

interface Props {
  sessionScope: string;
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation?: () => void;
  isInConversation?: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onNavigate?: (page: Page) => void;
  onSessionRefresh?: () => void;
  includeMockCustomers?: boolean;
  mockCustomerScope?: string;
  enterpriseHomepageDemo?: boolean;
}

export default function StrategyPage({ sessionScope, onNavigate, onEnterConversation, onLeaveConversation, restore, kickoff, onAction, onSessionRefresh }: Props) {
  return (
    <div className="home-dashboard h-full min-h-0 overflow-hidden">
      <h1 className="sr-only">{PAGE_REGISTRY.strategy.canonicalTitle}</h1>
      <ContentCreationHome sessionScope={sessionScope} onNavigate={onNavigate} inspirationWorkspace={
        <TrafficPage
          sourcePage="strategy"
          onEnterConversation={onEnterConversation}
          onLeaveConversation={onLeaveConversation || (() => {})}
          isInConversation={false}
          onNavigate={onNavigate}
          restore={restore}
          kickoff={kickoff}
          onAction={onAction}
          onSessionRefresh={onSessionRefresh}
          initialView="materials"
          showModeTabs={false}
          pageTitle="爆款素材"
          embeddedInspiration
        />
      }/>
    </div>
  );
}
