import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8');
const batchPlan = readFileSync(new URL('./contentBatchPlan.ts', import.meta.url), 'utf8');
const recommendationStart = route.indexOf('async function recommendPackageWithTenantEvidence');
const recommendationEnd = route.indexOf('\n\nfunction clearAutomaticViralReferences', recommendationStart);
const recommendation = route.slice(recommendationStart, recommendationEnd);
const bindingStart = route.indexOf('async function bindWeeklyViralLibraryToPackage');
const bindingEnd = route.indexOf('\n\nfunction collectionLimitForInventoryGap', bindingStart);
const binding = route.slice(bindingStart, bindingEnd);

test('viral references are unique per week but remain eligible in later weeks', () => {
  assert.ok(recommendationStart >= 0 && recommendationEnd > recommendationStart);
  assert.ok(bindingStart >= 0 && bindingEnd > bindingStart);
  assert.match(recommendation, /videos: producibleReferences/, 'a new week must rank only references covered by current server-side production evidence');
  assert.match(recommendation, /referenceCoveredByProductionEvidence/, 'reference selection must use the same fixed-yield readiness gate as production start');
  assert.doesNotMatch(recommendation, /contentBatchPlans|priorBatches|usedReferenceIds/, 'historic handoffs must not permanently consume a viral reference');
  assert.match(binding, /const usedReferenceIds: string\[\] = \[\]/, 'runtime repair must scope collision checks to the current weekly plan');
  assert.match(binding, /evaluatePlannedReferenceReuse\(plans, library\.items, usedReferenceIds\)/, 'the current plan must still enforce one reference per weekly video slot');
  assert.match(binding, /coveredReferenceIds/, 'runtime rebinding must not select a reference whose shot archetypes cannot be produced');
  assert.match(route, /referenceIdentities:\s*Object\.fromEntries\(analyses\.items\.map\(item\s*=>\s*\[item\.id,\s*referenceContentIdentity\(item\)\]\)\)/,
    'server routing evidence must carry the physical identity of every persisted reference record');
  assert.match(batchPlan, /uniquePhysicalReferenceIds\(input\.evidence/,
    'automatic fallback allocation must deduplicate physical references before counting weekly capacity');
  assert.match(batchPlan, /sameReferenceContent\(item\.identity,\s*identity\)/,
    'explicit plans must compare physical identities instead of database record ids');
});
