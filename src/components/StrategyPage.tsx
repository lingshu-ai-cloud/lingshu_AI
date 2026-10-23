import ContentCreationHome from './ContentCreationHome';
import { PAGE_REGISTRY } from '../pageRegistry';
import type { AgentAction, ConversationContext, KickoffSignal, Page, RestoreSignal } from '../App';

interface Props {
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

export default function StrategyPage({ onNavigate }: Props) {
  return (
    <div className="home-dashboard h-full min-h-0 overflow-hidden">
      <h1 className="sr-only">{PAGE_REGISTRY.strategy.canonicalTitle}</h1>
      <ContentCreationHome onNavigate={onNavigate}/>
    </div>
  );
}
