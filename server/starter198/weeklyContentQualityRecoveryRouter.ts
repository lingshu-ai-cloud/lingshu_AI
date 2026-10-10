import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import {enforceSupportSessionReadOnly,type AuthLocals} from '../middleware/auth.js';
import type {createWeeklyContentQualityRecoveryService} from '../socialPrograms/weeklyContentQualityRecovery.js';
export function createWeeklyContentQualityRecoveryRouter(service:ReturnType<typeof createWeeklyContentQualityRecoveryService>){
 const router=Router({mergeParams:true});
 const text=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>2000)throw Error('weekly_quality_recovery_input_invalid');return value;};
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1])=>{const auth=res.locals as AuthLocals;if(!auth.tenantId||!auth.userId)throw Error('weekly_quality_recovery_auth_required');return {authority:{tenantId:auth.tenantId,taskId:text(req.params.taskId),runId:text(req.params.runId),artifactId:text(req.params.artifactId)},actor:auth.userId};};
 const route=(handler:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
 router.use(enforceSupportSessionReadOnly);
 router.get('/',route(async(req,res)=>{if(Object.keys(req.query).length)throw Error('weekly_quality_recovery_input_invalid');const a=scope(req,res);res.json({item:await service.context(a.authority,a.actor)});}));
 router.get('/requests/:requestId',route(async(req,res)=>{if(Object.keys(req.query).some(key=>key!=='executionTaskId'))throw Error('weekly_quality_recovery_input_invalid');const a=scope(req,res);res.json(await service.read(a.authority,a.actor,text(req.query.executionTaskId),text(req.params.requestId)));}));
 router.post('/resume',route(async(req,res)=>{const body=req.body;if(Object.keys(req.query).length||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['executionTaskId','requestId','expectedContextHash'].includes(key)))throw Error('weekly_quality_recovery_input_invalid');const a=scope(req,res);res.json(await service.resume(a.authority,a.actor,{executionTaskId:text(body.executionTaskId),requestId:text(body.requestId),expectedContextHash:text(body.expectedContextHash)}));}));
 const error:ErrorRequestHandler=(err,_req,res,_next)=>{const candidate=err?.code??(err instanceof Error?err.message:'');const code=typeof candidate==='string'&&/^weekly_quality_recovery_[a-z_]+$/.test(candidate)?candidate:'weekly_quality_recovery_storage_unavailable';res.status(code.endsWith('auth_required')?401:code.endsWith('input_invalid')?400:code.includes('forbidden')?403:409).json({error:code});};
 router.use(error);return router;
}
