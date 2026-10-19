import {createPublicKey,verify} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {verifyFrozenWeeklyAccountCollectionOriginalOperation} from './weeklyAccountCollectionOperationAuthority.js';
import {frozenWeeklyAccountFiveVideoActorInput,type PrepaidCollectionOperationAuthority,type WeeklyAccountCollectionBudgetAuthorization} from './weeklyAccountCollectionBudget.js';

export const WEEKLY_ACCOUNT_COLLECTION_COST_CEILINGS='social_weekly_account_collection_cost_ceilings';
const fail=(code:string):never=>{throw Error(`weekly_account_collection_cost_ceiling_${code}`);};
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const money=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*1_000_000))&&Math.abs(Math.round(value*1_000_000)/1_000_000-value)<1e-9;
const categories=['actorEvents','actorPlatformUsage','proxy','datasetReads','datasetWrites','kvReads','kvWrites','storage','internalTransfer','externalTransfer','networkFee','paymentFee'] as const;
type Category=typeof categories[number];
type CostLine={maxUsd:number;evidenceHash:string};
export interface WeeklyAccountCostCeilingStatement{
 schema:'weekly-account-cost-ceiling.v1';issuerId:string;keyId:string;reviewerId:string;submittedBy:string;
 tenantId:string;programId:string;packageId:string;packageVersion:number;scopeId:string;scopeVersion:number;scopeHash:string;
 authorizationId:string;authorizationHash:string;jobId:string;jobRecordHash:string;originalRunKey:string;
 actorId:'clockworks/tiktok-scraper';actorInputHash:string;accountUrl:string;targetCount:5;
 tokenFingerprint:string;tokenExpiresAt:string;exclusiveToWeek:true;nonReloadable:true;noOverage:true;
 purchaseCurrency:'CNY';purchaseCostCny:number;purchaseEvidenceHash:string;
 chargeCurrency:'USD';fxCnyPerUsdUpper:number;fxEvidenceHash:string;
 chargeCoverage:'actor_platform_dataset_kv_transfer_network_all';chargeLines:Record<Category,CostLine>;
 pricingEvidenceHash:string;observedAt:string;expiresAt:string;
}
export interface SignedWeeklyAccountCostCeiling{statement:WeeklyAccountCostCeilingStatement;signatureBase64url:string}
export interface WeeklyAccountCostIssuer{tenantId:string;issuerId:string;keyId:string;reviewerId:string;publicKeyPem:string}
type Scope={store:DataStore;authorization:WeeklyAccountCollectionBudgetAuthorization;operation:PrepaidCollectionOperationAuthority;tokenFingerprint:string;authorities:readonly WeeklyAccountCostIssuer[];isRevoked:(issuerId:string,keyId:string,receiptId:string)=>Promise<boolean|null>;now?:number};
const id=(statement:WeeklyAccountCostCeilingStatement)=>socialRequestHash({schema:statement.schema,authorizationId:statement.authorizationId,jobId:statement.jobId}).slice(0,15);
function validStatement(s:WeeklyAccountCostCeilingStatement,a:WeeklyAccountCollectionBudgetAuthorization,o:PrepaidCollectionOperationAuthority,now:number){
 if(!s||s.schema!=='weekly-account-cost-ceiling.v1'||s.tenantId!==a.tenantId||s.programId!==a.programId||s.packageId!==a.packageId||s.packageVersion!==a.packageVersion||s.scopeId!==a.scopeId||s.scopeVersion!==a.scopeVersion||s.scopeHash!==a.scopeHash||s.authorizationId!==a.authorizationId||s.authorizationHash!==a.recordHash||s.jobId!==o.jobId||s.jobRecordHash!==o.jobRecordHash||s.originalRunKey!==o.runOperationId||s.actorId!==a.actorId||s.accountUrl!==a.accountUrl||s.targetCount!==5||s.actorInputHash!==socialRequestHash(frozenWeeklyAccountFiveVideoActorInput(a.accountUrl))||!s.issuerId||!s.keyId||!s.reviewerId||!s.submittedBy||s.reviewerId===s.submittedBy||!sha(s.tokenFingerprint)||!sha(s.purchaseEvidenceHash)||!sha(s.fxEvidenceHash)||!sha(s.pricingEvidenceHash)||s.exclusiveToWeek!==true||s.nonReloadable!==true||s.noOverage!==true||s.purchaseCurrency!=='CNY'||s.chargeCurrency!=='USD'||s.chargeCoverage!=='actor_platform_dataset_kv_transfer_network_all'||!money(s.purchaseCostCny)||s.purchaseCostCny<=0||!money(s.fxCnyPerUsdUpper)||s.fxCnyPerUsdUpper<=0||!Number.isFinite(Date.parse(s.observedAt))||Date.parse(s.observedAt)>now||now-Date.parse(s.observedAt)>86400000||!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=now||Date.parse(s.expiresAt)>Date.parse(a.expiresAt)||Date.parse(s.expiresAt)<=Date.parse(s.observedAt)||!Number.isFinite(Date.parse(s.tokenExpiresAt))||Date.parse(s.tokenExpiresAt)<=now||Date.parse(s.tokenExpiresAt)<Date.parse(s.expiresAt))return false;
 if(!s.chargeLines||Object.keys(s.chargeLines).sort().join(',')!==[...categories].sort().join(','))return false;
 let totalUsd=0;
 for(const category of categories){const line=s.chargeLines[category];if(!line||!money(line.maxUsd)||!sha(line.evidenceHash))return false;totalUsd+=line.maxUsd;}
 const totalCnyMicros=Math.ceil(totalUsd*s.fxCnyPerUsdUpper*1_000_000-1e-9);
 return Number.isSafeInteger(totalCnyMicros)&&totalCnyMicros>0&&totalCnyMicros<=Math.round(s.purchaseCostCny*1_000_000)&&Math.round(s.purchaseCostCny*1_000_000)<=Math.round(a.perRunLimitCny*1_000_000)&&Math.round(s.purchaseCostCny*1_000_000)<=Math.round(a.totalLimitCny*1_000_000);
}
async function verifyReceipt(input:Scope,signed:SignedWeeklyAccountCostCeiling){
 const now=input.now??Date.now(),s=signed?.statement;
 await verifyFrozenWeeklyAccountCollectionOriginalOperation({store:input.store,authorization:input.authorization,operation:input.operation,now});
 if(!validStatement(s,input.authorization,input.operation,now)||s.tokenFingerprint!==input.tokenFingerprint)fail('scope_or_coverage_invalid');
 const receiptId=id(s),roots=input.authorities.filter(root=>root.tenantId===s.tenantId&&root.issuerId===s.issuerId&&root.keyId===s.keyId&&root.reviewerId===s.reviewerId);
 if(roots.length!==1)fail('issuer_untrusted');
 try{const key=createPublicKey(roots[0]!.publicKeyPem),signature=Buffer.from(signed.signatureBase64url,'base64url');if(key.asymmetricKeyType!=='ed25519'||signature.length!==64||!verify(null,Buffer.from(socialRequestHash(s),'hex'),key,signature))fail('signature_invalid');}catch{fail('signature_invalid');}
 if(await input.isRevoked(s.issuerId,s.keyId,receiptId)!==false)fail('revocation_unverified');
 return receiptId;
}
/** An independently signed cost statement, not a spend permit. No network call or token is accepted here. */
export async function persistWeeklyAccountCostCeiling(input:Scope&{signed:SignedWeeklyAccountCostCeiling}){
 const receiptId=await verifyReceipt(input,input.signed),recordHash=socialRequestHash(input.signed);
 const prior=await input.store.getById<Record_>(WEEKLY_ACCOUNT_COLLECTION_COST_CEILINGS,receiptId);
 if(prior){if(prior.record_hash!==recordHash||socialRequestHash(prior.payload)!==recordHash)fail('receipt_changed');return {receiptId,recordHash,permitsPaidCollection:false as const};}
 if(!await input.store.create(WEEKLY_ACCOUNT_COLLECTION_COST_CEILINGS,{id:receiptId,tenant_id:input.authorization.tenantId,authorization_id:input.authorization.authorizationId,job_id:input.operation.jobId,record_hash:recordHash,payload:input.signed}))fail('write_unknown');
 return {receiptId,recordHash,permitsPaidCollection:false as const};
}
export async function readWeeklyAccountCostCeiling(input:Scope&{receiptId:string}){
 const row=await input.store.getById<Record_>(WEEKLY_ACCOUNT_COLLECTION_COST_CEILINGS,input.receiptId),signed=row?.payload as SignedWeeklyAccountCostCeiling|undefined;
 if(!row||!signed)return fail('receipt_changed');
 if(row.id!==input.receiptId||row.tenant_id!==input.authorization.tenantId||row.authorization_id!==input.authorization.authorizationId||row.job_id!==input.operation.jobId||row.record_hash!==socialRequestHash(signed))return fail('receipt_changed');
 if(await verifyReceipt(input,signed)!==input.receiptId)fail('receipt_changed');
 return {receiptId:input.receiptId,recordHash:row.record_hash,statement:signed.statement,permitsPaidCollection:false as const};
}
