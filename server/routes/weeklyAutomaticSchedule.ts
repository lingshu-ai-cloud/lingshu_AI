import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {DataStore} from '../storage/datastore.js';
import type {AuthLocals} from '../middleware/auth.js';
import {createWeeklyAutomaticScheduleService} from '../socialPrograms/weeklyAutomaticSchedule.js';
import {SocialProgramError} from '../socialPrograms/service.js';

/** Mount under authenticated /:programId/operating-packages/:packageId/automatic-schedule.
 * Caller supplies only current version, never capacity, approval or result data. */
export function createWeeklyAutomaticScheduleRouter(store:DataStore){
 const router=Router({mergeParams:true}),service=createWeeklyAutomaticScheduleService(store);
 const run=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
 router.post('/',run(async(req,res)=>{
  const auth=res.locals as AuthLocals;
  if(!auth.userId||!auth.tenantId)throw new SocialProgramError('weekly_template_auth_required',401,'请先登录。');
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='packageVersion')||!Number.isSafeInteger(body.packageVersion)||body.packageVersion<1||typeof req.params.programId!=='string'||typeof req.params.packageId!=='string')throw new SocialProgramError('weekly_template_input_invalid',400,'只需当前周版本，不需要重复确认默认模板。');
  res.json({item:await service.apply({tenantId:auth.tenantId,actorUserId:auth.userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:body.packageVersion})});
 }));
 const errors:ErrorRequestHandler=(error,_req,res,next)=>{if(error instanceof SocialProgramError)res.status(error.status).json({code:error.code,error:error.message});else next(error);};
 router.use(errors);return router;
}
