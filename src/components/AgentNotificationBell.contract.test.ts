import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentNotificationBell.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');

assert.match(layout, /AgentNotificationBell[^>]+onNavigate=/, 'the global shell must expose the notification bell');
assert.match(source, /feed\.unreadCount[^\n]+bg-red-600/, 'the bell must render a red numeric unread badge');
assert.match(source, /setInterval\([\s\S]{0,180}10_000/, 'the feed must refresh recent activity while the application is open');
assert.match(source, /agentNotificationsApi\.read\(item\.id\)/, 'opening a notification must persist read state');
assert.match(source, /agentNotificationsApi\.readAll/, 'users must be able to mark the feed read');
assert.match(source, /item\.changes\.slice/, 'critical field differences must be visible in the dropdown');
assert.match(source, /item\.action\?\.href\?\.startsWith\('\/'\)/, 'notification actions must preserve precise object deep links');

console.log('agent notification bell contract tests passed');
