import StrategyDataBoard from './StrategyDataBoard';
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

export default function StrategyPage({ onAction, onNavigate, includeMockCustomers = false, mockCustomerScope = 'admin', enterpriseHomepageDemo = false }: Props) {
  return (
    <div className="home-dashboard h-full min-h-0 overflow-hidden">
      <StrategyDataBoard
        onAction={onAction}
        onNavigate={onNavigate}
        includeMockCustomers={includeMockCustomers}
        mockCustomerScope={mockCustomerScope}
        enterpriseHomepageDemo={enterpriseHomepageDemo}
      />
    </div>
  );
}
