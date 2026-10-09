import {sendRecoveryFixture} from '../socialPrograms/weeklyCustomerSendRecovery.fixture.js';
import {bindWeeklyCustomerRun} from '../runtime/socialWeeklyCustomerBridge.js';
import {nativeWeeklyConversationPort,type WeeklyChannelConversation} from '../socialPrograms/weeklyCustomerChannelScope.js';
import {confirmWeeklyCustomerChannelSelection} from '../socialPrograms/weeklyCustomerChannelSelections.js';
import {createWeeklyNativeFollowupDispatchService,validateWeeklyNativeSendReceipt} from './weeklyNativeFollowupDispatch.js';
import {createCustomerChannelSendRequestService} from './customerChannelSendRequests.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {CustomerMessagingAuthorization} from './customerMessagingPolicy.js';
const scope={runId:'run',programId:'program',packageId:'week',packageVersion:1};
export async function nativeDispatchFixture(channel:'messenger'|'instagram'='messenger',unknown=false){
 const f=sendRecoveryFixture();const oldRead=nativeWeeklyConversationPort.read;const source:WeeklyChannelConversation={tenantId:'tenant',customerId:'buyer',channel,nativeAccountId:'native-account',recipientId:'buyer-native',conversationId:`${channel}:native-account:buyer-native`,messages:[{id:'mid.inbound',actor:'buyer',body:'Please quote 100 units',timestamp:Date.parse('2026-10-06T10:00:00Z'),audit:{providerMessageId:'mid.inbound',providerRecipientId:'buyer-native'}}]};
 nativeWeeklyConversationPort.read=async(_,c)=>c===channel?[structuredClone(source)]:[];
 f.data.social_accounts=[{id:'account',tenantId:'tenant',platform:channel==='messenger'?'facebook':'instagram',providerAccountId:'native-account',status:'connected'}];
 const rawUpdate=f.store.update.bind(f.store);f.store.update=async(c,id,p)=>Boolean(await rawUpdate(c,id,p));f.store.delete=async(c,id)=>{const list=f.data[c]??[];const index=list.findIndex(r=>r.id===id);if(index<0)return false;list.splice(index,1);return true;};
 await bindWeeklyCustomerRun(f.store,{tenantId:'tenant',...scope},'run','owner');
 const receipt=await confirmWeeklyCustomerChannelSelection(f.store,{tenantId:'tenant',actorUserId:'owner',...scope},{...scope,channel,accountId:'account',customerId:'buyer',inboundMessageId:'mid.inbound',classification:'new_inquiry',reason:'Use verified native enquiry'});
 const item=f.data.followup_batch_items![0]!,batch=f.data.followup_batches![0]!;
 f.data.customer_segment_members![0]!.customer_snapshot={weeklyChannelSelection:receipt};Object.assign(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!,{status:'waiting_external',depends_on:['followup_batch_approval']});Object.assign(batch,{status:'approved',delivery_policy:{hashAlgorithm:'ordered_item_content_hashes_v1'}});Object.assign(item,{channel,channel_selection:receipt,account_id:'account',native_account_id:'native-account',recipient_id:'buyer-native',conversation_id:receipt.conversationId,weekly_channel_evidence_hash:receipt.recordHash,status:'approved',approved_at:'2026-10-06T11:00:00Z',scheduled_at:'2026-10-06T12:00:00Z',time_zone:'UTC',provider_message_id:'',provider_receipt:{},sent_at:''});
 let sends=0;const ledger=createCustomerChannelSendRequestService(f.store);
 const service=createWeeklyNativeFollowupDispatchService(f.store,{humanPermission:async(_a,_hash,send)=>send(),now:()=>new Date('2026-10-06T12:00:00Z'),authorization:async()=>({tenantId:'tenant',channel,manualFollowupSendAllowed:true} as CustomerMessagingAuthorization),send:async(a,body,requestId)=>ledger.execute({tenantId:a.tenantId,actorUserId:a.actorUserId,channel,customerId:a.customerId,accountId:a.accountId,recipientId:a.recipientId,body,requestId,weeklyAuthority:a,send:async()=>{sends++;if(unknown)throw Error('provider_timeout');return {requestId,messageId:'mid.actual-native',recipientId:'buyer-native',acceptedAt:new Date().toISOString(),raw:{message_id:'mid.actual-native'}};},recordHistory:async()=>{}})});
 return {...f,item,batch,source,service,sends:()=>sends,command:{tenantId:'tenant',actorUserId:'owner',batchId:'batch',itemId:'item',expectedBatchVersion:2,expectedItemHash:String(item.content_hash),expectedScope:scope},restore:()=>{nativeWeeklyConversationPort.read=oldRead;}};
}
