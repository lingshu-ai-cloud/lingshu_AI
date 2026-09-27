import { AnimatePresence, motion } from 'framer-motion';
import type { Page } from '../App';

export type AssistantExpression = 'happy' | 'wink' | 'thinking' | 'excited';
export const PAGE_EXPRESSION: Record<Page, AssistantExpression> = {
  digitalEmployees: 'excited', agentMonitor: 'thinking', strategy: 'happy', socialWorkspace: 'thinking', socialSetup: 'thinking', socialAccounts: 'thinking', socialPlanning: 'thinking', traffic: 'excited', socialInspiration: 'excited', scriptLibrary: 'thinking', smartAssets: 'excited', socialMonitoring: 'thinking', accountManagement: 'thinking', adsOverview: 'thinking', adsPlans: 'excited', adsCreatives: 'thinking', adsManaged: 'thinking', conversion: 'thinking', wecomCustomerService: 'thinking', retention: 'happy', orders: 'wink', enterprise: 'thinking', agentMemory: 'thinking', plugins: 'excited', scheduled: 'wink', admin: 'thinking', adminDelivery: 'thinking', channels: 'excited', youtube: 'excited', organizationPermissions: 'thinking',
};
const CROP_LEFT: Record<AssistantExpression, number> = { happy: -26, wink: -97, thinking: -169, excited: -241 };

export default function AssistantLauncherMascot({ expression }: { expression: AssistantExpression }) {
  return <span className="pointer-events-none relative block h-[72px] w-[60px] select-none overflow-hidden" aria-hidden="true">
    <AnimatePresence initial={false} mode="wait"><motion.span key={expression} className="absolute inset-0" initial={{ opacity: 0, scale: 0.9, rotate: -3 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.92, rotate: 3 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
      <img src="/lingshu-expressions-body-transparent.png" alt="" draggable={false} className="pointer-events-none absolute top-[-36px] h-auto max-w-none select-none drop-shadow-[0_5px_8px_rgba(52,196,113,0.14)]" style={{ left: CROP_LEFT[expression], width: 329 }} />
    </motion.span></AnimatePresence>
  </span>;
}
