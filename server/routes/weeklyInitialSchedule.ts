import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {DataStore} from '../storage/datastore.js';
import type {AuthLocals} from '../middleware/auth.js';
import type {WeeklyScheduleCapacityInput} from '../../shared/contracts/socialWeeklyScheduleRevision.js';
import {createWeeklyInitialScheduleService} from '../socialPrograms/weeklyInitialSchedule.js';
import {SocialProgramError} from '../socialPrograms/service.js';
const invalid=():never=>{throw new SocialProgramError('weekly_initial_schedule_input_invalid',400,'请明确当前版本、任务工时、资源和工作时间。');};
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():invalid();
const version=(v:unknown)=>{const n=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;return typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:invalid();};
const object=(v:unknown,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))return invalid();return v as Record<string,unknown>;};
const carryovers=(v:unknown):string[]=>Array.isArray(v)&&v.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))&&new Set(v).size===v.length?v:invalid();
const run=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
export function createWeeklyInitialScheduleRouter(store:DataStore){
 const router=Router({mergeParams:true}),service=createWeeklyInitialScheduleService(store);
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],v:unknown)=>{const auth=res.locals as AuthLocals;if(!auth.tenantId||!auth.userId)throw new SocialProgramError('weekly_initial_schedule_auth_required',401,'请先登录。');return {tenantId:auth.tenantId,actorUserId:auth.userId,programId:text(req.params.programId),packageId:text(req.params.packageId),packageVersion:version(v)};};
 router.get('/',run(async(req,res)=>res.json({item:await service.preview(scope(req,res,req.query.version))})));
 router.get('/proposals/:proposalId',run(async(req,res)=>res.json({item:await service.read(scope(req,res,req.query.version),text(req.params.proposalId))})));
 router.post('/proposals',run(async(req,res)=>{const b=object(req.body,['packageVersion','capacity']);const c=object(b.capacity,['constraints','resources','remainingBudgetCny','operationalDeadlines']);if(!c.constraints||typeof c.constraints!=='object'||Array.isArray(c.constraints)||!c.resources||typeof c.resources!=='object'||Array.isArray(c.resources)||typeof c.remainingBudgetCny!=='number'||!Number.isFinite(c.remainingBudgetCny)||c.remainingBudgetCny<0)invalid();res.status(201).json({item:await service.propose(scope(req,res,b.packageVersion),c as unknown as WeeklyScheduleCapacityInput)});}));
 router.post('/confirm',run(async(req,res)=>{const b=object(req.body,['packageVersion','proposalId','expectedVersion','inputEvidenceHash','confirmedTemplateCarryoverPlanHashes']);const expectedVersion=version(b.expectedVersion);if(version(b.packageVersion)!==expectedVersion)invalid();res.json(await service.confirm(scope(req,res,expectedVersion),{proposalId:text(b.proposalId),expectedVersion,inputEvidenceHash:text(b.inputEvidenceHash),...(b.confirmedTemplateCarryoverPlanHashes!==undefined?{confirmedTemplateCarryoverPlanHashes:carryovers(b.confirmedTemplateCarryoverPlanHashes)}:{})}));}));
 const errors:ErrorRequestHandler=(e,_req,res,next)=>{if(e instanceof SocialProgramError)res.status(e.status).json({code:e.code,error:e.message});else next(e);};router.use(errors);return router;
}
