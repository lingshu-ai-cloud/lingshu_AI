import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { customerReplyRequestSchema, type CustomerReplyRequest } from '../../shared/contracts/customerReply.js';
import { customerReplyEnvelope } from './replyEnvelope.js';
const collection = 'customer_reply_requests';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export interface ReplyGeneratorResult { status: number; body: Record<string, unknown>; factVersion: string|null }
export function createCustomerReplyRequests(store: DataStore, generate: (body: CustomerReplyRequest, identity: {tenantId:string;userId:string}, signal:AbortSignal)=>Promise<ReplyGeneratorResult>, timeoutMs=120_000) {
  const rowId=(tenant:string,actor:string,id:string)=>createHash('sha256').update(JSON.stringify([tenant,actor,id])).digest('hex').slice(0,15);
  const read: RequestHandler = async(req,res) => {
    const {tenantId,userId}=res.locals;const id=String(req.params.requestId);
    if(!/^[a-zA-Z0-9_-]{8,120}$/.test(id)){res.status(400).json({error:'customer_reply_request_id_invalid'});return;}
    try{const row=await store.getById<Record_>(collection,rowId(tenantId,userId,id));if(!row||row.tenant_id!==tenantId||row.actor_user_id!==userId){res.status(404).json({error:'customer_reply_request_not_found'});return;}
      const payload=object(row.payload);
      const stale=row.status==='pending'&&Date.now()-Date.parse(String(payload.startedAt||''))>timeoutMs;
      const fallback={schemaVersion:1,requestId:id,status:row.status==='failed'?'failed':stale?'blocked':'pending',code:row.status==='failed'?'customer_reply_generation_failed':stale?'customer_reply_generation_outcome_unknown':'customer_reply_outcome_unconfirmed',retryable:false,draft:''};
      res.status(row.status==='pending'?stale?409:202:payload.result?Number(payload.httpStatus||200):503).json(payload.result??fallback);
    }catch{res.status(503).json({error:'customer_reply_storage_unavailable'});}
  };
  const execute: RequestHandler = async(req,res) => {
    const parsed=customerReplyRequestSchema.safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:'customer_reply_input_invalid',issues:parsed.error.issues});return;}
    const {tenantId,userId}=res.locals;const body=parsed.data,requestId=body.requestId??randomUUID();
    const inputHash=socialRequestHash({...body,requestId:undefined});
    const id=rowId(tenantId,userId,requestId);
    try {
      const prior=await store.getById<Record_>(collection,id);
      if(prior){if(prior.tenant_id!==tenantId||prior.actor_user_id!==userId||prior.input_hash!==inputHash){res.status(409).json({error:'customer_reply_request_conflict'});return;}req.params.requestId=requestId;await read(req,res,()=>{});return;}
      const created=await store.create(collection,{id,tenant_id:tenantId,actor_user_id:userId,request_id:requestId,input_hash:inputHash,status:'pending',payload:{startedAt:new Date().toISOString()}});
      if(!created){res.status(503).json({error:'customer_reply_claim_unconfirmed',requestId,retryable:false});return;}
    } catch {res.status(503).json({error:'customer_reply_storage_unavailable',requestId,retryable:false});return;}
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const work=(async()=>{
      let result:ReplyGeneratorResult;
      try{result=await generate(body,{tenantId,userId},controller.signal);}catch(error){result={status:503,factVersion:null,body:{error:'customer_reply_generation_failed',message:error instanceof Error?error.message:'generation_failed',retryable:false}};}
      const response=result.status>=400?{...result.body,schemaVersion:1,requestId,status:'failed',retryable:false}:customerReplyEnvelope(result.body,requestId,result.factVersion);
      if(!await store.update(collection,id,{status:result.status>=400?'failed':'settled',payload:{httpStatus:result.status,result:response}}))throw Error('customer_reply_result_save_failed');
      return {status:result.status,body:response};
    })();
    try{
      const result=await Promise.race([work,new Promise<null>(resolve=>{timer=setTimeout(()=>{controller.abort(Error('customer_reply_deadline'));resolve(null);},timeoutMs);})]);
      if(result)res.status(result.status).json(result.body);else res.status(202).json({schemaVersion:1,requestId,status:'pending',code:'customer_reply_outcome_unconfirmed',retryable:false,draft:''});
    }catch{res.status(503).json({error:'customer_reply_result_save_failed',requestId,retryable:false});}
    finally{if(timer)clearTimeout(timer);void work.catch(()=>{});}
  };
  return {read,execute};
}
