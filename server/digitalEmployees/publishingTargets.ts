import { store } from '../storage/index.js';
import type { PublishingPlatform, PublishingTarget } from './domain.js';

interface SocialAccountRecord {
  id: string;
  tenantId: string;
  platform: Exclude<PublishingPlatform, 'youtube'>;
  title?: string;
  handle?: string;
  status?: string;
}

interface YouTubeAccountRecord {
  id: string;
  tenantId: string;
  channelTitle?: string;
  customUrl?: string;
  status?: string;
}

export interface ConnectedPublishingAccount extends PublishingTarget {
  status: 'connected';
}

const text = (value: unknown): string => String(value ?? '').trim();

export async function listConnectedPublishingAccounts(tenantId: string): Promise<ConnectedPublishingAccount[]> {
  const [social, youtube] = await Promise.all([
    store.list<SocialAccountRecord>('social_accounts', { where: { tenantId }, perPage: 200 }),
    store.list<YouTubeAccountRecord>('youtube_accounts', { where: { tenantId }, perPage: 200 }),
  ]);
  return [
    ...social.items
      .filter(account => account.status === 'connected' && ['facebook', 'instagram', 'tiktok'].includes(account.platform))
      .map(account => ({
        platform: account.platform,
        accountId: account.id,
        accountLabel: text(account.title) || text(account.handle) || account.id,
        status: 'connected' as const,
      })),
    ...youtube.items
      .filter(account => account.status === 'connected')
      .map(account => ({
        platform: 'youtube' as const,
        accountId: account.id,
        accountLabel: text(account.channelTitle) || text(account.customUrl) || account.id,
        status: 'connected' as const,
      })),
  ];
}

/**
 * Never trust labels or platform names posted by the browser. Every target is
 * re-bound to a currently connected account owned by the authenticated tenant.
 */
export async function bindPublishingTargets(
  tenantId: string,
  requested: PublishingTarget[],
): Promise<{ targets: PublishingTarget[]; invalidAccountIds: string[] }> {
  const connected = await listConnectedPublishingAccounts(tenantId);
  const byId = new Map(connected.map(account => [account.accountId, account]));
  const invalidAccountIds: string[] = [];
  const targets: PublishingTarget[] = [];
  for (const requestedTarget of requested) {
    const account = byId.get(text(requestedTarget.accountId));
    if (!account || account.platform !== requestedTarget.platform) {
      invalidAccountIds.push(text(requestedTarget.accountId));
      continue;
    }
    if (!targets.some(target => target.platform === account.platform && target.accountId === account.accountId)) {
      targets.push({ platform: account.platform, accountId: account.accountId, accountLabel: account.accountLabel });
    }
  }
  return { targets, invalidAccountIds: invalidAccountIds.filter(Boolean) };
}

export function publishingTargetPlatforms(targets: PublishingTarget[]): PublishingPlatform[] {
  return [...new Set(targets.map(target => target.platform))];
}
