import { useRef } from 'react';
import { Button } from 'antd';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import type { AssistantNavigationPortal } from '../../lib/assistantNavigationPortal';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

export default function AssistantNavigationPortalCard({ portal }: { portal: AssistantNavigationPortal }) {
  const identity = useRef(productionNavigationIdentity());
  return <article aria-label={`${portal.title}门户`} className="mt-3 flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent" aria-hidden="true"><LayoutDashboard size={22}/></span>
    <div className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-text-primary">{portal.title}</strong><p className="mt-0.5 text-xs text-text-secondary">{portal.description}</p></div>
    <Button color="blue" variant="solid" className="ml-auto" onClick={() => {
      if (identity.current !== productionNavigationIdentity()) return;
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: portal.page, navigationIdentity: identity.current } }));
    }}>前往{portal.title}<ArrowRight size={14}/></Button>
  </article>;
}
