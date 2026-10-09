import assert from 'node:assert/strict';
import { assessBant, selectProgressionGoal, type QualificationTurn } from './qualification.js';

const highValue = assessBant({
  turns: [
    { role: 'buyer', text: 'I am the purchasing manager for our clinic chain. We need 5,000 private-label bottles before next month.' },
  ],
});
assert.equal(highValue.budget.score, 20);
assert.equal(highValue.authority.score, 25);
assert.equal(highValue.need.score, 25);
assert.equal(highValue.timing.score, 22);
assert.equal(highValue.total, 92);
assert.equal(highValue.level, 'hot');
assert.equal(selectProgressionGoal(highValue, 'English').dimension, 'budget');

const budgetCompleted = assessBant({
  previous: highValue,
  turns: [{ role: 'buyer', text: 'Our target budget is USD 12,000 and we also want wholesale tiers.' }],
});
assert.equal(budgetCompleted.budget.score, 25, 'new signals must add to prior-turn signals without double counting');
assert.equal(budgetCompleted.completeness, 4);

const budgetSignals = assessBant({
  turns: [
    { role: 'buyer', text: 'We currently buy from another supplier. We need 1,000 pcs and our target price is USD 2.50. Do you have wholesale pricing?' },
  ],
});
assert.equal(budgetSignals.budget.score, 25);
assert.ok(budgetSignals.budget.evidence.some(item => item.includes('1000') || item.includes('500')));
assert.ok(budgetSignals.budget.evidence.every(item => /[+-]\d+$/.test(item)), 'evidence must explain the points instead of echoing raw buyer text');

const needSignals = assessBant({
  turns: [{ role: 'buyer', text: 'I need the collagen serum in a 30ml bottle for clinics in the Dubai market.' }],
});
assert.equal(needSignals.need.score, 25);
assert.equal(needSignals.need.status, 'confirmed');

const weak = assessBant({ turns: [{ role: 'buyer', text: 'Please send the catalog.' }] });
assert.equal(weak.need.score, 3);
assert.equal(weak.need.status, 'partial');
assert.equal(selectProgressionGoal(weak, '中文').dimension, 'timing');

const later = assessBant({ turns: [{ role: 'buyer', text: 'Maybe next year. I am only comparing suppliers now.' }] });
assert.equal(later.timing.score, 9);

const redFlagged = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your best price for private label?' },
    { role: 'buyer', text: 'Please send the full price list for everything.' },
  ],
});
assert.equal(redFlagged.authenticity.redFlags.length, 2);
assert.equal(redFlagged.authenticity.score, 0.5);
assert.ok(redFlagged.total < redFlagged.rawTotal);

const blackBanded = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your factory address and production line details? Who else do you supply?' },
    { role: 'buyer', text: 'What is your lowest price?' },
    { role: 'buyer', text: 'Price? Just the best price.' },
  ],
});
assert.equal(blackBanded.authenticity.redFlags.length, 3);
assert.equal(blackBanded.authenticity.score, 0.2);
assert.equal(blackBanded.band, 'black');
assert.ok(blackBanded.authenticity.redFlags.every(flag => flag.startsWith('信息待核实')));

const recovered = assessBant({
  previous: redFlagged,
  turns: [
    { role: 'buyer', text: 'We are a skincare retail chain. Our website is ourbrand.com. Can you explain shipping and payment terms?' },
  ],
});
assert.equal(recovered.authenticity.redFlags.length, 2);
assert.equal(recovered.authenticity.greenFlags.length, 3);
assert.equal(recovered.authenticity.score, 0.8);

const suspiciousPayment = assessBant({
  turns: [{ role: 'buyer', text: 'Ship 10,000 pcs first and I will pay after delivery.' }],
});
assert.ok(suspiciousPayment.authenticity.redFlags.some(flag => flag.includes('异常大单')));

const actionImpacts = assessBant({
  turns: [{ role: 'buyer', text: 'Please prepare a proforma invoice. I also want a sample.' }],
});
assert.equal(actionImpacts.authority.score, 10);
assert.equal(actionImpacts.need.score, 10);
assert.equal(actionImpacts.timing.score, 25);

console.log('BANT additive scoring, evidence and authenticity passed');

const authorityCorrection = [
  { role: 'buyer' as const, text: 'I am the owner. We need OEM products.' },
  { role: 'buyer' as const, text: 'Correction: I cannot approve purchases. I am only researching for my manager.' },
  { role: 'buyer' as const, text: 'Please quote 1500 pcs. Budget is USD 6000.' },
];
const revoked = assessBant({ turns: authorityCorrection });
assert.equal(revoked.authority.score, 0, 'explicit denial supersedes historical owner and OEM signals');
assert.equal(revoked.authority.status, 'unknown');
assert.ok(!revoked.authority.evidence.some(item => item.includes('老板')));
const incrementalRevoked = assessBant({ previous: highValue, turns: authorityCorrection.slice(1, 2) });
assert.equal(incrementalRevoked.authority.score, 0, 'previous confirmed scores cannot survive explicit revocation');
assert.equal(assessBant({ previous: incrementalRevoked, turns: authorityCorrection.slice(2) }).authority.score, 0, 'unrelated later messages do not restore decision rights');
assert.equal(assessBant({ previous: incrementalRevoked, turns: [{ role: 'buyer', text: 'My boss is the owner and will review your quote.' }] }).authority.score, 0, 'another person being the owner cannot restore buyer authority');
assert.equal(assessBant({ previous: incrementalRevoked, turns: [{ role: 'buyer', text: 'I approve purchases now.' }] }).authority.score, 16, 'new explicit authority can replace the denial');
assert.equal(assessBant({ turns: [...authorityCorrection, { role: 'buyer', text: 'I approve purchases now.' }] }).authority.score, 16, 'restoration does not resurrect obsolete owner and OEM scores');
assert.equal(assessBant({ previous: highValue, turns: [{ role: 'buyer', text: '我不能批准采购，先替经理了解产品。' }] }).authority.score, 0);
assert.equal(assessBant({ previous: highValue, turns: [{ role: 'seller', text: 'I cannot approve purchases.' }] }).authority.score, highValue.authority.score, 'seller statements cannot revoke buyer authority');

