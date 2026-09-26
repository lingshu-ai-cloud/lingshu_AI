import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'agent-notifications-'));
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = directory;

const { bindDataAuthority } = await import('../storage/dataAuthority.js');
const {
  AgentNotificationError,
  createAgentNotification,
  createAgentAdjustmentNotification,
  listAgentNotifications,
  markAgentNotificationRead,
  markAllAgentNotificationsRead,
} = await import('./agentNotifications.js');

try {
  bindDataAuthority('local');
  const created = await createAgentNotification({
    tenantId: 'tenant-a', eventKey: 'weekly:42:v2', type: 'weekly_package_adjusted',
    title: '经营Agent调整了本周任务', summary: '已根据产能减少两个发布任务。', sourceAgent: '经营Agent',
    entityType: 'weekly_package', entityId: '42',
    changes: [{ field: 'publicationCount', label: '发布任务', before: 26, after: 24 }],
    action: { label: '查看任务包', page: 'socialPlanning' },
  });
  assert.equal(created.created, true);
  const duplicate = await createAgentNotification({
    tenantId: 'tenant-a', eventKey: 'weekly:42:v2', type: 'weekly_package_adjusted',
    title: '重复事件', summary: '不应重复计数', sourceAgent: '经营Agent',
  });
  assert.equal(duplicate.created, false, 'one event key must create at most one tenant notification');

  await createAgentAdjustmentNotification({
    tenantId: 'tenant-a', eventKey: 'scope:current:v3', type: 'scope_changed',
    title: '编导Agent调整了发现范围', summary: '新增了已验证的采购场景。', sourceAgent: '编导Agent',
    entityType: 'discovery_scope', entityId: 'current',
    changes: [{ field: 'version', label: '范围版本', before: 2, after: 3 }],
    action: { label: '查看发现范围', page: 'socialInspiration' },
  });

  const userA = await listAgentNotifications('tenant-a', 'user-a');
  assert.equal(userA.items.length, 2);
  assert.equal(userA.unreadCount, 2);
  assert.equal((await listAgentNotifications('tenant-b', 'user-a')).items.length, 0, 'tenants must be isolated');

  await markAgentNotificationRead('tenant-a', 'user-a', userA.items[0].id);
  assert.equal((await listAgentNotifications('tenant-a', 'user-a')).unreadCount, 1);
  assert.equal((await listAgentNotifications('tenant-a', 'user-b')).unreadCount, 2, 'read state is per user');
  assert.equal(await markAllAgentNotificationsRead('tenant-a', 'user-b'), 2);

  await assert.rejects(() => createAgentAdjustmentNotification({
    tenantId: 'tenant-a', eventKey: 'scope:empty', type: 'scope_changed',
    title: '范围变化', summary: '没有差异', sourceAgent: '编导Agent',
    entityType: 'discovery_scope', entityId: 'current', changes: [],
    action: { label: '查看', page: 'socialInspiration' },
  }), (error: unknown) => error instanceof AgentNotificationError && error.message === 'agent_adjustment_requires_changes');

  await assert.rejects(() => createAgentNotification({
    tenantId: 'tenant-a', eventKey: 'critical:empty', type: 'critical_business_change',
    title: '关键变化', summary: '缺少字段差异', sourceAgent: '经营Agent',
  }), (error: unknown) => error instanceof AgentNotificationError && error.message === 'critical_business_change_requires_changes');

  await assert.rejects(() => markAgentNotificationRead('tenant-b', 'user-a', userA.items[0].id),
    (error: unknown) => error instanceof AgentNotificationError && error.status === 404);
  console.log('agent notification service tests passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
