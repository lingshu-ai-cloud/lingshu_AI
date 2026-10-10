import {Router,type RequestHandler} from 'express';
import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase.js';
import type {WeeklyCreativeRepairCapacityPreview} from '../../shared/contracts/weeklyCreativeRepairExecution.js';
import {SocialProgramError} from '../socialPrograms/service.js';

type RepairScope={tenantId:string;userId:string;programId:string;packageId:string;packageVersion:number;caseId:string;item:WeeklyProductionRepairCase};
type ExecutionService={
 previewCapacity(tenantId:string,userId:string,caseId:string):Promise<WeeklyCreativeRepairCapacityPreview>;
 confirmCapacity(tenantId:string,userId:string,caseId:string,input:{expectedCaseRecordHash:string;expectedConfigurationHash:string;expectedPreviewHash:string;expectedAuthorityHash:string;expectedQuoteHash?:string;authorizedMaximumCostCny:number}):Promise<WeeklyProductionRepairCase>;
 start(tenantId:string,userId:string,caseId:string,input:{expectedCaseRecordHash:string}):Promise<WeeklyProductionRepairCase>;
};
type CompletionService={reconcile(tenantId:string,userId:string,caseId:string):Promise<WeeklyProductionRepairCase>};
type Body=Record<string,unknown>;
const HASH=/^[a-f0-9]{64}$/;
const object=(value:unknown):Body|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Body:null;
const exact=(body:Body,keys:string[])=>Object.keys(body).every(key=>keys.includes(key));
function invalid(code:string,message:string):never{throw new SocialProgramError(code,400,message);}

export function parseCreativeRepairCapacityConfirmation(value:unknown){
 const body=object(value),keys=['packageVersion','expectedCaseRecordHash','expectedConfigurationHash','expectedPreviewHash','expectedAuthorityHash','expectedQuoteHash','authorizedMaximumCostCny'];
 if(!body||!exact(body,keys)||!Number.isSafeInteger(body.packageVersion)||Number(body.packageVersion)<1||typeof body.expectedCaseRecordHash!=='string'||!HASH.test(body.expectedCaseRecordHash)||typeof body.expectedConfigurationHash!=='string'||!HASH.test(body.expectedConfigurationHash)||typeof body.expectedPreviewHash!=='string'||!HASH.test(body.expectedPreviewHash)||typeof body.expectedAuthorityHash!=='string'||!HASH.test(body.expectedAuthorityHash)||(body.expectedQuoteHash!==undefined&&(typeof body.expectedQuoteHash!=='string'||!HASH.test(body.expectedQuoteHash)))||typeof body.authorizedMaximumCostCny!=='number'||!Number.isFinite(body.authorizedMaximumCostCny)||body.authorizedMaximumCostCny<0)invalid('weekly_creative_repair_capacity_input_invalid','创意返工容量确认参数无效。');
 return{packageVersion:Number(body.packageVersion),expectedCaseRecordHash:body.expectedCaseRecordHash,expectedConfigurationHash:body.expectedConfigurationHash,expectedPreviewHash:body.expectedPreviewHash,expectedAuthorityHash:body.expectedAuthorityHash,...(body.expectedQuoteHash===undefined?{}:{expectedQuoteHash:body.expectedQuoteHash}),authorizedMaximumCostCny:body.authorizedMaximumCostCny};
}
export function parseCreativeRepairStart(value:unknown){
 const body=object(value);
 if(!body||!exact(body,['packageVersion','expectedCaseRecordHash'])||!Number.isSafeInteger(body.packageVersion)||Number(body.packageVersion)<1||typeof body.expectedCaseRecordHash!=='string'||!HASH.test(body.expectedCaseRecordHash))invalid('weekly_creative_repair_start_input_invalid','创意返工作业启动参数无效。');
 return{packageVersion:Number(body.packageVersion),expectedCaseRecordHash:body.expectedCaseRecordHash};
}
export function parseCreativeRepairReconcile(value:unknown){
 const body=object(value);
 if(!body||!exact(body,['packageVersion'])||!Number.isSafeInteger(body.packageVersion)||Number(body.packageVersion)<1)invalid('weekly_creative_repair_reconcile_input_invalid','创意返工核验参数无效。');
 return{packageVersion:Number(body.packageVersion)};
}

/** Mounted below an authenticated, tenant-scoped case resource. The caller must
 * resolve the stored case on every request; request bodies never supply identity. */
export function createSocialWeeklyCreativeRepairExecutionRouter(input:{execution:ExecutionService;completion:CompletionService;resolveScope(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],packageVersion:number):Promise<RepairScope>;wake?(jobId:string):Promise<void>}){
 const router=Router({mergeParams:true});
 const route=(handler:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
 const scope=async(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],version:number)=>{const found=await input.resolveScope(req,res,version);if(!found.tenantId||!found.userId||found.item.kind!=='creative_revision'||found.item.programId!==found.programId||found.item.packageId!==found.packageId||found.item.packageVersion!==version||found.item.caseId!==found.caseId)throw new SocialProgramError('weekly_creative_repair_scope_invalid',404,'该返工任务不属于当前周包。');return found;};
 router.get('/capacity-preview',route(async(req,res)=>{if(Object.keys(req.query).some(key=>key!=='version'))invalid('weekly_creative_repair_query_invalid','创意返工容量预览参数无效。');const version=Number(req.query.version);if(!Number.isSafeInteger(version)||version<1)invalid('package_version_invalid','周包版本无效。');const s=await scope(req,res,version);res.setHeader('Cache-Control','private, no-store');res.json({item:await input.execution.previewCapacity(s.tenantId,s.userId,s.caseId)});}));
 router.post('/confirm-capacity',route(async(req,res)=>{const parsed=parseCreativeRepairCapacityConfirmation(req.body),s=await scope(req,res,parsed.packageVersion),{packageVersion:_,...command}=parsed;res.json({item:await input.execution.confirmCapacity(s.tenantId,s.userId,s.caseId,command)});}));
 router.post('/start',route(async(req,res)=>{const parsed=parseCreativeRepairStart(req.body),s=await scope(req,res,parsed.packageVersion),item=await input.execution.start(s.tenantId,s.userId,s.caseId,{expectedCaseRecordHash:parsed.expectedCaseRecordHash});if(item.execution&&input.wake)await input.wake(item.execution.jobId).catch(()=>undefined);res.status(202).json({item});}));
 const reconcile=route(async(req,res)=>{const parsed=parseCreativeRepairReconcile(req.body),s=await scope(req,res,parsed.packageVersion);res.setHeader('Cache-Control','private, no-store');res.json({item:await input.completion.reconcile(s.tenantId,s.userId,s.caseId)});});
 router.post('/reconcile',reconcile);
 router.post('/audit',reconcile);
 return router;
}
