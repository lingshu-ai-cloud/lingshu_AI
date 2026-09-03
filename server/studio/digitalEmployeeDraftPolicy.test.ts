import assert from 'node:assert/strict';
import type { ExecutionContract } from '../digitalEmployees/executionContract.js';
import { DIGITAL_EMPLOYEE_DRAFT_POLICY_VERSION, buildEvidenceBoundFallbackDraft, enforceDigitalEmployeeDraftPolicy, evaluateDigitalEmployeeDraftPolicy } from './digitalEmployeeDraftPolicy.js';

const contract = {
  payloadHash: 'a'.repeat(64),
  intent: { audience: 'European procurement managers', focusProducts: ['Vision Sensor'] },
  facts: [
    { key: 'products', source: 'enterprise/products', sourceVersion: 'v1', summary: 'Vision Sensor · MOQ 100 units · CE certified' },
    { key: 'brand', source: 'enterprise/brand', sourceVersion: 'v1', summary: 'Professional and factual' },
  ],
  policy: { constraints: ['禁止 cheap miracle'] },
  resources: { connectedAccounts: [{ id: 'account-tiktok', platform: 'tiktok' }] },
} as ExecutionContract;

const valid = {
  platform: 'tiktok',
  language: 'en',
  hook: 'Review the Vision Sensor facts.',
  audience: 'European procurement managers',
  cta: 'Request the verified specification sheet.',
  title: 'Vision Sensor overview',
  caption: 'Vision Sensor · MOQ 100 units · CE certified',
  hashtags: ['#VisionSensor'],
  voiceover: ['Review the documented product facts before choosing a supplier.'],
  storyboard: [{ shot: 99, visual: 'Show the supplied product image.', voice: 'Review the documented product facts before choosing a supplier.', durationSeconds: 4 }],
  evidenceRefs: ['enterprise/products'],
  claimBindings: [{ claim: 'Vision Sensor · MOQ 100 units · CE certified', evidenceRef: 'products', evidenceQuote: 'Vision Sensor · MOQ 100 units · CE certified' }],
};

assert.equal(DIGITAL_EMPLOYEE_DRAFT_POLICY_VERSION, 3);
const normalized = enforceDigitalEmployeeDraftPolicy({ generated: valid, contract, brandTaboos: 'spammy' });
assert.equal(normalized.storyboard[0].shot, 1, 'shot numbering is canonical rather than model-controlled');
assert.deepEqual(normalized.evidenceRefs, ['products'], 'source references are canonicalized to contract fact keys');
assert.doesNotThrow(() => enforceDigitalEmployeeDraftPolicy({ generated: buildEvidenceBoundFallbackDraft(contract), contract }));

for (const [patch, expected] of [
  [{ caption: 'Guaranteed results in 7 days.' }, 'absolute_claim'],
  [{ caption: 'Improve output by 50%.' }, 'unsupported_numeric_claim'],
  [{ caption: 'The fastest and cheapest option.' }, 'absolute_claim'],
  [{ caption: 'FDA-approved Vision Sensor.' }, 'unsupported_certification_claim'],
  [{ caption: 'Proprietary AI autofocus with aerospace-grade optics.' }, 'unsupported_feature_claim'],
  [{ caption: 'A cheap miracle for every line.' }, 'policy_constraint_violation'],
  [{ caption: 'A cheap-miracle for every line.' }, 'policy_constraint_violation'],
  [{ caption: 'A cheap\u200bmiracle for every line.' }, 'invisible_format_character'],
  [{ caption: 'A chеap miracle for every line.' }, 'policy_constraint_violation'],
  [{ caption: 'A ch3ap miracle for every line.' }, 'policy_constraint_violation'],
  [{ caption: 'A chéap miracle for every line.' }, 'policy_constraint_violation'],
  [{ caption: 'Never use spammy wording.' }, 'brand_taboo_used'],
  [{ evidenceRefs: ['enterprise/unknown'] }, 'unsupported_evidence_ref'],
  [{ evidenceRefs: ['brand'] }, 'products_evidence_missing'],
  [{ platform: 'linkedin' }, 'platform_not_connected'],
  [{ platform: 'mastodon' }, 'invalid_platform'],
  [{ voiceover: [], storyboard: [] }, 'voice_content_missing'],
] as Array<[Record<string, unknown>, string]>) {
  const result = evaluateDigitalEmployeeDraftPolicy({ generated: { ...valid, ...patch }, contract, brandTaboos: 'spammy' });
  assert.ok(result.issues.some(issue => issue.includes(expected)), `${expected}: ${result.issues.join(', ')}`);
}

