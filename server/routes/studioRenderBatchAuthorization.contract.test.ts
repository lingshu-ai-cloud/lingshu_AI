import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'studio.ts'), 'utf8');
assert.match(source, /studioRouter\.post\('\/render\/authorizations\/trilingual'/);
const start = source.indexOf('async function createTrilingualRenderAuthorizations');
const end = source.indexOf('// POST /studio/render/authorizations/trilingual');
assert.ok(start >= 0 && end > start);
const implementation = source.slice(start, end);
assert.ok(implementation.indexOf('await Promise.all') < implementation.indexOf('reserveDemoRenderBatchQuota'), 'all manifests must validate before quota reservation');
assert.match(implementation, /createStudioRenderJobBatch\(/);
assert.match(implementation, /rememberRenderAuthorizationBatch\(/);
assert.match(implementation, /rollbackDemoRenderBatchQuota\(/);
assert.match(implementation, /authorizationBatchFingerprint/);
assert.match(implementation, /sourceProjectId/);
assert.doesNotMatch(implementation, /consumeDemoQuota\(/, 'batch quota may not be consumed one render at a time');

const localRenderStart = source.indexOf("studioRouter.post('/render/local'");
const localRenderEnd = source.indexOf('function renderOutputFile', localRenderStart);
const localRender = source.slice(localRenderStart, localRenderEnd);
assert.match(localRender, /claimStudioRenderJobLease\(/);
assert.match(localRender, /\.attempts/);
assert.match(localRender, /updateStudioRenderJobForLease\(/);
assert.match(localRender, /RENDER_LEASE_LOST/);

console.log('studio render batch authorization contract tests passed');
