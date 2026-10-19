import type {DataStore,Record_} from '../storage/datastore.js';
import {readWeeklyAccountCollectionPaidBlocker} from '../socialDiscovery/weeklyAccountCollectionPaidGate.js';
import {readCurrentWeeklyAccountCollectionBudget} from '../socialDiscovery/weeklyAccountCollectionBudget.js';
import {readWeeklyAccountCollectionPublishedCostPreflight} from '../socialDiscovery/weeklyAccountCollectionCostPreflight.js';
import {weeklyCollectionCredentialIntervention} from '../runtime/weeklyCollectionCredentialIntervention.js';
import {probeWeeklyApifyAccountLimits,probeWeeklyApifyPpe,type WeeklyApifyAccountLimitObservation,type WeeklyApifyPpePreflight} from '../socialDiscovery/weeklyAccountCollectionApifyPreflight.js';
import {socialJson,socialObject,socialRequestHash} from '../starter198/socialContentValidation.js';

export type WeeklyCollectionBudgetCardScope={tenantId:string;programId:string;packageId:string;packageVersion:number};
export type WeeklyCollectionBudgetContext=WeeklyCollectionBudgetCardScope&{scopeId:string;scopeVersion:number;scopeHash:string;accountUrl:string;actorId:string;contextHash:string};
const fail=(code:string):never=>{throw Error(`weekly_collection_budget_${code}`);};

/** Resolve the exact persisted discovery job and approved five-item account
 * revision. The UI never supplies scope IDs, hashes, account URLs or Actor IDs. */
export async function readWeeklyCollectionBudgetContext(store:DataStore,input:WeeklyCollectionBudgetCardScope):Promise<WeeklyCollectionBudgetContext>{
 const rows=await store.list<Record_>('social_weekly_preproduction_jobs',{where:{tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId,package_version:input.packageVersion},perPage:100});
 if(rows.totalItems!==rows.items.length)return fail('context_unverified');
 const discovery=rows.items.map(row=>({row,job:socialObject(socialJson(row.payload))})).filter((item):item is {row:Record_;job:Record<string,unknown>}=>item.job?.kind==='discovery');
 if(!discovery.length)return fail('context_unverified');
 const identities=discovery.map(({row,job})=>{const authority=socialObject(job.authority),modes=authority?.requestedModes;
  if(!row.id||job.tenantId!==input.tenantId||job.programId!==input.programId||job.packageId!==input.packageId||job.packageVersion!==input.packageVersion||job.recordHash!==row.record_hash||job.recordHash!==socialRequestHash({...job,recordHash:''})||!authority?.scopeId||!Number.isSafeInteger(authority.scopeVersion)||!authority.scopeHash||!Array.isArray(modes)||!modes.includes('account')||new Set(modes).size!==modes.length)return null;
  return [String(authority.scopeId),Number(authority.scopeVersion),String(authority.scopeHash)] as const;});
 if(identities.includes(null)||new Set(identities.map(value=>JSON.stringify(value))).size!==1)return fail('context_unverified');
 const [scopeId,scopeVersion,scopeHash]=identities[0]!;
 const scope=await store.getById<Record_>('social_discovery_scopes',scopeId),payload=socialObject(socialJson(scope?.payload)),approval=socialObject(payload?.approval),revision=socialObject(payload?.weeklyAccountRevision);
 if(!payload||!approval||!revision||scope?.tenant_id!==input.tenantId||scope.version!==scopeVersion||scope.status!=='active'||socialRequestHash(payload)!==scopeHash||approval.status!=='approved'||approval.scopeVersion!==scopeVersion||revision.targetCount!==5||typeof revision.accountUrl!=='string')return fail('context_unverified');
 const actorId=process.env.APIFY_TIKTOK_ACTOR?.trim()||'clockworks/tiktok-scraper';
 const identity={...input,scopeId,scopeVersion,scopeHash,accountUrl:revision.accountUrl,actorId};
 return {...identity,contextHash:socialRequestHash({...identity,jobs:discovery.map(({row,job})=>[row.id,job.recordHash]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))})};
}

export async function readWeeklyCollectionBudgetCard(store:DataStore,input:WeeklyCollectionBudgetCardScope){
 const context=await readWeeklyCollectionBudgetContext(store,input),paidBlocker=await readWeeklyAccountCollectionPaidBlocker({store,...context});
 let authorization:null|{authorizationId:string;totalLimitCny:number;perRunLimitCny:number;expiresAt:string}=null;
 if(paidBlocker==='weekly_preproduction_collection_cost_ceiling_unverified'){
  const current=await readCurrentWeeklyAccountCollectionBudget(store,context);authorization={authorizationId:current.authorizationId,totalLimitCny:current.totalLimitCny,perRunLimitCny:current.perRunLimitCny,expiresAt:current.expiresAt};
 }
 return {context,card:{accountUrl:context.accountUrl,targetCount:5 as const,contextHash:context.contextHash,authorization,paidBlocker,permitsPaidCollection:false as const}};
}

