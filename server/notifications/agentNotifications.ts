import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import {
  AGENT_NOTIFICATION_TYPES,
  type AgentNotification,
  type AgentNotificationChange,
  type AgentNotificationList,
  type AgentNotificationSeverity,
  type AgentNotificationType,
} from '../../shared/contracts/agentNotification.js';

const COLLECTION = 'agent_notifications';
const TYPES = new Set<string>(AGENT_NOTIFICATION_TYPES);
const SEVERITIES = new Set<AgentNotificationSeverity>(['info', 'warning', 'critical']);

interface StoredNotification extends Record<string, unknown> {
  id: string;
  notification_id: string;
  tenant_id: string;
  event_key: string;
  type: AgentNotificationType;
  severity: AgentNotificationSeverity;
  title: string;
  summary: string;
  source_agent: string;
  entity_type: string;
  entity_id: string;
  changes: AgentNotificationChange[];
  action: AgentNotification['action'] | null;
  read_by: Record<string, string>;
  created_at: string;
}

export class AgentNotificationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);

function normalizeChanges(value: unknown): AgentNotificationChange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const field = clean(row.field, 100);
    if (!field) throw new AgentNotificationError('notification_change_field_required');
    return { field, label: clean(row.label, 120) || field, before: row.before ?? null, after: row.after ?? null };
  });
}

function present(record: StoredNotification, userId: string): AgentNotification {
  return {
    id: record.notification_id,
    type: record.type,
    severity: record.severity,
    title: record.title,
    summary: record.summary,
    sourceAgent: record.source_agent,
    entityType: record.entity_type,
    entityId: record.entity_id,
    changes: Array.isArray(record.changes) ? record.changes : [],
    action: record.action || undefined,
    createdAt: record.created_at,
    readAt: record.read_by?.[userId] || null,
  };
}

export async function createAgentNotification(input: {
  tenantId: string;
  eventKey: string;
  type: AgentNotificationType;
  severity?: AgentNotificationSeverity;
  title: string;
  summary: string;
  sourceAgent: string;
  entityType?: string;
  entityId?: string;
  changes?: AgentNotificationChange[];
  action?: AgentNotification['action'];
}): Promise<{ notification: AgentNotification; created: boolean }> {
  const tenantId = clean(input.tenantId, 120);
  const eventKey = clean(input.eventKey, 180);
  const title = clean(input.title, 160);
  const summary = clean(input.summary, 1000);
  const severity = input.severity || (input.type === 'critical_business_change' || input.type === 'authorization_required' ? 'critical' : 'info');
  if (!tenantId || !eventKey || !TYPES.has(input.type) || !title || !summary || !SEVERITIES.has(severity)) {
    throw new AgentNotificationError('invalid_notification');
  }
  const changes = normalizeChanges(input.changes);
  if (input.type === 'critical_business_change' && changes.length === 0) {
    throw new AgentNotificationError('critical_business_change_requires_changes');
  }
  const existing = await store.list<StoredNotification>(COLLECTION, { where: { tenant_id: tenantId, event_key: eventKey }, perPage: 1 });
  if (existing.items[0]) return { notification: present(existing.items[0], ''), created: false };
  const now = new Date().toISOString();
  let notification: StoredNotification | null;
  try {
    notification = await store.create<StoredNotification>(COLLECTION, {
      notification_id: `notification_${randomUUID()}`,
      tenant_id: tenantId,
      event_key: eventKey,
      type: input.type,
      severity,
      title,
      summary,
      source_agent: clean(input.sourceAgent, 100) || 'system',
      entity_type: clean(input.entityType, 100),
      entity_id: clean(input.entityId, 180),
      changes,
      action: input.action ? { label: clean(input.action.label, 80), page: clean(input.action.page, 80), href: clean(input.action.href, 500) || undefined } : null,
      read_by: {},
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    // A concurrent producer may have won the unique tenant/event key race.
    const raced = await store.list<StoredNotification>(COLLECTION, { where: { tenant_id: tenantId, event_key: eventKey }, perPage: 1 });
    if (raced.items[0]) return { notification: present(raced.items[0], ''), created: false };
    throw error;
  }
  if (!notification) throw new AgentNotificationError('notification_write_failed', 503);
  return { notification: present(notification, ''), created: true };
}

/**
 * Stable producer boundary for Operating Agent / Director Agent adjustments.
 * Upstream tasks own their domain mutation; this helper only records the
 * resulting, user-visible version difference and its navigation target.
 */
export async function createAgentAdjustmentNotification(input: {
  tenantId: string;
  eventKey: string;
  type: Extract<AgentNotificationType, 'scope_changed' | 'weekly_package_adjusted' | 'critical_business_change' | 'authorization_required'>;
  title: string;
  summary: string;
  sourceAgent: string;
  entityType: string;
  entityId: string;
  changes: AgentNotificationChange[];
  action: NonNullable<AgentNotification['action']>;
  severity?: AgentNotificationSeverity;
}) {
  if (!input.changes.length) throw new AgentNotificationError('agent_adjustment_requires_changes');
  return createAgentNotification(input);
}

async function listTenantRecords(tenantId: string): Promise<StoredNotification[]> {
  const records: StoredNotification[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await store.list<StoredNotification>(COLLECTION, {
      where: { tenant_id: tenantId }, sort: '-created_at', page, perPage: 100,
    });
    records.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return records;
}

export async function listAgentNotifications(tenantId: string, userId: string, limit = 30): Promise<AgentNotificationList> {
  const records = await listTenantRecords(clean(tenantId, 120));
  const items = records.slice(0, Math.min(100, Math.max(1, limit))).map(item => present(item, userId));
  return {
    items,
    unreadCount: records.reduce((count, item) => count + (item.read_by?.[userId] ? 0 : 1), 0),
    latestAt: records[0]?.created_at || null,
  };
}

export async function markAgentNotificationRead(tenantId: string, userId: string, id: string): Promise<AgentNotification> {
  const result = await store.list<StoredNotification>(COLLECTION, {
    where: { tenant_id: clean(tenantId, 120), notification_id: clean(id, 180) }, perPage: 1,
  });
  const record = result.items[0];
  if (!record) throw new AgentNotificationError('notification_not_found', 404);
  const readAt = record.read_by?.[userId] || new Date().toISOString();
  if (!record.read_by?.[userId]) {
    const updated = await store.update(COLLECTION, record.id, { read_by: { ...(record.read_by || {}), [userId]: readAt }, updated_at: readAt });
    if (!updated) throw new AgentNotificationError('notification_read_write_failed', 503);
  }
  return present({ ...record, read_by: { ...(record.read_by || {}), [userId]: readAt } }, userId);
}

export async function markAllAgentNotificationsRead(tenantId: string, userId: string): Promise<number> {
  const unread = (await listTenantRecords(clean(tenantId, 120))).filter(item => !item.read_by?.[userId]);
  const readAt = new Date().toISOString();
  const updates = await Promise.all(unread.map(item => store.update(COLLECTION, item.id, { read_by: { ...(item.read_by || {}), [userId]: readAt }, updated_at: readAt })));
  if (updates.some(updated => !updated)) throw new AgentNotificationError('notification_read_write_failed', 503);
  return unread.length;
}
