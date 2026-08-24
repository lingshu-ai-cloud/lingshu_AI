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

const foreignCustomers = createMockCustomers('wenlantianxia-test@local.test');
const foreignById = new Map(foreignCustomers.map(customer => [customer.id, customer]));
const foreignContextualScenarios = foreignCustomers.filter(customer => !customer.simulation?.editable);
assert.equal(foreignCustomers.length, 8, 'the Wenlan account should have seven overseas sales stages plus one editable sandbox');
assert.ok(foreignContextualScenarios.every(customer => !/中国/.test(customer.countryName)), 'all predefined Wenlan customers must come from overseas markets');
assert.ok(foreignContextualScenarios.every(customer => customer.timeline.length >= 5), 'every overseas customer needs a complete timeline from first inquiry to the current stage');
assert.ok(foreignContextualScenarios.every(customer => customer.timeline[0]?.actor === 'buyer'), 'every overseas timeline must start with the buyer entering the conversation');
assert.ok(foreignContextualScenarios.every(customer => customer.timeline.some(event => event.audit?.editedByHuman)), 'every overseas context should show human-AI collaboration');
assert.ok(foreignById.get('mock-export-big-order-saudi-packaging')?.simulation?.warning, 'the Saudi group opportunity must trigger a large-order warning');
assert.ok(foreignCustomers.some(customer => customer.language === '西语'), 'the foreign-trade lab must include Spanish conversations');
assert.ok(foreignCustomers.some(customer => customer.language === '阿语'), 'the foreign-trade lab must include Arabic conversations');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert.match(app, /customer-demo@lingshu\.site/, 'the original external account must keep access to the simulation lab');
assert.match(app, /wenlantianxia-test@local\.test/, 'the new external account must also be allowed to see the simulation lab');
assert.match(app, /isExternalCustomerServiceDemoSession/, 'simulation visibility must be scoped to the dedicated account');

