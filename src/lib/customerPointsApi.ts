import type { CustomerPointsSummary } from '../../shared/contracts/customerPoints';
import type { ProductPointRate } from '../../shared/pointsPolicy';
import { authHeader } from './auth';

const BASE = '/api/overseas/billing/points';

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { headers: authHeader(), cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '积分账户读取失败');
  return payload as T;
}

export const customerPointsApi = {
  summary: () => read<CustomerPointsSummary>('/summary'),
  rateCard: () => read<{ version: string; items: ProductPointRate[] }>('/rate-card'),
};
