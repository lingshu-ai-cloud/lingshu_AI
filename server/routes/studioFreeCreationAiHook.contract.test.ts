import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
assert.match(source, /post\('\/free-creation-hook\/first-frame'/);
assert.match(source, /hookProject\.tenant_id === tenantId/);
assert.match(source, /saved\.hookSource !== 'ai'/);
assert.match(source, /FREE_HOOK_BUDGET_EXCEEDED/);
assert.match(source, /sourceType === 'ai-free-creation-hook-frame'.*requestId/s);
assert.match(source, /sourceType === 'ai-free-creation-hook-video'.*requestId/s);
assert.match(source, /FREE_HOOK_REQUEST_CONFLICT/);
assert.match(source, /consumeDemoQuota\(req, res, 'generation'\)/);

console.log('free creation AI hook permission, budget and idempotency contracts passed');
