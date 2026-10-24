import { applyCustomerBusinessProgress } from './businessProgress.js';
import { durableFollowupDraft } from './durableFollowupDraft.js';
import { mergeRunCustomerSources } from './runCustomerMerge.js';
import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { parseCustomerCriteria, type CustomerSegmentCriteria } from '../../shared/contracts/customerSegmentation.js';
import { evaluateCustomerSegment } from './segmentEvaluation.js';
import { projectCustomerBusinessProfile, buyerConversationFingerprint, readCustomerBusinessProfile, customerClassificationId } from './businessProfile.js';
import { classifyContextTags } from '../messenger/contextTags.js';
import { customerHasOptedOut, createCustomerSegmentSnapshot } from '../digitalEmployees/customerWorkflow.js';
import { readWeeklyCustomerRelationshipScope } from '../socialPrograms/weeklyCustomerRelationshipScope.js';
import { attachSelectedWeeklyWhatsAppCustomers, readSelectedWeeklyNativeCustomers } from '../socialPrograms/weeklyCustomerChannelSelections.js';
import { readAuthorizedWhatsAppCustomers } from '../whatsapp/authorizedCustomerRead.js';
import { readAuthorizedMessengerCustomers } from '../messenger/authorizedCustomerRead.js';
import { readCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';
import { assessCustomerRelationship, customerRelationshipWindow } from '../socialPrograms/customerRelationshipEvidence.js';
import { store as runtimeStore } from '../storage/index.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { readCompleteRows } from './aggregateRecovery.js';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export interface CustomerBatchPorts {
  read(tenantId:string,runId:string):Promise<Record<string,unknown>[]>;
  classify:typeof classifyContextTags;
  now():number;
}
export async function readCustomerBatchSources(store:DataStore,tenantId:string,runId:string):Promise<Record<string,unknown>[]> {
  let customers:Record<string,unknown>[]=[...await readAuthorizedWhatsAppCustomers(tenantId,store),...await readAuthorizedMessengerCustomers(tenantId,store)];
  const scope=await readWeeklyCustomerRelationshipScope(store,tenantId,runId);
  if(scope)customers=mergeRunCustomerSources(await attachSelectedWeeklyWhatsAppCustomers(store,scope,customers),await readSelectedWeeklyNativeCustomers(store,scope));
  return [...new Map(customers.map(c=>[String(c.id),c])).values()];
}
const classificationId=customerClassificationId;
export function createCustomerBatchService(store:DataStore,ports:Partial<CustomerBatchPorts>={}) {
  const read=ports.read??((tenant,run)=>readCustomerBatchSources(store,tenant,run)),now=ports.now??Date.now;
  async function context(tenantId:string,runId:string) {
    const run=await store.getById<Record_>('workflow_runs',runId);
    if(!run||run.tenant_id!==tenantId)throw Object.assign(Error('customer_batch_run_not_found'),{status:404});
    if(['cancelled','paused','failed','succeeded'].includes(String(run.status)))throw Object.assign(Error('customer_batch_run_inactive'),{status:409});
    const goal=await store.getById<Record_>('weekly_goals',String(run.goal_id));
    if(!goal||goal.tenant_id!==tenantId)throw Error('customer_batch_goal_invalid');
    const tasks=await readCompleteRows<Record_>(store,'workflow_tasks',{tenant_id:tenantId,run_id:runId});
    const matches=tasks.filter(t=>t.task_key==='customer_segmentation'&&t.agent_role==='customer');
    if(matches.length!==1)throw Error('customer_batch_segmentation_task_ambiguous');
    return {run,goal,task:matches[0]!};
  }
  async function profiles(tenantId:string,runId:string) {
    const {goal}=await context(tenantId,runId);
    const [orders,quotes,exceptions]=await Promise.all([readCompleteRows<Record_>(store,'tenant_orders',{tenant_id:tenantId}),readCompleteRows<Record_>(store,'quote_skill_drafts',{tenant_id:tenantId}),readCompleteRows<Record_>(store,'weekly_customer_knowledge_quote_requests',{tenant_id:tenantId,run_id:runId})]);
    if(!ports.read){const readiness=await customerChannelReadiness(tenantId);if(!readiness.some(r=>r.available))throw Error('customer_batch_channels_not_ready');}
    const customers=await read(tenantId,runId);const result:Record<string,unknown>[]=[];
    for(const customer of customers){
      if(customer.tenantId!==undefined&&customer.tenantId!==tenantId||customer.isMock||customer.isHistorical||customer.readOnly)continue;
      const saved=await store.getById<Record_>('customer_classifications',classificationId(tenantId,customer));
      const payload=saved?.tenant_id===tenantId&&saved.customer_id===customer.id?object(saved.payload):{};
      const cache=payload.accountHash===customer.accountHash?payload:{};
      const c=await readCustomerBusinessProfile(store,tenantId,customer,Object.keys(cache).length?cache:customer);
      // Retain proved native-selection identities, not unverified caller classifications.
      const selection=object(customer.weeklyChannelSelection);let relationship='unknown';let relationshipEvidence:unknown=null;
      if(selection.recordHash&&['new_inquiry','existing_contact'].includes(String(selection.classification))){relationship=String(selection.classification);relationshipEvidence=selection.relationshipEvidenceHash;}
      else if(customer.waNumber){const proof=await assessCustomerRelationship(store,{tenantId,customerId:String(customer.id),weekStart:String(goal.starts_at),weekEnd:String(goal.ends_at)});relationship=proof.classification==='existing_customer'?'existing_contact':proof.classification;relationshipEvidence=proof.evidenceHash;}
      if(!customer.waNumber&&relationship==='unknown'){
        const prior=(Array.isArray(customer.timeline)?customer.timeline:[]).map(object).filter(t=>t.actor==='buyer'&&Number(t.timestamp)<customerRelationshipWindow(String(goal.starts_at),String(goal.ends_at)).start);
        if(prior.length){relationship='existing_contact';relationshipEvidence={type:'prior_verified_buyer_message',id:prior[0]!.id,hash:socialRequestHash(prior[0])};}
      }
      const confirmed=object(cache.relationshipConfirmation);
      if(relationship==='unknown'&&confirmed.runId===runId&&confirmed.goalId===goal.id&&confirmed.accountHash===customer.accountHash){
        const message=(Array.isArray(customer.timeline)?customer.timeline:[]).map(object).find(t=>t.id===confirmed.messageId&&t.actor==='buyer');
        if(message&&socialRequestHash(message)===confirmed.messageHash&&confirmed.classification==='new_inquiry'){relationship='new_inquiry';relationshipEvidence=confirmed;}
      }
      const paid=orders.filter(row=>{const o=object(row.order);return row.tenant_id===tenantId&&o.customerId===customer.id&&o.status==='paid'&&!o.refundedAt&&Number(o.refundAmount||0)===0;});
      c.businessFacts={...object(c.businessFacts),relationship,relationshipEvidence,purchase:paid.length?'recorded_paid':'unknown',purchaseEvidence:paid.map(row=>({type:'canonical_order_ledger',id:row.id,hash:socialRequestHash(row.order),verification:'recorded_not_payment_gateway'}))};
      if(paid.length)c.stage='won';
      result.push(applyCustomerBusinessProgress(c,tenantId,runId,quotes,exceptions));
    }
    return result;
  }
  async function snapshot(tenantId:string,runId:string,input:unknown){
    const criteria=parseCustomerCriteria(input),customers=await profiles(tenantId,runId),capturedAt=now();
    const rows=customers.map(c=>({customerId:String(c.id),channel:String(c.source||'whatsapp'),name:String(c.name||c.id),
      ...evaluateCustomerSegment(c,criteria,capturedAt,customerHasOptedOut(c)),
      evidence:{fingerprint:c.classificationFingerprint,contextTags:c.contextTagEvidence,facts:c.businessFacts,buyerMessages:(Array.isArray(c.timeline)?c.timeline:[]).map(object).filter(t=>t.actor==='buyer').map(t=>({id:String(t.id),body:String(t.body),occurredAt:new Date(Number(t.timestamp)).toISOString()}))},
      contactability:c.handlingMode==='human_needed'?'human_review_required':customerHasOptedOut(c)?'opted_out':'requires_send_preflight'}));
    const previewHash=socialRequestHash({tenantId,runId,criteria,rows});
    return {customers,result:{schemaVersion:1,runId,criteria,previewHash,capturedAt:new Date(capturedAt).toISOString(),rows,
      counts:{total:rows.length,included:rows.filter(r=>r.included).length,excluded:rows.filter(r=>!r.included).length,unknown:rows.filter(r=>r.exclusionReasons.some(v=>v.startsWith('unknown:'))).length},messagesSent:0}};
  }
  const preview=async(tenantId:string,runId:string,input:unknown)=>(await snapshot(tenantId,runId,input)).result;
  async function freeze(tenantId:string,actor:string,runId:string,criteria:CustomerSegmentCriteria,expectedPreviewHash:string){
    return withDigitalEmployeeRunLock(tenantId,runId,async()=>{
      const {result:latest,customers}=await snapshot(tenantId,runId,criteria);if(latest.previewHash!==expectedPreviewHash)throw Object.assign(Error('customer_batch_preview_changed'),{status:409});
      if(latest.counts.included===0&&latest.counts.unknown>0)throw Error('customer_batch_classification_required');
      if(latest.counts.included===0&&latest.rows.some(r=>r.exclusionReasons.includes('native_channel_selection_required')))throw Error('customer_batch_channel_selection_required');
      const {run,goal,task}=await context(tenantId,runId);
      const recheck=customers.map(c=>String(c.id));if(new Set(recheck).size!==customers.length)throw Error('customer_batch_customer_ambiguous');
      // Replay uses the same existing segment; refresh requests must use an explicit new preview/version.
      const oldSegments=await readCompleteRows<Record_>(store,'customer_segments',{tenant_id:tenantId,run_id:run.id});
      const replay=oldSegments.find(s=>s.name===`batch-preview:${latest.previewHash}`&&s.task_id===task.id);
      if(replay&&replay.status==='generated'&&object(task.output).previewHash===latest.previewHash&&object(task.output).freezeState==='complete')return {segment:replay,members:await readCompleteRows(store,'customer_segment_members',{tenant_id:tenantId,segment_id:replay.id}),purpose:criteria.purpose||'followup',messagesSent:0};
      const batches=await readCompleteRows<Record_>(store,'followup_batches',{tenant_id:tenantId,run_id:run.id});
      for(const batch of batches){const items=await readCompleteRows<Record_>(store,'followup_batch_items',{tenant_id:tenantId,batch_id:batch.id});if(items.some(i=>i.provider_message_id||i.sent_at||['sending','partial_sent'].includes(String(i.status))||Object.keys(object(i.provider_receipt)).length))throw Error('customer_batch_existing_external_receipt');}
      const frozen=replay&&replay.status==='generated'?{segment:replay,members:await readCompleteRows(store,'customer_segment_members',{tenant_id:tenantId,segment_id:replay.id}),created:false}:await createCustomerSegmentSnapshot({tenantId,goalId:goal.id,runId:run.id,taskId:task.id,userId:actor,name:`batch-preview:${latest.previewHash}`,criteria,expectedMemberIds:latest.rows.filter(r=>r.included).map(r=>r.customerId),idempotent:false},async()=>customers,store);
      if(!await store.update('workflow_tasks',task.id,{business_refs:[{type:'customer_segment',id:frozen.segment.id,version:frozen.segment.version}],status:'running',output:{freezeState:'preparing',previewHash:latest.previewHash,purpose:criteria.purpose||'followup',messagesSent:0},updated_at:new Date(now()).toISOString()}))throw Error('customer_batch_task_write_failed');
      for(const batch of batches)if(!['superseded','cancelled'].includes(String(batch.status))&&!await store.update('followup_batches',batch.id,{status:'superseded'}))throw Error('customer_batch_invalidation_failed');
      const approvals=await readCompleteRows<Record_>(store,'approval_requests',{tenant_id:tenantId,run_id:run.id});
      for(const approval of approvals.filter(a=>batches.some(b=>b.approval_id===a.id)))if(!await store.update('approval_requests',approval.id,{status:'superseded'}))throw Error('customer_batch_approval_invalidation_failed');
      const tasks=await readCompleteRows<Record_>(store,'workflow_tasks',{tenant_id:tenantId,run_id:run.id});
      for(const task of tasks.filter(t=>['followup_batch_draft','followup_batch_approval','followup_dispatch'].includes(String(t.task_key)))){
        if(!await store.update('workflow_tasks',task.id,{status:criteria.managementAction==='screen'?'skipped':'pending',blocked_reason:criteria.managementAction==='screen'?'customer_screen_only':'',business_refs:[],output:{purpose:criteria.purpose,managementAction:criteria.managementAction},updated_at:new Date(now()).toISOString()}))throw Error('customer_batch_downstream_write_failed');
      }
      if(!await store.update('workflow_tasks',task.id,{status:'succeeded',output:{freezeState:'complete',previewHash:latest.previewHash,purpose:criteria.purpose||'followup',messagesSent:0}}))throw Error('customer_batch_freeze_commit_failed');
      return {...frozen,purpose:criteria.purpose||'followup',messagesSent:0};
    });
  }
  async function classify(tenantId:string,runId:string,customerIds:string[],actorId='customer-classifier'){
    await context(tenantId,runId);if(customerIds.length>10)throw Error('customer_batch_classification_limit');
    const customers=await read(tenantId,runId),results=[];
    for(const id of customerIds){try{const customer=customers.find(c=>c.id===id);if(!customer)throw Error('customer_batch_customer_not_found');
      const turns=(Array.isArray(customer.timeline)?customer.timeline:[]) as Array<{id:string;actor:string;body:string}>;
      const contextTagEvidence=JSON.parse(await durableFollowupDraft(store,{tenantId,actorId,identity:{kind:'classification-v5',customerId:id,accountHash:customer.accountHash,fingerprint:buyerConversationFingerprint(turns)}},async()=>JSON.stringify(await (ports.classify??classifyContextTags)(turns))));
      const latest=(await read(tenantId,runId)).find(c=>c.id===id);
      if(!latest||latest.accountHash!==customer.accountHash||buyerConversationFingerprint(latest.timeline as Record<string,unknown>[])!==buyerConversationFingerprint(turns))throw Error('customer_batch_classification_source_changed');
      const payload={accountHash:customer.accountHash,contextTagEvidence,contextTagsBuyerFingerprint:buyerConversationFingerprint(turns),contextTagsAnalysisVersion:5,classifiedAt:new Date(now()).toISOString()};
      const key=classificationId(tenantId,customer),old=await store.getById<Record_>('customer_classifications',key);
      if(old&&object(old.payload).accountHash===customer.accountHash)Object.assign(payload,{reviewedProfile:object(old.payload).reviewedProfile,reviewedBy:object(old.payload).reviewedBy,reviewedAt:object(old.payload).reviewedAt,relationshipConfirmation:object(old.payload).relationshipConfirmation});
      if(old?old.tenant_id!==tenantId||old.customer_id!==id||!await store.update('customer_classifications',key,{payload}):!await store.create('customer_classifications',{id:key,tenant_id:tenantId,customer_id:id,payload}))throw Error('customer_classification_write_failed');
      results.push({customerId:id,status:'succeeded',tags:contextTagEvidence.map((e:{tag:string})=>e.tag)});
    }catch(error){results.push({customerId:id,status:'failed',code:error instanceof Error?error.message:'customer_classification_failed',retryable:false});}
    }
    return {items:results,messagesSent:0};
  }
  async function reviewProfile(tenantId:string,actor:string,runId:string,customerId:string,expectedFingerprint:string,profile:{language:string;timeZone:string;countryName?:string}){
    await context(tenantId,runId);const c=(await read(tenantId,runId)).find(v=>v.id===customerId);
    if(!c||!c.accountHash||!c.accountId)throw Error('customer_profile_account_unverified');
    if(buyerConversationFingerprint(c.timeline as Record<string,unknown>[])!==expectedFingerprint)throw Error('customer_profile_source_changed');
    try{new Intl.DateTimeFormat('en',{timeZone:profile.timeZone}).format(now());}catch{throw Error('customer_profile_time_zone_invalid');}
    const id=classificationId(tenantId,c),old=await store.getById<Record_>('customer_classifications',id);
    if(old&&(old.tenant_id!==tenantId||old.customer_id!==customerId))throw Error('customer_profile_scope_mismatch');
    const prior=old&&object(old.payload).accountHash===c.accountHash?object(old.payload):{};
    const payload={...prior,accountHash:c.accountHash,reviewedProfile:profile,reviewedBy:actor,reviewedAt:new Date(now()).toISOString()};
    if(old?!await store.update('customer_classifications',id,{payload}):!await store.create('customer_classifications',{id,tenant_id:tenantId,customer_id:customerId,payload}))throw Error('customer_profile_write_failed');
    return {customerId,profile,reviewedBy:actor,messagesSent:0};
  }
  async function confirmNewInquiry(tenantId:string,actor:string,runId:string,customerId:string,input:{firstMessageId:string;expectedFingerprint:string;reason:string}){
    const {goal}=await context(tenantId,runId),c=(await read(tenantId,runId)).find(v=>v.id===customerId);
    if(!c||!c.accountId||!c.accountHash||buyerConversationFingerprint(c.timeline as Record<string,unknown>[])!==input.expectedFingerprint)throw Error('customer_relationship_source_changed');
    const turns=(c.timeline as Record<string,unknown>[]).filter(t=>t.actor==='buyer'),message=turns.find(t=>t.id===input.firstMessageId),{start,end}=customerRelationshipWindow(String(goal.starts_at),String(goal.ends_at));
    if(!message||!Number.isFinite(start)||!Number.isFinite(end)||Number(message.timestamp)<start||Number(message.timestamp)>end||turns.some(t=>Number(t.timestamp)<Number(message.timestamp)))throw Error('customer_relationship_first_inquiry_unverified');
    const existing=(await profiles(tenantId,runId)).find(v=>v.id===customerId);if(object(existing?.businessFacts).relationship==='existing_contact')throw Error('customer_relationship_existing_contact_conflict');
    if(c.waNumber){const {confirmCustomerRelationship}=await import('../socialPrograms/customerRelationshipEvidence.js');await confirmCustomerRelationship(store,{tenantId,actorUserId:actor,customerId,classification:'new_inquiry',weekStart:String(goal.starts_at),weekEnd:String(goal.ends_at),firstInteractionId:input.firstMessageId,relationshipSince:new Date(Number(message.timestamp)).toISOString(),reason:input.reason});}
    const id=classificationId(tenantId,c),old=await store.getById<Record_>('customer_classifications',id);if(old&&(old.tenant_id!==tenantId||old.customer_id!==customerId))throw Error('customer_relationship_scope_mismatch');
    const prior=old&&object(old.payload).accountHash===c.accountHash?object(old.payload):{};
    const confirmation={runId,goalId:goal.id,classification:'new_inquiry',messageId:message.id,messageHash:socialRequestHash(message),accountHash:c.accountHash,confirmedBy:actor,reason:input.reason,confirmedAt:new Date(now()).toISOString()};
    const payload={...prior,accountHash:c.accountHash,relationshipConfirmation:confirmation};
    if(old?!await store.update('customer_classifications',id,{payload}):!await store.create('customer_classifications',{id,tenant_id:tenantId,customer_id:customerId,payload}))throw Error('customer_relationship_confirmation_write_failed');
    return {customerId,classification:'new_inquiry',messagesSent:0};
  }
  return {preview,freeze,classify,profiles,reviewProfile,confirmNewInquiry};
}
export const customerBatchService=createCustomerBatchService(runtimeStore);
export async function customerChannelReadiness(tenantId:string){
  const items=[];for(const channel of ['whatsapp','messenger','instagram'] as const){const auth=await readCustomerMessagingAuthorization(tenantId,channel);items.push({channel,available:auth.manualFollowupSendAllowed,reasons:auth.reasons});}return items;
}
