import {weeklyAssetRequirementIdentity,type WeeklyAssetRequirement} from '../../shared/weeklyAutomaticMaterial.js';
import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore } from '../storage/datastore.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { createWeeklyMaterialRequestService, type MaterialConsumer, type WeeklyMaterialPorts } from '../socialPrograms/weeklyMaterialRequests.js';

const invalid=():never=>{throw new SocialProgramError('weekly_material_body_invalid',400,'请提交字段正确的素材任务对象。');};
function object(value:unknown,allowed:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const body=value as Record<string,unknown>;
  if(Object.keys(body).some(key=>!allowed.includes(key)))return invalid();
  return body;
}
function required(value:unknown):string{if(typeof value!=='string'||!value.trim())return invalid();return value.trim();}
function integer(value:unknown,min=0):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)return invalid();return value;}
function consumers(value:unknown):MaterialConsumer[]{
 if(!Array.isArray(value)||!value.length)return invalid();
 return value.map(item=>{const body=object(item,['taskId','packageId','packageVersion','requirement','assetRequirement']);let assetRequirement:WeeklyAssetRequirement|undefined;if(body.assetRequirement){const a=object(body.assetRequirement,['subjectRef','action','scene','evidenceRequirement','aspectRatio','minimumDurationSeconds','authorizationScope']);assetRequirement={subjectRef:required(a.subjectRef),action:required(a.action),scene:required(a.scene),evidenceRequirement:required(a.evidenceRequirement),aspectRatio:required(a.aspectRatio),minimumDurationSeconds:Number(a.minimumDurationSeconds),authorizationScope:required(a.authorizationScope)};try{weeklyAssetRequirementIdentity(assetRequirement);}catch{return invalid();}}return {taskId:required(body.taskId),packageId:required(body.packageId),packageVersion:integer(body.packageVersion,1),requirement:required(body.requirement),...(assetRequirement?{assetRequirement}:{})};});
}
const asyncRoute=(action:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(action(req,res,next)).catch(next);
/** Mounted beneath an authenticated /:programId/material-requests parent. No upload server or client identity authority. */
export function createSocialWeeklyMaterialRequestsRouter(store:DataStore,ports:WeeklyMaterialPorts={}){
 const router=Router({mergeParams:true});
 const service=createWeeklyMaterialRequestService(store,ports);
 router.use((req,res,next)=>{const auth=res.locals as AuthLocals;if(!auth.tenantId||!auth.userId)return next(new SocialProgramError('weekly_material_auth_required',401,'请先登录。'));next();});
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1])=>({tenantId:(res.locals as AuthLocals).tenantId,programId:required(req.params.programId),actorUserId:(res.locals as AuthLocals).userId});
 router.get('/',asyncRoute(async(req,res)=>{const auth=scope(req,res);res.json({items:await service.list(auth.tenantId,auth.programId,auth.actorUserId)});}));
 router.get('/:requestId',asyncRoute(async(req,res)=>{const auth=scope(req,res);res.json({item:await service.get(auth.tenantId,auth.programId,required(req.params.requestId),auth.actorUserId)});}));
 router.post('/',asyncRoute(async(req,res)=>{
  const body=object(req.body,['requirementKey','requirements','assigneeUserId','reviewerUserId','dueAt','verificationDueAt','timeZone','consumers']);
  res.status(201).json({item:await service.create({...scope(req,res),requirementKey:required(body.requirementKey),requirements:required(body.requirements),assigneeUserId:required(body.assigneeUserId),reviewerUserId:required(body.reviewerUserId),dueAt:required(body.dueAt),...(body.verificationDueAt===undefined?{}:{verificationDueAt:required(body.verificationDueAt)}),timeZone:required(body.timeZone),consumers:consumers(body.consumers)})});
 }));
 router.post('/:requestId/submissions',asyncRoute(async(req,res)=>{
  const body=object(req.body,['materialRecordIds','expectedSubmissionVersion']);
  if(!Array.isArray(body.materialRecordIds)||!body.materialRecordIds.length)return invalid();
  res.json({item:await service.submit({...scope(req,res),requestId:required(req.params.requestId),materialRecordIds:body.materialRecordIds.map(required),expectedSubmissionVersion:integer(body.expectedSubmissionVersion)})});
 }));
 router.post('/:requestId/reviews',asyncRoute(async(req,res)=>{
  const body=object(req.body,['submissionVersion','consumerDecisions']);
  if(!Array.isArray(body.consumerDecisions)||!body.consumerDecisions.length)return invalid();
  const consumerDecisions=body.consumerDecisions.map(item=>{const decision=object(item,['taskId','accepted','factCheck','rightsCheck','visualCheck']);if(typeof decision.accepted!=='boolean')return invalid();return {taskId:required(decision.taskId),accepted:decision.accepted,factCheck:required(decision.factCheck),rightsCheck:required(decision.rightsCheck),visualCheck:required(decision.visualCheck)};});
  res.json({item:await service.review({...scope(req,res),requestId:required(req.params.requestId),submissionVersion:integer(body.submissionVersion,1),consumerDecisions})});
 }));
 router.post('/:requestId/revisions',asyncRoute(async(req,res)=>{
  const body=object(req.body,['reason','dueAt','verificationDueAt','timeZone','addConsumers']);
  if(!body.dueAt&&!body.verificationDueAt&&!body.addConsumers||body.timeZone&&!body.dueAt)return invalid();
  res.json({item:await service.revise({...scope(req,res),requestId:required(req.params.requestId),reason:required(body.reason),...(body.dueAt?{dueAt:required(body.dueAt)}:{}),...(body.verificationDueAt?{verificationDueAt:required(body.verificationDueAt)}:{}),...(body.timeZone?{timeZone:required(body.timeZone)}:{}),...(body.addConsumers?{addConsumers:consumers(body.addConsumers)}:{})})});
 }));
 router.post('/:requestId/cancellation',asyncRoute(async(req,res)=>{const body=object(req.body,['reason']);res.json({item:await service.cancel({...scope(req,res),requestId:required(req.params.requestId),reason:required(body.reason)})});}));
 router.use(((error,_req,res,next)=>{if(error instanceof SocialProgramError){res.status(error.status).json({error:error.code,message:error.message});return;}next(error);}) as ErrorRequestHandler);
 return router;
}