const seedScript = fs.readFileSync(path.join(root, 'scripts/seed-external-customer-service-demo.ts'), 'utf8');
assert.match(seedScript, /ensureExternalDemoAccount\(\)/, 'the demo account must be provisioned idempotently');
assert.match(seedScript, /subscriptionPlan: 'customer'/, 'the account must remain outside the delivery administrator area');
assert.match(seedScript, /role: 'admin'/, 'the account must have every customer-facing workspace permission');
assert.match(seedScript, /agent-memory\/backup\/restore/, 'the dedicated account must receive the demo memory records');
assert.match(seedScript, /missingMemoryCount/, 'demo memory provisioning must be idempotent');
assert.match(seedScript, /pruneDuplicateRecords/, 're-running the demo seed must remove duplicate fixture records');
assert.match(seedScript, /attachExistingIds/, 'replacement mode must update matching fixture records instead of leaving stale values');
assert.match(seedScript, /Only after the replacement payload has been safely restored/, 'replacement mode must restore before pruning so transient failures cannot empty the isolated tenant');
assert.match(seedScript, /EXTERNAL_DEMO_COMPANY_NAME/, 'the same fixture must support tenant-specific company names');

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
const customerUiNormalized = customerUi.replace(/\r\n/g, '\n');
assert.match(customerUi, /大单预警/, 'the customer list and conversation must expose the large-order warning');
assert.match(customerUi, /data-testid="large-order-warning-tag"/, 'the large-order warning must remain a compact right-rail tag');
const chatThreadUi = customerUi.slice(customerUi.indexOf('function ChatThread'), customerUi.indexOf('function CustomerIntentActionPanel'));
assert.doesNotMatch(chatThreadUi, /simulation\?\.warning|大单预警/, 'the large-order warning must not occupy the conversation transcript');
assert.match(customerUi, /data-testid="conversation-list"[^>]*w-52[^>]*xl:w-56/, 'the conversation list must stay compact so the transcript remains prominent on laptops');
const customerListItemUi = customerUiNormalized.slice(customerUiNormalized.indexOf('const renderCustomer'), customerUiNormalized.indexOf('return (\n    <aside data-testid="conversation-list"'));
assert.doesNotMatch(customerListItemUi, /lifecycleLabel|engagementLabel/, 'customer list rows must not repeat lifecycle or reply-state badges from the conversation header');
assert.match(customerUi, /data-testid="conversation-chat-thread"/, 'the main conversation transcript needs a stable layout target');
assert.match(customerUi, /data-testid="conversation-workspace-main"/, 'the three-column workspace must start directly without stacked page banners');
assert.doesNotMatch(customerUi, /mockCustomerCount/, 'the simulation workspace must not reserve a full-width banner above conversations');
assert.doesNotMatch(customerUi, /今日处理/, 'per-customer action guidance must be merged into the AI intent panel');
const customerRailUi = customerUi.slice(customerUi.indexOf('function CustomerInfoRail'), customerUi.indexOf('function createMessageEvent'));
for (const marker of ['CustomerInsightDisclosure', 'CustomerIntentActionPanel', 'BasicInfoWidget', 'TagsWidget', 'RulesDisclosure']) {
  assert.match(customerRailUi, new RegExp(marker), `the customer rail must include ${marker}`);
}
const railMarkers = ['CustomerInsightDisclosure', 'CustomerIntentActionPanel', 'BasicInfoWidget', 'TagsWidget', 'RulesDisclosure'];
assert.deepEqual(
  railMarkers.map(marker => customerRailUi.indexOf(marker)),
  [...railMarkers.map(marker => customerRailUi.indexOf(marker))].sort((a, b) => a - b),
  'the customer rail must keep warning, AI intent, profile, tags and assignment rules in the requested order',
);
assert.doesNotMatch(customerRailUi, /OrderHistoryWidget|SortableWidget/, 'the compact customer rail must not contain extra or draggable panels');
assert.match(customerUi, /AI 草稿 · 人工改过/, 'conversation history must expose human collaboration without adding fake messages');
assert.match(customerUi, /已用学习记忆/, 'conversation history must expose memory usage without cluttering the transcript');
assert.match(customerUi, /客服演示沙盘/, 'the dedicated account must clearly label the simulation workspace');

const memoryUi = fs.readFileSync(path.join(root, 'src/components/WorkspaceManagementPages.tsx'), 'utf8');
assert.match(memoryUi, /includeMockCustomers/, 'the memory workspace must be able to show the same simulation customer contexts');
assert.match(memoryUi, /createMockCustomers\(mockCustomerScope\)/, 'simulation customer context must be shared with the account-specific scope');
assert.match(memoryUi, /includeMockCustomers \? 'style' : 'content'/, 'the demo account should open on visible learning evidence instead of an empty operations tab');

const verificationScript = fs.readFileSync(path.join(root, 'scripts/verify-external-customer-service-demo.ts'), 'utf8');
for (const marker of ['Demo style evidence is missing', 'Demo customer-private memory is missing', 'Frontend bundle is stale']) {
  assert.match(verificationScript, new RegExp(marker), `online verification must catch: ${marker}`);
}

const deliverySchema = fs.readFileSync(path.join(root, 'server/storage/ensureDeliveryCollections.ts'), 'utf8');
assert.match(deliverySchema, /name: 'created', type: 'autodate', onCreate: true, onUpdate: false/, 'memory records need an automatic creation timestamp for sorted retrieval');
assert.match(deliverySchema, /name: 'updated', type: 'autodate', onCreate: true, onUpdate: true/, 'memory records need an automatic update timestamp for sorted retrieval');
assert.match(deliverySchema, /STYLE_MEMORY_FIELDS[\s\S]*?RECORD_TIMESTAMP_FIELDS/, 'style memory must include sortable timestamps');
assert.match(deliverySchema, /RESPONSE_STRATEGY_MEMORY_FIELDS[\s\S]*?RECORD_TIMESTAMP_FIELDS/, 'response strategies must include sortable timestamps');
assert.match(deliverySchema, /CUSTOMER_MEMORY_FIELDS[\s\S]*?RECORD_TIMESTAMP_FIELDS/, 'customer-private memory must include sortable timestamps');

