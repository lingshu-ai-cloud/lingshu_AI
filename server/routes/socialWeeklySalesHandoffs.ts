import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { DataStore } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { createWeeklySalesHandoffService } from '../runtime/socialWeeklySalesHandoff.js';
const invalid=():never=>{throw new SocialProgramError('sales_handoff_body_invalid',400,'请提供明确周包版本与销售交接信息。');};
function obj(v:unknown,keys:string[]):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))return invalid();if(Object.keys(v).some(k=>!keys.includes(k)))return invalid();return v as Record<string,any>;}
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():invalid();
const version=(v:unknown)=>{const n=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;return typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:invalid();};
const route=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
/** Mount beneath authenticated /:programId/operating-packages/:packageId/sales-handoffs. */
export function createSocialWeeklySalesHandoffsRouter(store:DataStore){
 const router=Router({mergeParams:true}),service=createWeeklySalesHandoffService(store);
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],v:unknown)=>{const a=res.locals as AuthLocals;if(!a.tenantId||!a.userId)throw new SocialProgramError('sales_handoff_auth_required',401,'请先登录。');return {authority:{tenantId:a.tenantId,programId:text(req.params.programId),packageId:text(req.params.packageId),packageVersion:version(v)},actor:a.userId};};
 router.get('/',route(async(req,res)=>{const a=scope(req,res,req.query.version);res.json({items:await service.list(a.authority,a.actor)});}));
 router.get('/sources',route(async(req,res)=>{const a=scope(req,res,req.query.version);res.json(await service.sources(a.authority,a.actor));}));
 router.get('/:handoffId',route(async(req,res)=>{const a=scope(req,res,req.query.version);res.json({item:await service.get(a.authority,text(req.params.handoffId),a.actor)});}));
 router.post('/',route(async(req,res)=>{const b=obj(req.body,['packageVersion','runId','memberId','sourceInteractionId','ownerUserId','claimDueAt','feedbackDueAt']);const a=scope(req,res,b.packageVersion);res.status(201).json({item:await service.create(a.authority,a.actor,{runId:text(b.runId),memberId:text(b.memberId),sourceInteractionId:text(b.sourceInteractionId),ownerUserId:text(b.ownerUserId),claimDueAt:text(b.claimDueAt),feedbackDueAt:text(b.feedbackDueAt)})});}));
 router.post('/:handoffId/events',route(async(req,res)=>{const b=obj(req.body,['packageVersion','expectedVersion','operationId','action','feedback']);if(!['claim','request_feedback','feedback'].includes(b.action))return invalid();let feedback;if(b.feedback!==undefined){const f=obj(b.feedback,['result','evidenceInteractionIds','nextStep','nextDueAt','needsInformation']);if(!Array.isArray(f.evidenceInteractionIds)||f.needsInformation!==undefined&&typeof f.needsInformation!=='boolean')return invalid();feedback={result:text(f.result),evidenceInteractionIds:f.evidenceInteractionIds.map(text),nextStep:text(f.nextStep),nextDueAt:text(f.nextDueAt),needsInformation:f.needsInformation};}const a=scope(req,res,b.packageVersion);res.json({item:await service.transition(a.authority,text(req.params.handoffId),a.actor,{expectedVersion:version(b.expectedVersion),operationId:text(b.operationId),action:b.action,feedback})});}));
 const errors:ErrorRequestHandler=(error,_req,res,next)=>{if(error instanceof SocialProgramError){res.status(error.status).json({error:error.message,code:error.code});return;}next(error);};router.use(errors);return router;
}
