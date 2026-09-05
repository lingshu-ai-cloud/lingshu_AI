import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const cockpit = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const memory = fs.readFileSync('src/components/WorkspaceManagementPages.tsx', 'utf8');
const snapshot = fs.readFileSync('server/digitalEmployees/businessSnapshot.ts', 'utf8');
const production = fs.readFileSync('server/digitalEmployees/contentProduction.ts', 'utf8');
const studio = fs.readFileSync('server/routes/studio.ts', 'utf8');
const publisher = fs.readFileSync('server/publishing/scheduledPublisher.ts', 'utf8');
const messaging = fs.readFileSync('server/digitalEmployees/customerMessagingPolicy.ts', 'utf8');

assert.match(app, /<ConversionPage[\s\S]*?includeMockCustomers=\{false\}/, 'the production customer workspace must not inject simulated customers');
assert.match(app, /<StrategyPage[\s\S]*?includeMockCustomers=\{false\}/, 'the production strategy dashboards must not inject simulated customers');
assert.match(app, /<AgentMemoryPage[\s\S]*?includeMockCustomers=\{false\}/, 'the production Agent memory page must not inject simulated evidence');
assert.match(memory, /includeMockCustomers && import\.meta\.env\.DEV && !hasContentOpsData/, 'memory examples may only exist behind an explicit development simulation scope');
assert.doesNotMatch(cockpit, /frontend_preview|BUSINESS_PREVIEW|PreviewExecutionPanel|查看示例数据/, 'the production cockpit must contain no synthetic metrics or task receipts');

assert.match(snapshot, /filter\(connectedAccount\)/, 'account readiness must come only from currently connected tenant records');
assert.match(snapshot, /weekPosts\.filter\(hasPublishedReceipt\)/, 'published counts must require provider receipts');
assert.match(snapshot, /weekProjects\.filter\(completedWorkHasReceipt\)/, 'completed-work counts must require accessible render evidence');
assert.match(snapshot, /provider_message_id/, 'customer outreach counts must require provider message receipts');

assert.match(production, /isSyntheticMaterial\(record\)/, 'the content worker must reject synthetic material provenance');
assert.match(studio, /isSyntheticMaterial\(m as unknown as Record<string, unknown>\)/, 'Studio material listings must apply the same synthetic provenance filter');
assert.match(studio, /listCloudMaterials\(tenantId\)\)\.filter\(m => !isSyntheticMaterial/, 'Studio must filter synthetic cloud records as well as local material JSON');
assert.match(production, /stat\.size < 10_000/, 'the content worker must verify a non-empty rendered file before completion');
assert.match(production, /selectedMaterialEvidence/, 'rendered projects must retain material provenance');
assert.match(production, /knowledge_gap/, 'missing product, material, or analysis must be persisted as an explicit knowledge gap');
assert.match(publisher, /realPublishingAuthorized !== true/, 'the real publisher must enforce the frozen tenant authorization');
assert.match(messaging, /allowRealCustomerMessages/, 'real customer messages must enforce tenant authorization');

console.log('production data truthfulness contract tests passed');
