import { writebackInteraction, type InteractionKind, type StoredInteractionWriteback } from './writeback.js';

export type EngagementPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'web_form';
export type EngagementSurface = 'comments' | 'direct_messages' | 'forms';

export interface EngagementCapability {
  platform: EngagementPlatform;
  surface: EngagementSurface;
  status: 'available' | 'unavailable';
  reason?: string;
}

export interface PlatformEngagementEvent {
  kind: Extract<InteractionKind, 'comment' | 'direct_message' | 'form'>;
  platform: EngagementPlatform;
  providerEventId: string;
  accountId?: string;
  contentId?: string;
  body: string;
  occurredAt: string;
  actorRef?: string;
  entryRef?: string;
  raw?: unknown;
}

export interface EngagementIngestionAdapter {
  capability: EngagementCapability;
  pull(cursor?: string): Promise<{ events: PlatformEngagementEvent[]; cursor?: string }>;
}

export function declaredEngagementCapabilities(connectedPlatforms: string[] = []): EngagementCapability[] {
  const available = (name: string) => Boolean(process.env[name]?.trim());
  const connected = new Set(connectedPlatforms);
  return [
    { platform: 'youtube', surface: 'comments', status: available('GOOGLE_CLIENT_ID') && connected.has('youtube') ? 'available' : 'unavailable', reason: 'requires_connected_channel_and_comment_scope' },
    { platform: 'facebook', surface: 'comments', status: available('META_APP_ID') && connected.has('facebook') ? 'available' : 'unavailable', reason: 'requires_connected_page_and_comments_scope' },
    { platform: 'facebook', surface: 'direct_messages', status: available('META_APP_ID') && connected.has('facebook') ? 'available' : 'unavailable', reason: 'requires_messaging_webhook_scope' },
    { platform: 'instagram', surface: 'comments', status: available('META_APP_ID') && connected.has('instagram') ? 'available' : 'unavailable', reason: 'requires_connected_business_account_and_comments_scope' },
    { platform: 'instagram', surface: 'direct_messages', status: available('META_APP_ID') && connected.has('instagram') ? 'available' : 'unavailable', reason: 'requires_messaging_webhook_scope' },
    { platform: 'tiktok', surface: 'comments', status: 'unavailable', reason: 'comment_api_permission_not_connected' },
    { platform: 'tiktok', surface: 'direct_messages', status: 'unavailable', reason: 'direct_message_ingestion_not_connected' },
    { platform: 'web_form', surface: 'forms', status: 'available', reason: 'authenticated_server_ingestion' },
  ];
}

export async function ingestEngagementEvents(input: {
  tenantId: string;
  adapter: EngagementIngestionAdapter;
  cursor?: string;
}): Promise<{ capability: EngagementCapability; items: StoredInteractionWriteback[]; repeated: number; cursor?: string }> {
  if (input.adapter.capability.status !== 'available') return { capability: input.adapter.capability, items: [], repeated: 0, cursor: input.cursor };
  const pulled = await input.adapter.pull(input.cursor);
  const items: StoredInteractionWriteback[] = [];
  let repeated = 0;
  for (const event of pulled.events) {
    if (event.platform !== input.adapter.capability.platform) throw new Error('engagement_adapter_platform_mismatch');
    const expectedSurface = event.kind === 'comment' ? 'comments' : event.kind === 'direct_message' ? 'direct_messages' : 'forms';
    if (expectedSurface !== input.adapter.capability.surface) throw new Error('engagement_adapter_surface_mismatch');
    const result = await writebackInteraction(input.tenantId, event);
    items.push(result.item);
    if (result.repeated) repeated += 1;
  }
  return { capability: input.adapter.capability, items, repeated, ...(pulled.cursor ? { cursor: pulled.cursor } : {}) };
}
