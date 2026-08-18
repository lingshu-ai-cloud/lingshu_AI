import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCustomerMemoryPromptBlock,
  customerMemoryKeyAllowed,
  resolveActiveCustomerMemories,
  type CustomerMemoryRecord,
} from './customerMemory.js';
import { styleMemoryUsable, type StyleMemoryRecord } from './styleMemory.js';
import { strategyMemoryWithinRollout } from './strategyRetrieve.js';

const baseCustomerMemory: CustomerMemoryRecord = {
  id: 'mem-base', tenant_id: 'tenant-a', customer_id: 'customer-a', memory_key: 'preferred_tone',
  memory_value: 'short and direct', status: 'confirmed', source_kind: 'human',
  created: '2026-08-01T00:00:00.000Z', updated: '2026-08-01T00:00:00.000Z',
};

const active = resolveActiveCustomerMemories([
  { ...baseCustomerMemory, id: 'ai-old', source_kind: 'ai_inferred', memory_value: 'formal', updated: '2026-08-02T00:00:00.000Z' },
  { ...baseCustomerMemory, id: 'human-new', memory_value: 'warm but concise', updated: '2026-08-03T00:00:00.000Z' },
  { ...baseCustomerMemory, id: 'expired', memory_key: 'preferred_language', memory_value: 'Spanish', expires_at: '2020-01-01T00:00:00.000Z' },
  { ...baseCustomerMemory, id: 'pending', memory_key: 'product_preference', memory_value: 'serum', status: 'pending' },
]);
assert.equal(active.length, 1, 'only confirmed, non-expired, winning records should be retrieved');
assert.equal(active[0].id, 'human-new', 'newer human-confirmed memory must beat AI inference');
assert.equal(customerMemoryKeyAllowed('product_preference'), true);
assert.equal(customerMemoryKeyAllowed('discount_policy'), false, 'enterprise facts cannot be disguised as customer memory');
assert.match(buildCustomerMemoryPromptBlock(active), /this customer only/i);
assert.match(buildCustomerMemoryPromptBlock(active), /never authorize price, MOQ/i);

const style = {
  id: 'style-1', tenant_id: 'tenant-a', trigger_message: 'hi', draft_original: 'hello', final_sent: 'hi',
  edited: true, category: 'reply', status: 'confirmed', learning_scope: 'enterprise_style',
} satisfies StyleMemoryRecord;
assert.equal(styleMemoryUsable(style), true);
assert.equal(styleMemoryUsable({ ...style, status: 'pending' }), false);
assert.equal(styleMemoryUsable({ ...style, status: 'paused' }), false);
assert.equal(styleMemoryUsable({ ...style, expires_at: '2020-01-01T00:00:00.000Z' }), false);
assert.equal(styleMemoryUsable({ ...style, learning_scope: 'customer_private' }), false, 'customer-private evidence cannot enter enterprise style retrieval');

const strategyRecord = {
  id: 'strategy-record', tenant_id: 'tenant-a', strategy_id: 'T_TEST', adjustment: '', evidence_count: 8,
  evidence_customer_count: 4, evidence_period_count: 2, status: 'active', rollout_percent: 0,
};
assert.equal(strategyMemoryWithinRollout(strategyRecord, 'customer-a'), false);
assert.equal(strategyMemoryWithinRollout({ ...strategyRecord, rollout_percent: 100 }, 'customer-a'), true);
assert.equal(
  strategyMemoryWithinRollout({ ...strategyRecord, rollout_percent: 10 }, 'customer-a'),
  strategyMemoryWithinRollout({ ...strategyRecord, rollout_percent: 10 }, 'customer-a'),
  'small-traffic rollout must be stable for the same customer and strategy',
);

const routeSource = fs.readFileSync(new URL('../routes/agentMemory.ts', import.meta.url), 'utf8');
assert.match(routeSource, /requestOrganizationRoleStrict/);
assert.match(routeSource, /role !== 'super_admin' && role !== 'admin'/);
assert.match(routeSource, /record\?\.tenant_id === tenantId/);
assert.match(routeSource, /backup\.sourceTenantId !== tenantId/);
assert.match(routeSource, /separate_conversation_deletion_required/);
assert.match(routeSource, /strategy_evidence_threshold_not_met/);
assert.match(routeSource, /timePeriods: periodCount/);
assert.match(routeSource, /styleMemoryUsable\(item\)/);

const draftRouteSource = fs.readFileSync(new URL('../routes/draftReply.ts', import.meta.url), 'utf8');
assert.match(draftRouteSource, /observeStyleMemoryOutcomes/);
assert.match(draftRouteSource, /touchStrategyUsage/);

console.log('agent memory governance, isolation, expiry, rollout and permission contracts passed');
