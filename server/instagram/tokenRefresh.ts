import { refreshInstagramLoginToken } from '../integrations/social.js';
import { sealAccountCredential, socialAccessToken } from '../lib/accountCredentials.js';
import { store } from '../storage/index.js';

interface InstagramTokenAccount {
  id: string;
  platform: string;
  oauthProvider?: string;
  accessToken?: string;
  tokenExpiresAt?: string;
  status?: string;
}

const REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Refresh IG Login tokens before their 60-day expiry. Expired tokens require reconnection. */
export async function refreshExpiringInstagramTokens(now = Date.now()): Promise<void> {
  let page = 1;
  while (true) {
    const batch = await store.list<InstagramTokenAccount>('social_accounts', {
      where: { platform: 'instagram', oauthProvider: 'instagram_login' },
      page,
      perPage: 200,
    });
    for (const account of batch.items) {
      const expiresAt = Date.parse(account.tokenExpiresAt || '');
      if (!Number.isFinite(expiresAt) || expiresAt - now > REFRESH_WINDOW_MS) continue;
      if (expiresAt <= now) {
        await store.update('social_accounts', account.id, { status: 'expired' });
        continue;
      }
      try {
        const currentToken = socialAccessToken(account as unknown as Record<string, unknown>);
        const refreshed = await refreshInstagramLoginToken(currentToken);
        await store.update('social_accounts', account.id, {
          accessToken: sealAccountCredential(refreshed.accessToken),
          tokenExpiresAt: new Date(now + refreshed.expiresIn * 1000).toISOString(),
          status: 'connected',
        });
      } catch (error) {
        console.error('[instagram-token-refresh] account refresh failed', {
          accountId: account.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    if (page >= batch.totalPages) break;
    page += 1;
  }
}
