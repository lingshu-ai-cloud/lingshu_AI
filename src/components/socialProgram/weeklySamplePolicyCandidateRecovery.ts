import type { WeeklySamplePolicyCandidates, WeeklySamplePolicyTerms } from '../../lib/socialProgramApi';

export function matchingSamplePolicyCandidate(
  view: WeeklySamplePolicyCandidates,
  sourceSha256: string,
  terms: WeeklySamplePolicyTerms,
) {
  return view.candidates.find(candidate => candidate.sourceSha256 === sourceSha256
    && JSON.stringify(candidate.terms) === JSON.stringify(terms)) ?? null;
}