export type WeeklyCollectionAuthenticatedProviderEvidence={
 basis:'authenticated_provider_read_only_not_a_permit';actorId:string;pricingModel:'PAY_PER_EVENT';accountTier:string;
 eventNames:string[];eventPriceCount:number;minimalMaxTotalChargeUsd:number|null;actorPermissionLevel:WeeklyApifyPpePreflight['actorPermissionLevel'];
 agiPrepaidCompatibleByPermission:boolean;observedAt:string;actorResponseHash:string;accountResponseHash:string;pricingRecordHash:string;
 billingCycleStartAt:string;billingCycleEndAt:string;monthlyLimitUsd:number;monthlyUsageUsd:number;observedHeadroomUsd:number;dataRetentionDays:number;externalTransferLimitGbytes:number;externalTransferUsageGbytes:number;externalTransferHeadroomGbytes:number;
 limitsObservedAt:string;limitsResponseHash:string;permitsPaidCollection:false;
};
type ProviderPorts={env?:NodeJS.ProcessEnv;costPreflightReader?:typeof readWeeklyAccountCollectionPublishedCostPreflight;probePpe?:typeof probeWeeklyApifyPpe;probeLimits?:typeof probeWeeklyApifyAccountLimits};
function projectProviderEvidence(ppe:WeeklyApifyPpePreflight,limits:WeeklyApifyAccountLimitObservation):WeeklyCollectionAuthenticatedProviderEvidence{
 return {basis:'authenticated_provider_read_only_not_a_permit',actorId:ppe.actorId,pricingModel:ppe.pricingModel,accountTier:ppe.accountTier,
  eventNames:Object.keys(ppe.eventPricesUsd).sort(),eventPriceCount:Object.keys(ppe.eventPricesUsd).length,minimalMaxTotalChargeUsd:ppe.minimalMaxTotalChargeUsd,
  actorPermissionLevel:ppe.actorPermissionLevel,agiPrepaidCompatibleByPermission:ppe.agiPrepaidCompatibleByPermission,observedAt:ppe.observedAt,
  actorResponseHash:ppe.actorResponseHash,accountResponseHash:ppe.accountResponseHash,pricingRecordHash:ppe.pricingRecordHash,
  billingCycleStartAt:limits.cycleStartAt,billingCycleEndAt:limits.cycleEndAt,monthlyLimitUsd:limits.maxMonthlyUsageUsd,
  monthlyUsageUsd:limits.currentMonthlyUsageUsd,observedHeadroomUsd:limits.observedHeadroomUsd,dataRetentionDays:limits.dataRetentionDays,externalTransferLimitGbytes:limits.maxMonthlyExternalDataTransferGbytes,externalTransferUsageGbytes:limits.currentMonthlyExternalDataTransferGbytes,externalTransferHeadroomGbytes:limits.observedExternalDataTransferHeadroomGbytes,limitsObservedAt:limits.observedAt,
  limitsResponseHash:limits.responseHash,permitsPaidCollection:false};
}
export async function readWeeklyCollectionRuntimeCard(store:DataStore,input:WeeklyCollectionBudgetCardScope,ports:ProviderPorts={}){
 const {context,card}=await readWeeklyCollectionBudgetCard(store,input);let scenario=null;
 if(card.paidBlocker==='weekly_preproduction_collection_cost_ceiling_unverified'){
  try{scenario=await (ports.costPreflightReader??readWeeklyAccountCollectionPublishedCostPreflight)({authorization:await readCurrentWeeklyAccountCollectionBudget(store,context)});}catch{/* Diagnostics never alter the durable blocker. */}
 }
 const env=ports.env??process.env,token=env.APIFY_TOKEN?.trim();let authenticatedProviderEvidence:WeeklyCollectionAuthenticatedProviderEvidence|null=null;
 if(card.paidBlocker==='weekly_preproduction_collection_cost_ceiling_unverified'&&token){
  try{const [ppe,limits]=await Promise.all([(ports.probePpe??probeWeeklyApifyPpe)({actorId:context.actorId,token}),(ports.probeLimits??probeWeeklyApifyAccountLimits)({token})]);authenticatedProviderEvidence=projectProviderEvidence(ppe,limits);}catch{/* Provider diagnostics never grant spending or replace the durable blocker. */}
 }
 return {...weeklyCollectionCredentialIntervention(env,card.paidBlocker,scenario),authenticatedProviderEvidence};
}
