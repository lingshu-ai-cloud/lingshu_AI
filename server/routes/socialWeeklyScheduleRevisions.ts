import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {DataStore} from '../storage/datastore.js';
import type {AuthLocals} from '../middleware/auth.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {createWeeklyScheduleRevisionService} from '../socialPrograms/socialWeeklyScheduleRevisions.js';
function invalid():never{throw new SocialProgramError('weekly_schedule_body_invalid',400,'请明确冻结提案版本及确认输入证据。');}
const body=(v:unknown,allowed:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))return invalid();return v as Record<string,any>;};
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():invalid();
const version=(v:unknown)=>{const n=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;return typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:invalid();};
const run=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
export function createSocialWeeklyScheduleRevisionsRouter(store:DataStore){const router=Router({mergeParams:true}),service=createWeeklyScheduleRevisionService(store);const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],v:unknown)=>{const a=res.locals as AuthLocals;if(!a.tenantId||!a.userId)throw new SocialProgramError('weekly_schedule_auth_required',401,'请先登录。');return {tenantId:a.tenantId,actorUserId:a.userId,programId:text(req.params.programId),packageId:text(req.params.packageId),packageVersion:version(v)};};
 router.post('/',run(async(req,res)=>{const b=body(req.body,['packageVersion','constraints','resources','remainingBudgetCny','operationalDeadlines']);res.status(201).json({item:await service.propose(scope(req,res,b.packageVersion),{constraints:b.constraints,resources:b.resources,remainingBudgetCny:b.remainingBudgetCny,...(b.operationalDeadlines!==undefined?{operationalDeadlines:b.operationalDeadlines}:{})})});}));
 router.get('/:proposalId',run(async(req,res)=>{res.json({item:await service.read(scope(req,res,req.query.version),text(req.params.proposalId))});}));
 router.post('/:proposalId/confirm',run(async(req,res)=>{const b=body(req.body,['expectedVersion','inputEvidenceHash']);res.json(await service.confirm(scope(req,res,b.expectedVersion),{proposalId:text(req.params.proposalId),expectedVersion:version(b.expectedVersion),inputEvidenceHash:text(b.inputEvidenceHash)}));}));
 const errors:ErrorRequestHandler=(error,_req,res,next)=>{if(error instanceof SocialProgramError){res.status(error.status).json({error:error.message,code:error.code});return;}next(error);};router.use(errors);return router;}
