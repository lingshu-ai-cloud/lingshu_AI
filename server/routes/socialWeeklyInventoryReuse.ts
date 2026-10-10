import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AuthLocals} from '../middleware/auth.js';
import type {WeeklyInventoryAuthority} from '../socialPrograms/weeklyInventoryReuse.js';
import type {ConfirmWeeklyInventoryReuse} from '../../shared/contracts/weeklyInventoryReuse.js';
import {SocialProgramError} from '../socialPrograms/service.js';
export interface WeeklyInventoryReusePort{candidates(a:WeeklyInventoryAuthority):Promise<unknown>;records(a:WeeklyInventoryAuthority):Promise<unknown>;get(a:WeeklyInventoryAuthority,id:string):Promise<unknown>;confirm(a:WeeklyInventoryAuthority,input:ConfirmWeeklyInventoryReuse):Promise<unknown>}
const fail=():never=>{throw new SocialProgramError('inventory_http_input_invalid',400,'请提供真实库存引用和明确的版权、时效确认。');};
const text=(v:unknown):string=>typeof v==='string'&&v.trim()&&v.length<=2000&&!/[\u0000-\u001f\u007f]/.test(v)?v.trim():fail();
const version=(v:unknown):number=>{const n=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;return typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:fail();};
const object=(v:unknown,keys:string[]):Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))?v as Record<string,unknown>:fail();
const hash=(v:unknown)=>{const h=text(v);if(!/^[a-f0-9]{64}$/.test(h))return fail();return h;};
const route=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
export function createSocialWeeklyInventoryReuseRouter(service:WeeklyInventoryReusePort){const router=Router({mergeParams:true});
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],v:unknown):WeeklyInventoryAuthority=>{const auth=res.locals as AuthLocals;if(!auth.tenantId||!auth.userId)throw new SocialProgramError('inventory_auth_required',401,'请先登录。');return{tenantId:auth.tenantId,actorUserId:auth.userId,programId:text(req.params.programId),packageId:text(req.params.packageId),packageVersion:version(v)};};
 router.get('/',route(async(req,res)=>res.json({item:await service.candidates(scope(req,res,req.query.version))})));
 router.get('/records',route(async(req,res)=>res.json({items:await service.records(scope(req,res,req.query.version))})));
 router.get('/:id',route(async(req,res)=>res.json({item:await service.get(scope(req,res,req.query.version),text(req.params.id))})));
 router.post('/',route(async(req,res)=>{const b=object(req.body,['packageVersion','artifactRef','expectedSourceHash','publicationTaskId','expectedTargetPublicationHash','reason','rightsStatement','timelinessStatement']);const a=scope(req,res,b.packageVersion),r=object(b.artifactRef,['type','id','version']);if(r.type!=='starter_social_content_artifact')return fail();res.status(201).json({item:await service.confirm(a,{artifactRef:{type:'starter_social_content_artifact',id:text(r.id),version:version(r.version)},expectedSourceHash:hash(b.expectedSourceHash),publicationTaskId:text(b.publicationTaskId),expectedTargetPublicationHash:hash(b.expectedTargetPublicationHash),reason:text(b.reason),rightsStatement:text(b.rightsStatement),timelinessStatement:text(b.timelinessStatement)})});}));
 const errors:ErrorRequestHandler=(e,_req,res,next)=>{if(e instanceof SocialProgramError){res.status(e.status).json({error:e.message,code:e.code});return;}next(e);};router.use(errors);return router;
}
