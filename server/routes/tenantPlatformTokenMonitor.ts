import { providerHttp as axios } from '../security/providerHttp.js';
import cron, { type ScheduledTask } from 'node-cron';
import {
  listTenantPlatformApps,
  markTenantPlatformStatus,
  notifyDeliveryTeam,
  upsertTenantPlatformApp,
  type TenantPlatformAppRecord,
} from '../lib/tenantPlatformApps.js';
import { tenantPlatformSecret } from '../security/platformCredentials.js';
import { recordWorkerHeartbeat, registerWorkerHeartbeat } from '../ops/health.js';

let job: ScheduledTask | null = null;
let unregisterHealth: (() => void) | null = null;

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function daysUntil(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.ceil((time - Date.now()) / (24 * 3600 * 1000));
}

function isMetaTokenExpiredError(error: any): boolean {
  const code = error?.response?.data?.error?.code;
  const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
  return Number(code) === 190 || message.includes('error validating access token') || message.includes('session has expired');
}

async function refreshMetaUserToken(app: TenantPlatformAppRecord): Promise<void> {
  const accessToken = tenantPlatformSecret(app, 'access_token');
  const appSecret = tenantPlatformSecret(app, 'app_secret');
  if (!accessToken || !app.app_id || !appSecret) throw new Error('missing_meta_credentials');

  const res = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    timeout: 30_000,
    params: {
      grant_type: 'fb_exchange_token',
      client_id: app.app_id,
      client_secret: appSecret,
      fb_exchange_token: accessToken,
    },
  });
  const nextToken = String(res.data?.access_token || '');
  if (!nextToken) throw new Error('meta_refresh_returned_empty_token');
  const expiresIn = Number(res.data?.expires_in || 60 * 24 * 3600);
  await upsertTenantPlatformApp({
    tenantId: app.tenant_id,
    platform: app.platform,
    accessToken: nextToken,
    tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    status: 'active',
  });
}

export async function checkTenantPlatformTokens(): Promise<void> {
  const apps = await listTenantPlatformApps();
  for (const app of apps) {
    if (app.platform !== 'meta' || app.token_type !== 'user_60d') continue;
    if (daysUntil(app.token_expires_at) >= 14) continue;

    try {
      await refreshMetaUserToken(app);
    } catch (error: any) {
      const expired = isMetaTokenExpiredError(error);
      const errorCode = expired ? 'meta_token_expired' : 'meta_token_refresh_failed';
      const marked = await markTenantPlatformStatus(
        app.id,
        expired ? 'token_expired' : 'error',
        Number(app.credential_revision || 0),
        errorCode,
      );
      // A concurrent reconnect/rotation won the credential revision race. Do
      // not overwrite it or emit a stale incident for the refreshed account.
      if (!marked) continue;
      await notifyDeliveryTeam([
        '[LingShu delivery alert] Meta token needs attention',
        `Tenant: ${app.tenant_id}`,
        `Platform: ${app.platform}`,
        `Status: ${expired ? 'token_expired' : 'error'}`,
        `Error code: ${errorCode}`,
      ].join('\n'));
    }
  }
}

export function initTenantPlatformTokenMonitor(): void {
  if (job) return;
  unregisterHealth = registerWorkerHeartbeat('tenant-platform-token-monitor', {
    staleAfterMs: 26 * 60 * 60_000,
    critical: false,
  });
  recordWorkerHeartbeat('tenant-platform-token-monitor', { state: 'starting' });
  const run = async () => {
    try {
      await checkTenantPlatformTokens();
      recordWorkerHeartbeat('tenant-platform-token-monitor', { state: 'ready', lastScanAt: new Date().toISOString() });
    } catch (error) {
      recordWorkerHeartbeat('tenant-platform-token-monitor', {
        state: 'error',
        error: error instanceof Error ? error.name : 'unknown_error',
      });
      console.error('[tenant-platform-token-monitor] failed:', error instanceof Error ? error.name : 'unknown_error');
    }
  };
  job = cron.schedule('15 3 * * *', () => { void run(); });
  void run();
  console.log('[tenant-platform-token-monitor] initialized');
}

export function stopTenantPlatformTokenMonitor(): void {
  job?.stop();
  job = null;
  unregisterHealth?.();
  unregisterHealth = null;
}
