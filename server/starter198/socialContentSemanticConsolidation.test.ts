import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateReferenceSemanticShots } from './socialContentSemanticConsolidation.js';
import type { SocialReplicationScriptShot } from '../../shared/contracts/socialContentWorkflow.js';
const context = { productName: 'Owned product', facts: [], source: 'enterprise_product' as const, confidence: 1 };
const functions = ['hook', 'problem', 'value', 'demonstration', 'proof', 'call_to_action'] as const;
const shots = Array.from({ length: 501 }, (_, i) => ({ shotId: `scene-${i}`, referenceShotId: `reference-${i}`, startSeconds: i, endSeconds: i + 1, purpose: functions[Math.min(5, Math.floor(i / 84))], spokenText: `Source statement ${i}.`, referenceSpokenText: `Source statement ${i}.`, visualInstruction: 'Original reference composition', captionText: null, audioAndTransition: null, fidelityPoints: [`factor-${i}`], mustDifferPoints: [], lockedRegions: ['product_identity'], risks: [], materialPlan: { shotId: `scene-${i}`, function: functions[Math.min(5, Math.floor(i / 84))], sourceStrategy: 'authorized_digital_presenter', sourceRefs: [], fallbackSourceStrategy: null, requestedDescription: 'Original third-party footage', productionInstruction: 'Original', truthBoundary: { subject: 'customer_factory', syntheticVisualAllowed: false, customerEvidenceRequired: true, customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true, prohibitedRepresentations: [] }, functionalEquivalentReplacement: { required: false, preservesFunction: 'proof', replacesSubject: null, description: null, reason: null }, feasibility: 'functional_equivalent', feasibilityReason: 'Original', customerShootRequired: false } } as SocialReplicationScriptShot));
test('viral replication keeps every reference slot even with a shorter target and ten-yuan budget', () => {
    const original = JSON.stringify(shots);
    const result = consolidateReferenceSemanticShots({ shots, context, planning: { referenceMode: 'account_format_series', targetDurationSeconds: 18, budgetCny: 10, language: 'en', callToAction: 'Contact us about this product.' } });
    assert.equal(result, shots);
    assert.equal(result.length, 501);
    assert.equal(result.at(-1)!.endSeconds, 501);
    assert.equal(JSON.stringify(shots), original);
});
test('missing or incompatible target never changes the reference slots', () => {
    assert.equal(consolidateReferenceSemanticShots({ shots, context, planning: { targetDurationSeconds: null, budgetCny: 10 } }), shots);
    assert.equal(consolidateReferenceSemanticShots({ shots, context, planning: { referenceMode: 'account_format_series', targetDurationSeconds: 12, budgetCny: 10 } }), shots);
});

test('single source fidelity keeps all 37 slots and 38 seconds despite an 18-second target and ten-yuan budget', () => {
    const sourceShots = shots.slice(0, 37).map((shot, i) => ({ ...structuredClone(shot), startSeconds: i * 38 / 37, endSeconds: (i + 1) * 38 / 37 }));
    const snapshot = structuredClone(sourceShots);
    for (const referenceMode of [undefined, 'single_source_fidelity'] as const) {
        const result = consolidateReferenceSemanticShots({ shots: sourceShots, context, planning: { referenceMode, targetDurationSeconds: 18, budgetCny: 10 } });
        assert.equal(result, sourceShots);
        assert.deepEqual(result, snapshot);
        assert.equal(result.length, 37);
        assert.equal(result.at(-1)!.endSeconds, 38);
        assert.ok(result.every(shot => shot.scriptOrigin !== 'budget_semantic_revision'));
    }
});
