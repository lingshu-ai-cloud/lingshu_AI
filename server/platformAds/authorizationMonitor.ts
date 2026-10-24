import { store } from '../storage/index.js';
import { AD_CONNECTIONS, checkConnectionAuthorization, type AdConnection } from './connections.js';
import { withPlatformAdTaskLock } from './taskLock.js';
import { sweepExpiredOAuthStates } from './oauthSessions.js';

type MonitorPorts = {
  list: (page: number) => Promise<{ items: AdConnection[]; totalPages: number }>;
  check: (tenantId: string, id: string) => Promise<unknown>;
  now: () => number;
};
const defaults: MonitorPorts = {
  list: page => store.list<AdConnection>(AD_CONNECTIONS, { where: { provider: 'meta' }, page, perPage: 100 }),
  check: (tenantId, id) => withPlatformAdTaskLock(tenantId, `authorization-check-${id}`, () => checkConnectionAuthorization(tenantId, id)),
  now: Date.now,
};
/** GET-only provider inspections. No refresh, ads, billing, emails or external notifications. */
export async function scanAdAuthorizations(ports: MonitorPorts = defaults) {
  const summary = { checked: 0, skipped: 0, failed: 0 };
  for (let page = 1;; page++) {
    const rows = await ports.list(page);
    for (const row of rows.items) {
      const checked = Date.parse(row.authorization?.checkedAt || '');
      if (row.provider !== 'meta' || !row.tokenCipher || row.authorization?.status === 'revoked'
        || Number.isFinite(checked) && checked > ports.now() - 24 * 3600000) { summary.skipped++; continue; }
      try { await ports.check(row.tenant_id, row.id); summary.checked++; }
      catch { summary.failed++; } // Keep prior grant evidence on transient errors; report aggregate failure.
    }
    if (page >= rows.totalPages) return summary;
  }
}
/** Owned by the existing background-job runtime. Explicit opt-in; local web preview never starts it. */
export function startAdAuthorizationMonitor(options: { enabled?: boolean; scan?: () => Promise<unknown> } = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_ADS_AUTH_HEALTH_ENABLED === 'true')) return () => {};
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { console.log('[platform-ads-authorization-health]', await (options.scan || scanAdAuthorizations)()); }
    catch { console.error('[platform-ads-authorization-health] scan unavailable'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60 * 60_000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}

/** Temporary OAuth grants are cleared locally even while provider health polling is disabled. */
export function startAdOAuthSessionCleanup() {
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await sweepExpiredOAuthStates(); }
    catch { console.error('[platform-ads-oauth-cleanup] local cleanup unavailable'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 5 * 60_000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
