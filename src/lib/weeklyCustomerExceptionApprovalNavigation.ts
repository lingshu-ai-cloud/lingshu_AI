import {weeklyCustomerExceptionApprovalIdentity,type WeeklyCustomerExceptionApprovalReceipt,type WeeklyCustomerExceptionRequest} from '../../shared/contracts/weeklyCustomerKnowledgeQuote';
import {readCustomerTaskApprovalContext,type CustomerTaskApprovalContext} from './customerTaskApprovalApi';
import {dispatchDigitalEmployeeDeepLink} from './digitalEmployees';
/** Read the exact actual approval before opening its existing task. This never decides or sends. */
export async function openWeeklyCustomerExceptionApproval(receipt:WeeklyCustomerExceptionApprovalReceipt,request:WeeklyCustomerExceptionRequest,deps:{read?:(runId:string,taskId:string)=>Promise<CustomerTaskApprovalContext>;open?:(runId:string,taskId:string)=>void;isCurrent?:()=>boolean}={}){
 const expected=weeklyCustomerExceptionApprovalIdentity(request,receipt.actionIdentity?.action);
 if(Object.keys(expected).some(key=>key==='scope'?Object.keys(expected.scope).some(field=>receipt.actionIdentity?.scope?.[field as keyof typeof expected.scope]!==expected.scope[field as keyof typeof expected.scope]):receipt.actionIdentity?.[key as keyof typeof expected]!==expected[key as keyof typeof expected])||receipt.runId!==request.scope.runId||receipt.batchId!==request.application!.batchId||receipt.batchVersion!==request.application!.batchVersion||receipt.messagesSent!==0)throw Error('补齐审批回执与原请求或草稿版本不一致。');
 const actual=await (deps.read??readCustomerTaskApprovalContext)(receipt.runId,receipt.approvalTaskId);
 if(deps.isCurrent&&!deps.isCurrent())throw Error('当前周运行或登录身份已变化。');
 if(actual.tenantId!==request.scope.tenantId||actual.runId!==receipt.runId||actual.taskId!==receipt.approvalTaskId||actual.approvalId!==receipt.approvalId||actual.requestHash!==receipt.requestHash||actual.batchId!==receipt.batchId||actual.batchVersion!==receipt.batchVersion||actual.contentHash!==receipt.contentHash)throw Error('原审批请求、内容或批次已变化，请只读刷新。');
 (deps.open??((runId,taskId)=>dispatchDigitalEmployeeDeepLink({page:'conversion',runId,taskId,businessRef:{taskKey:'followup_batch_approval',businessDomain:'customer',statusSource:'真实知识与报价补齐审批请求'}})))(actual.runId,actual.taskId);
 return actual;
}
