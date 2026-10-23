import { readStudioApplicationSources } from '../../tests/fixtures/studioApplicationSources.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readMaterialLibrary } from '../lib/materialLibrary.js';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const appPageSlot = fs.readFileSync('src/AppPageSlot.tsx', 'utf8');
const localMockGate = fs.readFileSync('src/mocks/foreignTradeOperations.ts', 'utf8');
const enterpriseHomepageDemo = fs.readFileSync('src/mocks/enterpriseHomepageDemo.ts', 'utf8');
const strategyBoard = fs.readFileSync('src/components/StrategyDataBoard.tsx', 'utf8');
const cockpit = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const snapshot = fs.readFileSync('server/digitalEmployees/businessSnapshot.ts', 'utf8');
const production = fs.readFileSync('server/digitalEmployees/contentProduction.ts', 'utf8');
const productionExecution = fs.readFileSync('server/digitalEmployees/contentProductionExecution.ts', 'utf8');
const productionAssets = fs.readFileSync('server/digitalEmployees/contentProductionAssets.ts', 'utf8');
const productionPlanning = fs.readFileSync('server/digitalEmployees/contentProductionPlanning.ts', 'utf8');
const studio = readStudioApplicationSources();
const materialLibrary = fs.readFileSync('server/lib/materialLibrary.ts', 'utf8');
const publisher = fs.readFileSync('server/publishing/scheduledPublisher.ts', 'utf8');
const messaging = fs.readFileSync('server/digitalEmployees/customerMessagingPolicy.ts', 'utf8');

assert.match(app, /localForeignTradeMock = isLocalForeignTradeMockEnabled\(\)/, 'the app must derive the local mock gate centrally');
assert.match(localMockGate, /if \(import\.meta\.env\.DEV\) return true/, 'development may opt into local mock customers');
assert.match(localMockGate, /window\.location\.hostname === '127\.0\.0\.1' \|\| window\.location\.hostname === 'localhost'/, 'non-development mock customers must stay on local preview hosts');
assert.match(appPageSlot, /<ConversionPage[\s\S]*?includeMockCustomers=\{localForeignTradeMock\}/, 'the customer workspace must use the local-only mock gate');
assert.match(appPageSlot, /<StrategyPage[\s\S]*?includeMockCustomers=\{localForeignTradeMock\}/, 'the strategy dashboard must use the local-only mock gate');
assert.match(appPageSlot, /enterpriseHomepageDemo=\{isEnterpriseHomepageDemoAccount\(session\.user\.email\)\}/, 'the enterprise-backed homepage demo must be gated by the authenticated account');
assert.doesNotMatch(appPageSlot, /<AgentMemoryPage\b/, 'the retired Agent memory frontend must remain removed');
assert.match(enterpriseHomepageDemo, /ENTERPRISE_HOMEPAGE_DEMO_ACCOUNT = 'lingshu-admin@local\.test'/, 'the production homepage demo must stay limited to the requested test account');
assert.match(enterpriseHomepageDemo, /synthetic: true/, 'homepage demo records must carry explicit synthetic provenance');
assert.match(enterpriseHomepageDemo, /不代表真实经营结果/, 'homepage demo data must explain that it is not real business performance');
assert.match(strategyBoard, /data-testid="enterprise-homepage-demo-notice"/, 'the homepage must visibly label the enterprise-backed demo');
assert.doesNotMatch(cockpit, /frontend_preview|BUSINESS_PREVIEW|PreviewExecutionPanel|查看示例数据/, 'the production cockpit must contain no synthetic metrics or task receipts');

assert.match(snapshot, /filter\(connectedAccount\)/, 'account readiness must come only from currently connected tenant records');
assert.match(snapshot, /weekPosts\.filter\(hasPublishedReceipt\)/, 'published counts must require provider receipts');
assert.match(snapshot, /weekProjects\.filter\(completedWorkHasReceipt\)/, 'completed-work counts must require accessible render evidence');
assert.match(snapshot, /provider_message_id/, 'customer outreach counts must require provider message receipts');

assert.match(productionAssets, /isSyntheticMaterial\(record\)/, 'the content worker must reject synthetic material provenance');
assert.match(studio, /studioRouter\.get\('\/materials',[\s\S]{0,400}readMaterialLibrary\(tenantId\)/, 'Studio material listings must use the shared truth-filtered inventory');
assert.match(materialLibrary, /accessibleMaterial[\s\S]{0,180}!isSyntheticMaterial\(item\)/, 'the shared material inventory must reject synthetic provenance');
const truthfulInventory = await readMaterialLibrary('truthful-tenant', {
  local: () => [
    { id: 'local-real', tenantId: 'truthful-tenant' },
    { id: 'local-synthetic', tenantId: 'truthful-tenant', synthetic: true },
  ],
  cloud: async tenantId => {
    assert.equal(tenantId, 'truthful-tenant');
    return {
      items: [
        { id: 'cloud-real', tenantId: 'truthful-tenant', sourceType: 'licensed_upload' },
        { id: 'cloud-fixture', tenantId: 'truthful-tenant', sourceType: 'fixture' },
        { id: 'cloud-other-tenant', tenantId: 'other-tenant', sourceType: 'licensed_upload' },
      ],
      source: { source: 'database', state: 'ready', message: 'fixture' },
    };
  },
});
assert.deepEqual(truthfulInventory.items.map(item => item.id), ['local-real', 'cloud-real'], 'shared inventory must behaviorally filter synthetic and cross-tenant local/cloud records');
assert.match(productionExecution, /stat\.size < 10_000/, 'the content worker must verify a non-empty rendered file before completion');
assert.match(productionExecution, /selectedMaterialEvidence/, 'rendered projects must retain material provenance');
assert.match(production, /contentProductionKnowledgeGaps\(/, 'the worker must use route-specific knowledge gap planning');
assert.match(productionPlanning, /knowledge_gap/, 'missing product, material, or analysis must be persisted as an explicit knowledge gap');
assert.match(publisher, /realPublishingAuthorized !== true/, 'the real publisher must enforce the frozen tenant authorization');
assert.match(messaging, /allowRealCustomerMessages/, 'real customer messages must enforce tenant authorization');

console.log('production data truthfulness contract tests passed');
