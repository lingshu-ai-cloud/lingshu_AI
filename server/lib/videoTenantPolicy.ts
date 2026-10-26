import type { DataStore } from '../storage/datastore.js';
import { isDemoMode } from './demo.js';
import { localFallbacksEnabled } from './localFallbackPolicy.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';

/** Shared by the inspiration list and its content-creation reference picker. */
export async function isVideoTestTenantId(store: DataStore, tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  if (localFallbacksEnabled() && currentDataAuthority() !== 'pocketbase' && tenantId.startsWith('local_tenant_')) return true;
  const tenant = await store.getById<Record<string, unknown>>('tenants', tenantId);
  if (isDemoMode()) return true;
  const plan = String(tenant?.subscriptionPlan || '').toLowerCase();
  const status = String(tenant?.subscriptionStatus || '').toLowerCase();
  return plan === 'trial' || plan === 'admin' || status === 'trialing';
}
