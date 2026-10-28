import {Router} from 'express';
import type {AuthLocals} from '../middleware/auth.js';
import type {DataStore} from '../storage/datastore.js';
import {readWeeklyVideoQualityMedia} from '../socialPrograms/weeklyVideoQualityMedia.js';
import {SocialProgramError} from '../socialPrograms/service.js';

/** Mounted after the parent social-program authentication middleware. */
export function createWeeklyVideoQualityMediaRouter(store:DataStore){
 const router=Router();
 router.get('/:programId/operating-packages/:packageId/execution-tasks/:taskId/video-quality/media',(req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  void(async()=>{
   const version=Number(req.query.version),query=req.query;
   if(!Number.isSafeInteger(version)||version<1||Object.keys(query).some(key=>!['version','jobId','runId','mediaSha256','qualityInputHash','frameSha256'].includes(key))
    ||['jobId','runId','mediaSha256','qualityInputHash'].some(key=>typeof query[key]!=='string')
    ||(query.frameSha256!==undefined&&typeof query.frameSha256!=='string'))throw new SocialProgramError('weekly_video_quality_media_input_invalid',400,'成片预览参数无效。');
   const {tenantId}=res.locals as AuthLocals;
   if(!tenantId)throw new SocialProgramError('weekly_video_quality_media_auth_required',401,'请登录后查看成片。');
   const result=await readWeeklyVideoQualityMedia(store,{tenantId,programId:String(req.params.programId),packageId:String(req.params.packageId),packageVersion:version,executionTaskId:String(req.params.taskId)},
    {expectedJobId:String(query.jobId),expectedRunId:String(query.runId),expectedMediaSha256:String(query.mediaSha256),expectedQualityInputHash:String(query.qualityInputHash),...(query.frameSha256?{frameSha256:String(query.frameSha256)}:{})});
   res.set({'Content-Type':result.contentType,'Content-Length':String(result.bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
   res.send(result.bytes);
  })().catch(next);
 });
 return router;
}
