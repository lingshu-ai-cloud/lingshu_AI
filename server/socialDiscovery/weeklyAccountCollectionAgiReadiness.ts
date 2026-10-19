import {createHash} from 'node:crypto';
import type {WeeklyAccountCollectionBudgetAuthorization} from './weeklyAccountCollectionBudget.js';
import type {WeeklyApifyAgiBalanceObservation,WeeklyApifyPpePreflight} from './weeklyAccountCollectionApifyPreflight.js';

/** Read-only diagnostic for a future prepaid collection. None of these
 * observations authorizes a POST: only a durable, exclusive token-balance
 * reservation and a separately verified dataset-cost contract could do so. */
export interface WeeklyAgiCollectionReadiness {
  schema:'weekly-agi-collection-readiness.v1';
  checkedAt:string;
  evidenceHash:string;
  blockers:string[];
  permitsPaidCollection:false;
}

export function assessWeeklyAgiCollectionReadiness(input:{
  actorId:string;token:string;now:string;runCapUsd:number;fxCnyPerUsdUpper:number;
  budget?:WeeklyAccountCollectionBudgetAuthorization|null;
  balance?:WeeklyApifyAgiBalanceObservation|null;
  actor?:WeeklyApifyPpePreflight|null;
}):WeeklyAgiCollectionReadiness{
  const now=Date.parse(input.now),blockers:string[]=[];
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const fingerprint=input.token?createHash('sha256').update(input.token).digest('hex'):null;
  const balance=input.balance,actor=input.actor,budget=input.budget;
  if(!Number.isFinite(now))blockers.push('observation_clock_unverified');
  if(!fingerprint)blockers.push('dedicated_token_missing');
  if(!balance||balance.tokenFingerprint!==fingerprint||balance.permitsWeeklyCollection!==false||
     !Number.isFinite(Date.parse(balance.observedAt))||!Number.isFinite(now)||Date.parse(balance.observedAt)>now||
     now-Date.parse(balance.observedAt)>60_000||Date.parse(balance.expiresAt)<=now||
     !Number.isFinite(balance.remainingBalanceUsd)||balance.remainingBalanceUsd<0)
    blockers.push('dedicated_balance_unverified');
  if(!actor||actor.actorId!==input.actorId||actor.actorPermissionLevel!=='LIMITED_PERMISSIONS'||
     !actor.agiPrepaidCompatibleByPermission||actor.pricingModel!=='PAY_PER_EVENT'||
     !Number.isFinite(Date.parse(actor.observedAt))||!Number.isFinite(now)||Date.parse(actor.observedAt)>now||
     now-Date.parse(actor.observedAt)>60_000)
    blockers.push('authenticated_actor_compatibility_unverified');
  if(!Number.isFinite(input.runCapUsd)||input.runCapUsd<=0||
     !Number.isFinite(input.fxCnyPerUsdUpper)||input.fxCnyPerUsdUpper<=0||
     !Number.isSafeInteger(Math.ceil(input.runCapUsd*input.fxCnyPerUsdUpper*1_000_000)))
    blockers.push('cny_run_ceiling_unverified');
  if(balance&&Number.isFinite(input.runCapUsd)&&input.runCapUsd>balance.remainingBalanceUsd)
    blockers.push('prepaid_balance_insufficient');
  if(!budget||budget.actorId!==input.actorId||budget.status!=='approved'||
     !Number.isFinite(now)||Date.parse(budget.expiresAt)<=now||
     !Number.isFinite(input.runCapUsd)||!Number.isFinite(input.fxCnyPerUsdUpper)||
     Math.ceil(input.runCapUsd*input.fxCnyPerUsdUpper*1_000_000)>Math.round(budget.perRunLimitCny*1_000_000))
    blockers.push('cny_authorization_unverified');
  // No current receipt proves exclusive use of this token or atomic shared
  // reservations against its balance; a successful GET can race another run.
  blockers.push('prepaid_balance_exclusive_reservation_unverified');
  // AGI's account-level cap does not establish which charges (including
  // dataset reads/transfer) belong to this weekly operation.
  blockers.push('dataset_and_platform_cost_attribution_unverified');
  blockers.push('purchase_cny_total_and_fx_upper_unverified');
  return {schema:'weekly-agi-collection-readiness.v1',checkedAt:input.now,
    evidenceHash:hash({actorId:input.actorId,fingerprint,balanceHash:balance?.responseHash??null,
      actorHash:actor?.actorResponseHash??null,budgetHash:budget?.recordHash??null,
      runCapUsd:input.runCapUsd,fxCnyPerUsdUpper:input.fxCnyPerUsdUpper}),
    blockers,permitsPaidCollection:false};
}
