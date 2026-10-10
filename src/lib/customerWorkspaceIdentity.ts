import type {DigitalEmployeeDeepLink} from './digitalEmployees';
import type {CustomerItemNavigation} from './weeklyCustomerProductionLink';

/** Reject a successful HTTP response whose rows do not belong to the original request. */
export function assertCustomerWorkspaceIdentity(data:any,link:DigitalEmployeeDeepLink,binding:CustomerItemNavigation|null=null):void {
 const reject=()=>{throw Error('客服工作区与原运行、批次或客群成员身份不一致。');};
 if(!data||!Array.isArray(data.tasks)||!Array.isArray(data.members)||!Array.isArray(data.items))reject();
 const scope=data.scope??data.navigation;
 if(!scope||scope.runId!==link.runId||typeof scope.tenantId!=='string'||!scope.tenantId)reject();
 if(data.run&&data.run.id!==link.runId)reject();
 const expected=link.businessRef.customerNavigation;
 if(expected&&typeof expected==='object'&&Object.entries(expected).some(([key,value])=>scope[key]!==value))reject();
 if(binding&&Object.entries(binding).some(([key,value])=>data.navigation?.[key]!==value))reject();
 if(!data.tasks.some((task:any)=>task.id===link.taskId&&task.run_id===link.runId&&task.task_key===link.businessRef.taskKey)||data.tasks.some((task:any)=>task.run_id!==link.runId))reject();
 const tenantId=scope.tenantId;
 if(data.segment&&(data.segment.tenant_id!==tenantId||data.segment.run_id!==link.runId))reject();
 if(data.batch&&(data.batch.tenant_id!==tenantId||data.batch.run_id!==link.runId||data.batch.segment_id!==data.segment?.id))reject();
 if(data.members.some((member:any)=>member.tenant_id!==tenantId||member.segment_id!==data.segment?.id||typeof member.customer_id!=='string'||!member.customer_id))reject();
 if(data.items.some((item:any)=>item.tenant_id!==tenantId||item.batch_id!==data.batch?.id||!data.members.some((member:any)=>member.id===item.segment_member_id&&member.customer_id===item.customer_id&&member.membership==='included')))reject();
 if(binding&&(!data.items.some((item:any)=>item.id===binding.itemId&&item.customer_id===binding.customerId&&item.segment_member_id===data.navigation.memberId)||data.batch?.id!==binding.batchId))reject();
}
