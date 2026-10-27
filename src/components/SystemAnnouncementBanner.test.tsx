import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemAnnouncementBanner from './SystemAnnouncementBanner';

test('home announcement exposes maintenance content and the exact maintenance window', () => {
  const html = renderToStaticMarkup(<SystemAnnouncementBanner announcement={{
    id: 'maintenance-1',
    title: '系统维护通知',
    message: '维护期间部分功能暂时不可用。',
    publishedAt: null,
    maintenanceStartsAt: '2026-11-02T22:00:00+08:00',
    maintenanceEndsAt: '2026-11-02T23:30:00+08:00',
  }}/>);
  assert.match(html, /aria-label="系统公告"/);
  assert.match(html, /系统维护通知/);
  assert.match(html, /维护期间部分功能暂时不可用/);
  assert.match(html, /服务公告/);
  assert.match(html, /11\/2 22:00–23:30/);
  assert.match(html, /data-testid="system-announcement-shell"/);
  assert.match(html, /pt-3/);
  assert.match(html, /rounded-\[22px\]/);
  assert.doesNotMatch(html, /ant-alert-banner/);
});

test('the announcement slot is mounted only for the home page and reads the server health contract', () => {
  const shell = fs.readFileSync(new URL('./AppShellChrome.tsx', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('./RuntimeVersionBanner.tsx', import.meta.url), 'utf8');
  assert.match(shell, /<RuntimeVersionBanner showSystemAnnouncement=\{page === 'strategy'\}/);
  assert.match(runtime, /parseSystemAnnouncement\(health\.announcement\)/);
});
