import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {DataStore} from '../storage/datastore.js';
import type {AuthLocals} from '../middleware/auth.js';
import {createWeeklyPublicationRecoveryScheduleService} from '../socialPrograms/weeklyPublicationRecoverySchedule.js';
import {SocialProgramError} from '../socialPrograms/service.js';

/** Authenticated mount: /:programId/operating-packages/:packageId/publication-recovery-schedule.
 * This is an auditable time amendment, never a release/acceptance action. */
export function createWeeklyPublicationRecoveryScheduleRouter(store:DataStore){
 const router=Router({mergeParams:true}),service=createWeeklyPublicationRecoveryScheduleService(store);
 const run=(fn:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 router.post('/',run(async(req,res)=>{
  const auth=res.locals as AuthLocals,body=req.body;
  if(!auth.userId||!auth.tenantId)throw new SocialProgramError('weekly_publication_recovery_auth_required',401,'请先登录。');
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['packageVersion','publicationTaskId','plannedSendAt'].includes(k))||!Number.isSafeInteger(body.packageVersion)||body.packageVersion<1||typeof body.publicationTaskId!=='string'||(body.plannedSendAt!==undefined&&typeof body.plannedSendAt!=='string')||typeof req.params.programId!=='string'||typeof req.params.packageId!=='string')throw new SocialProgramError('weekly_publication_recovery_input_invalid',400,'需要当前周版本和原发布目标；默认自动采用本周剩余补排时间。');
  res.json({item:await service.adopt({tenantId:auth.tenantId,actorUserId:auth.userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:body.packageVersion},body.publicationTaskId,body.plannedSendAt)});
 }));
 const errors:ErrorRequestHandler=(error,_req,res,next)=>{if(error instanceof SocialProgramError)res.status(error.status).json({code:error.code,error:error.message});else next(error);};
 router.use(errors);return router;
}
