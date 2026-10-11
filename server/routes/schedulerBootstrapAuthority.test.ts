import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schedulerBootstrapAuthority } from './schedulerBootstrapAuthority.js';

assert.equal(schedulerBootstrapAuthority({ LINGSHU_LOCAL_PREVIEW: '1' }, true), 'local');
assert.equal(schedulerBootstrapAuthority({ LINGSHU_LOCAL_PREVIEW: '1' }, false), 'pocketbase');
assert.equal(schedulerBootstrapAuthority({ NODE_ENV: 'development' }, true), 'pocketbase');
assert.equal(schedulerBootstrapAuthority({ NODE_ENV: 'production', LINGSHU_LOCAL_PREVIEW: '1' }, false), 'pocketbase');

const scheduler = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8');
assert.match(scheduler, /runWithDataAuthority\(authority, async \(\) => \{[\s\S]{0,300}hydrateTasksFromPocketBase\(\)[\s\S]{0,300}reconcileSocialDiscoveryCollectionTasks\(\)/,
  'scheduler bootstrap must hydrate tasks and reconcile active scopes under the same selected authority');

console.log('scheduler bootstrap authority tests passed');
