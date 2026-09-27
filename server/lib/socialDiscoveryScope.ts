import { store } from '../storage/index.js';
import type { SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow.js';

export async function readSavedDiscoveryScope(tenantId: string): Promise<SocialCrawlStrategy | null> {
  const result = await store.list<{ id: string; payload: SocialCrawlStrategy }>('social_discovery_scopes', {
    where: { tenant_id: tenantId, status: 'active' }, sort: '-updated_at', page: 1, perPage: 1,
  });
  return result.items[0]?.payload ?? null;
}
