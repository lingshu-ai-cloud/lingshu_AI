import{Router,type RequestHandler,type ErrorRequestHandler}from'express';import type{DataStore}from'../storage/datastore.js';import type{AuthLocals}from'../middleware/auth.js';import{readWeeklyReviewEvidence}from'../socialPrograms/weeklyReviewEvidence.js';import{SocialProgramError}from'../socialPrograms/service.js';
import {executeWeeklyReviewOperation} from '../socialPrograms/weeklyReviewOperation.js';
/** Mount authenticated at /social-programs/:programId/operating-packages/:packageId/review-evidence. */
export function createSocialWeeklyReviewEvidenceRouter(store:DataStore){const router=Router({mergeParams:true});const get:RequestHandler=(req,res,next)=>{const auth=res.locals as AuthLocals;if(!auth.tenantId||!auth.userId){res.status(401).json({error:'weekly_review_read_auth_required'});return;}const version=typeof req.query.version==='string'&&/^[1-9]\d*$/.test(req.query.version)?Number(req.query.version):NaN;if(!Number.isSafeInteger(version)){res.status(400).json({error:'weekly_review_read_version_invalid'});return;}void readWeeklyReviewEvidence(store,{tenantId:auth.tenantId,actorUserId:auth.userId,programId:req.params.programId,packageId:req.params.packageId,packageVersion:version,taskId:req.params.taskId}).then(item=>res.json({item})).catch(next);};router.get('/:taskId',get);
router.post('/:taskId/run',(req,res,next)=>{
 const auth=res.locals as AuthLocals;
 if(!auth.tenantId||!auth.userId){res.status(401).json({error:'weekly_review_operation_auth_required'});return;}
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['packageVersion','expectedTaskUpdatedAt'].includes(k))||!Number.isSafeInteger(body.packageVersion)||body.packageVersion<1||typeof body.expectedTaskUpdatedAt!=='string'||!Number.isFinite(Date.parse(body.expectedTaskUpdatedAt))){res.status(400).json({error:'weekly_review_operation_input_invalid'});return;}
 const params=req.params as Record<string,string>;
 void executeWeeklyReviewOperation(store,{tenantId:auth.tenantId,actorUserId:auth.userId,programId:params.programId!,packageId:params.packageId!,packageVersion:body.packageVersion,taskId:params.taskId!,expectedTaskUpdatedAt:body.expectedTaskUpdatedAt}).then(item=>res.json({item})).catch(next);
});
const errors:ErrorRequestHandler=(error,_req,res,next)=>{if(error instanceof SocialProgramError){res.status(error.status).json({error:error.code,message:error.message});return;}next(error);};router.use(errors);return router;}
