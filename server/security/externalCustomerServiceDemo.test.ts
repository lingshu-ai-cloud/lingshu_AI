import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMockCustomers } from '../../src/mocks/customerProfiles.js';

const root = process.cwd();
const customers = createMockCustomers();
const byId = new Map(customers.map(customer => [customer.id, customer]));

assert.ok(customers.length >= 8, 'the external lab should cover the main sales progression nodes plus a sandbox');
assert.equal(new Set(customers.map(customer => customer.id)).size, customers.length, 'simulation customer IDs must be unique');
assert.ok(customers.every(customer => customer.isMock && !customer.isReal), 'simulation customers must never be treated as live accounts');
assert.ok(customers.every(customer => customer.simulation?.checkpoint && customer.simulation.expectedBehavior), 'every simulation customer needs a visible test objective');

const bigOrder = byId.get('mock-big-order-suzhou-semiconductor');
assert.ok(bigOrder?.simulation?.warning, 'the large opportunity must have a prominent warning');
assert.equal(bigOrder?.handlingMode, 'human_needed', 'large opportunities must be routed to a human');
assert.ok((bigOrder?.bant?.total || 0) >= 90, 'large-order context should support the warning with strong BANT evidence');

const sandbox = byId.get('mock-free-sandbox');
assert.equal(sandbox?.simulation?.editable, true, 'the blank sandbox must expose editable customer information');
assert.equal(sandbox?.timeline.length, 0, 'the blank sandbox must wait for the tester to send the first message');

const contextualScenarios = customers.filter(customer => !customer.simulation?.editable);
assert.ok(contextualScenarios.every(customer => customer.timeline.some(event => event.actor === 'buyer')), 'every predefined scenario needs buyer context');
assert.ok(customers.some(customer => customer.timeline.some(event => event.audit?.editedByHuman && event.audit.originalDraft)), 'at least one conversation must show a human-edited AI draft');
assert.ok(customers.some(customer => customer.timeline.some(event => event.audit?.memoryApplied?.length)), 'at least one conversation must show applied memory');
assert.ok(customers.some(customer => customer.stage === 'won'), 'the lab must include a repeat-purchase customer');
assert.ok(customers.some(customer => customer.stage === 'silent30'), 'the lab must include a reactivation customer');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert.match(app, /customer-demo@lingshu\.site/, 'the dedicated external account must be allowed to see the simulation lab');
assert.match(app, /isExternalCustomerServiceDemoSession/, 'simulation visibility must be scoped to the dedicated account');

const seedScript = fs.readFileSync(path.join(root, 'scripts/seed-external-customer-service-demo.ts'), 'utf8');
assert.match(seedScript, /ensureExternalDemoAccount\(\)/, 'the demo account must be provisioned idempotently');
assert.match(seedScript, /subscriptionPlan: 'customer'/, 'the account must remain outside the delivery administrator area');
assert.match(seedScript, /role: 'admin'/, 'the account must have every customer-facing workspace permission');
assert.match(seedScript, /agent-memory\/backup\/restore/, 'the dedicated account must receive the demo memory records');
assert.match(seedScript, /missingMemoryCount/, 'demo memory provisioning must be idempotent');

const memoryFixture = JSON.parse(fs.readFileSync(path.join(root, 'data/external-customer-service-demo-memory.json'), 'utf8')) as Record<string, any>;
assert.equal(memoryFixture.schemaVersion, 1);
assert.ok(memoryFixture.records.styleMemory.length >= 8, 'the memory lab needs enough human-edit evidence to show learning readiness');
assert.ok(memoryFixture.records.customerMemory.length >= 6, 'the memory lab needs customer-isolated context across the key progression nodes');
assert.ok(memoryFixture.records.responseStrategies.length >= 3, 'the memory lab needs concise response strategies for normal, pilot, and high-risk scenarios');
assert.ok(memoryFixture.records.styleMemory.every((item: Record<string, unknown>) => String(item.evidence_source || '').startsWith('外部演示初始化')), 'seeded style evidence needs a visible, auditable source');
assert.ok(memoryFixture.records.customerMemory.every((item: Record<string, unknown>) => String(item.customer_id || '').startsWith('mock-')), 'demo customer memory must stay attached to simulation customer IDs');
assert.ok(memoryFixture.records.responseStrategies.some((item: Record<string, unknown>) => item.strategy_id === 'T_HIGH_VALUE_HANDOFF'), 'the memory lab must include high-value handoff governance');

const draftRoute = fs.readFileSync(path.join(root, 'server/routes/draftReply.ts'), 'utf8');
assert.match(draftRoute, /evaluateHandoff\([\s\S]*?bantTotal:[\s\S]*?highValueHandoff/, 'high-value BANT opportunities must force a server-side human handoff');

const customerUi = fs.readFileSync(path.join(root, 'src/components/ConversionPage.tsx'), 'utf8');
assert.match(customerUi, /大单预警/, 'the customer list and conversation must expose the large-order warning');
assert.match(customerUi, /AI 草稿 · 人工改过/, 'conversation history must expose human collaboration without adding fake messages');
assert.match(customerUi, /已用学习记忆/, 'conversation history must expose memory usage without cluttering the transcript');
assert.match(customerUi, /客服演示沙盘/, 'the dedicated account must clearly label the simulation workspace');

const memoryUi = fs.readFileSync(path.join(root, 'src/components/WorkspaceManagementPages.tsx'), 'utf8');
assert.match(memoryUi, /includeMockCustomers/, 'the memory workspace must be able to show the same simulation customer contexts');
assert.match(memoryUi, /createMockCustomers\(\)/, 'simulation customer context must be shared instead of duplicated');
assert.match(memoryUi, /includeMockCustomers \? 'style' : 'content'/, 'the demo account should open on visible learning evidence instead of an empty operations tab');

const verificationScript = fs.readFileSync(path.join(root, 'scripts/verify-external-customer-service-demo.ts'), 'utf8');
for (const marker of ['Demo style evidence is missing', 'Demo customer-private memory is missing', 'Frontend bundle is stale']) {
  assert.match(verificationScript, new RegExp(marker), `online verification must catch: ${marker}`);
}

const basicInfo = fs.readFileSync(path.join(root, 'src/components/customers/widgets/BasicInfoWidget.tsx'), 'utf8');
for (const label of ['模拟客户名称', '模拟客户国家或地区', '模拟客户语言', '模拟客户需求']) {
  assert.match(basicInfo, new RegExp(`aria-label="${label}"`), `${label} must be editable in the blank sandbox`);
}

const profile = JSON.parse(fs.readFileSync(path.join(root, 'data/external-customer-service-demo-profile.json'), 'utf8')) as Record<string, any>;
assert.equal(profile.company.name, '苏州凌锐智能装备有限公司');
assert.match(profile.company.mainMarkets, /苏州.*无锡.*常州/);
assert.ok(profile.products.items.length >= 5, 'industrial equipment demo profile should have detailed products');
assert.ok(profile.faq.length >= 5, 'the demo knowledge base should support safe common-question testing');
assert.ok(profile.salesStyleProfile.learnedFromCount >= 10, 'the demo profile should visibly demonstrate learning history');
assert.equal(profile.strategy.aiAutonomy, 'draft', 'external testing must start in suggestion-only mode');

console.log('external customer service demo tests passed');
