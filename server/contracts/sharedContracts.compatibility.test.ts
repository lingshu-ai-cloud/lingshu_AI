import assert from 'node:assert/strict';
import * as legacyContinuationPolicy from '../../src/lib/continuationPolicy.js';
import * as legacyOperatingMaturity from '../../src/lib/operatingMaturity.js';
import * as legacyVideoCreationPlan from '../../src/lib/videoCreationPlan.js';
import * as legacyVideoLanguages from '../../src/lib/videoLanguages.js';
import * as sharedContinuationPolicy from '../../shared/contracts/continuationPolicy.js';
import * as sharedOperatingMaturity from '../../shared/contracts/operatingMaturity.js';
import * as sharedVideoCreationPlan from '../../shared/contracts/videoCreationPlan.js';
import * as sharedVideoLanguages from '../../shared/contracts/videoLanguages.js';

function assertExportsMatch(label: string, legacyEntry: object, sharedEntry: object): void {
  const legacyExports = legacyEntry as Record<string, unknown>;
  const sharedExports = sharedEntry as Record<string, unknown>;
  const legacyKeys = Object.keys(legacyExports).sort();
  const sharedKeys = Object.keys(sharedExports).sort();

  assert.deepEqual(legacyKeys, sharedKeys, `${label} must expose the same runtime exports from both entry points`);
  for (const key of sharedKeys) {
    assert.strictEqual(legacyExports[key], sharedExports[key], `${label}.${key} must re-export the canonical shared binding`);
  }
}

assertExportsMatch('videoLanguages', legacyVideoLanguages, sharedVideoLanguages);
assertExportsMatch('videoCreationPlan', legacyVideoCreationPlan, sharedVideoCreationPlan);
assertExportsMatch('continuationPolicy', legacyContinuationPolicy, sharedContinuationPolicy);
assertExportsMatch('operatingMaturity', legacyOperatingMaturity, sharedOperatingMaturity);

console.log('shared contract compatibility tests passed');
