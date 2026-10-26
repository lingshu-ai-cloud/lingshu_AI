import { paidProductionHash, type PaidStageRequirement, type BoundPaidRoute } from '../starter198/socialContentPaidOperationPlan.js';
import type { SocialPaidOperationIntent } from './socialContentTaskBudgetAuthority.js';
import type { SocialTaskBudgetScope } from './socialContentTaskBudget.js';

export interface VoiceRouteRevisionBinding {
  schema: 'social-content-voice-route-revision.v1'; key: string;
  revisionHash: string; supersedesOperationId: string;
}
export type VoiceRouteRevisedIntent = SocialPaidOperationIntent & { routeRevision?: VoiceRouteRevisionBinding };
type Funding = { scope: SocialTaskBudgetScope; requirements: PaidStageRequirement[];
  routeBindings: Record<string, BoundPaidRoute>; intents: SocialPaidOperationIntent[] };

/** One identity resolver for submission and recovery receipt paths. Old holds
 * remain in the ledger, but only the reviewed replacement may be submitted. */
export function resolveActiveVoiceIntent(funding: Funding, key: string) {
  const requirement = funding.requirements.find(item => item.key === key), route = funding.routeBindings[key];
  if (!requirement || !route) throw Error('voice_route_revision_requirement_missing');
  const revised = (funding.intents as VoiceRouteRevisedIntent[]).filter(item => item.routeRevision?.key === key);
  if (revised.length > 1) throw Error('voice_route_revision_ambiguous');
  const correction = funding.intents.filter(item => item.stage === requirement.stage && item.correction
    && item.correction.kind === (requirement.stage === 'tts' ? 'voice_tts' : 'voice_alignment'));
  if (correction.length > 1 || (revised.length && correction.length)) throw Error('voice_route_revision_ambiguous');
  const revision = revised[0]?.routeRevision;
  if (revision && (revision.schema !== 'social-content-voice-route-revision.v1'
    || !/^[a-f0-9]{64}$/.test(revision.revisionHash) || !revision.supersedesOperationId)) throw Error('voice_route_revision_binding_invalid');
  const identity = revision ? { scope: funding.scope, key, attempt: 0, routeRevision: revision }
    : correction.length ? { scope: funding.scope, key, attempt: 1, correction: correction[0]!.correction }
      : { scope: funding.scope, key, attempt: 0 };
  const contract = revision ? { requirement, route, attempt: 0, routeRevision: revision }
    : correction.length ? { requirement, route, attempt: 1, correction: correction[0]!.correction }
      : { requirement, route, attempt: 0 };
  const operationId = 'paid-plan:' + paidProductionHash(identity);
  const intents = funding.intents.filter(item => item.operationId === operationId);
  const intent = intents[0], expectedInputContractHash = paidProductionHash(contract);
  if (intents.length !== 1 || !intent || intent.inputContractHash !== expectedInputContractHash
    || intent.provider !== route.provider || intent.model !== route.model || intent.accountRef !== route.accountRef
    || intent.stage !== requirement.stage || intent.shotId !== requirement.shotId
    || paidProductionHash(intent.maximumUnits) !== paidProductionHash(route.maximumUnits)) throw Error('voice_route_revision_intent_changed');
  return { intent: intent as VoiceRouteRevisedIntent, operationId, expectedInputContractHash };
}
