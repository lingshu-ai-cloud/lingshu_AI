import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./agentNotifications.ts', import.meta.url), 'utf8');

assert.match(source, /createAgentNotification\(\{ \.\.\.\(req\.body \|\| \{\}\), tenantId \}\)/,
  'authenticated tenant identity must override request JSON');
assert.match(source, /agentNotificationsRouter\.use\(requireAuth\)/,
  'every notification endpoint must require authentication');
assert.match(source, /supportAccess \|\| !role/,
  'support sessions must not create tenant notifications');

console.log('agent notification route contract tests passed');
