import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutGrid, BarChart3 } from 'lucide-react';
import AgentWorkspace from './AgentWorkspace';
import StrategyDataBoard from './StrategyDataBoard';
import type { AgentAction, ConversationContext, KickoffSignal, Page, RestoreSignal } from '../App';
import { PAGE_REGISTRY } from '../pageRegistry';

type ViewMode = 'workspace' | 'board';

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
}

export default function StrategyPage({ onAction, onNavigate, includeMockCustomers = false, mockCustomerScope = 'admin' }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('board');

  return (
    <div className="flex flex-col h-full">
      <header className="home-header flex items-center justify-between gap-4 border-b px-5 py-3 flex-shrink-0 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-semibold tracking-[-.025em] text-text-primary">{PAGE_REGISTRY.strategy.canonicalTitle}</h1>
          <p className="mt-0.5 hidden text-[11px] text-text-muted sm:block">从经营信号中找到今天最重要的动作</p>
        </div>
        <div className="flex items-center gap-5 self-stretch">
          {([
            { mode: 'board' as ViewMode, icon: <BarChart3 size={13} />, label: '经营概览' },
            { mode: 'workspace' as ViewMode, icon: <LayoutGrid size={12} />, label: '策略工作台' },
          ]).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 border-b-2 px-0 py-1 text-xs font-semibold transition-colors ${viewMode === mode ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="home-dashboard flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'board' ? (
            <motion.div key="board" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <StrategyDataBoard onAction={onAction} onNavigate={onNavigate} includeMockCustomers={includeMockCustomers} mockCustomerScope={mockCustomerScope} />
            </motion.div>
          ) : (
            <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentWorkspace />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
