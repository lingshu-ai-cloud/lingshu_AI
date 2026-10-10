import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AuthLocals} from '../middleware/auth.js';
import type {DataStore} from '../storage/datastore.js';
import {createWeeklyCreativeRepairConfigurationService} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {createWeeklyProductionRepairCaseService} from '../socialPrograms/weeklyProductionRepairCases.js';
import {SocialProgramError} from '../socialPrograms/service.js';
const asyncRoute=(action:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(action(req,res,next)).catch(next);
/** Mount inside the authenticated repair-cases/:caseId/creative-configuration scope. */
export function createSocialWeeklyCreativeRepairConfigurationRouter(store:DataStore){
 const router=Router({mergeParams:true}),configurations=createWeeklyCreativeRepairConfigurationService(store),cases=createWeeklyProductionRepairCaseService(store);
 router.post('/',asyncRoute(async(req,res)=>{
  const {tenantId,userId}=res.locals as AuthLocals;
  if(!tenantId||!userId)throw new SocialProgramError('weekly_creative_repair_auth_required',401,'请登录后配置创意修订。');
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['packageVersion','expectedCaseHash','revisionScope','estimatedDurationMinutes','maximumCostCny','deadlineAt'].includes(key))||!Number.isSafeInteger(body.packageVersion)||body.packageVersion<1||typeof body.expectedCaseHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseHash)||typeof body.revisionScope!=='string'||typeof body.estimatedDurationMinutes!=='number'||typeof body.maximumCostCny!=='number'||typeof body.deadlineAt!=='string')throw new SocialProgramError('weekly_creative_repair_body_invalid',400,'请完整提交修订范围、估时、预算和截止。');
  const caseId=String(req.params.caseId||''),item=await cases.read(tenantId,caseId);
  if(item.programId!==String(req.params.programId||'')||item.packageId!==String(req.params.packageId||'')||item.packageVersion!==body.packageVersion)throw new SocialProgramError('weekly_creative_repair_scope_invalid',404,'修订任务不属于当前周包。');
  const configuration=await configurations.configure(tenantId,userId,caseId,{expectedCaseHash:body.expectedCaseHash,revisionScope:body.revisionScope,estimatedDurationMinutes:body.estimatedDurationMinutes,maximumCostCny:body.maximumCostCny,deadlineAt:body.deadlineAt});
  res.setHeader('Cache-Control','private, no-store');res.json({configuration,item:await cases.read(tenantId,caseId)});
 }));
 const error:ErrorRequestHandler=(cause,_req,res,next)=>{if(cause instanceof SocialProgramError){res.status(cause.status).json({error:cause.code,message:cause.message});return;}next(cause);};router.use(error);return router;
}
