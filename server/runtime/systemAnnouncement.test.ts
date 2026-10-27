import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveSystemAnnouncement } from './systemAnnouncement';

const activeEnvironment = {
  SYSTEM_ANNOUNCEMENT_ENABLED: 'true',
  SYSTEM_ANNOUNCEMENT_ID: 'maintenance-2026-11-02',
  SYSTEM_ANNOUNCEMENT_TITLE: '系统维护通知',
  SYSTEM_ANNOUNCEMENT_MESSAGE: '维护期间部分功能将暂时不可用，请提前保存正在编辑的内容。',
  SYSTEM_ANNOUNCEMENT_PUBLISH_AT: '2026-11-01T09:00:00+08:00',
  SYSTEM_ANNOUNCEMENT_MAINTENANCE_START_AT: '2026-11-02T22:00:00+08:00',
  SYSTEM_ANNOUNCEMENT_MAINTENANCE_END_AT: '2026-11-02T23:30:00+08:00',
};

test('global maintenance announcement is visible only inside its configured delivery window', () => {
  assert.equal(resolveSystemAnnouncement(activeEnvironment, Date.parse('2026-11-01T08:59:59+08:00')), null);
  assert.equal(resolveSystemAnnouncement(activeEnvironment, Date.parse('2026-11-01T09:00:00+08:00'))?.id, 'maintenance-2026-11-02');
  assert.equal(resolveSystemAnnouncement(activeEnvironment, Date.parse('2026-11-02T23:30:00+08:00')), null);
});

test('disabled or incomplete configuration cannot publish a partial announcement', () => {
  assert.equal(resolveSystemAnnouncement({ ...activeEnvironment, SYSTEM_ANNOUNCEMENT_ENABLED: 'false' }), null);
  assert.equal(resolveSystemAnnouncement({ ...activeEnvironment, SYSTEM_ANNOUNCEMENT_MESSAGE: '' }), null);
  assert.equal(resolveSystemAnnouncement({ ...activeEnvironment, SYSTEM_ANNOUNCEMENT_MAINTENANCE_END_AT: '2026-11-02T21:00:00+08:00' }), null);
});

test('the shared health response exposes the resolved global announcement without caching', () => {
  const server = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  assert.match(server, /app\.get\('\/api\/overseas\/health'[\s\S]*?Cache-Control[\s\S]*?announcement: resolveSystemAnnouncement\(\)/);
});