const demandOriginal: QualificationTurn[] = [{ role: 'buyer', text: 'We need OEM and a sample. The deadline is within 30 days.' }];
const demandCancellation: QualificationTurn[] = [{ role: 'buyer', text: 'No customization or OEM, and no samples. There is no deadline anymore.' }];
const originalDemand = assessBant({ turns: demandOriginal });
assert.equal(originalDemand.need.score, 25);
assert.equal(originalDemand.timing.score, 25);
for (const cancelled of [
  assessBant({ turns: [...demandOriginal, ...demandCancellation] }),
  assessBant({ previous: originalDemand, turns: demandCancellation }),
  assessBant({ previous: originalDemand, turns: [{ role: 'buyer', text: '取消定制，不需要样品，取消之前的交期。' }] }),
]) {
  assert.equal(cancelled.need.score, 0, 'cancelled customization and samples cannot inflate need');
  assert.equal(cancelled.timing.score, 0, 'cancelled samples and deadline cannot inflate timing');
  assert.equal(cancelled.authority.score, 0, 'cancelled OEM cannot inflate decision participation');
  assert.ok(!cancelled.evidence.some(item => /OEM|样品|截止时间/.test(item)), 'obsolete scoring evidence is removed');
  const unrelated = assessBant({ previous: cancelled, turns: [{ role: 'buyer', text: 'Thank you.' }] });
  assert.equal(unrelated.need.score, 0, 'incremental unrelated turns do not restore revoked needs');
  assert.equal(unrelated.timing.score, 0);
  const restored = assessBant({ previous: unrelated, turns: demandOriginal });
  assert.equal(restored.need.score, originalDemand.need.score, 'explicit later buyer requirements restore only matching positive signals');
  assert.equal(restored.timing.score, originalDemand.timing.score);
  assert.equal(restored.authority.score, originalDemand.authority.score);
}
const sellerCancellation = assessBant({ previous: originalDemand, turns: demandCancellation.map(turn => ({ ...turn, role: 'seller' })) });
assert.equal(sellerCancellation.need.score, originalDemand.need.score, 'seller cannot revoke buyer requirements');
assert.equal(sellerCancellation.timing.score, originalDemand.timing.score);
const restoredFull = assessBant({ turns: [...demandOriginal, ...demandCancellation, ...demandOriginal] });
assert.equal(restoredFull.need.score, originalDemand.need.score);
assert.equal(restoredFull.timing.score, originalDemand.timing.score);
const negativeOnly = assessBant({ turns: demandCancellation });
assert.equal(negativeOnly.need.score, 0, 'negative mentions must not create positive scores');
assert.equal(negativeOnly.authority.score, 0);
assert.equal(negativeOnly.timing.score, 0);

const specificDemand = assessBant({ turns: [{ role: 'buyer', text: 'SKU ABS-01, material ABS, OEM and a sample; deadline within 30 days. Please prepare a proforma invoice.' }] });
const specificCancelled = assessBant({ previous: specificDemand, turns: demandCancellation });
assert.equal(specificCancelled.need.score, 25, 'unrelated product and material scores remain after cancellation');
assert.equal(specificCancelled.timing.score, 16, 'formal quotation signal remains when deadline and samples are revoked');
assert.equal(specificCancelled.authority.score, 10, 'formal quotation authority signal survives OEM cancellation');
const onlySampleRestored = assessBant({ previous: specificCancelled, turns: [{ role: 'buyer', text: 'I want a sample now.' }] });
assert.equal(onlySampleRestored.timing.score, 25);
assert.equal(onlySampleRestored.need.signalPoints?.customization, undefined, 'restoring samples does not restore OEM');
assert.equal(onlySampleRestored.timing.signalPoints?.deadline, undefined, 'restoring samples does not restore old deadline');

const realDeliveryCancellation = [{ role: 'buyer' as const, text: 'No customization or OEM, no samples, and no delivery deadline anymore.' }];
const cancelledRealDelivery = assessBant({ previous: originalDemand, turns: realDeliveryCancellation });
assert.equal(cancelledRealDelivery.timing.score, 0, 'real Messenger no delivery deadline correction removes old delivery points');
const restoredFromMarkerAndFullHistory = assessBant({ previous: cancelledRealDelivery, turns: [...demandOriginal, ...realDeliveryCancellation, ...demandOriginal] });
assert.equal(restoredFromMarkerAndFullHistory.need.score, originalDemand.need.score, 'new confirmation beats both old full-history denial and previous revoked marker');
assert.equal(restoredFromMarkerAndFullHistory.timing.score, originalDemand.timing.score);
assert.equal(restoredFromMarkerAndFullHistory.authority.score, originalDemand.authority.score);
const stillRevokedFullHistory = assessBant({ previous: cancelledRealDelivery, turns: [...demandOriginal, ...realDeliveryCancellation, { role: 'buyer', text: 'Thank you.' }] });
assert.equal(stillRevokedFullHistory.timing.score, 0, 'unrelated final turn cannot make old confirmation newer than denial');
