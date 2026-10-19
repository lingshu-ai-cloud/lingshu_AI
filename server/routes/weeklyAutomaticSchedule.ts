import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {DataStore} from '../storage/datastore.js';
import type {AuthLocals} from '../middleware/auth.js';
import {createWeeklyAutomaticScheduleService} from '../socialPrograms/weeklyAutomaticSchedule.js';
import {createWeeklyExecutionPipelineService} from '../socialPrograms/weeklyExecutionPipeline.js';
import {connectAndBindWeeklyAutomaticSchedule} from '../socialPrograms/weeklyAutomaticScheduleFlow.js';
import {SocialProgramError} from '../socialPrograms/service.js';

/** Mount under authenticated /:programId/operating-packages/:packageId/automatic-schedule.
 * Caller supplies only current version, never capacity, approval or result data. */
export function createWeeklyAutomaticScheduleRouter(store:DataStore){
 const router=Router({mergeParams:true}),service=createWeeklyAutomaticScheduleService(store),pipeline=createWeeklyExecutionPipelineService(store);
 const run=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
 router.post('/',run(async(req,res)=>{
  const auth=res.locals as AuthLocals;
  if(!auth.userId||!auth.tenantId)throw new SocialProgramError('weekly_template_auth_required',401,'请先登录。');
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='packageVersion')||!Number.isSafeInteger(body.packageVersion)||body.packageVersion<1||typeof req.params.programId!=='string'||typeof req.params.packageId!=='string')throw new SocialProgramError('weekly_template_input_invalid',400,'只需当前周版本，不需要重复确认默认模板。');
  let scope={tenantId:auth.tenantId,actorUserId:auth.userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:body.packageVersion};
  // Accepting the recommended weekly template is the single production opt-in.
  // Reuse the existing immutable revision, authority, scheduling, consumer and
  // admission boundaries instead of making the user confirm each one.
  const facts=await pipeline.bindExistingFacts(scope);scope={...scope,packageVersion:facts.item.version};
  const authority=await pipeline.prepareAuthority(scope);
  if(!authority.item)throw new SocialProgramError('weekly_template_production_authority_not_ready',409,'现有企业事实尚不能形成内容生产权限。');
  scope={...scope,packageVersion:authority.item.version};
  const item=await service.apply(scope);
  if(!item)throw new SocialProgramError('weekly_template_schedule_receipt_missing',503,'自动排期回执未能保存。');
  if(item.targetVersion)scope={...scope,packageVersion:item.targetVersion};
  const {launched}=await connectAndBindWeeklyAutomaticSchedule(store,scope);
  res.json({item,executionScope:{programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion},pipeline:launched.pipeline});
 }));
 const errors:ErrorRequestHandler=(error,_req,res,next)=>{if(error instanceof SocialProgramError)res.status(error.status).json({code:error.code,error:error.message});else next(error);};
 router.use(errors);return router;
}