const agentMemoryRoute = fs.readFileSync(path.join(root, 'server/routes/agentMemory.ts'), 'utf8');
assert.match(agentMemoryRoute, /created: text\(record\.created \|\| record\.confirmed_at\)/, 'migrated demo evidence must retain its confirmed time in the UI');

const basicInfo = fs.readFileSync(path.join(root, 'src/components/customers/widgets/BasicInfoWidget.tsx'), 'utf8');
assert.match(basicInfo, /const \[open, setOpen\] = useState\(true\)/, 'customer profile details should open by default');
assert.match(basicInfo, /setOpen\(true\)/, 'customer profile details should open when switching conversations');
assert.match(basicInfo, /data-testid="customer-profile-disclosure"[^>]*className="min-w-0 overflow-hidden"/, 'customer profile details must stay inside the right rail');
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

const foreignProfile = JSON.parse(fs.readFileSync(path.join(root, 'data/external-customer-service-foreign-trade-profile.json'), 'utf8')) as Record<string, any>;
assert.equal(foreignProfile.company.name, '文澜天下');
assert.match(foreignProfile.company.mainMarkets, /中东.*欧洲.*拉丁美洲.*东南亚/);
assert.doesNotMatch(`${foreignProfile.company.mainMarkets} ${foreignProfile.customers.targetProfiles}`, /苏州|无锡|常州/);
assert.ok(foreignProfile.salesStyleProfile.learnedFromCount >= 20, 'the Wenlan profile should visibly show accumulated learning');
assert.equal(foreignProfile.strategy.aiAutonomy, 'draft');

const foreignMemory = JSON.parse(fs.readFileSync(path.join(root, 'data/external-customer-service-foreign-trade-memory.json'), 'utf8')) as Record<string, any>;
assert.ok(foreignMemory.records.styleMemory.length >= 8, 'every key overseas stage needs auditable human-edit evidence');
assert.equal(foreignMemory.records.customerMemory.length, 7, 'every predefined overseas customer needs isolated memory');
assert.ok(foreignMemory.records.responseStrategies.length >= 6, 'foreign-trade learning should cover contact, pilot, continuity, compliance, handoff and reactivation');
assert.ok(foreignMemory.records.styleMemory.every((item: Record<string, unknown>) => String(item.customer_id || '').startsWith('mock-export-')), 'Wenlan style evidence must only refer to its overseas simulations');
assert.ok(foreignMemory.records.customerMemory.every((item: Record<string, unknown>) => String(item.customer_id || '').startsWith('mock-export-')), 'Wenlan customer memory must stay isolated to overseas simulations');
assert.ok(foreignMemory.records.styleMemory.filter((item: Record<string, unknown>) => item.category === '报价').length >= 7, 'foreign-trade reply evidence must use the runtime reply category so learning is actually retrieved');
assert.ok(foreignMemory.records.styleMemory.some((item: Record<string, unknown>) => item.category === 'followup'), 'foreign-trade follow-up evidence must remain available to the follow-up intent');
assert.ok(foreignMemory.records.responseStrategies.every((item: Record<string, unknown>) => item.status === 'active' && item.source === 'learned_custom' && item.rollout_percent === 100), 'foreign-trade learned strategies must be active and fully available in the isolated demo tenant');
const foreignStrategyIds = new Set(foreignMemory.records.responseStrategies.map((item: Record<string, unknown>) => String(item.strategy_id || '')));
const referencedStrategyIds = new Set(foreignMemory.records.styleMemory.flatMap((item: Record<string, unknown>) => Array.isArray(item.strategy_ids) ? item.strategy_ids.map(String) : []));
assert.deepEqual([...referencedStrategyIds].filter(strategyId => !foreignStrategyIds.has(strategyId)), [], 'every learned strategy referenced by overseas evidence must exist');

console.log('external customer service demo tests passed');
