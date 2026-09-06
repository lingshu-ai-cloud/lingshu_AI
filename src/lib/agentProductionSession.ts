import { useEffect, useState } from 'react';
import type { DigitalEmployeeDeepLink } from './digitalEmployees';

export interface AgentProductionTarget {
  link: DigitalEmployeeDeepLink;
  stage?: string;
  projectId?: string;
  customerId?: string;
}
interface Action { id: string; label: string; surface: 'studio' | 'customer' | 'scheduler' }
declare global {
  interface Window {
    __agentProductionTarget?: AgentProductionTarget;
    __agentProductionAction?: Action;
    agentExecute?: (id: string) => Promise<{ error?: string }>;
  }
}
export function isAgentProductionSession() { return Boolean(window.__agentProductionTarget); }
export function useAgentProductionAction(surface: Action['surface']) {
  const [action, setAction] = useState<Action | undefined>(() => window.__agentProductionAction);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setAction(window.__agentProductionAction);
    window.addEventListener('lingshu:agent-action', update);
    update();
    return () => window.removeEventListener('lingshu:agent-action', update);
  }, []);
  const current = action?.surface === surface ? action : undefined;
  return { active: isAgentProductionSession(), action: current, busy, execute: async () => {
    if (!current || !window.agentExecute || busy) return;
    setBusy(true);
    try {
      const result = await window.agentExecute(current.id);
      if (result.error) throw new Error(result.error);
      window.dispatchEvent(new CustomEvent('lingshu:agent-business-refresh'));
    } finally { setBusy(false); }
  } };
}
