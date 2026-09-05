import { useEffect, useState } from 'react';
import type { DigitalEmployeeDeepLink } from '../lib/digitalEmployees';

export function readDeliveryHandoff(raw: string, page: string, now = Date.now()): DigitalEmployeeDeepLink | null {
  try {
    const value = JSON.parse(raw);
    const age = now - Number(value.issuedAt);
    return value.page === page && typeof value.runId === 'string' && typeof value.taskId === 'string' && value.businessRef && Number.isFinite(age) && age >= 0 && age < 15 * 60_000 ? value : null;
  } catch { return null; }
}
export function useDeliveryHandoff(page: string) {
  const [context, setContext] = useState<DigitalEmployeeDeepLink | null>(() => {
    try { return readDeliveryHandoff(sessionStorage.getItem('digitalEmployee.businessDeepLink') || '', page); } catch { return null; }
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.page === page) setContext(readDeliveryHandoff(JSON.stringify({ ...detail, issuedAt: Date.now() }), page));
    };
    window.addEventListener('lingshu:navigate', listener);
    return () => window.removeEventListener('lingshu:navigate', listener);
  }, [page]);
  return context;
}
