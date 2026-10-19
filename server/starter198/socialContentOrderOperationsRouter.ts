import {Router,type Request,type Response} from 'express';
import type {Starter198Repository} from './repository.js';
import {STARTER_COLLECTIONS} from './repository.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject,socialText,requireSocialId,requireIdempotencyKey,SocialContentWorkflowError} from './socialContentValidation.js';
import {shanghaiNaturalWeek} from '../socialPrograms/contentCreationQuota.js';
import {readSocialContentOrderPlanning,replaceSocialContentPlannedOrder,increaseSocialContentOrderTarget} from './socialContentOrderPlanning.js';
import {cancelSocialContentOrder,socialContentCancellationGroupHash} from './socialContentOrderCancellation.js';
import {resolveSocialContentCostLineage} from './socialContentCostLineage.js';

/** Mounted under the existing authenticated, capability-checked content router.
 * Identity, costs, release safety and cancellation authority are never request fields. */
export function createSocialContentOrderOperationsRouter(input:{repository:Starter198Repository;
 authorize:(req:Request,res:Response,level:'read'|'write')=>Promise<{tenantId:string;userId:string}>;
 now?:()=>Date;budgetRoot?:string}){
 const router=Router();
 const invalid=():never=>{throw new SocialContentWorkflowError('social_content_order_request_invalid',400);};
 const safe=(action:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response)=>{
  void action(req,res).catch(error=>{
   const raw=error instanceof Error?error.message:'';
   const code=error instanceof SocialContentWorkflowError?error.code:/^(?:social_content_order_|content_creation_quota_)[a-z_]+$/.test(raw)?raw:'social_content_order_unavailable';
   const status=error instanceof SocialContentWorkflowError?error.status:code==='social_content_order_unavailable'?503:409;
   res.status(status).json({error:code,message:code});
  });
 };
 const scope=(source:Record<string,unknown>)=>{
  const programId=requireSocialId(source.programId),weekStart=socialText(source.weekStart);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)||!Number.isFinite(Date.parse(`${weekStart}T12:00:00+08:00`))
   ||shanghaiNaturalWeek(new Date(`${weekStart}T12:00:00+08:00`))!==weekStart)invalid();
  return{programId,weekStart};
 };
 const body=(req:Request,keys:string[])=>{
  const value=socialObject(req.body);
  if(!value||Buffer.byteLength(JSON.stringify(value))>8192||Object.keys(value).some(k=>!keys.includes(k)))return invalid();
  return value;
 };
 async function program(tenantId:string,programId:string){
  const rows=await input.repository.dataStore?.list<any>('social_programs',{where:{tenant_id:tenantId,program_id:programId},perPage:2});
  if(rows?.totalItems!==1||rows.items[0]?.tenant_id!==tenantId)throw new SocialContentWorkflowError('social_content_order_program_not_found',404);
 }
 router.get('/order-planning',safe(async(req,res)=>{
  const identity=await input.authorize(req,res,'read');
  if(Object.keys(req.query).some(k=>!['programId','weekStart'].includes(k)))invalid();
  const selected=scope(req.query);await program(identity.tenantId,selected.programId);
  res.json({item:await readSocialContentOrderPlanning({repository:input.repository,...identity,...selected})});
 }));
 router.get('/tasks/:taskId/order-planning',safe(async(req,res)=>{
  const identity=await input.authorize(req,res,'read');if(Object.keys(req.query).length)invalid();
  const taskId=requireSocialId(req.params.taskId),task=await requireSocialTask({repository:input.repository,...identity,taskId});
  const binding=socialObject(socialJson(task.content_order));
  let programId=socialText(binding?.programId),weekStart=socialText(binding?.originWeek);
  if(!programId&&binding?.schemaVersion==='social-content-order.v1'){
   const rows=await input.repository.dataStore?.list<any>('social_programs',{where:{tenant_id:identity.tenantId},perPage:2});
   if(rows?.totalItems===1&&rows.items[0]?.tenant_id===identity.tenantId)programId=socialText(rows.items[0].program_id);
  }
  if(programId&&!weekStart)weekStart=shanghaiNaturalWeek(input.now?.()??new Date());
  const selected=programId&&weekStart?{tenantId:identity.tenantId,...scope({programId,weekStart})}:null;
  if(selected)await program(identity.tenantId,programId);
  const planning=selected?await readSocialContentOrderPlanning({repository:input.repository,...selected}):null;
  const candidates=selected?await input.repository.list(STARTER_COLLECTIONS.socialContentTasks,identity.tenantId,{perPage:1000}):null;
  // A bounded complete snapshot is required. Never silently offer a truncated
  // replacement choice or synthesize a draft from a slot.
  const replacementTasks=candidates&&candidates.items.length===candidates.totalItems?candidates.items.filter(row=>{
   const b=socialObject(socialJson(row.content_order)),brief=socialObject(socialJson(row.brief));
   return b?.schemaVersion==='social-content-order.v1'&&b.contentId===row.task_id&&b.budgetTaskId===row.task_id
    &&['workspace','assistant'].includes(String(b.entry))&&!b.dispatch&&!b.dispatchHistory&&!b.cancellation&&!row.run_id&&!row.orchestrator_item_id
    &&['draft','needs_input','plan_review'].includes(socialText(row.status))&&!brief?._productionRevision&&!brief?._weeklyCreativeRepairProof
    &&(!b.programId||b.programId===programId)&&(!b.originWeek||b.originWeek===weekStart)
    &&(!socialText(socialObject(brief?.programRef)?.id)||socialObject(brief?.programRef)?.id===programId)
    &&!planning?.orders.some(order=>order.contentId===row.task_id);
  }).map(row=>({taskId:socialText(row.task_id),title:socialText(socialObject(socialJson(row.brief))?.title)||socialText(row.title)||socialText(row.task_id)})):[];
  let rootTask=task,rootId=taskId,verifiedRoot=binding?.schemaVersion==='social-content-order.v1'&&binding.contentId===taskId&&binding.budgetTaskId===taskId;
  if(binding?.schemaVersion==='social-content-order.v1'&&binding.contentId!==taskId){
   try{
    const lineage=await resolveSocialContentCostLineage({repository:input.repository,...identity,taskId});
    if(lineage.contentId===binding.contentId&&lineage.budgetTaskId===binding.budgetTaskId){
     rootId=lineage.contentId;rootTask=await requireSocialTask({repository:input.repository,...identity,taskId:rootId});verifiedRoot=true;
    }
   }catch{/* Invalid historical lineage stays read-only; never infer a cancel target. */}
  }
  const currentOrder=planning?.orders.find(order=>order.contentId===rootId);
  const rootBinding=socialObject(socialJson(rootTask.content_order)),marker=socialObject(rootBinding?.cancellation);
  const hasRevisions=Boolean(currentOrder?.revisions?.length);
  const terminal=['cancelled','cancelling','completed','succeeded','delivered','awaiting_publish','awaiting_metrics','reviewed'].includes(socialText(rootTask.status))||currentOrder?.state==='delivered';
  const participantIds=[...new Set([rootId,...(currentOrder?.revisions??[]).map(r=>r.executionTaskId)])];
  const participants=await Promise.all(participantIds.map(async id=>{
   const rows=await input.repository.list(STARTER_COLLECTIONS.socialContentTasks,identity.tenantId,{where:{task_id:id},perPage:2});
   const row=rows.totalItems===1?rows.items[0]:null;
   return{taskId:id,title:socialText(socialObject(socialJson(row?.brief))?.title)||socialText(row?.title)||(id===rootId?'原内容任务':'修订任务（待核验）'),status:socialText(row?.status)||'unverified',role:id===rootId?'original' as const:'revision' as const};
  }));
  const cancelable=Boolean(verifiedRoot&&!marker&&(!terminal||hasRevisions));
  const cancelTarget=verifiedRoot?{taskId:rootId,taskVersion:socialText(rootTask.version),groupHash:socialContentCancellationGroupHash(rootId,currentOrder?.revisions),participants}:null;
  const cancellation=socialObject(marker?.result),cancellationPending=Boolean(marker&&!cancellation);
  res.json({taskId,taskVersion:socialText(task.version),scope:selected,planning,replacementTasks,
   cancelTarget,cancellation,cancellationPending,
   cancelBlockedReason:cancelable?null:marker?'整体停止已申请，历史交付、运行和费用保留':terminal?'任务已结束且没有需停止的修订分支':'旧任务或修订谱系需核验后才能操作',cancelable});
 }));
 router.post('/order-planning/replace',safe(async(req,res)=>{
  const identity=await input.authorize(req,res,'write');
  const source=body(req,['programId','weekStart','commandId','reason','expectedRevision','selectedContentId','replacementTaskId']);
  const selected=scope(source);await program(identity.tenantId,selected.programId);
  const commandId=requireIdempotencyKey(req.headers['idempotency-key']);
  if(source.commandId!==commandId||!Number.isSafeInteger(source.expectedRevision)||Number(source.expectedRevision)<0
    ||!socialText(source.reason)||socialText(source.reason).length>500)invalid();
  res.json({item:await replaceSocialContentPlannedOrder({repository:input.repository,...identity,...selected,commandId,
   reason:socialText(source.reason),expectedRevision:Number(source.expectedRevision),selectedContentId:requireSocialId(source.selectedContentId),replacementTaskId:requireSocialId(source.replacementTaskId)})});
 }));
 router.post('/order-planning/increase-target',safe(async(req,res)=>{
  const identity=await input.authorize(req,res,'write');
  const source=body(req,['programId','weekStart','commandId','reason','expectedRevision','newLimit','confirmed']);
  const selected=scope(source);await program(identity.tenantId,selected.programId);
  const commandId=requireIdempotencyKey(req.headers['idempotency-key']);
  if(source.commandId!==commandId||source.confirmed!==true||!Number.isSafeInteger(source.expectedRevision)||Number(source.expectedRevision)<0
   ||!Number.isSafeInteger(source.newLimit)||Number(source.newLimit)>100||!socialText(source.reason)||socialText(source.reason).length>500)invalid();
  res.json({item:await increaseSocialContentOrderTarget({repository:input.repository,...identity,...selected,commandId,
   reason:socialText(source.reason),expectedRevision:Number(source.expectedRevision),newLimit:Number(source.newLimit),confirmed:true})});
 }));
 router.post('/tasks/:taskId/cancel-order',safe(async(req,res)=>{
  const identity=await input.authorize(req,res,'write');const source=body(req,['expectedVersion','reason','expectedGroupHash']);
  if(!socialText(source.expectedVersion)||!socialText(source.reason)||socialText(source.reason).length>500)invalid();
  if(source.expectedGroupHash!==undefined&&(typeof source.expectedGroupHash!=='string'||!/^[a-f0-9]{64}$/.test(source.expectedGroupHash)))invalid();
  res.json({item:await cancelSocialContentOrder({repository:input.repository,...identity,taskId:requireSocialId(req.params.taskId),
   expectedVersion:socialText(source.expectedVersion),reason:socialText(source.reason),expectedGroupHash:source.expectedGroupHash as string|undefined,idempotencyKey:requireIdempotencyKey(req.headers['idempotency-key']),now:input.now?.(),budgetRoot:input.budgetRoot})});
 }));
 return router;
}
