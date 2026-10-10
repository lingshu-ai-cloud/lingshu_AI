import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AuthLocals} from '../middleware/auth.js';
import type {createSocialSceneG4ReviewService} from './socialSceneG4ReviewService.js';
import type {SocialSceneG4ManualCheck} from '../../shared/contracts/socialSceneG4Review.js';
export function createSocialSceneG4ReviewRouter(service:ReturnType<typeof createSocialSceneG4ReviewService>){
 const router=Router({mergeParams:true});
 const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>2000)throw Error('scene_g4_input_invalid');return v;};
 const body=(v:unknown,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('scene_g4_input_invalid');return v as Record<string,unknown>;};
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1])=>{const a=res.locals as AuthLocals;if(!a.tenantId||!a.userId)throw Error('scene_g4_auth_required');return {authority:{tenantId:a.tenantId,taskId:text(req.params.taskId),runId:text(req.params.runId),artifactId:text(req.params.artifactId)},actor:a.userId};};
 const route=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
 router.get('/',route(async(req,res)=>{if(Object.keys(req.query).length)throw Error('scene_g4_input_invalid');const a=scope(req,res);res.json({items:await service.context(a.authority,a.actor)});}));
 router.get('/requests/:requestId',route(async(req,res)=>{if(Object.keys(req.query).length)throw Error('scene_g4_input_invalid');const a=scope(req,res);res.json(await service.get(a.authority,a.actor,text(req.params.requestId)));}));
 router.post('/assignment',route(async(req,res)=>{const b=body(req.body,['reviewerUserId']),a=scope(req,res);res.json({items:await service.assign(a.authority,a.actor,{reviewerUserId:text(b.reviewerUserId)})});}));
 router.post('/',route(async(req,res)=>{const b=body(req.body,['requestId','sceneId','expectedContextHash','checks']),a=scope(req,res);if(!Array.isArray(b.checks))throw Error('scene_g4_input_invalid');const checks=b.checks.map(v=>{const c=body(v,['code','outcome','observation']);return {code:text(c.code),outcome:text(c.outcome),observation:text(c.observation)};}) as SocialSceneG4ManualCheck[];res.status(201).json(await service.submit(a.authority,a.actor,{requestId:text(b.requestId),sceneId:text(b.sceneId),expectedContextHash:text(b.expectedContextHash),checks}));}));
 router.post('/requests/:requestId/resume',route(async(req,res)=>{body(req.body,[]);const a=scope(req,res);res.json(await service.resumeProjection(a.authority,a.actor,text(req.params.requestId)));}));
 const error:ErrorRequestHandler=(err,_req,res,_next)=>{const code=err instanceof Error&&/^scene_g4_[a-z_]+$/.test(err.message)?err.message:'scene_g4_storage_unavailable';res.status(code==='scene_g4_auth_required'?401:code==='scene_g4_input_invalid'?400:code.includes('forbidden')?403:409).json({error:code});};router.use(error);return router;
}
