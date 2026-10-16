import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
export const WEEKLY_WHATSAPP_MOCK_RUNS='social_weekly_whatsapp_mock_runs';
/** Local transport smoke test only. Never stored in official channels, receipts,
 * execution resultRefs or authorization collections. No network/provider calls. */
export async function runWeeklyWhatsAppMock(store:DataStore,task:WeeklyExecutionTask,actorUserId:string){
 if(task.schedule.stepKind!=='customer_channel_readiness'||task.inputSnapshot.customerChannel!=='whatsapp'||['succeeded','cancelled','dead_letter'].includes(task.status)||task.lease)throw Error('weekly_whatsapp_mock_consumer_invalid');
 const scope={tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,consumerTaskId:task.taskId,consumerInputHash:socialRequestHash(task.inputSnapshot)};
 const id=socialRequestHash({scope,kind:'whatsapp_mock_transport.v1'}).slice(0,15);
 const prior=await store.getById<Record_>(WEEKLY_WHATSAPP_MOCK_RUNS,id);
 if(prior){const p=prior.payload as ReturnType<typeof payload>;if(p.recordHash!==socialRequestHash({...p,recordHash:''})||socialRequestHash(p.scope)!==socialRequestHash(scope)||p.simulated!==true||p.realAuthorization!==false||p.businessDelivery!==false)throw Error('weekly_whatsapp_mock_record_invalid');return p;}
 function payload(){const value={kind:'whatsapp_mock_transport.v1',scope,actorUserId,createdAt:new Date().toISOString(),simulated:true,realAuthorization:false,businessDelivery:false,status:'passed',steps:['mock_inbound_received','mock_reply_queued','mock_transport_receipt_recorded'],inbound:{id:`mock-inbound-${id}`,body:'[MOCK] Can I request a sample?'},reply:{id:`mock-reply-${id}`,body:'[MOCK] Your sample inquiry has been received. No real message was sent.'},recordHash:''};return {...value,recordHash:socialRequestHash(value)};}
 const p=payload();
 if(!await store.create(WEEKLY_WHATSAPP_MOCK_RUNS,{id,tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,simulated:true,payload:p}))throw Error('weekly_whatsapp_mock_write_failed');
 return p;
}
