import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HeyGenClient } from '../lib/heygen.js';
import type { NativeSpeechTrackReceipt } from '../lib/heygenNativeSpeechTrack.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';
import type { VoiceRouteAmendment, NativeVoiceFailureRetry } from './socialContentVoiceRouteAmendment.js';
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const fail=(reason:string):never=>{throw Error('native_voice_recovery_'+reason);};
/** Only a preserved exact request plus a fresh original-task GET can authorize
 * a new attempt. Unknown transport states never become retry permission. */
export async function readNativeVoiceFailureRetry(record:VoiceRouteAmendment,ports:{root?:string;key?:string;readStatus?:(taskId:string,key:string)=>Promise<Record<string,unknown>>}={}):Promise<NativeVoiceFailureRetry>{
  const file=path.join(path.resolve(ports.root||'data/social-content-native-speech'),sha(record.newIntent.operationId),'receipt.json');
  let bytes:Buffer;try{bytes=fs.readFileSync(file);}catch{return fail('original_receipt_missing');}
  let receipt:NativeSpeechTrackReceipt;try{receipt=JSON.parse(bytes.toString());}catch{return fail('original_receipt_corrupt');}
  const person=record.selectedVoice.presenters[0],scope=receipt.input?.scope as Record<string,unknown>|undefined;
  if(record.executionMode!=='native_video'||receipt.status!=='failed'||!receipt.providerTaskId||receipt.providerStatus?.status!=='failed'
    || !receipt.providerStatus.failure_code || (receipt.providerStatus.id||receipt.providerStatus.video_id)!==receipt.providerTaskId
    || receipt.identity!==sha(JSON.stringify(receipt.input))||receipt.input.operationId!==record.newIntent.operationId
    || !scope || (['tenantId','taskId','runId'] as const).some(key=>scope[key]!==record.scope[key])
    || !person||receipt.input.avatarId!==person.avatarId||receipt.input.voiceId!==record.selectedVoice.voiceId||receipt.input.script!==record.requirement.text
    ||receipt.input.maximumDurationSeconds!==record.newRoute.maximumUnits.providerSeconds
    ||receipt.request?.aspect_ratio!==receipt.input.ratio||(receipt.request?.engine as {type?:unknown})?.type!=='avatar_iv'
    ||receipt.request?.avatar_id!==person.avatarId||receipt.request?.voice_id!==record.selectedVoice.voiceId||receipt.request?.script!==record.requirement.text)return fail('definitive_failure_not_proven');
  const key=ports.key||process.env.HEYGEN_API_KEY?.trim();
  if(!key||sha(key)!==record.nativeVideoBinding?.credentialSha256)return fail('account_changed');
  const read=ports.readStatus|| (async(id:string,credential:string)=>{
    let raw:Record<string,unknown>|undefined;
    const client=new HeyGenClient(credential,fetch,{beforeSubmit:async()=>fail('read_only'),onAccepted:async()=>fail('read_only'),onStatus:async(_id,data)=>{raw=data;}});
    await client.status(id);if(!raw)return fail('provider_status_missing');return raw;
  });
  const current=await read(receipt.providerTaskId,key);
  if(current.status!=='failed'||(current.id||current.video_id)!==receipt.providerTaskId||current.failure_code!==receipt.providerStatus.failure_code)return fail('supplier_not_failed');
  return {attempt:(record.retry?.attempt||0)+1,failedOperationId:record.newIntent.operationId,providerTaskId:receipt.providerTaskId,
    failureCode:String(current.failure_code),receiptSha256:sha(bytes),providerStatusHash:paidProductionHash(current)};
}
