import {createLocalPreviewProfileAnalysis,localPreviewProfilePatch,type LocalPreviewProfilePorts,type LocalPreviewProfileState,type LocalPreviewProfileResult} from './localPreviewProfileAnalysis.js';
import { correctCustomerTag, readTagCorrections, type CustomerTagCorrectionInput, type CustomerTagCorrection } from '../../shared/contracts/customerTags.js';
import {withCustomerPreviewAi, type PreviewAiAudit} from '../../scripts/customer-preview-ai-scope.mjs';
import {generateCustomerReplyResult} from '../routes/draftReply.js';
import {translateCustomerText} from './translation.js';
import type {CustomerReplyRequest} from '../../shared/contracts/customerReply.js';
/** Local preview composition. Domain rules stay in the existing services; all records are namespaced. */
import {createHash, randomUUID} from 'node:crypto';
import type {DataStore, Record_} from '../storage/datastore.js';
import {store as runtimeStore} from '../storage/index.js';
import {handleMessengerWebhook, upsertMessengerMessage, type MessengerCustomer, type MessengerConversationRepository} from '../messenger/conversations.js';
import {messengerCustomerAccountIdentityHash} from '../messenger/authorizedCustomerRead.js';
import {createMessengerCapabilityScope} from '../messenger/capabilityAuthority.js';
import {sealAccountCredential} from '../lib/accountCredentials.js';
import {createCustomerManualTakeoverService} from './customerManualTakeover.js';
import {createCustomerChannelSendRequestService} from '../digitalEmployees/customerChannelSendRequests.js';
import {createCustomerSegmentSnapshot, createFollowupBatch, configureFollowupItemTemplate, applyFollowupBatchDecision, getFollowupBatch, getFollowupBatchItems} from '../digitalEmployees/customerWorkflow.js';
import {createDigitalEmployeeApprovalDecisionApplication} from '../digitalEmployees/approvalDecision.js';
import {supportedFollowupTemplate} from '../whatsapp/templates.js';
import {withDigitalEmployeeRunLock} from '../digitalEmployees/runControl.js';
import type {CustomerChannelSendReceipt} from '../../shared/contracts/customerChannelSendRequest.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const PREVIEW_TEMPLATE=supportedFollowupTemplate({id:'preview-template',name:'preview_information',language:'en_US',status:'APPROVED',components:[{type:'BODY',text:'{{1}}'}]})!;
export interface PreviewSession extends Record_ {profileAnalysis?:LocalPreviewProfileState;profileResult?:LocalPreviewProfileResult;tagProfile?:{tags:string[];contextTagCorrections:CustomerTagCorrection[]};tenant_id:string;owner_id:string;original_id:string;customer:MessengerCustomer|null;pendingDraft:string;batch_id:string;approval_id:string;request_id:string;transport_calls:number;fail_history:boolean;generation_calls:number;reply_request_id:string;generated_body?:string;translated_body?:string;ai_audit?:PreviewAiAudit[];translation_cache?:{hash:string;text:string};reply_status?:string}
/** Prefix every collection, including users/accounts/leases. Never install this adapter on the runtime singleton. */
export function customerPreviewStore(base:DataStore):DataStore {
 const name=(c:string)=>`customer_preview_${c}`;
 return {getById:(c,id)=>base.getById(name(c),id),list:(c,q)=>base.list(name(c),q),create:(c,d)=>base.create(name(c),d),update:(c,id,d)=>base.update(name(c),id,d),delete:(c,id)=>base.delete(name(c),id),
 ...(base.compareAndSwap?{compareAndSwap:(c:string,id:string,e:Record<string,unknown>,d:Record<string,unknown>)=>base.compareAndSwap!(name(c),id,e,d)}:{})};
}
export interface PreviewAiPorts {generate:(...args:Parameters<typeof generateCustomerReplyResult>)=>Promise<import('./replyRequests.js').ReplyGeneratorResult>;translate:typeof translateCustomerText;run:typeof withCustomerPreviewAi}
export function createLocalCustomerSimulation(base:DataStore=runtimeStore, ai:PreviewAiPorts={generate:generateCustomerReplyResult,translate:translateCustomerText,run:withCustomerPreviewAi}, profilePorts?:LocalPreviewProfilePorts) {
 const sessionIdFor=(tenant:string,user:string,originalId:string)=>hash(process.env.CUSTOMER_SIMULATION_REAL_AI==='1'?[tenant,user,originalId,'real-ai-v1']:[tenant,user,originalId]).slice(0,24);
 const store=customerPreviewStore(base);
 const need=(v:unknown,code:string):void=>{if(!v)throw Object.assign(Error(code),{status:409});};
 async function updateSession(id:string,patch:Record<string,unknown>){
  if(!Array.isArray(patch.ai_audit)){need(await store.update('sessions',id,patch),'preview_save_failed');return;}
  const admitted=await store.getById<PreviewSession>('sessions',id);need(admitted,'preview_session_not_found');
  // Every audit writer acquires this short lock after any preview lock; no AI waits inside it.
  await withDigitalEmployeeRunLock(admitted!.tenant_id,`preview-audit-${id}`,async()=>{
   const latest=await store.getById<PreviewSession>('sessions',id);need(latest,'preview_session_not_found');
   const seen=new Set<string>(),audit=[...(latest!.ai_audit||[]),...(patch.ai_audit as PreviewAiAudit[])].filter(item=>{const key=JSON.stringify(item);if(seen.has(key))return false;seen.add(key);return true;});
   need(await store.update('sessions',id,{...patch,ai_audit:audit}),'preview_save_failed');
  });
 }
 async function save(s:PreviewSession){const {profileAnalysis:_state,profileResult:_result,tagProfile:_tags,customer:_customer,...fields}=s;await updateSession(s.id,fields);}
 async function runAi<T>(s:PreviewSession,fn:()=>Promise<T>){try{const result=await ai.run(fn);s.ai_audit=[...(s.ai_audit||[]),...result.audit];await save(s);return result.value;}catch(error){const audit=(error as {previewAiAudit?:PreviewAiAudit[]}).previewAiAudit;if(audit){s.ai_audit=[...(s.ai_audit||[]),...audit];await save(s);}throw error;}}
 async function translate(s:PreviewSession,text:string,source:string,target:string){
  const key=hash([text,source,target]);if(s.translation_cache?.hash===key)return s.translation_cache.text;
  const result=await runAi(s,()=>ai.translate(text,source,target));s.translation_cache={hash:key,text:result};
  if(text===s.pendingDraft&&target==='English')s.translated_body=result;await save(s);return result;
 }
 async function updateDraft(s:PreviewSession,text:string){if(text!==s.pendingDraft){need(!s.request_id,'preview_send_already_started');if(s.approval_id)await store.update('approval_requests',s.approval_id,{status:'superseded'});s.batch_id='';s.approval_id='';s.generated_body='';s.translated_body='';s.translation_cache=undefined;}s.pendingDraft=text;await save(s);}
 async function session(tenant:string,user:string,id:string){const s=await store.getById<PreviewSession>('sessions',id);if(!s||s.tenant_id!==tenant||s.owner_id!==user)throw Object.assign(Error('preview_session_not_found'),{status:404});return s;}
 async function account(s:PreviewSession){
  const input={accountId:`account-${s.id}`,tenantId:s.tenant_id,pageId:`page-${s.id}`};
  const token=`local-controlled-${s.id}`;
  const a={id:input.accountId,tenantId:s.tenant_id,platform:'facebook',status:'connected',providerAccountId:input.pageId,messengerSubscribed:true,accessToken:sealAccountCredential(token),scope:createMessengerCapabilityScope({...input,appId:'local-preview-only',accessToken:token,grantedScopes:['pages_messaging','pages_manage_metadata']})};
  if(await store.getById('social_accounts',a.id))need(await store.update('social_accounts',a.id,a),'preview_account_save_failed');else need(await store.create('social_accounts',a),'preview_account_save_failed');return a;
 }
 const profile=createLocalPreviewProfileAnalysis({read:session,update:updateSession},profilePorts);
 const repository=(s:PreviewSession):MessengerConversationRepository=>({read:()=>s.customer?[structuredClone(s.customer)]:[],write:items=>{s.customer=items[0]??null;}});
 const manual=createCustomerManualTakeoverService(store,{resolve:async(tenant,id,channel)=>{
  const rows=await store.list<PreviewSession>('sessions',{where:{tenant_id:tenant},perPage:250});const s=rows.items.find(s=>s.customer?.id===id);need(s?.customer&&channel==='messenger','preview_customer_missing');
  return {tenantId:tenant,channel,customerId:id,accountId:`account-${s!.id}`,nativeAccountId:`page-${s!.id}`,conversationId:`messenger:page-${s!.id}:buyer-${s!.id}`,accountHash:hash([tenant,s!.id]),handlingMode:String(s!.customer!.handlingMode)};
 }});
 const ledger=createCustomerChannelSendRequestService(store);
 const decide=createDigitalEmployeeApprovalDecisionApplication({store,buildPublishingPackage:async()=>{throw Error('preview_publishing_forbidden');},listConnectedPublishingAccounts:async()=>[],createPublishingCalendarEntries:async()=>{throw Error('preview_publishing_forbidden');},applyFollowupBatchDecision:i=>applyFollowupBatchDecision(i,store),appendAudit:async i=>{need(await store.create('audit_logs',i),'preview_audit_failed');},appendEvent:async i=>store.create('workflow_events',i),continueRun:async()=>{}});
 const identity=(s:PreviewSession)=>({tenantId:s.tenant_id,actorUserId:s.owner_id,customerId:s.customer!.id,channel:'messenger' as const});
 async function recordHistory(s:PreviewSession,receipt:CustomerChannelSendReceipt,body:string){
  if(s.fail_history){s.fail_history=false;await save(s);throw Error('preview_injected_history_write_failure');}
  const a=await account(s);
  upsertMessengerMessage({tenantId:s.tenant_id,pageId:String(a.providerAccountId),userId:`buyer-${s.id}`,messageId:receipt.messageId,body,timestamp:Date.parse(receipt.acceptedAt),actor:'seller',sendStatus:'sent',audit:{accountId:a.id,pageId:String(a.providerAccountId),accountHash:messengerCustomerAccountIdentityHash(a)}},repository(s));need(await store.update('sessions',s.id,{customer:s.customer}),'preview_save_failed');await save(s);
 }
 async function read(s:PreviewSession){
  const batch=s.batch_id?await getFollowupBatch(s.tenant_id,s.batch_id,store):null;
  const items=batch?await getFollowupBatchItems(s.tenant_id,batch.id,store):[];
  return {simulation:true as const,sessionId:s.id,customer:s.customer,profile:localPreviewProfilePatch(s),pendingDraft:s.pendingDraft,replyRequestId:s.reply_request_id,batch,items,approval:s.approval_id?await store.getById('approval_requests',s.approval_id):null,manual:s.customer?await manual.read(identity(s)):null,send:s.request_id?await ledger.get(s.tenant_id,s.owner_id,'messenger',s.request_id):null,transportCalls:s.transport_calls,generationCalls:s.generation_calls,template:PREVIEW_TEMPLATE,aiMode:'real',aiAudit:s.ai_audit||[],replyStatus:s.reply_status};
 }
 return {store,session,save,read,profile,
 async generateForReply(s:PreviewSession,body:CustomerReplyRequest,signal:AbortSignal){return withDigitalEmployeeRunLock(s.tenant_id,`preview-${s.id}`,async()=>{
  s=await session(s.tenant_id,s.owner_id,s.id);need(!s.request_id,'preview_send_already_started');
  s.generation_calls++;s.reply_request_id=body.requestId!;await save(s);
  const result=await runAi(s,()=>ai.generate(body,{tenantId:s.tenant_id,userId:s.owner_id},signal));
  if(result.status<400){await updateDraft(s,String(result.body.translatedDraft||result.body.draft||''));s.generated_body=String(result.body.draft||'');s.reply_status=String((result.body.verification as {status?:string})?.status||'unknown');await save(s);}
  return result;
 });},
 async translateForReply(s:PreviewSession,text:string,source:string,target:string){return withDigitalEmployeeRunLock(s.tenant_id,`preview-${s.id}`,async()=>translate(await session(s.tenant_id,s.owner_id,s.id),text,source,target));},
 async drafts(tenant:string,user:string){const rows=await store.list<PreviewSession>('sessions',{where:{tenant_id:tenant,owner_id:user},perPage:250});return Promise.all(rows.items.filter(s=>s.id===sessionIdFor(tenant,user,s.original_id)).map(async s=>{const view=await read(s);const item=view.items[0];return {customerId:s.original_id,patch:{...(s.tagProfile||{}),pendingDraft:view.send?.status==='accepted'?null:s.pendingDraft||null,...(s.customer?{...localPreviewProfilePatch(s),timeline:s.customer.timeline,source:'messenger',stage:'inquiry',lastActive:s.customer.lastActive,lastActiveAt:s.customer.lastActiveAt}:{}),localSimulation:{sessionId:s.id,itemHash:item?.content_hash,approvedBody:view.batch?.status==='approved'?item?.draft_body:undefined}}};}));},
 async correctTag(tenant:string,user:string,originalId:string,tags:string[],input:CustomerTagCorrectionInput,evidence:Array<{tag:string;messageId:string;excerpt:string}>){
  await this.start(tenant,user,originalId);const id=sessionIdFor(tenant,user,originalId);
  return withDigitalEmployeeRunLock(tenant,`preview-${id}`,async()=>{
   const s=await session(tenant,user,id);
   const patch=correctCustomerTag([...new Set([...(s.tagProfile?.tags||tags),...((s.profileResult?.profile.tags||[]) as string[])])],readTagCorrections(s.tagProfile?.contextTagCorrections),input,new Date().toISOString(),evidence);
   need(await store.update('sessions',id,{tagProfile:patch}),'preview_save_failed');return patch;
  });
 },
 async saveDraft(tenant:string,user:string,originalId:string,draft:string|null){await this.start(tenant,user,originalId);const s=await session(tenant,user,sessionIdFor(tenant,user,originalId));await updateDraft(s,draft||'');},
 async start(tenant:string,user:string,originalId:string){
  need(/^mock-[a-zA-Z0-9_-]{1,150}$/.test(originalId),'preview_mock_customer_required');
  const id=sessionIdFor(tenant,user,originalId);let s=await store.getById<PreviewSession>('sessions',id);
  if(!s){s={id,tenant_id:tenant,owner_id:user,original_id:originalId,customer:null,pendingDraft:'',batch_id:'',approval_id:'',request_id:'',transport_calls:0,fail_history:false,generation_calls:0,reply_request_id:''};need(await store.create('sessions',s),'preview_session_save_failed');}
  const actor={id:user,tenantId:tenant,role:'customer_service'};if(!await store.getById('users',user))need(await store.create('users',actor),'preview_actor_save_failed');
  await account(s);return read(s);
 },
 async generate(s:PreviewSession,requestId:string,signal:AbortSignal){
  need(s.customer?.timeline.some(m=>m.actor==='buyer'),'preview_inbound_required');
  s.generation_calls++;s.reply_request_id=requestId;await save(s);
  const result=await runAi(s,()=>ai.generate({customerId:s.customer!.id,customerName:s.customer!.name,timeline:s.customer!.timeline,language:'English',manualRequest:true,intent:'reply'}, {tenantId:s.tenant_id,userId:s.owner_id},signal));
  s.generated_body=String(result.body.draft||'');s.pendingDraft=String(result.body.translatedDraft||s.generated_body);s.translated_body='';s.translation_cache=undefined;s.reply_status=String((result.body.verification as {status?:string})?.status||'unknown');await save(s);
  return result;
 },
 async act(tenant:string,user:string,id:string,action:string,payload:Record<string,unknown>){return withDigitalEmployeeRunLock(tenant,`preview-${id}`,async()=>{
  const s=await session(tenant,user,id);const a=await account(s);
  if(action==='inbound'){
   need(typeof payload.text==='string'&&payload.text.trim()&&payload.text.length<=2000&&typeof payload.eventId==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(payload.eventId),'preview_inbound_invalid');
   const result=await handleMessengerWebhook(tenant,{object:'page',entry:[{id:a.providerAccountId,messaging:[{sender:{id:`buyer-${id}`},recipient:{id:a.providerAccountId},timestamp:Date.now(),message:{mid:`mid.preview-${payload.eventId}`,text:payload.text}}]}]},{verifiedSignature:true,analyzeTags:false,dataStore:store,repository:repository(s)});need(result.accepted===1,'preview_inbound_not_accepted');
   Object.assign(s.customer!,{name:'本地链路验收客户',language:'英语',timeZone:'UTC',countryName:'本地隔离环境',summary:'受控模拟客户；无真实渠道授权',isMock:true});need(await store.update('sessions',s.id,{customer:s.customer}),'preview_save_failed');await save(s);await profile.inbound(s);
  }else{
   need(s.customer,'preview_inbound_required');
   if(action==='save-draft'){need(typeof payload.text==='string'&&payload.text.trim()&&payload.text.length<=2000,'preview_draft_invalid');await updateDraft(s,String(payload.text));}
   else if(action==='translate'){
    need(typeof payload.text==='string'&&payload.text.trim(),'preview_translation_text_required');const text=String(payload.text),target=/[\u4e00-\u9fff]/.test(text)?'English':'简体中文';
    const result=await translate(s,text,'auto',target);return {...await read(s),translation:result};
   }
   else if(action==='hold'){await manual.hold({...identity(s),minutes:10,expectedVersion:(await manual.read(identity(s))).item?.version??0});}
   else if(action==='release'){const view=await manual.read(identity(s));need(view.item,'preview_hold_missing');await manual.release({...identity(s),expectedVersion:view.item!.version});}
   else if(action==='prepare-template'){
    need(s.pendingDraft,'preview_draft_required');need(!s.request_id,'preview_send_already_started');
    const runId=`run-${id}`,goalId=`goal-${id}`,taskId=`approval-${id}`;
    for(const [c,row]of [['weekly_goals',{id:goalId,tenant_id:tenant,status:'active'}],['workflow_runs',{id:runId,tenant_id:tenant,goal_id:goalId,status:'running'}],['workflow_tasks',{id:taskId,tenant_id:tenant,run_id:runId,task_key:'followup_batch_approval',status:'waiting_approval'}]] as const){if(!await store.getById(c,row.id))need(await store.create(c,row),'preview_workflow_save_failed');}
    // The controlled adapter supplies native account context, never an authorized production selection.
    const customer={...s.customer,isMock:false,timeZone:'UTC',weeklyChannelSelection:{channel:'messenger',accountId:a.id,nativeAccountId:a.providerAccountId,recipientId:`buyer-${id}`,conversationId:`messenger:${a.providerAccountId}:buyer-${id}`,recordHash:hash([tenant,id])}};
    const segment=await createCustomerSegmentSnapshot({tenantId:tenant,userId:user,runId,goalId,taskId:`segment-${id}`,criteria:{stages:['inquiry'],minIntentScore:0}},async()=>[customer],store);
    const generated=await createFollowupBatch({tenantId:tenant,userId:user,runId,goalId,taskId:`draft-${id}`,segmentId:segment.segment.id,draftOverrides:{[s.customer!.id]:s.translated_body||s.generated_body||s.pendingDraft},enterpriseProfile:{} as never},async()=>[customer],store);
    need(generated.items.length===1,'preview_batch_empty');
    const configured=await configureFollowupItemTemplate({tenantId:tenant,batchId:generated.batch.id,itemId:generated.items[0]!.id,templateName:PREVIEW_TEMPLATE.name,language:PREVIEW_TEMPLATE.language,variables:[s.translated_body||s.generated_body||s.pendingDraft]},async()=>PREVIEW_TEMPLATE,store);
    s.batch_id=configured.batch.id;
    if(s.approval_id)await store.update('approval_requests',s.approval_id,{status:'superseded'});
    const approval=await store.create('approval_requests',{tenant_id:tenant,run_id:runId,task_id:taskId,status:'pending',subject_version:configured.batch.version,content_hash:configured.batch.content_hash,created_at:new Date().toISOString()});need(approval,'preview_approval_save_failed');s.approval_id=approval!.id;await store.update('workflow_tasks',taskId,{status:'waiting_approval'});await save(s);
   }else if(action==='approve'||action==='reject'){
    const approval=await store.getById<Record_>('approval_requests',s.approval_id);need(approval,'preview_approval_required');
    need(payload.version===approval!.subject_version&&payload.contentHash===approval!.content_hash,'preview_approval_changed');
    await decide({tenantId:tenant,userId:user,approvalId:s.approval_id,decision:action==='approve'?'approved':'rejected',expectedSubjectVersion:String(payload.version),expectedContentHash:String(payload.contentHash)});
   }else if(action==='send'||action==='send-history-failure'){
    const view=await read(s);need(view.batch?.status==='approved'&&view.batch.approved_version===view.batch.version&&view.items.length===1&&view.items[0]!.status==='approved','preview_approved_batch_required');
    const item=view.items[0]!;need(payload.text===undefined||payload.text===item.draft_body,'preview_send_body_changed');need(payload.contentHash===item.content_hash,'preview_send_content_changed');
    if(!s.request_id){s.request_id=`preview-${randomUUID()}`;s.fail_history=action==='send-history-failure';await save(s);}
    await manual.withHumanSendPermission(identity(s),()=>ledger.execute({tenantId:tenant,actorUserId:user,channel:'messenger',customerId:s.customer!.id,accountId:a.id,recipientId:`buyer-${id}`,body:item.draft_body,requestId:s.request_id,send:async()=>{s.transport_calls++;await save(s);return {messageId:`mid.preview-out-${s.request_id}`,recipientId:`buyer-${id}`,raw:{simulation:true}};},recordHistory:r=>recordHistory(s,r,item.draft_body)}));
   }else if(action==='recover'){
    need(s.request_id,'preview_send_required');const view=await read(s);const body=view.items[0]?.draft_body;need(body,'preview_batch_missing');
    await ledger.repairHistory({...identity(s),channel:'messenger',requestId:s.request_id,recordHistory:(r,actualBody)=>recordHistory(s,r,actualBody)});
   }else if(action==='receipt'){
    const sent=await ledger.get(tenant,user,'messenger',s.request_id);need(sent?.status==='accepted','preview_accepted_send_required');
    await ledger.recordSignedChannelReceipt({tenantId:tenant,channel:'messenger',nativeAccountId:String(a.providerAccountId),recipientId:`buyer-${id}`,providerMessageId:sent!.providerMessageId!,status:'delivered',eventKind:'delivery',eventHash:hash([s.request_id,'delivery']),signedBodyHash:hash([s.request_id,'controlled-receipt']),verifiedSignature:true,occurredAt:new Date().toISOString()});
    // Exercise the original conversation receipt projection too; this is a local controlled event.
    await handleMessengerWebhook(tenant,{object:'page',entry:[{id:a.providerAccountId,messaging:[{sender:{id:`buyer-${id}`},recipient:{id:a.providerAccountId},delivery:{mids:[sent!.providerMessageId]}}]}]},{verifiedSignature:true,analyzeTags:false,dataStore:store,repository:repository(s)});need(await store.update('sessions',s.id,{customer:s.customer}),'preview_save_failed');await save(s);
   }else if(action!=='read')throw Object.assign(Error('preview_action_invalid'),{status:400});
  }
  return read(await session(tenant,user,id));
 });}
 };
}
