import {productionNavigationIdentity} from '../lib/productionNavigation';
import {AUTH_TOKEN_CHANGED_EVENT} from '../lib/auth';
import { useEffect, useState } from 'react';
import type { DigitalEmployeeDeepLink } from '../lib/digitalEmployees';

export function readDeliveryHandoff(raw: string, page: string, now = Date.now()): DigitalEmployeeDeepLink | null {
  try {
    const value = JSON.parse(raw);
    const age = now - Number(value.issuedAt);
    return value.navigationIdentity === productionNavigationIdentity() && value.page === page && typeof value.runId === 'string' && typeof value.taskId === 'string' && value.businessRef && Number.isFinite(age) && age >= 0 && age < 15 * 60_000 ? value : null;
  } catch { return null; }
}
export function useDeliveryHandoff(page: string) {
  const [context, setContext] = useState<DigitalEmployeeDeepLink | null>(() => {
    try { return readDeliveryHandoff(sessionStorage.getItem('digitalEmployee.businessDeepLink') || '', page); } catch { return null; }
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.page === page) setContext(readDeliveryHandoff(JSON.stringify({ ...detail, navigationIdentity:detail.navigationIdentity??productionNavigationIdentity(), issuedAt: Date.now() }), page));
      else setContext(null);
    };
    let navigationIdentity=productionNavigationIdentity();
    const clear=()=>{const next=productionNavigationIdentity();if(next===navigationIdentity)return;navigationIdentity=next;setContext(null);try{sessionStorage.removeItem('digitalEmployee.businessDeepLink');}catch{/* Optional storage. */}};
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,clear);window.addEventListener('storage',clear);
    window.addEventListener('lingshu:navigate', listener);
    return () => {window.removeEventListener('lingshu:navigate', listener);window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,clear);window.removeEventListener('storage',clear);};
  }, [page]);
  return context;
}