const sparseContract = {
  ...contract,
  facts: [{ key: 'products', source: 'enterprise/products', sourceVersion: 'v1', summary: 'Vision Sensor' }],
  policy: { ...contract.policy, constraints: [] },
} as ExecutionContract;
const hallucinated = {
  ...valid,
  hook: 'Vision Sensor makes assembly teams calmer every shift.',
  title: 'Vision Sensor overview',
  caption: 'Vision Sensor makes assembly teams calmer every shift.',
  voiceover: ['Vision Sensor makes assembly teams calmer every shift.'],
  storyboard: [{ shot: 1, visual: 'Show the supplied product image.', voice: 'Vision Sensor makes assembly teams calmer every shift.', durationSeconds: 4 }],
  claimBindings: [{ claim: 'Vision Sensor', evidenceRef: 'products', evidenceQuote: 'Vision Sensor' }],
};
assert.ok(
  evaluateDigitalEmployeeDraftPolicy({ generated: hallucinated, contract: sparseContract }).issues
    .some(issue => issue.startsWith('unsupported_lexical_claim:')),
  'every non-neutral public claim must be extractively bound, not merely accompanied by a product evidence ref',
);
const allowlistOnlyHallucination = {
  ...hallucinated,
  hook: 'Vision Sensor is available today.',
  caption: 'Vision Sensor is available today.',
  voiceover: ['Vision Sensor is available today.'],
  storyboard: [{ shot: 1, visual: 'Show the supplied product image.', voice: 'Vision Sensor is available today.', durationSeconds: 4 }],
};
assert.ok(
  evaluateDigitalEmployeeDraftPolicy({ generated: allowlistOnlyHallucination, contract: sparseContract }).issues
    .some(issue => issue.startsWith('non_template_public_copy:')),
  'neutral-looking words cannot be recombined into an unverified availability claim',
);

const multiHallucination = {
  ...hallucinated,
  caption: 'Precision-engineered optics for harsh factories, with a stainless-steel body and Bluetooth connectivity. It cuts downtime and lasts for years.',
};
assert.ok(evaluateDigitalEmployeeDraftPolicy({ generated: multiHallucination, contract: sparseContract }).issues.length > 0);

const negatedFactContract = {
  ...contract,
  facts: [{ key: 'products', source: 'enterprise/products', sourceVersion: 'v2', summary: 'Sensor is currently unavailable' }],
  policy: { ...contract.policy, constraints: [] },
} as ExecutionContract;
const negationStrippingAttempt = {
  ...valid,
  hook: 'available',
  title: 'available',
  caption: 'available',
  voiceover: ['available'],
  storyboard: [{ shot: 1, visual: 'Show the supplied product image.', voice: 'available', durationSeconds: 4 }],
  claimBindings: [{ claim: 'available', evidenceRef: 'products', evidenceQuote: 'Sensor is currently unavailable' }],
};
assert.ok(
  evaluateDigitalEmployeeDraftPolicy({ generated: negationStrippingAttempt, contract: negatedFactContract }).issues
    .some(issue => issue.startsWith('claim_not_complete_fact:')),
  'a claim cannot strip negation or extract a misleading substring from a fact',
);

assert.throws(
  () => enforceDigitalEmployeeDraftPolicy({ generated: { ...valid, caption: 'Guaranteed results in 7 days.' }, contract }),
  /content_draft_quality_gate_failed/,
);
console.log('digital employee draft policy tests passed');
