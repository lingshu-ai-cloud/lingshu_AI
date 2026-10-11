import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateReferenceSemanticShots } from './socialContentSemanticConsolidation.js';
import type { SocialReplicationScriptShot } from '../../shared/contracts/socialContentWorkflow.js';
const context = { productName: 'Owned product', facts: [], source: 'enterprise_product' as const, confidence: 1 };
const functions = ['hook', 'problem', 'value', 'demonstration', 'proof', 'call_to_action'] as const;
const shots = Array.from({ length: 501 }, (_, i) => ({ shotId: `scene-${i}`, referenceShotId: `reference-${i}`, startSeconds: i, endSeconds: i + 1, purpose: functions[Math.min(5, Math.floor(i / 84))], spokenText: `Source statement ${i}.`, referenceSpokenText: `Source statement ${i}.`, visualInstruction: 'Original reference composition', captionText: null, audioAndTransition: null, fidelityPoints: [`factor-${i}`], mustDifferPoints: [], lockedRegions: ['product_identity'], risks: [], materialPlan: { shotId: `scene-${i}`, function: functions[Math.min(5, Math.floor(i / 84))], sourceStrategy: 'authorized_digital_presenter', sourceRefs: [], fallbackSourceStrategy: null, requestedDescription: 'Original third-party footage', productionInstruction: 'Original', truthBoundary: { subject: 'customer_factory', syntheticVisualAllowed: false, customerEvidenceRequired: true, customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true, prohibitedRepresentations: [] }, functionalEquivalentReplacement: { required: false, preservesFunction: 'proof', replacesSubject: null, description: null, reason: null }, feasibility: 'functional_equivalent', feasibilityReason: 'Original', customerShootRequired: false } } as SocialReplicationScriptShot));
test('budget authored revision maps all 501 reference factors to six 18-second functions without copying factory assertions', () => {
    const original = JSON.stringify(shots);
    const result = consolidateReferenceSemanticShots({ shots, context, planning: { targetDurationSeconds: 18, budgetCny: 10, language: 'en', callToAction: 'Contact us about this product.' } });
    assert.equal(result.length, 6);
    assert.equal(result.at(-1)!.endSeconds, 18);
    assert.ok(result.every(s => s.endSeconds - s.startSeconds >= 3));
    assert.deepEqual(result.flatMap(s => s.referenceShotIds), shots.map(s => s.referenceShotId));
    assert.deepEqual(result.flatMap(s => s.fidelityPoints), shots.flatMap(s => s.fidelityPoints));
    assert.equal(result.filter(s => s.materialPlan.sourceStrategy === 'authorized_digital_presenter').length, 1);
    assert.ok(result.every(s => s.scriptOrigin === 'budget_semantic_revision' && !s.referenceSpokenText && !s.voiceoverReplacement));
    assert.ok(result.every(s => !s.spokenText?.includes('Source statement')));
    assert.ok(result.every(s => s.materialPlan.truthBoundary.mustNotImplyCustomerReality));
    assert.equal(result[4]!.materialPlan.functionalEquivalentReplacement.required, true);
    assert.equal(JSON.stringify(shots), original);
});
test('old identity-only plan and missing target are unchanged; incompatible target cannot fabricate three-second product shots', () => {
    assert.equal(consolidateReferenceSemanticShots({ shots, context, planning: { targetDurationSeconds: null, budgetCny: 10 } }), shots);
    assert.throws(() => consolidateReferenceSemanticShots({ shots, context, planning: { targetDurationSeconds: 12, budgetCny: 10 } }), /requires_fewer_functions/);
});
