import { customerTagCorrectionInput } from '../../shared/contracts/customerTags.js';
import {Router} from 'express';
import type {RequestHandler} from 'express';
import {z} from 'zod';
import {requireAuth,enforceSupportSessionReadOnly,type AuthLocals} from '../middleware/auth.js';
import {localPreviewRequestRejection} from '../auth/authIdentityHelpers.js';
import {createLocalCustomerSimulation} from '../customerService/localPreviewSimulation.js';
import {createCustomerReplyRequests} from '../customerService/replyRequests.js';
import {isBrowserReadToken} from '../digitalEmployees/browserReadSession.js';
export function localCustomerSimulationEnabled(){return process.env.NODE_ENV==='development'&&process.env.LINGSHU_LOCAL_PREVIEW==='1'&&process.env.CUSTOMER_SIMULATION_ENABLED==='1';}
const actionBody=z.strictObject({action:z.enum(['inbound','save-draft','translate','hold','release','prepare-template','approve','reject','send','send-history-failure','recover','receipt','read']),text:z.string().max(2000).optional(),eventId:z.string().max(100).optional(),version:z.number().int().positive().optional(),contentHash:z.string().regex(/^[a-f0-9]{64}$/).optional()});
export function createLocalCustomerSimulationRouter(service=createLocalCustomerSimulation(),authenticate:RequestHandler=requireAuth){
 const router=Router();
 router.use((req,res,next)=>{
  let origin=req.headers.origin;if(!origin&&req.method==='GET'){try{origin=new URL(req.headers.referer||'').origin;}catch{/* rejected below */}}
  if(!localCustomerSimulationEnabled()||localPreviewRequestRejection(origin,req.socket.remoteAddress)){res.status(404).json({error:'not_found'});return;}next();
 });
 router.use(authenticate,enforceSupportSessionReadOnly,(req,res,next)=>{if((res.locals as AuthLocals).dataAuthority!=='local'||isBrowserReadToken(req.headers.authorization)){res.status(403).json({error:'preview_local_identity_required'});return;}next();});
 const wrap=(f:RequestHandler):RequestHandler=>(req,res,next)=>{Promise.resolve(f(req,res,next)).catch(next);};
 router.get('/isolation',wrap(async(_req,res)=>{const status=Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationStatus'));if(typeof status!=='function'||!status().installed){res.status(503).json({error:'customer_isolation_guard_missing'});return;}res.json(status());}));
 router.post('/isolation/check',wrap(async(req,res)=>{const status=Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationStatus'));if(typeof status!=='function'||!status().installed){res.status(503).json({error:'customer_isolation_guard_missing'});return;}if(req.body&&Object.keys(req.body).length){res.status(400).json({error:'preview_input_invalid'});return;}const guard=await import('../../scripts/customer-isolated-test-guard.mjs');res.json(await guard.runCustomerIsolationSelfCheck());}));
 router.get('/drafts',wrap(async(_req,res)=>{const a=res.locals as AuthLocals;res.json({items:await service.drafts(a.tenantId,a.userId)});}));
 router.post('/drafts',wrap(async(req,res)=>{const parsed=z.strictObject({customerId:z.string().regex(/^mock-[a-zA-Z0-9_-]{1,150}$/),pendingDraft:z.string().max(2000).nullable()}).safeParse(req.body);if(!parsed.success){res.status(400).json({error:'preview_input_invalid'});return;}const a=res.locals as AuthLocals;await service.saveDraft(a.tenantId,a.userId,parsed.data.customerId,parsed.data.pendingDraft);res.json({ok:true});}));
 router.post('/tag-corrections',wrap(async(req,res)=>{
  const parsed=z.strictObject({customerId:z.string().regex(/^mock-[a-zA-Z0-9_-]{1,150}$/),tags:z.array(z.string().trim().min(1).max(100)).max(100),tagCorrection:customerTagCorrectionInput,evidence:z.array(z.strictObject({tag:z.string().max(100),messageId:z.string().max(200),excerpt:z.string().max(500)})).max(100)}).safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'preview_input_invalid'});return;}
  const a=res.locals as AuthLocals;res.json(await service.correctTag(a.tenantId,a.userId,parsed.data.customerId,parsed.data.tags,parsed.data.tagCorrection,parsed.data.evidence));
 }));
 router.post('/sessions',wrap(async(req,res)=>{const parsed=z.strictObject({customerId:z.string().regex(/^mock-[a-zA-Z0-9_-]{1,150}$/)}).safeParse(req.body);if(!parsed.success){res.status(400).json({error:'preview_input_invalid'});return;}const a=res.locals as AuthLocals;res.json(await service.start(a.tenantId,a.userId,parsed.data.customerId));}));
 router.use('/sessions/:sessionId',wrap(async(req,res,next)=>{const a=res.locals as AuthLocals;res.locals.previewSession=await service.session(a.tenantId,a.userId,req.params.sessionId);next();}));
 router.post('/sessions/:sessionId/actions',wrap(async(req,res)=>{const parsed=actionBody.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'preview_input_invalid'});return;}const a=res.locals as AuthLocals;res.json(await service.act(a.tenantId,a.userId,req.params.sessionId,parsed.data.action,parsed.data));}));
 const requests=createCustomerReplyRequests(service.store,async(body,identity,signal)=>{
  const s=await service.session(identity.tenantId,identity.userId,body.customerId);return service.generate(s,body.requestId!,signal);
 });
 router.post('/sessions/:sessionId/draft',wrap(async(req,res,next)=>{
  const a=res.locals as AuthLocals,s=await service.session(a.tenantId,a.userId,req.params.sessionId);
  const parsed=z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9_-]{8,120}$/)}).safeParse(req.body);if(!parsed.success||!s.customer){res.status(400).json({error:'preview_draft_input_invalid'});return;}
  req.body={customerId:s.id,requestId:parsed.data.requestId,timeline:s.customer.timeline,language:'英语',manualRequest:true};await requests.execute(req,res,next);
 }));
 router.get('/sessions/:sessionId/draft/:requestId',requests.read);
 router.use(((error:unknown,_req:unknown,res:import('express').Response,_next:unknown)=>{res.status(error instanceof Error&&'status' in error?Number(error.status):409).json({error:error instanceof Error?error.message:'preview_failed'});}) as import('express').ErrorRequestHandler);
 return router;
}
