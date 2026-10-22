import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
/** Uses the same request ledger as interactive replies; an unconfirmed claim is never submitted twice. */
export async function durableFollowupDraft(store:DataStore,input:{tenantId:string;actorId:string;identity:unknown},generate:()=>Promise<string>):Promise<string>{
  const inputHash=createHash('sha256').update(JSON.stringify(input.identity)).digest('hex');
  const requestId=`followup-${inputHash}`,id=createHash('sha256').update(JSON.stringify([input.tenantId,input.actorId,requestId])).digest('hex').slice(0,15);
  const old=await store.getById<Record_>('customer_reply_requests',id);
  if(old){
    if(old.tenant_id!==input.tenantId||old.actor_user_id!==input.actorId||old.input_hash!==inputHash)throw Error('followup_draft_request_conflict');
    const payload=old.payload as {result?:{draft?:string};error?:string};
    if(old.status==='settled'&&payload?.result?.draft)return payload.result.draft;
    throw Error(`${old.status==='failed'?'followup_draft_generation_failed':'followup_draft_outcome_unconfirmed'}:${requestId}`);
  }
  if(!await store.create('customer_reply_requests',{id,tenant_id:input.tenantId,actor_user_id:input.actorId,request_id:requestId,input_hash:inputHash,status:'pending',payload:{kind:'followup',startedAt:new Date().toISOString()}}))throw Error(`followup_draft_claim_unconfirmed:${requestId}`);
  let body:string;
  try{body=await generate();}catch(error){
    // A model timeout can already have incurred a provider call. Preserve the original request; no automatic second call.
    await store.update('customer_reply_requests',id,{status:'failed',payload:{kind:'followup',error:error instanceof Error?error.message:'generation_failed'}});
    throw error;
  }
  if(!await store.update('customer_reply_requests',id,{status:'settled',payload:{kind:'followup',httpStatus:200,result:{schemaVersion:1,requestId,status:'succeeded',draft:body}}}))throw Error(`followup_draft_result_save_unconfirmed:${requestId}`);
  return body;
}
