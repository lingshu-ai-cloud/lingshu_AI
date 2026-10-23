import { Router, text } from 'express';
import { weComCustomerService, type WeComCustomerService } from '../wecom/customerService.js';
type Ingress=Pick<WeComCustomerService,'verifyCallbackChallenge'|'ingestCallback'|'processCallback'>;
/** Signature/corp validation belongs to the existing service; no bearer identity is accepted from a platform callback. */
export function createWeComCustomerIngress(service:Ingress=weComCustomerService){
 const router=Router();
 const value=(v:unknown)=>typeof v==='string'&&v.length<=128000?v:'';
 router.get('/:tenantId',async(req,res)=>{try{res.type('text').send(await service.verifyCallbackChallenge({tenantId:String(req.params.tenantId),signature:value(req.query.msg_signature),timestamp:value(req.query.timestamp),nonce:value(req.query.nonce),encryptedEcho:value(req.query.echostr)}));}catch(e){res.status(e&&typeof e==='object'&&'status'in e?Number(e.status):403).json({error:e instanceof Error?e.message:'wecom_callback_invalid'});}});
 router.post('/:tenantId',text({type:['text/xml','application/xml','text/plain'],limit:'128kb'}),async(req,res)=>{
  try{const tenantId=String(req.params.tenantId);const result=await service.ingestCallback({tenantId,signature:value(req.query.msg_signature),timestamp:value(req.query.timestamp),nonce:value(req.query.nonce),rawXml:value(req.body)});
   res.type('text').send('success');
   if(result.shouldProcess)void service.processCallback({tenantId,callbackId:result.callbackId}).catch(error=>console.warn('[wecom:callback-process-pending]',error instanceof Error?error.message:'callback_processing_failed'));
  }catch(e){res.status(e&&typeof e==='object'&&'status'in e?Number(e.status):503).json({error:e instanceof Error?e.message:'wecom_callback_failed'});}
 });return router;
}
