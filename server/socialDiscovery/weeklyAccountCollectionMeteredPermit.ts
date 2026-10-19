import type {DataStore} from '../storage/datastore.js';
import type {PrepaidCollectionOperationAuthority,WeeklyAccountCollectionBudgetAuthorization} from './weeklyAccountCollectionBudget.js';
import {probeWeeklyApifyAccountLimits,probeWeeklyApifyPpe} from './weeklyAccountCollectionApifyPreflight.js';
import {evaluateWeeklyAccountCollectionAuthenticatedCostFeasibility,readWeeklyAccountCollectionFxObservation,type WeeklyAccountCollectionAuthenticatedCostFeasibility,type WeeklyAccountCollectionFxObservation} from './weeklyAccountCollectionCostPreflight.js';
import {assertWeeklyAccountCollectionMeteredAuthority} from './weeklyAccountCollectionMeteredAuthority.js';
import {persistWeeklyAccountCollectionProviderEvidence,type WeeklyAccountCollectionProviderEvidence} from './weeklyAccountCollectionProviderEvidence.js';
import type {WeeklyAccountCollectionPaidPermit} from './weeklyAccountCollectionOriginalTransport.js';

const fail=(code:string):never=>{throw Error(`weekly_account_collection_metered_permit_${code}`);};

export interface WeeklyAccountCollectionCurrentMeteredEvidence {
 providerEvidence:WeeklyAccountCollectionProviderEvidence;
 feasibility:WeeklyAccountCollectionAuthenticatedCostFeasibility;
 fx:WeeklyAccountCollectionFxObservation;
}

type Scope={
 store:DataStore;
 authorization:WeeklyAccountCollectionBudgetAuthorization;
 operation:PrepaidCollectionOperationAuthority;
 authorityId:string;
 token:string;
};

/**
 * Refreshes only authenticated/read-only provider facts. It never starts an
 * Actor, reserves a second budget, or turns an observation into permission.
 */
export async function refreshWeeklyAccountCollectionMeteredEvidence(input:Scope&{
 fetchProvider?:typeof fetch;
 fetchOfficial?:Parameters<typeof readWeeklyAccountCollectionFxObservation>[0]['fetchOfficial'];
 now?:()=>Date;
}):Promise<WeeklyAccountCollectionCurrentMeteredEvidence>{
 const now=input.now?.()??new Date();
 if(!input.token.trim())return fail('credential_missing');
 const [provider,limits,fx]=await Promise.all([
  probeWeeklyApifyPpe({actorId:input.authorization.actorId,token:input.token,fetcher:input.fetchProvider,now:()=>now.getTime()}),
  probeWeeklyApifyAccountLimits({token:input.token,fetcher:input.fetchProvider,now:()=>now.getTime()}),
  readWeeklyAccountCollectionFxObservation({authorization:input.authorization,fetchOfficial:input.fetchOfficial,now:()=>now}),
 ]);
 if(!fx)return fail('fx_unavailable');
 const providerEvidence=await persistWeeklyAccountCollectionProviderEvidence({store:input.store,authorization:input.authorization,operation:input.operation,token:input.token,provider,limits,now:now.getTime()});
 const feasibility=evaluateWeeklyAccountCollectionAuthenticatedCostFeasibility({authorization:input.authorization,providerEvidence,published:fx});
 if(!feasibility||!feasibility.fitsAuthorizedBudget)return fail('cost_no_longer_fits');
 return {providerEvidence,feasibility,fx};
}

/** Runtime adapter for the original POST/GET coordinator. The durable metered
 * authority remains the permission source; this object merely revalidates it
 * against fresh provider and FX evidence immediately before each request. */
export function createWeeklyAccountCollectionMeteredPermit(input:Scope&{
 refresh?:()=>Promise<WeeklyAccountCollectionCurrentMeteredEvidence>;
 fetchProvider?:typeof fetch;
 fetchOfficial?:Parameters<typeof readWeeklyAccountCollectionFxObservation>[0]['fetchOfficial'];
 now?:()=>Date;
}):WeeklyAccountCollectionPaidPermit{
 const refresh=input.refresh??(()=>refreshWeeklyAccountCollectionMeteredEvidence(input));
 return {permitsPaidCollection:true,assertCurrent:async request=>{
  const evidence=await refresh();
  await assertWeeklyAccountCollectionMeteredAuthority({
   store:input.store,authorization:input.authorization,operation:input.operation,authorityId:input.authorityId,token:input.token,
   providerEvidence:evidence.providerEvidence,feasibility:evidence.feasibility,fx:evidence.fx,now:(input.now?.()??new Date()).getTime(),request,
  });
 }};
}
