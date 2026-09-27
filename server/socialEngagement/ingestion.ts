import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { PlatformCapabilityEvidence } from '../publishing/platformCapabilities.js';
import { writebackInteraction, type InteractionKind, type StoredInteractionWriteback } from './writeback.js';

export type EngagementPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'web_form';
export type EngagementSurface = 'comments' | 'direct_messages' | 'forms';

export interface EngagementCapability {
  platform: EngagementPlatform;
  surface: EngagementSurface;
  status: 'available' | 'unavailable';
  reason?: string;
  accountId?: string;
  verifiedAt?: string;
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
  adapterId?: string;
  capability: EngagementCapability;
  pull(cursor?: string): Promise<{ events: PlatformEngagementEvent[]; cursor?: string }>;
}

export interface EngagementCursorRecord {
  id: string;
  tenant_id: string;
  adapter_id: string;
  platform: EngagementPlatform;
  surface: EngagementSurface;
  account_id: string;
  cursor: string;
  version: number;
  failure_count: number;
  next_retry_at?: string;
  last_error?: string;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export const ENGAGEMENT_CURSORS = 'social_engagement_cursors';

const text = (value: unknown): string => String(value ?? '').trim();
const capabilityName = (surface: EngagementSurface) => surface === 'comments' ? 'engagement.comments' : 'engagement.direct_messages';

export function declaredEngagementCapabilities(input: {
  evidence?: PlatformCapabilityEvidence[];
  webFormConfigured?: boolean;
  now?: Date;
} = {}): EngagementCapability[] {
  const now = (input.now ?? new Date()).getTime();
  const evidence = input.evidence ?? [];
  const decision = (platform: Exclude<EngagementPlatform, 'web_form'>, surface: Exclude<EngagementSurface, 'forms'>, supported: boolean): EngagementCapability => {
    if (!supported) return { platform, surface, status: 'unavailable', reason: 'provider_adapter_not_implemented' };
    const rows = evidence.filter(item => item.platform === platform && item.capability === capabilityName(surface)
      && item.status === 'verified' && item.evidence_ref && Number.isFinite(Date.parse(item.verified_at))
      && (!item.expires_at || Date.parse(item.expires_at) > now));
    return rows.length
      ? { platform, surface, status: 'available', reason: 'provider_capability_verified', verifiedAt: rows.map(item => item.verified_at).sort().at(-1) }
      : { platform, surface, status: 'unavailable', reason: 'provider_permission_not_verified' };
  };
  return [
    decision('youtube', 'comments', true),
    decision('facebook', 'comments', true),
    decision('facebook', 'direct_messages', false),
    decision('instagram', 'comments', true),
    decision('instagram', 'direct_messages', false),
    decision('tiktok', 'comments', false),
    decision('tiktok', 'direct_messages', false),
    { platform: 'web_form', surface: 'forms', status: input.webFormConfigured ? 'available' : 'unavailable', reason: input.webFormConfigured ? 'signed_web_form_source_configured' : 'signed_web_form_source_required' },
  ];
}

async function cursorRecord(input: {
  tenantId: string; adapterId: string; accountId: string; capability: EngagementCapability; dataStore: DataStore;
}): Promise<EngagementCursorRecord | null> {
  const result = await input.dataStore.list<EngagementCursorRecord>(ENGAGEMENT_CURSORS, {
    where: { tenant_id: input.tenantId, adapter_id: input.adapterId, account_id: input.accountId }, page: 1, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) throw new Error('engagement_cursor_integrity_violation');
  const item = result.items[0];
  if (item && (item.platform !== input.capability.platform || item.surface !== input.capability.surface)) throw new Error('engagement_cursor_binding_mismatch');
  return item ?? null;
}

async function saveCursor(input: {
  current: EngagementCursorRecord | null; tenantId: string; adapterId: string; accountId: string;
  capability: EngagementCapability; cursor: string; failureCount: number; nextRetryAt?: string; lastError?: string;
  now: string; dataStore: DataStore;
}): Promise<void> {
  const patch = {
    tenant_id: input.tenantId, adapter_id: input.adapterId, platform: input.capability.platform,
    surface: input.capability.surface, account_id: input.accountId, cursor: input.cursor,
    version: (input.current?.version ?? 0) + 1, failure_count: input.failureCount,
    next_retry_at: input.nextRetryAt ?? '', last_error: input.lastError ?? '',
    ...(input.failureCount === 0 ? { last_synced_at: input.now } : {}), updated_at: input.now,
  };
  if (input.current) {
    if (!await input.dataStore.update(ENGAGEMENT_CURSORS, input.current.id, patch)) throw new Error('engagement_cursor_storage_unavailable');
    return;
  }
  if (!await input.dataStore.create(ENGAGEMENT_CURSORS, { ...patch, created_at: input.now })) throw new Error('engagement_cursor_storage_unavailable');
}

function retryDelayMs(failureCount: number): number {
  return Math.min(15 * 60_000, 5_000 * (2 ** Math.min(Math.max(failureCount - 1, 0), 8)));
}

export async function ingestEngagementEvents(input: {
  tenantId: string;
  adapter: EngagementIngestionAdapter;
  cursor?: string;
  accountId?: string;
  dataStore?: DataStore;
  verifyAccountOwnership?: (tenantId: string, accountId: string, platform: EngagementPlatform) => Promise<boolean>;
  now?: Date;
  maxRetries?: number;
  maxEventsPerRun?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<{ capability: EngagementCapability; items: StoredInteractionWriteback[]; repeated: number; cursor?: string }> {
  if (input.adapter.capability.status !== 'available') return { capability: input.adapter.capability, items: [], repeated: 0, cursor: input.cursor };
  const dataStore = input.dataStore ?? store;
  const accountId = text(input.accountId || input.adapter.capability.accountId);
  const adapterId = text(input.adapter.adapterId) || `${input.adapter.capability.platform}:${input.adapter.capability.surface}`;
  if (accountId && input.verifyAccountOwnership
    && !await input.verifyAccountOwnership(input.tenantId, accountId, input.adapter.capability.platform)) {
    throw new Error('engagement_account_tenant_mismatch');
  }
  const current = accountId ? await cursorRecord({ tenantId: input.tenantId, adapterId, accountId, capability: input.adapter.capability, dataStore }) : null;
  const now = input.now ?? new Date();
  if (current?.next_retry_at && Date.parse(current.next_retry_at) > now.getTime()) throw new Error('engagement_retry_not_due');
  const cursor = input.cursor ?? current?.cursor;
  const maxRetries = Math.min(Math.max(input.maxRetries ?? 3, 1), 5);
  let pulled: Awaited<ReturnType<EngagementIngestionAdapter['pull']>> | null = null;
  let failure: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try { pulled = await input.adapter.pull(cursor); break; }
    catch (error) {
      failure = error;
      if (attempt < maxRetries) await (input.wait ?? (async () => undefined))(Math.min(1_000, retryDelayMs(attempt)));
    }
  }
  if (!pulled) {
    if (accountId) {
      const failures = (current?.failure_count ?? 0) + 1;
      await saveCursor({ current, tenantId: input.tenantId, adapterId, accountId, capability: input.adapter.capability,
        cursor: cursor ?? '', failureCount: failures, nextRetryAt: new Date(now.getTime() + retryDelayMs(failures)).toISOString(),
        lastError: failure instanceof Error ? failure.message.slice(0, 500) : 'engagement_pull_failed', now: now.toISOString(), dataStore });
    }
    throw failure instanceof Error ? failure : new Error('engagement_pull_failed');
  }
  const maxEvents = Math.min(Math.max(input.maxEventsPerRun ?? 500, 1), 500);
  if (pulled.events.length > maxEvents) throw new Error('engagement_adapter_rate_limit_exceeded');
  const items: StoredInteractionWriteback[] = [];
  let repeated = 0;
  for (const rawEvent of pulled.events) {
    if (rawEvent.platform !== input.adapter.capability.platform) throw new Error('engagement_adapter_platform_mismatch');
    const expectedSurface = rawEvent.kind === 'comment' ? 'comments' : rawEvent.kind === 'direct_message' ? 'direct_messages' : 'forms';
    if (expectedSurface !== input.adapter.capability.surface) throw new Error('engagement_adapter_surface_mismatch');
    if (accountId && rawEvent.accountId && rawEvent.accountId !== accountId) throw new Error('engagement_event_account_mismatch');
    const event = accountId ? { ...rawEvent, accountId } : rawEvent;
    const write = await writebackInteraction(input.tenantId, event, dataStore);
    items.push(write.item);
    if (write.repeated) repeated += 1;
  }
  const nextCursor = text(pulled.cursor) || cursor;
  if (accountId) await saveCursor({ current, tenantId: input.tenantId, adapterId, accountId, capability: input.adapter.capability,
    cursor: nextCursor ?? '', failureCount: 0, now: now.toISOString(), dataStore });
  return { capability: input.adapter.capability, items, repeated, ...(nextCursor ? { cursor: nextCursor } : {}) };
}
