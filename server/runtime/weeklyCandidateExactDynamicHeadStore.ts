import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyCandidateDynamicExactHeadAnchorV2,WeeklyCandidateDynamicExactHeadV2} from './weeklyCandidateExactPaidRequests.js';

export const WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS='weekly_candidate_exact_dynamic_heads';
const hash=/^[a-f0-9]{64}$/;
const identity=/^[A-Za-z0-9._:-]{1,256}$/;
const fail=(code:string):never=>{throw Error(`weekly_candidate_exact_dynamic_head_${code}`);};
const equal=(left:WeeklyCandidateDynamicExactHeadV2,right:WeeklyCandidateDynamicExactHeadV2)=>JSON.stringify(left)===JSON.stringify(right);
const rowId=(tenantId:string,head:WeeklyCandidateDynamicExactHeadV2)=>createHash('sha256').update(JSON.stringify([
 tenantId,head.operationId,head.authorizationHash,head.planHash,
])).digest('hex').slice(0,15);

function validHead(head:WeeklyCandidateDynamicExactHeadV2){
 return head?.schema==='weekly-candidate-dynamic-exact-head.v2'&&identity.test(head.operationId)&&hash.test(head.authorizationHash)&&
  hash.test(head.planHash)&&Number.isSafeInteger(head.generation)&&head.generation>=0&&hash.test(head.ledgerHash);
}
function decode(row:Record_,tenantId:string,initial:WeeklyCandidateDynamicExactHeadV2){
 if(row.id!==rowId(tenantId,initial)||row.tenant_id!==tenantId||row.operation_id!==initial.operationId||
  row.authorization_hash!==initial.authorizationHash||row.plan_hash!==initial.planHash||
  row.head_schema!=='weekly-candidate-dynamic-exact-head.v2'||!Number.isSafeInteger(row.generation)||Number(row.generation)<0||
  !hash.test(String(row.ledger_hash??'')))fail('record_changed');
 return {schema:'weekly-candidate-dynamic-exact-head.v2',operationId:String(row.operation_id),authorizationHash:String(row.authorization_hash),
  planHash:String(row.plan_hash),generation:Number(row.generation),ledgerHash:String(row.ledger_hash)} satisfies WeeklyCandidateDynamicExactHeadV2;
}

/** Server-only durable monotonic anchor for the separately fsynced v2 ledger. */
export async function prepareWeeklyCandidateExactDynamicHeadAnchor(input:{
 store:DataStore;tenantId:string;initialHead:WeeklyCandidateDynamicExactHeadV2;now?:()=>number;
}):Promise<WeeklyCandidateDynamicExactHeadAnchorV2>{
 if(!identity.test(input.tenantId)||!validHead(input.initialHead)||input.initialHead.generation!==0||
  !input.store.compareAndSwap||await input.store.supportsAtomicCompareAndSwap?.()!==true)fail('atomic_store_required');
 const {store,tenantId,initialHead}=input,id=rowId(input.tenantId,input.initialHead),stamp=()=>new Date((input.now??Date.now)()).toISOString();
 const accepted=(row:Record_)=>{const value=decode(row,tenantId,initialHead);if(value.generation===0&&!equal(value,initialHead))fail('genesis_changed');return value;};
 let row=await store.getById<Record_>(WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS,id);
 if(!row){
  try{await store.create(WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS,{id,tenant_id:tenantId,operation_id:initialHead.operationId,
   authorization_hash:initialHead.authorizationHash,plan_hash:initialHead.planHash,head_schema:initialHead.schema,
   generation:0,ledger_hash:initialHead.ledgerHash,created_at:stamp(),updated_at:stamp()});}catch{/* write outcome is resolved by authoritative readback */}
  row=await store.getById<Record_>(WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS,id);
  if(!row)fail('genesis_write_unknown');
  if(!equal(decode(row!,tenantId,initialHead),initialHead))fail('genesis_changed');
 }
 let acknowledged=accepted(row!);
 let acknowledgedTransition:{expected:WeeklyCandidateDynamicExactHeadV2;next:WeeklyCandidateDynamicExactHeadV2}|null=null;
 const readCurrent=async()=>{
  const currentRow=await store.getById<Record_>(WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS,id);if(!currentRow)fail('record_missing');
  const current=decode(currentRow!,tenantId,initialHead);
  if(current.generation<acknowledged.generation||current.generation===acknowledged.generation&&current.ledgerHash!==acknowledged.ledgerHash)
   fail('rollback_detected');
  acknowledged=current;return structuredClone(current);
 };
 return{
  read:readCurrent,
  compareAndSwap:async(expected,next)=>{
   if(!validHead(expected)||!validHead(next)||expected.operationId!==initialHead.operationId||expected.authorizationHash!==initialHead.authorizationHash||
    expected.planHash!==initialHead.planHash||next.operationId!==expected.operationId||next.authorizationHash!==expected.authorizationHash||
    next.planHash!==expected.planHash||next.generation!==expected.generation+1)fail('transition_invalid');
   if(equal(acknowledged,next)){
    if(acknowledgedTransition&&equal(acknowledgedTransition.expected,expected)&&equal(acknowledgedTransition.next,next))return true;
    return fail('expected_not_current');
   }
   if(!equal(acknowledged,expected))fail('expected_not_current');
   let swapped=false;try{swapped=await store.compareAndSwap!(WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS,id,
    {tenant_id:tenantId,operation_id:expected.operationId,authorization_hash:expected.authorizationHash,plan_hash:expected.planHash,
     head_schema:expected.schema,generation:expected.generation,ledger_hash:expected.ledgerHash},
    {generation:next.generation,ledger_hash:next.ledgerHash,updated_at:stamp()});}catch{/* resolve unknown below */}
   const current=await readCurrent();
   if(equal(current,next)){acknowledgedTransition={expected:structuredClone(expected),next:structuredClone(next)};return true;}
   if(equal(current,expected)&&!swapped)return false;
   return fail('commit_conflict');
  },
 };
}
