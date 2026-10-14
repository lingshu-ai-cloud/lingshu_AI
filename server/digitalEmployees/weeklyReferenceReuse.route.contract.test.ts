import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8');
const recommendationStart = route.indexOf('async function recommendPackageWithTenantEvidence');
const recommendationEnd = route.indexOf('\n\nfunction clearAutomaticViralReferences', recommendationStart);
const recommendation = route.slice(recommendationStart, recommendationEnd);
const bindingStart = route.indexOf('async function bindWeeklyViralLibraryToPackage');
const bindingEnd = route.indexOf('\n\nfunction collectionLimitForInventoryGap', bindingStart);
const binding = route.slice(bindingStart, bindingEnd);

test('viral references are unique per week but remain eligible in later weeks', () => {
  assert.ok(recommendationStart >= 0 && recommendationEnd > recommendationStart);
  assert.ok(bindingStart >= 0 && bindingEnd > bindingStart);
  assert.match(recommendation, /videos: videos\.items/, 'a new week must rank the full analyzed library');
  assert.doesNotMatch(recommendation, /contentBatchPlans|priorBatches|usedReferenceIds/, 'historic handoffs must not permanently consume a viral reference');
  assert.match(binding, /const usedReferenceIds: string\[\] = \[\]/, 'runtime repair must scope collision checks to the current weekly plan');
  assert.match(binding, /evaluatePlannedReferenceReuse\(plans, library\.items, usedReferenceIds\)/, 'the current plan must still enforce one reference per weekly video slot');
});
